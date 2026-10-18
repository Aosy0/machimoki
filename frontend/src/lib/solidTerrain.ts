import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  EllipsoidTerrainProvider,
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
  sampleTerrain,
  sampleTerrainMostDetailed,
} from 'cesium'
import type { TerrainProvider } from 'cesium'
import { CAD_FRAGMENT_SHADER, CAD_VERTEX_SHADER } from './cadShader'

export interface TerrainBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface SolidTerrainOptions {
  terrainThickness: number
  flattenBottom: boolean
  reflectActualElevation?: boolean
  gridSize?: number
  terrainColor?: string
  /** 底面を開口した中空シェル表示（エクスポートの openBottom と同じ形状）。 */
  openBottom?: boolean
  /** シェル厚み（モデル空間のメートル）。openBottom が true のときのみ使用。 */
  shellThickness?: number
}

export interface SolidTerrainPrimitiveResult {
  /** [0]=上面(受影あり), [1]=底面+側面スカート(受影なし) */
  primitives: Primitive[]
  boundingSphere: BoundingSphere
}

type SolidTerrainPrimitive = Primitive & {
  _machimokiSolidTerrain?: boolean
  _machimokiSolidTerrainVertexCount?: number
  _machimokiSolidTerrainHasNormals?: boolean
}

const DEFAULT_GRID_SIZE = 128
const TERRAIN_SAMPLE_BATCH_SIZE = 1024
const MIN_TERRAIN_THICKNESS = 0.1
const TERRAIN_SURFACE_OFFSET = 0.05

function gridIndex(x: number, y: number, gridSize: number): number {
  return y * gridSize + x
}

function buildTerrainIndices(gridSize: number): Uint32Array {
  const topVertexCount = gridSize * gridSize
  const indices: number[] = []

  for (let y = 0; y < gridSize - 1; y++) {
    for (let x = 0; x < gridSize - 1; x++) {
      const a = gridIndex(x, y, gridSize)
      const b = gridIndex(x + 1, y, gridSize)
      const c = gridIndex(x, y + 1, gridSize)
      const d = gridIndex(x + 1, y + 1, gridSize)

      indices.push(a, b, c)
      indices.push(b, d, c)
    }
  }

  for (let y = 0; y < gridSize - 1; y++) {
    for (let x = 0; x < gridSize - 1; x++) {
      const a = topVertexCount + gridIndex(x, y, gridSize)
      const b = topVertexCount + gridIndex(x + 1, y, gridSize)
      const c = topVertexCount + gridIndex(x, y + 1, gridSize)
      const d = topVertexCount + gridIndex(x + 1, y + 1, gridSize)

      indices.push(a, c, b)
      indices.push(b, c, d)
    }
  }

  for (let x = 0; x < gridSize - 1; x++) {
    const t1 = gridIndex(x, 0, gridSize)
    const t2 = gridIndex(x + 1, 0, gridSize)
    const b1 = t1 + topVertexCount
    const b2 = t2 + topVertexCount

    indices.push(t1, b1, t2)
    indices.push(t2, b1, b2)
  }

  for (let x = 0; x < gridSize - 1; x++) {
    const t1 = gridIndex(x, gridSize - 1, gridSize)
    const t2 = gridIndex(x + 1, gridSize - 1, gridSize)
    const b1 = t1 + topVertexCount
    const b2 = t2 + topVertexCount

    indices.push(t1, t2, b1)
    indices.push(t2, b2, b1)
  }

  for (let y = 0; y < gridSize - 1; y++) {
    const t1 = gridIndex(0, y, gridSize)
    const t2 = gridIndex(0, y + 1, gridSize)
    const b1 = t1 + topVertexCount
    const b2 = t2 + topVertexCount

    indices.push(t1, t2, b1)
    indices.push(t2, b2, b1)
  }

  for (let y = 0; y < gridSize - 1; y++) {
    const t1 = gridIndex(gridSize - 1, y, gridSize)
    const t2 = gridIndex(gridSize - 1, y + 1, gridSize)
    const b1 = t1 + topVertexCount
    const b2 = t2 + topVertexCount

    indices.push(t1, b1, t2)
    indices.push(t2, b1, b2)
  }

  return new Uint32Array(indices)
}

function buildTerrainNormals(positions: Float64Array, indices: Uint32Array): Float32Array {
  const accumulatedNormals = new Float64Array(positions.length)

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

    const normalX = abY * acZ - abZ * acY
    const normalY = abZ * acX - abX * acZ
    const normalZ = abX * acY - abY * acX
    const length = Math.hypot(normalX, normalY, normalZ)

    if (length === 0) continue

    const x = normalX / length
    const y = normalY / length
    const z = normalZ / length

    accumulatedNormals[a] += x
    accumulatedNormals[a + 1] += y
    accumulatedNormals[a + 2] += z
    accumulatedNormals[b] += x
    accumulatedNormals[b + 1] += y
    accumulatedNormals[b + 2] += z
    accumulatedNormals[c] += x
    accumulatedNormals[c + 1] += y
    accumulatedNormals[c + 2] += z
  }

  const normals = new Float32Array(positions.length)
  for (let i = 0; i < accumulatedNormals.length; i += 3) {
    const x = accumulatedNormals[i]
    const y = accumulatedNormals[i + 1]
    const z = accumulatedNormals[i + 2]
    const length = Math.hypot(x, y, z)

    if (length === 0) {
      const fallbackLength = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1
      normals[i] = positions[i] / fallbackLength
      normals[i + 1] = positions[i + 1] / fallbackLength
      normals[i + 2] = positions[i + 2] / fallbackLength
      continue
    }

    normals[i] = x / length
    normals[i + 1] = y / length
    normals[i + 2] = z / length
  }

  return normals
}

export interface TerrainSampleData {
  bounds: TerrainBounds
  gridSize: number
  centerMatrix: Matrix4
  inverseCenterMatrix: Matrix4
  topLocalPositions: Cartesian3[]
  topEcefValues: Float64Array
  minTopHeight: number
  indices: Uint32Array
  isFallback: boolean
  samplingLevel: number | null
}

export async function sampleTerrainData(
  bounds: TerrainBounds,
  terrainProvider: TerrainProvider,
  gridSize?: number,
  samplingLevel?: number,
): Promise<TerrainSampleData> {
  const resolvedGridSize = Math.max(2, Math.floor(gridSize ?? DEFAULT_GRID_SIZE))
  const widthDeg = bounds.east - bounds.west
  const heightDeg = bounds.north - bounds.south
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2

  const samplePositions: Cartographic[] = []
  for (let y = 0; y < resolvedGridSize; y++) {
    for (let x = 0; x < resolvedGridSize; x++) {
      const lon = bounds.west + (widthDeg * x) / (resolvedGridSize - 1)
      const lat = bounds.south + (heightDeg * y) / (resolvedGridSize - 1)
      samplePositions.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  const isIncompleteProvider =
    terrainProvider instanceof EllipsoidTerrainProvider ||
    (terrainProvider as any).availability === undefined
  if (isIncompleteProvider) {
    throw new Error(
      `PLATEAU-Terrain取得失敗: TerrainProviderがPLATEAU-Terrainではありません (Ellipsoidまたはavailabilityなし)`,
    )
  }
  let sampledPositions: Cartographic[]
  let resolvedSamplingLevel: number | null = null
  let sampleBatch: (positions: Cartographic[]) => Promise<Cartographic[]>
  if (Number.isFinite(samplingLevel)) {
    const requestedLevel = samplingLevel as number
    const levelProvider = terrainProvider as TerrainProvider & {
      minimumLevel?: number
      maximumLevel?: number
    }
    const minimumLevel = levelProvider.minimumLevel ?? 0
    const maximumLevel = levelProvider.maximumLevel
    const level =
      maximumLevel === undefined
        ? requestedLevel
        : Math.min(Math.max(requestedLevel, minimumLevel), maximumLevel)
    resolvedSamplingLevel = level
    sampleBatch = (positions) => sampleTerrain(terrainProvider, level, positions)
  } else {
    sampleBatch = (positions) => sampleTerrainMostDetailed(terrainProvider, positions)
  }
  try {
    sampledPositions = []
    for (let i = 0; i < samplePositions.length; i += TERRAIN_SAMPLE_BATCH_SIZE) {
      sampledPositions.push(
        ...(await sampleBatch(samplePositions.slice(i, i + TERRAIN_SAMPLE_BATCH_SIZE))),
      )
    }
  } catch (e) {
    throw new Error(`PLATEAU-Terrain取得失敗: ${(e as Error).message}`)
  }
  if (
    sampledPositions.length !== samplePositions.length ||
    sampledPositions.some((sample) => !Number.isFinite(sample.height))
  ) {
    throw new Error('PLATEAU-Terrain取得失敗: 標高サンプルが不完全です')
  }
  const isFallback = false

  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0)
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian)
  const inverseCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4())
  const topVertexCount = resolvedGridSize * resolvedGridSize
  const topEcefValues = new Float64Array(topVertexCount * 3)
  const topLocalPositions: Cartesian3[] = []

  let minTopHeight = Number.POSITIVE_INFINITY

  for (let i = 0; i < sampledPositions.length; i++) {
    const sample = sampledPositions[i]
    const height = sample.height
    const ecef = Cartesian3.fromRadians(
      sample.longitude,
      sample.latitude,
      height + TERRAIN_SURFACE_OFFSET,
    )
    const local = Matrix4.multiplyByPoint(inverseCenterMatrix, ecef, new Cartesian3())

    topLocalPositions.push(local)
    minTopHeight = Math.min(minTopHeight, local.z)

    topEcefValues[i * 3] = ecef.x
    topEcefValues[i * 3 + 1] = ecef.y
    topEcefValues[i * 3 + 2] = ecef.z
  }

  const indices = buildTerrainIndices(resolvedGridSize)

  return {
    bounds,
    gridSize: resolvedGridSize,
    centerMatrix,
    inverseCenterMatrix,
    topLocalPositions,
    topEcefValues,
    minTopHeight,
    indices,
    isFallback,
    samplingLevel: resolvedSamplingLevel,
  }
}

export function buildSolidTerrainPrimitive(
  sample: TerrainSampleData,
  options: SolidTerrainOptions,
): SolidTerrainPrimitiveResult {
  const gridSize = sample.gridSize
  const topVertexCount = gridSize * gridSize
  const vertexCount = topVertexCount * 2
  const positionValues = new Float64Array(vertexCount * 3)

  positionValues.set(sample.topEcefValues)

  const thickness = Math.max(MIN_TERRAIN_THICKNESS, options.terrainThickness)
  const flatBottomHeight = options.reflectActualElevation
    ? Math.min(0, sample.minTopHeight - thickness)
    : sample.minTopHeight - thickness

  for (let i = 0; i < sample.topLocalPositions.length; i++) {
    const topLocal = sample.topLocalPositions[i]
    const useFlatBottom = options.flattenBottom || options.reflectActualElevation
    const bottomLocal = new Cartesian3(
      topLocal.x,
      topLocal.y,
      useFlatBottom ? flatBottomHeight : topLocal.z - thickness,
    )
    const bottomEcef = Matrix4.multiplyByPoint(sample.centerMatrix, bottomLocal, new Cartesian3())
    const vertexIndex = topVertexCount + i

    positionValues[vertexIndex * 3] = bottomEcef.x
    positionValues[vertexIndex * 3 + 1] = bottomEcef.y
    positionValues[vertexIndex * 3 + 2] = bottomEcef.z
  }

  const indices = sample.indices
  const normalValues = buildTerrainNormals(positionValues, indices)
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

  // 上面(グリッド)とそれ以外(底面+側面スカート)でインデックスを分割する。
  // 上面のみ建物の影を受け、断面(側面)には境界建物の影が乗らないようにするため。
  // 底面開口(中空シェル)時はソリッド底面のキャップを外し、開口部から
  // キャビティ(別プリミティブ)が見えるようにする。
  const shellThickness = options.shellThickness ?? 0
  const openBottomShell = options.openBottom === true && shellThickness > 0
  const faceIndexCount = (gridSize - 1) * (gridSize - 1) * 6
  const topIndexCount = faceIndexCount
  const skirtStartIndex = openBottomShell ? topIndexCount + faceIndexCount : topIndexCount
  const geometryTop = new Geometry({
    attributes,
    indices: indices.subarray(0, topIndexCount),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere,
  })
  const geometrySkirt = new Geometry({
    attributes,
    indices: indices.subarray(skirtStartIndex),
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere,
  })

  const terrainColor = Color.fromCssColorString(options.terrainColor ?? '#ffffff')
  const makeAppearance = () =>
    new PerInstanceColorAppearance({
      closed: true,
      flat: false,
      translucent: false,
      vertexShaderSource: CAD_VERTEX_SHADER,
      fragmentShaderSource: CAD_FRAGMENT_SHADER,
    })
  const topPrimitive = new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: geometryTop,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(terrainColor),
      },
    }),
    appearance: makeAppearance(),
    // 建物(tileset)の影は上面だけが受ける。
    shadows: ShadowMode.RECEIVE_ONLY,
    asynchronous: false,
  }) as SolidTerrainPrimitive
  const skirtPrimitive = new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: geometrySkirt,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(terrainColor),
      },
    }),
    appearance: makeAppearance(),
    // 断面(側面)・底面には影を描画しない。
    shadows: ShadowMode.DISABLED,
    asynchronous: false,
  }) as SolidTerrainPrimitive
  for (const p of [topPrimitive, skirtPrimitive]) {
    p._machimokiSolidTerrain = true
    p._machimokiSolidTerrainVertexCount = vertexCount
    p._machimokiSolidTerrainHasNormals = true
  }

  // 底面開口（中空シェル）時は、開口部から見えるキャビティ内面とリムを追加する。
  const primitives: SolidTerrainPrimitive[] = [topPrimitive, skirtPrimitive]
  if (openBottomShell) {
    const cavityPrimitive = buildCavityPrimitive(sample, {
      thickness,
      flatBottomHeight,
      shellThickness,
      useFlatBottom: options.flattenBottom || !!options.reflectActualElevation,
      terrainColor,
      outerBottomEcef: positionValues,
      outerBottomOffset: topVertexCount,
    })
    if (cavityPrimitive) {
      primitives.push(cavityPrimitive)
    }
  }

  return {
    primitives,
    boundingSphere,
  }
}

export async function createSolidTerrainPrimitive(
  bounds: TerrainBounds,
  terrainProvider: TerrainProvider,
  options: SolidTerrainOptions,
): Promise<SolidTerrainPrimitiveResult> {
  const sample = await sampleTerrainData(bounds, terrainProvider, options.gridSize)
  return buildSolidTerrainPrimitive(sample, options)
}

/**
 * Grid indices of the outer boundary of an n×n grid, in a continuous
 * counter-clockwise loop (south edge → east edge → north edge → west edge).
 */
function boundaryRingIndices(gridSize: number): number[] {
  const ring: number[] = []
  for (let x = 0; x < gridSize; x++) ring.push(gridIndex(x, 0, gridSize))
  for (let y = 1; y < gridSize; y++) ring.push(gridIndex(gridSize - 1, y, gridSize))
  for (let x = gridSize - 2; x >= 0; x--) ring.push(gridIndex(x, gridSize - 1, gridSize))
  for (let y = gridSize - 2; y >= 1; y--) ring.push(gridIndex(0, y, gridSize))
  return ring
}

interface CavityContext {
  thickness: number
  flatBottomHeight: number
  shellThickness: number
  useFlatBottom: boolean
  terrainColor: Color
  outerBottomEcef: Float64Array
  outerBottomOffset: number
}

/**
 * Build the cavity primitive for the open-bottom hollow preview: the inner
 * ceiling, inner walls and the bottom rim, matching the exported shell shape
 * (terrain surface inset by the shell thickness, opening downward).
 *
 * Rendered with `closed: false` so the cavity stays visible from any angle
 * regardless of winding; the fragment shader derives lighting normals from
 * screen-space derivatives.
 */
function buildCavityPrimitive(
  sample: TerrainSampleData,
  ctx: CavityContext,
): SolidTerrainPrimitive | null {
  const gridSize = sample.gridSize
  const topCount = gridSize * gridSize
  const t = ctx.shellThickness

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of sample.topLocalPositions) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const width = maxX - minX
  const depth = maxY - minY
  if (!(width > 2 * t) || !(depth > 2 * t)) return null

  const scaleX = (width - 2 * t) / width
  const scaleY = (depth - 2 * t) / depth
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  const ring = boundaryRingIndices(gridSize)
  const ringLength = ring.length
  const vertexCount = topCount * 2 + ringLength
  const positions = new Float64Array(vertexCount * 3)

  const localScratch = new Cartesian3()
  const ecefScratch = new Cartesian3()
  const writeLocal = (index: number, x: number, y: number, z: number): void => {
    localScratch.x = x
    localScratch.y = y
    localScratch.z = z
    const ecef = Matrix4.multiplyByPoint(sample.centerMatrix, localScratch, ecefScratch)
    positions[index * 3] = ecef.x
    positions[index * 3 + 1] = ecef.y
    positions[index * 3 + 2] = ecef.z
  }

  // Cavity ceiling: terrain surface inset by t, lowered by t.
  for (let i = 0; i < topCount; i++) {
    const p = sample.topLocalPositions[i]
    writeLocal(i, centerX + (p.x - centerX) * scaleX, centerY + (p.y - centerY) * scaleY, p.z - t)
  }
  // Cavity floor ring vertices (below the slab so nothing caps the opening).
  for (let i = 0; i < topCount; i++) {
    const p = sample.topLocalPositions[i]
    const x = centerX + (p.x - centerX) * scaleX
    const y = centerY + (p.y - centerY) * scaleY
    const bottomZ = (ctx.useFlatBottom ? ctx.flatBottomHeight : p.z - ctx.thickness) - 2 * t
    writeLocal(topCount + i, x, y, bottomZ)
  }
  // Outer bottom ring (copied from the solid slab's bottom grid boundary).
  for (let k = 0; k < ringLength; k++) {
    const source = (ctx.outerBottomOffset + ring[k]) * 3
    positions[(topCount * 2 + k) * 3] = ctx.outerBottomEcef[source]
    positions[(topCount * 2 + k) * 3 + 1] = ctx.outerBottomEcef[source + 1]
    positions[(topCount * 2 + k) * 3 + 2] = ctx.outerBottomEcef[source + 2]
  }

  const indices: number[] = []

  // Ceiling faces (visible from below through the opening).
  for (let y = 0; y < gridSize - 1; y++) {
    for (let x = 0; x < gridSize - 1; x++) {
      const a = gridIndex(x, y, gridSize)
      const b = gridIndex(x + 1, y, gridSize)
      const c = gridIndex(x, y + 1, gridSize)
      const d = gridIndex(x + 1, y + 1, gridSize)
      indices.push(a, c, b)
      indices.push(b, c, d)
    }
  }

  // Inner walls: cavity ceiling boundary down to the cavity floor ring.
  for (let k = 0; k < ringLength; k++) {
    const k2 = (k + 1) % ringLength
    const t1 = ring[k]
    const t2 = ring[k2]
    const b1 = topCount + t1
    const b2 = topCount + t2
    indices.push(t1, t2, b1)
    indices.push(t2, b2, b1)
  }

  // Bottom rim: annulus between the slab's outer bottom ring and the cavity.
  for (let k = 0; k < ringLength; k++) {
    const k2 = (k + 1) % ringLength
    const o1 = topCount * 2 + k
    const o2 = topCount * 2 + k2
    const i1 = topCount + ring[k]
    const i2 = topCount + ring[k2]
    indices.push(o1, i1, o2)
    indices.push(o2, i1, i2)
  }

  const indexArray = new Uint32Array(indices)
  const normalValues = buildTerrainNormals(positions, indexArray)
  const boundingSphere = BoundingSphere.fromVertices(positions)
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions,
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
        indices: indexArray,
        primitiveType: PrimitiveType.TRIANGLES,
        boundingSphere,
      }),
      attributes: {
        // 中空内面は外側と同じ色相のまま一段暗くし、下から見たときに
        // 開口部として一目で分かるようにする（白モデル・地形色変更にも追従）。
        color: ColorGeometryInstanceAttribute.fromColor(
          new Color(
            ctx.terrainColor.red * 0.72,
            ctx.terrainColor.green * 0.72,
            ctx.terrainColor.blue * 0.72,
            ctx.terrainColor.alpha,
          ),
        ),
      },
    }),
    appearance: new PerInstanceColorAppearance({
      closed: false,
      flat: false,
      translucent: false,
      vertexShaderSource: CAD_VERTEX_SHADER,
      fragmentShaderSource: CAD_FRAGMENT_SHADER,
    }),
    // 開口部から覗く内面には影を描画しない。
    shadows: ShadowMode.DISABLED,
    asynchronous: false,
  }) as SolidTerrainPrimitive
  primitive._machimokiSolidTerrain = true
  primitive._machimokiSolidTerrainVertexCount = vertexCount
  primitive._machimokiSolidTerrainHasNormals = true
  return primitive
}
