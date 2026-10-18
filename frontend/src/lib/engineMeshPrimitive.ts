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
} from 'cesium'
import type { RawMesh } from '@machimoki/core'

export interface EngineMeshPrimitiveOptions {
  /** bounds 中心の ENU フレーム。 */
  centerMatrix: Matrix4
  /** 座標に掛ける係数（スケール戻し等）。 */
  positionScale: number
  color: string
  /** 影の設定（既定: 描画・受影とも有効）。 */
  shadows?: ShadowMode
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
 * engine フレーム (x=east, y=up, z=south) のメッシュを1つの Primitive に変換する。
 * ENU ローカル (x=east, y=north, z=up) に直してから centerMatrix で ECEF へ変換する。
 * 空メッシュの場合は null を返す。
 */
export function buildEngineMeshPrimitive(
  mesh: RawMesh,
  options: EngineMeshPrimitiveOptions,
): Primitive | null {
  if (mesh.positions.length === 0 || mesh.indices.length === 0) return null
  const s = options.positionScale
  if (!Number.isFinite(s) || s === 0) return null

  const count = mesh.positions.length / 3
  const positionValues = new Float64Array(count * 3)
  const localScratch = new Cartesian3()
  const ecefScratch = new Cartesian3()
  for (let i = 0; i < count; i++) {
    localScratch.x = mesh.positions[i * 3] * s
    localScratch.y = -mesh.positions[i * 3 + 2] * s
    localScratch.z = mesh.positions[i * 3 + 1] * s
    const ecef = Matrix4.multiplyByPoint(options.centerMatrix, localScratch, ecefScratch)
    positionValues[i * 3] = ecef.x
    positionValues[i * 3 + 1] = ecef.y
    positionValues[i * 3 + 2] = ecef.z
  }

  const indexValues = new Uint32Array(mesh.indices)
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
  return new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: new Geometry({
        attributes,
        indices: indexValues,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingSphere,
      }),
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(options.color)),
      },
    }),
    appearance: new PerInstanceColorAppearance({
      closed: true,
      flat: false,
      translucent: false,
    }),
    // 外殻と同様に影を描画する。
    shadows: options.shadows ?? ShadowMode.ENABLED,
    asynchronous: false,
  })
}
