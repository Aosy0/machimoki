import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { buildBuildingMeshes, extractGltfFromB3dm } from '../../src/core/meshBuilder';
import type { Bounds } from '../../src/core/types';

vi.mock('cesium', () => {
  class Cartesian3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    static fromDegrees(lon: number, lat: number, height = 0): Cartesian3 {
      return new Cartesian3(lon, lat, height);
    }
    static fromElements(x: number, y: number, z: number): Cartesian3 {
      return new Cartesian3(x, y, z);
    }
  }

  class Matrix4 {
    constructor(public elements: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {}
    static inverse(matrix: Matrix4, result: Matrix4): Matrix4 {
      result.elements = [...matrix.elements];
      return result;
    }
    static multiplyByPoint(_matrix: Matrix4, cartesian: Cartesian3, result: Cartesian3): Cartesian3 {
      result.x = cartesian.x;
      result.y = cartesian.y;
      result.z = cartesian.z;
      return result;
    }
    static multiply(left: Matrix4, right: Matrix4, result: Matrix4): Matrix4 {
      const a = left.elements;
      const b = right.elements;
      const out = result.elements;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          out[i * 4 + j] =
            a[i * 4 + 0] * b[0 * 4 + j] +
            a[i * 4 + 1] * b[1 * 4 + j] +
            a[i * 4 + 2] * b[2 * 4 + j] +
            a[i * 4 + 3] * b[3 * 4 + j];
        }
      }
      return result;
    }
    static IDENTITY = new Matrix4();
  }

  return {
    Cartesian3,
    Matrix4,
    Cesium3DTileset: { fromUrl: vi.fn() },
    Transforms: {
      eastNorthUpToFixedFrame: () => new Matrix4(),
    },
    Math: {
      toDegrees: (rad: number) => rad,
      toRadians: (deg: number) => deg,
    },
  };
});

vi.mock('../../src/core/catalog', () => ({
  resolveMuniCode: vi.fn(),
  resolveMuniCodes: vi.fn(),
  findTilesetUrl: vi.fn(),
}));

const bounds: Bounds = {
  west: 139.69,
  south: 35.69,
  east: 139.7,
  north: 35.7,
};

function align(value: number, size: number): number {
  return Math.ceil(value / size) * size;
}

async function createTestGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positionAccessor = doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indicesAccessor = doc
    .createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array([0, 1, 2]))
    .setBuffer(buffer);
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setIndices(indicesAccessor);
  const mesh = doc.createMesh().addPrimitive(primitive);
  const node = doc.createNode().setMesh(mesh);
  const scene = doc.createScene().addChild(node);
  doc.getRoot().setDefaultScene(scene);

  const io = new NodeIO();
  return await io.writeBinary(doc);
}

function wrapGlbInB3dm(glb: Uint8Array): ArrayBuffer {
  const headerLength = 28;
  const featureTableJSON = JSON.stringify({ BATCH_LENGTH: 0 });
  const featureTableJSONByteLength = align(featureTableJSON.length, 8);
  const featureTableBinaryByteLength = 0;
  const batchTableJSONByteLength = 0;
  const batchTableBinaryByteLength = 0;
  const glbByteOffset =
    headerLength +
    featureTableJSONByteLength +
    featureTableBinaryByteLength +
    batchTableJSONByteLength +
    batchTableBinaryByteLength;
  const totalByteLength = glbByteOffset + glb.byteLength;

  const arrayBuffer = new ArrayBuffer(totalByteLength);
  const dataView = new DataView(arrayBuffer);
  const encoder = new TextEncoder();

  dataView.setUint8(0, 0x62); // 'b'
  dataView.setUint8(1, 0x33); // '3'
  dataView.setUint8(2, 0x64); // 'd'
  dataView.setUint8(3, 0x6d); // 'm'
  dataView.setUint32(4, 1, true);
  dataView.setUint32(8, totalByteLength, true);
  dataView.setUint32(12, featureTableJSONByteLength, true);
  dataView.setUint32(16, featureTableBinaryByteLength, true);
  dataView.setUint32(20, batchTableJSONByteLength, true);
  dataView.setUint32(24, batchTableBinaryByteLength, true);

  const featureTableBytes = encoder.encode(featureTableJSON);
  const featureTableArray = new Uint8Array(arrayBuffer, headerLength, featureTableJSONByteLength);
  featureTableArray.set(featureTableBytes);

  const glbArray = new Uint8Array(arrayBuffer, glbByteOffset, glb.byteLength);
  glbArray.set(glb);

  return arrayBuffer;
}

describe('meshBuilder', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(async () => {
    const { Cesium3DTileset } = await import('cesium');
    const { resolveMuniCodes, findTilesetUrl } = await import('../../src/core/catalog');

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReset();
    (Cesium3DTileset.fromUrl as unknown as MockInstance).mockReset();
    (resolveMuniCodes as unknown as MockInstance).mockReset().mockResolvedValue(['13101']);
    (findTilesetUrl as unknown as MockInstance).mockReset().mockResolvedValue('https://example.com/tileset.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extractGltfFromB3dm extracts GLB from a valid b3dm', async () => {
    const glb = await createTestGlb();
    const b3dm = wrapGlbInB3dm(glb);

    const extracted = extractGltfFromB3dm(b3dm);
    expect(extracted).not.toBeNull();
    expect(extracted?.byteLength).toBe(glb.byteLength);
  });

  it('extractGltfFromB3dm returns null for invalid magic', () => {
    const buffer = new ArrayBuffer(32);
    const extracted = extractGltfFromB3dm(buffer);
    expect(extracted).toBeNull();
  });

  it('buildBuildingMeshes resolves catalog and loads tileset', async () => {
    const glb = await createTestGlb();
    const b3dm = wrapGlbInB3dm(glb);
    const b3dmResponse = new Response(b3dm, { status: 200 });

    fetchSpy.mockResolvedValue(b3dmResponse);

    const { Cesium3DTileset } = await import('cesium');
    (Cesium3DTileset.fromUrl as unknown as MockInstance).mockResolvedValue({
      root: {
        _contentUri: 'https://example.com/buildings.b3dm',
        computedTransform: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        children: [],
      },
    });

    const { resolveMuniCodes, findTilesetUrl } = await import('../../src/core/catalog');

    const meshes = await buildBuildingMeshes(bounds, 'lod1');

    expect(resolveMuniCodes).toHaveBeenCalledWith(bounds);
    expect(findTilesetUrl).toHaveBeenCalledWith('13101', 'lod1');
    expect(Cesium3DTileset.fromUrl).toHaveBeenCalledWith('https://example.com/tileset.json');
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/buildings.b3dm');

    expect(meshes.length).toBe(1);
    expect(meshes[0].positions).toBeInstanceOf(Float32Array);
    expect(meshes[0].indices).toBeInstanceOf(Uint32Array);
    expect(meshes[0].indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('buildBuildingMeshes skips tiles outside bounds', async () => {
    const glb = await createTestGlb();
    const b3dm = wrapGlbInB3dm(glb);

    fetchSpy.mockResolvedValue(new Response(b3dm, { status: 200 }));

    const { Cesium3DTileset } = await import('cesium');
    (Cesium3DTileset.fromUrl as unknown as MockInstance).mockResolvedValue({
      root: {
        _header: {
          boundingVolume: {
            region: [0, 0, 1, 1],
          },
        },
        _contentUri: 'https://example.com/buildings.b3dm',
        computedTransform: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
        children: [],
      },
    });

    const meshes = await buildBuildingMeshes(bounds, 'lod1');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(meshes.length).toBe(0);
  });
});
