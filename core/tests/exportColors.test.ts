import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import { assignTriangleColors } from '../src/exportColors.js';
import { exportMeshWithTriangleColorsTo3MF } from '../src/manifoldOps.js';
import { buildTerrainSlabFromSample } from '../src/terrainSample.js';
import type { RawMesh } from '../src/types.js';

const COLORS = {
  terrain: '#ffffff',
  building: '#cfcfcf',
  bridge: '#8fa3ad',
  road: '#7d7d7d',
};

/** 4x4 の平坦な地形スラブ（x/z: 0..30、厚み 5）。行は南→北、行内は西→東。 */
function createFlatTerrain(): RawMesh {
  const gridSize = 4;
  const size = 30;
  const topPositions = new Float64Array(gridSize * gridSize * 3);
  const topYValues = new Float64Array(gridSize * gridSize);
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const i = row * gridSize + col;
      topPositions[i * 3] = (col / (gridSize - 1)) * size;
      topPositions[i * 3 + 1] = 0;
      // 行 0 が南（z 最大）。地形スラブと同じ並び。
      topPositions[i * 3 + 2] = size - (row / (gridSize - 1)) * size;
      topYValues[i] = 0;
    }
  }
  return buildTerrainSlabFromSample(
    {
      bounds: { west: 0, south: 0, east: size, north: size },
      gridSize,
      reflectActualElevation: false,
      topPositions,
      topYValues,
      minTopY: 0,
    },
    5,
    true,
  );
}

/** 軸平行な箱メッシュ（12三角形）。 */
function createBoxMesh(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): RawMesh {
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    3, 2, 6, 3, 6, 7,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ]);
  return { positions, indices };
}

/** 複数メッシュを1つに結合する（インデックスは頂点オフセットで振り直す）。 */
function mergeMeshes(meshes: RawMesh[]): RawMesh {
  let positionLength = 0;
  let indexLength = 0;
  for (const mesh of meshes) {
    positionLength += mesh.positions.length;
    indexLength += mesh.indices.length;
  }
  const positions = new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (let i = 0; i < mesh.indices.length; i++) {
      indices[indexOffset + i] = mesh.indices[i] + vertexOffset;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
    vertexOffset += mesh.positions.length / 3;
  }
  return { positions, indices };
}

/** 道路・橋梁として使う、XZ 平面上の範囲だけを持つ薄いメッシュ。 */
function createFootprintMesh(z0: number, z1: number, x0: number, x1: number): RawMesh {
  return createBoxMesh(x0, x1, 0, 0, z0, z1);
}

/** 3MF(ZIP) から 3D/3dmodel.model の XML を取り出す。 */
function readModelXml(buffer: Uint8Array): string {
  const files = unzipSync(buffer);
  const model = files['3D/3dmodel.model'];
  expect(model).toBeDefined();
  return strFromU8(model);
}

function createTriangleMesh(): RawMesh {
  return {
    positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

describe('assignTriangleColors', () => {
  it('地表の道路範囲・建物・地形を色分けし、パレットを使用順に詰める', () => {
    const terrain = createFlatTerrain();
    const building = createBoxMesh(22, 27, 0, 4, 5, 10);
    const mesh = mergeMeshes([terrain, building]);

    const result = assignTriangleColors({
      mesh,
      terrainMesh: terrain,
      bridgeMeshes: [],
      roadMeshes: [createFootprintMesh(1, 29, 1, 21)],
      scale: 1,
      colors: COLORS,
    });

    // 地形スラブ 60三角形（上面18・底面18・側面24）＋箱 12三角形。
    expect(mesh.indices.length / 3).toBe(72);
    // 上面・底面は 3行×2列×2 = 12 ずつ道路、残りは地形。
    // 側面24 + 箱底面2 + 道路外の上面/底面6+6 が地形、箱の側面8＋上面2が建物。
    expect(result.counts).toEqual({ terrain: 38, building: 10, bridge: 0, road: 24 });
    // bridge は未使用なので palette に含めない（[terrain, building, bridge, road] 順）。
    expect(result.palette).toEqual([COLORS.terrain, COLORS.building, COLORS.road]);
    expect(result.perTriangle.length).toBe(72);
    expect([...new Set(result.perTriangle)].sort()).toEqual([0, 1, 2]);
  });

  it('地表より上の三角形が橋梁フットプリント内なら橋梁色にする', () => {
    const terrain = createFlatTerrain();
    const bridge = createBoxMesh(5, 15, 3, 6, 5, 25);
    const mesh = mergeMeshes([terrain, bridge]);

    const result = assignTriangleColors({
      mesh,
      terrainMesh: terrain,
      bridgeMeshes: [bridge],
      roadMeshes: [],
      scale: 1,
      colors: COLORS,
    });

    // 地形スラブは地表以下なのですべて地形色、橋梁の12三角形が橋梁色。
    expect(result.counts).toEqual({ terrain: 60, building: 0, bridge: 12, road: 0 });
    expect(result.palette).toEqual([COLORS.terrain, COLORS.bridge]);
  });

  it('地形がなければ bridge / building だけで、道路は色分けしない', () => {
    const building = createBoxMesh(0, 5, 0, 5, 0, 5);
    const bridge = createBoxMesh(10, 15, 0, 5, 10, 15);
    const mesh = mergeMeshes([building, bridge]);

    const result = assignTriangleColors({
      mesh,
      terrainMesh: null,
      bridgeMeshes: [bridge],
      roadMeshes: [createFootprintMesh(0, 20, 0, 20)],
      scale: 1,
      colors: COLORS,
    });

    expect(result.counts).toEqual({ terrain: 0, building: 12, bridge: 12, road: 0 });
    expect(result.palette).toEqual([COLORS.building, COLORS.bridge]);
  });

  it('同じ色の種別は1つのパレット色にまとめる', () => {
    const terrain = createFlatTerrain();
    const mesh = mergeMeshes([terrain, createBoxMesh(22, 27, 0, 4, 5, 10)]);

    const result = assignTriangleColors({
      mesh,
      terrainMesh: terrain,
      roadMeshes: [createFootprintMesh(1, 29, 1, 21)],
      scale: 1,
      colors: { ...COLORS, road: COLORS.terrain },
    });

    // 道路色と地形色が同じなのでパレットは地形色1つに畳まれる。
    expect(result.palette).toEqual([COLORS.terrain, COLORS.building]);
    expect(result.counts.road).toBe(24);
    expect(result.counts.terrain).toBe(38);
    expect(result.perTriangle[0]).toBe(0);
  });

  it('色を割り当てても入力メッシュの頂点・インデックスを変更しない', () => {
    const terrain = createFlatTerrain();
    const mesh = mergeMeshes([terrain, createBoxMesh(22, 27, 0, 4, 5, 10)]);
    const positionsBefore = Array.from(mesh.positions);
    const indicesBefore = Array.from(mesh.indices);
    const positionsRef = mesh.positions;

    assignTriangleColors({
      mesh,
      terrainMesh: terrain,
      bridgeMeshes: [],
      roadMeshes: [createFootprintMesh(1, 29, 1, 21)],
      scale: 0.001,
      colors: COLORS,
    });

    expect(mesh.positions).toBe(positionsRef);
    expect(Array.from(mesh.positions)).toEqual(positionsBefore);
    expect(Array.from(mesh.indices)).toEqual(indicesBefore);
  });

  it('三角形がなければ空の結果を返す', () => {
    const mesh: RawMesh = { positions: new Float32Array(), indices: new Uint32Array() };
    const result = assignTriangleColors({
      mesh,
      terrainMesh: null,
      scale: 1,
      colors: COLORS,
    });

    expect(result.perTriangle.length).toBe(0);
    expect(result.palette).toEqual([]);
    expect(result.counts).toEqual({ terrain: 0, building: 0, bridge: 0, road: 0 });
  });
});

describe('exportMeshWithTriangleColorsTo3MF', () => {
  it('パレットを colorgroup に書き、三角形ごとに pid/p1 を付ける', () => {
    const mesh = createTriangleMesh();
    const buffer = exportMeshWithTriangleColorsTo3MF(
      mesh,
      { palette: ['#ffffff', '#cfcfcf', '#7d7d7d'], perTriangle: new Uint8Array([1]) },
      'y-up',
    );
    const xml = readModelXml(buffer);

    expect(xml).toContain(
      'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"',
    );
    expect(xml).toContain('<m:colorgroup id="1">');
    expect(xml).toContain('<m:color color="#FFFFFFFF"/>');
    expect(xml).toContain('<m:color color="#CFCFCFFF"/>');
    expect(xml).toContain('<m:color color="#7D7D7DFF"/>');
    expect(xml).toContain('<object id="1" type="model" pid="1" pindex="0">');
    expect(xml).toMatch(/<triangle v1="0" v2="1" v3="2" pid="1" p1="1" \/>/);
    expect(xml).toContain('<item objectid="1" />');
    // y-up のままメートル→mm（×1000）し、7桁精度で書く。
    expect(xml).toContain('<vertex x="1000.000" y="2000.000" z="3000.000" />');
    // colorgroup は object より前（参照より先に定義する）。
    expect(xml.indexOf('<m:colorgroup')).toBeLessThan(xml.indexOf('<object'));
  });

  it('z-up では既存出力と同じ変換を適用する', () => {
    const xml = readModelXml(
      exportMeshWithTriangleColorsTo3MF(
        createTriangleMesh(),
        { palette: ['#ffffff'], perTriangle: new Uint8Array([0]) },
        'z-up',
      ),
    );

    expect(xml).toContain('<vertex x="1000.000" y="-3000.000" z="2000.000" />');
  });

  it('白1色だけなら material 拡張も pid/p1 も出さない', () => {
    const xml = readModelXml(
      exportMeshWithTriangleColorsTo3MF(
        createTriangleMesh(),
        { palette: ['#ffffff'], perTriangle: new Uint8Array([0]) },
        'y-up',
      ),
    );

    expect(xml).not.toContain('xmlns:m=');
    expect(xml).not.toContain('<m:');
    expect(xml).not.toContain('pid=');
    expect(xml).not.toContain('p1=');
    expect(xml).toContain('<object id="1" type="model">');
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2" />');
  });

  it('正規化して重複色をまとめ、三角形の添字も振り直す', () => {
    const mesh: RawMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2, 0, 2, 3]),
    };
    const xml = readModelXml(
      exportMeshWithTriangleColorsTo3MF(
        mesh,
        { palette: ['#ffffff', '#FFFFFF', '#cfcfcf'], perTriangle: new Uint8Array([1, 2, 0]) },
        'y-up',
      ),
    );

    // #ffffff と #FFFFFF は同じ #FFFFFFFF に畳まれ、colorgroup は2色になる。
    expect(xml.match(/<m:color /g)).toHaveLength(2);
    expect(xml).toContain('<m:color color="#CFCFCFFF"/>');
    expect(xml).toContain('<triangle v1="0" v2="1" v3="2" pid="1" p1="0" />');
    expect(xml).toContain('<triangle v1="1" v2="3" v3="2" pid="1" p1="1" />');
    expect(xml).toContain('<triangle v1="0" v2="2" v3="3" pid="1" p1="0" />');
  });

  it('metadata を resources より前に書く', () => {
    const xml = readModelXml(
      exportMeshWithTriangleColorsTo3MF(
        createTriangleMesh(),
        { palette: ['#cfcfcf'], perTriangle: new Uint8Array([0]) },
        'y-up',
        { Description: 'A & B <tag>' },
      ),
    );

    expect(xml).toContain('<metadata name="Description">A &amp; B &lt;tag&gt;</metadata>');
    expect(xml.indexOf('<metadata')).toBeLessThan(xml.indexOf('<resources>'));
    expect(xml).toContain('<metadata name="Title">Machimoki model</metadata>');
  });

  it('三角形数と perTriangle の長さが違えば例外にする', () => {
    const mesh = createTriangleMesh();
    expect(() =>
      exportMeshWithTriangleColorsTo3MF(
        mesh,
        { palette: ['#ffffff'], perTriangle: new Uint8Array([0, 1]) },
        'y-up',
      ),
    ).toThrow(/perTriangle/);
  });
});
