import {
  Math as CesiumMath,
  Cartesian3,
  ClippingPlane,
  ClippingPlaneCollection,
  Transforms,
} from 'cesium'

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
  tileset.clippingPlanes = undefined
  tileset.clippingPolygons = undefined

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
  }

  const filterFeatures = (tile: any) => {
    const content = tile?.content
    if (!content || !content.featuresLength) return

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
      }
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
  }

  if (tileset._root) {
    traverseTiles(tileset._root)
  }
}

export function createGlobeClippingPlanes(bounds: SelectionBounds): ClippingPlaneCollection {
  // 矩形の中心を計算
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2
  
  // 中心位置からローカル座標系（East-North-Up）を生成
  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0)
  const modelMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian)
  
  // 矩形の幅と高さをメートル単位で計算
  const widthRad = CesiumMath.toRadians(bounds.east - bounds.west)
  const heightRad = CesiumMath.toRadians(bounds.north - bounds.south)
  const widthMeters = widthRad * 6371000 * Math.cos(CesiumMath.toRadians(centerLat))
  const heightMeters = heightRad * 6371000
  
  // 各辺までの距離（中心から半分）
  const halfWidth = widthMeters / 2
  const halfHeight = heightMeters / 2
  
  // ローカル座標系で外向きの法線を定義
  // X軸: 東向き, Y軸: 北向き, Z軸: 上向き
  const planes = [
    new ClippingPlane(new Cartesian3(1.0, 0.0, 0.0), halfWidth),   // 東側の平面（西向きにクリップ）
    new ClippingPlane(new Cartesian3(-1.0, 0.0, 0.0), halfWidth),  // 西側の平面（東向きにクリップ）
    new ClippingPlane(new Cartesian3(0.0, 1.0, 0.0), halfHeight),  // 北側の平面（南向きにクリップ）
    new ClippingPlane(new Cartesian3(0.0, -1.0, 0.0), halfHeight), // 南側の平面（北向きにクリップ）
  ]
  
  return new ClippingPlaneCollection({
    modelMatrix: modelMatrix,
    planes: planes,
    unionClippingRegions: true, // OR条件: いずれかの平面の外側をクリッピング
  })
}
