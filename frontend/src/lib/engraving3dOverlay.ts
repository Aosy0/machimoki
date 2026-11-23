/**
 * 3Dプレビュー上での刻印オーバーレイ用の純粋計算。
 *
 * - 完成メッシュのバウンディングボックスから、選択面の位置・向き（モデル空間）を求める
 * - 面ローカルmm → モデル空間 → ENU（プレビューのワールド変換前）へ変換する
 * - 面ローカルmm ↔ 画面座標の射影変換（ホモグラフィ）を求める
 * - 面ローカルmm → 刻印ブロック中心比（centerX/centerY）へ変換する
 *
 * モデル空間の単位は「印刷mm/1000」（例: 150mm = 0.15）で、プレビューでは
 * positionScale（= 1/scale）を掛けてから centerMatrix（ENU→ECEF）で描画される。
 */

import type { EngravingFace } from '../../../core/src/engraving/types.ts'
import type { EngravingLayout } from '../../../core/src/engraving/layout.ts'

export type Vec3 = [number, number, number]

/**
 * 3Dプレビュー上に表示する刻印オーバーレイのデータ（App が生成して Preview3D へ渡す）。
 */
export interface EngravingOverlayData {
  face: EngravingFace
  /** 面の幅（印刷mm） */
  faceWidthMm: number
  /** 面の高さ（印刷mm） */
  faceHeightMm: number
  /** 面ローカルmm（原点=左下、y上向き）のレイアウト */
  layout: EngravingLayout
  /** 文字 → SVG path（em単位、fillRule=nonzero） */
  glyphPaths: Map<string, string>
  /** はみ出し（面枠を赤にする） */
  overflow: boolean
}

/** モデル空間のバウンディングボックス。 */
export interface MeshBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

/** 面の位置・向き（モデル空間）。 */
export interface OverlayFaceFrame {
  center: Vec3
  /** 面内の右方向（単位ベクトル） */
  u: Vec3
  /** 面内の上方向（単位ベクトル） */
  v: Vec3
  /** 外向き法線（単位ベクトル） */
  normal: Vec3
  /** 面の幅（印刷mm） */
  widthMm: number
  /** 面の高さ（印刷mm） */
  heightMm: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * メッシュのバウンディングボックスと面寸法から、面の位置・向きを求める。
 *
 * 面の定義は core の刻印パイプラインと同じ（底面は minY、側面は minY からの帯）。
 * 分割表示では枠パーツのバウンディングボックスと表示オフセットを加味して渡す。
 */
export function buildOverlayFaceFrame(
  face: EngravingFace,
  bounds: MeshBounds,
  widthMm: number,
  heightMm: number,
): OverlayFaceFrame | null {
  if (!(widthMm > 0) || !(heightMm > 0)) return null
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.minZ, bounds.maxZ].every(Number.isFinite)) {
    return null
  }
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const bandBottom = bounds.minY
  const sideCenterY = bandBottom + heightMm / 2000
  switch (face) {
    case 'bottom':
      return {
        center: [centerX, bandBottom, centerZ],
        u: [1, 0, 0],
        // 裏返して読む前提: 文字の上方向は南（+Z）。
        v: [0, 0, 1],
        normal: [0, -1, 0],
        widthMm,
        heightMm,
      }
    case 'south':
      return {
        center: [centerX, sideCenterY, bounds.maxZ],
        u: [1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, 1],
        widthMm,
        heightMm,
      }
    case 'north':
      return {
        center: [centerX, sideCenterY, bounds.minZ],
        u: [-1, 0, 0],
        v: [0, 1, 0],
        normal: [0, 0, -1],
        widthMm,
        heightMm,
      }
    case 'east':
      return {
        center: [bounds.maxX, sideCenterY, centerZ],
        u: [0, 0, -1],
        v: [0, 1, 0],
        normal: [1, 0, 0],
        widthMm,
        heightMm,
      }
    case 'west':
      return {
        center: [bounds.minX, sideCenterY, centerZ],
        u: [0, 0, 1],
        v: [0, 1, 0],
        normal: [-1, 0, 0],
        widthMm,
        heightMm,
      }
    default:
      return null
  }
}

/** 面ローカルmm（原点=面の左下、y上向き）→ モデル空間。 */
export function faceLocalToModel(frame: OverlayFaceFrame, uMm: number, vMm: number): Vec3 {
  const along = uMm / 1000 - frame.widthMm / 2000
  const up = vMm / 1000 - frame.heightMm / 2000
  return [
    frame.center[0] + frame.u[0] * along + frame.v[0] * up,
    frame.center[1] + frame.u[1] * along + frame.v[1] * up,
    frame.center[2] + frame.u[2] * along + frame.v[2] * up,
  ]
}

/**
 * モデル空間 → ENU（プレビューのワールド変換前）。
 * engineMeshPrimitive と同じ変換: ENU = ((x+offsetX)*s, -z*s, (y+offsetY)*s)。
 */
export function modelToEnu(model: Vec3, positionScale: number, offsetX = 0, offsetY = 0): Vec3 {
  return [
    (model[0] + offsetX) * positionScale,
    -model[2] * positionScale,
    (model[1] + offsetY) * positionScale,
  ]
}

/** 面ローカルmmが面の範囲内か（縁は含む）。 */
export function pointInFace(uMm: number, vMm: number, widthMm: number, heightMm: number): boolean {
  return uMm >= 0 && uMm <= widthMm && vMm >= 0 && vMm <= heightMm
}

/**
 * ワールド（ENU）の長さ → 印刷mm。
 * モデル空間 = 印刷mm/1000、ワールド = モデル空間 / positionScale。
 */
export function worldLengthToMm(worldLength: number, positionScale: number): number {
  if (!(positionScale > 0)) return 0
  return (worldLength * 1000) / positionScale
}

/**
 * 面ローカルmm → 刻印ブロック中心比（0..1、使用可能領域基準）。
 * layout.usable は面ローカルmm（原点=左下、y上向き）。
 */
export function faceLocalToCenter(
  layout: EngravingLayout,
  uMm: number,
  vMm: number,
): { centerX: number; centerY: number } {
  const width = layout.usable.width
  const height = layout.usable.height
  return {
    centerX: width > 0 ? clamp01((uMm - layout.usable.x) / width) : 0.5,
    centerY: height > 0 ? clamp01((vMm - layout.usable.y) / height) : 0.5,
  }
}

/** 画面座標。 */
export interface ScreenPoint {
  x: number
  y: number
}

/**
 * 4点対応から 3x3 の射影変換行列を求める（行優先、h33 = 1）。
 * 対応点が退化している場合は null。
 */
export function computeHomography(
  source: readonly ScreenPoint[],
  destination: readonly ScreenPoint[],
): number[] | null {
  if (source.length !== 4 || destination.length !== 4) return null
  // 8連立方程式を解く: 各対応点から2行。
  const matrix: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i]
    const { x: X, y: Y } = destination[i]
    matrix.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    rhs.push(X)
    matrix.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    rhs.push(Y)
  }
  // ガウス消去（部分ピボット選択）。
  const n = 8
  for (let column = 0; column < n; column++) {
    let pivot = column
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    }
    if (Math.abs(matrix[pivot][column]) < 1e-12) return null
    if (pivot !== column) {
      const tempRow = matrix[pivot]
      matrix[pivot] = matrix[column]
      matrix[column] = tempRow
      const tempRhs = rhs[pivot]
      rhs[pivot] = rhs[column]
      rhs[column] = tempRhs
    }
    const pivotValue = matrix[column][column]
    for (let row = column + 1; row < n; row++) {
      const factor = matrix[row][column] / pivotValue
      if (factor === 0) continue
      for (let k = column; k < n; k++) matrix[row][k] -= factor * matrix[column][k]
      rhs[row] -= factor * rhs[column]
    }
  }
  const solution = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]
    for (let k = row + 1; k < n; k++) sum -= matrix[row][k] * solution[k]
    solution[row] = sum / matrix[row][row]
  }
  if (solution.some((value) => !Number.isFinite(value))) return null
  return [
    solution[0],
    solution[1],
    solution[2],
    solution[3],
    solution[4],
    solution[5],
    solution[6],
    solution[7],
    1,
  ]
}

/** 射影変換行列（行優先3x3）で点を画面座標へ投影する。分母が0に近ければ null。 */
export function projectHomographyPoint(
  homography: readonly number[],
  x: number,
  y: number,
): ScreenPoint | null {
  if (homography.length < 9) return null
  const [h11, h12, h13, h21, h22, h23, h31, h32] = homography
  const w = h31 * x + h32 * y + 1
  if (!Number.isFinite(w) || Math.abs(w) < 1e-9) return null
  const px = (h11 * x + h12 * y + h13) / w
  const py = (h21 * x + h22 * y + h23) / w
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null
}

/**
 * 射影変換のその点での局所倍率（px/mm、x/y方向の平均）。
 * 画面固定サイズのハンドルを mm 座標で描くために使う。
 */
export function homographyScalePxPerMm(
  homography: readonly number[],
  x: number,
  y: number,
): number {
  const origin = projectHomographyPoint(homography, x, y)
  const alongX = projectHomographyPoint(homography, x + 1, y)
  const alongY = projectHomographyPoint(homography, x, y + 1)
  if (!origin || !alongX || !alongY) return 0
  return (
    (Math.hypot(alongX.x - origin.x, alongX.y - origin.y) +
      Math.hypot(alongY.x - origin.x, alongY.y - origin.y)) /
    2
  )
}

/**
 * 射影変換行列（行優先3x3）を CSS matrix3d 文字列にする。
 * transform-origin: 0 0 で、要素ローカル座標をそのまま射影変換する。
 */
export function homographyToMatrix3d(homography: readonly number[]): string {
  const [h11, h12, h13, h21, h22, h23, h31, h32] = homography
  return `matrix3d(${h11},${h21},0,${h31},${h12},${h22},0,${h32},0,0,1,0,${h13},${h23},0,1)`
}
