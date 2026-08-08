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

function parseNum(val: unknown): number | null {
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = parseFloat(val)
    return isNaN(n) ? null : n
  }
  return null
}

function checkFeatureBounds(
  feature: any,
  bounds: SelectionBounds,
  includeSpanning: boolean,
  pickPoints?: Array<{ lon: number; lat: number }>
): boolean {
  const xMinRaw = feature.getProperty('_xmin')
  const xMaxRaw = feature.getProperty('_xmax')
  const yMinRaw = feature.getProperty('_ymin')
  const yMaxRaw = feature.getProperty('_ymax')

  const xmin = parseNum(xMinRaw)
  const xmax = parseNum(xMaxRaw)
  const ymin = parseNum(yMinRaw)
  const ymax = parseNum(yMaxRaw)

  if (pickPoints && pickPoints.length > 0) {
    if (xmin !== null && xmax !== null && ymin !== null && ymax !== null) {
      return pickPoints.some(
        (p) => p.lon >= xmin && p.lon <= xmax && p.lat >= ymin && p.lat <= ymax
      )
    }
    const cx = parseNum(feature.getProperty('_x'))
    const cy = parseNum(feature.getProperty('_y'))
    if (cx !== null && cy !== null) {
      return pickPoints.some(
        (p) =>
          Math.abs(p.lon - cx) <= 1e-4 && Math.abs(p.lat - cy) <= 1e-4
      )
    }
    return true
  }

  if (xmin !== null && xmax !== null && ymin !== null && ymax !== null) {
    if (includeSpanning) {
      return (
        xmin <= bounds.east &&
        xmax >= bounds.west &&
        ymin <= bounds.north &&
        ymax >= bounds.south
      )
    }
    return (
      xmin >= bounds.west &&
      xmax <= bounds.east &&
      ymin >= bounds.south &&
      ymax <= bounds.north
    )
  }

  // fallback: center point (_x, _y)
  const cx = parseNum(feature.getProperty('_x'))
  const cy = parseNum(feature.getProperty('_y'))
  if (cx !== null && cy !== null) {
    return (
      cx >= bounds.west &&
      cx <= bounds.east &&
      cy >= bounds.south &&
      cy <= bounds.north
    )
  }

  return true
}

function filterTileFeatures(
  tile: any,
  bounds: SelectionBounds,
  includeSpanning: boolean,
  pickPoints?: Array<{ lon: number; lat: number }>
): void {
  const content = tile?.content
  if (!content || !content.featuresLength) return

  for (let i = 0; i < content.featuresLength; i++) {
    const feature = content.getFeature(i)
    if (!feature) continue
    feature.show = checkFeatureBounds(feature, bounds, includeSpanning, pickPoints)
  }
}

function traverseTiles(
  tile: any,
  bounds: SelectionBounds,
  includeSpanning: boolean,
  pickPoints?: Array<{ lon: number; lat: number }>
): void {
  if (!tile) return
  filterTileFeatures(tile, bounds, includeSpanning, pickPoints)
  if (tile.children) {
    for (const child of tile.children) {
      traverseTiles(child, bounds, includeSpanning, pickPoints)
    }
  }
}

export function refilterSpanning(tileset: any, includeSpanning?: boolean): void {
  if (includeSpanning !== undefined) {
    tileset._customIncludeSpanning = includeSpanning
  }
  const bounds: SelectionBounds | undefined = tileset._customSelectionBounds
  if (!bounds) return
  const is: boolean = tileset._customIncludeSpanning ?? false
  const pickPoints: Array<{ lon: number; lat: number }> | undefined = tileset._customPickPoints
  if (tileset._root) {
    traverseTiles(tileset._root, bounds, is, pickPoints)
  }
}

export function refilterPickPoints(
  tileset: any,
  pickPoints?: Array<{ lon: number; lat: number }>
): void {
  tileset._customPickPoints = pickPoints
  const bounds: SelectionBounds | undefined = tileset._customSelectionBounds
  if (!bounds) return
  const is: boolean = tileset._customIncludeSpanning ?? false
  if (tileset._root) {
    traverseTiles(tileset._root, bounds, is, pickPoints)
  }
}

export function applyClippingToTileset(
  tileset: any,
  bounds: SelectionBounds,
  includeSpanning = false,
  pickPoints?: Array<{ lon: number; lat: number }>
): void {
  tileset.clippingPlanes = undefined
  tileset.clippingPolygons = undefined

  tileset._customSelectionBounds = bounds
  tileset._customIncludeSpanning = includeSpanning
  tileset._customPickPoints = pickPoints

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

  const tileLoadHandler = (tile: any) => {
    const b = tileset._customSelectionBounds
    if (!b) return
    const is = tileset._customIncludeSpanning ?? false
    const pp: Array<{ lon: number; lat: number }> | undefined = tileset._customPickPoints
    filterTileFeatures(tile, b, is, pp)
  }

  if (!tileset._customFilterRegistered) {
    tileset._customFilterRegistered = true
    if (tileset.tileLoad) {
      tileset.tileLoad.addEventListener(tileLoadHandler)
    }
  }

  if (tileset._root) {
    traverseTiles(tileset._root, bounds, includeSpanning, pickPoints)
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
