/**
 * Binary STL serializer.
 */

import { RawMesh } from './types.js';

const HEADER_SIZE = 80;
const TRIANGLE_COUNT_SIZE = 4;
const TRIANGLE_RECORD_SIZE = 50;
const NORMAL_SIZE = 12;
const VERTEX_SIZE = 12;
const ATTRIBUTE_SIZE = 2;
const BYTES_PER_FLOAT = 4;

/**
 * Serialize a RawMesh to a binary STL buffer.
 *
 * The output format is:
 * - 80-byte header (set to zeros)
 * - 4-byte little-endian triangle count
 * - For each triangle:
 *   - 12-byte normal (zeros)
 *   - 3 x 12-byte vertices
 *   - 2-byte attribute byte count (0)
 */
export function writeBinarySTL(mesh: RawMesh): Buffer {
  const numTri = mesh.indices.length / 3;
  if (!Number.isInteger(numTri)) {
    throw new Error(
      `Invalid mesh: indices length ${mesh.indices.length} is not divisible by 3`
    );
  }

  const buffer = Buffer.alloc(HEADER_SIZE + TRIANGLE_COUNT_SIZE + TRIANGLE_RECORD_SIZE * numTri);

  // 80-byte header — left as zeros.
  buffer.writeUInt32LE(numTri, HEADER_SIZE);

  let offset = HEADER_SIZE + TRIANGLE_COUNT_SIZE;
  for (let tri = 0; tri < numTri; tri++) {
    // Normal (12 bytes) — zeros are acceptable per the STL spec.
    offset += NORMAL_SIZE;

    for (let vert = 0; vert < 3; vert++) {
      const idx = mesh.indices[tri * 3 + vert];
      if (idx >= mesh.positions.length / 3) {
        throw new Error(
          `Vertex index ${idx} out of bounds for positions length ${mesh.positions.length}`
        );
      }
      const x = mesh.positions[idx * 3];
      const y = mesh.positions[idx * 3 + 1];
      const z = mesh.positions[idx * 3 + 2];
      buffer.writeFloatLE(x, offset);
      buffer.writeFloatLE(y, offset + BYTES_PER_FLOAT);
      buffer.writeFloatLE(z, offset + BYTES_PER_FLOAT * 2);
      offset += VERTEX_SIZE;
    }

    // Attribute byte count (2 bytes) — set to 0.
    buffer.writeUInt16LE(0, offset);
    offset += ATTRIBUTE_SIZE;
  }

  return buffer;
}
