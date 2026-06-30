import { Scene, Mesh, BufferGeometry } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'

export function exportSceneToSTL(scene: Scene, filename: string): void {
  // GridHelperなどを除外し、Meshのみ収集
  const meshes: Mesh[] = []
  scene.traverse((obj) => {
    if (obj instanceof Mesh && obj.geometry instanceof BufferGeometry) {
      meshes.push(obj)
    }
  })

  if (meshes.length === 0) {
    throw new Error('エクスポートできるジオメトリが見つかりません。3Dプレビュータブで建物が表示されているか確認してください。')
  }

  const exporter = new STLExporter()
  const tempScene = new Scene()
  meshes.forEach((m) => tempScene.add(m.clone()))

  const result = exporter.parse(tempScene, { binary: true })
  const blob = new Blob(([result] as unknown) as BlobPart[], { type: 'application/octet-stream' })

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
