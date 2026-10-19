import type { Bounds, ExportOptions, RawMesh } from '@machimoki/core'
import type {
  FinalShapeWorkerDataset,
  FinalShapeWorkerRequest,
  FinalShapeWorkerResponse,
} from '../workers/finalShape.worker.ts'

export interface FinalShapeResult {
  mesh: RawMesh
  warnings: string[]
}

/** Worker に送る入力データセット。key が変わったときだけメッシュを送信する。 */
export interface FinalShapeDataset extends FinalShapeWorkerDataset {
  key: string
}

interface PendingBuild {
  resolve: (result: FinalShapeResult) => void
  reject: (error: Error) => void
  onProgress?: (message: string) => void
}

// Worker は使い捨てず保持し、WASM 初期化とデータセット保持を再利用する。
let worker: Worker | null = null
// Worker へ最後に送ったデータセットのキー（不一致時のみメッシュを再送する）。
let sentDatasetKey: string | null = null
const pendingBuilds = new Map<number, PendingBuild>()

/**
 * Worker を破棄して保留中の要求を失敗させる。次回の生成時に再作成される。
 * Worker クラッシュ・エラー時の安全側のリセットと、アンマウント時の終了に使う。
 */
function disposeWorker(reason: string): void {
  const current = worker
  worker = null
  sentDatasetKey = null
  current?.terminate()
  const error = new Error(reason)
  for (const pending of pendingBuilds.values()) pending.reject(error)
  pendingBuilds.clear()
}

/** アンマウント時に Worker を終了する。 */
export function terminateFinalShapeWorker(): void {
  disposeWorker('最終形状 Worker を終了しました')
}

function handleMessage(event: MessageEvent<FinalShapeWorkerResponse>): void {
  const msg = event.data
  const pending = pendingBuilds.get(msg.requestId)
  if (!pending) return
  if (msg.type === 'progress') {
    pending.onProgress?.(msg.message)
    return
  }
  pendingBuilds.delete(msg.requestId)
  if (msg.type === 'done') {
    // 工程別タイミング（開発時の性能確認用）。
    if (msg.timings) console.debug('[finalShape] timings', msg.timings)
    pending.resolve({ mesh: msg.mesh, warnings: msg.warnings })
    return
  }
  // 生成エラー時は Worker を作り直す（安全側）。
  pending.reject(new Error(msg.message))
  disposeWorker('最終形状 Worker を再作成しました')
}

function getWorker(): Worker {
  if (worker) return worker
  const next = new Worker(new URL('../workers/finalShape.worker.ts', import.meta.url), {
    type: 'module',
  })
  next.onmessage = handleMessage
  next.onerror = () => {
    disposeWorker('最終形状 Worker でエラーが発生しました')
  }
  worker = next
  return next
}

/**
 * 完成形状（エクスポートと同一のパイプライン出力）を常駐 Worker で生成する。
 *
 * 建物/地形メッシュは `dataset.key` が前回送信時と変わったときだけ送るため、
 * 設定だけを変えた再生成では structured clone が発生しない。メッシュは
 * 通常の structured clone で渡すため、呼び出し側のバッファは切り離されない。
 * `requestId` による古い結果の破棄は呼び出し側が行う。
 */
export function buildFinalShapeInWorker(
  requestId: number,
  dataset: FinalShapeDataset,
  bounds: Bounds,
  options: ExportOptions,
  onProgress?: (message: string) => void,
): Promise<FinalShapeResult> {
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker()
    pendingBuilds.set(requestId, { resolve, reject, onProgress })
    const sendDataset = dataset.key !== sentDatasetKey
    const request: FinalShapeWorkerRequest = {
      type: 'build',
      requestId,
      datasetKey: dataset.key,
      dataset: sendDataset
        ? { buildingMeshes: dataset.buildingMeshes, terrainMesh: dataset.terrainMesh }
        : undefined,
      bounds,
      options,
    }
    if (sendDataset) sentDatasetKey = dataset.key
    try {
      activeWorker.postMessage(request)
    } catch (error) {
      pendingBuilds.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
      disposeWorker('最終形状 Worker への送信に失敗しました')
    }
  })
}
