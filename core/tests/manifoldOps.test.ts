import { describe, expect, it } from 'vitest';

import {
  createManifoldFromMesh,
  unionMeshes,
  exportTo3MF,
  exportToSTL,
  exportMeshesToSTL,
  transformForUpAxis,
  importFrom3MF,
  importFromSTL,
  cleanupManifoldImports,
} from '../src/manifoldOps.js';
import { parseSTL } from '../src/stlParser.js';
import { createCubeMesh } from './fixtures.js';

describe('manifoldOps', () => {
  it('creates a Manifold from a cube mesh', async () => {
    const mesh = createCubeMesh();
    const manifold = await createManifoldFromMesh(mesh);

    try {
      expect(manifold.status()).toBe('NoError');
      expect(manifold.numTri()).toBe(12);
      expect(manifold.numVert()).toBe(8);
      expect(manifold.volume()).toBeCloseTo(1, 6);
      expect(manifold.surfaceArea()).toBeCloseTo(6, 6);
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }
  });

  it('unions two translated cubes', async () => {
    const cubeA = createCubeMesh();
    const cubeB = createCubeMesh();

    // Translate cubeB by 0.5 on the X axis by shifting all positions.
    const translatedPositions = new Float32Array(cubeB.positions.length);
    for (let i = 0; i < cubeB.positions.length / 3; i++) {
      translatedPositions[i * 3] = cubeB.positions[i * 3] + 0.5;
      translatedPositions[i * 3 + 1] = cubeB.positions[i * 3 + 1];
      translatedPositions[i * 3 + 2] = cubeB.positions[i * 3 + 2];
    }
    const meshB = { positions: translatedPositions, indices: cubeB.indices };

    const manifold = await unionMeshes([cubeA, meshB]);

    try {
      expect(manifold.status()).toBe('NoError');
      expect(manifold.volume()).toBeCloseTo(1.5, 6);
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }
  });

  it('roundtrips a cube through 3MF export/import', async () => {
    const mesh = createCubeMesh();
    const manifold = await createManifoldFromMesh(mesh);

    try {
      const buffer = await exportTo3MF(manifold);
      expect(buffer.length).toBeGreaterThan(0);

      const imported = await importFrom3MF(buffer);
      try {
        expect(imported.status()).toBe('NoError');
        expect(imported.volume()).toBeCloseTo(1, 6);
      } finally {
        imported.delete();
      }
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }
  });

  it('exports a Manifold to binary STL', async () => {
    const mesh = createCubeMesh();
    const manifold = await createManifoldFromMesh(mesh);

    try {
      const stlBuffer = exportToSTL(manifold);
      expect(stlBuffer.length).toBe(84 + 50 * 12);

      const imported = await importFromSTL(stlBuffer);
      try {
        expect(imported.status()).toBe('NoError');
        expect(imported.volume()).toBeCloseTo(1, 6);
      } finally {
        imported.delete();
      }
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }
  });

  it('transformForUpAxis keeps y-up positions unchanged', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const result = transformForUpAxis(positions, 'y-up');
    expect(result).toBe(positions);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('transformForUpAxis maps z-up as (x, y, z) -> (x, -z, y)', () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const result = transformForUpAxis(positions, 'z-up');
    expect(Array.from(result)).toEqual([1, -3, 2, 4, -6, 5]);
  });

  it('exportMeshesToSTL writes z-up geometry by default', () => {
    const mesh = createCubeMesh();
    const stlBuffer = exportMeshesToSTL([mesh]);
    const parsed = parseSTL(stlBuffer);

    const minY = Math.min(...Array.from(parsed.positions).filter((_, i) => i % 3 === 1));
    const maxY = Math.max(...Array.from(parsed.positions).filter((_, i) => i % 3 === 1));
    const minZ = Math.min(...Array.from(parsed.positions).filter((_, i) => i % 3 === 2));
    const maxZ = Math.max(...Array.from(parsed.positions).filter((_, i) => i % 3 === 2));

    // Cube spans [0,1] m on every engine axis → [0,1000] mm after scaling.
    // Z-up rotation maps (x, y, z) -> (x, -z, y):
    // y now spans [-1000, 0], z spans [0, 1000].
    expect(minY).toBeCloseTo(-1000, 6);
    expect(maxY).toBeCloseTo(0, 6);
    expect(minZ).toBeCloseTo(0, 6);
    expect(maxZ).toBeCloseTo(1000, 6);
  });

  it('exportMeshesToSTL preserves y-up geometry when requested', () => {
    const mesh = createCubeMesh();
    const stlBuffer = exportMeshesToSTL([mesh], 'y-up');
    const parsed = parseSTL(stlBuffer);

    const minY = Math.min(...Array.from(parsed.positions).filter((_, i) => i % 3 === 1));
    const maxY = Math.max(...Array.from(parsed.positions).filter((_, i) => i % 3 === 1));
    const minZ = Math.min(...Array.from(parsed.positions).filter((_, i) => i % 3 === 2));
    const maxZ = Math.max(...Array.from(parsed.positions).filter((_, i) => i % 3 === 2));

    expect(minY).toBeCloseTo(0, 6);
    expect(maxY).toBeCloseTo(1000, 6);
    expect(minZ).toBeCloseTo(0, 6);
    expect(maxZ).toBeCloseTo(1000, 6);
  });
});
