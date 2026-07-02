import { TilesRenderer } from '3d-tiles-renderer'
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/three/plugins'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { BufferAttribute, BufferGeometry, Mesh, Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import type { PipelineProgress } from '../types/pipeline'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import {
  ecefToEnuAxes,
  ecefToEnuPoint,
  getSelectionCenter,
  getSelectionSizeMeters,
  latLonToEcef,
} from '../lib/enuCoordinates'

export interface PipelineOptions {
  selectionBounds: SelectionBounds
  lod: 'lod1' | 'lod2'
  onProgress: (progress: PipelineProgress) => void
}

export interface PipelineResult {
  geometry: BufferGeometry | null
  stats: { totalTiles: number; acquiredTiles: number; vertexCount: number }
}

function customMergeGeometries(geometries: BufferGeometry[]): BufferGeometry {
  let totalVertices = 0
  let totalIndices = 0
  geometries.forEach(g => {
    totalVertices += g.attributes.position.count
    totalIndices += g.index ? g.index.count : g.attributes.position.count
  })

  const mergedPositions = new Float32Array(totalVertices * 3)
  const mergedIndices = new Uint32Array(totalIndices)
  let posOffset = 0
  let idxOffset = 0
  let vertexOffset = 0

  geometries.forEach(g => {
    const pos = g.attributes.position.array as Float32Array
    mergedPositions.set(pos, posOffset)
    posOffset += pos.length

    if (g.index) {
      const idx = g.index.array as Uint32Array
      for (let i = 0; i < idx.length; i++) {
        mergedIndices[idxOffset + i] = idx[i] + vertexOffset
      }
      idxOffset += idx.length
    } else {
      const count = g.attributes.position.count
      for (let i = 0; i < count; i++) {
        mergedIndices[idxOffset + i] = vertexOffset + i
      }
      idxOffset += count
    }
    vertexOffset += g.attributes.position.count
  })

  const result = new BufferGeometry()
  result.setAttribute('position', new BufferAttribute(mergedPositions, 3))
  result.setIndex(new BufferAttribute(mergedIndices, 1))
  return result
}

const PREFECTURES: { code: string; name: string; latMin: number; latMax: number; lonMin: number; lonMax: number }[] = [
  { code: '01', name: '北海道', latMin: 41.24, latMax: 45.52, lonMin: 139.33, lonMax: 145.82 },
  { code: '02', name: '青森県', latMin: 40.17, latMax: 41.62, lonMin: 139.51, lonMax: 141.73 },
  { code: '03', name: '岩手県', latMin: 38.70, latMax: 40.25, lonMin: 140.75, lonMax: 142.06 },
  { code: '04', name: '宮城県', latMin: 37.90, latMax: 39.63, lonMin: 140.48, lonMax: 142.26 },
  { code: '05', name: '秋田県', latMin: 38.89, latMax: 40.34, lonMin: 139.58, lonMax: 140.84 },
  { code: '06', name: '山形県', latMin: 37.75, latMax: 39.01, lonMin: 139.58, lonMax: 140.40 },
  { code: '07', name: '福島県', latMin: 36.82, latMax: 37.95, lonMin: 139.33, lonMax: 140.51 },
  { code: '08', name: '茨城県', latMin: 35.74, latMax: 36.95, lonMin: 139.52, lonMax: 140.83 },
  { code: '09', name: '栃木県', latMin: 36.01, latMax: 37.15, lonMin: 139.30, lonMax: 140.20 },
  { code: '10', name: '群馬県', latMin: 36.00, latMax: 37.01, lonMin: 138.61, lonMax: 139.87 },
  { code: '11', name: '埼玉県', latMin: 35.45, latMax: 36.31, lonMin: 138.73, lonMax: 139.99 },
  { code: '12', name: '千葉県', latMin: 34.89, latMax: 36.06, lonMin: 139.52, lonMax: 140.87 },
  { code: '13', name: '東京都', latMin: 34.80, latMax: 36.09, lonMin: 138.69, lonMax: 140.00 },
  { code: '14', name: '神奈川県', latMin: 35.14, latMax: 35.69, lonMin: 138.95, lonMax: 139.94 },
  { code: '15', name: '新潟県', latMin: 36.59, latMax: 38.54, lonMin: 137.56, lonMax: 139.53 },
  { code: '16', name: '富山県', latMin: 36.24, latMax: 37.03, lonMin: 136.77, lonMax: 137.63 },
  { code: '17', name: '石川県', latMin: 35.79, latMax: 37.77, lonMin: 136.02, lonMax: 137.50 },
  { code: '18', name: '福井県', latMin: 35.33, latMax: 36.07, lonMin: 135.47, lonMax: 136.82 },
  { code: '19', name: '山梨県', latMin: 35.15, latMax: 35.89, lonMin: 138.24, lonMax: 139.21 },
  { code: '20', name: '長野県', latMin: 35.46, latMax: 37.01, lonMin: 137.32, lonMax: 138.87 },
  { code: '21', name: '岐阜県', latMin: 35.17, latMax: 36.48, lonMin: 136.27, lonMax: 137.96 },
  { code: '22', name: '静岡県', latMin: 34.60, latMax: 35.68, lonMin: 137.73, lonMax: 139.45 },
  { code: '23', name: '愛知県', latMin: 34.44, latMax: 35.44, lonMin: 136.58, lonMax: 138.15 },
  { code: '24', name: '三重県', latMin: 33.75, latMax: 35.14, lonMin: 135.55, lonMax: 137.11 },
  { code: '25', name: '滋賀県', latMin: 34.58, latMax: 35.63, lonMin: 135.50, lonMax: 136.54 },
  { code: '26', name: '京都府', latMin: 34.59, latMax: 35.91, lonMin: 135.05, lonMax: 136.13 },
  { code: '27', name: '大阪府', latMin: 34.14, latMax: 35.01, lonMin: 135.01, lonMax: 136.00 },
  { code: '28', name: '兵庫県', latMin: 34.43, latMax: 35.68, lonMin: 134.17, lonMax: 135.60 },
  { code: '29', name: '奈良県', latMin: 33.80, latMax: 34.68, lonMin: 135.40, lonMax: 136.13 },
  { code: '30', name: '和歌山県', latMin: 33.44, latMax: 34.43, lonMin: 135.00, lonMax: 136.01 },
  { code: '31', name: '鳥取県', latMin: 34.86, latMax: 35.66, lonMin: 133.08, lonMax: 134.77 },
  { code: '32', name: '島根県', latMin: 34.09, latMax: 35.50, lonMin: 131.52, lonMax: 133.36 },
  { code: '33', name: '岡山県', latMin: 34.18, latMax: 35.39, lonMin: 132.79, lonMax: 134.42 },
  { code: '34', name: '広島県', latMin: 33.90, latMax: 35.04, lonMin: 131.47, lonMax: 133.20 },
  { code: '35', name: '山口県', latMin: 33.61, latMax: 34.70, lonMin: 130.83, lonMax: 132.44 },
  { code: '36', name: '徳島県', latMin: 33.25, latMax: 34.17, lonMin: 133.57, lonMax: 134.62 },
  { code: '37', name: '香川県', latMin: 33.89, latMax: 34.45, lonMin: 133.47, lonMax: 134.64 },
  { code: '38', name: '愛媛県', latMin: 32.79, latMax: 34.29, lonMin: 131.93, lonMax: 133.25 },
  { code: '39', name: '高知県', latMin: 32.57, latMax: 33.89, lonMin: 132.29, lonMax: 134.06 },
  { code: '40', name: '福岡県', latMin: 32.94, latMax: 34.02, lonMin: 129.66, lonMax: 131.49 },
  { code: '41', name: '佐賀県', latMin: 32.92, latMax: 33.73, lonMin: 129.70, lonMax: 130.40 },
  { code: '42', name: '長崎県', latMin: 32.44, latMax: 33.44, lonMin: 128.91, lonMax: 129.90 },
  { code: '43', name: '熊本県', latMin: 32.14, latMax: 33.45, lonMin: 130.05, lonMax: 131.77 },
  { code: '44', name: '大分県', latMin: 32.58, latMax: 33.63, lonMin: 130.44, lonMax: 132.10 },
  { code: '45', name: '宮崎県', latMin: 31.36, latMax: 32.92, lonMin: 130.49, lonMax: 132.06 },
  { code: '46', name: '鹿児島県', latMin: 29.87, latMax: 32.03, lonMin: 129.54, lonMax: 131.68 },
  { code: '47', name: '沖縄県', latMin: 24.25, latMax: 28.50, lonMin: 122.93, lonMax: 131.34 },
]

function latLonToPrefCode(lat: number, lon: number): string {
  const matches = []
  for (const pref of PREFECTURES) {
    if (lat >= pref.latMin && lat <= pref.latMax && lon >= pref.lonMin && lon <= pref.lonMax) {
      const area = (pref.latMax - pref.latMin) * (pref.lonMax - pref.lonMin)
      matches.push({ code: pref.code, area })
    }
  }
  if (matches.length === 0) {
    throw new Error('選択された範囲は日本のPLATEAU対象地域ではありません')
  }
  matches.sort((a, b) => a.area - b.area)
  return matches[0].code
}

/**
 * 選択範囲の中心点から都道府県コードを決定し、PLATEAU の tileset URL を返す。
 */
function resolvePlateauTilesetUrl(bounds: SelectionBounds, lod: 'lod1' | 'lod2'): string {
  const center = getSelectionCenter(bounds)
  const prefCode = latLonToPrefCode(center.lat, center.lon)
  return `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/${prefCode}-bldg-${lod}-latest/tileset.json`
}

function countIdentifiedTiles(tilesRenderer: TilesRenderer): number {
  const root = tilesRenderer.root
  if (!root) return 0

  let count = 0
  function traverse(tile: { children?: unknown[]; content?: unknown } | null) {
    if (!tile) return
    if (tile.content) {
      count++
    }
    if (Array.isArray(tile.children)) {
      for (const child of tile.children) {
        traverse(child as typeof tile)
      }
    }
  }
  traverse(root)
  return count
}

function countLoadedTiles(tilesRenderer: TilesRenderer): number {
  let count = 0
  tilesRenderer.forEachLoadedModel(() => {
    count++
  })
  return count
}

export async function runTilePipeline(options: PipelineOptions): Promise<PipelineResult> {
  const { selectionBounds, lod, onProgress } = options

  try {
    onProgress({ phase: 'identifying', progress: 0, detail: 'タイルセットURLを解決中' })

    const tilesetUrl = resolvePlateauTilesetUrl(selectionBounds, lod)
    const center = getSelectionCenter(selectionBounds)
    const centerEcef = latLonToEcef(center.lat, center.lon)
    const enuAxes = ecefToEnuAxes(center.lat, center.lon)

    onProgress({ phase: 'identifying', progress: 30, detail: 'タイルレンダラーを初期化中' })

    const tilesRenderer = new TilesRenderer(tilesetUrl)

    tilesRenderer.lruCache.maxBytesSize = Infinity
    tilesRenderer.lruCache.minBytesSize = 0

    tilesRenderer.optimizedLoadStrategy = false
    tilesRenderer.loadAncestors = true
    tilesRenderer.loadSiblings = true

    const size = getSelectionSizeMeters(selectionBounds)
    const maxDim = Math.max(size.width, size.height)
    const altitude = Math.max(maxDim * 1.5, 800)

    const camera = new PerspectiveCamera(60, 1, 1, Math.max(maxDim * 50, 200000))
    camera.position.copy(centerEcef.clone().addScaledVector(enuAxes.up, altitude))
    camera.lookAt(centerEcef)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    tilesRenderer.setCamera(camera)

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = 2048
    tempCanvas.height = 2048
    const tempRenderer = new WebGLRenderer({ canvas: tempCanvas })
    tilesRenderer.setResolutionFromRenderer(camera, tempRenderer)

    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    tilesRenderer.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }))

    tilesRenderer.addEventListener('load-error', (ev) => {
      console.warn('[pipeline] load-error:', (ev as any).url, (ev as any).error?.message)
    })

    onProgress({ phase: 'identifying', progress: 60, detail: 'ルートタイルセットを読み込み中' })

    // Kick off the tile traversal loop immediately so loading can progress.
    const updateLoop = setInterval(() => {
      camera.updateMatrixWorld()
      tilesRenderer.update()
    }, 100)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const onLoad = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      const onError = (ev: { tile: unknown; error: Error; url: string | URL }) => {
        if (settled) return
        settled = true
        cleanup()
        reject(ev.error)
      }
      const cleanup = () => {
        tilesRenderer.removeEventListener('load-root-tileset', onLoad)
        tilesRenderer.removeEventListener('load-error', onError)
        clearTimeout(timeoutId)
      }
      tilesRenderer.addEventListener('load-root-tileset', onLoad)
      tilesRenderer.addEventListener('load-error', onError)
      const timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error('ルートタイルセットの読み込みがタイムアウトしました'))
      }, 30000)
    })

    const totalTiles = countIdentifiedTiles(tilesRenderer)
    onProgress({ phase: 'identifying', progress: 100, detail: `${totalTiles} タイルを特定` })

    if (totalTiles === 0) {
      clearInterval(updateLoop)
      tilesRenderer.dispose()
      return { geometry: null, stats: { totalTiles: 0, acquiredTiles: 0, vertexCount: 0 } }
    }

    onProgress({ phase: 'acquiring', progress: 0, detail: `0 / ${totalTiles} タイル` })

    const maxWait = 60000
    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      const loadedCount = countLoadedTiles(tilesRenderer)
      onProgress({
        phase: 'acquiring',
        progress: (loadedCount / totalTiles) * 100,
        detail: `${loadedCount} / ${totalTiles} タイル`,
      })
      if (loadedCount >= totalTiles) break
      await new Promise((r) => setTimeout(r, 200))
    }

    const acquiredTiles = countLoadedTiles(tilesRenderer)
    onProgress({
      phase: 'acquiring',
      progress: 100,
      detail: `${acquiredTiles} / ${totalTiles} タイル`,
    })

    onProgress({ phase: 'composing', progress: 0, detail: 'ジオメトリを合成中' })

    const geometries: BufferGeometry[] = []
    let vertexCount = 0
    const position = new Vector3()

    tilesRenderer.forEachLoadedModel((scene: Object3D) => {
      scene.updateMatrixWorld(true)
      scene.traverse((object) => {
        if (object instanceof Mesh && object.geometry) {
          const geom = object.geometry.clone()
          geom.applyMatrix4(object.matrixWorld)

          const posAttr = geom.attributes.position
          if (posAttr) {
            for (let i = 0; i < posAttr.count; i++) {
              position.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
              const enu = ecefToEnuPoint(position, centerEcef, enuAxes)
              posAttr.setXYZ(i, enu.x, enu.y, enu.z)
            }
            posAttr.needsUpdate = true
            vertexCount += posAttr.count
          }

          geometries.push(geom)
        }
      })
    })

    clearInterval(updateLoop)
    tilesRenderer.dispose()
    let geometry: BufferGeometry | null = null
    if (geometries.length > 0) {
      geometry = customMergeGeometries(geometries)
    }

    onProgress({
      phase: 'composing',
      progress: 100,
      detail: `${geometries.length} 個のジオメトリを合成`,
    })

    return {
      geometry,
      stats: { totalTiles, acquiredTiles, vertexCount },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '不明なエラー'
    onProgress({ phase: 'error', progress: 0, detail: message })
    return { geometry: null, stats: { totalTiles: 0, acquiredTiles: 0, vertexCount: 0 } }
  }
}
