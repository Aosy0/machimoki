import { describe, it, expect } from 'vitest';
import { alignFlatTerrainToBuildings } from '../src/pipelineUtils.js';
import type { RawMesh } from '../src/types.js';

function createFlatTerrainMesh(y: number, topCount = 4): RawMesh {
  const totalVerts = topCount * 2;
  const positions = new Float32Array(totalVerts * 3);
  const gridSize = Math.sqrt(topCount);
  const isGrid = Number.isInteger(gridSize) && gridSize * gridSize === topCount;
  if (isGrid && gridSize === 2) {
    const coords = [[0,0],[1,0],[0,1],[1,1]];
    for (let i = 0; i < topCount; i++) {
      positions[i * 3] = coords[i][0];
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = coords[i][1];
    }
  } else {
    for (let i = 0; i < topCount; i++) {
      positions[i * 3] = i;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = i;
    }
  }
  for (let i = topCount; i < totalVerts; i++) {
    positions[i * 3] = positions[(i - topCount) * 3];
    positions[i * 3 + 1] = y - 10;
    positions[i * 3 + 2] = positions[(i - topCount) * 3 + 2];
  }
  const indices = new Uint32Array([0, 1, 2]);
  return { positions, indices };
}

// Helper: 建物メッシュを作成 (minY を持つ)
function createBuildingMesh(minY: number): RawMesh {
  // 2頂点: minY と minY+10
  const positions = new Float32Array([
    0, minY, 0,
    1, minY + 10, 1,
    2, minY + 5, 2,
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  return { positions, indices };
}

describe('alignFlatTerrainToBuildings', () => {
  it('flat y=0 + building minY=59 => 地形は不変、建物底面は -0.3（地形より0.3沈み）', () => {
    const terrain = createFlatTerrainMesh(0);
    const building = createBuildingMesh(59);
    alignFlatTerrainToBuildings(terrain, [building]);
    expect(terrain.positions[1]).toBeCloseTo(0);
    expect(terrain.positions[4]).toBeCloseTo(0);
    expect(terrain.positions[13]).toBeCloseTo(-10);
    expect(building.positions[1]).toBeCloseTo(-0.3);
    expect(building.positions[4]).toBeCloseTo(9.7);
    expect(building.positions[7]).toBeCloseTo(4.7);
  });

  it('flat y=30 + building minY=30 => 地形は不変、建物底面は 29.7', () => {
    const terrain = createFlatTerrainMesh(30);
    const building = createBuildingMesh(30);
    alignFlatTerrainToBuildings(terrain, [building]);
    expect(terrain.positions[1]).toBeCloseTo(30);
    expect(building.positions[1]).toBeCloseTo(29.7);
  });

  it('non-flat terrain ではフットプリント直下の最低地形高さに合わせて建物をシフト', () => {
    const terrain = createFlatTerrainMesh(0);
    terrain.positions[1] = 0;
    terrain.positions[4] = 10;
    terrain.positions[7] = 0;
    terrain.positions[10] = 10;
    const building = createBuildingMesh(59);
    alignFlatTerrainToBuildings(terrain, [building]);
    expect(terrain.positions[1]).toBeCloseTo(0);
    expect(terrain.positions[13]).toBeCloseTo(-10);
    expect(building.positions[1]).toBeCloseTo(-0.3);
  });

  // d) Empty buildingMeshes => no shift
  it('buildingMeshesが空ならシフトしない', () => {
    const terrain = createFlatTerrainMesh(5);
    const before = Float32Array.from(terrain.positions);
    alignFlatTerrainToBuildings(terrain, []);
    expect(terrain.positions[1]).toBeCloseTo(before[1]);
    expect(terrain.positions[4]).toBeCloseTo(before[4]);
  });

  // e) terrainMesh null => no shift (例外なしで early return)
  it('terrainMeshがnullなら例外なく early return', () => {
    const building = createBuildingMesh(10);
    expect(() => {
      alignFlatTerrainToBuildings(null, [building]);
    }).not.toThrow();
  });
});
