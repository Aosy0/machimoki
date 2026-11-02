import type { Manifold } from 'manifold-3d'
import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  buildPrintableModelFromMeshes,
  buildSplitModelFromFinalMesh,
  serializeSplitParts,
} from '../../../core/src/pipelineUtils.ts'
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
  /** 分割エクスポート用のスケール済み地形スラブ（splitAtGround のフォールバック用） */
  terrainMesh: RawMesh | null
  options: ExportOptions
  /** キャッシュ済みの分割パーツ（あれば再分割せずこれをシリアライズする） */
  splitParts?: { frame: RawMesh; buildings: RawMesh }
}

export type ExportWorkerResponse =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'done'; buffer: Uint8Array; warnings: string[]; split: boolean }
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
      split: Boolean(result.split),
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

    if (req.options.splitAtGround && req.splitParts) {
      post({ type: 'progress', progress: 70, message: '分割パーツをシリアライズ中...' })
      const frame = await createManifoldFromMesh(req.splitParts.frame)
      let buildings: Manifold | null = null
      try {
        buildings = await createManifoldFromMesh(req.splitParts.buildings)
        const result = await serializeSplitParts(frame, buildings, req.options)
        post({ type: 'done', buffer: result.buffer, warnings: [], split: true })
      } finally {
        frame.delete()
        buildings?.delete()
      }
      return
    }

    if (req.options.splitAtGround) {
      if (!req.terrainMesh) {
        throw new Error(
          '分割には地形データが必要です。プレビューを再生成してから再試行してください。',
        )
      }
      post({ type: 'progress', progress: 60, message: '分割モデルを生成中...' })
      const result = await buildSplitModelFromFinalMesh(mesh, req.terrainMesh, req.options)
      post({ type: 'done', buffer: result.buffer, warnings: [], split: true })
      return
    }

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
    post({ type: 'done', buffer, warnings: [], split: false })
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
