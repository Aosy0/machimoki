import { Cartesian3, ShadowMode, Transforms } from 'cesium'
import type { Primitive } from 'cesium'
import type { Bounds, RawMesh } from '@machimoki/core'
import { buildEngineMeshPrimitive } from './engineMeshPrimitive'
import type {
  HollowBuildingsWorkerRequest,
  HollowBuildingsWorkerResponse,
} from '../workers/hollowBuildings.worker.ts'

export interface HollowBuildingPrimitiveParams {
  bounds: Bounds
  /** 中空シェルのキャッシュキー（建物取得条件＋壁厚＋包含設定）。 */
  cacheKey: string
  /** 取得済みの建物メッシュ（共有キャッシュ loadBuildingMeshes の結果）。 */
  buildingMeshes: RawMesh[]
  includeSpanningBuildings: boolean
  /** シェル厚み（実スケールのメートル）。Preview3D の effectiveShellThickness を渡す。 */
  wallThickness: number
  buildingColor: string
  onProgress?: (message: string) => void
}

interface PendingBuild {
  resolve: (mesh: RawMesh | null) => void
  reject: (error: Error) => void
  onProgress?: (message: string) => void
}

// 中空化は重いので Worker で実行する。WASM 初期化を再利用するため常駐させる。
let worker: Worker | null = null
let requestSeq = 0
const pending = new Map<number, PendingBuild>()
// 同じ条件の再切替で再生成しないための小さな LRU（最新3件）。
const MAX_CACHE_ENTRIES = 3
const shellCache = new Map<string, Promise<RawMesh | null>>()

function disposeWorker(reason: string): void {
  const current = worker
  worker = null
  current?.terminate()
  const error = new Error(reason)
  for (const p of pending.values()) p.reject(error)
  pending.clear()
}

/** アンマウント時に Worker を終了する。 */
export function terminateHollowBuildingsWorker(): void {
  disposeWorker('中空化 Worker を終了しました')
}

function handleMessage(event: MessageEvent<HollowBuildingsWorkerResponse>): void {
  const msg = event.data
  const p = pending.get(msg.requestId)
  if (!p) return
  if (msg.type === 'progress') {
    p.onProgress?.(msg.message)
    return
  }
  pending.delete(msg.requestId)
  if (msg.type === 'done') {
    p.resolve(msg.mesh)
    return
  }
  // 生成エラー時は Worker を作り直す（安全側）。
  p.reject(new Error(msg.message))
  disposeWorker('中空化 Worker を再作成しました')
}

function getWorker(): Worker {
  if (worker) return worker
  const next = new Worker(new URL('../workers/hollowBuildings.worker.ts', import.meta.url), {
    type: 'module',
  })
  next.onmessage = handleMessage
  next.onerror = () => {
    disposeWorker('中空化 Worker でエラーが発生しました')
  }
  worker = next
  return next
}

/** 中空シェルを Worker で生成する（同じキーはキャッシュを再利用）。 */
function loadHollowShellMesh(params: HollowBuildingPrimitiveParams): Promise<RawMesh | null> {
  const cached = shellCache.get(params.cacheKey)
  if (cached) return cached
  const requestId = ++requestSeq
  const promise = new Promise<RawMesh | null>((resolve, reject) => {
    const activeWorker = getWorker()
    pending.set(requestId, { resolve, reject, onProgress: params.onProgress })
    const request: HollowBuildingsWorkerRequest = {
      type: 'build',
      requestId,
      buildingMeshes: params.buildingMeshes,
      bounds: params.bounds,
      wallThickness: params.wallThickness,
      includeSpanningBuildings: params.includeSpanningBuildings,
    }
    try {
      activeWorker.postMessage(request)
    } catch (error) {
      pending.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
      disposeWorker('中空化 Worker への送信に失敗しました')
    }
  }).catch((error) => {
    // 失敗した結果はキャッシュから除去する（次回再試行可能に）。
    shellCache.delete(params.cacheKey)
    throw error
  })
  shellCache.set(params.cacheKey, promise)
  while (shellCache.size > MAX_CACHE_ENTRIES) {
    const oldest = shellCache.keys().next().value
    if (oldest === undefined || oldest === params.cacheKey) break
    shellCache.delete(oldest)
  }
  return promise
}

/**
 * 建物メッシュ群をエクスポートと同一の侵食処理で中空化し、
 * 1つの Primitive にまとめて返す。空なら null。
 *
 * 中空化（WASM）は Worker で行い、メインスレッドをブロックしない。
 * 建物メッシュは呼び出し側で共有キャッシュから取得して渡す。
 */
export async function buildHollowBuildingPrimitive(
  params: HollowBuildingPrimitiveParams,
): Promise<Primitive | null> {
  const { bounds, wallThickness, buildingColor } = params
  if (!(wallThickness > 0) || !Number.isFinite(wallThickness)) return null
  if (params.buildingMeshes.length === 0) return null

  const mesh = await loadHollowShellMesh(params)
  if (!mesh || mesh.positions.length === 0 || mesh.indices.length === 0) return null

  const centerMatrix = Transforms.eastNorthUpToFixedFrame(
    Cartesian3.fromDegrees((bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2, 0),
  )
  return buildEngineMeshPrimitive(mesh, {
    centerMatrix,
    positionScale: 1,
    color: buildingColor,
    // 薄い中空シェルは自己シャドウ（アクネ）で壁面がまだらに暗くなるため、
    // 地形へ影を落とす CAST_ONLY にする（受影しない）。
    shadows: ShadowMode.CAST_ONLY,
    // 元の3D Tiles（フラットな面法線）と見た目を揃える。
    // スムーズ法線だと壁面中央に強いハイライトが出て別物に見える。
    flat: true,
  })
}
