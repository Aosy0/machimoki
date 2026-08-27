import { describe, expect, it } from 'vitest';

import { validateMesh } from '../src/validate.js';
import {
  createManifoldFromMesh,
  exportTo3MF,
  exportToSTL,
  cleanupManifoldImports,
} from '../src/manifoldOps.js';
import { writeBinarySTL } from '../src/stlWriter.js';
import { createCubeMesh } from './fixtures.js';

describe('validateMesh', () => {
  it('passes for a watertight cube (3MF)', async () => {
    const manifold = await createManifoldFromMesh(createCubeMesh());
    let buffer: Buffer;

    try {
      buffer = await exportTo3MF(manifold);
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }

    const result = await validateMesh(buffer, 'model/3mf');

    expect(result.status).toBe('pass');
    expect(result.statusCode).toBe('NoError');
    expect(result.numTri).toBe(12);
    expect(result.numShells).toBe(1);
    expect(result.open_edges).toBe(0);
    expect(result.non_manifold_edges).toBe(0);
    expect(result.self_intersections).toBe(0);
    expect(result.volume).toBeCloseTo(1, 6);
  });

  it('passes for a watertight cube (STL)', async () => {
    const manifold = await createManifoldFromMesh(createCubeMesh());
    let buffer: Buffer;

    try {
      buffer = exportToSTL(manifold);
    } finally {
      manifold.delete();
      cleanupManifoldImports();
    }

    const result = await validateMesh(buffer, 'model/stl');

    expect(result.status).toBe('pass');
    expect(result.statusCode).toBe('NoError');
    expect(result.open_edges).toBe(0);
  });

  it('fails for an open box STL', async () => {
    const positions = new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
      0, 0, 1,
      1, 0, 1,
      1, 1, 1,
      0, 1, 1,
    ]);
    const indices = new Uint32Array([
      0, 2, 1,
      0, 3, 2,
      0, 7, 3,
      0, 4, 7,
      1, 2, 6,
      1, 6, 5,
      3, 6, 2,
      3, 7, 6,
      0, 1, 5,
      0, 5, 4,
    ]);
    const buffer = writeBinarySTL({ positions, indices });

    const result = await validateMesh(buffer, 'model/stl');

    expect(result.status).toBe('fail');
    expect(result.self_intersections).toBe(1);
  });
});
