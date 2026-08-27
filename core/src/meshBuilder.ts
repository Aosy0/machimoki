/**
 * PLATEAU 3D Tiles (b3dm) → raw mesh.
 */

import {
  Cartesian3,
  Cesium3DTileset,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from 'cesium';
import { WebIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import type { Accessor, Primitive } from '@gltf-transform/core';
import type { Bounds, Lod, RawMesh } from './types.js';
import { findTilesetUrl, resolveMuniCodes } from './catalog.js';

let dracoDecoderPromise: Promise<unknown> | null = null;

async function getDracoDecoder(): Promise<unknown> {
  if (dracoDecoderPromise) return dracoDecoderPromise;

  const isBrowser =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as Record<string, unknown>).window !== 'undefined';

  if (!isBrowser) {
    const draco3dgltf = await import('draco3dgltf');
    dracoDecoderPromise = draco3dgltf.default.createDecoderModule();
  } else {
    const globalDecoder = (globalThis as Record<string, unknown>).__DRACO_DECODER_MODULE__;
    if (globalDecoder) {
      dracoDecoderPromise = Promise.resolve(globalDecoder);
    } else {
      // Vite / browser fallback: reuse the same npm package.
      // draco3dgltf ships a WASM decoder that works in browsers as well.
      try {
        const draco3dgltf = await import('draco3dgltf');
        dracoDecoderPromise = draco3dgltf.default.createDecoderModule();
      } catch {
        throw new Error(
          'Browser Draco decoder not available. Please load draco_decoder.js ' +
            'and set window.__DRACO_DECODER_MODULE__ before calling buildBuildingMeshes.',
        );
      }
    }
  }
  return dracoDecoderPromise;
}

interface TileLike {
  children?: TileLike[];
  computedTransform?: Matrix4;
  _contentUri?: string;
  _contentResource?: { url?: string };
  _header?: { boundingVolume?: { region?: number[] } };
}

function getTileContentUrl(tile: TileLike): string | undefined {
  return tile._contentUri ?? tile._contentResource?.url;
}

function traverseTiles(tile: TileLike, callback: (tile: TileLike) => void): void {
  callback(tile);
  if (tile.children) {
    for (const child of tile.children) {
      traverseTiles(child, callback);
    }
  }
}

function tileIntersectsBounds(tile: TileLike, bounds: Bounds): boolean {
  const region = tile._header?.boundingVolume?.region;
  if (!region || region.length < 4) return true;

  const west = CesiumMath.toDegrees(region[0]);
  const south = CesiumMath.toDegrees(region[1]);
  const east = CesiumMath.toDegrees(region[2]);
  const north = CesiumMath.toDegrees(region[3]);

  return !(east < bounds.west || west > bounds.east || north < bounds.south || south > bounds.north);
}

/**
 * CESIUM_RTC stores vertex positions relative to a center point. The tile's
 * computedTransform already accounts for this offset via the 3D Tiles
 * bounding-volume center, so we only strip the extension requirement from
 * the JSON (without modifying position data) so NodeIO can parse the GLB.
 */
interface PreprocessedGLB {
  buffer: ArrayBuffer;
  rtcCenter?: Cartesian3;
}

function preprocessGlbForNodeIO(buffer: ArrayBuffer): PreprocessedGLB {
  const dataView = new DataView(buffer);
  const totalLength = dataView.getUint32(8, true);

  let offset = 12;
  let jsonStart = -1;
  let jsonLength = 0;

  while (offset < totalLength) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);
    if (chunkType === 0x4e4f534a) {
      jsonStart = offset + 8;
      jsonLength = chunkLength;
      break;
    }
    offset += 8 + chunkLength;
  }

  if (jsonStart < 0) return { buffer };

  const jsonBytes = new Uint8Array(buffer, jsonStart, jsonLength);
  let gltf: any;
  try {
    gltf = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return { buffer };
  }

  const rtcCenterArray = gltf.extensions?.CESIUM_RTC?.center;
  const rtcCenter = Array.isArray(rtcCenterArray)
    ? new Cartesian3(rtcCenterArray[0], rtcCenterArray[1], rtcCenterArray[2])
    : undefined;

  if (!gltf.extensions?.CESIUM_RTC) return { buffer, rtcCenter };

  if (gltf.extensionsUsed) {
    gltf.extensionsUsed = gltf.extensionsUsed.filter((e: string) => e !== 'CESIUM_RTC');
  }
  if (gltf.extensionsRequired) {
    gltf.extensionsRequired = gltf.extensionsRequired.filter((e: string) => e !== 'CESIUM_RTC');
  }
  gltf.extensions.CESIUM_RTC = undefined;
  if (Object.keys(gltf.extensions).length === 0) {
    gltf.extensions = undefined;
  }

  return { buffer: rebuildGlbJson(buffer, jsonStart, jsonLength, gltf), rtcCenter };
}

/**
 * Replace the JSON chunk in a GLB buffer in-place with space padding.
 * CESIUM_RTC removal always shrinks the JSON so it always fits.
 */
function rebuildGlbJson(
  buffer: ArrayBuffer,
  jsonStart: number,
  jsonLength: number,
  gltf: any,
): ArrayBuffer {
  const newJson = JSON.stringify(gltf);
  const newJsonBytes = new TextEncoder().encode(newJson);

  if (newJsonBytes.length <= jsonLength) {
    const target = new Uint8Array(buffer, jsonStart, jsonLength);
    target.fill(0x20);
    target.set(newJsonBytes);
    return buffer;
  }

  const origView = new Uint8Array(buffer);
  const totalLength = new DataView(buffer).getUint32(8, true);
  const padLen = (8 - (newJsonBytes.length % 8)) % 8;
  const newJsonChunkLen = newJsonBytes.length + padLen;
  const newTotalLen = totalLength - jsonLength + newJsonChunkLen;
  const result = new Uint8Array(newTotalLen);

  result.set(origView.subarray(0, jsonStart));
  result.set(newJsonBytes, jsonStart);
  result.fill(0x20, jsonStart + newJsonBytes.length, jsonStart + newJsonChunkLen);
  const hdr = new DataView(result.buffer, result.byteOffset, 12);
  hdr.setUint32(8, newTotalLen, true);
  result.set(origView.subarray(jsonStart + jsonLength), jsonStart + newJsonChunkLen);

  return result.buffer;
}

const B3DM_HEADER_LENGTH = 28;

interface B3dmHeader {
  version: number;
  totalByteLength: number;
  featureTableJSONByteOffset: number;
  featureTableJSONByteLength: number;
  featureTableBinaryByteOffset: number;
  featureTableBinaryByteLength: number;
  batchTableJSONByteOffset: number;
  batchTableJSONByteLength: number;
  batchTableBinaryByteOffset: number;
  batchTableBinaryByteLength: number;
  glbByteOffset: number;
}

function readB3dmHeader(arrayBuffer: ArrayBuffer): B3dmHeader | null {
  const dataView = new DataView(arrayBuffer);
  const byteLength = arrayBuffer.byteLength;
  if (byteLength < 4) return null;

  const magic = String.fromCharCode(
    dataView.getUint8(0),
    dataView.getUint8(1),
    dataView.getUint8(2),
    dataView.getUint8(3),
  );
  if (magic !== 'b3dm') return null;

  if (byteLength < B3DM_HEADER_LENGTH) return null;
  const version = dataView.getUint32(4, true);
  if (version !== 1) return null;

  const totalByteLength = dataView.getUint32(8, true);
  const featureTableJSONByteLength = dataView.getUint32(12, true);
  const featureTableBinaryByteLength = dataView.getUint32(16, true);
  const batchTableJSONByteLength = dataView.getUint32(20, true);
  const batchTableBinaryByteLength = dataView.getUint32(24, true);

  const featureTableJSONByteOffset = B3DM_HEADER_LENGTH;
  const featureTableBinaryByteOffset = featureTableJSONByteOffset + featureTableJSONByteLength;
  const batchTableJSONByteOffset = featureTableBinaryByteOffset + featureTableBinaryByteLength;
  const batchTableBinaryByteOffset = batchTableJSONByteOffset + batchTableJSONByteLength;
  const glbByteOffset = batchTableBinaryByteOffset + batchTableBinaryByteLength;

  if (glbByteOffset > totalByteLength) return null;

  return {
    version,
    totalByteLength,
    featureTableJSONByteOffset,
    featureTableJSONByteLength,
    featureTableBinaryByteOffset,
    featureTableBinaryByteLength,
    batchTableJSONByteOffset,
    batchTableJSONByteLength,
    batchTableBinaryByteOffset,
    batchTableBinaryByteLength,
    glbByteOffset,
  };
}

/**
 * Extract glb buffer from a Batched 3D Model (.b3dm) ArrayBuffer.
 */
export function extractGltfFromB3dm(arrayBuffer: ArrayBuffer): ArrayBuffer | null {
  const header = readB3dmHeader(arrayBuffer);
  if (!header) return null;
  if (header.glbByteOffset >= header.totalByteLength) return null;
  return arrayBuffer.slice(header.glbByteOffset);
}

/**
 * Parse the b3dm batch table JSON.
 */
export function parseB3dmBatchTable(arrayBuffer: ArrayBuffer): unknown | null {
  const header = readB3dmHeader(arrayBuffer);
  if (!header || header.batchTableJSONByteLength === 0) return null;

  const jsonBytes = new Uint8Array(
    arrayBuffer,
    header.batchTableJSONByteOffset,
    header.batchTableJSONByteLength,
  );
  try {
    return JSON.parse(new TextDecoder().decode(jsonBytes).replace(/\0/g, ''));
  } catch {
    return null;
  }
}

function parseB3dmFeatureTableJSON(arrayBuffer: ArrayBuffer): unknown | null {
  const header = readB3dmHeader(arrayBuffer);
  if (!header || header.featureTableJSONByteLength === 0) return null;

  const jsonBytes = new Uint8Array(
    arrayBuffer,
    header.featureTableJSONByteOffset,
    header.featureTableJSONByteLength,
  );
  try {
    return JSON.parse(new TextDecoder().decode(jsonBytes).replace(/\0/g, ''));
  } catch {
    return null;
  }
}

function getBatchLength(featureTable: unknown): number {
  if (!featureTable || typeof featureTable !== 'object') return 0;
  const value = (featureTable as Record<string, unknown>).BATCH_LENGTH;
  return typeof value === 'number' ? value : 0;
}

const GMLID_KEYS = ['gmlid', 'gml_id', '_gmlid'] as const;

export function getGmlidArray(batchTable: unknown, batchLength: number): string[] | null {
  if (!batchTable || typeof batchTable !== 'object') return null;

  const record = batchTable as Record<string, unknown>;
  const raw = GMLID_KEYS.map((key) => record[key]).find((value) => value !== undefined);
  if (raw === undefined) return null;

  if (Array.isArray(raw)) {
    if (!raw.every((value): value is string => typeof value === 'string')) return null;
    return raw;
  }

  if (typeof raw === 'string') {
    return Array.from({ length: batchLength }, () => raw);
  }

  return null;
}

export function resolveExcludedBatchIds(gmlids: string[], excludedGmlIds: string[]): Set<number> {
  const excluded = new Set(excludedGmlIds);
  const result = new Set<number>();
  for (let i = 0; i < gmlids.length; i++) {
    if (excluded.has(gmlids[i])) {
      result.add(i);
    }
  }
  return result;
}

function resolveExcludedBatchIdsForB3dm(
  arrayBuffer: ArrayBuffer,
  excludedGmlIds?: string[],
): Set<number> | undefined {
  if (!excludedGmlIds || excludedGmlIds.length === 0) return undefined;

  const batchTable = parseB3dmBatchTable(arrayBuffer);
  const featureTable = parseB3dmFeatureTableJSON(arrayBuffer);
  const batchLength = getBatchLength(featureTable);
  const gmlids = getGmlidArray(batchTable, batchLength);
  if (!gmlids || gmlids.length === 0) return undefined;

  const excluded = resolveExcludedBatchIds(gmlids, excludedGmlIds);
  return excluded.size > 0 ? excluded : undefined;
}

/**
 * Remove triangles whose _BATCHID maps to an excluded batch index.
 * The returned mesh repacks only the vertices still referenced by kept triangles.
 */
export function filterTrianglesByBatchIds(
  positions: Float32Array,
  indices: Uint32Array,
  batchIds: Uint32Array,
  excludedBatchIds: Set<number>,
): RawMesh {
  if (excludedBatchIds.size === 0 || indices.length === 0) {
    return { positions, indices };
  }

  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  const keptIndices: number[] = [];
  const oldToNew = new Int32Array(vertexCount).fill(-1);
  let usedVertexCount = 0;

  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    if (
      excludedBatchIds.has(batchIds[i0]) ||
      excludedBatchIds.has(batchIds[i1]) ||
      excludedBatchIds.has(batchIds[i2])
    ) {
      continue;
    }

    for (const oldIndex of [i0, i1, i2]) {
      if (oldToNew[oldIndex] === -1) {
        oldToNew[oldIndex] = usedVertexCount++;
      }
      keptIndices.push(oldToNew[oldIndex]);
    }
  }

  if (keptIndices.length === 0) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }

  const newPositions = new Float32Array(usedVertexCount * 3);
  for (let oldIndex = 0; oldIndex < vertexCount; oldIndex++) {
    const newIndex = oldToNew[oldIndex];
    if (newIndex === -1) continue;
    newPositions[newIndex * 3] = positions[oldIndex * 3];
    newPositions[newIndex * 3 + 1] = positions[oldIndex * 3 + 1];
    newPositions[newIndex * 3 + 2] = positions[oldIndex * 3 + 2];
  }

  return { positions: newPositions, indices: new Uint32Array(keptIndices) };
}

function readUint32Array(accessor: Accessor): Uint32Array {
  const array = accessor.getArray();
  if (!array) return new Uint32Array(0);

  if (array instanceof Uint32Array) return array;
  if (array instanceof Uint16Array) return new Uint32Array(array);
  if (array instanceof Uint8Array) return new Uint32Array(array);
  return new Uint32Array(array);
}

function readFloat32Array(accessor: Accessor): Float32Array {
  const array = accessor.getArray();
  if (!array) return new Float32Array(0);

  if (array instanceof Float32Array) return array;
  return new Float32Array(array);
}

function matrix4FromMat4(elements: readonly number[]): Matrix4 {
  // glTF Transform mat4 and Cesium Matrix4 are both column-major.
  return new Matrix4(
    elements[0],
    elements[1],
    elements[2],
    elements[3],
    elements[4],
    elements[5],
    elements[6],
    elements[7],
    elements[8],
    elements[9],
    elements[10],
    elements[11],
    elements[12],
    elements[13],
    elements[14],
    elements[15],
  );
}

const GLTF_TO_ECEF_ROTATION = new Matrix4(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);

function transformPosition(
  x: number,
  y: number,
  z: number,
  nodeMatrix: Matrix4,
  tileMatrix: Matrix4,
  invCenterMatrix: Matrix4,
  rtcCenter?: Cartesian3,
): { x: number; y: number; z: number } {
  const local = Cartesian3.fromElements(x, y, z);
  const nodeWorldYup = Matrix4.multiplyByPoint(nodeMatrix, local, new Cartesian3());
  const nodeWorldZup = Matrix4.multiplyByPoint(GLTF_TO_ECEF_ROTATION, nodeWorldYup, new Cartesian3());
  if (rtcCenter) {
    Cartesian3.add(nodeWorldZup, rtcCenter, nodeWorldZup);
  }
  const ecef = Matrix4.multiplyByPoint(tileMatrix, nodeWorldZup, new Cartesian3());
  const enu = Matrix4.multiplyByPoint(invCenterMatrix, ecef, new Cartesian3());
  return { x: enu.x, y: enu.z, z: -enu.y };
}

async function parseGlbToRawMeshes(
  glbBuffer: ArrayBuffer,
  tileMatrix: Matrix4,
  invCenterMatrix: Matrix4,
  excludedBatchIds?: Set<number>,
): Promise<RawMesh[]> {
  const { buffer: processedBuffer, rtcCenter } = preprocessGlbForNodeIO(glbBuffer);
  const decoder = await getDracoDecoder();
  const io = new WebIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.decoder': decoder,
    });
  const document = await io.readBinary(new Uint8Array(processedBuffer));
  const result: RawMesh[] = [];

  const scenes = document.getRoot().listScenes();
  const defaultScene = document.getRoot().getDefaultScene();
  const scenesToProcess = defaultScene ? [defaultScene] : scenes;

  for (const scene of scenesToProcess) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;

      const worldMatrix = matrix4FromMat4(node.getWorldMatrix());

      for (const primitive of mesh.listPrimitives()) {
        const raw = primitiveToRawMesh(
          primitive,
          worldMatrix,
          tileMatrix,
          invCenterMatrix,
          rtcCenter,
          excludedBatchIds,
        );
        if (raw.positions.length > 0 && raw.indices.length > 0) {
          result.push(raw);
        }
      }
    });
  }

  return result;
}

function primitiveToRawMesh(
  primitive: Primitive,
  nodeMatrix: Matrix4,
  tileMatrix: Matrix4,
  invCenterMatrix: Matrix4,
  rtcCenter?: Cartesian3,
  excludedBatchIds?: Set<number>,
): RawMesh {
  const positionAccessor = primitive.getAttribute('POSITION');
  const indexAccessor = primitive.getIndices();

  if (!positionAccessor) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }

  const positions = readFloat32Array(positionAccessor);
  const indices = indexAccessor ? readUint32Array(indexAccessor) : new Uint32Array(0);

  let filteredPositions = positions;
  let filteredIndices = indices;

  if (excludedBatchIds && excludedBatchIds.size > 0 && indices.length > 0) {
    const batchIdAccessor = primitive.getAttribute('_BATCHID');
    if (batchIdAccessor) {
      const batchIds = readUint32Array(batchIdAccessor);
      if (batchIds.length > 0) {
        ({ positions: filteredPositions, indices: filteredIndices } = filterTrianglesByBatchIds(
          positions,
          indices,
          batchIds,
          excludedBatchIds,
        ));
      }
    }
  }

  if (filteredIndices.length === 0) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }

  const vertexCount = filteredPositions.length / 3;
  const transformedPositions = new Float32Array(filteredPositions.length);

  for (let i = 0; i < vertexCount; i++) {
    const x = filteredPositions[i * 3];
    const y = filteredPositions[i * 3 + 1];
    const z = filteredPositions[i * 3 + 2];
    const t = transformPosition(x, y, z, nodeMatrix, tileMatrix, invCenterMatrix, rtcCenter);
    transformedPositions[i * 3] = t.x;
    transformedPositions[i * 3 + 1] = t.y;
    transformedPositions[i * 3 + 2] = t.z;
  }

  return { positions: transformedPositions, indices: filteredIndices };
}

export async function buildBuildingMeshes(
  bounds: Bounds,
  lod: Lod,
  excludedGmlIds?: string[],
): Promise<RawMesh[]> {
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;

  const muniCodes = await resolveMuniCodes(bounds);

  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0);
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const invCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4());

  const resultMeshes: RawMesh[] = [];
  const tilePromises: Promise<void>[] = [];

  for (const muniCode of muniCodes) {
    let tilesetUrl: string;
    try {
      tilesetUrl = await findTilesetUrl(muniCode, lod);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[meshBuilder] Failed to find tileset for muniCode=${muniCode}: ${message}`);
      continue;
    }

    let tileset: Cesium3DTileset;
    try {
      tileset = await Cesium3DTileset.fromUrl(tilesetUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[meshBuilder] Failed to load tileset ${tilesetUrl}: ${message}`);
      continue;
    }

    const rootTile = tileset.root as unknown as TileLike;
    const tilesetMatrix = (tileset as any).modelMatrix ?? Matrix4.IDENTITY;

    traverseTiles(rootTile, (tile) => {
      if (!tileIntersectsBounds(tile, bounds)) return;

      const contentUrl = getTileContentUrl(tile);
      if (!contentUrl) return;

      const tileLocalMatrix = tile.computedTransform ?? Matrix4.IDENTITY;
      const tileMatrix = Matrix4.multiply(tilesetMatrix, tileLocalMatrix, new Matrix4());

      const promise = (async () => {
        try {
          const response = await fetch(contentUrl);
          if (!response.ok) {
            console.warn(`[meshBuilder] Failed to fetch tile: ${contentUrl} (${response.status})`);
            return;
          }
          const arrayBuffer = await response.arrayBuffer();
          const excludedBatchIds = resolveExcludedBatchIdsForB3dm(arrayBuffer, excludedGmlIds);
          const glbBuffer = extractGltfFromB3dm(arrayBuffer);
          if (!glbBuffer) {
            console.warn(`[meshBuilder] Could not extract GLB from b3dm: ${contentUrl}`);
            return;
          }
          const meshes = await parseGlbToRawMeshes(
            glbBuffer,
            tileMatrix,
            invCenterMatrix,
            excludedBatchIds,
          );
          resultMeshes.push(...meshes);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[meshBuilder] Failed to load tile ${contentUrl}: ${message}`);
        }
      })();

      tilePromises.push(promise);
    });
  }

  await Promise.all(tilePromises);
  return resultMeshes;
}
