import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildPrintableGeometryFromMeshes } from '../../../core/src/pipelineUtils.ts'
import type { Bounds, ExportOptions, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

export type FinalShapeWorkerDataset = {
  buildingMeshes: RawMesh[]
  terrainMesh: RawMesh | null
}

export type FinalShapeWorkerRequest = {
  type: 'build'
  requestId: number
  /** 入力データセットのキー。同じキーのときは dataset を省略して再送を避ける。 */
  datasetKey: string
  /** datasetKey が変わったときだけ送られる建物/地形メッシュ。 */
  dataset?: FinalShapeWorkerDataset
  bounds: Bounds
  options: ExportOptions
}

export type FinalShapeWorkerResponse =
  | { type: 'progress'; requestId: number; message: string }
  | {
      type: 'done'
      requestId: number
      mesh: RawMesh
      warnings: string[]
      timings?: Record<string, number>
    }
  | { type: 'error'; requestId: number; message: string }

// Worker 内に保持する入力データセット。datasetKey が変わったときだけ差し替える。
let storedDatasetKey: string | null = null
let storedBuildingMeshes: RawMesh[] | null = null
let storedTerrainMesh: RawMesh | null = null

self.onmessage = async (e: MessageEvent<FinalShapeWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'build') return
  const { requestId, datasetKey, bounds, options } = msg
  const post = (message: FinalShapeWorkerResponse): void => {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message)
  }
  try {
    if (msg.dataset) {
      storedDatasetKey = datasetKey
      storedBuildingMeshes = msg.dataset.buildingMeshes
      storedTerrainMesh = msg.dataset.terrainMesh
    }
    if (storedDatasetKey !== datasetKey || storedBuildingMeshes === null) {
      throw new Error('最終形状の入力データセットが設定されていません')
    }
    post({ type: 'progress', requestId, message: 'WASM初期化中...' })
    // エクスポートと同一の形状生成処理（シリアライズはしない）
    const result = await buildPrintableGeometryFromMeshes(
      storedBuildingMeshes,
      storedTerrainMesh,
      bounds,
      options,
    )
    post({
      type: 'done',
      requestId,
      mesh: result.mesh,
      warnings: result.warnings,
      timings: result.timings,
    })
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
