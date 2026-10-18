import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildPrintableGeometryFromMeshes } from '../../../core/src/pipelineUtils.ts'
import type { Bounds, ExportOptions, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

export type FinalShapeWorkerRequest = {
  requestId: number
  buildingMeshes: RawMesh[]
  terrainMesh: RawMesh | null
  bounds: Bounds
  options: ExportOptions
}

export type FinalShapeWorkerResponse =
  | { type: 'progress'; requestId: number; message: string }
  | { type: 'done'; requestId: number; mesh: RawMesh; warnings: string[] }
  | { type: 'error'; requestId: number; message: string }

self.onmessage = async (e: MessageEvent<FinalShapeWorkerRequest>) => {
  const { requestId, buildingMeshes, terrainMesh, bounds, options } = e.data
  const post = (message: FinalShapeWorkerResponse): void => {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message)
  }
  try {
    post({ type: 'progress', requestId, message: 'WASM初期化中...' })
    // エクスポートと同一の形状生成処理（シリアライズはしない）
    const result = await buildPrintableGeometryFromMeshes(
      buildingMeshes,
      terrainMesh,
      bounds,
      options,
    )
    post({
      type: 'done',
      requestId,
      mesh: result.mesh,
      warnings: result.warnings,
    })
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
