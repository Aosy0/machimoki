import {
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  Ellipsoid,
  Cartographic,
  Transforms,
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

  const centerLon = (west + east) / 2
  const centerLat = (south + north) / 2

  const centerCartographic = Cartographic.fromDegrees(centerLon, centerLat, 0)
  const center = Ellipsoid.WGS84.cartographicToCartesian(centerCartographic, new Cartesian3())

  const modelMatrix = Transforms.eastNorthUpToFixedFrame(center)

  const halfWidthMeters = Cartesian3.distance(
    Ellipsoid.WGS84.cartographicToCartesian(
      Cartographic.fromDegrees(east, centerLat, 0), new Cartesian3()
    ),
    Ellipsoid.WGS84.cartographicToCartesian(
      Cartographic.fromDegrees(west, centerLat, 0), new Cartesian3()
    )
  ) / 2

  const halfHeightMeters = Cartesian3.distance(
    Ellipsoid.WGS84.cartographicToCartesian(
      Cartographic.fromDegrees(centerLon, north, 0), new Cartesian3()
    ),
    Ellipsoid.WGS84.cartographicToCartesian(
      Cartographic.fromDegrees(centerLon, south, 0), new Cartesian3()
    )
  ) / 2

  const planes = [
    new ClippingPlane(new Cartesian3(1, 0, 0), halfWidthMeters),
    new ClippingPlane(new Cartesian3(-1, 0, 0), halfWidthMeters),
    new ClippingPlane(new Cartesian3(0, 1, 0), halfHeightMeters),
    new ClippingPlane(new Cartesian3(0, -1, 0), halfHeightMeters),
  ]

  const collection = new ClippingPlaneCollection({
    planes,
    modelMatrix,
    edgeWidth: options?.edgeWidth ?? 2.0,
    edgeColor: options?.edgeColor ?? Color.WHITE,
    unionClippingRegions: options?.unionClippingRegions ?? false,
  })

  console.log('[clipping] ENU modelMatrix set, halfWidth:', halfWidthMeters.toFixed(0), 'm, halfHeight:', halfHeightMeters.toFixed(0), 'm')

  return collection
}

export function applyClippingToTileset(
  tileset: {
    clippingPlanes?: ClippingPlaneCollection
  },
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