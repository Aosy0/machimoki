import { setWasmUrl } from 'manifold-3d/lib/wasm.js'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { buildHollowBuildingShells } from '../../../core/src/pipelineUtils.ts'
import type { Bounds, RawMesh } from '../../../core/src/types.ts'

setWasmUrl(wasmUrl)

export type HollowBuildingsWorkerRequest = {
  type: 'build'
  requestId: number
  buildingMeshes: RawMesh[]
  bounds: Bounds
  /** 実スケールのメートル。 */
  wallThickness: number
  includeSpanningBuildings: boolean
}

export type HollowBuildingsWorkerResponse =
  | { type: 'progress'; requestId: number; message: string }
  | { type: 'done'; requestId: number; mesh: RawMesh | null }
  | { type: 'error'; requestId: number; message: string }

/** 複数シェルを1メッシュに結合する（Primitive 化を1回で済ませる）。 */
function mergeRawMeshes(meshes: RawMesh[]): RawMesh {
  let vertexTotal = 0
  let indexTotal = 0
  for (const m of meshes) {
    vertexTotal += m.positions.length / 3
    indexTotal += m.indices.length
  }
  const positions = new Float32Array(vertexTotal * 3)
  const indices = new Uint32Array(indexTotal)
  let vertexOffset = 0
  let indexOffset = 0
  for (const m of meshes) {
    positions.set(m.positions, vertexOffset * 3)
    for (let i = 0; i < m.indices.length; i++) {
      indices[indexOffset + i] = m.indices[i] + vertexOffset
    }
    vertexOffset += m.positions.length / 3
    indexOffset += m.indices.length
  }
  return { positions, indices }
}

self.onmessage = async (e: MessageEvent<HollowBuildingsWorkerRequest>) => {
  const msg = e.data
  if (msg.type !== 'build') return
  const { requestId, buildingMeshes, bounds, wallThickness, includeSpanningBuildings } = msg
  const post = (message: HollowBuildingsWorkerResponse): void => {
    ;(self as unknown as { postMessage: (msg: unknown) => void }).postMessage(message)
  }
  try {
    post({ type: 'progress', requestId, message: '建物の中空化中...' })
    const shells = await buildHollowBuildingShells(
      buildingMeshes,
      bounds,
      wallThickness,
      includeSpanningBuildings,
    )
    const meshes = shells.filter((m) => m.positions.length > 0 && m.indices.length > 0)
    if (meshes.length === 0) {
      post({ type: 'done', requestId, mesh: null })
      return
    }
    post({ type: 'done', requestId, mesh: mergeRawMeshes(meshes) })
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
