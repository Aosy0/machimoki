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
}

const DEFAULT_GRID_SIZE = 64
const MIN_TERRAIN_THICKNESS = 0.1
const TERRAIN_SURFACE_OFFSET = 0.05

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

  for (let i = 0; i < sampledPositions.length; i++) {
    const sample = sampledPositions[i]
    const height = getSampleHeight(sample)
    const ecef = Cartesian3.fromRadians(sample.longitude, sample.latitude, height + TERRAIN_SURFACE_OFFSET)
    const local = Matrix4.multiplyByPoint(inverseCenterMatrix, ecef, new Cartesian3())

    topLocalPositions.push(local)
    minTopHeight = Math.min(minTopHeight, local.z)

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
  const boundingSphere = BoundingSphere.fromVertices(positionValues)
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positionValues,
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
      flat: true,
      translucent: false,
    }),
    asynchronous: false,
  }) as SolidTerrainPrimitive
  primitive._machimokiSolidTerrain = true
  primitive._machimokiSolidTerrainVertexCount = vertexCount

  return {
    primitive,
    boundingSphere,
  }
}
