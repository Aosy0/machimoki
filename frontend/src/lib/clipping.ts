import {
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  Math as CesiumMath,
  Ellipsoid,
  Cartographic,
  Matrix4,
} from 'cesium'

export interface SelectionBounds {
  west: number
  south: number
  east: number
  north: number
}


export function createClippingPlanesFromBounds(
  bounds: SelectionBounds,
  options?: {
    edgeWidth?: number
    edgeColor?: Color
    unionClippingRegions?: boolean
  }
): ClippingPlaneCollection {
  const { west, south, east, north } = bounds

  const westRad = CesiumMath.toRadians(west)
  const eastRad = CesiumMath.toRadians(east)
  const southRad = CesiumMath.toRadians(south)
  const northRad = CesiumMath.toRadians(north)

  const centerCartographic = new Cartographic(
    (westRad + eastRad) / 2,
    (southRad + northRad) / 2,
    0
  )
  const center = Ellipsoid.WGS84.cartographicToCartesian(
    centerCartographic,
    new Cartesian3()
  )

  const createPlaneThroughEdge = (edgeMidpoint: Cartesian3): ClippingPlane => {
    const normal = Cartesian3.subtract(center, edgeMidpoint, new Cartesian3())
    Cartesian3.normalize(normal, normal)
    const distance = -Cartesian3.dot(normal, edgeMidpoint)
    return new ClippingPlane(normal, distance)
  }

  const midWest = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(westRad, (southRad + northRad) / 2, 0),
    new Cartesian3()
  )
  const midEast = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(eastRad, (southRad + northRad) / 2, 0),
    new Cartesian3()
  )
  const midSouth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic((westRad + eastRad) / 2, southRad, 0),
    new Cartesian3()
  )
  const midNorth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic((westRad + eastRad) / 2, northRad, 0),
    new Cartesian3()
  )

  const planes: ClippingPlane[] = [
    createPlaneThroughEdge(midWest),
    createPlaneThroughEdge(midEast),
    createPlaneThroughEdge(midSouth),
    createPlaneThroughEdge(midNorth),
  ]

  return new ClippingPlaneCollection({
    planes,
    edgeWidth: options?.edgeWidth ?? 2.0,
    edgeColor: options?.edgeColor ?? Color.WHITE,
    unionClippingRegions: options?.unionClippingRegions ?? false,
  })
}

export function applyClippingToTileset(
  tileset: {
    clippingPlanes?: ClippingPlaneCollection
    root?: { transform?: Matrix4 }
  },
  bounds: SelectionBounds,
  options?: {
    edgeWidth?: number
    edgeColor?: Color
    unionClippingRegions?: boolean
  }
): void {
  const clippingPlanes = createClippingPlanesFromBounds(bounds, options)

  const rootTransform = tileset.root?.transform
  console.log('[clipping] rootTransform:', rootTransform ? 'exists' : 'undefined/null')
  if (rootTransform) {
    const elements = Matrix4.toArray(rootTransform)
    const isIdentity = Matrix4.equals(rootTransform, Matrix4.IDENTITY)
    console.log('[clipping] rootTransform is identity:', isIdentity)
    console.log('[clipping] rootTransform diagonal:', elements[0], elements[5], elements[10], elements[15])
    if (!isIdentity) {
      clippingPlanes.modelMatrix = rootTransform
      console.log('[clipping] Set modelMatrix = rootTransform')
    } else {
      console.log('[clipping] rootTransform is IDENTITY, leaving modelMatrix as default')
    }
  }

  tileset.clippingPlanes = clippingPlanes
}

export function applyClippingToGlobe(
  globe: { clippingPlanes?: ClippingPlaneCollection },
  bounds: SelectionBounds,
  options?: {
    edgeWidth?: number
    edgeColor?: Color
    unionClippingRegions?: boolean
  }
): void {
  globe.clippingPlanes = createClippingPlanesFromBounds(bounds, options)
}