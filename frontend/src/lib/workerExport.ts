import type { Bounds, ExportOptions, RawMesh } from '@machimoki/core'
import type { ExportWorkerRequest, ExportWorkerResponse } from '../workers/export.worker.ts'

function downloadBuffer(buffer: Uint8Array, filename: string, mimeType: string) {
  const blob = new Blob([buffer as unknown as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function runWorkerExport(
  bounds: Bounds,
  options: ExportOptions,
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  onProgress?: (progress: number, message: string) => void,
): Promise<{ buffer: Uint8Array; warnings: string[]; split: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress?.(msg.progress, msg.message)
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve({ buffer: msg.buffer, warnings: msg.warnings, split: msg.split })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(err.error ?? new Error(err.message))
    }

    const req: ExportWorkerRequest = { buildingMeshes, terrainMesh, bounds, options }
    worker.postMessage(req)
  })
}

/**
 * 完成メッシュ（キャッシュ済み）からシリアライズのみ行う。
 * 建物/地形の取得と形状生成をスキップする。バッファは transfer するため、
 * 渡したメッシュのバッファは切り離される（呼び出し側はコピーを渡すこと）。
 * `splitParts` があれば分割はそれをそのままシリアライズする（再分割しない）。
 */
export async function runWorkerSerialize(
  requestId: number,
  mesh: RawMesh,
  terrainMesh: RawMesh | null,
  options: ExportOptions,
  splitParts?: { frame: RawMesh; buildings: RawMesh } | null,
): Promise<{ buffer: Uint8Array; warnings: string[]; split: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        // シリアライズのみのため進捗表示は呼び出し側に任せる。
      } else if (msg.type === 'done') {
        worker.terminate()
        resolve({ buffer: msg.buffer, warnings: msg.warnings, split: msg.split })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message))
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(err.error ?? new Error(err.message))
    }

    const transfer: ArrayBuffer[] = [
      mesh.positions.buffer as ArrayBuffer,
      mesh.indices.buffer as ArrayBuffer,
    ]
    if (terrainMesh) {
      transfer.push(
        terrainMesh.positions.buffer as ArrayBuffer,
        terrainMesh.indices.buffer as ArrayBuffer,
      )
    }
    if (splitParts) {
      transfer.push(
        splitParts.frame.positions.buffer as ArrayBuffer,
        splitParts.frame.indices.buffer as ArrayBuffer,
        splitParts.buildings.positions.buffer as ArrayBuffer,
        splitParts.buildings.indices.buffer as ArrayBuffer,
      )
    }
    worker.postMessage(
      {
        type: 'serialize',
        requestId,
        positions: mesh.positions,
        indices: mesh.indices,
        terrainMesh,
        options,
        splitParts: splitParts ?? undefined,
      },
      transfer,
    )
  })
}

export function triggerDownload(buffer: Uint8Array, format: string, split = false) {
  if (split) {
    downloadBuffer(buffer, 'model_split.zip', 'application/zip')
    return
  }
  if (format === 'stl') {
    downloadBuffer(buffer, 'model.stl', 'model/stl')
  } else {
    downloadBuffer(buffer, 'model.3mf', 'model/3mf')
  }
}
