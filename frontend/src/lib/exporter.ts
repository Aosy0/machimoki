import { Scene } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'

export function exportSceneToSTL(scene: Scene, filename: string): void {
  const exporter = new STLExporter()
  const text = exporter.parse(scene)

  const blob = new Blob([text], { type: 'application/octet-stream' })

  const MAX_SIZE_MB = 50
  if (blob.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`ファイルサイズが大きすぎます（${(blob.size / 1024 / 1024).toFixed(1)}MB）。最大${MAX_SIZE_MB}MBまで。`)
  }

  if (blob.size === 0) {
    throw new Error('出力ファイルが空です')
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function exportSceneToSTLAsync(scene: Scene, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      exportSceneToSTL(scene, filename)
      resolve()
    } catch (err) {
      reject(err)
    }
  })
}
