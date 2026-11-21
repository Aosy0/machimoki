/**
 * エクスポートメッシュの三角形ごとの色分け。
 *
 * 地形・建物・橋梁・道路を1つの水密メッシュに統合した後、三角形の位置から
 * 色を割り当てる。道路は地形の形状を変えず、地表の三角形の色だけを変える。
 *
 * 入力メッシュは ExportOptions.scale 適用後のモデル座標（x=東, y=上, z=南）。
 * 分類もモデル座標のまま行い、高さ許容差だけ実寸換算で 0.2 * scale を使う。
 */

import type { RawMesh } from './types.js'

export interface ExportMeshColors {
  /** 地形の色 */
  terrain: string
  /** 建物の色 */
  building: string
  /** 橋梁の色 */
  bridge: string
  /** 道路（地形の色替え）の色 */
  road: string
}

export interface TriangleColorOptions {
  /** 対象メッシュ（ExportOptions.scale 適用後）。 */
  mesh: RawMesh
  /** スケール適用後の地形スラブ。地形なしなら null。 */
  terrainMesh: RawMesh | null
  /** スケール適用後の橋梁メッシュ。 */
  bridgeMeshes?: RawMesh[]
  /** スケール適用後の道路メッシュ（形状には使わない）。 */
  roadMeshes?: RawMesh[]
  /** モデル座標 → 実寸メートルの倍率（ExportOptions.scale）。 */
  scale: number
  colors: ExportMeshColors
}

export interface TriangleColorResult {
  /** 三角形ごとのパレットインデックス。 */
  perTriangle: Uint8Array
  /** 重複を除いた色（#RRGGBB）。 */
  palette: string[]
  counts: Record<'terrain' | 'building' | 'bridge' | 'road', number>
}

/** 地形の高さ許容差（実寸メートル）。モデル座標では 0.2 * scale。 */
const TERRAIN_TOLERANCE_METERS = 0.2
/** フットプリントマスクの長辺セル数（目標値）。 */
const MASK_LONG_SIDE_CELLS = 1024
/** フットプリントマスクの1軸あたりのセル数上限。 */
const MASK_MAX_AXIS_CELLS = 2048
/** フットプリントマスクの総セル数上限。 */
const MASK_MAX_CELLS = 1 << 20
/** 道路と判定するのに必要なサンプル一致数（重心＋3辺中点の4点中）。 */
const ROAD_REQUIRED_HITS = 2

/** 三角形の色種別。パレット順の添字としても使う。 */
const KIND_TERRAIN = 0
const KIND_BUILDING = 1
const KIND_BRIDGE = 2
const KIND_ROAD = 3

type ColorKind = 'terrain' | 'building' | 'bridge' | 'road'

/** パレットの並び順。使用された色をこの順で詰める。 */
const COLOR_ORDER: readonly ColorKind[] = ['terrain', 'building', 'bridge', 'road']
const KIND_ORDER: readonly number[] = [KIND_TERRAIN, KIND_BUILDING, KIND_BRIDGE, KIND_ROAD]

/** 地表高さを返すサンプラー。地形がないときは null。 */
interface TerrainHeightSampler {
  heightAt(x: number, z: number): number
}

/** XZ 平面のフットプリントマスク。 */
interface FootprintMask {
  contains(x: number, z: number): boolean
}

/**
 * 地形スラブの地表頂点から bilinear 補間の高さサンプラーを作る。
 *
 * positions の先頭 n*n 頂点が地表（n = sqrt(vertexCount / 2)）で、行優先の
 * 南→北、行内は西→東。頂点の x/z 範囲を grid に対応させる（地形の整列処理と
 * 同じ対応）。スラブの形が想定外なら null（地形なしとして扱う）。
 */
function createTerrainHeightSampler(terrainMesh: RawMesh | null): TerrainHeightSampler | null {
  if (!terrainMesh) return null
  const positions = terrainMesh.positions
  const vertexCount = Math.floor(positions.length / 3)
  const topCount = Math.floor(vertexCount / 2)
  if (topCount < 4) return null

  const gridSize = Math.round(Math.sqrt(topCount))
  if (gridSize < 2 || gridSize * gridSize !== topCount) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const heights = new Float64Array(topCount)
  for (let i = 0; i < topCount; i++) {
    const x = positions[i * 3]
    const y = positions[i * 3 + 1]
    const z = positions[i * 3 + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
    heights[i] = y
  }

  const lastIndex = gridSize - 1
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  // 頂点が一直線に並ぶ縮退地形では、その軸方向は端の列／行を使う。
  const scaleX = spanX > 0 ? lastIndex / spanX : 0
  const scaleZ = spanZ > 0 ? lastIndex / spanZ : 0

  return {
    heightAt(x: number, z: number): number {
      let fx = (x - minX) * scaleX
      let fz = (maxZ - z) * scaleZ
      if (!(fx > 0)) fx = 0
      else if (fx > lastIndex) fx = lastIndex
      if (!(fz > 0)) fz = 0
      else if (fz > lastIndex) fz = lastIndex

      const xi = Math.min(gridSize - 2, Math.floor(fx))
      const zi = Math.min(gridSize - 2, Math.floor(fz))
      const dx = fx - xi
      const dz = fz - zi
      const row0 = zi * gridSize
      const row1 = row0 + gridSize
      const h00 = heights[row0 + xi]
      const h10 = heights[row0 + xi + 1]
      const h01 = heights[row1 + xi]
      const h11 = heights[row1 + xi + 1]
      const near = h00 * (1 - dx) + h10 * dx
      const far = h01 * (1 - dx) + h11 * dx
      return near * (1 - dz) + far * dz
    },
  }
}

/**
 * レイヤーメッシュの XZ 投影をグリッドへラスタライズし、フットプリントマスクを作る。
 *
 * 長辺を 1024 セル程度にし、1軸 2048 セル・総セル 1<<20 を上限とする。
 * 三角形は bbox の範囲だけ走査し、セル中心を重心座標の符号で内外判定する。
 */
function createFootprintMask(meshes: RawMesh[] | undefined): FootprintMask | null {
  if (!meshes || meshes.length === 0) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let hasTriangle = false
  for (const mesh of meshes) {
    const positions = mesh.positions
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i]
      const z = positions[i + 2]
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    if (mesh.indices.length >= 3) hasTriangle = true
  }
  if (!hasTriangle) return null

  const width = maxX - minX
  const depth = maxZ - minZ
  if (!(width > 0) || !(depth > 0)) return null

  const cellSize = Math.max(width, depth) / MASK_LONG_SIDE_CELLS
  const nx = Math.min(MASK_MAX_AXIS_CELLS, Math.max(1, Math.ceil(width / cellSize)))
  let nz = Math.min(MASK_MAX_AXIS_CELLS, Math.max(1, Math.ceil(depth / cellSize)))
  // 総セル数の上限を超える場合は短辺方向を間引く（セルは正方形でなくなる）。
  if (nx * nz > MASK_MAX_CELLS) {
    nz = Math.max(1, Math.floor(MASK_MAX_CELLS / nx))
  }

  const cells = new Uint8Array(nx * nz)
  const toCol = nx / width
  const toRow = nz / depth

  for (const mesh of meshes) {
    const positions = mesh.positions
    const indices = mesh.indices
    const triangleCount = Math.floor(indices.length / 3)
    for (let t = 0; t < triangleCount; t++) {
      const i0 = indices[t * 3] * 3
      const i1 = indices[t * 3 + 1] * 3
      const i2 = indices[t * 3 + 2] * 3
      if (i0 + 2 >= positions.length || i1 + 2 >= positions.length || i2 + 2 >= positions.length) {
        continue
      }

      const ax = (positions[i0] - minX) * toCol
      const ay = (positions[i0 + 2] - minZ) * toRow
      const bx = (positions[i1] - minX) * toCol
      const by = (positions[i1 + 2] - minZ) * toRow
      const cx = (positions[i2] - minX) * toCol
      const cy = (positions[i2 + 2] - minZ) * toRow

      // XZ に投影した面積が 0 の三角形（鉛直面）はマスクへ寄与しない。
      const area2 = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
      if (!(area2 !== 0)) continue

      const colStart = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
      const colEnd = Math.min(nx - 1, Math.ceil(Math.max(ax, bx, cx)))
      const rowStart = Math.max(0, Math.floor(Math.min(ay, by, cy)))
      const rowEnd = Math.min(nz - 1, Math.ceil(Math.max(ay, by, cy)))
      if (colStart > colEnd || rowStart > rowEnd) continue

      for (let row = rowStart; row <= rowEnd; row++) {
        const py = row + 0.5
        const rowOffset = row * nx
        for (let col = colStart; col <= colEnd; col++) {
          if (cells[rowOffset + col] !== 0) continue
          const px = col + 0.5
          const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / area2
          const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / area2
          if (wa >= 0 && wb >= 0 && wa + wb <= 1) {
            cells[rowOffset + col] = 1
          }
        }
      }
    }
  }

  return {
    contains(x: number, z: number): boolean {
      if (!(x >= minX && x <= maxX && z >= minZ && z <= maxZ)) return false
      const col = Math.min(nx - 1, Math.floor((x - minX) * toCol))
      const row = Math.min(nz - 1, Math.floor((z - minZ) * toRow))
      return cells[row * nx + col] !== 0
    },
  }
}

/** 色の重複判定用キー（大文字化し # を補う）。パレットには元の文字列を残す。 */
function colorKey(color: string): string {
  const trimmed = color.trim()
  return (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toUpperCase()
}

/**
 * 最終メッシュの三角形へ色を割り当てる。
 * 地形の上面で道路範囲内なら道路色、地形より上なら橋梁範囲なら橋梁色、
 * それ以外は建物色、地表以下は地形色。
 */
export function assignTriangleColors(options: TriangleColorOptions): TriangleColorResult {
  const { mesh, terrainMesh, bridgeMeshes, roadMeshes, scale, colors } = options
  const positions = mesh.positions
  const indices = mesh.indices
  const triangleCount = Math.floor(indices.length / 3)

  const perTriangle = new Uint8Array(triangleCount)
  const counts: Record<ColorKind, number> = { terrain: 0, building: 0, bridge: 0, road: 0 }
  if (triangleCount === 0) {
    return { perTriangle, palette: [], counts }
  }

  const terrain = createTerrainHeightSampler(terrainMesh)
  const bridgeMask = createFootprintMask(bridgeMeshes)
  // 道路は地表の色替えなので、地形がなければ判定しない。
  const roadMask = terrain ? createFootprintMask(roadMeshes) : null
  const tolerance = TERRAIN_TOLERANCE_METERS * (Number.isFinite(scale) ? scale : 0)

  const kinds = new Uint8Array(triangleCount)
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3] * 3
    const i1 = indices[t * 3 + 1] * 3
    const i2 = indices[t * 3 + 2] * 3
    const ax = positions[i0]
    const az = positions[i0 + 2]
    const bx = positions[i1]
    const bz = positions[i1 + 2]
    const cx = positions[i2]
    const cz = positions[i2 + 2]
    const gx = (ax + bx + cx) / 3
    const gy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3
    const gz = (az + bz + cz) / 3

    // サンプル点は重心＋3辺の中点。
    let bridgeHits = 0
    if (bridgeMask) {
      if (bridgeMask.contains(gx, gz)) bridgeHits++
      if (bridgeMask.contains((ax + bx) / 2, (az + bz) / 2)) bridgeHits++
      if (bridgeMask.contains((bx + cx) / 2, (bz + cz) / 2)) bridgeHits++
      if (bridgeMask.contains((cx + ax) / 2, (cz + az) / 2)) bridgeHits++
    }

    let kind: number
    if (!terrain) {
      kind = bridgeHits > 0 ? KIND_BRIDGE : KIND_BUILDING
    } else {
      const aboveGround = gy > terrain.heightAt(gx, gz) + tolerance
      if (aboveGround) {
        kind = bridgeHits > 0 ? KIND_BRIDGE : KIND_BUILDING
      } else {
        let roadHits = 0
        if (roadMask) {
          if (roadMask.contains(gx, gz)) roadHits++
          if (roadMask.contains((ax + bx) / 2, (az + bz) / 2)) roadHits++
          if (roadMask.contains((bx + cx) / 2, (bz + cz) / 2)) roadHits++
          if (roadMask.contains((cx + ax) / 2, (cz + az) / 2)) roadHits++
        }
        kind = roadHits >= ROAD_REQUIRED_HITS ? KIND_ROAD : KIND_TERRAIN
      }
    }

    kinds[t] = kind
    counts[COLOR_ORDER[kind]]++
  }

  // 実際に使った色だけを [terrain, building, bridge, road] 順に詰める。
  const palette: string[] = []
  const paletteIndexByColor = new Map<string, number>()
  const kindPaletteIndex = [-1, -1, -1, -1]
  for (let k = 0; k < KIND_ORDER.length; k++) {
    const kind = KIND_ORDER[k]
    if (counts[COLOR_ORDER[kind]] === 0) continue
    const color = colors[COLOR_ORDER[kind]].trim()
    const key = colorKey(color)
    let index = paletteIndexByColor.get(key)
    if (index === undefined) {
      index = palette.length
      palette.push(color)
      paletteIndexByColor.set(key, index)
    }
    kindPaletteIndex[kind] = index
  }

  for (let t = 0; t < triangleCount; t++) {
    perTriangle[t] = kindPaletteIndex[kinds[t]]
  }

  return { perTriangle, palette, counts }
}
