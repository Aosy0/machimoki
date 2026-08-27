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


