/**
 * MapLibre上の選択矩形・ピック点表示（Cesium非依存）。
 *
 * - 選択矩形: SelectionBounds→GeoJSON Polygon（閉環・[lng,lat]順）
 * - ピック点: PickPoint[]→GeoJSON Point集約（Cesium版の赤丸＋白縁相当）
 * - 実Mapへの反映は ensure/remove 系で行い、失敗は吞み込んで
 *   export経路をブロックしない。
 */
import type { SelectionBounds } from './selectionBounds'

export interface PickPoint {
  lon: number
  lat: number
}

export const SELECTION_SOURCE_ID = 'machimoki-selection'
export const SELECTION_FILL_LAYER_ID = 'machimoki-selection-fill'
export const SELECTION_LINE_LAYER_ID = 'machimoki-selection-line'
export const PICK_SOURCE_ID = 'machimoki-picks'
export const PICK_LAYER_ID = 'machimoki-pick-points'

/** 選択矩形の塗り（コントローラーの描画ボックスと同系色） */
export const SELECTION_FILL_COLOR = '#00bcd4'
export const SELECTION_FILL_OPACITY = 0.15
/** ピック点の塗り（Cesium版の赤丸＋白縁相当） */
export const PICK_CIRCLE_COLOR = '#ff0000'
export const PICK_CIRCLE_STROKE_COLOR = '#ffffff'

/**
 * 実MapLibreMapとの代入互換を保つ最小形状。
 * getSourceはunknownで受け、setData可否は実行時に判定する。
 */
export interface OverlayMapLike {
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  getLayer(id: string): unknown
  addLayer(layer: unknown): void
  removeLayer(id: string): void
  removeSource(id: string): void
}

function sourceExists(map: OverlayMapLike, id: string): boolean {
  try {
    const source = map.getSource(id)
    return source !== undefined && source !== null
  } catch {
    return false
  }
}

function layerExists(map: OverlayMapLike, id: string): boolean {
  try {
    const layer = map.getLayer(id)
    return layer !== undefined && layer !== null
  } catch {
    return false
  }
}

interface SettableSource {
  setData: (data: unknown) => void
}

/** GeoJSONソースのsetDataを安全に取り出す。無ければnull。 */
function asSettableSource(value: unknown): SettableSource | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as { setData?: unknown }
  if (typeof candidate.setData !== 'function') {
    return null
  }
  // メソッド呼び出し形式を保つ（切り離すとMapLibreのsetDataがthis喪失で例外になる）。
  const source = candidate as { setData: (data: unknown) => void }
  return {
    setData: (data: unknown): void => {
      source.setData(data)
    },
  }
}

/** SelectionBounds→閉環Polygon Feature（座標は[lng,lat]順）。 */
export function selectionBoundsToPolygon(
  bounds: SelectionBounds,
): Record<string, unknown> {
  const ring: Array<[number, number]> = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ]
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

/** PickPoint[]→Point FeatureCollection。 */
export function pickPointsToFeatureCollection(
  points: PickPoint[],
): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    })),
  }
}

/**
 * 選択矩形オーバーレイを反映する。bounds=nullで除去。
 * 失敗は吞み込む（exportをブロックしない）。
 */
export function ensureSelectionOverlay(
  map: OverlayMapLike,
  bounds: SelectionBounds | null,
): void {
  try {
    if (bounds === null) {
      removeSelectionOverlay(map)
      return
    }
    const data = selectionBoundsToPolygon(bounds)
    const existing = asSettableSource(map.getSource(SELECTION_SOURCE_ID))
    if (existing !== null) {
      existing.setData(data)
      return
    }
    map.addSource(SELECTION_SOURCE_ID, { type: 'geojson', data })
    if (!layerExists(map, SELECTION_FILL_LAYER_ID)) {
      map.addLayer({
        id: SELECTION_FILL_LAYER_ID,
        type: 'fill',
        source: SELECTION_SOURCE_ID,
        paint: {
          'fill-color': SELECTION_FILL_COLOR,
          'fill-opacity': SELECTION_FILL_OPACITY,
        },
      })
    }
    if (!layerExists(map, SELECTION_LINE_LAYER_ID)) {
      map.addLayer({
        id: SELECTION_LINE_LAYER_ID,
        type: 'line',
        source: SELECTION_SOURCE_ID,
        paint: { 'line-color': SELECTION_FILL_COLOR, 'line-width': 2 },
      })
    }
  } catch {
    /* 表示失敗は無視 */
  }
}

export function removeSelectionOverlay(map: OverlayMapLike): void {
  try {
    if (layerExists(map, SELECTION_FILL_LAYER_ID)) {
      map.removeLayer(SELECTION_FILL_LAYER_ID)
    }
    if (layerExists(map, SELECTION_LINE_LAYER_ID)) {
      map.removeLayer(SELECTION_LINE_LAYER_ID)
    }
    if (sourceExists(map, SELECTION_SOURCE_ID)) {
      map.removeSource(SELECTION_SOURCE_ID)
    }
  } catch {
    /* 後片付けの失敗は無視 */
  }
}

/**
 * ピック点オーバーレイを反映する。空配列で除去。
 * 失敗は吞み込む（exportをブロックしない）。
 */
export function ensurePickOverlay(
  map: OverlayMapLike,
  points: PickPoint[],
): void {
  try {
    if (points.length === 0) {
      removePickOverlay(map)
      return
    }
    const data = pickPointsToFeatureCollection(points)
    const existing = asSettableSource(map.getSource(PICK_SOURCE_ID))
    if (existing !== null) {
      existing.setData(data)
      return
    }
    map.addSource(PICK_SOURCE_ID, { type: 'geojson', data })
    if (!layerExists(map, PICK_LAYER_ID)) {
      map.addLayer({
        id: PICK_LAYER_ID,
        type: 'circle',
        source: PICK_SOURCE_ID,
        paint: {
          'circle-color': PICK_CIRCLE_COLOR,
          'circle-radius': 6,
          'circle-stroke-color': PICK_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': 2,
        },
      })
    }
  } catch {
    /* 表示失敗は無視 */
  }
}

export function removePickOverlay(map: OverlayMapLike): void {
  try {
    if (layerExists(map, PICK_LAYER_ID)) {
      map.removeLayer(PICK_LAYER_ID)
    }
    if (sourceExists(map, PICK_SOURCE_ID)) {
      map.removeSource(PICK_SOURCE_ID)
    }
  } catch {
    /* 後片付けの失敗は無視 */
  }
}
