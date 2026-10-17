/**
 * previewBudget（プレビュー読み込み負荷推定）のテスト。
 *
 * 実行方法:
 *   npx vitest run frontend/src/lib/previewBudget.test.ts
 */
import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import {
  PREVIEW_BUDGET,
  readB3dmInfo,
  readGltfTriangleCount,
  classifyPreviewLoad,
  estimatePreviewLoad,
  adaptiveTerrainGridSize,
  resolveTerrainGridSize,
  previewMaxZoomDistance,
  boundsMaxDimMeters,
  isSmallRange,
  isLargeRange,
  isBeyondHardRange,
  createFpsGuard,
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

/** Draco圧縮を想定した最小glTF（JSONチャンクのみ）を構築する。 */
function makeGlb(vertices: number, triangles: number): ArrayBuffer {
  const json = JSON.stringify({
    asset: { version: '2.0' },
    accessors: [
      { count: vertices, type: 'VEC3', componentType: 5126 },
      { count: triangles * 3, type: 'SCALAR', componentType: 5125 },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4,
            extensions: {
              KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } },
            },
          },
        ],
      },
    ],
    extensionsUsed: ['KHR_draco_mesh_compression'],
  })
  const encoded = new TextEncoder().encode(json)
  const chunkLen = Math.ceil(encoded.byteLength / 4) * 4
  const total = 12 + 8 + chunkLen
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true) // version
  view.setUint32(8, total, true)
  view.setUint32(12, chunkLen, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  const chunk = new Uint8Array(buf, 20, chunkLen)
  chunk.fill(0x20) // スペースパディング
  chunk.set(encoded)
  return buf
}

/** b3dm ヘッダ + feature table JSON + glb を連結したバッファ。 */
function makeB3dmWithGlb(
  batchLength: number,
  opts: { vertices: number; triangles: number },
): ArrayBuffer {
  const ftBytes = new TextEncoder().encode(JSON.stringify({ BATCH_LENGTH: batchLength }))
  const glb = makeGlb(opts.vertices, opts.triangles)
  const total = 28 + ftBytes.byteLength + glb.byteLength
  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
  view.setUint32(4, 1, true)
  view.setUint32(8, total, true)
  view.setUint32(12, ftBytes.byteLength, true)
  new Uint8Array(buf, 28, ftBytes.byteLength).set(ftBytes)
  new Uint8Array(buf, 28 + ftBytes.byteLength).set(new Uint8Array(glb))
  return buf
}

function glbOffsetOf(batchLength: number): number {
  return 28 + JSON.stringify({ BATCH_LENGTH: batchLength }).length
}

function resp(status: number, body?: BodyInit | null, headers?: Record<string, string>): Response {
  return new Response(body ?? null, { status, headers })
}

/** Rangeヘッダに応じて部分レスポンスを返す。 */
function ranged(buf: ArrayBuffer, init?: RequestInit): Response {
  const range = new Headers(init?.headers).get('range')
  const m = range ? /bytes=(\d+)-(\d+)/.exec(range) : null
  if (!m) return resp(200, buf)
  const start = Number(m[1])
  const end = Math.min(Number(m[2]) + 1, buf.byteLength)
  const body = buf.slice(start, end)
  return resp(206, body, {
    'Content-Range': `bytes ${start}-${start + body.byteLength - 1}/${buf.byteLength}`,
  })
}

interface MockFetch {
  fetch: typeof fetch
  calls: Map<string, number>
}

function mockFetch(routes: Record<string, (init?: RequestInit) => Response>): MockFetch {
  const calls = new Map<string, number>()
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    calls.set(url, (calls.get(url) ?? 0) + 1)
    const route = routes[url]
    if (!route) return Promise.reject(new Error(`no route for ${url}`))
    return Promise.resolve(route(init))
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

function pushFrames(
  guard: ReturnType<typeof createFpsGuard>,
  from: number,
  count: number,
  stepMs: number,
): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i < count; i++) out.push(guard.push(from + i * stepMs))
  return out
}

const B: Bounds = { west: 139.69, south: 35.69, east: 139.7, north: 35.7 }

describe('readB3dmInfo', () => {
  it('BATCH_LENGTH と glbOffset を読み取る', () => {
    const info = readB3dmInfo(makeB3dmWithGlb(42, { vertices: 30, triangles: 10 }))
    assert.ok(info)
    assert.equal(info.batchLength, 42)
    assert.equal(info.glbOffset, glbOffsetOf(42))
  })

  it('不正データは null（短い/非b3dm/バージョン不一致）', () => {
    assert.equal(readB3dmInfo(new ArrayBuffer(4)), null)
    const notB3dm = new ArrayBuffer(28)
    assert.equal(readB3dmInfo(notB3dm), null)
    const wrongVersion = new ArrayBuffer(28)
    const view = new DataView(wrongVersion)
    ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
    view.setUint32(4, 0, true)
    assert.equal(readB3dmInfo(wrongVersion), null)
  })

  it('feature table が切り詰められていても glbOffset は返す', () => {
    const buf = new ArrayBuffer(28)
    const view = new DataView(buf)
    ;['b', '3', 'd', 'm'].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)))
    view.setUint32(4, 1, true)
    view.setUint32(12, 100, true) // ftJsonLen が実バッファ長を超える
    const info = readB3dmInfo(buf)
    assert.ok(info)
    assert.equal(info.batchLength, 0)
    assert.equal(info.glbOffset, 128)
  })

  it('BATCH_LENGTH が非数・負なら 0 を返す', () => {
    const info = readB3dmInfo(makeB3dm(-5))
    assert.ok(info)
    assert.equal(info.batchLength, 0)
  })
})

describe('readGltfTriangleCount', () => {
  it('POSITION/indices から三角形数・頂点数を合算する（Draco JSON）', () => {
    const tri = readGltfTriangleCount(makeGlb(300, 100))
    assert.deepEqual(tri, { triangles: 100, vertices: 300 })
  })

  it('非glTF・短すぎるバッファは null', () => {
    assert.equal(readGltfTriangleCount(makeB3dm(10)), null)
    assert.equal(readGltfTriangleCount(new ArrayBuffer(10)), null)
  })

  it('JSONチャンク長がバッファ長を超えたら null（切り詰め）', () => {
    const buf = new ArrayBuffer(20)
    const view = new DataView(buf)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, 120, true)
    view.setUint32(12, 100, true)
    view.setUint32(16, 0x4e4f534a, true)
    assert.equal(readGltfTriangleCount(buf), null)
  })

  it('JSONチャンク以外・壊れたJSONは null', () => {
    const binChunk = new ArrayBuffer(20)
    const view = new DataView(binChunk)
    view.setUint32(0, 0x46546c67, true)
    view.setUint32(4, 2, true)
    view.setUint32(8, 20, true)
    view.setUint32(12, 0, true)
    view.setUint32(16, 0x004e4942, true)
    assert.equal(readGltfTriangleCount(binChunk), null)

    const broken = new ArrayBuffer(24)
    const bview = new DataView(broken)
    bview.setUint32(0, 0x46546c67, true)
    bview.setUint32(4, 2, true)
    bview.setUint32(8, 24, true)
    bview.setUint32(12, 4, true)
    bview.setUint32(16, 0x4e4f534a, true)
    new TextEncoder().encodeInto('xxxx', new Uint8Array(broken, 20, 4))
    assert.equal(readGltfTriangleCount(broken), null)
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

  it('建物数がハード上限超過なら terrain-only/too-large', () => {
    const d = classifyPreviewLoad({ ...base, totalBuildings: PREVIEW_BUDGET.hardBuildings + 1 })
    assert.equal(d.mode, 'terrain-only')
    assert.equal(d.reason, 'too-large')
  })

  it('交差タイル数がハード上限超過なら too-large', () => {
    const d = classifyPreviewLoad({
      ...base,
      intersectingTiles: PREVIEW_BUDGET.hardIntersectingTiles + 1,
    })
    assert.equal(d.reason, 'too-large')
  })

  it('コンテンツバイトがハード上限超過なら too-large', () => {
    const d = classifyPreviewLoad({
      ...base,
      totalContentBytes: PREVIEW_BUDGET.hardContentBytes + 1,
    })
    assert.equal(d.reason, 'too-large')
  })

  it('推定三角形数がハード上限超過なら too-large', () => {
    const d = classifyPreviewLoad({
      ...base,
      estimatedTriangles: PREVIEW_BUDGET.hardTriangles + 1,
    })
    assert.equal(d.reason, 'too-large')
  })

  it('警告閾値超えでは too-large にしない', () => {
    const d = classifyPreviewLoad({
      ...base,
      intersectingTiles: PREVIEW_BUDGET.warnIntersectingTiles + 1,
      totalBuildings: PREVIEW_BUDGET.warnBuildings + 1,
      totalContentBytes: PREVIEW_BUDGET.warnContentBytes + 1,
      estimatedTriangles: PREVIEW_BUDGET.warnTriangles + 1,
    })
    assert.equal(d.mode, 'buildings')
    assert.equal(d.reason, 'ok')
  })

  it('capped なら too-large', () => {
    const d = classifyPreviewLoad({ ...base, capped: true })
    assert.equal(d.reason, 'too-large')
  })

  it('ハード上限ちょうどなら buildings/ok（境界）', () => {
    const d = classifyPreviewLoad({
      intersectingTiles: PREVIEW_BUDGET.hardIntersectingTiles,
      contentTiles: 1,
      totalBuildings: PREVIEW_BUDGET.hardBuildings,
      totalContentBytes: PREVIEW_BUDGET.hardContentBytes,
      estimatedTriangles: PREVIEW_BUDGET.hardTriangles,
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
    assert.equal(PREVIEW_BUDGET.warnBuildings, 2500)
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

describe('isLargeRange / isBeyondHardRange', () => {
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

  it('最大辺15000mがハード範囲の境界', () => {
    const under: Bounds = { west: 0, south: 0, east: 0.13, north: 0 }
    const over: Bounds = { west: 0, south: 0, east: 0.14, north: 0 }
    assert.ok(boundsMaxDimMeters(under) <= PREVIEW_BUDGET.hardRangeMaxDimMeters)
    assert.equal(isBeyondHardRange(under), false)
    assert.ok(boundsMaxDimMeters(over) > PREVIEW_BUDGET.hardRangeMaxDimMeters)
    assert.equal(isBeyondHardRange(over), true)
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

describe('createFpsGuard', () => {
  it('高FPSが続けば発報しない', () => {
    const results = pushFrames(createFpsGuard(), 0, 300, 16)
    assert.equal(results.some(Boolean), false)
  })

  it('低FPSが2窓連続した瞬間だけ発報する', () => {
    const results = pushFrames(createFpsGuard(), 0, 41, 100) // 0..4000ms
    const firedAt = results.flatMap((fired, i) => (fired ? [i] : []))
    assert.deepEqual(firedAt, [40])
  })

  it('単発の低下では発報しない', () => {
    const guard = createFpsGuard()
    const low = pushFrames(guard, 0, 21, 100) // 最初の1窓だけ低FPS
    const high = pushFrames(guard, 2020, 100, 20) // 次の窓は高FPS
    assert.equal([...low, ...high].some(Boolean), false)
  })

  it('アイドルギャップで連続カウントをリセットする', () => {
    const guard = createFpsGuard()
    assert.equal(pushFrames(guard, 0, 21, 100).some(Boolean), false) // streak 1
    assert.equal(pushFrames(guard, 5000, 21, 100).some(Boolean), false) // ギャップ後 streak 1
    assert.equal(pushFrames(guard, 7100, 20, 100).some(Boolean), true) // streak 2 で発報
  })

  it('reset で状態をクリアする', () => {
    const guard = createFpsGuard()
    assert.equal(pushFrames(guard, 0, 21, 100).some(Boolean), false)
    guard.reset()
    assert.equal(pushFrames(guard, 0, 21, 100).some(Boolean), false)
    assert.equal(pushFrames(guard, 2100, 20, 100).some(Boolean), true)
  })
})

describe('estimatePreviewLoad (mocked fetch)', () => {
  beforeEach(() => {
    clearPreviewBudgetCache()
  })

  it('単一タイルセットの建物数を集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    // 1回目は建物数、2回目は三角形数サンプリング
    assert.equal(calls.get('https://x/tokyo.b3dm'), 2)
    assert.equal(calls.get('https://x/osaka.b3dm'), undefined)
  })

  it('相対URLをベースURL基準で解決する', async () => {
    const url = 'https://host/area/tileset.json'
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    // 1回目は建物数、2回目は三角形数サンプリング
    assert.equal(calls.get('https://host/shared/b.b3dm'), 2)
  })

  it('content.uri形式のタイルを集計する', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {
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
    const routes: Record<string, (init?: RequestInit) => Response> = {}
    for (let i = 0; i < count; i++) {
      const name = `t${i}.b3dm`
      children.push(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], name))
      routes[`https://x/${name}`] = () =>
        resp(206, makeB3dm(PREVIEW_BUDGET.hardBuildings + 1), {
          'Content-Range': 'bytes 0-16383/100',
        })
    }
    routes[url] = () => resp(200, JSON.stringify(tileset(tile(null, null, children))))
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    const probed = [...calls.keys()].filter((u) => u.endsWith('.b3dm')).length
    assert.ok(probed < count)
    assert.equal(est.totalBuildings, PREVIEW_BUDGET.hardBuildings + 1)
    assert.equal(est.mode, 'terrain-only')
    assert.equal(est.reason, 'too-large')
  })

  it('三角形数をサンプリングして建物数から外挿する', async () => {
    const url = 'https://x/tileset.json'
    const count = 4
    const children: unknown[] = []
    const routes: Record<string, (init?: RequestInit) => Response> = {}
    for (let i = 0; i < count; i++) {
      const name = `s${i}.b3dm`
      children.push(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], name))
      const buf = makeB3dmWithGlb(10, { vertices: 300, triangles: 100 })
      routes[`https://x/${name}`] = (init) => ranged(buf, init)
    }
    routes[url] = () => resp(200, JSON.stringify(tileset(tile(null, null, children))))
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 40)
    // 10建物あたり100三角形 → 40建物で400三角形
    assert.equal(est.estimatedTriangles, 400)
    assert.equal(est.overWarnBudget, false)
    assert.equal(est.mode, 'buildings')
  })

  it('推定三角形数がハード上限を超えたら too-large で打ち切る', async () => {
    const url = 'https://x/tileset.json'
    const count = 10
    const children: unknown[] = []
    const routes: Record<string, (init?: RequestInit) => Response> = {}
    for (let i = 0; i < count; i++) {
      const name = `h${i}.b3dm`
      children.push(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], name))
      const buf = makeB3dmWithGlb(1, { vertices: 300, triangles: 20_000_000 })
      routes[`https://x/${name}`] = (init) => ranged(buf, init)
    }
    routes[url] = () => resp(200, JSON.stringify(tileset(tile(null, null, children))))
    const { fetch, calls } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    const probed = [...calls.keys()].filter((u) => u.endsWith('.b3dm')).length
    assert.ok(probed < count * 2)
    assert.equal(est.estimatedTriangles, 20_000_000)
    assert.equal(est.mode, 'terrain-only')
    assert.equal(est.reason, 'too-large')
    assert.equal(est.capped, true)
  })

  it('警告閾値超えでも overWarnBudget を立てるだけで buildings のまま', async () => {
    const url = 'https://x/tileset.json'
    const routes: Record<string, (init?: RequestInit) => Response> = {
      [url]: () =>
        resp(
          200,
          JSON.stringify(tileset(tile([rad(139.0), rad(35.0), rad(140.0), rad(36.0)], 'w.b3dm'))),
        ),
      'https://x/w.b3dm': () => resp(206, makeB3dm(3000), { 'Content-Range': 'bytes 0-16383/100' }),
    }
    const { fetch } = mockFetch(routes)
    const est = await estimatePreviewLoad({ bounds: B, lod: 'lod2', tilesetUrls: [url], fetch })
    assert.equal(est.totalBuildings, 3000)
    assert.equal(est.overWarnBudget, true)
    assert.equal(est.mode, 'buildings')
    assert.equal(est.reason, 'ok')
  })
})
