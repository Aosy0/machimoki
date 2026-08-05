/**
 * Cap open-bottomed building shells so they become closed solids.
 *
 * PLATEAU LOD1/LOD2 building meshes are often extruded footprints with walls
 * and a roof but no floor. This utility adds a floor (bottom cap) so the mesh
 * can be converted to a Manifold solid for 3MF/STL export.
 */

import type { RawMesh } from './types.js';

/**
 * Weld nearly-coincident vertices so triangle adjacency reflects shared edges.
 *
 * PLATEAU glTF data often stores buildings as unwelded triangle soups where
 * spatially coincident vertices have separate indices. Without welding,
 * splitConnectedComponents would treat every triangle as its own component.
 */
export function weldVertices(mesh: RawMesh, tolerance = 1e-5): RawMesh {
  if (mesh.positions.length === 0) return mesh;

  const cellSize = tolerance;
  const cells = new Map<string, number[]>();
  const newPositions: number[] = [];
  const remap = new Uint32Array(mesh.positions.length / 3);

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];

    const cx = Math.floor(x / cellSize);
    const cy = Math.floor(y / cellSize);
    const cz = Math.floor(z / cellSize);

    let foundIdx: number | undefined;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (list) {
            for (const idx of list) {
              const ox = newPositions[idx * 3];
              const oy = newPositions[idx * 3 + 1];
              const oz = newPositions[idx * 3 + 2];
              if (
                Math.abs(ox - x) <= tolerance &&
                Math.abs(oy - y) <= tolerance &&
                Math.abs(oz - z) <= tolerance
              ) {
                foundIdx = idx;
                break outer;
              }
            }
          }
        }
      }
    }

    if (foundIdx === undefined) {
      foundIdx = newPositions.length / 3;
      const key = `${cx},${cy},${cz}`;
      const list = cells.get(key) ?? [];
      list.push(foundIdx);
      cells.set(key, list);
      newPositions.push(x, y, z);
    }
    remap[i / 3] = foundIdx;
  }

  const newIndices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    newIndices[i] = remap[mesh.indices[i]];
  }

  return { positions: new Float32Array(newPositions), indices: newIndices };
}

interface Point2D {
  x: number;
  z: number;
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

function convexHull2D(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (sorted.length < 3) return sorted;

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function findOrAddVertex(
  positions: number[],
  x: number,
  y: number,
  z: number,
  tolerance: number,
): number {
  for (let i = 0; i < positions.length; i += 3) {
    if (
      Math.abs(positions[i] - x) <= tolerance &&
      Math.abs(positions[i + 1] - y) <= tolerance &&
      Math.abs(positions[i + 2] - z) <= tolerance
    ) {
      return i / 3;
    }
  }
  const index = positions.length / 3;
  positions.push(x, y, z);
  return index;
}

/**
 * Add a bottom cap to a mesh whose minimum-Y face is open.
 *
 * The cap is the convex hull of the bottom vertices, triangulated as a fan
 * from the hull centroid. This is a conservative approximation of the building
 * footprint and is sufficient for typical LOD1 extruded polygons.
 */
export function splitConnectedComponents(mesh: RawMesh): RawMesh[] {
  const numTriangles = mesh.indices.length / 3;
  if (numTriangles === 0) return [];

  const edgeToTriangles = new Map<string, number[]>();
  function addEdge(v0: number, v1: number, triIdx: number) {
    const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;
    const list = edgeToTriangles.get(key);
    if (list) list.push(triIdx);
    else edgeToTriangles.set(key, [triIdx]);
  }

  for (let triIdx = 0; triIdx < numTriangles; triIdx++) {
    const i0 = mesh.indices[triIdx * 3];
    const i1 = mesh.indices[triIdx * 3 + 1];
    const i2 = mesh.indices[triIdx * 3 + 2];
    addEdge(i0, i1, triIdx);
    addEdge(i1, i2, triIdx);
    addEdge(i2, i0, triIdx);
  }

  const visited = new Uint8Array(numTriangles);
  const components: RawMesh[] = [];

  for (let startTri = 0; startTri < numTriangles; startTri++) {
    if (visited[startTri]) continue;

    const triQueue: number[] = [startTri];
    visited[startTri] = 1;
    const triIndices: number[] = [];

    while (triQueue.length > 0) {
      const triIdx = triQueue.pop()!;
      triIndices.push(triIdx);

      const i0 = mesh.indices[triIdx * 3];
      const i1 = mesh.indices[triIdx * 3 + 1];
      const i2 = mesh.indices[triIdx * 3 + 2];

      const neighbors: number[] = [];
      const key01 = i0 < i1 ? `${i0},${i1}` : `${i1},${i0}`;
      const key12 = i1 < i2 ? `${i1},${i2}` : `${i2},${i1}`;
      const key20 = i2 < i0 ? `${i2},${i0}` : `${i0},${i2}`;
      for (const key of [key01, key12, key20]) {
        const list = edgeToTriangles.get(key);
        if (list) {
          for (const n of list) {
            if (n !== triIdx && !visited[n]) neighbors.push(n);
          }
        }
      }

      for (const n of neighbors) {
        visited[n] = 1;
        triQueue.push(n);
      }
    }

    const usedVerts = new Set<number>();
    for (const triIdx of triIndices) {
      usedVerts.add(mesh.indices[triIdx * 3]);
      usedVerts.add(mesh.indices[triIdx * 3 + 1]);
      usedVerts.add(mesh.indices[triIdx * 3 + 2]);
    }

    const sortedVerts = Array.from(usedVerts).sort((a, b) => a - b);
    const oldToNew = new Map<number, number>();
    for (let i = 0; i < sortedVerts.length; i++) {
      oldToNew.set(sortedVerts[i], i);
    }

    const newPositions = new Float32Array(sortedVerts.length * 3);
    for (let i = 0; i < sortedVerts.length; i++) {
      const oldIdx = sortedVerts[i];
      newPositions[i * 3] = mesh.positions[oldIdx * 3];
      newPositions[i * 3 + 1] = mesh.positions[oldIdx * 3 + 1];
      newPositions[i * 3 + 2] = mesh.positions[oldIdx * 3 + 2];
    }

    const newIndices = new Uint32Array(triIndices.length * 3);
    for (let i = 0; i < triIndices.length; i++) {
      const triIdx = triIndices[i];
      newIndices[i * 3] = oldToNew.get(mesh.indices[triIdx * 3])!;
      newIndices[i * 3 + 1] = oldToNew.get(mesh.indices[triIdx * 3 + 1])!;
      newIndices[i * 3 + 2] = oldToNew.get(mesh.indices[triIdx * 3 + 2])!;
    }

    components.push({ positions: newPositions, indices: newIndices });
  }

  return components;
}

export function capBuildingBottom(mesh: RawMesh, tolerance = 1e-6): RawMesh {
  const positions = Array.from(mesh.positions);
  const indices = Array.from(mesh.indices);

  let minY = Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i];
  }

  const bottomVertices = new Map<string, Point2D>();
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] <= minY + tolerance) {
      const x = positions[i];
      const z = positions[i + 2];
      const key = `${x.toFixed(8)},${z.toFixed(8)}`;
      bottomVertices.set(key, { x, z });
    }
  }

  const uniquePoints = Array.from(bottomVertices.values());
  if (uniquePoints.length < 3) {
    return mesh;
  }

  const hull = convexHull2D(uniquePoints);
  if (hull.length < 3) {
    return mesh;
  }

  let centroidX = 0;
  let centroidZ = 0;
  for (const p of hull) {
    centroidX += p.x;
    centroidZ += p.z;
  }
  centroidX /= hull.length;
  centroidZ /= hull.length;

  const centroidIndex = findOrAddVertex(positions, centroidX, minY, centroidZ, tolerance);

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const aIndex = findOrAddVertex(positions, a.x, minY, a.z, tolerance);
    const bIndex = findOrAddVertex(positions, b.x, minY, b.z, tolerance);
    // Winding order points inward so the cap is consistent with an outward-facing shell.
    indices.push(centroidIndex, bIndex, aIndex);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
