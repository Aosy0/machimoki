/**
 * previewBudget（プレビュー読み込み負荷推定）のテスト。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/previewBudget.test.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREVIEW_BUDGET,
  readB3dmBatchLength,
  classifyPreviewLoad,
  estimatePreviewLoad,
  adaptiveTerrainGridSize,
  resolveTerrainGridSize,
  previewMaxZoomDistance,
  boundsMaxDimMeters,
  isSmallRange,
  isLargeRange,
  pickTerrainLevel,
  clearPreviewBudgetCache,
  type Bounds,
} from './previewBudget'

/** BATCH_LENGTH を持つ最小 b3dm バッファを構築する。 */
function makeB3dm(batchLength: number): ArrayBuffer {
  const ftJson = JSON.stringify({ BATCH_LENGTH: batchLength })
  const ftLen = ftJson.length
  const total = 28 + ftLen
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
  view.setUint32(4, 1, true) // version
  view.setUint32(8, total, true) // byteLength
  view.setUint32(12, ftLen, true) // featureTableJSONByteLength
  new TextEncoder().encodeInto(ftJson, new Uint8Array(buf, 28, ftLen))
  return buf
}

function resp(status: number, body?: BodyInit | null, headers?: Record<string, string>): Response {
  return new Response(body ?? null, { status, headers })
}

interface MockFetch {
  fetch: typeof fetch
  calls: Map<string, number>
}

function mockFetch(routes: Record<string, () => Response>): MockFetch {
  const calls = new Map<string, number>()
  const fetchImpl = ((input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    calls.set(url, (calls.get(url) ?? 0) + 1)
    const route = routes[url]
    if (!route) return Promise.reject(new Error(`no route for ${url}`))
    return Promise.resolve(route())
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

/** 度 → ラジアン。3D Tiles の boundingVolume.region はラジアンで指定する。 */
const rad = (d: number): number => (d * Math.PI) / 180

function tileset(root: unknown): unknown {
  return { asset: { version: '1.0' }, geometricError: 100, root }
}

function tile(
  region: [number, number, number, number] | null,
  contentUrl: string | null,
  children: unknown[] = [],
): unknown {
  const t: Record<string, unknown> = {
    boundingVolume: region ? { region: [...region, 0, 100] } : undefined,
  }
  if (contentUrl) t.content = { url: contentUrl }
  if (children.length > 0) t.children = children
  return t
}

function uriTile(region: [number, number, number, number], contentUri: string): unknown {
  return { boundingVolume: { region: [...region, 0, 100] }, content: { uri: contentUri } }
}

const B: Bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 }

describe('readB3dmBatchLength', () => {
  it('BATCH_LENGTH を読み取る', () => {
    assert.equal(readB3dmBatchLength(makeB3dm(42)), 42)
  })

  it('不正データは 0 を返す（短い/非b3dm/JSONなし）', () => {
    assert.equal(readB3dmBatchLength(new ArrayBuffer(4)), 0)
    const notB3dm = new ArrayBuffer(28)
    assert.equal(readB3dmBatchLength(notB3dm), 0)
    const zeroLen = new ArrayBuffer(32)
    const view = new DataView(zeroLen)
    ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
    view.setUint32(12, 0, true)
    assert.equal(readB3dmBatchLength(zeroLen), 0)
  })

  it('BATCH_LENGTH が非数・負なら 0 を返す', () => {
    const ft = JSON.stringify({ BATCH_LENGTH: -5 })
    const total = 28 + ft.length
    const buf = new ArrayBuffer(total)
    const view = new DataView(buf)
    ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
    view.setUint32(12, ft.length, true)
    new TextEncoder().encodeInto(ft, new Uint8Array(buf, 28, ft.length))
    assert.equal(readB3dmBatchLength(buf), 0)
  })
})

describe('classifyPreviewLoad', () => {
  const base = {
    intersectingTiles: 1,
    contentTiles: 1,
    totalBuildings: 1,
    totalContentBytes: 1,
    capped: false,
  }

  it('予算内なら buildings/ok', () => {
    const d = classifyPreviewLoad(base)
    assert.equal(d.mode, 'buildings')
    assert.equal(d.reason, 'ok')
  })

  it('コンテンツ・建物がゼロなら terrain-only/no-data', () => {
    const d = classifyPreviewLoad({
      ...base,
      contentTiles: 0,
      totalBuildings: 0,
      totalContentBytes: 0,
    })
    assert.equal(d.mode, 'terrain-only')
    assert.equal(d.reason, 'no-data')
  })

  it('建物数が上限超過なら terrain-only/too-large', () => {
    const d = classifyPreviewLoad({ ...base, totalBuildings: PREVIEW_BUDGET.maxBuildings + 1 })
    assert.equal(d.mode, 'terrain-only')
    assert.equal(d.reason, 'too-large')
  })

  it('交差タイル数が上限超過なら too-large', () => {
    const d = classifyPreviewLoad({
      ...base,
      intersectingTiles: PREVIEW_BUDGET.maxIntersectingTiles + 1,
    })
    assert.equal(d.reason, 'too-large')
  })

  it('コンテンツバイトが上限超過なら too-large', () => {
    const d = classifyPreviewLoad({
      ...base,
      totalContentBytes: PREVIEW_BUDGET.maxContentBytes + 1,
    })
    assert.equal(d.reason, 'too-large')
  })

  it('capped なら too-large', () => {
    const d = classifyPreviewLoad({ ...base, capped: true })
    assert.equal(d.reason, 'too-large')
  })

  it('上限ちょうどなら buildings/ok（境界）', () => {
    const d = classifyPreviewLoad({
      intersectingTiles: PREVIEW_BUDGET.maxIntersectingTiles,
      contentTiles: 1,
      totalBuildings: PREVIEW_BUDGET.maxBuildings,
      totalContentBytes: PREVIEW_BUDGET.maxContentBytes,
      capped: false,
    })
    assert.equal(d.mode, 'buildings')
  })

  it('地理的な広さとは無関係にカウントのみで判定する（地理サイズ独立性）', () => {
    const tiny = classifyPreviewLoad(base)
    const huge = classifyPreviewLoad({
      ...base,
      intersectingTiles: 10,
      totalBuildings: 5,
      totalContentBytes: 100,
    })
    assert.deepEqual(tiny, huge)
  })
})

describe('adaptiveTerrainGridSize / previewMaxZoomDistance', () => {
  it('最大寸法が大きいほどグリッド分割を減らす', () => {
    assert.equal(adaptiveTerrainGridSize(0), 128)
    assert.equal(adaptiveTerrainGridSize(5000), 128)
    assert.equal(adaptiveTerrainGridSize(5001), 64)
    assert.equal(adaptiveTerrainGridSize(10000), 64)
    assert.equal(adaptiveTerrainGridSize(10001), 48)
    assert.equal(adaptiveTerrainGridSize(20000), 48)
    assert.equal(adaptiveTerrainGridSize(20001), 32)
    assert.equal(adaptiveTerrainGridSize(30000), 32)
  })

  it('最大寸法に応じてズーム距離を伸ばす（下限10000m）', () => {
    assert.equal(previewMaxZoomDistance(1000), 10000)
    assert.equal(previewMaxZoomDistance(4000), 10000)
    assert.equal(previewMaxZoomDistance(8000), 20000)
    assert.equal(previewMaxZoomDistance(10000), 25000)
  })

  it('小範囲判定は最大辺750mが境界', () => {
    assert.equal(PREVIEW_BUDGET.smallRangeMaxDimMeters, 750)
    assert.equal(PREVIEW_BUDGET.maxBuildings, 2500)
    const tiny: Bounds = { west: 139.69, south: 35.69, east: 139.696, north: 35.694 }
    assert.ok(boundsMaxDimMeters(tiny) < 750)
    assert.equal(isSmallRange(tiny), true)
    const over: Bounds = { west: 139.6864, south: 35.6836, east: 139.6972, north: 35.6928 }
    assert.ok(boundsMaxDimMeters(over) > 750)
    assert.equal(isSmallRange(over), false)
  })
})

describe('resolveTerrainGridSize', () => {
  it('明示指定が無ければ範囲最大寸法から自動決定する', () => {
    assert.equal(resolveTerrainGridSize(null, 3000), 128)
    assert.equal(resolveTerrainGridSize(null, 8000), 64)
  })

  it('明示指定はそのまま使い、範囲外はクランプする', () => {
    assert.equal(resolveTerrainGridSize(192, 8000), 192)
    assert.equal(resolveTerrainGridSize(999, 8000), 256)
    assert.equal(resolveTerrainGridSize(1, 8000), 32)
  })
})

describe('isLargeRange', () => {
  it('最大辺5kmを境界に大規模判定する', () => {
    assert.equal(PREVIEW_BUDGET.largeRangeMaxDimMeters, 5000)
    const tiny: Bounds = { west: 139.69, south: 35.69, east: 139.696, north: 35.694 }
    assert.equal(isLargeRange(tiny), false)
    const large: Bounds = { west: 139.6, south: 35.6, east: 139.7, north: 35.7 }
    assert.ok(boundsMaxDimMeters(large) > 5000)
    assert.equal(isLargeRange(large), true)
  })

  it('boundsMaxDimMeters の閾値と一致する', () => {
    const bounds: Bounds = { west: 139.65, south: 35.65, east: 139.72, north: 35.71 }
    assert.equal(isLargeRange(bounds), boundsMaxDimMeters(bounds) > 5000)
  })
})

describe('pickTerrainLevel', () => {
  it('非有限または 0 以下は minLevel', () => {
    assert.equal(pickTerrainLevel(0, 2, 15), 2)
    assert.equal(pickTerrainLevel(-1, 2, 15), 2)
    assert.equal(pickTerrainLevel(NaN, 3, 15), 3)
    assert.equal(pickTerrainLevel(Infinity, 4, 15), 4)
  })

  it('log2(1440/spanDeg) を丸めてクランプする', () => {
    assert.equal(pickTerrainLevel(1440, 0, 24), 0)
    assert.equal(pickTerrainLevel(1.40625, 0, 24), 10)
    // 極小スパンは maxLevel にクランプ
    assert.equal(pickTerrainLevel(1e-9, 0, 24), 24)
    // 広いスパンは minLevel にクランプ
    assert.equal(pickTerrainLevel(1440, 5, 15), 5)
  })
})

describe('estimatePreviewLoad (mocked fetch)', () => {
  beforeEach(() => {
    clearPreviewBudgetCache()
  })

  it('単一タイルセットの建物数を集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(
              tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'data/1.b3dm', [
                tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'data/2.b3dm'),
              ]),
            ),
          ),
        ),
      'https://x/data/1.b3dm': () =>
        resp(206, makeB3dm(10), { 'Content-Range': 'bytes 0-16383/100' }),
      'https://x/data/2.b3dm': () =>
        resp(206, makeB3dm(20), { 'Content-Range': 'bytes 0-16383/200' }),
    }
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.contentTiles, 2)
    assert.equal(est.totalBuildings, 30)
    assert.equal(est.totalContentBytes, 300)
    assert.equal(est.intersectingTiles, 2)
    assert.equal(est.mode, 'buildings')
    assert.equal(calls.get(url), 1)
  })

  it('外部タイルセットJSONへ再帰する', async () => {
    const root = 'https://x/root.json'
    const ext = 'https://x/ext.json'
    const routes: Record<string, () => Response> = {
      [root]: () =>
        resp(
          200,
          JSON.stringify(tileset(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'ext.json'))),
        ),
      [ext]: () =>
        resp(
          200,
          JSON.stringify(tileset(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'b.b3dm'))),
        ),
      'https://x/b.b3dm': () => resp(206, makeB3dm(7), { 'Content-Range': 'bytes 0-16383/50' }),
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [root], fetch })
    assert.equal(est.contentTiles, 1)
    assert.equal(est.totalBuildings, 7)
  })

  it('bounds 外の region を枝刈りする', async () => {
    const url = 'https://x/tileset.json'
    // 第1子は bounds(B: 139.69..139.7) 外、第2子は内側（region はラジアン）。
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(
              tile(null, null, [
                tile([rad(100), rad(100), rad(101), rad(101)], 'far.b3dm'),
                tile([rad(139.69), rad(35.69), rad(139.7), rad(35.7)], 'near.b3dm'),
              ]),
            ),
          ),
        ),
      'https://x/far.b3dm': () =>
        resp(206, makeB3dm(99), { 'Content-Range': 'bytes 0-16383/1000' }),
      'https://x/near.b3dm': () => resp(206, makeB3dm(3), { 'Content-Range': 'bytes 0-16383/30' }),
    }
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.contentTiles, 1)
    assert.equal(est.totalBuildings, 3)
    assert.equal(calls.get('https://x/far.b3dm'), undefined) // 枝刈りでプローブされない
  })

  it('実東京のラジアンregionは交差し、遠方regionは交差しない', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(
              tile(null, null, [
                // 東京付近（度換算 139.6..139.8, 35.6..35.8）をラジアンで指定 → B と交差
                tile([rad(139.6), rad(35.6), rad(139.8), rad(35.8)], 'tokyo.b3dm'),
                // 大阪付近（度換算 135..136, 34..35）をラジアンで指定 → B と交差しない
                tile([rad(135), rad(34), rad(136), rad(35)], 'osaka.b3dm'),
              ]),
            ),
          ),
        ),
      'https://x/tokyo.b3dm': () => resp(206, makeB3dm(8), { 'Content-Range': 'bytes 0-16383/80' }),
      'https://x/osaka.b3dm': () =>
        resp(206, makeB3dm(50), { 'Content-Range': 'bytes 0-16383/500' }),
    }
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.contentTiles, 1)
    assert.equal(est.totalBuildings, 8)
    assert.equal(calls.get('https://x/tokyo.b3dm'), 1)
    assert.equal(calls.get('https://x/osaka.b3dm'), undefined)
  })

  it('相対URLをベースURL基準で解決する', async () => {
    const url = 'https://host/area/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], '../shared/b.b3dm')),
          ),
        ),
      'https://host/shared/b.b3dm': () =>
        resp(206, makeB3dm(5), { 'Content-Range': 'bytes 0-16383/25' }),
    }
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 5)
    assert.equal(calls.get('https://host/shared/b.b3dm'), 1)
  })

  it('content.uri形式のタイルを集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(uriTile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'building.b3dm')),
          ),
        ),
      'https://x/building.b3dm': () =>
        resp(206, makeB3dm(4), { 'Content-Range': 'bytes 0-16383/40' }),
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 4)
    assert.equal(est.contentTiles, 1)
  })

  it('206 は Content-Range 総数、200 は実バイト数で集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(
              tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], null, [
                tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'a.b3dm'),
                tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'b.b3dm'),
              ]),
            ),
          ),
        ),
      'https://x/a.b3dm': () => resp(206, makeB3dm(4), { 'Content-Range': 'bytes 0-16383/1000' }),
      'https://x/b.b3dm': () => resp(200, makeB3dm(6)),
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 10)
    // a: Content-Range総数 1000、b: 実バッファ長（makeB3dm(6) の byteLength）
    assert.equal(est.totalContentBytes, 1000 + makeB3dm(6).byteLength)
  })

  it('ノード上限で capped になる', async () => {
    const url = 'https://x/tileset.json'
    const children: unknown[] = []
    for (let i = 0; i < PREVIEW_BUDGET.scanNodeCap + 500; i++) {
      children.push(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], null))
    }
    const routes: Record<string, () => Response> = {
      [url]: () => resp(200, JSON.stringify(tileset(tile(null, null, children)))),
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.capped, true)
    assert.equal(est.reason, 'too-large')
    assert.equal(est.mode, 'terrain-only')
  })

  it('bounds+lod+URL でメモ化する（fetch は1回）', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(tileset(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'a.b3dm'))),
        ),
      'https://x/a.b3dm': () => resp(206, makeB3dm(2), { 'Content-Range': 'bytes 0-16383/20' }),
    }
    const { fetch, calls } = mockFetch(routes)
    const input = { bounds: B, lod: 'lod2' as const, tilesetUrls: [url], fetch }
    const first = await estimatePreviewLoad(input)
    const second = await estimatePreviewLoad(input)
    assert.deepEqual(first, second)
    assert.equal(calls.get(url), 1)
  })

  it('失敗したタイル/タイルセットを分離して他は集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, () => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(
            tileset(
              tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], null, [
                tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'ok.b3dm'),
                tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'bad.b3dm'),
              ]),
            ),
          ),
        ),
      'https://x/ok.b3dm': () => resp(206, makeB3dm(5), { 'Content-Range': 'bytes 0-16383/25' }),
      // bad.b3dm はルートなし → reject（分離される）
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 5)
    assert.equal(est.contentTiles, 2) // bad も content として数えた
  })

  it('予算超過したら残りの content プローブを打ち切る', async () => {
    const url = 'https://x/tileset.json'
    const count = 10
    const children: unknown[] = []
    const routes: Record<string, () => Response> = {}
    for (let i = 0; i < count; i++) {
      const name = `t${i}.b3dm`
      children.push(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], name))
      routes[`https://x/${name}`] = () =>
        resp(206, makeB3dm(PREVIEW_BUDGET.maxBuildings + 1), {
          'Content-Range': 'bytes 0-16383/100',
        })
    }
    routes[url] = () => resp(200, JSON.stringify(tileset(tile(null, null, children))))
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    const probed = [...calls.keys()].filter((u) => u.endsWith('.b3dm')).length
    assert.ok(probed < count)
    assert.equal(est.totalBuildings, PREVIEW_BUDGET.maxBuildings + 1)
    assert.equal(est.mode, 'terrain-only')
    assert.equal(est.reason, 'too-large')
  })
})
