import { Cartesian3, ShadowMode, Transforms } from 'cesium'
import type { Primitive } from 'cesium'
import { buildHollowBuildingShells, type RawMesh } from '@machimoki/core'
import { buildEngineMeshPrimitive } from './engineMeshPrimitive'

export interface HollowBuildingPrimitiveParams {
  bounds: { west: number; south: number; east: number; north: number }
  /** 取得済みの建物メッシュ（共有キャッシュ loadBuildingMeshes の結果）。 */
  buildingMeshes: RawMesh[]
  includeSpanningBuildings: boolean
  /** シェル厚み（実スケールのメートル）。Preview3D の effectiveShellThickness を渡す。 */
  wallThickness: number
  buildingColor: string
  onProgress?: (message: string) => void
}

/**
 * 建物メッシュ群をエクスポートと同一の侵食処理で中空化し、
 * 1つの Primitive にまとめて返す。空なら null。
 *
 * 建物メッシュは呼び出し側で共有キャッシュから取得して渡す
 * （最終形状プレビュー／エクスポートと同じデータを二重取得しない）。
 */
export async function buildHollowBuildingPrimitive(
  params: HollowBuildingPrimitiveParams,
): Promise<Primitive | null> {
  const { bounds, buildingMeshes, includeSpanningBuildings, wallThickness, buildingColor } = params
  if (!(wallThickness > 0) || !Number.isFinite(wallThickness)) return null

  const nonEmpty = buildingMeshes.filter((m) => m.positions.length > 0 && m.indices.length > 0)
  if (nonEmpty.length === 0) return null

  params.onProgress?.('建物の中空化中...')
  const shells = await buildHollowBuildingShells(
    nonEmpty,
    bounds,
    wallThickness,
    includeSpanningBuildings,
  )
  const meshes = shells.filter((m) => m.positions.length > 0 && m.indices.length > 0)
  if (meshes.length === 0) return null

  // 複数シェルを1メッシュに結合してから共通プリミティブ化する。
  let vertexTotal = 0
  let indexTotal = 0
  for (const m of meshes) {
    vertexTotal += m.positions.length / 3
    indexTotal += m.indices.length
  }
  const positions = new Float32Array(vertexTotal * 3)
  const indices = new Uint32Array(indexTotal)
  let vertexOffset = 0
  let indexOffset = 0
  for (const m of meshes) {
    positions.set(m.positions, vertexOffset * 3)
    for (let i = 0; i < m.indices.length; i++) {
      indices[indexOffset + i] = m.indices[i] + vertexOffset
    }
    vertexOffset += m.positions.length / 3
    indexOffset += m.indices.length
  }

  const centerMatrix = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2, 0),
  )
  return buildEngineMeshPrimitive(
    { positions, indices },
    {
      centerMatrix,
      positionScale: 1,
      color: buildingColor,
      // 薄い中空シェルは自己シャドウ（アクネ）で壁面がまだらに暗くなるため、
      // 地形へ影を落とす CAST_ONLY にする（受影しない）。
      shadows: ShadowMode.CAST_ONLY,
      // 元の3D Tiles（フラットな面法線）と見た目を揃える。
      // スムーズ法線だと壁面中央に強いハイライトが出て別物に見える。
      flat: true,
    },
  )
}
