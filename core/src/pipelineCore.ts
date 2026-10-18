/**
 * Pure geometry pipeline operations (no Cesium, no I/O, no WASM).
 * Safe to import in Web Workers and browsers.
 */

import { Bounds, RawMesh } from './types.js'

/** Convert user-facing printed thickness (mm) to model-space meters for a given export scale. */
export function printedMmToModelMeters(thicknessMm: number, scale: number): number {
  return thicknessMm / (scale * 1000)
}

/**
 * Convert geographic bounds to the local engine coordinate frame
 * (x = east, y = up, z = south) centered on the selection center.
 * Matches the transform used by meshBuilder/terrain.
 */
export function boundsToEngineXZ(bounds: Bounds): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180)
  const mPerDegLat = 111320
  return {
    minX: (bounds.west - centerLon) * mPerDegLon,
    maxX: (bounds.east - centerLon) * mPerDegLon,
    minZ: -(bounds.north - centerLat) * mPerDegLat,
    maxZ: -(bounds.south - centerLat) * mPerDegLat,
  }
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
    (x1 - x3) * (z2 - z3) - (x2 - x3) * (z1 - z3)

  const d1 = sign(px, pz, ax, az, bx, bz)
  const d2 = sign(px, pz, bx, bz, cx, cz)
  const d3 = sign(px, pz, cx, cz, ax, az)

  const hasNegative = d1 < -epsilon || d2 < -epsilon || d3 < -epsilon
  const hasPositive = d1 > epsilon || d2 > epsilon || d3 > epsilon
  return !(hasNegative && hasPositive)
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
  const { minX, maxX, minZ, maxZ } = boundsToEngineXZ(bounds)
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180)
  const mPerDegLat = 111320
  const px = (lon - centerLon) * mPerDegLon
  const pz = -(lat - centerLat) * mPerDegLat

  if (px < minX || px > maxX || pz < minZ || pz > maxZ) return false

  const positions = mesh.positions
  const indices = mesh.indices
  const numTriangles = indices.length / 3

  for (let t = 0; t < numTriangles; t++) {
    const i0 = indices[t * 3] * 3
    const i1 = indices[t * 3 + 1] * 3
    const i2 = indices[t * 3 + 2] * 3
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
      return true
    }
  }
  return false
}

/**
 * Remove duplicate components. PLATEAU tilesets may contain the same building
 * at multiple refinement levels (parent/child tiles with identical footprints
 * but different tessellation), so the raw fetch yields duplicates. Components
 * sharing a footprint bounding box (rounded to 1cm) are collapsed to the one
 * with the most triangles (the finest representation).
 */
export function dedupeComponents(components: RawMesh[]): RawMesh[] {
  const byFootprint = new Map<string, { mesh: RawMesh; triCount: number }>()

  for (const comp of components) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < comp.positions.length; i += 3) {
      const x = comp.positions[i]
      const z = comp.positions[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }

    const key = `${minX.toFixed(2)},${minZ.toFixed(2)},${maxX.toFixed(2)},${maxZ.toFixed(2)}`
    const triCount = comp.indices.length / 3
    const existing = byFootprint.get(key)
    if (!existing || triCount > existing.triCount) {
      byFootprint.set(key, { mesh: comp, triCount })
    }
  }

  return Array.from(byFootprint.values()).map((entry) => entry.mesh)
}

/**
 * True if the mesh's 2D footprint (x/z) intersects the selection bounds.
 *
 * PLATEAU tilesets contain huge root tiles (kilometer-scale regions), so a
 * tile-level intersection test keeps every building from all intersecting
 * tiles. Each connected component is a single building; filtering at this
 * level removes buildings far outside the requested bounds.
 */
export function componentIntersectsBounds(
  mesh: RawMesh,
  bounds: Bounds,
  tolerance = 1e-2,
  includeSpanning = true,
): boolean {
  const { minX, maxX, minZ, maxZ } = boundsToEngineXZ(bounds)

  let bMinX = Infinity
  let bMaxX = -Infinity
  let bMinZ = Infinity
  let bMaxZ = -Infinity
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const z = mesh.positions[i + 2]
    if (x < bMinX) bMinX = x
    if (x > bMaxX) bMaxX = x
    if (z < bMinZ) bMinZ = z
    if (z > bMaxZ) bMaxZ = z
  }

  if (!includeSpanning) {
    return (
      bMinX >= minX - tolerance &&
      bMaxX <= maxX + tolerance &&
      bMinZ >= minZ - tolerance &&
      bMaxZ <= maxZ + tolerance
    )
  }

  return !(
    bMaxX < minX - tolerance ||
    bMinX > maxX + tolerance ||
    bMaxZ < minZ - tolerance ||
    bMinZ > maxZ + tolerance
  )
}

/**
 * Scale a RawMesh by multiplying all position components by a uniform factor.
 * Returns a new mesh with a fresh Float32Array; does NOT mutate the input.
 */
export function scaleRawMesh(mesh: RawMesh, scale: number): RawMesh {
  if (scale === 1) return mesh
  const scaled = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i++) {
    scaled[i] = mesh.positions[i] * scale
  }
  return { positions: scaled, indices: mesh.indices }
}

/**
 * Convert a Manifold mesh representation to a RawMesh.
 * This is a pure data transformation with no external dependencies.
 */
export function meshToRaw(mesh: { vertProperties: Float32Array; triVerts: Uint32Array }): RawMesh {
  return { positions: mesh.vertProperties, indices: mesh.triVerts }
}

/**
 * Build the standard index buffer for an n×n slab: top surface grid
 * (vertices 0..n²-1), bottom surface grid (vertices n²..2n²-1, reversed
 * winding), and four side walls. Shared by the terrain slab generator and the
 * terrain cavity generator so both have identical topology.
 */
export function buildSlabIndices(n: number): Uint32Array {
  const N = n * n
  const indices: number[] = []

  // Top surface
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j
      const b = a + 1
      const c = (i + 1) * n + j
      const d = c + 1
      indices.push(a, b, c)
      indices.push(b, d, c)
    }
  }

  // Bottom surface (reversed)
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j + N
      const b = a + 1
      const c = (i + 1) * n + j + N
      const d = c + 1
      indices.push(a, c, b)
      indices.push(b, c, d)
    }
  }

  // Side walls
  for (let x = 0; x < n - 1; x++) {
    const t1 = x
    const t2 = x + 1
    const b1 = t1 + N
    const b2 = t2 + N
    indices.push(t1, b1, t2)
    indices.push(t2, b1, b2)
  }
  for (let x = 0; x < n - 1; x++) {
    const t1 = (n - 1) * n + x
    const t2 = t1 + 1
    const b1 = t1 + N
    const b2 = t2 + N
    indices.push(t1, t2, b1)
    indices.push(t2, b2, b1)
  }
  for (let y = 0; y < n - 1; y++) {
    const t1 = y * n
    const t2 = (y + 1) * n
    const b1 = t1 + N
    const b2 = t2 + N
    indices.push(t1, t2, b1)
    indices.push(t2, b2, b1)
  }
  for (let y = 0; y < n - 1; y++) {
    const t1 = y * n + (n - 1)
    const t2 = (y + 1) * n + (n - 1)
    const b1 = t1 + N
    const b2 = t2 + N
    indices.push(t1, b1, t2)
    indices.push(t2, b1, b2)
  }

  return new Uint32Array(indices)
}

/**
 * 地形スラブメッシュ（`buildTerrainMesh` の格子レイアウト）の地表高を、
 * 実際の三角形分割（`buildSlabIndices` と同じ (a,b,c)+(b,d,c) 分割）に
 * 合わせた重心座標補間で求める。
 *
 * グリッドは (x, z) の正規格子で、行 i は z の減少方向、列 j は x の増加方向。
 * 範囲外の座標は最寄りのセルにクランプして評価する。
 */
export function sampleTerrainHeightFromGrid(
  positions: Float32Array,
  gridSize: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
): number | null {
  const n = gridSize
  if (!(n >= 2)) return null
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  if (!(spanX > 0) || !(spanZ > 0)) return null

  const cellX = spanX / (n - 1)
  const cellZ = spanZ / (n - 1)
  const u = (x - bounds.minX) / cellX
  const v = (bounds.maxZ - z) / cellZ
  const j0 = Math.min(Math.max(Math.floor(u), 0), n - 2)
  const i0 = Math.min(Math.max(Math.floor(v), 0), n - 2)
  const f = Math.min(Math.max(u - j0, 0), 1)
  const g = Math.min(Math.max(v - i0, 0), 1)

  const height = (i: number, j: number): number => positions[(i * n + j) * 3 + 1]
  const ha = height(i0, j0)
  const hb = height(i0, j0 + 1)
  const hc = height(i0 + 1, j0)
  const hd = height(i0 + 1, j0 + 1)

  // buildSlabIndices と同じ分割: (a,b,c) が f+g<=1、(b,d,c) が f+g>=1
  if (f + g <= 1) {
    return ha + f * (hb - ha) + g * (hc - ha)
  }
  return hd + (1 - f) * (hc - hd) + (1 - g) * (hb - hd)
}

/**
 * Build the inner cavity solid for an open-bottom terrain shell.
 *
 * The input must be the slab mesh produced by `buildTerrainMesh` (2·n²
 * vertices: top grid followed by bottom grid). The cavity is shrunk in XZ by
 * linear scaling toward the center so the side walls keep `shellThickness`,
 * its ceiling follows the terrain relief `shellThickness` below the surface
 * (the surface height is re-sampled at the inset position with the actual
 * triangle interpolation, so steep slopes cannot make the ceiling poke
 * through the terrain), and its floor extends below the slab so that
 * subtracting it opens the model's underside (leaving only a rim of
 * `shellThickness`).
 *
 * Returns null when the mesh does not have the expected grid layout or when
 * the shell is too thick for the footprint.
 */
export function buildTerrainCavityMesh(
  terrainMesh: RawMesh,
  shellThickness: number,
): RawMesh | null {
  const t = shellThickness
  if (!Number.isFinite(t) || t <= 0) return null

  const positions = terrainMesh.positions
  const vertexCount = positions.length / 3
  const n = Math.round(Math.sqrt(vertexCount / 2))
  if (!(n >= 2) || n * n * 2 !== vertexCount) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minBottomY = Infinity
  for (let i = 0; i < n * n; i++) {
    const x = positions[i * 3]
    const z = positions[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  for (let i = n * n; i < vertexCount; i++) {
    const y = positions[i * 3 + 1]
    if (y < minBottomY) minBottomY = y
  }

  const width = maxX - minX
  const depth = maxZ - minZ
  if (!(width > 2 * t) || !(depth > 2 * t)) return null
  if (!Number.isFinite(minBottomY)) return null

  const scaleX = (width - 2 * t) / width
  const scaleZ = (depth - 2 * t) / depth
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const cavityBottomY = minBottomY - 2 * t

  const gridBounds = { minX, maxX, minZ, maxZ }
  const cavityPositions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < n * n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const insetX = centerX + (x - centerX) * scaleX
    const insetZ = centerZ + (z - centerZ) * scaleZ
    // 天井の高さは移動後の座標の地表を再サンプルする。元頂点の高さを
    // 使い回すと、急斜面（45°超）で天井が地表を突き抜けて穴になる。
    const terrainY = sampleTerrainHeightFromGrid(positions, n, gridBounds, insetX, insetZ)
    cavityPositions[i * 3] = insetX
    cavityPositions[i * 3 + 1] = (terrainY ?? y) - t
    cavityPositions[i * 3 + 2] = insetZ
  }
  for (let i = 0; i < n * n; i++) {
    const target = n * n + i
    cavityPositions[target * 3] = cavityPositions[i * 3]
    cavityPositions[target * 3 + 1] = cavityBottomY
    cavityPositions[target * 3 + 2] = cavityPositions[i * 3 + 2]
  }

  return { positions: cavityPositions, indices: buildSlabIndices(n) }
}
