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
import { pickSectionColor } from './sectionColor'

/** 切断面の陰影係数（CAD調の光量に合わせて少し落とす）。 */
const HATCH_BASE_SHADE = 0.92
/** ハッチ間隔（表示メートル）。 */
const HATCH_SPACING_METERS = 30.2
/** ハッチ線色の明度係数（ベース色を暗くして線にする）。 */
const HATCH_LINE_FACTOR = 0.4
/** この明度（sRGB輝度）未満のベース色には明るい線を使う（自動反転）。 */
const HATCH_LINE_INVERT_LUM = 0.45

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

/**
 * 切断面用フラグメントシェーダーを作る。flatShading=true は向きによらず
 * 一定の明るさにし、陰影の有無を比較できるようにする。
 */
export function hatchFragmentShader(flatShading: boolean): string {
  // flatShading=false はCAD調と同じ面法線＋環境光ベースの陰影にする。
  const lightFactor = flatShading
    ? '1.0'
    : 'clamp(0.61 + 0.95 * max(dot(normalize(cross(dFdx(v_positionEC), dFdy(v_positionEC))), normalize(czm_lightDirectionEC)), 0.0), 0.0, 1.0)'
  return `
in vec3 v_positionEC;
in vec4 v_color;
in vec2 v_hatch;

void main()
{
    float lightFactor = ${lightFactor};

    // 切断面はモデル色のトーンシフト色（v_color）で、外面と区別する。
    vec3 baseColor = v_color.rgb * ${HATCH_BASE_SHADE} * lightFactor;
    // 斜線色はベースの明るさに連動させる（暗いベースでは明るい線に反転）。
    float lum = dot(v_color.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 hatchLine = v_color.rgb * ${HATCH_LINE_FACTOR};
    if (lum < ${HATCH_LINE_INVERT_LUM}) {
        hatchLine = mix(v_color.rgb, vec3(1.0), 0.6);
    }
    vec3 lineColor = hatchLine * lightFactor;

    // 45°の斜線ハッチ。間隔は表示メートル単位（モデルに張り付き、拡大で間隔も拡大）。
    float c = (v_hatch.x + v_hatch.y) / ${HATCH_SPACING_METERS};
    float fw = fwidth(c);
    // ライン中心からの距離をピクセル単位で求め、画面一定幅（約1px）の線にする。
    float distPx = abs(fract(c + 0.5) - 0.5) / max(fw, 1e-4);
    float line = 1.0 - smoothstep(0.5, 1.2, distPx);
    // 非常に遠くでセルがサブピクセルになった場合のみフェードし、通常距離では変化させない。
    line *= 1.0 - smoothstep(0.6, 1.0, fw);

    vec3 col = mix(baseColor, lineColor, line);
    out_FragColor = czm_gammaCorrect(vec4(col, v_color.a));
}
`
}

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
  /** モデル色（CSS色）。切断面色はここからトーンシフトして作る。 */
  modelColor: string
  /** true は向きによらず一定の明るさにする（陰影比較用）。既定は false。 */
  flatShading?: boolean
  /** 切断軸（'x' = 東西方向、'z' = 南北方向の平面）。 */
  axis: 'x' | 'z'
}

/**
 * キャップ面（切断面）を斜線ハッチ付きの Primitive に変換する。
 * ハッチは平面内の2D座標（表示メートル）に張り付き、拡大すると間隔も拡大する。
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
        // 断面色はモデル色のトーンシフト（外面と区別しつつ色相を保つ）。
        color: ColorGeometryInstanceAttribute.fromColor(
          Color.fromCssColorString(pickSectionColor(options.modelColor)),
        ),
      },
    }),
    appearance: new PerInstanceColorAppearance({
      closed: true,
      flat: false,
      translucent: false,
      vertexShaderSource: HATCH_VERTEX_SHADER,
      fragmentShaderSource: hatchFragmentShader(options.flatShading ?? false),
    }),
    // 切断面に影は描画しない（最終形状の断面表示と同じ扱い）。
    shadows: ShadowMode.DISABLED,
    asynchronous: false,
  })
}
