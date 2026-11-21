/**
 * catalogApi の resolveMuniCode タイムアウト単体テスト（Cesium 非依存）。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/catalogApi.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  resolveMuniCode,
  resolveMuniCodes,
  clearCatalogApiCache,
  normalizeN03Code,
  featureContainsPoint,
  findMuniCodeByPoint,
  findLayerTilesetUrl,
  getLayerAvailability,
} from './catalogApi'

describe('resolveMuniCode タイムアウト', () => {
  it('タイムアウトで AbortSignal が abort されエラーになる', async () => {
    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
        })
      })
    }) as typeof fetch

    try {
      const promise = resolveMuniCode(35.6895, 139.6917, 50)
      assert.ok(capturedSignal instanceof AbortSignal)
      assert.equal(capturedSignal?.aborted, false)

      await assert.rejects(promise, /逆ジオコーディングがタイムアウト/)
      assert.equal(capturedSignal?.aborted, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('N03フォールバック', () => {
  it('normalizeN03Codeが5桁に正規化する', () => {
    assert.equal(normalizeN03Code(13101), '13101')
    assert.equal(normalizeN03Code(1101), '01101')
    assert.equal(normalizeN03Code('13103'), '13103')
    assert.equal(normalizeN03Code('abc'), null)
    assert.equal(normalizeN03Code(123456), null)
  })

  it('featureContainsPointがホール付きポリゴンを判定する', () => {
    const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ]
    const withHole = {
      properties: { N03_007: '13101' },
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(3, 3, 5, 5)] },
    }
    assert.equal(featureContainsPoint(1, 1, withHole), true)
    assert.equal(featureContainsPoint(4, 4, withHole), false)
    assert.equal(featureContainsPoint(20, 20, withHole), false)
  })

  it('findMuniCodeByPointが含むフィーチャのコードを返す', () => {
    const features = [
      {
        properties: { N03_007: '13108' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [139.7, 35.7],
              [139.8, 35.7],
              [139.8, 35.73],
              [139.7, 35.73],
              [139.7, 35.7],
            ],
          ],
        },
      },
    ]
    assert.equal(findMuniCodeByPoint(139.785, 35.714, features), '13108')
    assert.equal(findMuniCodeByPoint(139.0, 35.0, features), null)
  })
})

describe('resolveMuniCodesキャッシュ', () => {
  it('同一範囲の2回目はfetchしない', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: { muniCd: '13101', lv01Nm: '千代田区' } }),
      } as Response)) as typeof fetch

    try {
      clearCatalogApiCache()
      const bounds = { west: 139.6903, south: 35.6997, east: 139.6906, north: 35.7 }
      const first = await resolveMuniCodes(bounds)
      calls = 0
      globalThis.fetch = (() => {
        calls += 1
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: { muniCd: '13101', lv01Nm: '千代田区' } }),
        } as Response)
      }) as typeof fetch
      const second = await resolveMuniCodes({ ...bounds })
      assert.deepEqual(first, second)
      assert.equal(calls, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('橋梁・道路レイヤー', () => {
  const CATALOG_JSON = {
    datasets: [
      {
        id: 'brid-13104-lod1',
        pref: '東京都',
        pref_code: '13',
        city: '新宿区',
        city_code: '13104',
        ward: null,
        ward_code: null,
        type: '橋梁モデル',
        type_en: 'brid',
        url: 'https://example.com/brid-13104-lod1/tileset.json',
        format: '3D Tiles',
        lod: '1',
        texture: false,
      },
      {
        id: 'brid-13104-lod2',
        pref: '東京都',
        pref_code: '13',
        city: '新宿区',
        city_code: '13104',
        ward: null,
        ward_code: null,
        type: '橋梁モデル',
        type_en: 'brid',
        url: 'https://example.com/brid-13104-lod2/tileset.json',
        format: '3D Tiles',
        lod: '2',
        texture: false,
      },
      {
        id: 'tran-13104-lod3',
        pref: '東京都',
        pref_code: '13',
        city: '新宿区',
        city_code: '13104',
        ward: null,
        ward_code: null,
        type: '交通（道路）モデル',
        type_en: 'tran',
        url: 'https://example.com/tran-13104-lod3/tileset.json',
        format: '3D Tiles',
        lod: '3',
        texture: false,
      },
    ],
  }

  /** カタログAPIと逆ジオコーダを差し替える。 */
  function mockFetch(muniCd: string): void {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('plateau-datasets')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(CATALOG_JSON),
        } as Response)
      }
      if (url.includes('reverse-geocoder')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: { muniCd, lv01Nm: '新宿区' } }),
        } as Response)
      }
      return Promise.reject(new Error('unexpected fetch: ' + url))
    }) as typeof fetch
  }

  it('未整備のLODは最も詳細なレベルへフォールバックする', async () => {
    const originalFetch = globalThis.fetch
    try {
      clearCatalogApiCache()
      mockFetch('13104')
      const result = await findLayerTilesetUrl('13104', 'brid', 'lod3')
      assert.equal(result?.actualLod, 'lod2')
      assert.equal(result?.url, 'https://example.com/brid-13104-lod2/tileset.json')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('整備済みのLODはそのまま使う', async () => {
    const originalFetch = globalThis.fetch
    try {
      clearCatalogApiCache()
      mockFetch('13104')
      const result = await findLayerTilesetUrl('13104', 'tran', 'lod3')
      assert.equal(result?.actualLod, 'lod3')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('レイヤーが未整備の自治体は null を返す', async () => {
    const originalFetch = globalThis.fetch
    try {
      clearCatalogApiCache()
      mockFetch('13105')
      assert.equal(await findLayerTilesetUrl('13105', 'brid', 'lod1'), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('範囲内の自治体の整備状況を返す', async () => {
    const originalFetch = globalThis.fetch
    try {
      clearCatalogApiCache()
      mockFetch('13104')
      const available = await getLayerAvailability({
        west: 139.69,
        south: 35.69,
        east: 139.71,
        north: 35.71,
      })
      assert.deepEqual(available, { brid: true, tran: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('3Dデータが無い自治体では両方 false', async () => {
    const originalFetch = globalThis.fetch
    try {
      clearCatalogApiCache()
      mockFetch('13105')
      const available = await getLayerAvailability({
        west: 139.72,
        south: 35.7,
        east: 139.73,
        north: 35.71,
      })
      assert.deepEqual(available, { brid: false, tran: false })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

