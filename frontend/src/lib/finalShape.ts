import type { Bounds, ExportOptions, RawMesh, TerrainSample } from '@machimoki/core'
import type {
  FinalShapeWorkerRequest,
  FinalShapeWorkerResponse,
} from '../workers/finalShape.worker.ts'

export interface FinalShapeResult {
  mesh: RawMesh
  warnings: string[]
}

/**
 * Worker に送る入力データ。建物と地形サンプルはキーを分けて管理し、
 * 変わった方だけを送信する（厚み変更では高さグリッドを再送しない）。
 */
export interface FinalShapeDataset {
  buildingKey: string
  terrainKey: string
  buildingMeshes: RawMesh[]
  terrainSample: TerrainSample | null
}

interface PendingBuild {
  resolve: (result: FinalShapeResult) => void
  reject: (error: Error) => void
  onProgress?: (message: string) => void
}

// Worker は使い捨てず保持し、WASM 初期化とデータセット保持を再利用する。
let worker: Worker | null = null
// Worker へ最後に送った各データのキー（不一致時のみ再送する）。
let sentBuildingKey: string | null = null
let sentTerrainKey: string | null = null
const pendingBuilds = new Map<number, PendingBuild>()

/**
 * Worker を破棄して保留中の要求を失敗させる。次回の生成時に再作成される。
 * Worker クラッシュ・エラー時の安全側のリセットと、アンマウント時の終了に使う。
 */
function disposeWorker(reason: string): void {
  const current = worker
  worker = null
  sentBuildingKey = null
  sentTerrainKey = null
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
 * 建物メッシュと地形サンプル（高さグリッド）は、それぞれのキーが前回送信時と
 * 変わったときだけ送るため、厚み・flattenBottom などの設定変更では
 * structured clone も再サンプリングも発生しない。メッシュ/サンプルは通常の
 * structured clone で渡すため、呼び出し側のバッファは切り離されない。
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
    const sendBuilding = dataset.buildingKey !== sentBuildingKey
    const sendTerrain = dataset.terrainKey !== sentTerrainKey
    const request: FinalShapeWorkerRequest = {
      type: 'build',
      requestId,
      buildingKey: dataset.buildingKey,
      terrainKey: dataset.terrainKey,
      buildingMeshes: sendBuilding ? dataset.buildingMeshes : undefined,
      terrainSample: sendTerrain ? dataset.terrainSample : undefined,
      bounds,
      options,
    }
    if (sendBuilding) sentBuildingKey = dataset.buildingKey
    if (sendTerrain) sentTerrainKey = dataset.terrainKey
    try {
      activeWorker.postMessage(request)
    } catch (error) {
      pendingBuilds.delete(requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
      disposeWorker('最終形状 Worker への送信に失敗しました')
    }
  })
}
