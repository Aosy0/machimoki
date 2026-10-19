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

/** 切断面のハッチ間隔（表示メートル）。CAD図面の目安に合わせた固定値。 */
const HATCH_SPACING_METERS = 0.8
/** 切断面ベース色の明度係数（外面より明確に暗くして切断面を判別しやすくする）。 */
const HATCH_BASE_FACTOR = 0.72
/** ハッチ線色の明度係数。 */
const HATCH_LINE_FACTOR = 0.3

export const HATCH_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;
in vec2 hatchUV;

out vec3 v_positionEC;
out vec4 v_color;
out vec2 v_hatch;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_color = color;
    v_hatch = hatchUV;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

export const HATCH_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec4 v_color;
in vec2 v_hatch;

void main()
{
    // CAD調と同じ面法線＋環境光ベースの陰影に合わせる。
    vec3 flatNormal = normalize(cross(dFdx(v_positionEC), dFdy(v_positionEC)));
    float light = max(dot(flatNormal, normalize(czm_lightDirectionEC)), 0.0);
    float lightFactor = clamp(0.61 + 0.95 * light, 0.0, 1.0);

    // 切断面は外面より少し暗く、斜線はさらに暗くして区別する。
    vec3 baseColor = v_color.rgb * ${HATCH_BASE_FACTOR} * lightFactor;
    vec3 lineColor = v_color.rgb * ${HATCH_LINE_FACTOR} * lightFactor;

    // 45°の斜線ハッチ。間隔は表示メートル単位。
    float c = (v_hatch.x + v_hatch.y) / ${HATCH_SPACING_METERS};
    float fw = fwidth(c);
    // ライン中心からの距離をピクセル単位で求め、画面一定幅（約1px）の線にする。
    float distPx = abs(fract(c + 0.5) - 0.5) / max(fw, 1e-4);
    float line = 1.0 - smoothstep(0.5, 1.0, distPx);
    // 遠方でセルが潰れる場合は線を消してモアレを防ぐ。
    line *= 1.0 - smoothstep(0.2, 0.4, fw);

    vec3 col = mix(baseColor, lineColor, line);
    out_FragColor = czm_gammaCorrect(vec4(col, v_color.a));
}
`

// 三角形法線を頂点に累積して正規化する（engineMeshPrimitive と同様の処理）。
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
 * 切断済みメッシュをキャップ面（cut）とそれ以外（body）に分割する。
 * 3頂点すべてが切断平面上にある三角形をキャップ面とみなす。
 * float32誤差を考慮し、ε = 1e-6 * max(1, |offset|) で判定する。
 */
export function splitSectionMesh(
  mesh: RawMesh,
  axis: 'x' | 'z',
  offset: number,
): { cut: RawMesh; body: RawMesh } {
  const coordIndex = axis === 'x' ? 0 : 2
  const eps = 1e-6 * Math.max(1, Math.abs(offset))
  const pos = mesh.positions
  const idx = mesh.indices
  const cutIndexList: number[] = []
  const bodyIndexList: number[] = []
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]
    const b = idx[t + 1]
    const c = idx[t + 2]
    const onPlane =
      Math.abs(pos[a * 3 + coordIndex] - offset) < eps &&
      Math.abs(pos[b * 3 + coordIndex] - offset) < eps &&
      Math.abs(pos[c * 3 + coordIndex] - offset) < eps
    if (onPlane) {
      cutIndexList.push(a, b, c)
    } else {
      bodyIndexList.push(a, b, c)
    }
  }
  // 参照頂点だけ詰め直して2つのメッシュにする。
  const compact = (indexList: number[]): RawMesh => {
    const remap = new Map<number, number>()
    const positions: number[] = []
    const indices = new Uint32Array(indexList.length)
    for (let i = 0; i < indexList.length; i++) {
      const vi = indexList[i]
      let ni = remap.get(vi)
      if (ni === undefined) {
        ni = positions.length / 3
        remap.set(vi, ni)
        positions.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
      }
      indices[i] = ni
    }
    return { positions: new Float32Array(positions), indices }
  }
  return { cut: compact(cutIndexList), body: compact(bodyIndexList) }
}

export interface SectionHatchOptions {
  /** bounds 中心の ENU フレーム。 */
  centerMatrix: Matrix4
  /** 座標に掛ける係数（スケール戻し等）。 */
  positionScale: number
  color: string
  /** 切断軸（'x' = 東西方向、'z' = 南北方向の平面）。 */
  axis: 'x' | 'z'
}

/**
 * キャップ面（切断面）を斜線ハッチ付きの Primitive に変換する。
 * hatchUV は平面内の2D座標を表示メートル単位で持つ。
 * 空メッシュの場合は null を返す。
 */
export function buildSectionHatchPrimitive(
  mesh: RawMesh,
  options: SectionHatchOptions,
): Primitive | null {
  if (mesh.positions.length === 0 || mesh.indices.length === 0) return null
  const s = options.positionScale
  if (!Number.isFinite(s) || s === 0) return null

  // engine フレーム (x=east, y=up, z=south) → ENU ローカル → centerMatrix で ECEF へ。
  // ハッチUVは切断平面内の2D座標（axis='x' なら (y,z)、axis='z' なら (x,y)）を表示メートルで。
  const inPlane: [number, number] = options.axis === 'x' ? [1, 2] : [0, 1]
  const count = mesh.positions.length / 3
  const positionValues = new Float64Array(count * 3)
  const hatchValues = new Float32Array(count * 2)
  const localScratch = new Cartesian3()
  const ecefScratch = new Cartesian3()
  for (let i = 0; i < count; i++) {
    const ex = mesh.positions[i * 3]
    const ey = mesh.positions[i * 3 + 1]
    const ez = mesh.positions[i * 3 + 2]
    localScratch.x = ex * s
    localScratch.y = -ez * s
    localScratch.z = ey * s
    const ecef = Matrix4.multiplyByPoint(options.centerMatrix, localScratch, ecefScratch)
    positionValues[i * 3] = ecef.x
    positionValues[i * 3 + 1] = ecef.y
    positionValues[i * 3 + 2] = ecef.z
    const coords = [ex, ey, ez]
    hatchValues[i * 2] = coords[inPlane[0]] * s
    hatchValues[i * 2 + 1] = coords[inPlane[1]] * s
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
  // hatchUV はカスタム頂点属性（シェーダー側の in vec2 hatchUV と対応）。
  const withHatch = attributes as GeometryAttributes & { hatchUV: GeometryAttribute }
  withHatch.hatchUV = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 2,
    values: hatchValues,
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
      vertexShaderSource: HATCH_VERTEX_SHADER,
      fragmentShaderSource: HATCH_FRAGMENT_SHADER,
    }),
    // 切断面に影は描画しない（最終形状の断面表示と同じ扱い）。
    shadows: ShadowMode.DISABLED,
    asynchronous: false,
  })
}
