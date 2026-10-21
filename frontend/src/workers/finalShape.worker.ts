import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildPrintableGeometryFromMeshes } from '../../../core/src/pipelineUtils.ts'
import { buildTerrainSlabFromSample, type TerrainSample } from '../../../core/src/terrainSample.ts'
import type { Bounds, ExportOptions, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

export type FinalShapeWorkerRequest = {
  type: 'build'
  requestId: number
  /** 建物データのキー。変わったときだけ buildingMeshes を送る。 */
  buildingKey: string
  /** 地形サンプル（高さグリッド）のキー。変わったときだけ terrainSample を送る。 */
  terrainKey: string
  /** buildingKey が変わったときだけ送られる建物メッシュ。 */
  buildingMeshes?: RawMesh[]
  /** undefined = 送信なし / null = 地形なし。 */
  terrainSample?: TerrainSample | null
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

// Worker 内に保持する入力データ。建物と地形サンプルは別キーで管理し、
// 変わった方だけ再送してもらう（厚み変更ではサンプルを送り直さない）。
let storedBuildingKey: string | null = null
let storedBuildingMeshes: RawMesh[] | null = null
let storedTerrainKey: string | null = null
let storedTerrainSample: TerrainSample | null = null

self.onmessage = async (e: MessageEvent<FinalShapeWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'build') return
  const { requestId, buildingKey, terrainKey, bounds, options } = msg
  const post = (message: FinalShapeWorkerResponse): void => {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message)
  }
  try {
    if (msg.buildingMeshes) {
      storedBuildingKey = buildingKey
      storedBuildingMeshes = msg.buildingMeshes
    }
    if (msg.terrainSample !== undefined) {
      storedTerrainKey = terrainKey
      storedTerrainSample = msg.terrainSample
    }
    if (storedBuildingKey !== buildingKey || storedBuildingMeshes === null) {
      throw new Error('最終形状の建物データセットが設定されていません')
    }
    if (storedTerrainKey !== terrainKey) {
      throw new Error('最終形状の地形データセットが設定されていません')
    }
    post({ type: 'progress', requestId, message: 'WASM初期化中...' })
    // 高さグリッドは保持済みのため、厚み・flattenBottom の変更ではスラブ構築のみ行う。
    let terrainMesh: RawMesh | null = null
    let terrainSlabMs = 0
    if (storedTerrainSample) {
      const slabStart = performance.now()
      const scale = options.scale ?? 1
      const thicknessMeters = options.terrainThickness / (scale * 1000)
      terrainMesh = buildTerrainSlabFromSample(
        storedTerrainSample,
        thicknessMeters,
        options.flattenBottom,
      )
      terrainSlabMs = performance.now() - slabStart
    }
    // エクスポートと同一の形状生成処理（シリアライズはしない）
    const result = await buildPrintableGeometryFromMeshes(
      storedBuildingMeshes,
      terrainMesh,
      bounds,
      options,
    )
    post({
      type: 'done',
      requestId,
      mesh: result.mesh,
      warnings: result.warnings,
      timings: { ...result.timings, terrainSlab: terrainSlabMs },
    })
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
