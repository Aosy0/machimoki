/**
 * Binary and ASCII STL parser.
 */

import { RawMesh } from './types.js';

const HEADER_SIZE = 80;
const TRIANGLE_COUNT_OFFSET = 80;
const TRIANGLE_RECORD_SIZE = 50;
const NORMAL_SIZE = 12;
const VERTEX_SIZE = 12;
const BYTES_PER_FLOAT = 4;

function isASCII(buffer: Uint8Array): boolean {
  if (buffer.length < 5) return false;
  const prefix = new TextDecoder().decode(buffer.subarray(0, 5)).toLowerCase();
  if (prefix !== 'solid') return false;
  const text = new TextDecoder().decode(buffer).toLowerCase();
  return text.includes('endsolid');
}

function parseBinarySTL(buffer: Uint8Array): RawMesh {
  if (buffer.length < HEADER_SIZE + 4) {
    throw new Error('Binary STL buffer is too short');
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const numTri = view.getUint32(TRIANGLE_COUNT_OFFSET, true);
  const expectedSize = HEADER_SIZE + 4 + TRIANGLE_RECORD_SIZE * numTri;
  if (buffer.length < expectedSize) {
    throw new Error(
      `Binary STL buffer too short: expected ${expectedSize} bytes for ${numTri} triangles, got ${buffer.length}`
    );
  }

  const positions = new Float32Array(numTri * 9);
  const indices = new Uint32Array(numTri * 3);

  let offset = HEADER_SIZE + 4;
  for (let tri = 0; tri < numTri; tri++) {
    // Skip normal.
    offset += NORMAL_SIZE;

    for (let vert = 0; vert < 3; vert++) {
      const posIdx = tri * 9 + vert * 3;
      positions[posIdx] = view.getFloat32(offset, true);
      positions[posIdx + 1] = view.getFloat32(offset + BYTES_PER_FLOAT, true);
      positions[posIdx + 2] = view.getFloat32(offset + BYTES_PER_FLOAT * 2, true);
      offset += VERTEX_SIZE;
    }

    indices[tri * 3] = tri * 3;
    indices[tri * 3 + 1] = tri * 3 + 1;
    indices[tri * 3 + 2] = tri * 3 + 2;

    // Skip attribute byte count.
    offset += 2;
  }

  return { positions, indices };
}

function parseASCIISTL(text: string): RawMesh {
  const facetRegex =
    /facet\s+normal\s+[^\n]+\s+outer\s+loop\s+vertex\s+([^\n]+)\s+vertex\s+([^\n]+)\s+vertex\s+([^\n]+)\s+endloop\s+endfacet/g;

  const positionsList: number[] = [];
  const indicesList: number[] = [];
  let vertexCount = 0;

  let match = facetRegex.exec(text);
  while (match !== null) {
    for (let i = 1; i <= 3; i++) {
      const parts = match[i]
        .trim()
        .split(/\s+/)
        .map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`Invalid vertex coordinates in ASCII STL: ${match[i]}`);
      }
      positionsList.push(parts[0], parts[1], parts[2]);
      indicesList.push(vertexCount);
      vertexCount += 1;
    }
    match = facetRegex.exec(text);
  }

  if (vertexCount === 0) {
    throw new Error('No valid facets found in ASCII STL');
  }

  return {
    positions: new Float32Array(positionsList),
    indices: new Uint32Array(indicesList),
  };
}

/**
 * Parse a binary or ASCII STL buffer into a RawMesh.
 *
 * Returns indices as a flat list [0, 1, 2, 3, 4, 5, ...] with each triangle
 * referencing three sequential vertices.
 */
export function parseSTL(buffer: Uint8Array): RawMesh {
  if (isASCII(buffer)) {
    return parseASCIISTL(new TextDecoder().decode(buffer));
  }
  return parseBinarySTL(buffer);
}
