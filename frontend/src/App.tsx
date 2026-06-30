import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Viewer,
  Cartesian3,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  SceneMode,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import Module from 'manifold-3d'
import { Scene } from 'three'
import Preview3D from './components/Preview3D'
import ParameterPanel from './components/ParameterPanel'
import type { Parameters } from './components/ParameterPanel'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorToast from './components/ErrorToast'
import HelpPanel from './components/HelpPanel'
import { exportSceneToSTL } from './lib/exporter'
import { useRectangleSelection } from './hooks/useRectangleSelection'

type Tab = 'map' | 'preview'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [isWasmLoading, setIsWasmLoading] = useState(true)
  const [isMapLoading, setIsMapLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [parameters, setParameters] = useState<Parameters>({
    terrainThickness: 10,
    flattenBottom: true,
    includeTerrain: true,
    lod: 'lod1',
    exportFormat: '3mf',
  })

  const cesiumContainer = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const sceneRef = useRef<Scene | null>(null)

  const {
    selectionBounds,
    errorMessage: selectionErrorMessage,
    clearError: clearSelectionError,
  } = useRectangleSelection(viewer)

  const handleExport = useCallback(() => {
    if (!sceneRef.current) {
      setErrorMessage('3Dシーンが初期化されていません')
      return
    }
    setIsExporting(true)
    setErrorMessage(null)

    setTimeout(() => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const filename = `machimoki-${timestamp}.stl`
        exportSceneToSTL(sceneRef.current!, filename)
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'エクスポートに失敗しました')
      } finally {
        setIsExporting(false)
      }
    }, 100)
  }, [])

  const displayErrorMessage = errorMessage || selectionErrorMessage
  const handleDismissError = () => {
    setErrorMessage(null)
    clearSelectionError()
  }

  // WASM initialization
  useEffect(() => {
    setIsWasmLoading(true)
    Module().then((wasm) => {
      wasm.setup()
      setIsWasmLoading(false)
    }).catch((err: unknown) => {
      setIsWasmLoading(false)
      setErrorMessage(err instanceof Error ? `WASM初期化失敗: ${err.message}` : 'WASM初期化に失敗しました')
    })
  }, [])

  useEffect(() => {
    if (!cesiumContainer.current || activeTab !== 'map') {
      return
    }

    setIsMapLoading(true)

    const viewer = new Viewer(cesiumContainer.current, {
      shouldAnimate: true,
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      baseLayer: false,
      sceneMode: SceneMode.SCENE3D,
      skyBox: false,
    })

    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      })
    )

    setIsMapLoading(false)

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(139.6917, 35.6895, 1500.0),
      orientation: {
        heading: CesiumMath.toRadians(0.0),
        pitch: CesiumMath.toRadians(-45.0),
        roll: 0.0,
      },
      duration: 0,
    })

    setViewer(viewer)

    return () => {
      setViewer(null)
      viewer.destroy()
    }
  }, [activeTab])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #333',
          background: '#1a1a1a',
        }}
      >
        <button
          onClick={() => setActiveTab('map')}
          style={{
            flex: 1,
            padding: '12px',
            background: activeTab === 'map' ? '#333' : '#1a1a1a',
            color: '#fff',
            border: 'none',
            borderBottom: activeTab === 'map' ? '2px solid #00bcd4' : 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'map' ? 'bold' : 'normal',
          }}
        >
          地図で選ぶ
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          style={{
            flex: 1,
            padding: '12px',
            background: activeTab === 'preview' ? '#333' : '#1a1a1a',
            color: '#fff',
            border: 'none',
            borderBottom: activeTab === 'preview' ? '2px solid #00bcd4' : 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: activeTab === 'preview' ? 'bold' : 'normal',
          }}
        >
          3Dで確認する
        </button>
      </div>



      {selectionBounds && activeTab === 'map' && (
        <div
          style={{
            padding: '8px 12px',
            background: '#222',
            color: '#fff',
            fontSize: '12px',
            borderBottom: '1px solid #333',
          }}
        >
          選択範囲: W{selectionBounds.west.toFixed(4)} S{selectionBounds.south.toFixed(4)} E
          {selectionBounds.east.toFixed(4)} N{selectionBounds.north.toFixed(4)}
        </div>
      )}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeTab === 'map' && (
          <div
            ref={cesiumContainer}
            style={{
              width: '100%',
              height: '100%',
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <LoadingOverlay message="PLATEAUデータを読み込み中..." visible={isMapLoading} />
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                left: '16px',
                background: 'rgba(0, 0, 0, 0.6)',
                color: '#ccc',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '11px',
                zIndex: 100,
                pointerEvents: 'none',
              }}
            >
              Shift + ドラッグ で範囲選択
            </div>
          </div>
        )}
        {activeTab === 'preview' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Preview3D selectionBounds={selectionBounds} sceneRef={sceneRef} />
              <LoadingOverlay message="エクスポート中..." visible={isExporting} />
            </div>
            <ParameterPanel
              parameters={parameters}
              onChange={(params) => {
                setParameters(params)
                if (params.lod === 'lod2') {
                  // LOD2 warning is shown in the panel itself
                }
              }}
              onExport={handleExport}
            />
          </div>
        )}
        <HelpPanel mode={activeTab} />
      </div>

      <LoadingOverlay message="WASMを初期化中..." visible={isWasmLoading && activeTab === 'map'} />

      <ErrorToast
        message={displayErrorMessage}
        onDismiss={handleDismissError}
      />
    </div>
  )
}

export default App
