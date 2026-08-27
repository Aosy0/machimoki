/**
 * Post-fetch pipeline: RawMeshes + bounds + options -> printable model buffer.
 *
 * This module is safe to import in Web Workers and browsers because it uses
 * no I/O, no Cesium, and only calls manifold-3d through existing manifoldOps.
 */

import type { Manifold } from 'manifold-3d';
import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js';
import { capBuildingBottom, splitConnectedComponents, weldVertices } from './buildingCapper.js';
import {
  createManifoldFromMesh,
  exportPartsTo3MF,
  exportMeshesToSTL,
  unionMeshes,
} from './manifoldOps.js';
import {
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js';

/**
 * Build a printable 3D model from already-fetched meshes.
 *
 * The caller must:
 * - fetch building meshes (e.g. PLATEAU 3D Tiles decoded via Cesium in main thread)
 * - fetch terrain mesh   (e.g. Cesium Terrain sampled in main thread)
 * - pass them as `RawMesh` plus original bounds and export options
 *
 * This function performs welding, connected-component splitting, deduping,
 * bounding-box / pick-point filtering, bottom-capping, manifold creation,
 * union, and export to 3MF or STL. Building color and terrain color are
 * written as 3MF colorgroup resources.
 */
export async function buildPrintableModelFromMeshes(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  const format = options.format;
  const buildingColor = options.buildingColor ?? '#ffffff';
  const terrainColor = options.terrainColor ?? '#ffffff';
  const upAxis = options.upAxis ?? 'z-up';
  const scale = options.scale ?? 1;
  const includeSpanning = options.includeSpanningBuildings ?? false;
  const pickPoints = options.pickPoints ?? [];
  const warnings: string[] = [];

  if (format === 'machimoki') {
    throw new Error(
      "format 'machimoki' is not supported by buildPrintableModelFromMeshes; use exportMachimokiFromMeshes instead",
    );
  }

  // Weld & split into connected components so each building is a separate
  // component for deduping and filtering.
  const components: RawMesh[] = [];
  for (const mesh of buildingMeshes) {
    const welded = weldVertices(mesh);
    components.push(...splitConnectedComponents(welded));
  }
  const uniqueComponents = dedupeComponents(components);

  // Build Manifold solids for each surviving building.
  const buildingManifolds: Manifold[] = [];
  for (let j = 0; j < uniqueComponents.length; j++) {
    const comp = uniqueComponents[j];
    if (pickPoints.length > 0) {
      const matched = pickPoints.some((p) => componentContainsPoint(comp, p.lon, p.lat, bounds));
      if (!matched) continue;
    } else if (!componentIntersectsBounds(comp, bounds, 1e-2, includeSpanning)) {
      continue;
    }
    const capped = capBuildingBottom(comp);
    const scaled = scaleRawMesh(capped, scale);
    try {
      const m = await createManifoldFromMesh(scaled);
      buildingManifolds.push(m);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Building ${j + 1} skipped (not printable): ${message}`);
    }
  }

  if (pickPoints.length > 0 && buildingManifolds.length === 0) {
    warnings.push('No buildings matched the pick points');
  }

  // Scale terrain after building filtering (which used unscaled coords).
  if (terrainMesh && scale !== 1) {
    terrainMesh = scaleRawMesh(terrainMesh, scale);
  }

  // STL path: union everything into one solid.
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

  // 3MF path: export terrain and buildings as separate colored parts.
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
