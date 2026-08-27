/**
 * `.machimoki` container format.
 *
 * A `.machimoki` file is a ZIP archive that bundles a printable 3D model
 * (3MF or STL) together with a `manifest.json` describing the export
 * (bounds, colors, format, up-axis, scale, ...). This keeps the model and its
 * provenance in a single distributable file.
 *
 * Layout:
 *   manifest.json   -> JSON metadata (see MachimokiManifest)
 *   model.3mf       -> the printable model (3MF or STL depending on format)
 *
 * Implemented with `fflate` (already a transitive dependency of the core
 * workspace via manifold-3d) so it works in Node, Workers and browsers.
 */

import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { Bounds, ExportOptions } from './types.js';

export const MACHIMOKI_MANIFEST = 'manifest.json';
export const MACHIMOKI_MODEL_3MF = 'model.3mf';
export const MACHIMOKI_MODEL_STL = 'model.stl';

export interface MachimokiManifest {
  /** Format version of the .machimoki container. */
  version: 1;
  /** Geographic bounds the model was exported from. */
  bounds: Bounds;
  /** The embedded model format ('3mf' | 'stl'). */
  modelFormat: '3mf' | 'stl';
  /** Export options that produced the model. */
  options: {
    terrainThickness: number;
    flattenBottom: boolean;
    lod?: string;
    includeTerrain?: boolean;
    buildingColor?: string;
    terrainColor?: string;
    upAxis?: string;
    scale?: number;
    includeSpanningBuildings?: boolean;
  };
  /** Human-readable warnings collected during export. */
  warnings: string[];
  /** ISO timestamp of when the file was created. */
  createdAt: string;
}

function modelFileName(format: '3mf' | 'stl'): string {
  return format === 'stl' ? MACHIMOKI_MODEL_STL : MACHIMOKI_MODEL_3MF;
}

/**
 * Build a `.machimoki` ZIP buffer from a printable model buffer and metadata.
 *
 * @param modelBuffer  The 3MF or STL model bytes.
 * @param modelFormat  Which format `modelBuffer` is ('3mf' | 'stl').
 * @param bounds       Geographic bounds the model was exported from.
 * @param options      Export options used to produce the model.
 * @param warnings     Warnings collected during export.
 */
export function createMachimokiBuffer(
  modelBuffer: Uint8Array,
  modelFormat: '3mf' | 'stl',
  bounds: Bounds,
  options: ExportOptions,
  warnings: string[] = [],
): Uint8Array {
  const manifest: MachimokiManifest = {
    version: 1,
    bounds,
    modelFormat,
    options: {
      terrainThickness: options.terrainThickness,
      flattenBottom: options.flattenBottom,
      lod: options.lod,
      includeTerrain: options.includeTerrain,
      buildingColor: options.buildingColor,
      terrainColor: options.terrainColor,
      upAxis: options.upAxis,
      scale: options.scale,
      includeSpanningBuildings: options.includeSpanningBuildings,
    },
    warnings,
    createdAt: new Date().toISOString(),
  };

  const files: Record<string, Uint8Array> = {
    [MACHIMOKI_MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
    [modelFileName(modelFormat)]: modelBuffer,
  };

  return zipSync(files, { level: 6 });
}

/**
 * Read a `.machimoki` ZIP buffer and return its manifest plus the embedded
 * model bytes. Throws if the archive is malformed or missing required entries.
 */
export function inspectMachimoki(buffer: Uint8Array): {
  manifest: MachimokiManifest;
  model: Uint8Array;
  modelFormat: '3mf' | 'stl';
} {
  const files = unzipSync(buffer);

  const manifestEntry = files[MACHIMOKI_MANIFEST];
  if (!manifestEntry) {
    throw new Error('Invalid .machimoki file: missing manifest.json');
  }

  let manifest: MachimokiManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestEntry)) as MachimokiManifest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid .machimoki manifest: ${message}`);
  }

  const modelFormat = manifest.modelFormat === 'stl' ? 'stl' : '3mf';
  const model = files[modelFileName(modelFormat)];
  if (!model) {
    throw new Error(`Invalid .machimoki file: missing ${modelFileName(modelFormat)}`);
  }

  return { manifest, model, modelFormat };
}
