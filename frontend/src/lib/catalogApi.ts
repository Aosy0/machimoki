const GSI_REVERSE_GEOCODER_URL =
  'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const PLATEAU_CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'
// 自治体コード解決のフォールバック用（GSI不通時）。表示用のs0001より精細な
// s0010を使い、境界付近の誤判定を減らす。GSI失敗時のみ取得しキャッシュする。
const N03_GEOJSON_URL =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_210101.json'
const N03_FETCH_TIMEOUT_MS = 20000
const GSI_REVERSE_GEOCODER_TIMEOUT_MS = 10_000

export type Lod = 'lod1' | 'lod2' | 'lod3' | 'lod4'

interface GsiReverseGeocodeResult {
  results: {
    muniCd: string
    lv01Nm: string
  }
}

interface PlateauDataset {
  id: string
  name: string
  pref: string
  pref_code: string
  city: string
  city_code: string
  ward: string | null
  ward_code: string | null
  type: string
  type_en: string
  url: string
  format: string
  lod: string
  texture: boolean
}

interface PlateauCatalogResponse {
  datasets: PlateauDataset[]
}

/** 建物以外に重ね表示できるPLATEAUの3Dレイヤー。 */
export type LayerType = 'brid' | 'tran'

const BUILDING_TYPE_NAME = '建築物モデル'

/** レイヤー → データカタログの type 名。 */
const LAYER_TYPE_NAME: Record<LayerType, string> = {
  brid: '橋梁モデル',
  tran: '交通（道路）モデル',
}

export const LAYER_KEYS: LayerType[] = ['brid', 'tran']

let cachedDatasets: PlateauDataset[] | null = null
let cachedDatasetsPromise: Promise<PlateauDataset[]> | null = null

async function fetchCatalogDatasets(): Promise<PlateauDataset[]> {
  if (cachedDatasets) return cachedDatasets
  if (cachedDatasetsPromise) return cachedDatasetsPromise

  cachedDatasetsPromise = fetch(PLATEAU_CATALOG_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`カタログAPI失敗: ${res.status}`)
      return res.json()
    })
    .then((data: PlateauCatalogResponse) => {
      cachedDatasets = data.datasets
      return data.datasets
    })

  return cachedDatasetsPromise
}

export async function resolveMuniCode(
  lat: number,
  lon: number,
  timeoutMs: number = GSI_REVERSE_GEOCODER_TIMEOUT_MS,
): Promise<string> {
  const url = `${GSI_REVERSE_GEOCODER_URL}?lat=${lat}&lon=${lon}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('逆ジオコーディングがタイムアウトしました')
    }
    throw err
  }
  if (!res.ok) throw new Error(`逆ジオコーディング失敗: ${res.status}`)
  const data: GsiReverseGeocodeResult = await res.json()
  if (!data.results?.muniCd) throw new Error('市区町村コードが取得できません')
  return data.results.muniCd
}

const muniCodesCache = new Map<string, string[]>()
const muniCodesPending = new Map<string, Promise<string[]>>()
const tilesetUrlCache = new Map<string, string>()

function boundsKey(bounds: { west: number; south: number; east: number; north: number }): string {
  const f = (n: number): string => Number(n).toFixed(6)
  return `${f(bounds.west)},${f(bounds.south)},${f(bounds.east)},${f(bounds.north)}`
}

export function clearCatalogApiCache(): void {
  muniCodesCache.clear()
  muniCodesPending.clear()
  tilesetUrlCache.clear()
  layerMuniCodesCache.clear()
}

export async function resolveMuniCodes(bounds: {
  west: number
  south: number
  east: number
  north: number
}): Promise<string[]> {
  const key = boundsKey(bounds)
  const cached = muniCodesCache.get(key)
  if (cached) return [...cached]
  const pending = muniCodesPending.get(key)
  if (pending) return pending

  const task = (async (): Promise<string[]> => {
    const points = [
      { lat: bounds.south, lon: bounds.west },
      { lat: bounds.south, lon: bounds.east },
      { lat: bounds.north, lon: bounds.west },
      { lat: bounds.north, lon: bounds.east },
      { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 },
    ]

    const results = await Promise.allSettled(
      points.map((p) => resolveMuniCodeWithFallback(p.lat, p.lon)),
    )

    const codes = new Set<string>()
    let anySuccess = false
    for (const result of results) {
      if (result.status === 'fulfilled') {
        codes.add(result.value)
        anySuccess = true
      }
    }

    if (!anySuccess) {
      throw new Error('選択範囲の自治体コードが取得できません')
    }

    const list = Array.from(codes)
    muniCodesCache.set(key, list)
    return [...list]
  })()

  muniCodesPending.set(key, task)
  try {
    return await task
  } catch (err) {
    muniCodesPending.delete(key)
    throw err
  } finally {
    if (muniCodesPending.get(key) === task) muniCodesPending.delete(key)
  }
}

/** GSIを試し、失敗時はN03点包含で代替する。 */
async function resolveMuniCodeWithFallback(lat: number, lon: number): Promise<string> {
  try {
    return await resolveMuniCode(lat, lon)
  } catch {
    return resolveMuniCodeLocal(lat, lon)
  }
}

interface N03Feature {
  properties?: { N03_007?: string | number }
  geometry?: { type?: string; coordinates?: unknown }
}

let cachedN03Features: N03Feature[] | null = null
let cachedN03Promise: Promise<N03Feature[]> | null = null

async function fetchN03Features(): Promise<N03Feature[]> {
  if (cachedN03Features) return cachedN03Features
  if (cachedN03Promise) return cachedN03Promise

  cachedN03Promise = (async () => {
    const res = await fetch(N03_GEOJSON_URL, {
      signal: AbortSignal.timeout(N03_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`行政区域データの取得に失敗: ${res.status}`)
    const data = (await res.json()) as { features?: N03Feature[] }
    if (!Array.isArray(data.features)) throw new Error('行政区域データの形式が不正です')
    cachedN03Features = data.features
    return data.features
  })().catch((err: unknown) => {
    cachedN03Promise = null
    throw err
  })

  return cachedN03Promise
}

/** N03_007を5桁コードに正規化する。 */
export function normalizeN03Code(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null
    const str = String(value)
    return str.length <= 5 ? str.padStart(5, '0') : null
  }
  if (typeof value === 'string') {
    const str = value.trim()
    if (!/^\d{1,5}$/.test(str)) return null
    return str.padStart(5, '0')
  }
  return null
}

function ringContains(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function ringBBox(ring: number[][]): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon
    if (lon > e) e = lon
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  return [w, s, e, n]
}

/** フィーチャが点を含むか。Polygon/MultiPolygon・ホール対応。 */
export function featureContainsPoint(lon: number, lat: number, feature: N03Feature): boolean {
  const geometry = feature.geometry
  if (!geometry || !Array.isArray(geometry.coordinates)) return false
  const polys: number[][][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])
        : []
  for (const poly of polys) {
    const outer = poly[0]
    if (!outer || outer.length < 3) continue
    const [w, s, e, n] = ringBBox(outer)
    if (lon < w || lon > e || lat < s || lat > n) continue
    if (!ringContains(lon, lat, outer)) continue
    let inHole = false
    for (const hole of poly.slice(1)) {
      if (hole.length >= 3 && ringContains(lon, lat, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

/** N03ポリゴンから点を含む市区町村コードを探す。 */
export function findMuniCodeByPoint(
  lon: number,
  lat: number,
  features: N03Feature[],
): string | null {
  for (const feature of features) {
    if (!featureContainsPoint(lon, lat, feature)) continue
    const code = normalizeN03Code(feature.properties?.N03_007)
    if (code) return code
  }
  return null
}

/** GSIを使わずN03点包含だけで市区町村コードを解決する。 */
export async function resolveMuniCodeLocal(lat: number, lon: number): Promise<string> {
  const features = await fetchN03Features()
  const code = findMuniCodeByPoint(lon, lat, features)
  if (!code) throw new Error('市区町村コードが取得できません')
  return code
}

function matchesMuniCode(d: PlateauDataset, muniCode: string): boolean {
  return d.ward_code === muniCode || d.city_code === muniCode
}

/** 指定type（建築物・橋梁・道路など）の3D TilesタイルセットURLを解決する。 */
async function findTilesetUrlForType(
  muniCode: string,
  lod: Lod,
  typeName: string,
): Promise<string> {
  const key = `${muniCode}:${lod}:${typeName}`
  const cached = tilesetUrlCache.get(key)
  if (cached) return cached
  const datasets = await fetchCatalogDatasets()
  const prefCode = muniCode.slice(0, 2)
  const targetLod = lod.replace('lod', '')

  // texture: false を優先し、無い場合のみ texture: true を許容
  const candidates = datasets.filter(
    (d) =>
      d.pref_code === prefCode &&
      d.format === '3D Tiles' &&
      d.type === typeName &&
      d.lod === targetLod &&
      matchesMuniCode(d, muniCode),
  )

  if (candidates.length === 0) {
    throw new Error(
      `該当する3D Tilesデータセットが見つかりません: muniCode=${muniCode}, lod=${lod}, type=${typeName}`,
    )
  }

  const noTextureCandidate = candidates.find((d) => !d.texture)
  const candidate = noTextureCandidate ?? candidates[0]

  tilesetUrlCache.set(key, candidate.url)
  return candidate.url
}

export async function findTilesetUrl(muniCode: string, lod: Lod): Promise<string> {
  return findTilesetUrlForType(muniCode, lod, BUILDING_TYPE_NAME)
}

export const LOD_ORDER: Lod[] = ['lod1', 'lod2', 'lod3', 'lod4']

/** 指定typeで利用可能なLOD一覧を返す（lod1 → lod4 順）。 */
async function getAvailableLodsForType(muniCode: string, typeName: string): Promise<Lod[]> {
  const datasets = await fetchCatalogDatasets()
  const prefCode = muniCode.slice(0, 2)
  const found = new Set<string>()
  for (const d of datasets) {
    if (d.pref_code !== prefCode) continue
    if (d.format !== '3D Tiles') continue
    if (d.type !== typeName) continue
    if (!matchesMuniCode(d, muniCode)) continue
    if (['1', '2', '3', '4'].includes(d.lod)) {
      found.add(`lod${d.lod}`)
    }
  }
  return LOD_ORDER.filter((lod) => found.has(lod))
}

/** 指定自治体で利用可能な建物LOD一覧を返す（lod1 → lod4 順）。 */
export async function getMuniAvailableLods(muniCode: string): Promise<Lod[]> {
  return getAvailableLodsForType(muniCode, BUILDING_TYPE_NAME)
}

/**
 * 指定自治体で要求LODに対応するタイルセットURLを返す。
 * 要求LODが未整備の場合は、対応している中で最も詳細なレベルにフォールバックする。
 */
export async function findBestTilesetUrl(
  muniCode: string,
  requestedLod: Lod,
): Promise<{ url: string; actualLod: Lod }> {
  try {
    const url = await findTilesetUrl(muniCode, requestedLod)
    return { url, actualLod: requestedLod }
  } catch (firstErr) {
    const available = await getMuniAvailableLods(muniCode)
    if (available.length === 0) throw firstErr
    // 最も詳細（末尾）を優先する
    const fallbackLod = available[available.length - 1]
    const url = await findTilesetUrl(muniCode, fallbackLod)
    return { url, actualLod: fallbackLod }
  }
}

const layerMuniCodesCache = new Map<LayerType, Promise<Set<string>>>()

/** レイヤーの3D Tilesを保有する自治体コード一覧（レイヤー単位でキャッシュ）。 */
export function getLayerMuniCodes(layer: LayerType): Promise<Set<string>> {
  const cached = layerMuniCodesCache.get(layer)
  if (cached) return cached

  const task = fetchCatalogDatasets().then((datasets) => {
    const typeName = LAYER_TYPE_NAME[layer]
    const codes = new Set<string>()
    for (const d of datasets) {
      if (d.format !== '3D Tiles') continue
      if (d.type !== typeName) continue
      if (d.city_code) codes.add(d.city_code)
      if (d.ward_code) codes.add(d.ward_code)
    }
    return codes
  })
  layerMuniCodesCache.set(layer, task)
  return task
}

/**
 * レイヤーのタイルセットURLを返す。未整備の自治体では null。
 * 要求LODが未整備の場合は、対応している中で最も詳細なレベルにフォールバックする。
 */
export async function findLayerTilesetUrl(
  muniCode: string,
  layer: LayerType,
  requestedLod: Lod,
): Promise<{ url: string; actualLod: Lod } | null> {
  const typeName = LAYER_TYPE_NAME[layer]
  const available = await getAvailableLodsForType(muniCode, typeName)
  if (available.length === 0) return null
  // 要求LODが無い場合は最も詳細（末尾）へフォールバックする
  const actualLod = available.includes(requestedLod) ? requestedLod : available[available.length - 1]
  const url = await findTilesetUrlForType(muniCode, actualLod, typeName)
  return { url, actualLod }
}

/** 選択範囲の自治体のうち、各レイヤーの3D Tilesが含まれるかを返す。 */
export async function getLayerAvailability(bounds: {
  west: number
  south: number
  east: number
  north: number
}): Promise<Record<LayerType, boolean>> {
  const muniCodes = await resolveMuniCodes(bounds)
  const [brid, tran] = await Promise.all([getLayerMuniCodes('brid'), getLayerMuniCodes('tran')])
  const covered = (codes: Set<string>): boolean => muniCodes.some((code) => codes.has(code))
  return { brid: covered(brid), tran: covered(tran) }
}

export async function getAvailableLods(bounds: {
  west: number
  south: number
  east: number
  north: number
}): Promise<Lod[]> {
  const muniCodes = await resolveMuniCodes(bounds)
  const datasets = await fetchCatalogDatasets()

  const availableLods = new Set<string>()

  for (const muniCode of muniCodes) {
    const prefCode = muniCode.slice(0, 2)

    for (const d of datasets) {
      if (d.pref_code !== prefCode) continue
      if (d.format !== '3D Tiles') continue
      if (d.type !== '建築物モデル') continue

      const matchesWard = d.ward_code && d.ward_code === muniCode
      const matchesCity = d.city_code === muniCode

      if (matchesWard || matchesCity) {
        const lodNumber = d.lod
        if (['1', '2', '3', '4'].includes(lodNumber)) {
          availableLods.add(`lod${lodNumber}`)
        }
      }
    }
  }

  const lodOrder: Lod[] = ['lod1', 'lod2', 'lod3', 'lod4']
  return lodOrder.filter((lod) => availableLods.has(lod))
}

/**
 * カバレッジ情報（/api/coverage の Rich 形式）。
 * キーは市区町村コード（政令指定都市は区コード）。
 */
interface CoverageEntry {
  muniCode: string
  name: string
  prefecture: string
  covered: boolean
  lods: number[]
}

type CoverageMap = Record<string, CoverageEntry>

let cachedCoverageMap: CoverageMap | null = null
let cachedCoverageMapPromise: Promise<CoverageMap> | null = null

/**
 * /api/coverage のレスポンスを CoverageMap にパースする。
 * Rich 形式 { muniCode: { name, prefecture, lods } } + meta を想定し、
 * meta キーは無視する。covered が無い場合は lods の有無で判定する。
 */
function parseCoverageMap(data: unknown): CoverageMap {
  const map: CoverageMap = {}
  if (typeof data !== 'object' || data === null) return map

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key === 'meta') continue
    if (typeof value !== 'object' || value === null) continue

    const entry = value as Record<string, unknown>
    const muniCode = typeof entry.muniCode === 'string' ? entry.muniCode : key
    const name = typeof entry.name === 'string' ? entry.name : key
    const prefecture = typeof entry.prefecture === 'string' ? entry.prefecture : ''
    const lods = Array.isArray(entry.lods)
      ? entry.lods.map((l) => Number(l)).filter((n) => Number.isFinite(n))
      : []
    const covered = typeof entry.covered === 'boolean' ? entry.covered : lods.length > 0

    map[muniCode] = { muniCode, name, prefecture, covered, lods }
  }

  return map
}

async function fetchCoverageMap(): Promise<CoverageMap> {
  if (cachedCoverageMap) return cachedCoverageMap
  if (cachedCoverageMapPromise) return cachedCoverageMapPromise

  cachedCoverageMapPromise = fetch('/api/coverage')
    .then((res) => {
      if (!res.ok) throw new Error(`カバレッジAPI失敗: ${res.status}`)
      return res.json()
    })
    .then((data: unknown) => {
      const map = parseCoverageMap(data)
      cachedCoverageMap = map
      return map
    })
    .finally(() => {
      cachedCoverageMapPromise = null
    })

  return cachedCoverageMapPromise
}

/**
 * 建築物モデル(3D Tiles)のカバレッジを持つ市区町村コードの集合を返す。
 * /api/coverage（Worker + R2）を優先し、失敗時は従来のPLATEAUカタログ直接取得にフォールバックする。
 * ward_code があればそちらを優先し、なければ city_code を使う。pref_code は含めない。
 */
export async function getCoverageMuniCodes(): Promise<Set<string>> {
  try {
    const map = await fetchCoverageMap()
    const codes = new Set<string>()
    for (const [code, info] of Object.entries(map)) {
      if (info.covered) codes.add(code)
    }
    return codes
  } catch (err) {
    console.warn('[Coverage] /api/coverage取得失敗、PLATEAUカタログへフォールバック:', err)
  }

  const datasets = await fetchCatalogDatasets()

  const codes = new Set<string>()
  for (const d of datasets) {
    if (d.format !== '3D Tiles') continue
    if (d.type !== '建築物モデル') continue
    codes.add(d.ward_code ?? d.city_code)
  }

  return codes
}

/**
 * 建築物モデル(3D Tiles)のカバレッジ詳細を返す。
 * /api/coverage（Worker + R2）を優先し、失敗時は従来のPLATEAUカタログ直接取得にフォールバックする。
 * キーは市区町村コード（ward_code 優先、なければ city_code）、
 * 値は市区町村名・都道府県名・利用可能なLOD一覧（lod1 → lod4 順）。
 */
export async function getCoverageDetails(): Promise<
  Map<string, { city: string; pref: string; lods: string[] }>
> {
  try {
    const map = await fetchCoverageMap()
    const details = new Map<string, { city: string; pref: string; lods: string[] }>()
    for (const [code, info] of Object.entries(map)) {
      details.set(code, {
        city: info.name,
        pref: info.prefecture,
        lods: info.lods.map((l) => `lod${l}`),
      })
    }
    return details
  } catch (err) {
    console.warn('[Coverage] /api/coverage取得失敗、PLATEAUカタログへフォールバック:', err)
  }

  const datasets = await fetchCatalogDatasets()

  const details = new Map<string, { city: string; pref: string; lods: string[] }>()
  const lodOrder = ['1', '2', '3', '4']

  for (const d of datasets) {
    if (d.format !== '3D Tiles') continue
    if (d.type !== '建築物モデル') continue
    if (!lodOrder.includes(d.lod)) continue

    const muniCode = d.ward_code ?? d.city_code
    const lod = `lod${d.lod}`

    const existing = details.get(muniCode)
    if (existing) {
      if (!existing.lods.includes(lod)) existing.lods.push(lod)
    } else {
      details.set(muniCode, {
        city: d.ward ?? d.city,
        pref: d.pref,
        lods: [lod],
      })
    }
  }

  for (const detail of details.values()) {
    detail.lods.sort((a, b) => lodOrder.indexOf(a.slice(3)) - lodOrder.indexOf(b.slice(3)))
  }

  return details
}
