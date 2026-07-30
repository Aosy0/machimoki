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

async function buildPrintableModelUnsafe(
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  const includeTerrain = options.includeTerrain ?? true;
  const lod = options.lod ?? 'lod1';
  const format = options.format;
  const buildingColor = options.buildingColor ?? '#ffffff';
  const terrainColor = options.terrainColor ?? '#ffffff';
  const warnings: string[] = [];

  const buildingMeshes = await buildBuildingMeshes(bounds, lod);

  const terrainMesh = includeTerrain
    ? await buildTerrainMesh(bounds, options.terrainThickness, options.flattenBottom)
    : null;

  const buildingManifolds: Manifold[] = [];
  for (let i = 0; i < buildingMeshes.length; i++) {
    const welded = weldVertices(buildingMeshes[i]);
    const components = splitConnectedComponents(welded);
    for (let j = 0; j < components.length; j++) {
      const comp = components[j];
      const capped = capBuildingBottom(comp);
      try {
        const m = await createManifoldFromMesh(capped);
        buildingManifolds.push(m);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Building ${i + 1}.${j + 1} skipped (not printable): ${message}`);
      }
    }
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
      return { buffer: exportMeshesToSTL([meshToRaw(union.getMesh())]), warnings };
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
    return { buffer: await exportPartsTo3MF(parts), warnings };
  } finally {
    for (const part of parts) {
      part.manifold.delete();
    }
  }
}

function meshToRaw(mesh: { vertProperties: Float32Array; triVerts: Uint32Array }): RawMesh {
  return { positions: mesh.vertProperties, indices: mesh.triVerts };
}
