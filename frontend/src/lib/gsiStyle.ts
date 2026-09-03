/**
 * Map2D のスタイル正規化・定数・検証関数。
 *
 * Map2D.tsx から分離した背景:
 * - テストから CSS import（maplibre-gl.css）を除外するため
 * - 関心の分離（スタイルロジック vs React コンポーネント）
 *
 * 責任:
 * - GSI ベクトルタイルのスタイル正規化（sanitizeGsiStyle）
 * - 最小フォールバックスタイル生成（buildFallbackStyle）
 * - スタイル URL 検証（validateStyleUrls）
 * - エラー分類（classifyMapError）
 * - load 後のコンテンツ存在検証（getMissingMapContent）
 */
import type { StyleSpecification } from 'maplibre-gl'

// 現行Cesium 2D（App.tsx）と同一の初期視点: 経度139.6917 緯度35.6895、高さ8000m相当。
export const MAP2D_CENTER_LNG = 139.6917
export const MAP2D_CENTER_LAT = 35.6895
// 8000m相当 ≒ ズーム12〜13。街区が見える12を初期値とする。
export const MAP2D_ZOOM = 12
// ズーム範囲4〜16。17以上はオーバーズーム扱い（ソースmaxzoom=16のタイルを拡大表示）。
export const MAP2D_MIN_ZOOM = 4
export const MAP2D_MAX_ZOOM = 16

export const GSI_PBF_TILE_URL =
  'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf'
export const UPSTREAM_STYLE_URL =
  'https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json'
// sprite / glyphs はベンダー固定時に取得した上流のURLを明示管理する。
export const GSI_SPRITE_URL = 'https://gsi-cyberjapan.github.io/optimal_bvmap/sprite/std'
export const GSI_GLYPHS_URL =
  'https://gsi-cyberjapan.github.io/optimal_bvmap/glyphs/{fontstack}/{range}.pbf'
export const GSI_ATTRIBUTION_TEXT = '© 国土地理院'
export const GSI_LICENSE_URL = 'https://maps.gsi.go.jp/development/ichiran.html'

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ABSOLUTE_URL_PATTERN = /^https?:\/\//i

/**
 * スタイルJSON内のURLフィールド（sprite/glyphs/sources.*.tiles）と
 * 帰属（attribution）を検証し、問題があれば問題リストとして返す。
 * 問題がなければ空配列を返す。
 */
export function validateStyleUrls(style: unknown): string[] {
  const problems: string[] = []
  if (!isJsonObject(style)) return problems

  const checkUrl = (value: unknown, field: string): void => {
    if (typeof value === 'string') {
      if (!ABSOLUTE_URL_PATTERN.test(value)) {
        problems.push(`${field} is not absolute URL: ${value}`)
      }
    } else if (value !== undefined) {
      problems.push(`${field} is not a string`)
    }
  }

  checkUrl(style['sprite'], 'sprite')
  checkUrl(style['glyphs'], 'glyphs')

  const sources = style['sources']
  if (isJsonObject(sources)) {
    for (const [sourceName, sourceValue] of Object.entries(sources)) {
      if (!isJsonObject(sourceValue)) continue
      const tiles = sourceValue['tiles']
      if (Array.isArray(tiles)) {
        tiles.forEach((tile: unknown, index: number) => {
          checkUrl(tile, `sources.${sourceName}.tiles[${index}]`)
        })
      }
      const attribution = sourceValue['attribution']
      if (typeof attribution !== 'string' || attribution !== GSI_ATTRIBUTION_TEXT) {
        problems.push(`sources.${sourceName}.帰属が不正です: ${String(attribution)}`)
      }
    }
  }

  return problems
}

/**
 * MapLibre のエラーメッセージを分類する。
 * - 'sprite': スプライト読み込み失敗
 * - 'glyphs': グリフ読み込み失敗
 * - 'tiles': タイル読み込み失敗（PBF）
 * - 'webgl': WebGL コンテキスト損失
 * - 'unknown': 分類不能
 */
export function classifyMapError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('sprite')) return 'sprite'
  if (lower.includes('glyph')) return 'glyphs'
  if (lower.includes('tile')) return 'tiles'
  if (lower.includes('webgl') || lower.includes('context')) return 'webgl'
  return 'unknown'
}

/**
 * load 後のマップに必要な source と layer が存在するか検証する。
 * source は 'v' の存在を確認し、layer は指定された ID リストの各存在を確認する。
 * 欠落があれば 'source:v' や 'layer:<id>' の文字列リストを返す。
 */
export function getMissingMapContent(
  mapLike: {
    getSource: (id: string) => unknown
    getLayer: (id: string) => unknown
  },
  requiredLayerIds: string[],
): string[] {
  const missing: string[] = []
  if (!mapLike.getSource('v')) {
    missing.push('source:v')
  }
  for (const layerId of requiredLayerIds) {
    if (!mapLike.getLayer(layerId)) {
      missing.push(`layer:${layerId}`)
    }
  }
  return missing
}

/**
 * 上流・ベンダーいずれのスタイルJSONも、以下を強制して正規化する。
 * 上流の変更（pmtiles化・attribution文言変更・等高線追加など）の影響を受けない。
 * - sources.v をPBFタイル＋帰属「© 国土地理院」に固定
 * - sprite / glyphs を明示管理のURLに固定
 * - Cntr（等高線）レイヤーを visibility:none にする
 */
export function sanitizeGsiStyle(style: unknown): StyleSpecification {
  if (!isJsonObject(style)) {
    throw new Error('スタイルJSONがオブジェクトではありません')
  }
  const rawLayers: unknown = style['layers']
  if (!Array.isArray(rawLayers)) {
    throw new Error('スタイルJSONにlayers配列がありません')
  }
  const layers: JsonObject[] = rawLayers.map((layer: unknown) => {
    if (!isJsonObject(layer)) {
      throw new Error('不正なレイヤー定義があります')
    }
    if (layer['source-layer'] === 'Cntr') {
      const layout: JsonObject = isJsonObject(layer['layout']) ? layer['layout'] : {}
      return { ...layer, layout: { ...layout, visibility: 'none' } }
    }
    return layer
  })
  const name: unknown = style['name']
  return {
    version: 8,
    name: typeof name === 'string' ? name : 'optbv (machimoki vendored)',
    sprite: GSI_SPRITE_URL,
    glyphs: GSI_GLYPHS_URL,
    sources: {
      v: {
        type: 'vector',
        tiles: [GSI_PBF_TILE_URL],
        minzoom: MAP2D_MIN_ZOOM,
        maxzoom: MAP2D_MAX_ZOOM,
        attribution: GSI_ATTRIBUTION_TEXT,
      },
    },
    layers,
  } as unknown as StyleSpecification
}

/**
 * スタイル読込失敗時の最小自前スタイル。
 * 「地図が出る」だけでなく、道路（RdCL）・行政境界（AdmBdry）・水域（WA）の
 * 3系統が必ず描画されることを保証する。シンボルを使わないためglyphs/sprite不要。
 */
export function buildFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'machimoki-map2d-fallback',
    sources: {
      v: {
        type: 'vector',
        tiles: [GSI_PBF_TILE_URL],
        minzoom: MAP2D_MIN_ZOOM,
        maxzoom: MAP2D_MAX_ZOOM,
        attribution: GSI_ATTRIBUTION_TEXT,
      },
    },
    layers: [
      {
        id: 'fallback-background',
        type: 'background' as const,
        paint: { 'background-color': '#f7f7f7' },
      },
      {
        id: 'fallback-water',
        type: 'fill' as const,
        source: 'v',
        'source-layer': 'WA',
        paint: { 'fill-color': '#a8c8e8' },
      },
      {
        id: 'fallback-admin-boundary',
        type: 'line' as const,
        source: 'v',
        'source-layer': 'AdmBdry',
        paint: { 'line-color': '#440080', 'line-width': 1 },
      },
      {
        id: 'fallback-roads',
        type: 'line' as const,
        source: 'v',
        'source-layer': 'RdCL',
        paint: { 'line-color': '#d06058', 'line-width': 1.5, 'line-opacity': 0.9 },
      },
    ],
  }
}
