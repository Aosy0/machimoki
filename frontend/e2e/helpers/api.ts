import type { Page } from '@playwright/test'

/** mockPoiSearch に渡せる候補生成オプション。 */
export interface MockPoiSearchOptions {
  /** 返す候補（施設）の件数。既定20件。 */
  facilityCount?: number
  /** 明示的に候補名を指定する場合。指定時は facilityCount より優先。 */
  facilityNames?: string[]
  /** 住所（GSI）候補の件数。既定0件（干渉テストでは不要）。 */
  addressCount?: number
}

/** OpenPOI suggest/search・GSI・Photon の応答を固定化し、オフラインでも安定させる。 */
export async function mockPoiSearch(page: Page, options: MockPoiSearchOptions = {}): Promise<void> {
  const names =
    options.facilityNames ??
    Array.from({ length: options.facilityCount ?? 20 }, (_, i) => `テスト施設 ${i + 1}`)

  const suggestions = names.map((name, i) => ({
    name,
    address: `東京都テスト区${i + 1}丁目`,
    lat: 35.68 + i * 0.0001,
    lng: 139.69 + i * 0.0001,
    level: 8,
    category: 'unknown',
    matched: [name],
  }))

  const results = names.map((name, i) => ({
    name,
    address: `東京都テスト区${i + 1}丁目`,
    prefecture: '東京都',
    city: 'テスト区',
    lat: 35.68 + i * 0.0001,
    lng: 139.69 + i * 0.0001,
    category: 'unknown',
    licenses: ['test-license'],
    attributions: ['test-attribution'],
  }))

  await page.route('**/api.openpoiapi.com/v1/suggest*', (route) =>
    route.fulfill({
      json: {
        count: suggestions.length,
        scope: 'view',
        suggestions,
        licenses: ['test-license'],
        attributions: ['test-attribution'],
        vocabulary: [],
        completion: null,
      },
    }),
  )

  await page.route('**/api.openpoiapi.com/v1/search*', (route) =>
    route.fulfill({ json: { count: results.length, results } }),
  )

  await page.route('**/msearch.gsi.go.jp/address-search/**', (route) => route.fulfill({ json: [] }))

  // Photon は VITE_POI_FALLBACK_URL 設定時のみ呼ばれる。ホスト名に photon を含むものへ応答。
  await page.route(/https?:\/\/[^/]*photon[^/]*\/api/, (route) =>
    route.fulfill({ json: { features: [] } }),
  )
}
