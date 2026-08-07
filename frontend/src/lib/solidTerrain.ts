import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
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
  Transforms,
  sampleTerrainMostDetailed,
} from 'cesium'
import type { TerrainProvider } from 'cesium'

export interface TerrainBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface SolidTerrainOptions {
  terrainThickness: number
  flattenBottom: boolean
  gridSize?: number
  terrainColor?: string
}

export interface SolidTerrainPrimitiveResult {
  primitive: Primitive
  boundingSphere: BoundingSphere
}

type SolidTerrainPrimitive = Primitive & {
  _machimokiSolidTerrain?: boolean
  _machimokiSolidTerrainVertexCount?: number
  _machimokiSolidTerrainHasNormals?: boolean
}

const DEFAULT_GRID_SIZE = 64
const MIN_TERRAIN_THICKNESS = 0.1
const TERRAIN_SURFACE_OFFSET = 0.05

const RELIEF_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_color = color;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

const RELIEF_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec4 v_color;

void main()
{
    // Flat normal from screen-space derivatives — CAD-style per-face shading
    vec3 flatNormal = normalize(cross(dFdx(v_positionEC), dFdy(v_positionEC)));

    // Simple directional light with high contrast
    float light = max(dot(flatNormal, normalize(czm_lightDirectionEC)), 0.0);
    float lightFactor = mix(0.3, 1.0, light);

    out_FragColor = czm_gammaCorrect(vec4(v_color.rgb * lightFactor, v_color.a));
}
`

function gridIndex(x: number, y: number, gridSize: number): number {
  return y * gridSize + x
}

function getSampleHeight(sample: Cartographic): number {
  return Number.isFinite(sample.height) ? sample.height : 0
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
}

export async function sampleTerrainData(
  bounds: TerrainBounds,
  terrainProvider: TerrainProvider,
  gridSize?: number
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

  const sampledPositions = await sampleTerrainMostDetailed(terrainProvider, samplePositions)

  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0)
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian)
  const inverseCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4())
  const topVertexCount = resolvedGridSize * resolvedGridSize
  const topEcefValues = new Float64Array(topVertexCount * 3)
  const topLocalPositions: Cartesian3[] = []

  let minTopHeight = Number.POSITIVE_INFINITY

  for (let i = 0; i < sampledPositions.length; i++) {
    const sample = sampledPositions[i]
    const height = getSampleHeight(sample)
    const ecef = Cartesian3.fromRadians(sample.longitude, sample.latitude, height + TERRAIN_SURFACE_OFFSET)
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
  }
}

export function buildSolidTerrainPrimitive(
  sample: TerrainSampleData,
  options: SolidTerrainOptions
): SolidTerrainPrimitiveResult {
  const gridSize = sample.gridSize
  const topVertexCount = gridSize * gridSize
  const vertexCount = topVertexCount * 2
  const positionValues = new Float64Array(vertexCount * 3)

  positionValues.set(sample.topEcefValues)

  const thickness = Math.max(MIN_TERRAIN_THICKNESS, options.terrainThickness)
  const flatBottomHeight = sample.minTopHeight - thickness

  for (let i = 0; i < sample.topLocalPositions.length; i++) {
    const topLocal = sample.topLocalPositions[i]
    const bottomLocal = new Cartesian3(
      topLocal.x,
      topLocal.y,
      options.flattenBottom ? flatBottomHeight : topLocal.z - thickness
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

  const geometry = new Geometry({
    attributes,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere,
  })

  const terrainColor = Color.fromCssColorString(options.terrainColor ?? '#ffffff')
  const instance = new GeometryInstance({
    geometry,
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(terrainColor),
    },
  })

  const primitive = new Primitive({
    geometryInstances: instance,
    appearance: new PerInstanceColorAppearance({
      closed: true,
      flat: false,
      translucent: false,
      vertexShaderSource: RELIEF_VERTEX_SHADER,
      fragmentShaderSource: RELIEF_FRAGMENT_SHADER,
    }),
    asynchronous: false,
  }) as SolidTerrainPrimitive
  primitive._machimokiSolidTerrain = true
  primitive._machimokiSolidTerrainVertexCount = vertexCount
  primitive._machimokiSolidTerrainHasNormals = true

  return {
    primitive,
    boundingSphere,
  }
}

export async function createSolidTerrainPrimitive(
  bounds: TerrainBounds,
  terrainProvider: TerrainProvider,
  options: SolidTerrainOptions
): Promise<SolidTerrainPrimitiveResult> {
  const sample = await sampleTerrainData(bounds, terrainProvider, options.gridSize)
  return buildSolidTerrainPrimitive(sample, options)
}
