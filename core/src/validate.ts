/**
 * Mesh validation and metrics computation.
 */

import type { Manifold } from 'manifold-3d';

import { ValidationResult } from './types.js';
import { importFrom3MF, importFromSTL } from './manifoldOps.js';

async function importByMimeType(buffer: Uint8Array, mimeType: string): Promise<Manifold> {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime === 'model/3mf') {
    return importFrom3MF(buffer);
  }
  if (lowerMime === 'model/stl' || lowerMime === 'application/sla') {
    return importFromSTL(buffer);
  }
  throw new Error(`Unsupported mimeType for validation: ${mimeType}`);
}

function countEdgeIssues(triVerts: Uint32Array): {
  openEdges: number;
  nonManifoldEdges: number;
} {
  const edgeCounts = new Map<string, number>();

  for (let tri = 0; tri < triVerts.length / 3; tri++) {
    const a = triVerts[tri * 3];
    const b = triVerts[tri * 3 + 1];
    const c = triVerts[tri * 3 + 2];

    const edges: Array<[number, number]> = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [u, v] of edges) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) {
      openEdges += 1;
    } else if (count > 2) {
      nonManifoldEdges += 1;
    }
  }

  return { openEdges, nonManifoldEdges };
}

function countShells(manifold: Manifold): number {
  const shells = manifold.decompose();
  const count = shells.length;
  for (const shell of shells) {
    shell.delete();
  }
  return count;
}

function createFailResult(statusCode: string): ValidationResult {
  return {
    status: 'fail',
    numTri: 0,
    numVert: 0,
    numEdge: 0,
    volume: 0,
    surfaceArea: 0,
    genus: 0,
    numShells: 0,
    open_edges: 0,
    non_manifold_edges: 0,
    self_intersections: 1,
    statusCode,
  };
}

/**
 * Validate a mesh buffer and return geometric/topological metrics.
 *
 * If the buffer cannot be imported as a Manifold, a fail result is returned
 * with `self_intersections` set to 1 and `statusCode` set to the error text.
 */
export async function validateMesh(
  buffer: Uint8Array,
  mimeType: string
): Promise<ValidationResult> {
  let manifold: Manifold;
  try {
    manifold = await importByMimeType(buffer, mimeType);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailResult(message);
  }

  try {
    const statusCode = manifold.status();
    const mesh = manifold.getMesh();
    const { openEdges, nonManifoldEdges } = countEdgeIssues(mesh.triVerts);

    const numShells = countShells(manifold);
    const selfIntersections = statusCode === 'NoError' ? 0 : 1;

    const volume = manifold.volume();
    const surfaceArea = manifold.surfaceArea();
    const numTri = manifold.numTri();
    const numVert = manifold.numVert();

    let status: ValidationResult['status'];
    if (openEdges === 0 && nonManifoldEdges === 0 && selfIntersections === 0) {
      status = numShells === 1 ? 'pass' : 'warning';
    } else {
      status = 'fail';
    }

    if (numTri === 0 || numVert === 0 || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(surfaceArea) || surfaceArea <= 0) {
      status = 'fail';
    }

    return {
      status,
      numTri,
      numVert,
      numEdge: manifold.numEdge(),
      volume,
      surfaceArea,
      genus: manifold.genus(),
      numShells,
      open_edges: openEdges,
      non_manifold_edges: nonManifoldEdges,
      self_intersections: selfIntersections,
      statusCode,
    };
  } finally {
    manifold.delete();
  }
}
