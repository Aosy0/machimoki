import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildPrintableModelFromMeshes } from '../../../core/src/pipelineUtils.ts'
import {
  createManifoldFromMesh,
  exportMeshesToSTL,
  exportTo3MF,
} from '../../../core/src/manifoldOps.ts'
import type { Bounds, ExportOptions, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

export type ExportWorkerRequest = {
  buildingMeshes: RawMesh[]
  terrainMesh: RawMesh | null
  bounds: Bounds
  options: ExportOptions
}

export type ExportWorkerSerializeRequest = {
  type: 'serialize'
  requestId: number
  positions: Float32Array
  indices: Uint32Array
  options: ExportOptions
}

export type ExportWorkerResponse =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; buffer: Uint8Array; warnings: string[] }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ExportWorkerRequest | ExportWorkerSerializeRequest>) => {
  if ((e.data as { type?: unknown }).type === 'serialize') {
    await handleSerialize(e.data as ExportWorkerSerializeRequest)
    return
  }
  const { buildingMeshes, terrainMesh, bounds, options } = e.data as ExportWorkerRequest
  try {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'progress',
      progress: 10,
      message: 'WASM初期化中...',
    } as ExportWorkerResponse)
    const result = await buildPrintableModelFromMeshes(buildingMeshes, terrainMesh, bounds, options)
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'done',
      buffer: result.buffer,
      warnings: result.warnings,
    } as ExportWorkerResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'error',
      message,
    } as ExportWorkerResponse)
  }
}

/**
 * 完成メッシュ（キャッシュ済み）からシリアライズのみ行う。
 * buildPrintableModelFromMeshes と同じシリアライズ手順を使う。
 */
async function handleSerialize(req: ExportWorkerSerializeRequest): Promise<void> {
  const post = (message: ExportWorkerResponse): void => {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message)
  }
  try {
    post({ type: 'progress', progress: 50, message: '3Dモデルをシリアライズ中...' })
    const mesh: RawMesh = { positions: req.positions, indices: req.indices }
    const upAxis = req.options.upAxis ?? 'z-up'
    let buffer: Uint8Array
    if (req.options.format === 'stl') {
      buffer = exportMeshesToSTL([mesh], upAxis)
    } else {
      const manifold = await createManifoldFromMesh(mesh)
      try {
        // 3mf の色はフル経路と同じく、地形ありは地形色、なしは建物色にする。
        const modelColor = req.options.includeTerrain
          ? (req.options.terrainColor ?? '#ffffff')
          : (req.options.buildingColor ?? '#ffffff')
        buffer = await exportTo3MF(manifold, modelColor, upAxis)
      } finally {
        manifold.delete()
      }
    }
    post({ type: 'done', buffer, warnings: [] })
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
