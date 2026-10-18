import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'

setWasmUrl(wasmUrl)

import { Cartesian3, Transforms } from 'cesium'
import { buildBuildingMeshes, buildHollowBuildingShells } from '@machimoki/core'
import type { Primitive } from 'cesium'
import type { Lod } from './catalogApi'
import { buildEngineMeshPrimitive } from './engineMeshPrimitive'

export interface HollowBuildingPrimitiveParams {
  bounds: { west: number; south: number; east: number; north: number }
  lod: Lod
  excludedGmlIds?: string[]
  includeSpanningBuildings: boolean
  /** シェル厚み（モデル空間メートル）。Preview3D の effectiveShellThickness を渡す。 */
  wallThickness: number
  buildingColor: string
  onProgress?: (message: string) => void
}

/**
 * 建物メッシュ群をエクスポートと同一の侵食処理で中空化し、
 * 1つの Primitive にまとめて返す。空なら null。
 */
export async function buildHollowBuildingPrimitive(
  params: HollowBuildingPrimitiveParams,
): Promise<Primitive | null> {
  const { bounds, lod, excludedGmlIds, includeSpanningBuildings, wallThickness, buildingColor } =
    params
  if (!(wallThickness > 0) || !Number.isFinite(wallThickness)) return null

  params.onProgress?.('建物データ取得中...')
  const buildingMeshes = await buildBuildingMeshes(bounds, lod, excludedGmlIds)
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
    { centerMatrix, positionScale: 1, color: buildingColor },
  )
}
