import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildPrintableModelFromMeshes } from '@machimoki/core'
import type { Bounds, ExportOptions, RawMesh } from '@machimoki/core'

setWasmUrl(wasmUrl)

export type ExportWorkerRequest = {
  buildingMeshes: RawMesh[]
  terrainMesh: RawMesh | null
  bounds: Bounds
  options: ExportOptions
}

export type ExportWorkerResponse =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; buffer: Uint8Array; warnings: string[] }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ExportWorkerRequest>) => {
  const { buildingMeshes, terrainMesh, bounds, options } = e.data
  try {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'progress',
      progress: 10,
      message: 'WASM初期化中...',
    } as ExportWorkerResponse)
    const result = await buildPrintableModelFromMeshes(buildingMeshes, terrainMesh, bounds, options)
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(
      { type: 'done', buffer: result.buffer, warnings: result.warnings } as ExportWorkerResponse,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'error',
      message,
    } as ExportWorkerResponse)
  }
}
