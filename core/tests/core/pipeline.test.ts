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

  it('scale=2 doubles mesh dimensions (volume ≈ 8x for unit cube)', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');
    const { capBuildingBottom } = await import('../../src/core/buildingCapper.js');

    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(capBuildingBottom).mockImplementation((mesh: RawMesh) => mesh);

    let capturedMesh: RawMesh | null = null;
    vi.mocked(createManifoldFromMesh).mockImplementation(async (mesh: RawMesh) => {
      capturedMesh = mesh;
      return createFakeManifold();
    });
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: false, scale: 2 },
    );

    expect(capturedMesh).not.toBeNull();
    const positions = capturedMesh!.positions;
    expect(positions[0]).toBeCloseTo(0);
    expect(positions[1]).toBeCloseTo(0);
    expect(positions[2]).toBeCloseTo(0);
    expect(positions[3]).toBeCloseTo(2);
    expect(positions[4]).toBeCloseTo(0);
    expect(positions[5]).toBeCloseTo(0);
    expect(positions[6]).toBeCloseTo(0);
    expect(positions[7]).toBeCloseTo(0);
    expect(positions[8]).toBeCloseTo(2);
  });

  it('scale=1 is a no-op (no new allocations)', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');
    const { capBuildingBottom } = await import('../../src/core/buildingCapper.js');

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(capBuildingBottom).mockImplementation((mesh: RawMesh) => mesh);

    let capturedBuildingMesh: RawMesh | null = null;
    let capturedTerrainMesh: RawMesh | null = null;
    vi.mocked(createManifoldFromMesh).mockImplementation(async (mesh: RawMesh) => {
      if (!capturedBuildingMesh) {
        capturedBuildingMesh = mesh;
      } else {
        capturedTerrainMesh = mesh;
      }
      return createFakeManifold();
    });
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', scale: 1 },
    );

    expect(capturedBuildingMesh).toBe(buildingMesh);
    expect(capturedTerrainMesh).toBe(terrainMesh);
  });

  it('excludes buildings straddling bounds when includeSpanningBuildings is false', async () => {
    const { buildTerrainMesh } = await import('../../src/core/terrain.js');
    const { buildBuildingMeshes } = await import('../../src/core/meshBuilder.js');
    const { createManifoldFromMesh, exportPartsTo3MF } = await import('../../src/core/manifoldOps.js');

    // bounds {west:-1, south:-1, east:1, north:1} → engine coords:
    // centerLon=0, centerLat=0, mPerDegLon=111320, mPerDegLat=111320
    // minX=-111320, maxX=111320, minZ=-111320, maxZ=111320
    //
    // A mesh spanning x from -120000 to 0 straddles the minX boundary:
    // - With includeSpanning=true (default): intersects → included
    // - With includeSpanning=false: not fully inside → excluded
    const straddlingMesh: RawMesh = {
      positions: new Float32Array([
        -120000, 0, -100,
        0, 0, -100,
        0, 0, 100,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    };

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([straddlingMesh]);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);

    // Default (includeSpanningBuildings omitted → false): building EXCLUDED, only terrain remains
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());
    await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf' },
    );
    // createManifoldFromMesh called only for terrain = 1 call
    expect(createManifoldFromMesh).toHaveBeenCalledTimes(1);
    expect(createManifoldFromMesh).toHaveBeenCalledWith(terrainMesh);

    vi.clearAllMocks();
    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([straddlingMesh]);
    vi.mocked(exportPartsTo3MF).mockResolvedValue(fakeBuffer);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());

    // includeSpanningBuildings=true: building IS included
    await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeSpanningBuildings: true },
    );
    // createManifoldFromMesh called for building + terrain = 2 calls
    expect(createManifoldFromMesh).toHaveBeenCalledTimes(2);
  });
});
