import type { Lod } from './catalogApi'

export type { Lod }

/** 中心的なプレビュー予算の制限値。Preview3D の建物読み込み可否判定に使う。 */
export const PREVIEW_BUDGET = {
  maxIntersectingTiles: 1500,
  maxBuildings: 200,
  maxContentBytes: 256 * 1024 * 1024, // 256 MiB
  scanNodeCap: 6000,
  probeRangeBytes: 16384, // bytes=0..16383
  probeConcurrency: 8,
  fetchTimeoutMs: 15000,
} as const

export type PreviewMode = 'buildings' | 'terrain-only' | 'no-data'
export type PreviewReason = 'ok' | 'no-data' | 'too-large'

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export interface PreviewMuniResult {
  url: string
  name: string
  contentTiles: number
  intersectingTiles: number
  totalBuildings: number
  totalContentBytes: number
  capped: boolean
}

export interface PreviewLoadEstimate {
  mode: PreviewMode
  reason: PreviewReason
  intersectingTiles: number
  contentTiles: number
  totalBuildings: number
  totalContentBytes: number
  maxIntersectingTiles: number
  maxBuildings: number
  maxContentBytes: number
  capped: boolean
  municipalities: PreviewMuniResult[]
}

export interface PreviewModeDecision {
  mode: PreviewMode
  reason: PreviewReason
}

export interface EstimateInput {
  bounds: Bounds
  lod: Lod
  tilesetUrls: string[]
  fetch?: typeof fetch
  signal?: AbortSignal
}

interface TileNode {
  boundingVolume?: { region?: number[] }
  content?: { url?: string; uri?: string }
  children?: TileNode[]
}

interface TilesetJson {
  root?: TileNode
}

interface MuniStat {
  url: string
  name: string
  contentTiles: number
  intersectingTiles: number
  totalBuildings: number
  totalContentBytes: number
  capped: boolean
}

interface EstimateCtx {
  bounds: Bounds
  fetchImpl: typeof fetch
  signal?: AbortSignal
  scanNodeCap: number
  probeRangeBytes: number
  fetchTimeoutMs: number
  pool: Pool
  nodeCount: number
  intersectingTiles: number
  contentTiles: number
  totalBuildings: number
  totalContentBytes: number
  capped: boolean
  failures: number
  visitedTilesets: Set<string>
  visitedContent: Set<string>
}

/** 有限並列度で非同期タスクを流す最小プール。 */
class Pool {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.waiters.shift()
      if (next) next()
    }
  }
}

interface SignalHandle {
  signal: AbortSignal
  dispose: () => void
}

function withTimeoutAndSignal(signal: AbortSignal | undefined, timeoutMs: number): SignalHandle {
  const ctrl = new AbortController()
  const onExtAbort = (): void => ctrl.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs)
  }
  if (signal) {
    if (signal.aborted) {
      ctrl.abort()
    } else {
      signal.addEventListener('abort', onExtAbort, { once: true })
    }
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      if (timer) clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onExtAbort)
    },
  }
}

function resolveUrl(baseUrl: string, ref: string): string {
  try {
    return new URL(ref, baseUrl).href
  } catch {
    return ref
  }
}

function isTilesetUrl(url: string): boolean {
  return url.split('?')[0].toLowerCase().endsWith('.json')
}

const RAD2DEG = 180 / Math.PI

/** boundingVolume.region（ラジアン）の west/south/east/north を度に変換して返す。 */
function tileRegion(node: TileNode): [number, number, number, number] | null {
  const region = node.boundingVolume?.region
  if (Array.isArray(region) && region.length >= 4) {
    return [
      region[0] * RAD2DEG,
      region[1] * RAD2DEG,
      region[2] * RAD2DEG,
      region[3] * RAD2DEG,
    ]
  }
  return null
}

/** bounds（度）とタイルの region（度に変換済み）が交差するか。 */
function regionsIntersect(
  region: [number, number, number, number],
  bounds: Bounds
): boolean {
  const [w, s, e, n] = region
  if (e < bounds.west) return false
  if (w > bounds.east) return false
  if (n < bounds.south) return false
  if (s > bounds.north) return false
  return true
}

function parseContentRangeTotal(contentRange: string): number | null {
  const m = /\/\s*(\d+)\s*$/.exec(contentRange)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * b3dm ヘッダ（28バイト）の feature table JSON（オフセット12のバイト長）から
 * BATCH_LENGTH を読み取る。判別できない場合は 0 を返す。
 */
export function readB3dmBatchLength(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 28) return 0
  const view = new DataView(buffer)
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  )
  if (magic !== 'b3dm') return 0
  const ftJsonLen = view.getUint32(12, true)
  if (ftJsonLen === 0) return 0
  const available = Math.min(ftJsonLen, buffer.byteLength - 28)
  if (available <= 0) return 0
  const bytes = new Uint8Array(buffer, 28, available)
  try {
    const text = new TextDecoder().decode(bytes).replace(/\0/g, '')
    const ft = JSON.parse(text) as Record<string, unknown>
    const v = ft.BATCH_LENGTH
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

async function fetchJson(url: string, ctx: EstimateCtx): Promise<TilesetJson | null> {
  const handle = withTimeoutAndSignal(ctx.signal, ctx.fetchTimeoutMs)
  try {
    const res = await ctx.fetchImpl(url, { signal: handle.signal })
    if (!res.ok) return null
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null) return null
    return data as TilesetJson
  } catch {
    return null
  } finally {
    handle.dispose()
  }
}

async function readProbeBytes(response: Response, limit: number): Promise<ArrayBuffer> {
  if (!response.body) return response.arrayBuffer()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < limit) {
      const part = await reader.read()
      if (part.done) break
      const remaining = limit - total
      const chunk = part.value.byteLength <= remaining ? part.value : part.value.slice(0, remaining)
      chunks.push(chunk)
      total += chunk.byteLength
      if (chunk.byteLength < part.value.byteLength) break
    }
  } finally {
    await reader.cancel()
  }
  const buffer = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer.buffer
}

async function probeContent(url: string, ctx: EstimateCtx, stat: MuniStat): Promise<void> {
  if (ctx.visitedContent.has(url)) return
  ctx.visitedContent.add(url)
  await ctx.pool.run(async () => {
    const handle = withTimeoutAndSignal(ctx.signal, ctx.fetchTimeoutMs)
    try {
      const res = await ctx.fetchImpl(url, {
        signal: handle.signal,
        headers: { Range: `bytes=0-${ctx.probeRangeBytes - 1}` },
      })
      if (!res.ok) {
        ctx.failures++
        return
      }
      const contentRange = res.headers.get('content-range')
      const totalFromRange = contentRange ? parseContentRangeTotal(contentRange) : null
      const buf = await readProbeBytes(res, ctx.probeRangeBytes)
      if (res.status === 200) ctx.capped = true
      const batch = readB3dmBatchLength(buf)
      if (batch > 0) {
        ctx.totalBuildings += batch
        stat.totalBuildings += batch
      }
      const bytes = totalFromRange ?? buf.byteLength
      ctx.totalContentBytes += bytes
      stat.totalContentBytes += bytes
    } catch {
      ctx.failures++
    } finally {
      handle.dispose()
    }
  })
}

async function walkTileset(url: string, ctx: EstimateCtx, stat: MuniStat): Promise<void> {
  if (ctx.visitedTilesets.has(url)) return
  ctx.visitedTilesets.add(url)

  const json = await fetchJson(url, ctx)
  if (!json) {
    ctx.failures++
    return
  }
  const root = json.root
  if (!root) return

  const queue: TileNode[] = [root]
  while (queue.length > 0) {
    if (ctx.capped || ctx.signal?.aborted) return
    if (ctx.nodeCount >= ctx.scanNodeCap) {
      ctx.capped = true
      return
    }
    const node = queue.shift()!
    ctx.nodeCount++

    const region = tileRegion(node)
    if (region && !regionsIntersect(region, ctx.bounds)) continue
    ctx.intersectingTiles++
    stat.intersectingTiles++

    const contentUrl = node.content?.url ?? node.content?.uri
    if (contentUrl) {
      const resolved = resolveUrl(url, contentUrl)
      if (isTilesetUrl(resolved)) {
        await walkTileset(resolved, ctx, stat)
      } else {
        ctx.contentTiles++
        stat.contentTiles++
        await probeContent(resolved, ctx, stat)
      }
    }

    const children = node.children
    if (Array.isArray(children)) {
      for (const child of children) queue.push(child)
    }
  }
}

export function classifyPreviewLoad(
  est: Pick<
    PreviewLoadEstimate,
    'intersectingTiles' | 'contentTiles' | 'totalBuildings' | 'totalContentBytes' | 'capped'
  >
): PreviewModeDecision {
  const tooLarge =
    est.capped ||
    est.intersectingTiles > PREVIEW_BUDGET.maxIntersectingTiles ||
    est.totalBuildings > PREVIEW_BUDGET.maxBuildings ||
    est.totalContentBytes > PREVIEW_BUDGET.maxContentBytes
  if (tooLarge) return { mode: 'terrain-only', reason: 'too-large' }
  if (est.contentTiles === 0 && est.totalBuildings === 0 && est.totalContentBytes === 0) {
    return { mode: 'terrain-only', reason: 'no-data' }
  }
  return { mode: 'buildings', reason: 'ok' }
}

function nameFromUrl(url: string): string {
  const clean = url.split('?')[0].split('#')[0]
  const seg = clean.split('/').filter(Boolean).pop()
  return (seg ?? url).replace(/\.json$/i, '')
}

async function doEstimate(input: EstimateInput): Promise<PreviewLoadEstimate> {
  const ctx: EstimateCtx = {
    bounds: input.bounds,
    fetchImpl: input.fetch ?? globalThis.fetch.bind(globalThis),
    signal: input.signal,
    scanNodeCap: PREVIEW_BUDGET.scanNodeCap,
    probeRangeBytes: PREVIEW_BUDGET.probeRangeBytes,
    fetchTimeoutMs: PREVIEW_BUDGET.fetchTimeoutMs,
    pool: new Pool(PREVIEW_BUDGET.probeConcurrency),
    nodeCount: 0,
    intersectingTiles: 0,
    contentTiles: 0,
    totalBuildings: 0,
    totalContentBytes: 0,
    capped: false,
    failures: 0,
    visitedTilesets: new Set(),
    visitedContent: new Set(),
  }

  const municipalities: PreviewMuniResult[] = []
  for (const url of input.tilesetUrls) {
    const stat: MuniStat = {
      url,
      name: nameFromUrl(url),
      contentTiles: 0,
      intersectingTiles: 0,
      totalBuildings: 0,
      totalContentBytes: 0,
      capped: false,
    }
    await walkTileset(url, ctx, stat)
    if (ctx.capped) stat.capped = true
    municipalities.push(stat)
  }

  const base = {
    intersectingTiles: ctx.intersectingTiles,
    contentTiles: ctx.contentTiles,
    totalBuildings: ctx.totalBuildings,
    totalContentBytes: ctx.totalContentBytes,
    capped: ctx.capped,
  }
  const decision = classifyPreviewLoad(base)
  return {
    ...base,
    mode: decision.mode,
    reason: decision.reason,
    maxIntersectingTiles: PREVIEW_BUDGET.maxIntersectingTiles,
    maxBuildings: PREVIEW_BUDGET.maxBuildings,
    maxContentBytes: PREVIEW_BUDGET.maxContentBytes,
    municipalities,
  }
}

const estimateCache = new Map<string, Promise<PreviewLoadEstimate>>()

function cacheKey(bounds: Bounds, lod: Lod, urls: string[]): string {
  const f = (n: number): string => Number(n).toFixed(6)
  const b = `${f(bounds.west)},${f(bounds.south)},${f(bounds.east)},${f(bounds.north)}`
  return `${b}|${lod}|${urls.join(',')}`
}

export function clearPreviewBudgetCache(): void {
  estimateCache.clear()
}

export async function estimatePreviewLoad(input: EstimateInput): Promise<PreviewLoadEstimate> {
  const key = cacheKey(input.bounds, input.lod, input.tilesetUrls)
  const cached = estimateCache.get(key)
  if (cached) return cached
  const task = doEstimate(input)
  estimateCache.set(key, task)
  try {
    return await task
  } catch (err) {
    estimateCache.delete(key)
    throw err
  }
}

/**
 * 選択範囲の最大寸法（m）に応じた地形グリッド分割数。
 * 範囲が大きいほど分割を減らしてレンダリング負荷を抑える。
 */
export function adaptiveTerrainGridSize(maxDimMeters: number): number {
  if (maxDimMeters <= 5000) return 128
  if (maxDimMeters <= 10000) return 96
  return 64
}

/** 選択範囲の最大寸法（m）に応じたカメラの最大ズーム距離（m）。 */
export function previewMaxZoomDistance(maxDimMeters: number): number {
  return Math.max(10000, maxDimMeters * 2.5)
}
