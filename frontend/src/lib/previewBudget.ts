import type { Lod } from './catalogApi'

export type { Lod }

/** 中心的なプレビュー予算の制限値。Preview3D の建物読み込み可否判定に使う。 */
export const PREVIEW_BUDGET = {
  // 警告閾値（旧値をそのまま改名。超えたら警告表示しつつ建物は読み込む）
  warnIntersectingTiles: 1500,
  warnBuildings: 2500,
  warnContentBytes: 256 * 1024 * 1024, // 256 MiB
  warnTriangles: 2_000_000,
  smallRangeMaxDimMeters: 750,
  largeRangeMaxDimMeters: 5000,
  // ハード上限（超えたら地形のみ表示）
  hardIntersectingTiles: 12_000,
  hardBuildings: 100_000,
  hardContentBytes: 1024 * 1024 * 1024, // 1 GiB
  hardTriangles: 15_000_000,
  hardRangeMaxDimMeters: 15_000,
  // スキャン/プローブ
  scanNodeCap: 100_000,
  probeRangeBytes: 256,
  glbProbeBytes: 4096,
  triangleProbeSampleCap: 32,
  probeConcurrency: 8,
  fetchTimeoutMs: 15000,
} as const

/** 実行時（ロード後）負荷ガードの閾値。Preview3D から使用する。 */
export const RUNTIME_LOAD_LIMITS = {
  trianglesSelected: 8_000_000,
  totalMemoryBytes: 1536 * 1024 * 1024,
  commands: 2000,
  fpsLow: 20,
  windowMs: 2000,
  gapResetMs: 1200,
  consecutiveWindows: 2,
  settleMs: 5000,
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
  estimatedTriangles: number | null
  overWarnBudget: boolean
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
  exceededBudget: boolean
  failures: number
  sampledTriangles: number
  sampledBuildings: number
  triangleProbes: number
  estimatedTriangles: number | null
  overWarnBudget: boolean
  visitedTilesets: Set<string>
  visitedContent: Set<string>
}

/** ハード上限（交差タイル数・建物数・コンテンツ量・推定三角形数）を超えたか。 */
function overBudget(ctx: EstimateCtx): boolean {
  return (
    ctx.intersectingTiles > PREVIEW_BUDGET.hardIntersectingTiles ||
    ctx.totalBuildings > PREVIEW_BUDGET.hardBuildings ||
    ctx.totalContentBytes > PREVIEW_BUDGET.hardContentBytes ||
    (ctx.estimatedTriangles !== null && ctx.estimatedTriangles > PREVIEW_BUDGET.hardTriangles)
  )
}

/** 警告閾値を超えたらフラグを立てる（走査は継続する）。 */
function noteWarnBudget(ctx: EstimateCtx): void {
  if (ctx.overWarnBudget) return
  ctx.overWarnBudget =
    ctx.intersectingTiles > PREVIEW_BUDGET.warnIntersectingTiles ||
    ctx.totalBuildings > PREVIEW_BUDGET.warnBuildings ||
    ctx.totalContentBytes > PREVIEW_BUDGET.warnContentBytes ||
    (ctx.estimatedTriangles !== null && ctx.estimatedTriangles > PREVIEW_BUDGET.warnTriangles)
}

/** ハード上限超過なら走査・プローブの打ち切りフラグを立てる。 */
function markOverBudget(ctx: EstimateCtx): boolean {
  if (!overBudget(ctx)) return false
  ctx.exceededBudget = true
  ctx.capped = true
  return true
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
    return [region[0] * RAD2DEG, region[1] * RAD2DEG, region[2] * RAD2DEG, region[3] * RAD2DEG]
  }
  return null
}

/** bounds（度）とタイルの region（度に変換済み）が交差するか。 */
function regionsIntersect(region: [number, number, number, number], bounds: Bounds): boolean {
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

export interface B3dmInfo {
  batchLength: number
  /** b3dmヘッダから算出したglb先頭オフセット（バッファ長が足りなくても返す） */
  glbOffset: number
}

/** b3dmヘッダ(28B)から BATCH_LENGTH と glbOffset を読む。不正・非b3dmは null。 */
export function readB3dmInfo(buffer: ArrayBuffer): B3dmInfo | null {
  if (buffer.byteLength < 28) return null
  const view = new DataView(buffer)
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  )
  if (magic !== 'b3dm') return null
  if (view.getUint32(4, true) !== 1) return null
  const ftJsonLen = view.getUint32(12, true)
  const ftBinLen = view.getUint32(16, true)
  const btJsonLen = view.getUint32(20, true)
  const btBinLen = view.getUint32(24, true)
  const glbOffset = 28 + ftJsonLen + ftBinLen + btJsonLen + btBinLen
  if (ftJsonLen === 0 || 28 + ftJsonLen > buffer.byteLength) {
    return { batchLength: 0, glbOffset }
  }
  try {
    const bytes = new Uint8Array(buffer, 28, ftJsonLen)
    const text = new TextDecoder().decode(bytes).replace(/\0/g, '')
    const ft = JSON.parse(text) as Record<string, unknown>
    const v = ft.BATCH_LENGTH
    const batchLength = typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
    return { batchLength, glbOffset }
  } catch {
    return { batchLength: 0, glbOffset }
  }
}

const GLB_MAGIC = 0x46546c67 // 'glTF'
const GLB_CHUNK_JSON = 0x4e4f534a // 'JSON'

interface GltfAccessor {
  count?: number
}

interface GltfPrimitive {
  attributes?: Record<string, number>
  indices?: number
  mode?: number
}

interface GltfJson {
  accessors?: GltfAccessor[]
  meshes?: Array<{ primitives?: GltfPrimitive[] }>
}

/** glbのJSONチャンクから 三角形数・頂点数 を合算する。パース不能は null。 */
export function readGltfTriangleCount(
  glb: ArrayBuffer,
): { triangles: number; vertices: number } | null {
  try {
    if (glb.byteLength < 20) return null
    const view = new DataView(glb)
    if (view.getUint32(0, true) !== GLB_MAGIC) return null
    const chunkLen = view.getUint32(12, true)
    if (view.getUint32(16, true) !== GLB_CHUNK_JSON) return null
    if (20 + chunkLen > glb.byteLength) return null
    const bytes = new Uint8Array(glb, 20, chunkLen)
    const json = JSON.parse(new TextDecoder().decode(bytes).replace(/\0/g, '')) as GltfJson
    const accessors = json.accessors ?? []
    let triangles = 0
    let vertices = 0
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const posIdx = prim.attributes?.POSITION
        const pos = typeof posIdx === 'number' ? accessors[posIdx] : undefined
        const posCount =
          typeof pos?.count === 'number' && Number.isFinite(pos.count) ? pos.count : 0
        if (posCount > 0) vertices += posCount
        if (prim.mode !== undefined && prim.mode !== 4) continue
        if (typeof prim.indices === 'number') {
          const idx = accessors[prim.indices]
          if (typeof idx?.count === 'number' && Number.isFinite(idx.count)) {
            triangles += Math.floor(idx.count / 3)
          }
        } else if (posCount > 0) {
          triangles += Math.floor(posCount / 3)
        }
      }
    }
    return { triangles, vertices }
  } catch {
    return null
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
      const info = readB3dmInfo(buf)
      const batchLength = info?.batchLength ?? 0
      if (batchLength > 0) {
        ctx.totalBuildings += batchLength
        stat.totalBuildings += batchLength
      }
      const bytes = totalFromRange ?? buf.byteLength
      ctx.totalContentBytes += bytes
      stat.totalContentBytes += bytes

      if (info && batchLength > 0 && ctx.triangleProbes < PREVIEW_BUDGET.triangleProbeSampleCap) {
        ctx.triangleProbes++
        try {
          const res2 = await ctx.fetchImpl(url, {
            signal: handle.signal,
            headers: {
              Range: `bytes=${info.glbOffset}-${info.glbOffset + PREVIEW_BUDGET.glbProbeBytes - 1}`,
            },
          })
          if (res2.ok) {
            const glb = await readProbeBytes(res2, PREVIEW_BUDGET.glbProbeBytes)
            const tri = readGltfTriangleCount(glb)
            if (tri && tri.triangles > 0) {
              ctx.sampledTriangles += tri.triangles
              ctx.sampledBuildings += batchLength
            }
          }
        } catch {
          // 2本目の失敗はサンプリング不足として握りつぶす
        }
      }

      if (ctx.sampledBuildings > 0) {
        ctx.estimatedTriangles = Math.round(
          (ctx.totalBuildings * ctx.sampledTriangles) / ctx.sampledBuildings,
        )
      }
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
  while (queue.length > 0 && !ctx.exceededBudget) {
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
    noteWarnBudget(ctx)
    if (markOverBudget(ctx)) return

    const contentUrl = node.content?.url ?? node.content?.uri
    if (contentUrl) {
      const resolved = resolveUrl(url, contentUrl)
      if (isTilesetUrl(resolved)) {
        await walkTileset(resolved, ctx, stat)
      } else {
        ctx.contentTiles++
        stat.contentTiles++
        await probeContent(resolved, ctx, stat)
        noteWarnBudget(ctx)
        if (markOverBudget(ctx)) return
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
  > & { estimatedTriangles?: number | null },
): PreviewModeDecision {
  const triangles = est.estimatedTriangles ?? 0
  const tooLarge =
    est.capped ||
    est.intersectingTiles > PREVIEW_BUDGET.hardIntersectingTiles ||
    est.totalBuildings > PREVIEW_BUDGET.hardBuildings ||
    est.totalContentBytes > PREVIEW_BUDGET.hardContentBytes ||
    triangles > PREVIEW_BUDGET.hardTriangles
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
    exceededBudget: false,
    failures: 0,
    sampledTriangles: 0,
    sampledBuildings: 0,
    triangleProbes: 0,
    estimatedTriangles: null,
    overWarnBudget: false,
    visitedTilesets: new Set(),
    visitedContent: new Set(),
  }

  const municipalities: PreviewMuniResult[] = []
  for (const url of input.tilesetUrls) {
    if (ctx.capped || ctx.exceededBudget) break
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
  const decision = classifyPreviewLoad({ ...base, estimatedTriangles: ctx.estimatedTriangles })
  return {
    ...base,
    mode: decision.mode,
    reason: decision.reason,
    maxIntersectingTiles: PREVIEW_BUDGET.hardIntersectingTiles,
    maxBuildings: PREVIEW_BUDGET.hardBuildings,
    maxContentBytes: PREVIEW_BUDGET.hardContentBytes,
    estimatedTriangles: ctx.estimatedTriangles,
    overWarnBudget: ctx.overWarnBudget,
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
  if (maxDimMeters <= 10000) return 64
  if (maxDimMeters <= 20000) return 48
  return 32
}

/** 地形メッシュ解像度のプリセット（分割数）。 */
export const TERRAIN_GRID_PRESETS = [
  { value: 32, label: '低' },
  { value: 64, label: '中' },
  { value: 128, label: '高' },
  { value: 256, label: '最高' },
] as const

/**
 * 明示指定があればそれを、無ければ範囲最大寸法から自動決定した分割数を返す。
 */
export function resolveTerrainGridSize(
  explicit: number | null | undefined,
  maxDimMeters: number,
): number {
  if (explicit == null) return adaptiveTerrainGridSize(maxDimMeters)
  return Math.max(32, Math.min(256, Math.round(explicit)))
}

/**
 * spanDeg（度）に応じた地形タイルのレベルを選ぶ。
 * スパンが広いほど低レベル（粗い）になる。
 */
export function pickTerrainLevel(spanDeg: number, minLevel: number, maxLevel: number): number {
  if (!Number.isFinite(spanDeg) || spanDeg <= 0) return minLevel
  const raw = Math.round(Math.log2((180 * 8) / spanDeg))
  return Math.max(minLevel, Math.min(maxLevel, raw))
}

/** 選択範囲の最大寸法（m）に応じたカメラの最大ズーム距離（m）。 */
export function previewMaxZoomDistance(maxDimMeters: number): number {
  return Math.max(10000, maxDimMeters * 2.5)
}

export function boundsMaxDimMeters(bounds: Bounds): number {
  const midLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180)
  const width = (bounds.east - bounds.west) * (Math.PI / 180) * 6371000 * Math.cos(midLat)
  const height = (bounds.north - bounds.south) * (Math.PI / 180) * 6371000
  return Math.max(Math.abs(width), Math.abs(height))
}

export function isSmallRange(bounds: Bounds): boolean {
  return boundsMaxDimMeters(bounds) <= PREVIEW_BUDGET.smallRangeMaxDimMeters
}

export function isLargeRange(bounds: Bounds): boolean {
  return boundsMaxDimMeters(bounds) > PREVIEW_BUDGET.largeRangeMaxDimMeters
}

/** 最大辺が hardRangeMaxDimMeters を超える（地形のみ＋地形最高解像度の対象） */
export function isBeyondHardRange(bounds: Bounds): boolean {
  return boundsMaxDimMeters(bounds) > PREVIEW_BUDGET.hardRangeMaxDimMeters
}

export interface FpsGuardThresholds {
  fpsLow: number
  windowMs: number
  gapResetMs: number
  consecutiveWindows: number
}

export interface FpsGuard {
  /** フレーム時刻(ms)を投入。低FPSが連続閾値に達した瞬間だけ true を返す。 */
  push(timestampMs: number): boolean
  reset(): void
}

export function createFpsGuard(thresholds?: Partial<FpsGuardThresholds>): FpsGuard {
  const cfg: FpsGuardThresholds = {
    fpsLow: RUNTIME_LOAD_LIMITS.fpsLow,
    windowMs: RUNTIME_LOAD_LIMITS.windowMs,
    gapResetMs: RUNTIME_LOAD_LIMITS.gapResetMs,
    consecutiveWindows: RUNTIME_LOAD_LIMITS.consecutiveWindows,
    ...thresholds,
  }
  let lastTs: number | null = null
  let windowStart: number | null = null
  let frames = 0
  let lowStreak = 0

  return {
    push(timestampMs: number): boolean {
      if (lastTs !== null && timestampMs - lastTs > cfg.gapResetMs) {
        windowStart = null
        frames = 0
        lowStreak = 0
      }
      if (windowStart === null) {
        windowStart = timestampMs
        frames = 0
      }
      frames++
      let fired = false
      const elapsed = timestampMs - windowStart
      if (elapsed >= cfg.windowMs) {
        const fps = frames / (elapsed / 1000)
        if (fps < cfg.fpsLow) {
          lowStreak++
          if (lowStreak >= cfg.consecutiveWindows) {
            fired = true
            lowStreak = 0
          }
        } else {
          lowStreak = 0
        }
        windowStart = timestampMs
        frames = 0
      }
      lastTs = timestampMs
      return fired
    },
    reset(): void {
      lastTs = null
      windowStart = null
      frames = 0
      lowStreak = 0
    },
  }
}
