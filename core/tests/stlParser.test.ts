import { describe, expect, it } from 'vitest';

import { parseSTL } from '../src/stlParser.js';
import { writeBinarySTL } from '../src/stlWriter.js';
import { createCubeMesh } from './fixtures.js';

function buildASCIISTL(): Uint8Array {
  const mesh = createCubeMesh();
  const lines: string[] = ['solid cube'];

  for (let tri = 0; tri < mesh.indices.length / 3; tri++) {
    lines.push(`  facet normal 0 0 0`);
    lines.push('    outer loop');
    for (let vert = 0; vert < 3; vert++) {
      const idx = mesh.indices[tri * 3 + vert];
      const x = mesh.positions[idx * 3];
      const y = mesh.positions[idx * 3 + 1];
      const z = mesh.positions[idx * 3 + 2];
      lines.push(`      vertex ${x} ${y} ${z}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }

  lines.push('endsolid cube');
  return new TextEncoder().encode(lines.join('\n'));
}

describe('parseSTL', () => {
  it('parses a binary STL produced by writeBinarySTL', () => {
    const mesh = createCubeMesh();
    const buffer = writeBinarySTL(mesh);
    const parsed = parseSTL(buffer);

    expect(parsed.indices.length).toBe(mesh.indices.length);
    expect(parsed.positions.length).toBe(mesh.indices.length * 3);
  });

  it('parses an ASCII STL', () => {
    const buffer = buildASCIISTL();
    const parsed = parseSTL(buffer);

    expect(parsed.indices.length).toBe(36);
    expect(parsed.positions.length).toBe(108);
  });

  it('returns sequential indices for both binary and ASCII inputs', () => {
    const binary = parseSTL(writeBinarySTL(createCubeMesh()));
    const ascii = parseSTL(buildASCIISTL());

    for (let i = 0; i < binary.indices.length; i++) {
      expect(binary.indices[i]).toBe(i);
    }
    for (let i = 0; i < ascii.indices.length; i++) {
      expect(ascii.indices[i]).toBe(i);
    }
  });
});
