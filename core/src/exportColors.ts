/**
 * エクスポートメッシュの三角形ごとの色分け。
 *
 * 地形・建物・橋梁・道路を1つの水密メッシュに統合した後、三角形の位置から
 * 色を割り当てる。道路は地形の形状を変えず、地表の三角形の色だけを変える。
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

/**
 * 最終メッシュの三角形へ色を割り当てる。
 * 地形の上面で道路範囲内なら道路色、地形より上なら橋梁範囲なら橋梁色、
 * それ以外は建物色、地表以下は地形色。
 */
export function assignTriangleColors(_options: TriangleColorOptions): TriangleColorResult {
  throw new Error('assignTriangleColors is not implemented')
}
