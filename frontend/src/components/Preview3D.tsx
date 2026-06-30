import { useEffect, useRef, useState } from 'react'
import { Scene, PerspectiveCamera, WebGLRenderer, Color, GridHelper, Sphere } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TilesRenderer } from '3d-tiles-renderer'
import type { SelectionBounds } from '../hooks/useRectangleSelection'

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  sceneRef?: React.MutableRefObject<Scene | null>
}

function getSelectionCenter(bounds: SelectionBounds): { lon: number; lat: number } {
  return {
    lon: (bounds.west + bounds.east) / 2,
    lat: (bounds.south + bounds.north) / 2,
  }
}

function Preview3D({ selectionBounds, sceneRef }: Preview3DProps) {
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
    scene.background = new Color(0x222222)
    sceneRefInternal.current = scene
    if (sceneRef) {
      sceneRef.current = scene
    }

    const gridHelper = new GridHelper(2000, 50, 0x555555, 0x333333)
    scene.add(gridHelper)

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

  // Tileset loading — runs when selectionBounds changes
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

    const tilesetUrl = 'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13-bldg-lod1-2025/tileset.json'
    const tilesRenderer = new TilesRenderer(tilesetUrl)
    tilesRenderer.setCamera(cameraRef.current)
    tilesRenderer.setResolutionFromRenderer(cameraRef.current, rendererRef.current)
    sceneRefInternal.current.add(tilesRenderer.group)
    tilesRendererRef.current = tilesRenderer

    const handleLoadRootTileset = () => {
      const sphere = new Sphere()
      tilesRenderer.getBoundingSphere(sphere)
      tilesRenderer.group.position.copy(sphere.center).multiplyScalar(-1)

      const center = getSelectionCenter(selectionBounds)
      const dLon = selectionBounds.east - selectionBounds.west
      const dLat = selectionBounds.north - selectionBounds.south
      const widthM = dLon * 111320 * Math.cos((center.lat * Math.PI) / 180)
      const heightM = dLat * 110540
      const selectionRadius = Math.sqrt(widthM * widthM + heightM * heightM) / 2

      const radius = Math.max(sphere.radius, selectionRadius)
      if (radius > 0 && cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(radius * 0.5, radius * 0.8, radius * 1.2)
        controlsRef.current.target.set(0, 0, 0)
        controlsRef.current.update()
      }
      setIsLoading(false)
    }

    const handleLoadError = (ev: ErrorEvent) => {
      console.warn('Tile load error (non-critical):', ev.error || ev.message)
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
  }, [selectionBounds])

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
          <span style={messageStyle}>地図で範囲を選択してください</span>
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
