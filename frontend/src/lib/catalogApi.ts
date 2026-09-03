const GSI_REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const PLATEAU_CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'
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

export async function resolveMuniCodes(
  bounds: { west: number; south: number; east: number; north: number }
): Promise<string[]> {
  const points = [
    { lat: bounds.south, lon: bounds.west },
    { lat: bounds.south, lon: bounds.east },
    { lat: bounds.north, lon: bounds.west },
    { lat: bounds.north, lon: bounds.east },
    { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 },
  ]

  const results = await Promise.allSettled(
    points.map((p) => resolveMuniCode(p.lat, p.lon))
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

  return Array.from(codes)
}

export async function findTilesetUrl(
  muniCode: string,
  lod: Lod
): Promise<string> {
  const datasets = await fetchCatalogDatasets()
  const prefCode = muniCode.slice(0, 2)
  const targetLod = lod.replace('lod', '')

  // texture: false を優先し、無い場合のみ texture: true を許容
  const candidates = datasets.filter((d) => {
    if (d.pref_code !== prefCode) return false
    if (d.format !== '3D Tiles') return false
    if (d.type !== '建築物モデル') return false
    if (d.lod !== targetLod) return false
    if (d.ward_code && d.ward_code === muniCode) return true
    if (d.city_code === muniCode) return true
    return false
  })

  if (candidates.length === 0) {
    throw new Error(
      `該当する3D Tilesデータセットが見つかりません: muniCode=${muniCode}, lod=${lod}`
    )
  }

  // texture: false を優先
  const noTextureCandidate = candidates.find((d) => !d.texture)
  const candidate = noTextureCandidate ?? candidates[0]

  return candidate.url
}

export async function getAvailableLods(
  bounds: { west: number; south: number; east: number; north: number }
): Promise<Lod[]> {
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
