const GSI_REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const PLATEAU_CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'

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

export async function resolveMuniCode(lat: number, lon: number): Promise<string> {
  const url = `${GSI_REVERSE_GEOCODER_URL}?lat=${lat}&lon=${lon}`
  const res = await fetch(url)
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
