/**
 * 2Dマップの施設・住所検索用データ取得モジュール。
 *
 * 出典:
 * - OpenPOI API (https://api.openpoiapi.com): 施設のサジェスト/検索。APIキー不要。
 * - 国土地理院 地名検索API (https://msearch.gsi.go.jp/address-search/AddressSearch): 住所検索。
 *
 * catalogApi.ts と同じ流儀（素fetch・AbortSignal.timeout・Promiseキャッシュ）で実装する。
 */

const OPENPOI_BASE = 'https://api.openpoiapi.com'
const OPENPOI_SUGGEST_URL = `${OPENPOI_BASE}/v1/suggest`
const OPENPOI_SEARCH_URL = `${OPENPOI_BASE}/v1/search`
const GSI_ADDRESS_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch'
const FETCH_TIMEOUT_MS = 8000

export type PoiKind = 'facility' | 'address'

export interface PoiBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface PoiHit {
  id: string
  kind: PoiKind
  name: string
  address: string
  lat: number
  lng: number
  source: 'openpoi' | 'gsi'
  licenses?: string[]
  attributions?: string[]
}

interface OpenPoiSuggestion {
  name?: string
  address?: string
  lat?: number | string
  lng?: number | string
}

interface OpenPoiSuggestResponse {
  suggestions?: OpenPoiSuggestion[]
  // fields=minimal のときはレスポンス直下にのみ存在する
  licenses?: string[]
  attributions?: string[]
}

interface OpenPoiResult {
  name?: string
  address?: string
  lat?: number | string
  lng?: number | string
  licenses?: string[]
  attributions?: string[]
}

interface OpenPoiSearchResponse {
  results?: OpenPoiResult[]
}

interface GsiFeature {
  geometry?: { coordinates?: unknown }
  properties?: { title?: string }
}

const suggestCache = new Map<string, PoiHit[]>()
const suggestPending = new Map<string, Promise<PoiHit[]>>()
const searchCache = new Map<string, PoiHit[]>()
const searchPending = new Map<string, Promise<PoiHit[]>>()
const addressCache = new Map<string, PoiHit[]>()
const addressPending = new Map<string, Promise<PoiHit[]>>()

/** 全キャッシュ（結果・実行中Promise）をクリアする。 */
export function clearPoiSearchCache(): void {
  suggestCache.clear()
  suggestPending.clear()
  searchCache.clear()
  searchPending.clear()
  addressCache.clear()
  addressPending.clear()
}

/** タイムアウトを共通メッセージに変換しつつJSONを取得する。 */
async function fetchJson<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('検索がタイムアウトしました')
    }
    throw err
  }
  if (!res.ok) throw new Error(`検索に失敗しました: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

/** 同名クエリの多重リクエストを防ぐPromiseキャッシュ実行。 */
async function cachedFetch<T>(
  cache: Map<string, T>,
  pending: Map<string, Promise<T>>,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key)
  if (cached) return cached
  const running = pending.get(key)
  if (running) return running

  const task = fetcher().then((result) => {
    cache.set(key, result)
    return result
  })

  pending.set(key, task)
  try {
    return await task
  } finally {
    if (pending.get(key) === task) pending.delete(key)
  }
}

/** bboxを `west,south,east,north` 形式にする。 */
function formatBbox(bounds: PoiBounds): string {
  return [bounds.west, bounds.south, bounds.east, bounds.north].map((n) => String(n)).join(',')
}

/** 座標を数値化し、有効な場合のみPoiHitを生成する（不正座標はnull）。 */
function makeHit(
  source: PoiHit['source'],
  kind: PoiKind,
  name: string,
  address: string,
  lat: unknown,
  lng: unknown,
  licenses?: string[],
  attributions?: string[],
): PoiHit | null {
  const nLat = Number(lat)
  const nLng = Number(lng)
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null
  return {
    id: `${source}:${nLat.toFixed(6)},${nLng.toFixed(6)}:${name}`,
    kind,
    name,
    address,
    lat: nLat,
    lng: nLng,
    source,
    licenses,
    attributions,
  }
}

/** OpenPOIサジェスト。既定limit=5。 */
export async function suggestFacilities(
  query: string,
  bounds: PoiBounds,
  limit = 5,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const key = `${q}|${formatBbox(bounds)}`

  return cachedFetch(suggestCache, suggestPending, key, async () => {
    const url = `${OPENPOI_SUGGEST_URL}?q=${encodeURIComponent(q)}&bbox=${formatBbox(bounds)}&limit=${limit}&fields=minimal`
    const data = await fetchJson<OpenPoiSuggestResponse>(url)
    const list = Array.isArray(data.suggestions) ? data.suggestions : []
    return list
      .map((s) =>
        makeHit(
          'openpoi',
          'facility',
          s.name ?? '',
          s.address ?? '',
          s.lat,
          s.lng,
          data.licenses,
          data.attributions,
        ),
      )
      .filter((hit): hit is PoiHit => hit !== null)
  })
}

/** OpenPOI施設検索。既定limit=50。 */
export async function searchFacilities(
  query: string,
  bounds: PoiBounds,
  limit = 50,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const key = `${q}|${formatBbox(bounds)}`

  return cachedFetch(searchCache, searchPending, key, async () => {
    const url = `${OPENPOI_SEARCH_URL}?q=${encodeURIComponent(q)}&bbox=${formatBbox(bounds)}&limit=${limit}`
    const data = await fetchJson<OpenPoiSearchResponse>(url)
    const list = Array.isArray(data.results) ? data.results : []
    return list
      .map((r) =>
        makeHit(
          'openpoi',
          'facility',
          r.name ?? '',
          r.address ?? '',
          r.lat,
          r.lng,
          r.licenses,
          r.attributions,
        ),
      )
      .filter((hit): hit is PoiHit => hit !== null)
  })
}

/** 国土地理院の地名検索APIで住所を検索する。 */
export async function searchAddress(query: string): Promise<PoiHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  return cachedFetch(addressCache, addressPending, q, async () => {
    const url = `${GSI_ADDRESS_SEARCH_URL}?q=${encodeURIComponent(q)}`
    const data = await fetchJson<GsiFeature[]>(url)
    if (!Array.isArray(data)) return []

    const hits: PoiHit[] = []
    for (const feature of data) {
      const coords = feature.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) continue
      // coordinates は [lng, lat] の順。title自体が住所なのでaddressは空にする。
      const hit = makeHit('gsi', 'address', feature.properties?.title ?? '', '', coords[1], coords[0])
      if (hit) hits.push(hit)
    }
    return hits
  })
}

/** 施設サジェストと住所検索を並行実行し、失敗した側は空配列で返す。 */
export async function suggestAll(
  query: string,
  bounds: PoiBounds,
): Promise<{ facilities: PoiHit[]; addresses: PoiHit[] }> {
  const q = query.trim()
  if (q.length < 2) return { facilities: [], addresses: [] }

  const [facilities, addresses] = await Promise.allSettled([
    suggestFacilities(q, bounds),
    searchAddress(q),
  ])

  return {
    facilities: facilities.status === 'fulfilled' ? facilities.value : [],
    addresses: addresses.status === 'fulfilled' ? addresses.value : [],
  }
}
