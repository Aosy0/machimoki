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
import { NodeIO } from '@gltf-transform/core';
import type { Accessor, Primitive } from '@gltf-transform/core';
import type { Bounds, RawMesh } from './types';
import { findTilesetUrl, resolveMuniCode } from './catalog';

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
 * Extract glb buffer from a Batched 3D Model (.b3dm) ArrayBuffer.
 */
export function extractGltfFromB3dm(arrayBuffer: ArrayBuffer): ArrayBuffer | null {
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

  if (byteLength < 28) return null;
  const version = dataView.getUint32(4, true);
  if (version !== 1) return null;

  const totalByteLength = dataView.getUint32(8, true);
  const featureTableJSONByteLength = dataView.getUint32(12, true);
  const featureTableBinaryByteLength = dataView.getUint32(16, true);
  const batchTableJSONByteLength = dataView.getUint32(20, true);
  const batchTableBinaryByteLength = dataView.getUint32(24, true);

  const headerLength = 28;
  const featureTableJSONByteOffset = headerLength;
  const featureTableBinaryByteOffset = featureTableJSONByteOffset + featureTableJSONByteLength;
  const batchTableJSONByteOffset = featureTableBinaryByteOffset + featureTableBinaryByteLength;
  const batchTableBinaryByteOffset = batchTableJSONByteOffset + batchTableJSONByteLength;
  const glbByteOffset = batchTableBinaryByteOffset + batchTableBinaryByteLength;

  if (glbByteOffset >= totalByteLength) return null;

  return arrayBuffer.slice(glbByteOffset);
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

function transformPosition(
  x: number,
  y: number,
  z: number,
  nodeMatrix: Matrix4,
  tileMatrix: Matrix4,
  invCenterMatrix: Matrix4,
): { x: number; y: number; z: number } {
  const local = Cartesian3.fromElements(x, y, z);
  const nodeWorld = Matrix4.multiplyByPoint(nodeMatrix, local, new Cartesian3());
  const ecef = Matrix4.multiplyByPoint(tileMatrix, nodeWorld, new Cartesian3());
  const enu = Matrix4.multiplyByPoint(invCenterMatrix, ecef, new Cartesian3());
  return { x: enu.x, y: enu.z, z: -enu.y };
}

async function parseGlbToRawMeshes(
  glbBuffer: ArrayBuffer,
  tileMatrix: Matrix4,
  invCenterMatrix: Matrix4,
): Promise<RawMesh[]> {
  const io = new NodeIO();
  const document = await io.readBinary(new Uint8Array(glbBuffer));
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
        const raw = primitiveToRawMesh(primitive, worldMatrix, tileMatrix, invCenterMatrix);
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
): RawMesh {
  const positionAccessor = primitive.getAttribute('POSITION');
  const indexAccessor = primitive.getIndices();

  if (!positionAccessor) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  }

  const positions = readFloat32Array(positionAccessor);
  const indices = indexAccessor ? readUint32Array(indexAccessor) : new Uint32Array(0);

  const vertexCount = positions.length / 3;
  const transformedPositions = new Float32Array(positions.length);

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const t = transformPosition(x, y, z, nodeMatrix, tileMatrix, invCenterMatrix);
    transformedPositions[i * 3] = t.x;
    transformedPositions[i * 3 + 1] = t.y;
    transformedPositions[i * 3 + 2] = t.z;
  }

  return { positions: transformedPositions, indices };
}

export async function buildBuildingMeshes(
  bounds: Bounds,
  lod: 'lod1' | 'lod2',
): Promise<RawMesh[]> {
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;

  const muniCode = await resolveMuniCode(centerLat, centerLon);
  const tilesetUrl = await findTilesetUrl(muniCode, lod);

  const tileset = await Cesium3DTileset.fromUrl(tilesetUrl);
  const rootTile = tileset.root as unknown as TileLike;

  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0);
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const invCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4());

  const resultMeshes: RawMesh[] = [];
  const tilePromises: Promise<void>[] = [];

  traverseTiles(rootTile, (tile) => {
    if (!tileIntersectsBounds(tile, bounds)) return;

    const contentUrl = getTileContentUrl(tile);
    if (!contentUrl) return;

    const tileMatrix = tile.computedTransform ?? Matrix4.IDENTITY;

    const promise = (async () => {
      try {
        const response = await fetch(contentUrl);
        if (!response.ok) {
          console.warn(`[meshBuilder] Failed to fetch tile: ${contentUrl} (${response.status})`);
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const glbBuffer = extractGltfFromB3dm(arrayBuffer);
        if (!glbBuffer) {
          console.warn(`[meshBuilder] Could not extract GLB from b3dm: ${contentUrl}`);
          return;
        }
        const meshes = await parseGlbToRawMeshes(glbBuffer, tileMatrix, invCenterMatrix);
        resultMeshes.push(...meshes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[meshBuilder] Failed to load tile ${contentUrl}: ${message}`);
      }
    })();

    tilePromises.push(promise);
  });

  await Promise.all(tilePromises);
  return resultMeshes;
}
