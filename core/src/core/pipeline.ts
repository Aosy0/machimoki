/**
 * High-level orchestration pipeline: bounds + options -> printable model buffer.
 */

import { Bounds, ExportOptions, RawMesh } from './types.js';
import { buildBuildingMeshes } from './meshBuilder.js';
import { buildTerrainMesh } from './terrain.js';
import {
  createManifoldFromMesh,
  exportPartsTo3MF,
  exportMeshesToSTL,
  mergeRawMeshes,
} from './manifoldOps.js';

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
): Promise<Buffer> {
  const includeTerrain = options.includeTerrain ?? true;
  const lod = options.lod ?? 'lod1';
  const format = options.format;
  const buildingColor = options.buildingColor ?? '#ffffff';
  const terrainColor = options.terrainColor ?? '#ffffff';

  try {
    const buildingMeshes = await buildBuildingMeshes(bounds, lod);

    if (format === 'stl') {
      // STL has no material support — merge all raw meshes together.
      const meshes: RawMesh[] = [];
      if (includeTerrain) {
        const terrainMesh = await buildTerrainMesh(
          bounds,
          options.terrainThickness,
          options.flattenBottom,
        );
        meshes.push(terrainMesh);
      }
      meshes.push(...buildingMeshes);

      if (meshes.length === 0) {
        throw new Error('No meshes generated for the requested bounds');
      }

      return exportMeshesToSTL(meshes);
    }

    // 3MF: export terrain (as manifold) and buildings (as raw mesh) as
    // separate colored components. Building meshes from PLATEAU 3D Tiles
    // are often not closed manifolds, so we skip manifold creation for them.
    const parts: Array<
      | { manifold: Manifold; color: string }
      | { mesh: RawMesh; color: string }
    > = [];

    if (includeTerrain) {
      const terrainMesh = await buildTerrainMesh(
        bounds,
        options.terrainThickness,
        options.flattenBottom,
      );
      const terrainManifold = await createManifoldFromMesh(terrainMesh);
      parts.push({ manifold: terrainManifold, color: terrainColor });
    }

    if (buildingMeshes.length > 0) {
      const buildingMeshesMerged = mergeRawMeshes(buildingMeshes);
      parts.push({ mesh: buildingMeshesMerged, color: buildingColor });
    }

    if (parts.length === 0) {
      throw new Error('No meshes generated for the requested bounds');
    }

    try {
      return await exportPartsTo3MF(parts);
    } finally {
      for (const part of parts) {
        if ('manifold' in part) {
          part.manifold.delete();
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build printable model: ${message}`);
  }
}
