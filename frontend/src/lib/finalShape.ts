import type { Bounds, ExportOptions, RawMesh } from '@machimoki/core'
import type {
  FinalShapeWorkerRequest,
  FinalShapeWorkerResponse,
} from '../workers/finalShape.worker.ts'

export interface FinalShapeResult {
  mesh: RawMesh
  warnings: string[]
}

/**
 * 完成形状（エクスポートと同一のパイプライン出力）を Worker で生成する。
 *
 * Worker には通常の structured clone でメッシュを渡すため、呼び出し側が
 * 再利用するバッファが transfer で切り離されることはない。
 * `requestId` は応答と照合するための識別子で、古い結果の破棄は呼び出し側が
 * 最新 ID と比較して行う。
 */
export function buildFinalShapeInWorker(
  requestId: number,
  bounds: Bounds,
  options: ExportOptions,
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  onProgress?: (message: string) => void,
): Promise<FinalShapeResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/finalShape.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (e: MessageEvent<FinalShapeWorkerResponse>) => {
      const msg = e.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'progress') {
        onProgress?.(msg.message)
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve({ mesh: msg.mesh, warnings: msg.warnings })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(err.error ?? new Error(err.message))
    }

    const req: FinalShapeWorkerRequest = {
      requestId,
      buildingMeshes,
      terrainMesh,
      bounds,
      options,
    }
    worker.postMessage(req)
  })
}
