import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import type { Bounds } from '../src/types';

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

interface CatalogDatasetOverrides {
  [key: string]: unknown;
}

function catalogDataset(overrides: CatalogDatasetOverrides = {}): Record<string, unknown> {
  return {
    id: '1',
    name: '東京都千代田区橋梁モデル',
    pref: '東京都',
    pref_code: '13',
    city: '千代田区',
    city_code: '13101',
    ward: null,
    ward_code: null,
    type: '橋梁モデル',
    type_en: 'bridge',
    url: 'https://example.com/brid/lod1/tileset.json',
    format: '3D Tiles',
    lod: '1',
    texture: false,
    ...overrides,
  };
}

function catalogResponse(datasets: unknown[]): Response {
  return new Response(JSON.stringify({ datasets }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('catalog のレイヤー API', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;

  beforeEach(() => {
    vi.doUnmock('../src/catalog');
    vi.resetModules();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getMuniAvailableLayerLods は自治体・レイヤー・3D Tiles に一致する LOD だけを返す', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({ id: 'lod3', lod: '3', url: 'https://example.com/brid/lod3/tileset.json' }),
        catalogDataset({
          id: 'ward-match',
          lod: '1',
          city_code: '13100',
          ward_code: '13101',
          url: 'https://example.com/brid/ward/lod1/tileset.json',
        }),
        catalogDataset({ id: 'other-city', city_code: '13102', lod: '2' }),
        catalogDataset({ id: 'building', type: '建築物モデル', lod: '4' }),
        catalogDataset({ id: 'citygml', format: 'CityGML', lod: '4' }),
        catalogDataset({ id: 'other-pref', pref_code: '11', city_code: '13101' }),
      ]),
    );

    const { getMuniAvailableLayerLods } = await import('../src/catalog');
    const lods = await getMuniAvailableLayerLods('13101', 'brid');

    expect(lods).toEqual(['lod1', 'lod3']);
  });

  it('getMuniAvailableLayerLods は tran を交通（道路）モデルで判定する', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({ id: 'brid', type: '橋梁モデル', lod: '4' }),
        catalogDataset({
          id: 'tran',
          type: '交通（道路）モデル',
          type_en: 'transport',
          lod: '2',
          url: 'https://example.com/tran/lod2/tileset.json',
        }),
      ]),
    );

    const { getMuniAvailableLayerLods } = await import('../src/catalog');
    const lods = await getMuniAvailableLayerLods('13101', 'tran');

    expect(lods).toEqual(['lod2']);
  });

  it('getMuniAvailableLayerLods は未整備なら空配列を返す', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([catalogDataset({ type: '建築物モデル', lod: '1' })]),
    );

    const { getMuniAvailableLayerLods } = await import('../src/catalog');
    const lods = await getMuniAvailableLayerLods('13101', 'brid');

    expect(lods).toEqual([]);
  });

  it('findLayerTilesetUrl は要求 LOD の URL と actualLod を返す', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({
          id: 'lod1',
          lod: '1',
          url: 'https://example.com/brid/lod1/tileset.json',
        }),
        catalogDataset({
          id: 'lod2',
          lod: '2',
          url: 'https://example.com/brid/lod2/tileset.json',
        }),
      ]),
    );

    const { findLayerTilesetUrl } = await import('../src/catalog');
    const result = await findLayerTilesetUrl('13101', 'brid', 'lod2');

    expect(result).toEqual({
      url: 'https://example.com/brid/lod2/tileset.json',
      actualLod: 'lod2',
    });
  });

  it('findLayerTilesetUrl は要求 LOD が無ければ最も詳細な LOD へフォールバックする', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({
          id: 'lod1',
          lod: '1',
          url: 'https://example.com/brid/lod1/tileset.json',
        }),
        catalogDataset({
          id: 'lod2',
          lod: '2',
          url: 'https://example.com/brid/lod2/tileset.json',
        }),
      ]),
    );

    const { findLayerTilesetUrl } = await import('../src/catalog');
    const result = await findLayerTilesetUrl('13101', 'brid', 'lod4');

    expect(result).toEqual({
      url: 'https://example.com/brid/lod2/tileset.json',
      actualLod: 'lod2',
    });
  });

  it('findLayerTilesetUrl は未整備なら null を返す', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([catalogDataset({ type: '建築物モデル', lod: '1' })]),
    );

    const { findLayerTilesetUrl } = await import('../src/catalog');
    const result = await findLayerTilesetUrl('13101', 'tran', 'lod1');

    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('findLayerTilesetUrl は texture:false のデータセットを優先する', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({
          id: 'textured',
          lod: '2',
          texture: true,
          url: 'https://example.com/brid/lod2-textured/tileset.json',
        }),
        catalogDataset({
          id: 'plain',
          lod: '2',
          texture: false,
          url: 'https://example.com/brid/lod2-plain/tileset.json',
        }),
      ]),
    );

    const { findLayerTilesetUrl } = await import('../src/catalog');
    const result = await findLayerTilesetUrl('13101', 'brid', 'lod2');

    expect(result?.url).toBe('https://example.com/brid/lod2-plain/tileset.json');
  });

  it('findLayerTilesetUrl はカタログ取得をキャッシュする', async () => {
    fetchSpy.mockResolvedValueOnce(
      catalogResponse([
        catalogDataset({
          id: 'lod3',
          lod: '3',
          url: 'https://example.com/brid/lod3/tileset.json',
        }),
      ]),
    );

    const { findLayerTilesetUrl } = await import('../src/catalog');
    const first = await findLayerTilesetUrl('13101', 'brid', 'lod3');
    const second = await findLayerTilesetUrl('13101', 'brid', 'lod3');

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

const bounds: Bounds = {
  west: 139.69,
  south: 35.69,
  east: 139.7,
  north: 35.7,
};

const identityElements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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
  const glbByteOffset = headerLength + featureTableJSONByteLength;
  const totalByteLength = glbByteOffset + glb.byteLength;

  const arrayBuffer = new ArrayBuffer(totalByteLength);
  const dataView = new DataView(arrayBuffer);
  const encoder = new TextEncoder();

  dataView.setUint8(0, 0x62);
  dataView.setUint8(1, 0x33);
  dataView.setUint8(2, 0x64);
  dataView.setUint8(3, 0x6d);
  dataView.setUint32(4, 1, true);
  dataView.setUint32(8, totalByteLength, true);
  dataView.setUint32(12, featureTableJSONByteLength, true);
  dataView.setUint32(16, 0, true);
  dataView.setUint32(20, 0, true);
  dataView.setUint32(24, 0, true);

  new Uint8Array(arrayBuffer, headerLength, featureTableJSONByteLength).set(
    encoder.encode(featureTableJSON),
  );
  new Uint8Array(arrayBuffer, glbByteOffset, glb.byteLength).set(glb);

  return arrayBuffer;
}

describe('buildLayerMeshes', () => {
  let fetchSpy: MockInstance<typeof globalThis.fetch>;
  let buildLayerMeshes: typeof import('../src/meshBuilder').buildLayerMeshes;
  let findLayerTilesetUrl: MockInstance;
  let resolveMuniCodes: MockInstance;
  let fromUrl: MockInstance;

  const layerTilesetUrl = 'https://example.com/brid/tileset.json';

  beforeEach(async () => {
    vi.resetModules();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockReset();

    vi.doMock('../src/catalog', () => ({
      resolveMuniCode: vi.fn(),
      resolveMuniCodes: vi.fn(),
      findTilesetUrl: vi.fn(),
      findBestTilesetUrl: vi.fn(),
      getMuniAvailableLods: vi.fn(),
      getMuniAvailableLayerLods: vi.fn(),
      findLayerTilesetUrl: vi.fn(),
    }));

    const cesium = await import('cesium');
    fromUrl = cesium.Cesium3DTileset.fromUrl as unknown as MockInstance;
    fromUrl.mockReset();

    const catalog = await import('../src/catalog');
    findLayerTilesetUrl = catalog.findLayerTilesetUrl as unknown as MockInstance;
    findLayerTilesetUrl.mockReset().mockResolvedValue({
      url: layerTilesetUrl,
      actualLod: 'lod3',
    });
    resolveMuniCodes = catalog.resolveMuniCodes as unknown as MockInstance;
    resolveMuniCodes.mockReset().mockResolvedValue(['13101']);

    ({ buildLayerMeshes } = await import('../src/meshBuilder'));
  });

  afterEach(() => {
    vi.doUnmock('../src/catalog');
    vi.restoreAllMocks();
  });

  it('レイヤー未整備なら空配列を返す', async () => {
    findLayerTilesetUrl.mockResolvedValue(null);

    const meshes = await buildLayerMeshes(bounds, 'brid');

    expect(resolveMuniCodes).toHaveBeenCalledWith(bounds);
    expect(findLayerTilesetUrl).toHaveBeenCalledWith('13101', 'brid', 'lod3');
    expect(fromUrl).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(meshes).toEqual([]);
  });

  it('指定 LOD で tileset を読み、範囲内タイルのメッシュを返す', async () => {
    findLayerTilesetUrl.mockResolvedValue({ url: layerTilesetUrl, actualLod: 'lod2' });
    const glb = await createTestGlb();
    fetchSpy.mockResolvedValue(new Response(wrapGlbInB3dm(glb), { status: 200 }));
    fromUrl.mockResolvedValue({
      root: {
        _contentUri: 'https://example.com/brid/tile.b3dm',
        computedTransform: { elements: identityElements },
        children: [],
      },
      modelMatrix: { elements: identityElements },
    });

    const meshes = await buildLayerMeshes(bounds, 'brid', { lod: 'lod2' });

    expect(findLayerTilesetUrl).toHaveBeenCalledWith('13101', 'brid', 'lod2');
    expect(fromUrl).toHaveBeenCalledWith(layerTilesetUrl);
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/brid/tile.b3dm');
    expect(meshes.length).toBe(1);
    expect(meshes[0].positions).toBeInstanceOf(Float32Array);
    expect(meshes[0].indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('範囲外のタイルは取得しない', async () => {
    fromUrl.mockResolvedValue({
      root: {
        _header: { boundingVolume: { region: [0, 0, 1, 1] } },
        _contentUri: 'https://example.com/brid/tile.b3dm',
        computedTransform: { elements: identityElements },
        children: [],
      },
    });

    const meshes = await buildLayerMeshes(bounds, 'brid');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(meshes).toEqual([]);
  });

  it('LOD がフォールバックされたら警告して取得する', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findLayerTilesetUrl.mockResolvedValue({ url: layerTilesetUrl, actualLod: 'lod2' });
    fromUrl.mockResolvedValue({ root: { children: [] } });

    const meshes = await buildLayerMeshes(bounds, 'tran', { lod: 'lod4' });

    expect(findLayerTilesetUrl).toHaveBeenCalledWith('13101', 'tran', 'lod4');
    expect(fromUrl).toHaveBeenCalledWith(layerTilesetUrl);
    expect(meshes).toEqual([]);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('muniCode=13101 のレイヤー tran は lod4 未整備のため lod2 で取得します'),
      ),
    ).toBe(true);
  });
});
