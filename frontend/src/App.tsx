import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Viewer,
  Cartesian3,
  Cartesian2,
  Math as CesiumMath,
  Rectangle,
  Entity,
  Color,
  CallbackProperty,
  Cartographic,
  UrlTemplateImageryProvider,
  SceneMode,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
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

type Tab = 'map' | 'preview'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const isSelectionModeRef = useRef(false)

  const setSelectionMode = useCallback((value: boolean) => {
    isSelectionModeRef.current = value
    setIsSelectionMode(value)
  }, [])
  const [selectionBounds, setSelectionBounds] = useState<{
    west: number
    south: number
    east: number
    north: number
  } | null>(null)
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
  const viewerRef = useRef<Viewer | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const isDrawing = useRef(false)
  const startCartographic = useRef<Cartographic | null>(null)
  const currentCartographic = useRef<Cartographic | null>(null)
  const rectangleEntity = useRef<Entity | null>(null)

  // Guardrails
  const validateSelection = useCallback((west: number, south: number, east: number, north: number): string | null => {
    const width = CesiumMath.toRadians(east - west) * 6371000
    const height = CesiumMath.toRadians(north - south) * 6371000
    const areaKm2 = (width * height) / 1_000_000
    if (areaKm2 > 1.0) {
      return `選択範囲が広すぎます（${areaKm2.toFixed(2)} km²）。最大1km²まで。`
    }
    return null
  }, [])

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

  // Cesium map + rectangle selection
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

    viewerRef.current = viewer

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((movement: { position: Cartesian2 }) => {
      if (!isSelectionModeRef.current) return
      const cartesian = viewer.camera.pickEllipsoid(movement.position)
      if (!cartesian) return
      const carto = Cartographic.fromCartesian(cartesian)
      startCartographic.current = carto
      isDrawing.current = true

      rectangleEntity.current = viewer.entities.add({
        rectangle: {
          coordinates: new CallbackProperty(() => {
            if (!startCartographic.current) return Rectangle.fromDegrees(0, 0, 0, 0)
            const current = currentCartographic.current
            if (!current) return Rectangle.fromDegrees(
              CesiumMath.toDegrees(startCartographic.current.longitude),
              CesiumMath.toDegrees(startCartographic.current.latitude),
              CesiumMath.toDegrees(startCartographic.current.longitude),
              CesiumMath.toDegrees(startCartographic.current.latitude)
            )
            return Rectangle.fromDegrees(
              Math.min(CesiumMath.toDegrees(startCartographic.current.longitude), CesiumMath.toDegrees(current.longitude)),
              Math.min(CesiumMath.toDegrees(startCartographic.current.latitude), CesiumMath.toDegrees(current.latitude)),
              Math.max(CesiumMath.toDegrees(startCartographic.current.longitude), CesiumMath.toDegrees(current.longitude)),
              Math.max(CesiumMath.toDegrees(startCartographic.current.latitude), CesiumMath.toDegrees(current.latitude))
            )
          }, false),
          material: Color.CYAN.withAlpha(0.3),
          outline: true,
          outlineColor: Color.CYAN,
        },
      })
    }, ScreenSpaceEventType.LEFT_DOWN)

    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (!isDrawing.current) return
      const cartesian = viewer.camera.pickEllipsoid(movement.endPosition)
      if (!cartesian) return
      currentCartographic.current = Cartographic.fromCartesian(cartesian)
    }, ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction((_movement: { position: Cartesian2 }) => {
      if (!isDrawing.current || !startCartographic.current || !rectangleEntity.current) return
      isDrawing.current = false

      const current = currentCartographic.current
      if (!current) {
        viewer.entities.remove(rectangleEntity.current)
        rectangleEntity.current = null
        startCartographic.current = null
        currentCartographic.current = null
        return
      }

      const west = CesiumMath.toDegrees(Math.min(startCartographic.current.longitude, current.longitude))
      const south = CesiumMath.toDegrees(Math.min(startCartographic.current.latitude, current.latitude))
      const east = CesiumMath.toDegrees(Math.max(startCartographic.current.longitude, current.longitude))
      const north = CesiumMath.toDegrees(Math.max(startCartographic.current.latitude, current.latitude))

      const validationError = validateSelection(west, south, east, north)
      if (validationError) {
        setErrorMessage(validationError)
        viewer.entities.remove(rectangleEntity.current)
        rectangleEntity.current = null
        startCartographic.current = null
        currentCartographic.current = null
        return
      }

      setErrorMessage(null)
      setSelectionBounds({ west, south, east, north })
      setSelectionMode(false)

      viewer.entities.remove(rectangleEntity.current)
      rectangleEntity.current = null
      startCartographic.current = null
      currentCartographic.current = null
    }, ScreenSpaceEventType.LEFT_UP)

    return () => {
      handler.destroy()
      viewerRef.current = null
      viewer.destroy()
    }
  }, [activeTab, validateSelection])

  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.scene.screenSpaceCameraController.enableInputs = !isSelectionMode
    }
  }, [isSelectionMode])

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

      {activeTab === 'map' && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '8px',
            background: '#1a1a1a',
            borderBottom: '1px solid #333',
            gap: '8px',
          }}
        >
          <button
            onClick={() => setSelectionMode(!isSelectionMode)}
            style={{
              padding: '6px 16px',
              background: isSelectionMode ? '#00bcd4' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold',
            }}
          >
            {isSelectionMode ? '範囲選択中...' : '範囲選択モード'}
          </button>
          {isSelectionMode && (
            <span style={{ color: '#aaa', fontSize: '12px', alignSelf: 'center' }}>
              地図をドラッグして範囲を選択
            </span>
          )}
        </div>
      )}

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
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
    </div>
  )
}

export default App
