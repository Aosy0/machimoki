import { describe, expect, it } from 'vitest';

import { writeBinarySTL } from '../src/stlWriter.js';
import { parseSTL } from '../src/stlParser.js';
import { createCubeMesh } from './fixtures.js';

describe('writeBinarySTL', () => {
  it('produces a buffer of the expected size', () => {
    const mesh = createCubeMesh();
    const buffer = writeBinarySTL(mesh);
    expect(buffer.length).toBe(84 + 50 * 12);
  });

  it('roundtrips through parseSTL', () => {
    const mesh = createCubeMesh();
    const buffer = writeBinarySTL(mesh);
    const parsed = parseSTL(buffer);

    // The parser emits unshared vertices, so the positions are flattened.
    expect(parsed.indices.length).toBe(mesh.indices.length);
    expect(parsed.positions.length).toBe(mesh.indices.length * 3);

    // Each original triangle should appear in the parsed mesh.
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triPositions: number[] = [];
      for (let j = 0; j < 3; j++) {
        const idx = mesh.indices[i + j];
        triPositions.push(
          mesh.positions[idx * 3],
          mesh.positions[idx * 3 + 1],
          mesh.positions[idx * 3 + 2]
        );
      }

      const parsedTriPositions: number[] = [];
      for (let j = 0; j < 3; j++) {
        parsedTriPositions.push(
          parsed.positions[(i + j) * 3],
          parsed.positions[(i + j) * 3 + 1],
          parsed.positions[(i + j) * 3 + 2]
        );
      }

      expect(parsedTriPositions).toEqual(triPositions);
    }
  });
});
