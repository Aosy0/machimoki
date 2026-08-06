const GSI_REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
const PLATEAU_CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'

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
  lod: 'lod1' | 'lod2'
): Promise<string> {
  const datasets = await fetchCatalogDatasets()
  const prefCode = muniCode.slice(0, 2)
  const targetLod = lod === 'lod1' ? '1' : '2'

  const candidate = datasets.find((d) => {
    if (d.pref_code !== prefCode) return false
    if (d.format !== '3D Tiles') return false
    if (d.type !== '建築物モデル') return false
    if (d.lod !== targetLod) return false
    if (d.ward_code && d.ward_code === muniCode) return true
    if (d.city_code === muniCode) return true
    return false
  })

  if (!candidate) {
    throw new Error(
      `該当する3D Tilesデータセットが見つかりません: muniCode=${muniCode}, lod=${lod}`
    )
  }

  return candidate.url
}
