/**
 * Pure geometry pipeline operations (no Cesium, no I/O, no WASM).
 * Safe to import in Web Workers and browsers.
 */

import { Bounds, RawMesh } from './types.js';

/**
 * Convert geographic bounds to the local engine coordinate frame
 * (x = east, y = up, z = south) centered on the selection center.
 * Matches the transform used by meshBuilder/terrain.
 */
export function boundsToEngineXZ(bounds: Bounds): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  return {
    minX: (bounds.west - centerLon) * mPerDegLon,
    maxX: (bounds.east - centerLon) * mPerDegLon,
    minZ: -(bounds.north - centerLat) * mPerDegLat,
    maxZ: -(bounds.south - centerLat) * mPerDegLat,
  };
}

/**
 * True if the point (engine x/z) is inside the XZ projection of any triangle
 * of the mesh. A point on a triangle edge counts as inside.
 */
export function pointInTriangleXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  epsilon = 1e-9,
): boolean {
  const sign = (x1: number, z1: number, x2: number, z2: number, x3: number, z3: number): number =>
    (x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3);

  const d1 = sign(px, pz, ax, az, bx, bz);
  const d2 = sign(px, pz, bx, bz, cx, cz);
  const d3 = sign(px, pz, cx, cz, ax, az);

  const hasNegative = d1 < -epsilon || d2 < -epsilon || d3 < -epsilon;
  const hasPositive = d1 > epsilon || d2 > epsilon || d3 > epsilon;
  return !(hasNegative && hasPositive);
}

/**
 * True if the component's 2D footprint (x/z) contains the given pick point.
 * Uses a bounding-box pre-check followed by a per-triangle point-in-triangle
 * test, so a click inside an L-shaped footprint only matches the real
 * footprint rather than its bounding box.
 */
export function componentContainsPoint(
  mesh: RawMesh,
  lon: number,
  lat: number,
  bounds: Bounds,
): boolean {
  const { minX, maxX, minZ, maxZ } = boundsToEngineXZ(bounds);
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const mPerDegLat = 111320;
  const px = (lon - centerLon) * mPerDegLon;
  const pz = -(lat - centerLat) * mPerDegLat;

  if (px < minX || px > maxX || pz < minZ || pz > maxZ) return false;

  const positions = mesh.positions;
  const indices = mesh.indices;
  const numTriangles = indices.length / 3;

  for (let t = 0; t < numTriangles; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    if (
      pointInTriangleXZ(
        px,
        pz,
        positions[i0],
        positions[i0 + 2],
        positions[i1],
        positions[i1 + 2],
        positions[i2],
        positions[i2 + 2],
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Remove duplicate components. PLATEAU tilesets may contain the same building
 * at multiple refinement levels (parent/child tiles with identical footprints
 * but different tessellation), so the raw fetch yields duplicates. Components
 * sharing a footprint bounding box (rounded to 1cm) are collapsed to the one
 * with the most triangles (the finest representation).
 */
export function dedupeComponents(components: RawMesh[]): RawMesh[] {
  const byFootprint = new Map<string, { mesh: RawMesh; triCount: number }>();

  for (const comp of components) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < comp.positions.length; i += 3) {
      const x = comp.positions[i];
      const z = comp.positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const key = `${minX.toFixed(2)},${minZ.toFixed(2)},${maxX.toFixed(2)},${maxZ.toFixed(2)}`;
    const triCount = comp.indices.length / 3;
    const existing = byFootprint.get(key);
    if (!existing || triCount > existing.triCount) {
      byFootprint.set(key, { mesh: comp, triCount });
    }
  }

  return Array.from(byFootprint.values()).map((entry) => entry.mesh);
}

/**
 * True if the mesh's 2D footprint (x/z) intersects the selection bounds.
 *
 * PLATEAU tilesets contain huge root tiles (kilometer-scale regions), so a
 * tile-level intersection test keeps every building from all intersecting
 * tiles. Each connected component is a single building; filtering at this
 * level removes buildings far outside the requested bounds.
 */
export function componentIntersectsBounds(mesh: RawMesh, bounds: Bounds, tolerance = 1e-2, includeSpanning = true): boolean {
  const { minX, maxX, minZ, maxZ } = boundsToEngineXZ(bounds);

  let bMinX = Infinity;
  let bMaxX = -Infinity;
  let bMinZ = Infinity;
  let bMaxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const z = mesh.positions[i + 2];
    if (x < bMinX) bMinX = x;
    if (x > bMaxX) bMaxX = x;
    if (z < bMinZ) bMinZ = z;
    if (z > bMaxZ) bMaxZ = z;
  }

  if (!includeSpanning) {
    return (
      bMinX >= minX - tolerance &&
      bMaxX <= maxX + tolerance &&
      bMinZ >= minZ - tolerance &&
      bMaxZ <= maxZ + tolerance
    );
  }

  return !(
    bMaxX < minX - tolerance ||
    bMinX > maxX + tolerance ||
    bMaxZ < minZ - tolerance ||
    bMinZ > maxZ + tolerance
  );
}

/**
 * Scale a RawMesh by multiplying all position components by a uniform factor.
 * Returns a new mesh with a fresh Float32Array; does NOT mutate the input.
 */
export function scaleRawMesh(mesh: RawMesh, scale: number): RawMesh {
  if (scale === 1) return mesh;
  const scaled = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i++) {
    scaled[i] = mesh.positions[i] * scale;
  }
  return { positions: scaled, indices: mesh.indices };
}

/**
 * Convert a Manifold mesh representation to a RawMesh.
 * This is a pure data transformation with no external dependencies.
 */
export function meshToRaw(mesh: { vertProperties: Float32Array; triVerts: Uint32Array }): RawMesh {
  return { positions: mesh.vertProperties, indices: mesh.triVerts };
}
