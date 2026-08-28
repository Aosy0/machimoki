/**
 * High-level orchestration pipeline: bounds + options -> printable model buffer.
 */

import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js';
import { buildBuildingMeshes } from './meshBuilder.js';
import { buildTerrainMesh } from './terrain.js';
import type { Manifold } from 'manifold-3d';
import {
  createManifoldFromMesh,
  exportMeshesToSTL,
  exportTo3MF,
  unionMeshes,
} from './manifoldOps.js';
import { capBuildingBottom, splitConnectedComponents, weldVertices } from './buildingCapper.js';
import {
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js';
import { createMachimokiBuffer } from './machimokiFormat.js';
import { buildPrintableModelFromMeshes } from './pipelineUtils.js';

export {
  boundsToEngineXZ,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js';

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
  const upAxis = options.upAxis ?? 'z-up';
  const scale = options.scale ?? 1;
  const includeSpanning = options.includeSpanningBuildings ?? false;
  const pickPoints = options.pickPoints ?? [];
  const warnings: string[] = [];

  if (format === 'machimoki') {
    throw new Error(
      "format 'machimoki' is not supported by buildPrintableModel; use exportMachimoki instead",
    );
  }

  const buildingMeshes = await buildBuildingMeshes(bounds, lod, options.excludedGmlIds);

  let terrainMesh = includeTerrain
    ? await buildTerrainMesh(bounds, options.terrainThickness, options.flattenBottom)
    : null;

  const components: RawMesh[] = [];
  for (const mesh of buildingMeshes) {
    const welded = weldVertices(mesh);
    components.push(...splitConnectedComponents(welded));
  }
  const uniqueComponents = dedupeComponents(components);

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

  // 3MF path: union terrain + buildings into a single manifold so the 3MF
  // contains exactly one <object> and one <build> <item>. Bambu Studio warns
  // on multi-object / multi-height files, so a single merged object is the
  // safe default.
  const meshes: RawMesh[] = [];
  if (terrainMesh) meshes.push(terrainMesh);
  meshes.push(...buildingManifolds.map((m) => meshToRaw(m.getMesh())));

  if (meshes.length === 0) {
    throw new Error('No printable meshes generated for the requested bounds');
  }

  const union = await unionMeshes(meshes);
  try {
    const modelColor = terrainMesh ? terrainColor : buildingColor;
    return { buffer: await exportTo3MF(union, modelColor, upAxis), warnings };
  } finally {
    union.delete();
    for (const manifold of buildingManifolds) manifold.delete();
  }
}

export interface MachimokiExportResult extends ExportResult {
  modelBuffer: Uint8Array;
  modelFormat: '3mf' | 'stl';
}

/**
 * Build a `.machimoki` container from geographic bounds and export options.
 *
 * Fetches buildings and terrain, produces the printable model in the embedded
 * format (`options.machimokiModelFormat`, default '3mf'), then wraps it in a
 * `.machimoki` ZIP with a manifest.
 */
export async function exportMachimoki(
  bounds: Bounds,
  options: ExportOptions,
): Promise<MachimokiExportResult> {
  try {
    return await exportMachimokiUnsafe(bounds, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export .machimoki: ${message}`);
  }
}

async function exportMachimokiUnsafe(
  bounds: Bounds,
  options: ExportOptions,
): Promise<MachimokiExportResult> {
  const modelFormat = options.machimokiModelFormat ?? '3mf';
  const modelOptions: ExportOptions = { ...options, format: modelFormat };
  const { buffer, warnings } = await buildPrintableModel(bounds, modelOptions);
  return {
    buffer: createMachimokiBuffer(buffer, modelFormat, bounds, options, warnings),
    modelBuffer: buffer,
    modelFormat,
    warnings,
  };
}

/**
 * Build a `.machimoki` container from already-fetched meshes.
 *
 * Equivalent to `exportMachimoki` but accepts pre-fetched `RawMesh` data
 * instead of fetching buildings/terrain itself. Useful when the caller already
 * has the geometry (e.g. decoded in the browser or a Worker).
 */
export async function exportMachimokiFromMeshes(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<MachimokiExportResult> {
  const modelFormat = options.machimokiModelFormat ?? '3mf';
  const modelOptions: ExportOptions = { ...options, format: modelFormat };
  const { buffer, warnings } = await buildPrintableModelFromMeshes(
    buildingMeshes,
    terrainMesh,
    bounds,
    modelOptions,
  );
  return {
    buffer: createMachimokiBuffer(buffer, modelFormat, bounds, options, warnings),
    modelBuffer: buffer,
    modelFormat,
    warnings,
  };
}
