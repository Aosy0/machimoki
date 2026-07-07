import { describe, expect, it } from 'vitest';

import {
  createManifoldFromMesh,
  unionMeshes,
  exportTo3MF,
  exportToSTL,
  importFrom3MF,
  importFromSTL,
  cleanupManifoldImports,
} from '../../src/core/manifoldOps.js';
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
});
