/**
 * MapLibre側のPLATEAUカバレッジ表示（Cesium非依存・pure＋薄いMap操作層）。
 *
 * - vectorソース `/api/coverage/tiles/{z}/{x}/{y}`（source-layer: coverage）
 * - 色は coverageCategories.LOD_CATEGORY_STYLES のみ参照（二重定義禁止）
 * - 詳細（LoD5色）/簡易（二値）の切替はズーム閾値に連動する。
 *   閾値そのものは App が BUILDING_OVERLAY_MIN_ZOOM（=13）を渡す。
 *   このモジュールは cesium 実行依存を持たないため node:test 可能。
 * - 失敗は false/無操作で返し、export経路をブロックしない。
 */
import { LOD_CATEGORY_STYLES } from './coverageCategories'

export const COVERAGE_SOURCE_ID = 'machimoki-coverage'
export const COVERAGE_FILL_LAYER_ID = 'machimoki-coverage-fill'
export const COVERAGE_LINE_LAYER_ID = 'machimoki-coverage-line'
export const COVERAGE_SOURCE_LAYER = 'coverage'
export const COVERAGE_TILE_URL_TEMPLATE = '/api/coverage/tiles/{z}/{x}/{y}'
export const COVERAGE_MIN_ZOOM = 4
export const COVERAGE_MAX_ZOOM = 14

/** 簡易モードの整備済み塗り（透明。Cesium版と同値） */
export const COVERAGE_BINARY_FILL = 'rgba(0, 0, 0, 0)'
/** 簡易モードの整備済み枠（従来の整備済みブルー。Cesium版と同値） */
export const COVERAGE_BINARY_OUTLINE = '#4fc3f7'

/**
 * 実MapLibreMapとの代入互換を保つ最小形状。
 * メソッド記法（双変）にしているため、実Mapの厳密な型でも代入できる。
 */
export interface CoverageMapLike {
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  getLayer(id: string): unknown
  addLayer(layer: unknown): void
  removeLayer(id: string): void
  removeSource(id: string): void
  setLayoutProperty(layerId: string, name: string, value: unknown): void
  setPaintProperty(layerId: string, name: string, value: unknown): void
  getZoom(): number
  loaded(): boolean
  once(event: string, handler: () => void): void
}

function exists(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * ズーム値から詳細（LoD5色）表示かを判定する。
 * 推定不能時（null/undefined/NaN）は表示側（true）に倒してチラつきを防ぐ。
 * 既定閾値は App が BUILDING_OVERLAY_MIN_ZOOM を渡す（=13）。
 */
export function isCoverageDetailedZoom(
  zoom: number | null | undefined,
  minZoom = 13,
): boolean {
  if (zoom === null || zoom === undefined || !Number.isFinite(zoom)) {
    return true
  }
  return zoom >= minZoom
}

/** 整備済み相当のフィーチャかを判定する式（maxLod優先・旧タイル互換）。 */
function hasLodDataExpression(): unknown[] {
  return [
    'any',
    ['all', ['has', 'maxLod'], ['>', ['get', 'maxLod'], 0]],
    ['==', ['get', 'covered'], 1],
    ['has', 'lods'],
  ]
}

/** maxLod数値→色のmatch式。データ有りだが数値不明時はlod1色に倒す。 */
function lodMatchExpression(colors: [number, string][], fallback: string): unknown[] {
  const expr: unknown[] = ['match', ['coalesce', ['get', 'maxLod'], -1]]
  for (const [lod, color] of colors) {
    expr.push(lod, color)
  }
  expr.push(fallback)
  return expr
}

/** fill-color用paint式。色はLOD_CATEGORY_STYLES由来のみ。 */
export function buildCoverageFillPaint(detailed: boolean): unknown {
  if (!detailed) {
    return [
      'case',
      hasLodDataExpression(),
      COVERAGE_BINARY_FILL,
      LOD_CATEGORY_STYLES.none.fill,
    ]
  }
  return [
    'case',
    hasLodDataExpression(),
    lodMatchExpression(
      [
        [1, LOD_CATEGORY_STYLES.lod1.fill],
        [2, LOD_CATEGORY_STYLES.lod2.fill],
        [3, LOD_CATEGORY_STYLES.lod3plus.fill],
        [4, LOD_CATEGORY_STYLES.lod4.fill],
      ],
      LOD_CATEGORY_STYLES.lod1.fill,
    ),
    LOD_CATEGORY_STYLES.none.fill,
  ]
}

/** line-color用paint式。色はLOD_CATEGORY_STYLES由来のみ。 */
export function buildCoverageLinePaint(detailed: boolean): unknown {
  if (!detailed) {
    return [
      'case',
      hasLodDataExpression(),
      COVERAGE_BINARY_OUTLINE,
      LOD_CATEGORY_STYLES.none.outline,
    ]
  }
  return [
    'case',
    hasLodDataExpression(),
    lodMatchExpression(
      [
        [1, LOD_CATEGORY_STYLES.lod1.outline],
        [2, LOD_CATEGORY_STYLES.lod2.outline],
        [3, LOD_CATEGORY_STYLES.lod3plus.outline],
        [4, LOD_CATEGORY_STYLES.lod4.outline],
      ],
      LOD_CATEGORY_STYLES.lod1.outline,
    ),
    LOD_CATEGORY_STYLES.none.outline,
  ]
}

export function hasCoverageLayer(map: CoverageMapLike): boolean {
  try {
    return (
      exists(map.getSource(COVERAGE_SOURCE_ID)) &&
      exists(map.getLayer(COVERAGE_FILL_LAYER_ID)) &&
      exists(map.getLayer(COVERAGE_LINE_LAYER_ID))
    )
  } catch {
    return false
  }
}

export function setCoverageLayerVisible(
  map: CoverageMapLike,
  visible: boolean,
): void {
  try {
    const value = visible ? 'visible' : 'none'
    map.setLayoutProperty(COVERAGE_FILL_LAYER_ID, 'visibility', value)
    map.setLayoutProperty(COVERAGE_LINE_LAYER_ID, 'visibility', value)
  } catch {
    /* 表示切替の失敗は無視（exportをブロックしない） */
  }
}

export function setCoverageLayerDetailed(
  map: CoverageMapLike,
  detailed: boolean,
): void {
  try {
    map.setPaintProperty(
      COVERAGE_FILL_LAYER_ID,
      'fill-color',
      buildCoverageFillPaint(detailed),
    )
    map.setPaintProperty(
      COVERAGE_LINE_LAYER_ID,
      'line-color',
      buildCoverageLinePaint(detailed),
    )
  } catch {
    /* 描画切替の失敗は無視（exportをブロックしない） */
  }
}

/**
 * カバレッジのソース＋fill/lineレイヤーを冪等に整備する。
 * 成功=true。失敗（未ロード・例外）はfalseを返し、例外を投げない。
 */
export function ensureCoverageLayer(
  map: CoverageMapLike,
  options: { visible: boolean; detailed: boolean },
): boolean {
  try {
    if (!map.loaded()) {
      return false
    }
    if (!exists(map.getSource(COVERAGE_SOURCE_ID))) {
      map.addSource(COVERAGE_SOURCE_ID, {
        type: 'vector',
        tiles: [COVERAGE_TILE_URL_TEMPLATE],
        minzoom: COVERAGE_MIN_ZOOM,
        maxzoom: COVERAGE_MAX_ZOOM,
      })
    }
    if (!exists(map.getLayer(COVERAGE_FILL_LAYER_ID))) {
      map.addLayer({
        id: COVERAGE_FILL_LAYER_ID,
        type: 'fill',
        source: COVERAGE_SOURCE_ID,
        'source-layer': COVERAGE_SOURCE_LAYER,
        paint: { 'fill-color': buildCoverageFillPaint(options.detailed) },
      })
    }
    if (!exists(map.getLayer(COVERAGE_LINE_LAYER_ID))) {
      map.addLayer({
        id: COVERAGE_LINE_LAYER_ID,
        type: 'line',
        source: COVERAGE_SOURCE_ID,
        'source-layer': COVERAGE_SOURCE_LAYER,
        paint: {
          'line-color': buildCoverageLinePaint(options.detailed),
          'line-width': 1,
        },
      })
    }
    setCoverageLayerDetailed(map, options.detailed)
    setCoverageLayerVisible(map, options.visible)
    return true
  } catch {
    return false
  }
}

export function removeCoverageLayer(map: CoverageMapLike): void {
  try {
    if (exists(map.getLayer(COVERAGE_FILL_LAYER_ID))) {
      map.removeLayer(COVERAGE_FILL_LAYER_ID)
    }
    if (exists(map.getLayer(COVERAGE_LINE_LAYER_ID))) {
      map.removeLayer(COVERAGE_LINE_LAYER_ID)
    }
    if (exists(map.getSource(COVERAGE_SOURCE_ID))) {
      map.removeSource(COVERAGE_SOURCE_ID)
    }
  } catch {
    /* 後片付けの失敗は無視 */
  }
}

/**
 * 現在ズームから詳細/簡易を同期する。レイヤー未整備時は判定のみ返す。
 * ズーム取得に失敗したら詳細側（true）に倒す。
 */
export function syncCoverageZoom(
  map: CoverageMapLike,
  visible: boolean,
  minZoom = 13,
): boolean {
  let zoom: number | null = null
  try {
    const value = map.getZoom()
    zoom = Number.isFinite(value) ? value : null
  } catch {
    zoom = null
  }
  const detailed = isCoverageDetailedZoom(zoom, minZoom)
  if (hasCoverageLayer(map)) {
    setCoverageLayerDetailed(map, detailed)
    setCoverageLayerVisible(map, visible)
  }
  return detailed
}
