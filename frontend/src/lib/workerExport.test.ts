import { describe, expect, it } from 'vitest'

import type { RawMesh } from '@machimoki/core'

import { createExportWorkerRequest } from './workerExport'

const mesh = (value: number): RawMesh => ({
  positions: new Float32Array([value, 0, 0]),
  indices: new Uint32Array([0, 0, 0]),
})

const bounds = { west: 139.68, south: 35.68, east: 139.7, north: 35.7 }
const options = { terrainThickness: 1, flattenBottom: true, format: '3mf' as const }

describe('createExportWorkerRequest', () => {
  it('層メッシュをリクエストに載せる', () => {
    const brid = [mesh(1)]
    const tran = [mesh(2)]
    const req = createExportWorkerRequest(bounds, options, [mesh(3)], null, { brid, tran })

    // 参照をそのまま渡す（コピーも切り離しもしない）。
    expect(req.layerMeshes?.brid).toBe(brid)
    expect(req.layerMeshes?.tran).toBe(tran)
  })

  it('層メッシュ未指定は null にする', () => {
    expect(createExportWorkerRequest(bounds, options, [], null).layerMeshes).toBeNull()
    expect(createExportWorkerRequest(bounds, options, [], null, null).layerMeshes).toBeNull()
  })
})
