/**
 * 地形の高さグリッド（サンプル）とスラブ構築。
 *
 * サンプリング（Cesium 依存）とスラブ構築（純粋な配列処理）を分離し、
 * 厚み・flattenBottom の変更では高さグリッドを取り直さずに再構築できるようにする。
 * このモジュールは Cesium を import しないため Worker からも安全に使える。
 */

import type { Bounds, RawMesh } from './types.js'
import { buildSlabIndices } from './pipelineCore.js'

/**
 * 地形の高さグリッド。engine 座標（x=東, y=上, z=南）のメートル単位。
 * topPositions は grid 順（行=南→北）に並べた地表頂点 (x, y, z)。
 * topYValues は各頂点の高さ（topPositions の y と同値）。
 * 精度を落とさないよう Float64 で保持する（現行のスラブ構築と完全一致させるため）。
 */
export interface TerrainSample {
  bounds: Bounds
  gridSize: number
  reflectActualElevation: boolean
  topPositions: Float64Array
  topYValues: Float64Array
  minTopY: number
}

/**
 * 高さグリッドから地形スラブ（地表＋底面）を構築する。
 *
 * thickness / flattenBottom は高さグリッドに影響しないため、同じサンプルを
 * 使い回して何度でも構築できる。出力は従来の `buildTerrainMesh` と同一。
 */
export function buildTerrainSlabFromSample(
  sample: TerrainSample,
  thickness: number,
  flattenBottom: boolean,
): RawMesh {
  const numVertices = sample.gridSize * sample.gridSize
  const topPositions = sample.topPositions
  const topYValues = sample.topYValues

  // 従来ロジックと同じ底面高さの決定。
  const minTopZ = sample.minTopY
  const flatBottomZ = sample.reflectActualElevation
    ? Math.min(0, minTopZ - thickness)
    : minTopZ - thickness
  const useFlatBottom = sample.reflectActualElevation || flattenBottom
  const bottomZ = useFlatBottom ? flatBottomZ : -thickness

  // 表層 + 底面を 1 つの Float32Array に構築する（従来と同じ丸め）。
  const allVertices = new Float32Array(numVertices * 6)
  for (let i = 0; i < numVertices * 3; i++) {
    allVertices[i] = topPositions[i]
  }
  for (let i = 0; i < numVertices; i++) {
    const out = (numVertices + i) * 3
    allVertices[out] = topPositions[i * 3]
    allVertices[out + 1] = useFlatBottom ? bottomZ : topYValues[i] - thickness
    allVertices[out + 2] = topPositions[i * 3 + 2]
  }

  return {
    positions: allVertices,
    indices: buildSlabIndices(sample.gridSize),
  }
}
