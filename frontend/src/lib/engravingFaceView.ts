/**
 * 刻印面ビューの純粋計算（Cesium 非依存）。
 *
 * モデル空間は Y-up（x=東, y=上, z=南）。プレビューは centerMatrix
 * （ENU→ECEF）と positionScale=1/scale で描画されるため、面の向きは
 * モデル空間→ENU→ECEF の順に回して使う。
 */

import type { EngravingFace } from '../../../core/src/engraving/types.ts'

/** 3成分ベクトル（モデル空間 / ENU 空間の両方に使う）。 */
export interface FaceViewVector {
  x: number
  y: number
  z: number
}

/** 面の外向き法線と文字上方向（どちらもモデル空間）。 */
export interface EngravingFaceVectors {
  normal: FaceViewVector
  up: FaceViewVector
}

/** 透視投影で面を収めるカメラ距離の余白（球の半径に対する倍率）。 */
export const FACE_VIEW_MARGIN = 1.15

/** 平行投影の frustum 幅（半径1・アスペクト比1あたりの倍率）。 */
export const FACE_VIEW_ORTHO_WIDTH_FACTOR = 2.4

/** 平行投影で面の正面に置くカメラ距離（半径に対する倍率）。 */
export const FACE_VIEW_ORTHO_DISTANCE_FACTOR = 2

/**
 * 面ごとのモデル空間ベクトル。
 * 底面は「裏返して読む前提」のため、文字上方向は南（+Z）になる。
 */
const FACE_VECTORS: Record<EngravingFace, EngravingFaceVectors> = {
  bottom: { normal: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  south: { normal: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  north: { normal: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  east: { normal: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  west: { normal: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
}

/** 面の外向き法線と文字上方向（モデル空間）を返す。 */
export function engravingFaceVectors(face: EngravingFace): EngravingFaceVectors {
  const vectors = FACE_VECTORS[face]
  return {
    normal: { ...vectors.normal },
    up: { ...vectors.up },
  }
}

/**
 * モデル空間の向き（x=東, y=上, z=南）を ENU の向き（x=東, y=北, z=上）へ変換する。
 * 向きの変換なので平行移動は含めない。
 */
export function modelVectorToEnu(v: FaceViewVector): FaceViewVector {
  // -0 を返さない（比較・JSON化で 0 と区別させない）。
  return { x: v.x, y: v.z === 0 ? 0 : -v.z, z: v.y }
}

/**
 * 透視投影で半径 radius の球を正面から収めるカメラ距離。
 *
 * fovyRad は垂直画角。aspect（幅/高さ）が1未満の縦長画面では水平画角の方が
 * 狭くなって球がはみ出すため、その分だけ距離を伸ばす。
 */
export function faceViewDistance(radius: number, fovyRad: number, aspect = 1): number {
  const safeRadius = Number.isFinite(radius) ? Math.max(radius, 0) : 0
  const tanY = Math.tan(fovyRad / 2)
  if (!Number.isFinite(tanY) || tanY <= 0) {
    return safeRadius * FACE_VIEW_ORTHO_DISTANCE_FACTOR
  }
  const tanX = Number.isFinite(aspect) && aspect > 0 ? tanY * aspect : tanY
  return (safeRadius / Math.min(tanY, tanX)) * FACE_VIEW_MARGIN
}

/**
 * 平行投影で半径 radius の球を収める OrthographicFrustum.width。
 *
 * Cesium の width は水平方向で、height = width / aspectRatio。横長画面では
 * 高さが足りなくなるため、アスペクト比が1より大きい分だけ幅を広げる。
 */
export function faceViewOrthoWidth(radius: number, aspect = 1): number {
  const safeRadius = Number.isFinite(radius) ? Math.max(radius, 0) : 0
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return safeRadius * FACE_VIEW_ORTHO_WIDTH_FACTOR * Math.max(1, safeAspect)
}

/** 平行投影で面の正面に置くカメラ距離。 */
export function faceViewOrthoDistance(radius: number): number {
  const safeRadius = Number.isFinite(radius) ? Math.max(radius, 0) : 0
  return safeRadius * FACE_VIEW_ORTHO_DISTANCE_FACTOR
}
