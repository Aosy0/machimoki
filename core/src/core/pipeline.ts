/**
 * High-level orchestration pipeline: bounds + options -> printable model buffer.
 */

import { Bounds, ExportOptions } from './types.js';
import { buildBuildingMeshes } from './meshBuilder.js';
import { buildTerrainMesh } from './terrain.js';
import { unionMeshes, exportTo3MF, exportToSTL } from './manifoldOps.js';
import { RawMesh } from './types.js';

/**
 * Build a printable 3D model from geographic bounds and export options.
 *
 * Defaults:
 * - includeTerrain is true when omitted
 * - lod is 'lod1' when omitted
 */
export async function buildPrintableModel(
  bounds: Bounds,
  options: ExportOptions,
): Promise<Buffer> {
  const includeTerrain = options.includeTerrain ?? true;
  const lod = options.lod ?? 'lod1';
  const format = options.format;

  const meshes: RawMesh[] = [];

  try {
    if (includeTerrain) {
      const terrainMesh = await buildTerrainMesh(
        bounds,
        options.terrainThickness,
        options.flattenBottom,
      );
      meshes.push(terrainMesh);
    }

    const buildingMeshes = await buildBuildingMeshes(bounds, lod);
    meshes.push(...buildingMeshes);

    if (meshes.length === 0) {
      throw new Error('No meshes generated for the requested bounds');
    }

    const union = await unionMeshes(meshes);

    try {
      if (format === 'stl') {
        return exportToSTL(union);
      }
      return await exportTo3MF(union);
    } finally {
      union.delete();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build printable model: ${message}`);
  }
}
