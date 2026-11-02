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
export function sampleGridHeightFromGrid(
  positions: Float32Array,
  gridSize: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
  vertexOffset = 0,
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

  const height = (i: number, j: number): number => positions[(vertexOffset + i * n + j) * 3 + 1]
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

/** 地形スラブの地表高を求める（top grid）。 */
export function sampleTerrainHeightFromGrid(
  positions: Float32Array,
  gridSize: number,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  x: number,
  z: number,
): number | null {
  return sampleGridHeightFromGrid(positions, gridSize, bounds, x, z, 0)
}

/**
 * 地形スラブ格子から、内側へ `inset` だけ縮小したスラブメッシュを構築する。
 *
 * 上面は移動後の座標の地表を再サンプルして `topOffset` を加え、底面は
 * `resolveBottomY` が返す一定の高さ（水平）にする。空洞（天井が起伏・底面が
 * スラブ下）と中実ベース（上面が起伏・底面が水平）の共通実装。
 *
 * 地表高を再サンプルするのは、元頂点の高さを使い回すと急斜面（45°超）で
 * 上面が地表を突き抜けて穴になるため。
 *
 * 格子レイアウトでない場合や、足跡が縮小に足りない場合は null。
 */
function buildInsetTerrainSlabMesh(
  terrainMesh: RawMesh,
  inset: number,
  topOffset: number,
  resolveBottomY: (minTopY: number, minBottomY: number) => number,
): RawMesh | null {
  if (!Number.isFinite(inset) || inset <= 0) return null

  const positions = terrainMesh.positions
  const vertexCount = positions.length / 3
  const n = Math.round(Math.sqrt(vertexCount / 2))
  if (!(n >= 2) || n * n * 2 !== vertexCount) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minTopY = Infinity
  let minBottomY = Infinity
  for (let i = 0; i < n * n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    if (y < minTopY) minTopY = y
  }
  for (let i = n * n; i < vertexCount; i++) {
    const y = positions[i * 3 + 1]
    if (y < minBottomY) minBottomY = y
  }

  const width = maxX - minX
  const depth = maxZ - minZ
  if (!(width > 2 * inset) || !(depth > 2 * inset)) return null
  if (!Number.isFinite(minTopY) || !Number.isFinite(minBottomY)) return null

  const scaleX = (width - 2 * inset) / width
  const scaleZ = (depth - 2 * inset) / depth
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  const bottomY = resolveBottomY(minTopY, minBottomY)

  const gridBounds = { minX, maxX, minZ, maxZ }
  const outPositions = new Float32Array(vertexCount * 3)
  for (let i = 0; i < n * n; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    const insetX = centerX + (x - centerX) * scaleX
    const insetZ = centerZ + (z - centerZ) * scaleZ
    const terrainY = sampleTerrainHeightFromGrid(positions, n, gridBounds, insetX, insetZ)
    outPositions[i * 3] = insetX
    outPositions[i * 3 + 1] = (terrainY ?? y) + topOffset
    outPositions[i * 3 + 2] = insetZ
  }
  for (let i = 0; i < n * n; i++) {
    const target = n * n + i
    outPositions[target * 3] = outPositions[i * 3]
    outPositions[target * 3 + 1] = bottomY
    outPositions[target * 3 + 2] = outPositions[i * 3 + 2]
  }

  return { positions: outPositions, indices: buildSlabIndices(n) }
}

/**
 * Build the inner cavity solid for an open-bottom terrain shell.
 *
 * The input must be the slab mesh produced by `buildTerrainMesh` (2·n²
 * vertices: top grid followed by bottom grid). The cavity is shrunk in XZ by
 * linear scaling toward the center so the side walls keep `shellThickness`,
 * its ceiling follows the terrain relief `shellThickness` below the surface,
 * and its floor extends below the slab so that subtracting it opens the
 * model's underside (leaving only a rim of `shellThickness`).
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
  return buildInsetTerrainSlabMesh(terrainMesh, t, -t, (_minTopY, minBottomY) => minBottomY - 2 * t)
}

/** ベース上面をプレート下面へ食い込ませる比率（シェル厚みに対する）。 */
const BASE_TOP_OVERLAP_RATIO = 0.1

/**
 * 建物部分の下面を平らにする「短い中実ベース」メッシュを構築する。
 *
 * 足跡は空洞境界から `clearance` 内側（= スラブ外形から shellThickness +
 * clearance 内側）なので、枠の内壁とは交差せずクリアランス分だけ嵌まる。
 * 上面は地表から `shellThickness - overlap` 下（プレート下面へ少し食い込む）、
 * 底面は地形の最低点から `shellThickness + extension` 下の水平面。
 * プレート下の凹凸を埋めるため中実（リングではない）。
 *
 * `shellThickness` / `clearance` / `extension` は同じ座標空間の値で渡す。
 *
 * Returns null when the mesh does not have the expected grid layout or when
 * the inset footprint collapses.
 */
export function buildBaseSlabMesh(
  terrainMesh: RawMesh,
  shellThickness: number,
  clearance: number,
  extension: number,
): RawMesh | null {
  const t = shellThickness
  if (!Number.isFinite(t) || t <= 0) return null
  if (!Number.isFinite(clearance) || clearance < 0) return null
  if (!Number.isFinite(extension) || extension < 0) return null
  return buildInsetTerrainSlabMesh(
    terrainMesh,
    t + clearance,
    -t + t * BASE_TOP_OVERLAP_RATIO,
    (minTopY) => minTopY - t - extension,
  )
}

/** 枠上面をプレート内へ食い込ませる比率（シェル厚みに対する）。 */
const FRAME_TOP_OVERLAP_RATIO = 0.1

/**
 * 地形枠カッター（L 字断面）メッシュを構築する。
 *
 * 3 ループの閉じた単一シェル:
 * - 外周 O: 上 = 地表、下 = 地形スラブ底面。
 * - ミッド S = C + step: 上 = 地表、下 = リング上端（terrain - 0.9t）。
 * - 内周 C（空洞壁とのゼロ厚を避けるため eps だけ内側）: 上 = リング上端、
 *   下 = 地形スラブ底面。
 * 面は上面 O..S、段差 S..C、底面 O..C、外周壁 O、S 内面、内周壁 C。
 * 1 メッシュなので union 不要（外周の union 残渣が出ない）。
 *
 * 枠の露出地形帯 O..S は地表まで、内側の段差 S..C はリング上端で建物側
 * プレートの外周を受ける。step はシェル厚み未満の正値であること。
 */
export function buildFrameCutterMesh(
  terrainMesh: RawMesh,
  cavityMesh: RawMesh,
  shellThickness: number,
  step: number,
): RawMesh | null {
  const t = shellThickness
  if (!(t > 0) || !(step > 0) || !(step < t)) return null

  const tp = terrainMesh.positions
  const terrainVertexCount = tp.length / 3
  const n = Math.round(Math.sqrt(terrainVertexCount / 2))
  if (!(n >= 2) || n * n * 2 !== terrainVertexCount) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < n * n; i++) {
    const x = tp[i * 3]
    const z = tp[i * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const gridBounds = { minX, maxX, minZ, maxZ }
  if (!(maxX > minX) || !(maxZ > minZ)) return null

  const cp = cavityMesh.positions
  const cavityVertexCount = cp.length / 3
  const cn = Math.round(Math.sqrt(cavityVertexCount / 2))
  if (!(cn >= 2) || cn * cn * 2 !== cavityVertexCount) return null
  let cMinX = Infinity
  let cMaxX = -Infinity
  let cMinZ = Infinity
  let cMaxZ = -Infinity
  for (let i = 0; i < cn * cn; i++) {
    const x = cp[i * 3]
    const z = cp[i * 3 + 2]
    if (x < cMinX) cMinX = x
    if (x > cMaxX) cMaxX = x
    if (z < cMinZ) cMinZ = z
    if (z > cMaxZ) cMaxZ = z
  }
  if (!(cMaxX > cMinX) || !(cMaxZ > cMinZ)) return null

  // 内周を空洞壁と一致させるとブール演算がゼロ厚の面を残すため、わずかに
  // 食い込ませる（印刷寸法では無視できる差）。S はその外側でなければならない。
  const eps = t * 0.01
  if (!(step > eps)) return null
  const iMinX = cMinX + eps
  const iMaxX = cMaxX - eps
  const iMinZ = cMinZ + eps
  const iMaxZ = cMaxZ - eps
  // S = C + step。step < t なので外形 O の内側に収まる。
  const sMinX = cMinX - step
  const sMaxX = cMaxX + step
  const sMinZ = cMinZ - step
  const sMaxZ = cMaxZ + step
  if (!(sMinX > minX) || !(sMaxX < maxX) || !(sMinZ > minZ) || !(sMaxZ < maxZ)) return null

  const segments = Math.max(1, Math.min(256, n - 1))
  const outer = buildRectLoop(minX, maxX, minZ, maxZ, segments)
  const mid = buildRectLoop(sMinX, sMaxX, sMinZ, sMaxZ, segments)
  const inner = buildRectLoop(iMinX, iMaxX, iMinZ, iMaxZ, segments)
  const count = outer.length
  if (count !== mid.length || count !== inner.length || count < 4) return null

  const overlap = t * FRAME_TOP_OVERLAP_RATIO
  const bottomOffset = n * n
  // 1 頂点につき 6 種: O top / O bottom / S top / S bottom / C top / C bottom。
  const positions: number[] = []
  for (let i = 0; i < count; i++) {
    const [ox, oz] = outer[i]
    const [mx, mz] = mid[i]
    const [ix, iz] = inner[i]
    const oTop = sampleGridHeightFromGrid(tp, n, gridBounds, ox, oz, 0)
    const oBottom = sampleGridHeightFromGrid(tp, n, gridBounds, ox, oz, bottomOffset)
    const sTop = sampleGridHeightFromGrid(tp, n, gridBounds, mx, mz, 0)
    const cTop = sampleGridHeightFromGrid(tp, n, gridBounds, ix, iz, 0)
    const cBottom = sampleGridHeightFromGrid(tp, n, gridBounds, ix, iz, bottomOffset)
    if (oTop === null || oBottom === null || sTop === null || cTop === null) return null
    if (cBottom === null) return null
    positions.push(ox, oTop, oz)
    positions.push(ox, oBottom, oz)
    positions.push(mx, sTop, mz)
    positions.push(mx, sTop - t + overlap, mz)
    positions.push(ix, cTop - t + overlap, iz)
    positions.push(ix, cBottom, iz)
  }

  const indices: number[] = []
  const at = (i: number, kind: 0 | 1 | 2 | 3 | 4 | 5): number => i * 6 + kind
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const oti = at(i, 0)
    const obi = at(i, 1)
    const mti = at(i, 2)
    const mbi = at(i, 3)
    const cti = at(i, 4)
    const cbi = at(i, 5)
    const otj = at(j, 0)
    const obj = at(j, 1)
    const mtj = at(j, 2)
    const mbj = at(j, 3)
    const ctj = at(j, 4)
    const cbj = at(j, 5)
    // 上面 O..S（+Y）
    indices.push(oti, mti, mtj, oti, mtj, otj)
    // 段差 S..C（+Y）
    indices.push(mbi, cti, ctj, mbi, ctj, mbj)
    // 底面 O..C（-Y）
    indices.push(obi, cbj, cbi, obi, obj, cbj)
    // 外周壁 O（外側向き）
    indices.push(oti, otj, obj, oti, obj, obi)
    // フランジ内面 S（内側向き）
    indices.push(mti, mbj, mtj, mti, mbi, mbj)
    // 内周壁 C（内側向き）
    indices.push(cti, cbj, ctj, cti, cbi, cbj)
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}

/** 矩形ループ（x-z 平面・正の面積方向）を各辺 segments 分割で返す。始点は重複させない。 */
function buildRectLoop(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  segments: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  const n = Math.max(1, Math.floor(segments))
  for (let i = 0; i < n; i++) points.push([minX + ((maxX - minX) * i) / n, minZ])
  for (let i = 0; i < n; i++) points.push([maxX, minZ + ((maxZ - minZ) * i) / n])
  for (let i = 0; i < n; i++) points.push([maxX - ((maxX - minX) * i) / n, maxZ])
  for (let i = 0; i < n; i++) points.push([minX, maxZ - ((maxZ - minZ) * i) / n])
  return points
}
