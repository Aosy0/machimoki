/**
 * 完成メッシュへの刻印適用（パイプライン連携）。
 *
 * 地形メッシュから実際の面の寸法・位置を求め、レイアウト→カッター生成→
 * subtract まで行う。呼び出し側は戻り値の manifold を新しい完成形状として
 * 使い、元の Manifold は破棄する。刻印できない場合も警告を返す。
 */

import type { Manifold } from 'manifold-3d'
import type { RawMesh } from '../types.js'
import { computeEngravingFaceDims } from './faces.js'
import type { EngravingFont } from './font.js'
import { getEngravingFont } from './fontProvider.js'
import type { EngravingFaceFrame } from './geometry.js'
import { buildEngravingCutter } from './geometry.js'
import { layoutEngraving } from './layout.js'
import type { EngravingFace, EngravingOptions } from './types.js'
import { MIN_REMAINING_WALL_MM } from './types.js'

export interface EngravingTerrainContext {
  terrainMesh: RawMesh | null
  terrainThicknessMm: number
  shellThicknessMm: number
  openBottom: boolean
  splitAtGround: boolean
  /** 底面が水平か（flattenBottom || reflectActualElevation） */
  flatBottom: boolean
}

export interface EngravingApplyResult {
  /** 刻印済みの完成形状（null = 刻印していない） */
  manifold: Manifold | null
  warnings: string[]
}

interface TerrainExtents {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minTopY: number
  maxBottomY: number
  bottomIsFlat: boolean
}

/** 地形スラブ（2·n² 頂点）から面の寸法に必要な範囲を求める。 */
function measureTerrain(terrainMesh: RawMesh): TerrainExtents | null {
  const positions = terrainMesh.positions
  const vertexCount = positions.length / 3
  const n = Math.round(Math.sqrt(vertexCount / 2))
  if (!(n >= 2) || n * n * 2 !== vertexCount) return null

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let minTopY = Number.POSITIVE_INFINITY
  let minBottomY = Number.POSITIVE_INFINITY
  let maxBottomY = Number.NEGATIVE_INFINITY
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
    if (y > maxBottomY) maxBottomY = y
  }
  if (![minX, maxX, minZ, maxZ, minTopY, maxBottomY].every(Number.isFinite)) return null
  if (!(maxX > minX) || !(maxZ > minZ)) return null
  // 底面の高さむらが0.001mm未満なら水平とみなす（モデル空間m）。
  const bottomIsFlat = maxBottomY - minBottomY < 1e-6
  return { minX, maxX, minZ, maxZ, minTopY, maxBottomY, bottomIsFlat }
}

/** 面ごとの位置・向き（モデル空間m）。 */
function buildFaceFrame(
  face: EngravingFace,
  extents: TerrainExtents,
  widthMm: number,
  heightMm: number,
  bandTopY: number,
): EngravingFaceFrame | null {
  const centerX = (extents.minX + extents.maxX) / 2
  const centerZ = (extents.minZ + extents.maxZ) / 2
  const bandBottomY = extents.maxBottomY
  const sideCenterY = bandBottomY + (bandTopY - bandBottomY) / 2
  switch (face) {
    case 'bottom': {
      if (!extents.bottomIsFlat) return null
      return {
        face,
        widthMm,
        heightMm,
        center: [centerX, extents.maxBottomY, centerZ],
        u: [1, 0, 0],
        // 裏返して読む前提: 文字の上方向は南（+Z）。
        v: [0, 0, 1],
        normal: [0, -1, 0],
      }
    }
    case 'south':
      return {
        face,
        widthMm,
        heightMm,
        center: [centerX, sideCenterY, extents.maxZ],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
      }
    case 'north':
      return {
        face,
        widthMm,
        heightMm,
        center: [centerX, sideCenterY, extents.minZ],
        u: [-1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, -1],
      }
    case 'east':
      return {
        face,
        widthMm,
        heightMm,
        center: [extents.maxX, sideCenterY, centerZ],
        u: [0, 0, -1],
        v: [0, 1, 0],
        normal: [1, 0, 0],
      }
    case 'west':
      return {
        face,
        widthMm,
        heightMm,
        center: [extents.minX, sideCenterY, centerZ],
        u: [0, 0, 1],
        v: [0, 1, 0],
        normal: [-1, 0, 0],
      }
    default:
      return null
  }
}

/**
 * 完成形状に刻印を適用する。刻印できない場合は manifold = null を返し、
 * 理由を warnings に積む。例外は投げない（呼び出し側は元の形状を使える）。
 */
export async function applyEngravingToManifold(
  final: Manifold,
  options: EngravingOptions,
  ctx: EngravingTerrainContext,
): Promise<EngravingApplyResult> {
  const warnings: string[] = []
  if (!options.enabled) return { manifold: null, warnings }
  if (!ctx.terrainMesh) {
    warnings.push('刻印: 地形を含めない場合は刻印できません')
    return { manifold: null, warnings }
  }
  const extents = measureTerrain(ctx.terrainMesh)
  if (!extents) {
    warnings.push('刻印: 地形メッシュの形式が想定と異なるため刻印をスキップしました')
    return { manifold: null, warnings }
  }

  const widthMm = (extents.maxX - extents.minX) * 1000
  const faceDepthMm = (extents.maxZ - extents.minZ) * 1000
  const faceDims = computeEngravingFaceDims({
    widthMm,
    depthMm: faceDepthMm,
    terrainThicknessMm: ctx.terrainThicknessMm,
    shellThicknessMm: ctx.shellThicknessMm,
    hasTerrain: true,
    flatBottom: ctx.flatBottom && extents.bottomIsFlat,
    openBottom: ctx.openBottom,
    splitAtGround: ctx.splitAtGround,
  }).find((dims) => dims.face === options.face)

  if (!faceDims) return { manifold: null, warnings }
  if (!faceDims.available) {
    warnings.push(`刻印: ${faceDims.unavailableReason ?? 'この面には刻印できません'}`)
    return { manifold: null, warnings }
  }

  // 側面は地形の起伏を考慮した実際の帯の高さでレイアウトする。
  const miterM = ctx.splitAtGround ? (0.9 * ctx.shellThicknessMm) / 1000 : 0
  const bandTopY = extents.minTopY - miterM
  const faceHeightMm =
    options.face === 'bottom'
      ? faceDims.heightMm
      : Math.min(faceDims.heightMm, (bandTopY - extents.maxBottomY) * 1000)
  if (!(faceHeightMm > 0)) {
    warnings.push('刻印: この面に刻印できる高さがありません')
    return { manifold: null, warnings }
  }

  let font: EngravingFont
  try {
    font = await getEngravingFont()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`刻印: フォントを読み込めないためスキップしました（${message}）`)
    return { manifold: null, warnings }
  }

  const layout = layoutEngraving(
    { ...faceDims, widthMm: faceDims.widthMm, heightMm: faceHeightMm },
    options,
    font,
  )
  if (layout.lines.length === 0) {
    warnings.push('刻印: 刻印する内容がありません')
    return { manifold: null, warnings }
  }
  if (!layout.fits) {
    const reasons: string[] = []
    if (layout.overflowX || layout.overflowY) reasons.push('文字が面に収まっていません')
    if (layout.unsupportedChars.length > 0) {
      reasons.push(`未対応の文字があります（${layout.unsupportedChars.join(' ')}）`)
    }
    warnings.push(`刻印をスキップしました: ${reasons.join(' / ')}`)
    return { manifold: null, warnings }
  }

  let depthMm = Number.isFinite(options.depthMm) ? Math.max(0.2, options.depthMm) : 0.4
  const maxDepthMm =
    faceDims.wallThicknessMm > 0
      ? faceDims.wallThicknessMm - MIN_REMAINING_WALL_MM
      : Number.POSITIVE_INFINITY
  if (Number.isFinite(maxDepthMm) && depthMm > maxDepthMm) {
    depthMm = Math.max(0.2, maxDepthMm)
    warnings.push(`刻印: 肉厚を確保するため刻印深さを${depthMm.toFixed(2)}mmに抑えました`)
  }

  const frame = buildFaceFrame(options.face, extents, faceDims.widthMm, faceHeightMm, bandTopY)
  if (!frame) {
    warnings.push('刻印: 面の位置を特定できませんでした')
    return { manifold: null, warnings }
  }

  let cutter: Manifold | null
  try {
    cutter = await buildEngravingCutter({ frame, layout, font, depthMm })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`刻印: カッター生成に失敗しました（${message}）`)
    return { manifold: null, warnings }
  }
  if (!cutter) {
    warnings.push('刻印: カッターが空でした')
    return { manifold: null, warnings }
  }

  try {
    const result = final.subtract(cutter)
    if (result.status() !== 'NoError' || result.numTri() === 0) {
      warnings.push('刻印: ブール演算に失敗したため刻印をスキップしました')
      result.delete()
      return { manifold: null, warnings }
    }
    return { manifold: result, warnings }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`刻印: ブール演算に失敗しました（${message}）`)
    return { manifold: null, warnings }
  } finally {
    cutter.delete()
  }
}
