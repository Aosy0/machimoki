import {
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  Math as CesiumMath,
  Ellipsoid,
  Cartographic,
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

  const planes: ClippingPlane[] = []

  const createPlaneFromEdge = (
    point1: Cartesian3,
    point2: Cartesian3,
    center: Cartesian3
  ): ClippingPlane => {
    const midpoint = Cartesian3.add(point1, point2, new Cartesian3())
    Cartesian3.multiplyByScalar(midpoint, 0.5, midpoint)

    const up = Cartesian3.normalize(center, new Cartesian3())
    const right = Cartesian3.subtract(point2, midpoint, new Cartesian3())
    Cartesian3.normalize(right, right)

    const normal = Cartesian3.cross(up, right, new Cartesian3())
    Cartesian3.normalize(normal, normal)

    const distance = Cartesian3.dot(normal, midpoint)

    return new ClippingPlane(normal, distance)
  }

  const centerLat = (southRad + northRad) / 2
  const centerLon = (westRad + eastRad) / 2
  const center = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(centerLon, centerLat, 0),
    new Cartesian3()
  )

  const westNorth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(westRad, northRad, 0),
    new Cartesian3()
  )
  const westSouth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(westRad, southRad, 0),
    new Cartesian3()
  )
  planes.push(createPlaneFromEdge(westNorth, westSouth, center))

  const eastNorth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(eastRad, northRad, 0),
    new Cartesian3()
  )
  const eastSouth = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(eastRad, southRad, 0),
    new Cartesian3()
  )
  planes.push(createPlaneFromEdge(eastSouth, eastNorth, center))

  const southWest = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(westRad, southRad, 0),
    new Cartesian3()
  )
  const southEast = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(eastRad, southRad, 0),
    new Cartesian3()
  )
  planes.push(createPlaneFromEdge(southEast, southWest, center))

  const northWest = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(westRad, northRad, 0),
    new Cartesian3()
  )
  const northEast = Ellipsoid.WGS84.cartographicToCartesian(
    new Cartographic(eastRad, northRad, 0),
    new Cartesian3()
  )
  planes.push(createPlaneFromEdge(northWest, northEast, center))

  return new ClippingPlaneCollection({
    planes,
    edgeWidth: options?.edgeWidth ?? 2.0,
    edgeColor: options?.edgeColor ?? Color.WHITE,
    unionClippingRegions: options?.unionClippingRegions ?? false,
  })
}

export function applyClippingToTileset(
  tileset: { clippingPlanes?: ClippingPlaneCollection },
  bounds: SelectionBounds,
  options?: {
    edgeWidth?: number
    edgeColor?: Color
    unionClippingRegions?: boolean
  }
): void {
  tileset.clippingPlanes = createClippingPlanesFromBounds(bounds, options)
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