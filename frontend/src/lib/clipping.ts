import {
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Color,
  Ellipsoid,
  Cartographic,
  Transforms,
  CustomShader,
} from 'cesium'

export interface SelectionBounds {
  west: number
  south: number
  east: number
  north: number
}

function toEcef(lonDeg: number, latDeg: number): Cartesian3 {
  return Ellipsoid.WGS84.cartographicToCartesian(
    Cartographic.fromDegrees(lonDeg, latDeg, 0),
    new Cartesian3()
  )
}

export function createTilesetClipShader(bounds: SelectionBounds): CustomShader {
  const { west, south, east, north } = bounds

  console.log('[clipping] CustomShader bounds (deg):', { west, south, east, north })

  return new CustomShader({
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        material.diffuse = vec3(1.0, 0.0, 0.0);
      }
    `,
  })
}

export function applyClippingToTileset(
  tileset: any,
  bounds: SelectionBounds,
  _options?: {
    edgeWidth?: number
    edgeColor?: Color
    unionClippingRegions?: boolean
  }
): void {
  console.log('[clipping] Applying CustomShader clipping to tileset')
  const shader = createTilesetClipShader(bounds)
  tileset.customShader = shader
  console.log('[clipping] CustomShader applied successfully')
}

export function createGlobeClippingPlanes(
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

  const center = Ellipsoid.WGS84.cartographicToCartesian(
    Cartographic.fromDegrees(centerLon, centerLat, 0),
    new Cartesian3()
  )

  const modelMatrix = Transforms.eastNorthUpToFixedFrame(center)

  const halfWidthMeters =
    Cartesian3.distance(toEcef(east, centerLat), toEcef(west, centerLat)) / 2

  const halfHeightMeters =
    Cartesian3.distance(toEcef(centerLon, north), toEcef(centerLon, south)) / 2

  const planes = [
    new ClippingPlane(new Cartesian3(1, 0, 0), halfWidthMeters),
    new ClippingPlane(new Cartesian3(-1, 0, 0), halfWidthMeters),
    new ClippingPlane(new Cartesian3(0, 1, 0), halfHeightMeters),
    new ClippingPlane(new Cartesian3(0, -1, 0), halfHeightMeters),
  ]

  return new ClippingPlaneCollection({
    planes,
    modelMatrix,
    edgeWidth: options?.edgeWidth ?? 2.0,
    edgeColor: options?.edgeColor ?? Color.WHITE,
    unionClippingRegions: options?.unionClippingRegions ?? false,
  })
}
