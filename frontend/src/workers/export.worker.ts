import type { Manifold } from 'manifold-3d'
import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import engravingFontUrl from '../../../core/assets/MPLUS1p-Bold.ttf?url'
import {
  buildPrintableModelFromMeshes,
  buildSplitModelFromFinalMesh,
  engravingMetadata,
  serializeSplitParts,
} from '../../../core/src/pipelineUtils.ts'
import {
  createManifoldFromMesh,
  exportMeshesToSTL,
  exportMeshWithTriangleColorsTo3MF,
} from '../../../core/src/manifoldOps.ts'
import { assignTriangleColors } from '../../../core/src/exportColors.ts'
import { setEngravingFontProvider } from '../../../core/src/engraving/fontProvider.ts'
import type { Bounds, ExportOptions, LayerMeshes, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

// 刻印用フォント（M PLUS 1p Bold, SIL OFL 1.1）は刻印使用時だけ取得する。
setEngravingFontProvider(async () => {
  const response = await fetch(engravingFontUrl)
  if (!response.ok) throw new Error(`刻印フォントの取得に失敗しました: ${response.status}`)
  return response.arrayBuffer()
})

export type ExportWorkerRequest = {
  buildingMeshes: RawMesh[]
  terrainMesh: RawMesh | null
  bounds: Bounds
  options: ExportOptions
  /** 形状に含める橋梁・道路（未指定 = 層なし）。座標系は buildingMeshes と同じ。 */
  layerMeshes?: LayerMeshes | null
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
  const { buildingMeshes, terrainMesh, bounds, options, layerMeshes } =
    e.data as ExportWorkerRequest
  try {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      type: 'progress',
      progress: 10,
      message: 'WASM初期化中...',
    } as ExportWorkerResponse)
    const result = await buildPrintableModelFromMeshes(
      buildingMeshes,
      terrainMesh,
      bounds,
      options,
      layerMeshes,
    )
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
      // キャッシュ済み完成メッシュでもフル経路と同じ規則で三角形ごとに色を付ける
      // （道路は地形の色替えのみ）。Manifold への再インポートはしない。
      const colors = assignTriangleColors({
        mesh,
        terrainMesh: req.terrainMesh,
        scale: req.options.scale ?? 1,
        colors: {
          terrain: req.options.terrainColor ?? '#ffffff',
          building: req.options.buildingColor ?? '#ffffff',
          bridge: req.options.bridgeColor ?? '#8fa3ad',
          road: req.options.roadColor ?? '#7d7d7d',
        },
      })
      buffer = exportMeshWithTriangleColorsTo3MF(
        mesh,
        { palette: colors.palette, perTriangle: colors.perTriangle },
        upAxis,
        engravingMetadata(req.options),
      )
    }
    post({ type: 'done', buffer, warnings: [], split: false })
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
