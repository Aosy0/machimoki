/**
 * Cap open-bottomed building shells so they become closed solids.
 *
 * PLATEAU LOD1/LOD2 building meshes are often extruded footprints with walls
 * and a roof but no floor. This utility adds a floor (bottom cap) so the mesh
 * can be converted to a Manifold solid for 3MF/STL export.
 */

import type { RawMesh } from './types.js'

/**
 * Weld nearly-coincident vertices so triangle adjacency reflects shared edges.
 *
 * PLATEAU glTF data often stores buildings as unwelded triangle soups where
 * spatially coincident vertices have separate indices. Without welding,
 * splitConnectedComponents would treat every triangle as its own component.
 */
export function weldVertices(mesh: RawMesh, tolerance = 1e-5): RawMesh {
  if (mesh.positions.length === 0) return mesh

  const cellSize = tolerance
  const cells = new Map<string, number[]>()
  const newPositions: number[] = []
  const remap = new Uint32Array(mesh.positions.length / 3)

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const y = mesh.positions[i + 1]
    const z = mesh.positions[i + 2]

    const cx = Math.floor(x / cellSize)
    const cy = Math.floor(y / cellSize)
    const cz = Math.floor(z / cellSize)

    let foundIdx: number | undefined
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = cells.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (list) {
            for (const idx of list) {
              const ox = newPositions[idx * 3]
              const oy = newPositions[idx * 3 + 1]
              const oz = newPositions[idx * 3 + 2]
              if (
                Math.abs(ox - x) <= tolerance &&
                Math.abs(oy - y) <= tolerance &&
                Math.abs(oz - z) <= tolerance
              ) {
                foundIdx = idx
                break outer
              }
            }
          }
        }
      }
    }

    if (foundIdx === undefined) {
      foundIdx = newPositions.length / 3
      const key = `${cx},${cy},${cz}`
      const list = cells.get(key) ?? []
      list.push(foundIdx)
      cells.set(key, list)
      newPositions.push(x, y, z)
    }
    remap[i / 3] = foundIdx
  }

  const newIndices = new Uint32Array(mesh.indices.length)
  for (let i = 0; i < mesh.indices.length; i++) {
    newIndices[i] = remap[mesh.indices[i]]
  }

  return { positions: new Float32Array(newPositions), indices: newIndices }
}

interface Point2D {
  x: number
  z: number
}

function cross(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
}

function convexHull2D(points: Point2D[]): Point2D[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z)
  if (sorted.length < 3) return sorted

  const lower: Point2D[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Point2D[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
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
      return i / 3
    }
  }
  const index = positions.length / 3
  positions.push(x, y, z)
  return index
}

/**
 * Add a bottom cap to a mesh whose minimum-Y face is open.
 *
 * The cap is the convex hull of the bottom vertices, triangulated as a fan
 * from the hull centroid. This is a conservative approximation of the building
 * footprint and is sufficient for typical LOD1 extruded polygons.
 */
export function splitConnectedComponents(mesh: RawMesh): RawMesh[] {
  const numTriangles = mesh.indices.length / 3
  if (numTriangles === 0) return []

  const edgeToTriangles = new Map<string, number[]>()
  function addEdge(v0: number, v1: number, triIdx: number) {
    const key = v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`
    const list = edgeToTriangles.get(key)
    if (list) list.push(triIdx)
    else edgeToTriangles.set(key, [triIdx])
  }

  for (let triIdx = 0; triIdx < numTriangles; triIdx++) {
    const i0 = mesh.indices[triIdx * 3]
    const i1 = mesh.indices[triIdx * 3 + 1]
    const i2 = mesh.indices[triIdx * 3 + 2]
    addEdge(i0, i1, triIdx)
    addEdge(i1, i2, triIdx)
    addEdge(i2, i0, triIdx)
  }

  const visited = new Uint8Array(numTriangles)
  const components: RawMesh[] = []

  for (let startTri = 0; startTri < numTriangles; startTri++) {
    if (visited[startTri]) continue

    const triQueue: number[] = [startTri]
    visited[startTri] = 1
    const triIndices: number[] = []

    while (triQueue.length > 0) {
      const triIdx = triQueue.pop()!
      triIndices.push(triIdx)

      const i0 = mesh.indices[triIdx * 3]
      const i1 = mesh.indices[triIdx * 3 + 1]
      const i2 = mesh.indices[triIdx * 3 + 2]

      const neighbors: number[] = []
      const key01 = i0 < i1 ? `${i0},${i1}` : `${i1},${i0}`
      const key12 = i1 < i2 ? `${i1},${i2}` : `${i2},${i1}`
      const key20 = i2 < i0 ? `${i2},${i0}` : `${i0},${i2}`
      for (const key of [key01, key12, key20]) {
        const list = edgeToTriangles.get(key)
        if (list) {
          for (const n of list) {
            if (n !== triIdx && !visited[n]) neighbors.push(n)
          }
        }
      }

      for (const n of neighbors) {
        visited[n] = 1
        triQueue.push(n)
      }
    }

    const usedVerts = new Set<number>()
    for (const triIdx of triIndices) {
      usedVerts.add(mesh.indices[triIdx * 3])
      usedVerts.add(mesh.indices[triIdx * 3 + 1])
      usedVerts.add(mesh.indices[triIdx * 3 + 2])
    }

    const sortedVerts = Array.from(usedVerts).sort((a, b) => a - b)
    const oldToNew = new Map<number, number>()
    for (let i = 0; i < sortedVerts.length; i++) {
      oldToNew.set(sortedVerts[i], i)
    }

    const newPositions = new Float32Array(sortedVerts.length * 3)
    for (let i = 0; i < sortedVerts.length; i++) {
      const oldIdx = sortedVerts[i]
      newPositions[i * 3] = mesh.positions[oldIdx * 3]
      newPositions[i * 3 + 1] = mesh.positions[oldIdx * 3 + 1]
      newPositions[i * 3 + 2] = mesh.positions[oldIdx * 3 + 2]
    }

    const newIndices = new Uint32Array(triIndices.length * 3)
    for (let i = 0; i < triIndices.length; i++) {
      const triIdx = triIndices[i]
      newIndices[i * 3] = oldToNew.get(mesh.indices[triIdx * 3])!
      newIndices[i * 3 + 1] = oldToNew.get(mesh.indices[triIdx * 3 + 1])!
      newIndices[i * 3 + 2] = oldToNew.get(mesh.indices[triIdx * 3 + 2])!
    }

    components.push({ positions: newPositions, indices: newIndices })
  }

  return components
}

export interface BuildingBottomFootprint {
  /** Convex hull of the bottom vertices in the XZ plane. */
  hull: Point2D[]
  /** Lowest Y coordinate of the building mesh. */
  minY: number
}

/**
 * Extract the convex hull of a building's bottom vertices (its footprint).
 *
 * Used by bottom capping and by open-bottom hollowing, which needs the
 * footprint to extend a shaft below the building.
 */
export function buildingBottomFootprint(
  mesh: RawMesh,
  tolerance = 1e-6,
): BuildingBottomFootprint | null {
  const positions = mesh.positions
  let minY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i]
  }
  if (!Number.isFinite(minY)) return null

  const bottomVertices = new Map<string, Point2D>()
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] <= minY + tolerance) {
      const x = positions[i]
      const z = positions[i + 2]
      const key = `${x.toFixed(8)},${z.toFixed(8)}`
      bottomVertices.set(key, { x, z })
    }
  }

  const hull = convexHull2D(Array.from(bottomVertices.values()))
  if (hull.length < 3) return null
  return { hull, minY }
}

/**
 * 底面の境界が「単一の凸ループ」かどうかを判定する。
 *
 * 凸包キャップ（`capBuildingBottom`）は底面が凸の単一ループのときだけ正確な
 * 修復になる。凹形状・中庭・複数ループ・境界が汚い場合は修復対象外として
 * 扱い、呼び出し側は建物をスキップする判断に使う。
 */
export function bottomBoundaryIsConvex(mesh: RawMesh, tolerance = 0): boolean {
  const positions = mesh.positions
  const indices = mesh.indices
  if (positions.length === 0 || indices.length === 0) return false

  let minY = Infinity
  let maxY = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return false

  const yTolerance = Math.max(tolerance, (maxY - minY) * 0.02)
  const footprintDiagonal = Math.hypot(maxX - minX, maxZ - minZ)
  if (!(footprintDiagonal > 0)) return false

  const isBottomVertex = (vertexIndex: number): boolean =>
    positions[vertexIndex * 3 + 1] <= minY + yTolerance

  const edgeCounts = new Map<string, number>()
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = u < v ? `${u},${v}` : `${v},${u}`
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }

  // 底面近傍の境界エッジ（1枚の三角形しか接していない辺）を集める
  const adjacency = new Map<number, number[]>()
  let bottomEdgeCount = 0
  for (const [key, count] of edgeCounts) {
    if (count !== 1) continue
    const [u, v] = key.split(',').map(Number)
    if (!isBottomVertex(u) || !isBottomVertex(v)) continue
    bottomEdgeCount++
    const uList = adjacency.get(u)
    if (uList) uList.push(v)
    else adjacency.set(u, [v])
    const vList = adjacency.get(v)
    if (vList) vList.push(u)
    else adjacency.set(v, [u])
  }
  if (bottomEdgeCount < 3 || adjacency.size < 3) return false

  // 全頂点の次数2 ＝ 単一の閉ループ（分岐・複数ループなし）
  for (const neighbors of adjacency.values()) {
    if (neighbors.length !== 2) return false
  }

  // 全頂点が凸包の頂点と一致すること（＝凹みなし）
  const points: Point2D[] = []
  for (const vertexIndex of adjacency.keys()) {
    points.push({ x: positions[vertexIndex * 3], z: positions[vertexIndex * 3 + 2] })
  }
  const hull = convexHull2D(points)
  if (hull.length < 3) return false
  const margin = Math.max(tolerance, footprintDiagonal * 0.01)
  for (const point of points) {
    let onHull = false
    for (const hullPoint of hull) {
      if (Math.abs(hullPoint.x - point.x) <= margin && Math.abs(hullPoint.z - point.z) <= margin) {
        onHull = true
        break
      }
    }
    if (!onHull) return false
  }
  return true
}

/**
 * メッシュの符号付き体積（発散定理）。開いたシェルでも、巻き順が外向きか
 * 内向きかの判定に使える。
 */
function signedVolume(mesh: RawMesh): number {
  const positions = mesh.positions
  const indices = mesh.indices
  let volume = 0
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3
    const b = indices[t + 1] * 3
    const c = indices[t + 2] * 3
    volume +=
      (positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
        positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
        positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c])) /
      6
  }
  return volume
}

export function capBuildingBottom(mesh: RawMesh, tolerance = 1e-6): RawMesh {
  const footprint = buildingBottomFootprint(mesh, tolerance)
  if (!footprint) return mesh

  const positions = Array.from(mesh.positions)
  const indices = Array.from(mesh.indices)
  const { hull, minY } = footprint

  let centroidX = 0
  let centroidZ = 0
  for (const p of hull) {
    centroidX += p.x
    centroidZ += p.z
  }
  centroidX /= hull.length
  centroidZ /= hull.length

  const centroidIndex = findOrAddVertex(positions, centroidX, minY, centroidZ, tolerance)

  // シェルの巻き順（外向き/内向き）に合わせてキャップの向きを決める。
  // 外向きのシェルには下向き（-Y）のキャップが必要で、内向きではその逆になる。
  const outward = signedVolume(mesh) > 0

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const aIndex = findOrAddVertex(positions, a.x, minY, a.z, tolerance)
    const bIndex = findOrAddVertex(positions, b.x, minY, b.z, tolerance)
    if (outward) {
      indices.push(centroidIndex, aIndex, bIndex)
    } else {
      indices.push(centroidIndex, bIndex, aIndex)
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  }
}
