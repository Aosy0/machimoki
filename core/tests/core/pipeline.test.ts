import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrintableModel } from '../../src/core/pipeline.js';
import type { RawMesh } from '../../src/core/types';

const fakeBuffer = Buffer.from('fake-model');

vi.mock('../../src/core/terrain.js', () => ({
  buildTerrainMesh: vi.fn(),
}));

vi.mock('../../src/core/meshBuilder.js', () => ({
  buildBuildingMeshes: vi.fn(),
}));

vi.mock('../../src/core/manifoldOps.js', () => ({
  createManifoldFromMesh: vi.fn(),
  exportPartsTo3MF: vi.fn(),
  exportMeshesToSTL: vi.fn(),
  unionMeshes: vi.fn(),
}));

vi.mock('../../src/core/buildingCapper.js', () => ({
  capBuildingBottom: vi.fn((mesh: RawMesh) => mesh),
  splitConnectedComponents: vi.fn((mesh: RawMesh) => [mesh]),
  weldVertices: vi.fn((mesh: RawMesh) => mesh),
}));

const terrainMesh: RawMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

const buildingMesh: RawMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
};

function createFakeManifold(): Manifold {
  return {
    delete: vi.fn(),
    getMesh: vi.fn(() => ({
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      triVerts: new Uint32Array([0, 1, 2]),
      numProp: 3,
    })),
    status: vi.fn(() => 'NoError'),
    volume: vi.fn(() => 1),
    surfaceArea: vi.fn(() => 1),
    numTri: vi.fn(() => 1),
    numVert: vi.fn(() => 3),
    numEdge: vi.fn(() => 3),
    genus: vi.fn(() => 0),
    decompose: vi.fn(() => []),
  } as unknown as Manifold;
}

describe('buildPrintableModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('orchestrates terrain + buildings -> 3MF by default', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');

    const terrainFake = createFakeManifold();
    const buildingFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValueOnce(buildingFake).mockResolvedValueOnce(terrainFake);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    const bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 };
    const options = {
      terrainThickness: 10,
      flattenBottom: true,
      format: '3mf' as const,
    };

    const result = await buildPrintableModel(bounds, options);

    expect(buildTerrainMesh).toHaveBeenCalledWith(bounds, 10, true);
    expect(buildBuildingMeshes).toHaveBeenCalledWith(bounds, 'lod1');
    expect(createManifoldFromMesh).toHaveBeenCalledWith(terrainMesh);
    expect(createManifoldFromMesh).toHaveBeenCalledWith(buildingMesh);
    expect(exportPartsTo3MF).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(exportPartsTo3MF).mock.calls[0][0];
    expect(parts).toHaveLength(2);
    expect(parts[0].manifold).toBe(terrainFake);
    expect(parts[0].color).toBe('#ffffff');
    expect(parts[1].manifold).toBe(buildingFake);
    expect(parts[1].color).toBe('#ffffff');
    expect(result.buffer).toBe(fakeBuffer);
    expect(result.warnings).toEqual([]);
    expect(terrainFake.delete).toHaveBeenCalled();
    expect(buildingFake.delete).toHaveBeenCalled();
  });

  it('exports to STL when format is stl', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportMeshesToSTL, unionMeshes } = await import('../../src/core/manifoldOps.js');

    const buildingFake = createFakeManifold();
    const unionFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(unionMeshes).mockResolvedValue(unionFake);
    vi.mocked(exportMeshesToSTL).mockReturnValue(fakeBuffer);

    const result = await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: false, format: 'stl' },
    );

    expect(unionMeshes).toHaveBeenCalled();
    expect(exportMeshesToSTL).toHaveBeenCalled();
    expect(result.buffer).toBe(fakeBuffer);
    expect(result.warnings).toEqual([]);
  });

  it('skips terrain when includeTerrain is false', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');

    const buildingFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: false },
    );

    expect(buildTerrainMesh).not.toHaveBeenCalled();
    expect(createManifoldFromMesh).not.toHaveBeenCalledWith(terrainMesh);
    expect(exportPartsTo3MF).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(exportPartsTo3MF).mock.calls[0][0];
    expect(parts).toHaveLength(1);
    expect(parts[0].manifold).toBe(buildingFake);
  });

  it('passes custom lod to building mesh builder', async () => {
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');

    const buildingFake = createFakeManifold();

    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', lod: 'lod2', includeTerrain: false },
    );

    expect(buildBuildingMeshes).toHaveBeenCalledWith(expect.any(Object), 'lod2');
    expect(exportPartsTo3MF).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(exportPartsTo3MF).mock.calls[0][0];
    expect(parts).toHaveLength(1);
    expect(parts[0].manifold).toBe(buildingFake);
  });

  it('returns warnings for non-manifold buildings and still exports printable ones', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');

    const terrainFake = createFakeManifold();
    const buildingFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh, buildingMesh]);
    vi.mocked(createManifoldFromMesh)
      .mockResolvedValueOnce(buildingFake)
      .mockRejectedValueOnce(new Error('Not manifold'))
      .mockResolvedValueOnce(terrainFake);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    const result = await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf' },
    );

    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Building 2.1 skipped');
    expect(exportPartsTo3MF).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(exportPartsTo3MF).mock.calls[0][0];
    expect(parts).toHaveLength(2);
    expect(parts[0].manifold).toBe(terrainFake);
    expect(parts[1].manifold).toBe(buildingFake);
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
