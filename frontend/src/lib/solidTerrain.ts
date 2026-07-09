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
}

export interface SolidTerrainPrimitiveResult {
  primitive: Primitive
  boundingSphere: BoundingSphere
}

type SolidTerrainPrimitive = Primitive & {
  _machimokiSolidTerrain?: boolean
  _machimokiSolidTerrainVertexCount?: number
  _machimokiSolidTerrainHasNormals?: boolean
  _machimokiSolidTerrainHasReliefShading?: boolean
}

const DEFAULT_GRID_SIZE = 64
const MIN_TERRAIN_THICKNESS = 0.1
const TERRAIN_SURFACE_OFFSET = 0.05

const RELIEF_VERTEX_SHADER = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in float terrainShade;
in vec4 color;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out float v_terrainShade;
out vec4 v_color;

void main()
{
    vec4 p = czm_computePosition();

    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_terrainShade = terrainShade;
    v_color = color;

    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`

const RELIEF_FRAGMENT_SHADER = `
in vec3 v_positionEC;
in vec3 v_normalEC;
in float v_terrainShade;
in vec4 v_color;

void main()
{
    vec3 positionToEyeEC = -v_positionEC;
    vec3 normalEC = normalize(v_normalEC);
    float directLight = max(dot(normalEC, normalize(czm_lightDirectionEC)), 0.0);
    float contrastLight = smoothstep(0.05, 0.95, directLight);
    float relief = clamp(v_terrainShade, 0.0, 1.0);

    vec3 lowColor = vec3(0.36, 0.50, 0.32);
    vec3 midColor = vec3(0.56, 0.68, 0.43);
    vec3 highColor = vec3(0.82, 0.86, 0.58);
    vec3 terrainColor = mix(lowColor, midColor, smoothstep(0.00, 0.55, relief));
    terrainColor = mix(terrainColor, highColor, smoothstep(0.45, 1.00, relief));

    float reliefContrast = 0.72 + relief * 0.42;
    float lightContrast = 0.42 + contrastLight * 0.72;
    vec3 color = terrainColor * reliefContrast * lightContrast;

    out_FragColor = czm_gammaCorrect(vec4(color, v_color.a));
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

function buildTerrainShadeValues(
  topLocalPositions: Cartesian3[],
  minTopHeight: number,
  maxTopHeight: number,
  vertexCount: number
): Float32Array {
  const topVertexCount = topLocalPositions.length
  const shadeValues = new Float32Array(vertexCount)
  const heightRange = Math.max(maxTopHeight - minTopHeight, 0.01)

  for (let i = 0; i < topVertexCount; i++) {
    shadeValues[i] = (topLocalPositions[i].z - minTopHeight) / heightRange
  }

  return shadeValues
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

export async function createSolidTerrainPrimitive(
  bounds: TerrainBounds,
  terrainProvider: TerrainProvider,
  options: SolidTerrainOptions
): Promise<SolidTerrainPrimitiveResult> {
  const gridSize = Math.max(2, Math.floor(options.gridSize ?? DEFAULT_GRID_SIZE))
  const widthDeg = bounds.east - bounds.west
  const heightDeg = bounds.north - bounds.south
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2

  const samplePositions: Cartographic[] = []
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const lon = bounds.west + (widthDeg * x) / (gridSize - 1)
      const lat = bounds.south + (heightDeg * y) / (gridSize - 1)
      samplePositions.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  const sampledPositions = await sampleTerrainMostDetailed(terrainProvider, samplePositions)

  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0)
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian)
  const inverseCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4())
  const topVertexCount = gridSize * gridSize
  const vertexCount = topVertexCount * 2
  const positionValues = new Float64Array(vertexCount * 3)
  const topLocalPositions: Cartesian3[] = []

  let minTopHeight = Number.POSITIVE_INFINITY
  let maxTopHeight = Number.NEGATIVE_INFINITY

  for (let i = 0; i < sampledPositions.length; i++) {
    const sample = sampledPositions[i]
    const height = getSampleHeight(sample)
    const ecef = Cartesian3.fromRadians(sample.longitude, sample.latitude, height + TERRAIN_SURFACE_OFFSET)
    const local = Matrix4.multiplyByPoint(inverseCenterMatrix, ecef, new Cartesian3())

    topLocalPositions.push(local)
    minTopHeight = Math.min(minTopHeight, local.z)
    maxTopHeight = Math.max(maxTopHeight, local.z)

    positionValues[i * 3] = ecef.x
    positionValues[i * 3 + 1] = ecef.y
    positionValues[i * 3 + 2] = ecef.z
  }

  const thickness = Math.max(MIN_TERRAIN_THICKNESS, options.terrainThickness)
  const flatBottomHeight = minTopHeight - thickness

  for (let i = 0; i < topLocalPositions.length; i++) {
    const topLocal = topLocalPositions[i]
    const bottomLocal = new Cartesian3(
      topLocal.x,
      topLocal.y,
      options.flattenBottom ? flatBottomHeight : topLocal.z - thickness
    )
    const bottomEcef = Matrix4.multiplyByPoint(centerMatrix, bottomLocal, new Cartesian3())
    const vertexIndex = topVertexCount + i

    positionValues[vertexIndex * 3] = bottomEcef.x
    positionValues[vertexIndex * 3 + 1] = bottomEcef.y
    positionValues[vertexIndex * 3 + 2] = bottomEcef.z
  }

  const indices = buildTerrainIndices(gridSize)
  const normalValues = buildTerrainNormals(positionValues, indices)
  const shadeValues = buildTerrainShadeValues(topLocalPositions, minTopHeight, maxTopHeight, vertexCount)
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
  ;(attributes as GeometryAttributes & { terrainShade: GeometryAttribute }).terrainShade = new GeometryAttribute({
    componentDatatype: ComponentDatatype.FLOAT,
    componentsPerAttribute: 1,
    values: shadeValues,
  })

  const geometry = new Geometry({
    attributes,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere,
  })

  const instance = new GeometryInstance({
    geometry,
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString('#6f8f6a')),
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
  primitive._machimokiSolidTerrainHasReliefShading = true

  return {
    primitive,
    boundingSphere,
  }
}
