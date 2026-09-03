import {
  Viewer,
  Color,
  Rectangle,
  PolygonHierarchy,
  Cartesian3,
  type Entity,
} from 'cesium'
import {
  LOD_CATEGORY_STYLES,
  maxLodToCategory,
  parseLodsString,
  type LodCategory,
} from './coverageCategories'

/**
 * PLATEAU整備済みエリアのカバレッジオーバーレイ（Entityフォールバック）。
 *
 * LoD付きカバレッジマップ（getCoverageDetails() の戻り
 * Map<string, { city; pref; lods: string[] }>）を受け取り、市区町村ポリゴンを
 * LOD_CATEGORY_STYLES（coverageCategories.ts、唯一の定義元）の5色
 *（none/lod1/lod2/lod3plus/lod4）で塗り分ける。凡例の5色と一致させる。
 * 後方互換のため Set<string>（整備済みコード集合）も受け付ける。
 *
 * データソース:
 *  - 市区町村ポリゴン: smartnews-smri/japan-topography
 *    (国土数値情報 行政区域 N03 を 0.1% に簡素化した全国版 GeoJSON、約1.6MB)
 *  - 取得失敗時は都道府県の近似矩形にフォールバックする
 */

const MUNI_GEOJSON_URL =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0001/N03-21_210101.json'

const FETCH_TIMEOUT_MS = 20000
const BATCH_SIZE = 150

/** 都道府県の近似矩形（GeoJSON取得失敗時のフォールバック用） */
const PREFECTURE_BBOXES: Record<string, BBox> = {
  '01': { west: 139.33, south: 41.35, east: 148.89, north: 45.56 },
  '02': { west: 139.98, south: 40.27, east: 141.68, north: 41.55 },
  '03': { west: 140.65, south: 38.89, east: 142.05, north: 40.42 },
  '04': { west: 140.27, south: 37.73, east: 141.68, north: 38.99 },
  '05': { west: 139.72, south: 38.87, east: 141.03, north: 40.42 },
  '06': { west: 139.53, south: 37.73, east: 140.65, north: 39.22 },
  '07': { west: 139.15, south: 36.68, east: 141.03, north: 38.0 },
  '08': { west: 139.69, south: 35.74, east: 140.91, north: 36.99 },
  '09': { west: 139.32, south: 36.22, east: 140.27, north: 37.13 },
  '10': { west: 138.36, south: 35.99, east: 139.69, north: 37.0 },
  '11': { west: 138.72, south: 35.79, east: 139.95, north: 36.36 },
  '12': { west: 139.69, south: 34.9, east: 140.91, north: 36.1 },
  '13': { west: 138.94, south: 35.0, east: 140.0, north: 35.9 },
  '14': { west: 138.93, south: 35.14, east: 140.09, north: 35.55 },
  '15': { west: 137.72, south: 36.92, east: 139.87, north: 38.59 },
  '16': { west: 136.76, south: 36.41, east: 137.87, north: 36.98 },
  '17': { west: 136.22, south: 36.36, east: 137.36, north: 37.55 },
  '18': { west: 135.42, south: 35.42, east: 136.82, north: 36.35 },
  '19': { west: 138.16, south: 35.28, east: 139.07, north: 35.97 },
  '20': { west: 137.56, south: 35.42, east: 138.72, north: 36.98 },
  '21': { west: 136.22, south: 35.15, east: 137.87, north: 36.53 },
  '22': { west: 137.31, south: 34.57, east: 139.16, north: 35.52 },
  '23': { west: 136.76, south: 34.57, east: 137.87, north: 35.42 },
  '24': { west: 135.85, south: 33.73, east: 136.76, north: 35.28 },
  '25': { west: 135.85, south: 34.9, east: 136.47, north: 35.65 },
  '26': { west: 134.8, south: 34.79, east: 135.85, north: 35.79 },
  '27': { west: 135.15, south: 34.31, east: 135.72, north: 34.9 },
  '28': { west: 134.24, south: 34.05, east: 135.42, north: 35.79 },
  '29': { west: 135.42, south: 33.86, east: 136.22, north: 34.79 },
  '30': { west: 135.0, south: 33.43, east: 135.98, north: 34.31 },
  '31': { west: 133.08, south: 35.28, east: 134.5, north: 35.65 },
  '32': { west: 131.85, south: 34.31, east: 133.42, north: 36.36 },
  '33': { west: 133.08, south: 34.31, east: 134.5, north: 35.28 },
  '34': { west: 131.85, south: 34.05, east: 133.42, north: 34.9 },
  '35': { west: 130.62, south: 33.73, east: 132.44, north: 34.79 },
  '36': { west: 133.42, south: 33.43, east: 134.8, north: 34.31 },
  '37': { west: 133.42, south: 34.05, east: 134.5, north: 34.57 },
  '38': { west: 132.08, south: 32.99, east: 133.42, north: 34.31 },
  '39': { west: 132.44, south: 32.7, east: 134.5, north: 33.86 },
  '40': { west: 129.98, south: 33.2, east: 131.33, north: 34.05 },
  '41': { west: 129.72, south: 32.99, east: 130.62, north: 33.73 },
  '42': { west: 128.49, south: 32.57, east: 130.62, north: 34.05 },
  '43': { west: 129.72, south: 32.05, east: 131.33, north: 33.2 },
  '44': { west: 130.62, south: 32.7, east: 132.08, north: 33.86 },
  '45': { west: 130.62, south: 31.28, east: 131.85, north: 32.7 },
  '46': { west: 128.49, south: 27.7, east: 131.33, north: 32.7 },
  '47': { west: 122.93, south: 24.04, east: 131.33, north: 28.03 },
}

interface BBox {
  west: number
  south: number
  east: number
  north: number
}

interface GeoJsonFeature {
  properties?: { N03_007?: string }
  geometry?: {
    type?: string
    coordinates?: unknown
  }
}

interface PolygonSpec {
  outer: number[][]
  inners: number[][][]
}

export interface CoverageOverlayHandle {
  /** オーバーレイのEntityを全て削除する */
  remove: () => void
  /** 表示/非表示を切り替える */
  setVisible: (visible: boolean) => void
}

let cachedMuniFeatures: GeoJsonFeature[] | null = null
let cachedMuniPromise: Promise<GeoJsonFeature[]> | null = null

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GeoJSON取得失敗: ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function fetchMunicipalityFeatures(): Promise<GeoJsonFeature[]> {
  if (cachedMuniFeatures) return cachedMuniFeatures
  if (cachedMuniPromise) return cachedMuniPromise
  cachedMuniPromise = fetchJson<{ features: GeoJsonFeature[] }>(MUNI_GEOJSON_URL)
    .then((data) => {
      cachedMuniFeatures = data.features
      return data.features
    })
    .finally(() => {
      cachedMuniPromise = null
    })
  return cachedMuniPromise
}

/** getCoverageDetails() の戻りと同じ形状の LoD 付きカバレッジマップ */
export type CoverageDetailsMap = Map<string, { city: string; pref: string; lods: string[] }>

/** createCoverageOverlay が受け付ける入力（LoD付きマップまたは整備済みコード集合） */
export type CoverageOverlayInput = CoverageDetailsMap | Set<string>

/** カテゴリの序列（フォールバック解決で最大 LoD 側を優先するために使用） */
const CATEGORY_RANK: Record<LodCategory, number> = {
  none: 0,
  lod1: 1,
  lod2: 2,
  lod3plus: 3,
  lod4: 4,
}

/**
 * lods 配列（例 ["lod1", "lod2"]）から最大 LoD を求める。
 * 空・不正のみの場合は null（建物なし）を返す。
 */
function maxLodFromLods(lods: string[]): number | null {
  const parsed = parseLodsString(lods.join(','))
  if (parsed.length === 0) return null
  return Math.max(...parsed)
}

/**
 * 入力をコード→カテゴリのマップに正規化する。
 * Set<string>（後方互換）は整備済みコードを lod1 扱いに変換する。
 */
function normalizeCoverageToCategories(input: CoverageOverlayInput): Map<string, LodCategory> {
  const categories = new Map<string, LodCategory>()
  if (input instanceof Set) {
    for (const code of input) {
      categories.set(code, 'lod1')
    }
    return categories
  }
  for (const [code, info] of input) {
    categories.set(code, maxLodToCategory(maxLodFromLods(info.lods)))
  }
  return categories
}

/**
 * 市区町村コードの LoD カテゴリを解決する。
 * 政令指定都市の区（例: 14101）と市本体（例: 14100）の両方向を考慮し、
 * 候補が複数ある場合は最大 LoD 側のカテゴリを返す。
 */
function resolveMuniCategory(code: string, categories: Map<string, LodCategory>): LodCategory {
  const candidates: LodCategory[] = []
  const direct = categories.get(code)
  if (direct !== undefined) candidates.push(direct)
  if (code.endsWith('00')) {
    // 市本体のコード: いずれかの区のカテゴリがあれば候補にする
    const prefix = code.slice(0, 3)
    for (const [key, category] of categories) {
      if (key !== code && key.startsWith(prefix)) candidates.push(category)
    }
  } else {
    // 区のコード: 親市本体のカテゴリがあれば候補にする
    const parent = categories.get(code.slice(0, 3) + '00')
    if (parent !== undefined) candidates.push(parent)
  }
  if (candidates.length === 0) return 'none'
  let best: LodCategory = 'none'
  for (const candidate of candidates) {
    if (CATEGORY_RANK[candidate] > CATEGORY_RANK[best]) best = candidate
  }
  return best
}

/** テスト用: 市区町村GeoJSONキャッシュをクリアする */
export function __resetCoverageOverlayCacheForTest(): void {
  cachedMuniFeatures = null
  cachedMuniPromise = null
}

function extractPolygons(geometry: GeoJsonFeature['geometry']): PolygonSpec[] {
  if (!geometry || !geometry.coordinates) return []
  const coords = geometry.coordinates as unknown
  if (geometry.type === 'Polygon') {
    return [toPolygonSpec(coords as number[][][])]
  }
  if (geometry.type === 'MultiPolygon') {
    return (coords as number[][][][]).map(toPolygonSpec)
  }
  return []
}

function toPolygonSpec(rings: number[][][]): PolygonSpec {
  return {
    outer: rings[0] ?? [],
    inners: rings.slice(1),
  }
}

function toCartesian3(ring: number[][]): Cartesian3[] {
  return ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat))
}

function makeHandle(viewer: Viewer, entities: Entity[]): CoverageOverlayHandle {
  return {
    remove: () => {
      for (const e of entities) {
        try {
          viewer.entities.remove(e)
        } catch {
          /* ignore */
        }
      }
      entities.length = 0
    },
    setVisible: (visible: boolean) => {
      for (const e of entities) e.show = visible
    },
  }
}

/**
 * カバレッジオーバーレイを生成する。
 * 市区町村ポリゴンの取得に失敗した場合は都道府県の近似矩形で代替する。
 * LoD付きマップ・整備済みコード集合のどちらも受け付ける（後者は後方互換）。
 */
export async function createCoverageOverlay(
  viewer: Viewer,
  details: CoverageDetailsMap,
): Promise<CoverageOverlayHandle>
export async function createCoverageOverlay(
  viewer: Viewer,
  coverage: Set<string>,
): Promise<CoverageOverlayHandle>
export async function createCoverageOverlay(
  viewer: Viewer,
  coverage: CoverageOverlayInput,
): Promise<CoverageOverlayHandle> {
  const categories = normalizeCoverageToCategories(coverage)
  try {
    const features = await fetchMunicipalityFeatures()
    return await buildMunicipalityOverlay(viewer, categories, features)
  } catch (err) {
    console.warn('[CoverageOverlay] 市区町村GeoJSONの取得に失敗しました。都道府県近似で表示します:', err)
  }
  return buildPrefectureBBoxOverlay(viewer, categories)
}

async function buildMunicipalityOverlay(
  viewer: Viewer,
  categories: Map<string, LodCategory>,
  features: GeoJsonFeature[]
): Promise<CoverageOverlayHandle> {
  const entities: Entity[] = []
  const specs: { outer: number[][]; inners: number[][][]; category: LodCategory }[] = []

  for (const feature of features) {
    const code = feature.properties?.N03_007
    if (!code) continue
    const polygons = extractPolygons(feature.geometry)
    if (polygons.length === 0) continue
    const category = resolveMuniCategory(code, categories)
    for (const poly of polygons) {
      if (poly.outer.length < 3) continue
      specs.push({ outer: poly.outer, inners: poly.inners, category })
    }
  }

  // バッチでEntityを追加し、UIのフリーズを防ぐ
  for (let i = 0; i < specs.length; i += BATCH_SIZE) {
    if (viewer.isDestroyed()) break
    const chunk = specs.slice(i, i + BATCH_SIZE)
    for (const spec of chunk) {
      try {
        const style = LOD_CATEGORY_STYLES[spec.category]
        const polygonOptions: {
          hierarchy: PolygonHierarchy
          height: number
          material: Color
          outline?: boolean
          outlineColor?: Color
        } = {
          hierarchy: new PolygonHierarchy(
            toCartesian3(spec.outer),
            spec.inners.map((r) => new PolygonHierarchy(toCartesian3(r)))
          ),
          // height: 0 を明示して地形クランプを無効化し、2Dモードでも確実に描画する
          height: 0,
          material: Color.fromCssColorString(style.fill),
          outline: true,
          outlineColor: Color.fromCssColorString(style.outline),
        }
        entities.push(viewer.entities.add({ polygon: polygonOptions }))
      } catch {
        /* 不正なポリゴンはスキップ */
      }
    }
    // 次のバッチまでイベントループを回してUIを応答させる
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return makeHandle(viewer, entities)
}

function buildPrefectureBBoxOverlay(
  viewer: Viewer,
  categories: Map<string, LodCategory>
): CoverageOverlayHandle {
  const entities: Entity[] = []
  const prefCategories = new Map<string, LodCategory>()
  for (const [code, category] of categories) {
    const prefCode = code.slice(0, 2)
    const current = prefCategories.get(prefCode)
    if (current === undefined || CATEGORY_RANK[category] > CATEGORY_RANK[current]) {
      prefCategories.set(prefCode, category)
    }
  }

  for (const [prefCode, bbox] of Object.entries(PREFECTURE_BBOXES)) {
    const category = prefCategories.get(prefCode) ?? 'none'
    const style = LOD_CATEGORY_STYLES[category]
    try {
      entities.push(
        viewer.entities.add({
          rectangle: {
            coordinates: Rectangle.fromDegrees(bbox.west, bbox.south, bbox.east, bbox.north),
            height: 0,
            material: Color.fromCssColorString(style.fill),
            outline: true,
            outlineColor: Color.fromCssColorString(style.outline),
          },
        })
      )
    } catch {
      /* skip */
    }
  }

  return makeHandle(viewer, entities)
}