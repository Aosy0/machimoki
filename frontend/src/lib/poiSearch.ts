/**
 * 2Dマップの施設・住所検索用データ取得モジュール。
 *
 * 出典:
 * - Photon (VITE_POI_FALLBACK_URL, 自前ホストのOSMジオコーダ): 設定時は施設検索の主プロバイダ。
 * - OpenPOI API (https://api.openpoiapi.com): Photon0件/未設定時のフォールバック。APIキー不要。
 * - 国土地理院 地名検索API (https://msearch.gsi.go.jp/address-search/AddressSearch): 住所検索。
 *
 * catalogApi.ts と同じ流儀（素fetch・AbortSignal.timeout・Promiseキャッシュ）で実装する。
 */

const OPENPOI_BASE = 'https://api.openpoiapi.com'
const OPENPOI_SUGGEST_URL = `${OPENPOI_BASE}/v1/suggest`
const OPENPOI_SEARCH_URL = `${OPENPOI_BASE}/v1/search`
const GSI_ADDRESS_SEARCH_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch'
const FETCH_TIMEOUT_MS = 8000
// 自前ホストのPhoton（OSM）。設定時は施設検索の主プロバイダ、未設定ならOpenPOI主で動作する。
// import.meta.env はVite実行時のみ定義されるため、node（テスト）実行に備え任意チェーンにする。
const PHOTON_BASE = (import.meta.env?.VITE_POI_FALLBACK_URL ?? '').replace(/\/+$/, '')

/** Photon（主プロバイダ）が設定されているか。 */
export const isPoiFallbackEnabled = PHOTON_BASE !== ''

export type PoiKind = 'facility' | 'address'

export interface PoiBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface PoiCenter {
  lat: number
  lng: number
}

export interface PoiHit {
  id: string
  kind: PoiKind
  name: string
  address: string
  lat: number
  lng: number
  source: 'openpoi' | 'gsi' | 'photon'
  category?: string
  licenses?: string[]
  attributions?: string[]
}

interface OpenPoiSuggestion {
  name?: string
  address?: string
  lat?: number | string
  lng?: number | string
  category?: string
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
  category?: string
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

interface PhotonProperties {
  name?: string
  street?: string
  housenumber?: string
  postcode?: string
  city?: string
  district?: string
  state?: string
}

interface PhotonFeature {
  geometry?: { coordinates?: unknown }
  properties?: PhotonProperties
}

interface PhotonResponse {
  features?: PhotonFeature[]
}

const suggestCache = new Map<string, PoiHit[]>()
const suggestPending = new Map<string, Promise<PoiHit[]>>()
const searchCache = new Map<string, PoiHit[]>()
const searchPending = new Map<string, Promise<PoiHit[]>>()
const addressCache = new Map<string, PoiHit[]>()
const addressPending = new Map<string, Promise<PoiHit[]>>()
const fallbackCache = new Map<string, PoiHit[]>()
const fallbackPending = new Map<string, Promise<PoiHit[]>>()
// Photonを主プロバイダとして使う場合のキャッシュ（suggest/searchでlimitが異なるためキーに含める）
const primaryCache = new Map<string, PoiHit[]>()
const primaryPending = new Map<string, Promise<PoiHit[]>>()

/** 全キャッシュ（結果・実行中Promise）をクリアする。 */
export function clearPoiSearchCache(): void {
  suggestCache.clear()
  suggestPending.clear()
  searchCache.clear()
  searchPending.clear()
  addressCache.clear()
  addressPending.clear()
  fallbackCache.clear()
  fallbackPending.clear()
  primaryCache.clear()
  primaryPending.clear()
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

/** bboxの中心を返す（Photonのcenterバイアス用）。 */
function boundsCenter(bounds: PoiBounds): PoiCenter {
  return { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 }
}

/** クエリに対する名称一致の強さ。小さいほど上位。 */
export function nameMatchRank(name: string, query: string): number {
  const n = name.trim()
  const q = query.trim()
  if (n === q) return 0 // 完全一致
  if (n.startsWith(q)) return 1 // 前方一致
  if (n.includes(q)) return 2 // 部分一致
  return 3 // その他（住所ヒット等）
}

/**
 * カテゴリの代表度ランク。小さいほど代表的。
 * unknown/未設定は中立(1)に置き、nameMatchRank が効くようにする。
 */
export function categoryRank(category: string | undefined): number {
  if (!category || category === 'unknown') return 1 // 中立
  // 代表的な公共・交通・ランドマーク系を上位に
  if (['transit', 'railway', 'landmark', 'government', 'education', 'medical', 'park'].includes(category))
    return 0
  // 地名・地域系
  if (['locality', 'place', 'neighborhood', 'quarter'].includes(category)) return 0
  // 商業・宿泊・観光（施設としては代表度が下がる）
  if (
    [
      'tourism',
      'lodging',
      'restaurant',
      'cafe',
      'bakery',
      'grocery',
      'retail_other',
      'commercial',
      'service_other',
    ].includes(category)
  )
    return 2
  return 1
}

/**
 * OpenPOI結果を「代表的な施設が上位」になるよう並べ替える。
 * 名称一致を最優先にし、同順位内でカテゴリ代表度→名前の短さで整える。
 * Array.prototype.sort は安定なので、同点は元の順序を維持する。
 *
 * 注: カテゴリを名称一致より先に評価すると、完全一致の「東京駅」(service_other)
 * が unknown の前方一致候補に負けてしまうため、名称一致を主キーにする。
 */
export function sortOpenPoiHits(hits: PoiHit[], query: string): PoiHit[] {
  return hits.sort((a, b) => {
    const match = nameMatchRank(a.name, query) - nameMatchRank(b.name, query)
    if (match !== 0) return match
    const cat = categoryRank(a.category) - categoryRank(b.category)
    if (cat !== 0) return cat
    return a.name.trim().length - b.name.trim().length
  })
}

/** 座標を数値化し、有効な場合のみPoiHitを生成する（不正座標はnull）。 */
function makeHit(
  source: PoiHit['source'],
  kind: PoiKind,
  name: string,
  address: string,
  category: string | undefined,
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
    category,
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
    const hits = list
      .map((s) =>
        makeHit(
          'openpoi',
          'facility',
          s.name ?? '',
          s.address ?? '',
          s.category,
          s.lat,
          s.lng,
          data.licenses,
          data.attributions,
        ),
      )
      .filter((hit): hit is PoiHit => hit !== null)
    // 代表的な施設が上位に来るよう並べ替える（unknownは中立）
    return sortOpenPoiHits(hits, q)
  })
}

/** OpenPOI施設検索。既定limit=50。boundsがnullの場合は全国検索（bboxなし）。 */
export async function searchFacilities(
  query: string,
  bounds: PoiBounds | null,
  limit = 50,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const key = bounds ? `${q}|${formatBbox(bounds)}` : `${q}|all`
  const bboxParam = bounds ? `&bbox=${formatBbox(bounds)}` : ''

  return cachedFetch(searchCache, searchPending, key, async () => {
    const url = `${OPENPOI_SEARCH_URL}?q=${encodeURIComponent(q)}${bboxParam}&limit=${limit}`
    const data = await fetchJson<OpenPoiSearchResponse>(url)
    const list = Array.isArray(data.results) ? data.results : []
    const hits = list
      .map((r) =>
        makeHit(
          'openpoi',
          'facility',
          r.name ?? '',
          r.address ?? '',
          r.category,
          r.lat,
          r.lng,
          r.licenses,
          r.attributions,
        ),
      )
      .filter((hit): hit is PoiHit => hit !== null)
    // 代表的な施設が上位に来るよう並べ替える（unknownは中立）
    return sortOpenPoiHits(hits, q)
  })
}

/** 住所・施設名の表記揺れ（全角/半角・空白）を吸収する正規化。 */
function normalizeAddressText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '')
}

/**
 * GSI住所検索のtitleをクエリ包含でフィルタする。
 * 「東」だけ一致する無関係な地域を除く一方、広い語での取りこぼしを救済するため、
 * フィルタ結果が0件のときはフィルタ前の配列をそのまま返す（安全網）。
 */
export function filterAddressTitles(titles: string[], query: string): string[] {
  const q = normalizeAddressText(query.trim())
  if (q === '') return titles
  const matched = titles.filter((title) => normalizeAddressText(title).includes(q))
  return matched.length > 0 ? matched : titles
}

/** 国土地理院の地名検索APIで住所を検索する。 */
export async function searchAddress(query: string): Promise<PoiHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  return cachedFetch(addressCache, addressPending, q, async () => {
    const url = `${GSI_ADDRESS_SEARCH_URL}?q=${encodeURIComponent(q)}`
    const data = await fetchJson<GsiFeature[]>(url)
    if (!Array.isArray(data)) return []

    const entries: { title: string; hit: PoiHit }[] = []
    for (const feature of data) {
      const coords = feature.geometry?.coordinates
      if (!Array.isArray(coords) || coords.length < 2) continue
      const title = feature.properties?.title ?? ''
      // coordinates は [lng, lat] の順。title自体が住所なのでaddressは空にする。
      const hit = makeHit('gsi', 'address', title, '', undefined, coords[1], coords[0])
      if (hit) entries.push({ title, hit })
    }
    // クエリ包含で無関係な地域を除外。0件時は従来どおり全件にフォールバック。
    const kept = new Set(filterAddressTitles(entries.map((e) => e.title), q))
    return entries
      .filter((e) => kept.has(e.title))
      .map((e) => e.hit)
      .slice(0, 10)
  })
}

/** Photonへ問い合わせてPoiHit列に変換する（キャッシュなし）。 */
async function fetchPhotonHits(
  q: string,
  center: PoiCenter | null,
  limit: number,
): Promise<PoiHit[]> {
  const centerParam = center ? `&lat=${center.lat}&lon=${center.lng}` : ''
  // lang指定はPhotonの対応言語（default/de/en/fr）外だと400になるため指定しない（default=現地語）
  const url = `${PHOTON_BASE}/api?q=${encodeURIComponent(q)}&limit=${limit}${centerParam}`
  const data = await fetchJson<PhotonResponse>(url)
  const features = Array.isArray(data.features) ? data.features : []

  const hits: PoiHit[] = []
  for (const feature of features) {
    const props = feature.properties
    const name = props?.name ?? ''
    if (name === '') continue
    const coords = feature.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) continue
    // 日本語住所想定で区切り文字なし
    const address = [props?.state, props?.city, props?.district, props?.street, props?.housenumber]
      .filter(Boolean)
      .join('')
    const hit = makeHit(
      'photon',
      'facility',
      name,
      address,
      undefined,
      coords[1],
      coords[0],
      ['ODbL'],
      ['© OpenStreetMap contributors'],
    )
    if (hit) hits.push(hit)
  }
  return hits
}

/** Photon（OSM）フォールバック検索。未設定時は空配列。center無しは全球検索。 */
export async function searchFallback(
  query: string,
  center: PoiCenter | null,
  limit = 20,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (!isPoiFallbackEnabled || q.length < 2) return []
  const key = `${q}|${center?.lat ?? ''},${center?.lng ?? ''}`

  return cachedFetch(fallbackCache, fallbackPending, key, () => fetchPhotonHits(q, center, limit))
}

/**
 * Photonを主プロバイダとして検索する（一覧用・既定limit=50）。
 * boundsがあれば中心をcenterバイアスに使う。未設定時は空配列。
 */
export async function searchPrimary(
  query: string,
  bounds: PoiBounds | null,
  limit = 50,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (!isPoiFallbackEnabled || q.length < 2) return []
  return cachedPhotonPrimary(q, bounds ? boundsCenter(bounds) : null, limit)
}

/**
 * Photonを主プロバイダとしてサジェストする（既定limit=8）。
 * categoryを持たないため名称一致ソートのみ適用する。
 */
export async function suggestPrimary(
  query: string,
  bounds: PoiBounds,
  limit = 8,
): Promise<PoiHit[]> {
  const q = query.trim()
  if (!isPoiFallbackEnabled || q.length < 2) return []
  return cachedPhotonPrimary(q, boundsCenter(bounds), limit)
}

/** Photon主検索のキャッシュ付き実行。名称一致で代表的な場所を上位に寄せる。 */
function cachedPhotonPrimary(
  q: string,
  center: PoiCenter | null,
  limit: number,
): Promise<PoiHit[]> {
  const key = `${q}|${center?.lat ?? ''},${center?.lng ?? ''}|${limit}`
  return cachedFetch(primaryCache, primaryPending, key, async () =>
    sortOpenPoiHits(await fetchPhotonHits(q, center, limit), q),
  )
}

/**
 * 施設サジェストと住所検索を並行実行する。
 * Photon有効時はPhotonサジェストを主とし、0件のときだけOpenPOIサジェストへ回す。
 * 失敗した側は空配列にして部分結果を返す。
 */
export async function suggestAll(
  query: string,
  bounds: PoiBounds,
): Promise<{ facilities: PoiHit[]; addresses: PoiHit[] }> {
  const q = query.trim()
  if (q.length < 2) return { facilities: [], addresses: [] }

  const [facilities, addresses] = await Promise.allSettled([
    resolveSuggestFacilities(q, bounds),
    searchAddress(q),
  ])

  return {
    facilities: facilities.status === 'fulfilled' ? facilities.value : [],
    addresses: addresses.status === 'fulfilled' ? addresses.value : [],
  }
}

/** Photon主→OpenPOIフォールバックで施設サジェストを解決する。 */
async function resolveSuggestFacilities(q: string, bounds: PoiBounds): Promise<PoiHit[]> {
  if (isPoiFallbackEnabled) {
    const primary = await suggestPrimary(q, bounds, 8).catch(() => [] as PoiHit[])
    if (primary.length > 0) return primary
  }
  return suggestFacilities(q, bounds, 5)
}
