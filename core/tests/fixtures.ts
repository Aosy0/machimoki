import { getManifoldModule } from 'manifold-3d/lib/wasm.js';
import { buildSlabIndices } from '../src/pipelineCore.js';
import { RawMesh } from '../src/types.js';

export function createCubeMesh(): RawMesh {
  const positions = new Float32Array([
    0, 0, 0, // 0
    1, 0, 0, // 1
    1, 1, 0, // 2
    0, 1, 0, // 3
    0, 0, 1, // 4
    1, 0, 1, // 5
    1, 1, 1, // 6
    0, 1, 1, // 7
  ]);

  const indices = new Uint32Array([
    // Front
    4, 5, 6,
    4, 6, 7,
    // Back
    0, 2, 1,
    0, 3, 2,
    // Left
    0, 7, 3,
    0, 4, 7,
    // Right
    1, 2, 6,
    1, 6, 5,
    // Top
    3, 6, 2,
    3, 7, 6,
    // Bottom
    0, 1, 5,
    0, 5, 4,
  ]);

  return { positions, indices };
}

/**
 * 地形スラブ（buildTerrainMesh と同じ 2·n² 頂点レイアウト: 地表グリッド→底面グリッド）。
 */
export function createTerrainSlab(
  n: number,
  size: number,
  topY: number,
  bottomY: number,
): RawMesh {
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      positions.push(-size / 2 + (size * j) / (n - 1), topY, size / 2 - (size * i) / (n - 1));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      positions.push(-size / 2 + (size * j) / (n - 1), bottomY, size / 2 - (size * i) / (n - 1));
    }
  }
  return { positions: new Float32Array(positions), indices: buildSlabIndices(n) };
}

/**
 * 閉じた箱の建物（PLATEAU LOD1 相当）。底面2頂点を 1e-4 浮かせて
 * capBuildingBottom の厳密底面検出（1e-6）を避け、実データのノイズを模す。
 */
export async function createBoxBuilding(
  cx: number,
  cz: number,
  sizeX: number,
  sizeZ: number,
  yMin: number,
  yMax: number,
): Promise<RawMesh> {
  const wasm: any = await getManifoldModule();
  const mesh = wasm.Manifold.cube([sizeX, yMax - yMin, sizeZ])
    .translate([cx - sizeX / 2, yMin, cz - sizeZ / 2])
    .getMesh();
  const positions = new Float32Array(mesh.vertProperties);
  const indices = new Uint32Array(mesh.triVerts);

  let minY = Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i];
  }
  let raised = 0;
  for (let i = 1; i < positions.length && raised < 2; i += 3) {
    if (positions[i] === minY) {
      positions[i] += 1e-4;
      raised++;
    }
  }
  return { positions, indices };
}


