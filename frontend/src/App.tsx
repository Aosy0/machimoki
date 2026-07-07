import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Viewer,
  Cartesian3,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  SceneMode,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import Preview3D from './components/Preview3D'
import ParameterPanel from './components/ParameterPanel'
import type { Parameters } from './components/ParameterPanel'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorToast from './components/ErrorToast'
import HelpPanel from './components/HelpPanel'
import { exportModel } from './lib/apiClient'
import { useRectangleSelection } from './hooks/useRectangleSelection'
import type { PipelineState } from './types/pipeline'

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
    showTerrainImagery: false,
    lod: 'lod1',
    exportFormat: '3mf',
  })

  const cesiumContainer = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const manifoldRef = useRef<any>(null)
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    phase: 'idle',
    progress: 0,
    message: '',
    error: null,
  })

  const [manualCoords, setManualCoords] = useState({
    west: '139.8053',
    south: '35.7470',
    east: '139.8080',
    north: '35.7495',
  })

  const {
    selectionBounds,
    setSelectionBounds,
    errorMessage: selectionErrorMessage,
    clearError: clearSelectionError,
  } = useRectangleSelection(viewer)

  const handleManualSelect = useCallback(() => {
    const w = parseFloat(manualCoords.west)
    const s = parseFloat(manualCoords.south)
    const e = parseFloat(manualCoords.east)
    const n = parseFloat(manualCoords.north)
    if ([w, s, e, n].some(isNaN)) {
      setErrorMessage('座標値が無効です')
      return
    }
    if (w >= e || s >= n) {
      setErrorMessage('無効な選択範囲です (west < east, south < north)')
      return
    }
    setSelectionBounds({ west: w, south: s, east: e, north: n })
    setErrorMessage(null)
  }, [manualCoords, setSelectionBounds])

  const applyPreset = useCallback((preset: { west: number; south: number; east: number; north: number }) => {
    setManualCoords({
      west: preset.west.toString(),
      south: preset.south.toString(),
      east: preset.east.toString(),
      north: preset.north.toString(),
    })
    setSelectionBounds(preset)
    setErrorMessage(null)
  }, [setSelectionBounds])

  const handleExport = useCallback(async () => {
    if (!selectionBounds) {
      setErrorMessage('エクスポートする前に地図で範囲を選択してください')
      return
    }
    setIsExporting(true)
    setErrorMessage(null)
    try {
      await exportModel(selectionBounds, {
        terrainThickness: parameters.terrainThickness,
        flattenBottom: parameters.flattenBottom,
        format: parameters.exportFormat,
        lod: parameters.lod,
        includeTerrain: parameters.includeTerrain,
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'エクスポートに失敗しました')
    } finally {
      setIsExporting(false)
    }
  }, [parameters, selectionBounds])

  const displayErrorMessage = errorMessage || selectionErrorMessage || pipelineState.error
  const handleDismissError = () => {
    setErrorMessage(null)
    clearSelectionError()
    if (pipelineState.phase === 'error') {
      setPipelineState((prev) => ({ ...prev, phase: 'idle', error: null }))
    }
  }

  useEffect(() => {
    setIsWasmLoading(true)
    console.log('[Machimoki] WASM初期化開始')
    const timeout = setTimeout(() => {
      console.warn('[Machimoki] WASM初期化が30秒以上挂かっています')
    }, 30000)
    import('manifold-3d').then(({ default: Module }) => {
      console.log('[Machimoki] manifold-3dモジュール読み込み完了')
      return Module()
    }).then((wasm) => {
      console.log('[Machimoki] WASM読み込み完了、setup()開始')
      wasm.setup()
      console.log('[Machimoki] WASM setup()完了')
      manifoldRef.current = wasm
      setIsWasmLoading(false)
    }).catch((err: unknown) => {
      console.error('[Machimoki] WASM初期化エラー:', err)
      setIsWasmLoading(false)
      setErrorMessage(err instanceof Error ? `WASM初期化失敗: ${err.message}` : 'WASM初期化に失敗しました')
    }).finally(() => {
      clearTimeout(timeout)
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
      sceneMode: SceneMode.SCENE2D,
      skyBox: false,
    })

    viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      })
    )

    setIsMapLoading(false)

    const ssec = viewer.scene.screenSpaceCameraController
    ssec.enableTilt = false
    ssec.enableRotate = false
    ssec.enableLook = false

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(139.6917, 35.6895, 1500.0),
      orientation: {
        heading: CesiumMath.toRadians(0.0),
        pitch: CesiumMath.toRadians(-90.0),
        roll: 0.0,
      },
    })

    setViewer(viewer)
    ;(window as any).__viewer = viewer

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
            <div
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                background: 'rgba(0, 0, 0, 0.75)',
                color: '#fff',
                padding: '10px',
                borderRadius: '6px',
                fontSize: '12px',
                zIndex: 100,
                width: '220px',
              }}
            >
              <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>座標で選択</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '6px' }}>
                <input
                  type="text"
                  placeholder="W"
                  value={manualCoords.west}
                  onChange={(e) => setManualCoords((prev) => ({ ...prev, west: e.target.value }))}
                  style={{ width: '100%', padding: '4px', fontSize: '11px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <input
                  type="text"
                  placeholder="E"
                  value={manualCoords.east}
                  onChange={(e) => setManualCoords((prev) => ({ ...prev, east: e.target.value }))}
                  style={{ width: '100%', padding: '4px', fontSize: '11px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <input
                  type="text"
                  placeholder="S"
                  value={manualCoords.south}
                  onChange={(e) => setManualCoords((prev) => ({ ...prev, south: e.target.value }))}
                  style={{ width: '100%', padding: '4px', fontSize: '11px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
                <input
                  type="text"
                  placeholder="N"
                  value={manualCoords.north}
                  onChange={(e) => setManualCoords((prev) => ({ ...prev, north: e.target.value }))}
                  style={{ width: '100%', padding: '4px', fontSize: '11px', background: '#333', color: '#fff', border: '1px solid #555', borderRadius: '3px' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                <button
                  onClick={() => applyPreset({ west: 139.8053, south: 35.7470, east: 139.8080, north: 35.7495 })}
                  style={{ flex: 1, padding: '4px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                >
                  足立区
                </button>
                <button
                  onClick={() => applyPreset({ west: 139.6899, south: 35.7029, east: 139.6932, north: 35.7070 })}
                  style={{ flex: 1, padding: '4px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                >
                  新宿
                </button>
                <button
                  onClick={() => applyPreset({ west: 139.7639, south: 35.6764, east: 139.7708, north: 35.6855 })}
                  style={{ flex: 1, padding: '4px', fontSize: '10px', background: '#444', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
                >
                  東京駅
                </button>
              </div>
              <button
                onClick={handleManualSelect}
                style={{ width: '100%', padding: '6px', fontSize: '11px', background: '#00bcd4', color: '#fff', border: 'none', borderRadius: '3px', cursor: 'pointer' }}
              >
                適用
              </button>
            </div>
          </div>
        )}
        {activeTab === 'preview' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Preview3D
                selectionBounds={selectionBounds}
                lod={parameters.lod}
                manifoldRef={manifoldRef}
                onPipelineStateChange={setPipelineState}
                showTerrainImagery={parameters.showTerrainImagery}
              />
              <LoadingOverlay
                message={pipelineState.message}
                visible={pipelineState.phase !== 'idle' && pipelineState.phase !== 'complete'}
                progress={pipelineState.progress}
              />
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
        onRetry={pipelineState.phase === 'error' ? handleDismissError : undefined}
      />
    </div>
  )
}

export default App

