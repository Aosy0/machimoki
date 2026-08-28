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

function alignFlatTerrainToBuildings(
  terrainMesh: RawMesh | null,
  buildingMeshes: RawMesh[],
): void {
  if (!terrainMesh || buildingMeshes.length === 0) return;
  const tPos = terrainMesh.positions;
  const totalVerts = tPos.length / 3;
  const topCount = Math.floor(totalVerts / 2);
  if (topCount === 0) return;
  const gridSize = Math.sqrt(topCount);
  const isGrid = Number.isInteger(gridSize) && gridSize >= 2 && gridSize * gridSize === topCount;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  if (isGrid) {
    for (let i = 0; i < topCount; i++) {
      const x = tPos[i * 3], z = tPos[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  for (const bm of buildingMeshes) {
    const p = bm.positions;
    const count = p.length / 3;
    if (count === 0) continue;
    let centroidX = 0;
    let centroidZ = 0;
    let buildingMinY = Infinity;
    for (let i = 0; i < count; i++) {
      centroidX += p[i * 3];
      centroidZ += p[i * 3 + 2];
      const y = p[i * 3 + 1];
      if (y < buildingMinY) buildingMinY = y;
    }
    centroidX /= count;
    centroidZ /= count;
    if (!Number.isFinite(buildingMinY)) continue;
    let terrainY: number;
    if (isGrid && maxX > minX && maxZ > minZ) {
      let minH = Infinity;
      for (let v = 0; v < count; v++) {
        const vx = p[v * 3], vz = p[v * 3 + 2];
        const fx = ((vx - minX) / (maxX - minX)) * (gridSize - 1);
        const fz = ((maxZ - vz) / (maxZ - minZ)) * (gridSize - 1);
        const clampedFx = Math.max(0, Math.min(gridSize - 1, fx));
        const clampedFz = Math.max(0, Math.min(gridSize - 1, fz));
        const xi = Math.min(gridSize - 2, Math.floor(clampedFx));
        const zi = Math.min(gridSize - 2, Math.floor(clampedFz));
        const dx = clampedFx - xi;
        const dz = clampedFz - zi;
        const idx00 = zi * gridSize + xi;
        const idx10 = zi * gridSize + (xi + 1);
        const idx01 = (zi + 1) * gridSize + xi;
        const idx11 = (zi + 1) * gridSize + (xi + 1);
        const h00 = tPos[idx00 * 3 + 1], h10 = tPos[idx10 * 3 + 1], h01 = tPos[idx01 * 3 + 1], h11 = tPos[idx11 * 3 + 1];
        const h = h00 * (1 - dx) * (1 - dz) + h10 * dx * (1 - dz) + h01 * (1 - dx) * dz + h11 * dx * dz;
        if (h < minH) minH = h;
      }
      terrainY = Number.isFinite(minH) ? minH : tPos[0 * 3 + 1];
    } else {
      let bestIdx = 0;
      let bestDist2 = Infinity;
      for (let i = 0; i < topCount; i++) {
        const dx = tPos[i * 3] - centroidX;
        const dz = tPos[i * 3 + 2] - centroidZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist2) { bestDist2 = d2; bestIdx = i; }
      }
      terrainY = tPos[bestIdx * 3 + 1];
    }
    const delta = terrainY - buildingMinY - 0.3;
    if (Math.abs(delta) < 1e-6) continue;
    for (let i = 0; i < count; i++) {
      p[i * 3 + 1] += delta;
    }
    if (Math.abs(delta) > 0.01) {
      console.warn(
        '[pipeline] Per-building grounding: shifted building by',
        delta,
        '(minY',
        buildingMinY,
        '-> terrainY',
        terrainY,
        '-0.3m overlap)',
      );
    }
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
  alignFlatTerrainToBuildings(terrainMesh, uniqueComponents);

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
