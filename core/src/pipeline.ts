/**
 * High-level orchestration pipeline: bounds + options -> printable model buffer.
 */

import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js'
import { buildBuildingMeshes } from './meshBuilder.js'
import { buildTerrainMesh } from './terrain.js'
import { printedMmToModelMeters } from './pipelineCore.js'
import { createMachimokiBuffer } from './machimokiFormat.js'
import { buildPrintableModelFromMeshes } from './pipelineUtils.js'

export {
  boundsToEngineXZ,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js'

/**
 * Build a printable 3D model from geographic bounds and export options.
 *
 * Fetches buildings and terrain, then delegates to the shared post-fetch
 * pipeline (`buildPrintableModelFromMeshes`) for welding, filtering, bottom
 * capping, union, optional open-bottom hollowing, and export.
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
    return await buildPrintableModelUnsafe(bounds, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to build printable model: ${message}`)
  }
}

async function buildPrintableModelUnsafe(
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  const format = options.format
  const includeTerrain = options.includeTerrain ?? true
  const lod = options.lod ?? 'lod1'
  const scale = options.scale ?? 1

  if (format === 'machimoki') {
    throw new Error(
      "format 'machimoki' is not supported by buildPrintableModel; use exportMachimoki instead",
    )
  }

  const buildingMeshes = await buildBuildingMeshes(bounds, lod, options.excludedGmlIds)

  const terrainMesh = includeTerrain
    ? await buildTerrainMesh(
        bounds,
        printedMmToModelMeters(options.terrainThickness, scale),
        options.flattenBottom,
        options.terrainGridSize,
        options.reflectActualElevation ?? false,
      )
    : null

  return buildPrintableModelFromMeshes(buildingMeshes, terrainMesh, bounds, options)
}

export interface MachimokiExportResult extends ExportResult {
  modelBuffer: Uint8Array
  modelFormat: '3mf' | 'stl'
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
    return await exportMachimokiUnsafe(bounds, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to export .machimoki: ${message}`)
  }
}

async function exportMachimokiUnsafe(
  bounds: Bounds,
  options: ExportOptions,
): Promise<MachimokiExportResult> {
  const modelFormat = options.machimokiModelFormat ?? '3mf'
  const modelOptions: ExportOptions = { ...options, format: modelFormat }
  const { buffer, warnings } = await buildPrintableModel(bounds, modelOptions)
  return {
    buffer: createMachimokiBuffer(buffer, modelFormat, bounds, options, warnings),
    modelBuffer: buffer,
    modelFormat,
    warnings,
  }
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
  const modelFormat = options.machimokiModelFormat ?? '3mf'
  const modelOptions: ExportOptions = { ...options, format: modelFormat }
  const { buffer, warnings } = await buildPrintableModelFromMeshes(
    buildingMeshes,
    terrainMesh,
    bounds,
    modelOptions,
  )
  return {
    buffer: createMachimokiBuffer(buffer, modelFormat, bounds, options, warnings),
    modelBuffer: buffer,
    modelFormat,
    warnings,
  }
}
