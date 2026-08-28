import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrintableModel, componentContainsPoint, dedupeComponents } from '../src/pipeline.js';
import type { RawMesh } from '../src/types';

const fakeBuffer = new TextEncoder().encode('fake-model');

vi.mock('../src/terrain.js', () => ({
  buildTerrainMesh: vi.fn(),
}));

vi.mock('../src/meshBuilder.js', () => ({
  buildBuildingMeshes: vi.fn(),
}));

vi.mock('../src/manifoldOps.js', () => ({
  createManifoldFromMesh: vi.fn(),
  exportTo3MF: vi.fn(),
  exportMeshesToSTL: vi.fn(),
  unionMeshes: vi.fn(),
}));

vi.mock('../src/buildingCapper.js', () => ({
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
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const buildingFake = createFakeManifold();
    const unionFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(unionMeshes).mockResolvedValue(unionFake);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    const bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 };
    const options = {
      terrainThickness: 10,
      flattenBottom: true,
      format: '3mf' as const,
    };

    const result = await buildPrintableModel(bounds, options);

    expect(buildTerrainMesh).toHaveBeenCalledWith(bounds, 10, true);
    expect(buildBuildingMeshes).toHaveBeenCalledWith(bounds, 'lod1', undefined);
    expect(createManifoldFromMesh).toHaveBeenCalledWith(buildingMesh);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    const unionMeshesArg = vi.mocked(unionMeshes).mock.calls[0][0];
    expect(unionMeshesArg).toHaveLength(2);
    expect(unionMeshesArg[0]).toBe(terrainMesh);
    expect(unionMeshesArg[1]).toEqual({
      positions: buildingFake.getMesh().vertProperties,
      indices: buildingFake.getMesh().triVerts,
    });
    expect(exportTo3MF).toHaveBeenCalledTimes(1);
    expect(exportTo3MF).toHaveBeenCalledWith(unionFake, '#ffffff', 'z-up');
    expect(result.buffer).toBe(fakeBuffer);
    expect(result.warnings).toEqual([]);
    expect(unionFake.delete).toHaveBeenCalled();
    expect(buildingFake.delete).toHaveBeenCalled();
  });

  it('exports to STL when format is stl', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportMeshesToSTL, unionMeshes } = await import('../src/manifoldOps.js');

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
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const buildingFake = createFakeManifold();
    const unionFake = createFakeManifold();

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(unionMeshes).mockResolvedValue(unionFake);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: false },
    );

    expect(buildTerrainMesh).not.toHaveBeenCalled();
    expect(createManifoldFromMesh).not.toHaveBeenCalledWith(terrainMesh);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    const unionMeshesArg = vi.mocked(unionMeshes).mock.calls[0][0];
    expect(unionMeshesArg).toHaveLength(1);
    expect(unionMeshesArg[0]).toEqual({
      positions: buildingFake.getMesh().vertProperties,
      indices: buildingFake.getMesh().triVerts,
    });
    expect(exportTo3MF).toHaveBeenCalledTimes(1);
  });

  it('passes custom lod to building mesh builder', async () => {
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const buildingFake = createFakeManifold();
    const unionFake = createFakeManifold();

    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(buildingFake);
    vi.mocked(unionMeshes).mockResolvedValue(unionFake);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', lod: 'lod2', includeTerrain: false },
    );

    expect(buildBuildingMeshes).toHaveBeenCalledWith(expect.any(Object), 'lod2', undefined);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    expect(exportTo3MF).toHaveBeenCalledTimes(1);
  });

  it('returns warnings for non-manifold buildings and still exports printable ones', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const buildingFake = createFakeManifold();
    const unionFake = createFakeManifold();

    // 2 distinct footprints so dedupeComponents keeps both
    const secondBuilding: RawMesh = {
      positions: new Float32Array([10, 0, 10, 11, 0, 10, 10, 0, 11]),
      indices: new Uint32Array([0, 1, 2]),
    };

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh, secondBuilding]);
    vi.mocked(createManifoldFromMesh)
      .mockResolvedValueOnce(buildingFake)
      .mockRejectedValueOnce(new Error('Not manifold'));
    vi.mocked(unionMeshes).mockResolvedValue(unionFake);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    const result = await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf' },
    );

    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('Building 2 skipped');
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    const unionMeshesArg = vi.mocked(unionMeshes).mock.calls[0][0];
    expect(unionMeshesArg).toHaveLength(2);
    expect(unionMeshesArg[0]).toBe(terrainMesh);
    expect(unionMeshesArg[1]).toEqual({
      positions: buildingFake.getMesh().vertProperties,
      indices: buildingFake.getMesh().triVerts,
    });
    expect(exportTo3MF).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when no meshes are produced', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');

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
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');
    const { capBuildingBottom } = await import('../src/buildingCapper.js');

    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(capBuildingBottom).mockImplementation((mesh: RawMesh) => mesh);

    let capturedMesh: RawMesh | null = null;
    vi.mocked(createManifoldFromMesh).mockImplementation(async (mesh: RawMesh) => {
      capturedMesh = mesh;
      return createFakeManifold();
    });
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeTerrain: false, scale: 2 },
    );

    expect(capturedMesh).not.toBeNull();
    const positions = capturedMesh!.positions;
    expect(positions[0]).toBeCloseTo(0);
    expect(positions[1]).toBeCloseTo(-0.6);
    expect(positions[2]).toBeCloseTo(0);
    expect(positions[3]).toBeCloseTo(2);
    expect(positions[4]).toBeCloseTo(-0.6);
    expect(positions[5]).toBeCloseTo(0);
    expect(positions[6]).toBeCloseTo(0);
    expect(positions[7]).toBeCloseTo(-0.6);
    expect(positions[8]).toBeCloseTo(2);
  });

  it('scale=1 is a no-op (no new allocations)', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');
    const { capBuildingBottom } = await import('../src/buildingCapper.js');

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([buildingMesh]);
    vi.mocked(capBuildingBottom).mockImplementation((mesh: RawMesh) => mesh);

    let capturedBuildingMesh: RawMesh | null = null;
    vi.mocked(createManifoldFromMesh).mockImplementation(async (mesh: RawMesh) => {
      capturedBuildingMesh = mesh;
      return createFakeManifold();
    });
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: 0, south: 0, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', scale: 1 },
    );

    expect(capturedBuildingMesh).toBe(buildingMesh);
    const unionMeshesArg = vi.mocked(unionMeshes).mock.calls[0][0];
    expect(unionMeshesArg[0]).toBe(terrainMesh);
  });

  it('excludes buildings straddling bounds when includeSpanningBuildings is false', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

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
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());

    // Default (includeSpanningBuildings omitted → false): building EXCLUDED, only terrain remains
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());
    await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf' },
    );
    // No building survives filtering, so createManifoldFromMesh is never called.
    expect(createManifoldFromMesh).toHaveBeenCalledTimes(0);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0]).toHaveLength(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0][0]).toBe(terrainMesh);

    vi.clearAllMocks();
    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([straddlingMesh]);
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());

    // includeSpanningBuildings=true: building IS included
    await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', includeSpanningBuildings: true },
    );
    // createManifoldFromMesh called once for the building; union gets terrain + building.
    expect(createManifoldFromMesh).toHaveBeenCalledTimes(1);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0]).toHaveLength(2);
  });
});

describe('componentContainsPoint', () => {
  // bounds centered at (0,0): engine x = lon * mPerDegLon, z = -lat * mPerDegLat
  const bounds = { west: -1, south: -1, east: 1, north: 1 };

  const triangleMesh: RawMesh = {
    positions: new Float32Array([-10, 0, -10, 10, 0, -10, 0, 0, 10]),
    indices: new Uint32Array([0, 1, 2]),
  };

  it('returns true when the point is inside the triangle footprint', () => {
    expect(componentContainsPoint(triangleMesh, 0, 0, bounds)).toBe(true);
  });

  it('returns true when the point is on a triangle edge', () => {
    const lon = 5 / 111320;
    expect(componentContainsPoint(triangleMesh, lon, 0, bounds)).toBe(true);
  });

  it('returns false when the point is outside the triangle footprint', () => {
    expect(componentContainsPoint(triangleMesh, 0.01, 0.01, bounds)).toBe(false);
  });

  it('returns false for a point inside the bounds but outside the mesh bbox', () => {
    const farMesh: RawMesh = {
      positions: new Float32Array([-100, 0, -100, -90, 0, -100, -95, 0, -90]),
      indices: new Uint32Array([0, 1, 2]),
    };
    expect(componentContainsPoint(farMesh, 0, 0, bounds)).toBe(false);
  });
});

describe('dedupeComponents', () => {
  it('collapses components with identical footprints, keeping the finest', () => {
    const coarse: RawMesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const fine: RawMesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10, 5, 0, 5]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    };
    const result = dedupeComponents([coarse, fine]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fine);
  });

  it('keeps components with distinct footprints', () => {
    const a: RawMesh = {
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const b: RawMesh = {
      positions: new Float32Array([100, 0, 0, 110, 0, 0, 100, 0, 10]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const result = dedupeComponents([a, b]);
    expect(result).toHaveLength(2);
    expect(result).toContain(a);
    expect(result).toContain(b);
  });
});

describe('buildPrintableModel with pickPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps only buildings whose footprint contains a pick point', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const hitMesh: RawMesh = {
      positions: new Float32Array([-10, 0, -10, 10, 0, -10, 0, 0, 10]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const missMesh: RawMesh = {
      positions: new Float32Array([-10, 0, -100, -5, 0, -100, -7.5, 0, -90]),
      indices: new Uint32Array([0, 1, 2]),
    };

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([hitMesh, missMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', pickPoints: [{ lon: 0, lat: 0 }] },
    );

    expect(createManifoldFromMesh).toHaveBeenCalledWith(hitMesh);
    expect(createManifoldFromMesh).not.toHaveBeenCalledWith(missMesh);
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0]).toHaveLength(2);
  });

  it('warns when no building matches the pick points', async () => {
    const { buildTerrainMesh } = await import('../src/terrain.js');
    const { buildBuildingMeshes } = await import('../src/meshBuilder.js');
    const { createManifoldFromMesh, exportTo3MF, unionMeshes } = await import('../src/manifoldOps.js');

    const farMesh: RawMesh = {
      positions: new Float32Array([-100, 0, -100, -90, 0, -100, -95, 0, -90]),
      indices: new Uint32Array([0, 1, 2]),
    };

    vi.mocked(buildTerrainMesh).mockResolvedValue(terrainMesh);
    vi.mocked(buildBuildingMeshes).mockResolvedValue([farMesh]);
    vi.mocked(createManifoldFromMesh).mockResolvedValue(createFakeManifold());
    vi.mocked(unionMeshes).mockResolvedValue(createFakeManifold());
    vi.mocked(exportTo3MF).mockResolvedValue(fakeBuffer);

    const result = await buildPrintableModel(
      { west: -1, south: -1, east: 1, north: 1 },
      { terrainThickness: 5, flattenBottom: true, format: '3mf', pickPoints: [{ lon: 0, lat: 0 }] },
    );

    expect(result.warnings).toContain('No buildings matched the pick points');
    expect(unionMeshes).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0]).toHaveLength(1);
    expect(vi.mocked(unionMeshes).mock.calls[0][0][0]).toBe(terrainMesh);
  });
});
