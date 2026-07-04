import { Math as CesiumMath } from 'cesium'

export interface SelectionBounds {
  west: number
  south: number
  east: number
  north: number
}

let patched = false

export function applyClippingToTileset(
  tileset: any,
  bounds: SelectionBounds
): void {
  console.log('[clipping] Applying update-patch clipping')

  tileset.clippingPlanes = undefined
  tileset.clippingPolygons = undefined
  tileset.style = undefined

  tileset._customSelectionBounds = bounds

  const Cesium3DTile = tileset._root?.constructor
  if (!Cesium3DTile || patched) return
  patched = true

  const originalUpdate = Cesium3DTile.prototype.update
  Cesium3DTile.prototype.update = function (
    ts: any,
    frameState: any,
    passOptions: any
  ) {
    const b = ts._customSelectionBounds
    if (b && this._header?.boundingVolume?.region) {
      const [w, s, e, n] = this._header.boundingVolume.region
      if (
        CesiumMath.toDegrees(e) < b.west ||
        CesiumMath.toDegrees(w) > b.east ||
        CesiumMath.toDegrees(n) < b.south ||
        CesiumMath.toDegrees(s) > b.north
      ) {
        return
      }
    }
    return originalUpdate.call(this, ts, frameState, passOptions)
  }

  console.log('[clipping] Update patch applied')
}

export function createGlobeClippingPlanes(_bounds: SelectionBounds): any {
  return undefined
}
