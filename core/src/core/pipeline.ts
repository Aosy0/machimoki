/**
 * High-level orchestration pipeline: bounds + options -> printable model buffer.
 */

import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js';
import { buildBuildingMeshes } from './meshBuilder.js';
import { buildTerrainMesh } from './terrain.js';
import type { Manifold } from 'manifold-3d';
import {
  createManifoldFromMesh,
  exportPartsTo3MF,
  exportMeshesToSTL,
  unionMeshes,
} from './manifoldOps.js';
import { capBuildingBottom, splitConnectedComponents, weldVertices } from './buildingCapper.js';

/**
 * Build a printable 3D model from geographic bounds and export options.
 *
 * - For STL: all meshes are unioned into a single manifold (no material support).
 * - For 3MF: terrain and buildings are exported as separate components with
 *   their respective colors (buildingColor / terrainColor).
 *
 * Defaults:
 * - includeTerrain is true when omitted
 * - lod is 'lod1' when omitted
 */
export async function buildPrintableModel(
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  try {
    return await buildPrintableModelUnsafe(bounds, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build printable model: ${message}`);
  }
}

/**
 * Convert geographic bounds to the local engine coordinate frame
 * (x = east, y = up, z = south) centered on the selection center.
 * Matches the transform used by meshBuilder/terrain.
 */
function boundsToEngineXZ(bounds: Bounds): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  return {
    minX: (bounds.west - centerLon) * mPerDegLon,
    maxX: (bounds.east - centerLon) * mPerDegLon,
    minZ: -(bounds.north - centerLat) * mPerDegLat,
    maxZ: -(bounds.south - centerLat) * mPerDegLat,
  };
}

/**
 * True if the mesh's 2D footprint (x/z) intersects the selection bounds.
 *
 * PLATEAU tilesets contain huge root tiles (kilometer-scale regions), so a
 * tile-level intersection test keeps every building from all intersecting
 * tiles. Each connected component is a single building; filtering at this
 * level removes buildings far outside the requested bounds.
 */
function componentIntersectsBounds(mesh: RawMesh, bounds: Bounds, tolerance = 1e-2): boolean {
  const { minX, maxX, minZ, maxZ } = boundsToEngineXZ(bounds);

  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinZ = Infinity;
  let bMaxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const z = mesh.positions[i + 2];
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (z < bMinZ) bMinZ = z;
    if (z > bMaxZ) bMaxZ = z;
  }

  return !(
    bMaxX < minX - tolerance ||
    bMinX > maxX + tolerance ||
    bMaxZ < minZ - tolerance ||
    bMinZ > maxZ + tolerance
  );
}

/**
 * Scale a RawMesh by multiplying all position components by a uniform factor.
 * Returns a new mesh with a fresh Float32Array; does NOT mutate the input.
 */
function scaleRawMesh(mesh: RawMesh, scale: number): RawMesh {
  if (scale === 1) return mesh;
  const scaled = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    scaled[i] = mesh.positions[i] * scale;
  }
  return { positions: scaled, indices: mesh.indices };
}

async function buildPrintableModelUnsafe(
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  const includeTerrain = options.includeTerrain ?? true;
  const lod = options.lod ?? 'lod1';
  const format = options.format;
  const buildingColor = options.buildingColor ?? '#ffffff';
  const terrainColor = options.terrainColor ?? '#ffffff';
  const upAxis = options.upAxis ?? 'z-up';
  const scale = options.scale ?? 1;
  const warnings: string[] = [];

  const buildingMeshes = await buildBuildingMeshes(bounds, lod);

  let terrainMesh = includeTerrain
    ? await buildTerrainMesh(bounds, options.terrainThickness, options.flattenBottom)
    : null;

  const buildingManifolds: Manifold[] = [];
  for (let i = 0; i < buildingMeshes.length; i++) {
    const welded = weldVertices(buildingMeshes[i]);
    const components = splitConnectedComponents(welded);
    for (let j = 0; j < components.length; j++) {
      const comp = components[j];
      if (!componentIntersectsBounds(comp, bounds)) continue;
      const capped = capBuildingBottom(comp);
      const scaled = scaleRawMesh(capped, scale);
      try {
        const m = await createManifoldFromMesh(scaled);
        buildingManifolds.push(m);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Building ${i + 1}.${j + 1} skipped (not printable): ${message}`);
      }
    }
  }

  // Scale terrain mesh after building manifolds (which used unscaled coords for filtering)
  if (terrainMesh && scale !== 1) {
    terrainMesh = scaleRawMesh(terrainMesh, scale);
  }

  if (format === 'stl') {
    const meshes: RawMesh[] = [];
    if (terrainMesh) meshes.push(terrainMesh);
    meshes.push(...buildingManifolds.map((m) => meshToRaw(m.getMesh())));

    if (meshes.length === 0) {
      throw new Error('No printable meshes generated for the requested bounds');
    }

    const union = await unionMeshes(meshes);
    try {
      return { buffer: exportMeshesToSTL([meshToRaw(union.getMesh())], upAxis), warnings };
    } finally {
      union.delete();
    }
  }

  const parts: Array<{ manifold: Manifold; color: string }> = [];
  if (terrainMesh) {
    parts.push({ manifold: await createManifoldFromMesh(terrainMesh), color: terrainColor });
  }
  for (const manifold of buildingManifolds) {
    parts.push({ manifold, color: buildingColor });
  }

  if (parts.length === 0) {
    throw new Error('No printable meshes generated for the requested bounds');
  }

  try {
    return { buffer: await exportPartsTo3MF(parts, upAxis), warnings };
  } finally {
    for (const part of parts) {
      part.manifold.delete();
    }
  }
}

function meshToRaw(mesh: { vertProperties: Float32Array; triVerts: Uint32Array }): RawMesh {
  return { positions: mesh.vertProperties, indices: mesh.triVerts };
}
