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
  console.log('[clipping] Applying feature-level clipping')

  tileset.clippingPlanes = undefined
  tileset.clippingPolygons = undefined
  tileset.style = undefined

  tileset._customSelectionBounds = bounds

  const Cesium3DTile = tileset._root?.constructor
  if (Cesium3DTile && !patched) {
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
    console.log('[clipping] Tile-level culling patch applied')
  }

  const filterFeatures = (tile: any) => {
    const content = tile?.content
    if (!content || !content.featuresLength) return

    let filtered = 0
    for (let i = 0; i < content.featuresLength; i++) {
      const feature = content.getFeature(i)
      if (!feature) continue

      const xRaw = feature.getProperty('_x')
      const yRaw = feature.getProperty('_y')

      const x = typeof xRaw === 'string' ? parseFloat(xRaw) : xRaw
      const y = typeof yRaw === 'string' ? parseFloat(yRaw) : yRaw

      if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
        const inBounds =
          x >= bounds.west &&
          x <= bounds.east &&
          y >= bounds.south &&
          y <= bounds.north
        feature.show = inBounds
        if (!inBounds) filtered++
      }
    }
    if (filtered > 0) {
      console.log(`[clipping] Filtered ${filtered} features outside bounds in tile`)
    }
  }

  const traverseTiles = (tile: any) => {
    if (!tile) return
    filterFeatures(tile)
    if (tile.children) {
      for (const child of tile.children) {
        traverseTiles(child)
      }
    }
  }

  if (tileset.tileLoad) {
    tileset.tileLoad.addEventListener(filterFeatures)
    console.log('[clipping] tileLoad event listener added')
  }

  if (tileset._root) {
    traverseTiles(tileset._root)
    console.log('[clipping] Initial tile traversal complete')
  }

  console.log('[clipping] Feature-level clipping applied')
}

export function createGlobeClippingPlanes(_bounds: SelectionBounds): any {
  return undefined
}
