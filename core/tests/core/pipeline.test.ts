import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrintableModel } from '../../src/core/pipeline.js';
import type { RawMesh } from '../../src/core/types.js';

const fakeBuffer = Buffer.from('fake-model');

const fakeManifold = {
  delete: vi.fn(),
};

vi.mock('../../src/core/terrain.js', () => ({
  buildTerrainMesh: vi.fn(),
}));

vi.mock('../../src/core/meshBuilder.js', () => ({
  buildBuildingMeshes: vi.fn(),
}));

vi.mock('../../src/core/manifoldOps.js', () => ({
  unionMeshes: vi.fn(),
  exportTo3MF: vi.fn(),
  exportToSTL: vi.fn(),
}));

const terrainMesh: RawMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const buildingMesh: RawMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('buildPrintableModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('orchestrates terrain + buildings -> 3MF by default', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { unionMeshes, exportTo3MF } = await import('../../src/core/manifoldOps.js');

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(unionMeshes).mockResolvedValue(fakeManifold as unknown as Awaited<ReturnType<typeof unionMeshes>>);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    const bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 };
    const options = {
      terrainThickness: 10,
      flattenBottom: true,
      format: '3mf' as const,
    };

    const result = await buildPrintableModel(bounds, options);

    expect(buildTerrainMesh).toHaveBeenCalledWith(bounds, 10, true);
    expect(buildBuildingMeshes).toHaveBeenCalledWith(bounds, 'lod1');
    expect(unionMeshes).toHaveBeenCalledWith([terrainMesh, buildingMesh]);
    expect(exportTo3MF).toHaveBeenCalledWith(fakeManifold);
    expect(result).toBe(fakeBuffer);
    expect(fakeManifold.delete).toHaveBeenCalled();
  });

  it('exports to STL when format is stl', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { unionMeshes, exportToSTL } = await import('../../src/core/manifoldOps.js');

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(unionMeshes).mockResolvedValue(fakeManifold as unknown as Awaited<ReturnType<typeof unionMeshes>>);
    vi.mocked(exportToSTL).mockReturnValue(fakeBuffer);

    const result = await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: false, format: 'stl' },
    );

    expect(exportToSTL).toHaveBeenCalledWith(fakeManifold);
    expect(result).toBe(fakeBuffer);
  });

  it('skips terrain when includeTerrain is false', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { unionMeshes, exportTo3MF } = await import('../../src/core/manifoldOps.js');

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(unionMeshes).mockResolvedValue(fakeManifold as unknown as Awaited<ReturnType<typeof unionMeshes>>);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: false },
    );

    expect(buildTerrainMesh).not.toHaveBeenCalled();
    expect(unionMeshes).toHaveBeenCalledWith([buildingMesh]);
  });

  it('passes custom lod to building mesh builder', async () => {
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { unionMeshes, exportTo3MF } = await import('../../src/core/manifoldOps.js');

    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(unionMeshes).mockResolvedValue(fakeManifold as unknown as Awaited<ReturnType<typeof unionMeshes>>);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', lod: 'lod2', includeTerrain: false },
    );

    expect(buildBuildingMeshes).toHaveBeenCalledWith(expect.any(Object), 'lod2');
  });

  it('throws a descriptive error when no meshes are produced', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');

    vi.mocked(buildTerrainMesh).mockRejectedValue(new Error('terrain failed'));
    vi.mocked(buildBuildingMeshes).mockResolvedValue([]);

    await expect(
      buildPrintableModel(
        { west: 0, south: 0, east: 1, north: 1 },
        { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: true },
      ),
    ).rejects.toThrow('Failed to build printable model');
  });
});
