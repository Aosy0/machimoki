import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'

setWasmUrl(wasmUrl)

import {
  BoundingSphere,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  Matrix4,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  ShadowMode,
  Transforms,
} from 'cesium'
import { buildBuildingMeshes, buildHollowBuildingShells } from '@machimoki/core'
import type { RawMesh } from '@machimoki/core'
import type { Lod } from './catalogApi'

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

// 三角形法線を頂点に累積して正規化する（solidTerrain と同様の処理）。
function buildNormals(positions: Float64Array, indices: Uint32Array): Float32Array {
  const accumulated = new Float64Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const abX = positions[b] - positions[a]
    const abY = positions[b + 1] - positions[a + 1]
    const abZ = positions[b + 2] - positions[a + 2]
    const acX = positions[c] - positions[a]
    const acY = positions[c + 1] - positions[a + 1]
    const acZ = positions[c + 2] - positions[a + 2]
    const nX = abY * acZ - abZ * acY
    const nY = abZ * acX - abX * acZ
    const nZ = abX * acY - abY * acX
    const len = Math.hypot(nX, nY, nZ)
    if (len === 0) continue
    const x = nX / len
    const y = nY / len
    const z = nZ / len
    accumulated[a] += x
    accumulated[a + 1] += y
    accumulated[a + 2] += z
    accumulated[b] += x
    accumulated[b + 1] += y
    accumulated[b + 2] += z
    accumulated[c] += x
    accumulated[c + 1] += y
    accumulated[c + 2] += z
  }
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < accumulated.length; i += 3) {
    const x = accumulated[i]
    const y = accumulated[i + 1]
    const z = accumulated[i + 2]
    const len = Math.hypot(x, y, z)
    if (len === 0) {
      normals[i + 2] = 1
      continue
    }
    normals[i] = x / len
    normals[i + 1] = y / len
    normals[i + 2] = z / len
  }
  return normals
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
  const shells: RawMesh[] = await buildHollowBuildingShells(
    nonEmpty,
    bounds,
    wallThickness,
    includeSpanningBuildings,
  )
  const meshes = shells.filter((m) => m.positions.length > 0 && m.indices.length > 0)
  if (meshes.length === 0) return null

  // 建物メッシュは engine フレーム (x=east, y=up, z=south) のため、
  // ENU ローカル (x=east, y=north, z=up) に直して ECEF へ変換する。
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2, 0),
  )
  let vertexTotal = 0
  let indexTotal = 0
  for (const m of meshes) {
    vertexTotal += m.positions.length / 3
    indexTotal += m.indices.length
  }
  const positionValues = new Float64Array(vertexTotal * 3)
  const indexValues = new Uint32Array(indexTotal)
  const localScratch = new Cartesian3()
  const ecefScratch = new Cartesian3()
  let vertexOffset = 0
  let indexOffset = 0
  for (const m of meshes) {
    const count = m.positions.length / 3
    for (let i = 0; i < count; i++) {
      localScratch.x = m.positions[i * 3]
      localScratch.y = -m.positions[i * 3 + 2]
      localScratch.z = m.positions[i * 3 + 1]
      const ecef = Matrix4.multiplyByPoint(centerMatrix, localScratch, ecefScratch)
      const o = (vertexOffset + i) * 3
      positionValues[o] = ecef.x
      positionValues[o + 1] = ecef.y
      positionValues[o + 2] = ecef.z
    }
    for (let i = 0; i < m.indices.length; i++) {
      indexValues[indexOffset + i] = m.indices[i] + vertexOffset
    }
    vertexOffset += count
    indexOffset += m.indices.length
  }

  const normalValues = buildNormals(positionValues, indexValues)
  const boundingSphere = BoundingSphere.fromVertices(positionValues)
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionValues,
  })
  attributes.normal = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 3,
    values: normalValues,
  })
  const primitive = new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: new Geometry({
        attributes,
        indices: indexValues,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingSphere,
      }),
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(buildingColor)),
      },
    }),
    appearance: new PerInstanceColorAppearance({
      closed: true,
      flat: false,
      translucent: false,
    }),
    // 中空シェルも外殻と同様に影を描画する。
    shadows: ShadowMode.ENABLED,
    asynchronous: false,
  })
  return primitive
}
