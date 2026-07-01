import { useEffect, useRef, useState } from 'react'
import { Scene, PerspectiveCamera, WebGLRenderer, Color, AmbientLight, DirectionalLight } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TilesRenderer } from '3d-tiles-renderer'
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/three/plugins'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { SelectionBounds } from '../hooks/useRectangleSelection'

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  sceneRef?: React.MutableRefObject<Scene | null>
  lod: 'lod1' | 'lod2'
}

function getSelectionCenter(bounds: SelectionBounds): { lon: number; lat: number } {
  return {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  }
}

/**
 * 選択範囲の中心点から都道府県コードを決定し、PLATEAU の tileset URL を返す。
 *
 * 制限事項:
 * - PLATEAU tileset は都道府県単位で提供されるため、選択範囲でクリッピングされない
 * - 選択範囲が複数都道府県にまたがる場合、中心点の都道府県のデータのみ表示される
 * - 市区町村単位の tileset ではなく都道府県全体の建物モデルが含まれるため、
 *   選択範囲外の建物も一緒にロードされる
 */
function resolvePlateauTilesetUrl(bounds: SelectionBounds, lod: 'lod1' | 'lod2'): string {
  const center = getSelectionCenter(bounds)
  const prefCode = latLonToPrefCode(center.lat, center.lon)
  return `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/${prefCode}-bldg-${lod}-latest/tileset.json`
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
  for (const pref of PREFECTURES) {
    if (lat >= pref.latMin && lat <= pref.latMax && lon >= pref.lonMin && lon <= pref.lonMax) {
      return pref.code
    }
  }
  throw new Error('選択された範囲は日本のPLATEAU対象地域ではありません')
}

function Preview3D({ selectionBounds, sceneRef, lod }: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRefInternal = useRef<Scene | null>(null)
  const cameraRef = useRef<PerspectiveCamera | null>(null)
  const rendererRef = useRef<WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const tilesRendererRef = useRef<TilesRenderer | null>(null)
  const animationIdRef = useRef<number>(0)

  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const noSelection = selectionBounds === null

  // Scene initialization — runs once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const scene = new Scene()
    scene.background = new Color(0x1a2332)

    const ambientLight = new AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)

    const directionalLight = new DirectionalLight(0xffffff, 1.2)
    directionalLight.position.set(1000, 2000, 1500)
    scene.add(directionalLight)

    sceneRefInternal.current = scene
    if (sceneRef) {
      sceneRef.current = scene
    }

    const camera = new PerspectiveCamera(
      60,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000000
    )
    camera.position.set(0, 500, 1000)
    cameraRef.current = camera

    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controlsRef.current = controls

    function animate() {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()
      camera.updateMatrixWorld()
      scene.updateMatrixWorld()
      if (tilesRendererRef.current) {
        tilesRendererRef.current.update()
      }
      renderer.render(scene, camera)
    }
    animate()

    function handleResize() {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight
      cameraRef.current.updateProjectionMatrix()
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationIdRef.current)
      window.removeEventListener('resize', handleResize)
      controls.dispose()
      renderer.dispose()
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement)
      }
      sceneRefInternal.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      if (sceneRef) {
        sceneRef.current = null
      }
    }
  }, [sceneRef])

  // Tileset loading — runs when selectionBounds or lod changes
  useEffect(() => {
    if (!sceneRefInternal.current || !cameraRef.current || !rendererRef.current) return

    // Clean up previous tileset
    if (tilesRendererRef.current) {
      sceneRefInternal.current.remove(tilesRendererRef.current.group)
      tilesRendererRef.current.dispose()
      tilesRendererRef.current = null
    }

    if (!selectionBounds) {
      setIsLoading(false)
      setLoadError(null)
      return
    }

    setIsLoading(true)
    setLoadError(null)

    let tilesetUrl: string
    try {
      tilesetUrl = resolvePlateauTilesetUrl(selectionBounds, lod)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'タイルセットURLの解決に失敗しました')
      setIsLoading(false)
      return
    }

    const center = getSelectionCenter(selectionBounds)

    const tilesRenderer = new TilesRenderer(tilesetUrl)
    tilesRenderer.setCamera(cameraRef.current)
    tilesRenderer.setResolutionFromRenderer(cameraRef.current, rendererRef.current)

    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    tilesRenderer.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader }))
    tilesRenderer.registerPlugin(new ReorientationPlugin({
      lat: (center.lat * Math.PI) / 180,
      lon: (center.lon * Math.PI) / 180,
    }))

    sceneRefInternal.current.add(tilesRenderer.group)
    tilesRendererRef.current = tilesRenderer

    const handleLoadRootTileset = () => {
      setIsLoading(false)
      if (!cameraRef.current || !controlsRef.current) return

      cameraRef.current.position.set(500, 500, 500)
      cameraRef.current.up.set(0, 1, 0)
      cameraRef.current.lookAt(0, 0, 0)
      cameraRef.current.updateMatrixWorld()

      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    }

    const handleLoadError = (ev: { tile: unknown; error: Error; url: string | URL }) => {
      console.warn('Tile load error:', ev.url, ev.error?.message || ev.error)
      setLoadError('PLATEAUデータの読み込みに失敗しました')
      setIsLoading(false)
    }

    tilesRenderer.addEventListener('load-root-tileset', handleLoadRootTileset)
    tilesRenderer.addEventListener('load-error', handleLoadError)

    return () => {
      tilesRenderer.removeEventListener('load-root-tileset', handleLoadRootTileset)
      tilesRenderer.removeEventListener('load-error', handleLoadError)
      sceneRefInternal.current?.remove(tilesRenderer.group)
      tilesRenderer.dispose()
      if (tilesRendererRef.current === tilesRenderer) {
        tilesRendererRef.current = null
      }
    }
  }, [selectionBounds, lod])

  return (
    <div ref={containerRef} style={containerStyle}>
      {isLoading && (
        <div style={overlayStyle}>
          <div style={spinnerStyle} />
          <span style={messageStyle}>PLATEAUデータを読み込み中...</span>
        </div>
      )}
      {loadError && (
        <div style={overlayStyle}>
          <span style={{ ...messageStyle, color: '#ff6b6b' }}>{loadError}</span>
        </div>
      )}
      {noSelection && (
        <div style={overlayStyle}>
          <span style={messageStyle}>まず2D地図で範囲を選択してください</span>
          <span style={{ ...messageStyle, fontSize: '12px', color: '#aaa', marginTop: '8px' }}>
            Shift + ドラッグ で範囲を選択できます
          </span>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.7)',
  zIndex: 10,
  pointerEvents: 'none',
}

const messageStyle: React.CSSProperties = {
  color: '#fff',
  fontSize: '14px',
  textAlign: 'center',
}

const spinnerStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  border: '3px solid rgba(255, 255, 255, 0.3)',
  borderTop: '3px solid #00bcd4',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
  marginBottom: '12px',
}

export default Preview3D
