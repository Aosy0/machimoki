import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { buildTerrainMesh } from '../../src/core/terrain';
import type { Bounds } from '../../src/core/types';

vi.mock('cesium', () => {
  class Cartesian3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    static fromDegrees(lon: number, lat: number, height = 0): Cartesian3 {
      return new Cartesian3(lon, lat, height);
    }
    static fromRadians(lon: number, lat: number, height = 0): Cartesian3 {
      return new Cartesian3(lon, lat, height);
    }
    static fromElements(x: number, y: number, z: number): Cartesian3 {
      return new Cartesian3(x, y, z);
    }
  }

  class Cartographic {
    constructor(public longitude = 0, public latitude = 0, public height = 0) {}
    static fromDegrees(lon: number, lat: number, height = 0): Cartographic {
      return new Cartographic((lon * Math.PI) / 180, (lat * Math.PI) / 180, height);
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
    static IDENTITY = new Matrix4();
  }

  return {
    Cartesian3,
    Cartographic,
    CesiumTerrainProvider: { fromIonAssetId: vi.fn() },
    Ion: { defaultAccessToken: '' },
    Matrix4,
    sampleTerrainMostDetailed: vi.fn(),
    Transforms: {
      eastNorthUpToFixedFrame: () => new Matrix4(),
    },
  };
});

const bounds: Bounds = {
  west: 139.69,
  south: 35.69,
  east: 139.7,
  north: 35.7,
};

describe('terrain', () => {
  beforeEach(async () => {
    const { CesiumTerrainProvider, sampleTerrainMostDetailed } = await import('cesium');
    (CesiumTerrainProvider.fromIonAssetId as unknown as MockInstance)
      .mockReset()
      .mockResolvedValue({});
    (sampleTerrainMostDetailed as unknown as MockInstance).mockReset().mockImplementation((_provider, positions) => {
      return Promise.resolve(
        positions.map((p, i) => ({
          longitude: p.longitude,
          latitude: p.latitude,
          height: i * 0.1,
        })),
      );
    });
  });

  it('samples a 64x64 grid and returns a solid mesh', async () => {
    const mesh = await buildTerrainMesh(bounds, 10, true);

    expect(mesh.positions).toBeInstanceOf(Float32Array);
    expect(mesh.indices).toBeInstanceOf(Uint32Array);

    const numVertices = 64 * 64 * 2;
    expect(mesh.positions.length).toBe(numVertices * 3);
  });

  it('flattens bottom when flattenBottom is true', async () => {
    const mesh = await buildTerrainMesh(bounds, 10, true);
    const numVertices = 64 * 64;

    const bottomZValues: number[] = [];
    for (let i = numVertices; i < numVertices * 2; i++) {
      bottomZValues.push(mesh.positions[i * 3 + 2]);
    }

    const uniqueZ = [...new Set(bottomZValues.map((z) => Math.round(z * 1000) / 1000))];
    expect(uniqueZ.length).toBe(1);
  });

  it('keeps bottom relative to surface when flattenBottom is false', async () => {
    const mesh = await buildTerrainMesh(bounds, 10, false);
    const numVertices = 64 * 64;

    const bottomZValues: number[] = [];
    for (let i = numVertices; i < numVertices * 2; i++) {
      bottomZValues.push(mesh.positions[i * 3 + 2]);
    }

    const uniqueZ = [...new Set(bottomZValues.map((z) => Math.round(z * 1000) / 1000))];
    expect(uniqueZ.length).toBeGreaterThan(1);
  });

  it('applies axis swap (ENU -> engine)', async () => {
    const mesh = await buildTerrainMesh(bounds, 10, true);

    const southLatitudeRadians = (bounds.south * Math.PI) / 180;
    const westLongitudeRadians = (bounds.west * Math.PI) / 180;
    const expectedEngineX = westLongitudeRadians;
    const expectedEngineY = 0;
    const expectedEngineZ = -southLatitudeRadians;

    expect(mesh.positions[0]).toBeCloseTo(expectedEngineX);
    expect(mesh.positions[1]).toBe(expectedEngineY);
    expect(mesh.positions[2]).toBeCloseTo(expectedEngineZ);
  });
});
