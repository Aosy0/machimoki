import { useEffect, useRef, useState, useCallback } from 'react'
import * as Cesium from 'cesium'
import {
  Viewer,
  Cartesian3,
  Cartographic,
  Color,
  type Entity,
  Math as CesiumMath,
  SceneMode,
  WebMercatorProjection,
  Ion,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Ionを明示的に無効化（Ionトークン不要で動作させる）
Ion.defaultAccessToken = undefined as unknown as string

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).Cesium = Cesium
}

import Preview3D from './components/Preview3D'
import ModelViewer from './components/ModelViewer'
import ParameterPanel from './components/ParameterPanel'
import type { Parameters } from './components/ParameterPanel'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorToast from './components/ErrorToast'
import HelpPanel from './components/HelpPanel'
import { exportModel } from './lib/apiClient'
import { runWorkerExport, triggerDownload } from './lib/workerExport'
import { useRectangleSelection } from './hooks/useRectangleSelection'
import { usePointPicking, type PickPoint } from './hooks/usePointPicking'
import { useDeveloperMode } from './hooks/useDeveloperMode'
import type { PipelineState } from './types/pipeline'
import { getAvailableLods, getCoverageMuniCodes, type Lod } from './lib/catalogApi'
import { createCoverageOverlay, type CoverageOverlayHandle } from './lib/coverageOverlay'
import { createCoverageMvtLayer } from './lib/coverageMvtLayer'
import {
  createGsiImageryProvider,
  loadGsiStyle,
  saveGsiStyle,
  GSI_TILE_LABELS,
  GSI_ATTRIBUTION,
  GSI_TILE_STYLES,
  GSI_STORAGE_KEY,
  isContourStyle,
  type GsiTileStyle,
} from './lib/gsiTileConfig'
import { ContourImageryProvider } from './lib/contourImageryProvider'

type Tab = 'map' | 'preview' | 'viewer'

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [isWasmLoading, setIsWasmLoading] = useState(true)
  const [isMapLoading, setIsMapLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [coverageVisible, setCoverageVisible] = useState(true)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [gsiStyle, setGsiStyle] = useState<GsiTileStyle>(() => loadGsiStyle())

  const [parameters, setParameters] = useState<Parameters>({
    terrainThickness: 10,
    flattenBottom: true,
    includeTerrain: true,
    showTerrainImagery: false,
    lod: 'lod1',
    exportFormat: '3mf',
    buildingColor: '#ffffff',
    terrainColor: '#ffffff',
    upAxis: 'z-up',
    includeSpanningBuildings: false,
  })

  const cesiumContainer = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const gsiLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const contourLayerRef = useRef<Cesium.ImageryLayer | null>(null)
  const gsiStyleRef = useRef(gsiStyle)
  useEffect(() => { gsiStyleRef.current = gsiStyle }, [gsiStyle])
  const coverageOverlayRef = useRef<CoverageOverlayHandle | null>(null)
  const coverageVisibleRef = useRef(true)
  const manifoldRef = useRef<any>(null)
  const pickMarkerEntitiesRef = useRef<Entity[]>([])
  const [pickPoints, setPickPoints] = useState<PickPoint[]>([])
  const [excludedBuildingIds, setExcludedBuildingIds] = useState<string[]>([])
  const [isPickMode, setIsPickMode] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    phase: 'idle',
    progress: 0,
    message: '',
    error: null,
  })

  const [scale, setScale] = useState(1)
  const [availableLods, setAvailableLods] = useState<Lod[]>(['lod1', 'lod2'])
  const { isDevMode } = useDeveloperMode()
  const [contourDebug, setContourDebug] = useState<ContourDebugInfo | null>(null)
  const [contourDebugCollapsed, setContourDebugCollapsed] = useState(false)

  const [manualCoords, setManualCoords] = useState({
    west: '',
    south: '',
    east: '',
    north: '',
  })

  const {
    selectionBounds,
    setSelectionBounds,
    errorMessage: selectionErrorMessage,
    clearError: clearSelectionError,
  } = useRectangleSelection(viewer)

  const handlePickPoint = useCallback((point: PickPoint) => {
    setPickPoints((prev) => [...prev, point])
  }, [])

  const clearPickPoints = useCallback(() => {
    setPickPoints([])
  }, [])

  usePointPicking(viewer, isPickMode, handlePickPoint)

  useEffect(() => {
    setExcludedBuildingIds([])
  }, [selectionBounds])

  useEffect(() => {
    if (!viewer || activeTab !== 'map') return
    for (const entity of pickMarkerEntitiesRef.current) {
      viewer.entities.remove(entity)
    }
    pickMarkerEntitiesRef.current = []
    for (const p of pickPoints) {
      const entity = viewer.entities.add({
        position: Cartesian3.fromDegrees(p.lon, p.lat, 0),
        point: {
          pixelSize: 12,
          color: Color.RED,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
        },
      })
      pickMarkerEntitiesRef.current.push(entity)
    }
    return () => {
      for (const entity of pickMarkerEntitiesRef.current) {
        viewer?.entities?.remove(entity)
      }
      pickMarkerEntitiesRef.current = []
    }
  }, [viewer, activeTab, pickPoints])

  useEffect(() => {
    if (!selectionBounds) return
    const centerLat = (selectionBounds.north + selectionBounds.south) / 2
    const widthDeg = selectionBounds.east - selectionBounds.west
    const heightDeg = selectionBounds.north - selectionBounds.south
    const widthM = Math.abs(widthDeg) * (Math.PI / 180) * 6371000 * Math.cos((centerLat * Math.PI) / 180)
    const depthM = Math.abs(heightDeg) * (Math.PI / 180) * 6371000
    const maxDim = Math.max(widthM, depthM)
    if (maxDim > 0) {
      setScale(150 / (maxDim * 1000))
    }
  }, [selectionBounds])

  useEffect(() => {
    if (!selectionBounds) return

    getAvailableLods(selectionBounds)
      .then((lods) => {
        if (lods.length > 0) {
          setAvailableLods(lods)
        } else {
          setAvailableLods(['lod1', 'lod2'])
        }
      })
      .catch(() => {
        setAvailableLods(['lod1', 'lod2'])
      })
  }, [selectionBounds])

  useEffect(() => {
    if (!availableLods.includes(parameters.lod)) {
      const maxAvailableLod = availableLods[availableLods.length - 1]
      setParameters((prev) => ({ ...prev, lod: maxAvailableLod }))
    }
  }, [availableLods, parameters.lod])

  const handleManualSelect = useCallback(() => {
    const w = parseFloat(manualCoords.west)
    const s = parseFloat(manualCoords.south)
    const e = parseFloat(manualCoords.east)
    const n = parseFloat(manualCoords.north)
    if ([w, s, e, n].some(isNaN)) {
      setErrorMessage('座標値が無効です。数値を入力してください')
      return
    }
    if (w >= e || s >= n) {
      setErrorMessage('西端は東端より、南端は北端より小さい値を指定してください')
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

  useEffect(() => {
    ;(window as any).__applyPreset = applyPreset
    return () => {
      try {
        delete (window as any).__applyPreset
      } catch {}
    }
  }, [applyPreset])

  const toggleCoverage = useCallback(() => {
    setCoverageVisible((prev) => !prev)
  }, [])

  const applyContour = useCallback((v: Viewer, style: GsiTileStyle) => {
    if (contourLayerRef.current) {
      v.imageryLayers.remove(contourLayerRef.current, true)
      contourLayerRef.current = null
    }
    const globe: any = v.scene.globe
    globe.material = undefined
    if (!isContourStyle(style)) return
    const baseIndex = gsiLayerRef.current ? v.imageryLayers.indexOf(gsiLayerRef.current) : -1
    const index = baseIndex >= 0 ? baseIndex + 1 : 0
    contourLayerRef.current = v.imageryLayers.addImageryProvider(new ContourImageryProvider(), index)
  }, [])

interface ContourDebugInfo {
  mode: string
  cartoHeight: number | null
  magHeight: number | null
  posZ: number | null
  rectHeight: number | null
  gsiStyle: string
  materialType: string | null
  spacing: number | null
  width: number | null
  color: string | null
  terrainType: string
  isEllipsoid: boolean
  hasAvailability: boolean
  terrainReady: boolean
  contourActive: boolean
  contourReason: string
  spacingUsed: number | null
}

function collectContourDebugInfo(v: Viewer, style: GsiTileStyle): ContourDebugInfo {
  const globe: any = v.scene.globe
  const tp: any = globe.terrainProvider
  const isEllipsoid = !tp || tp.constructor?.name === 'EllipsoidTerrainProvider' || tp.availability === undefined
  const mat: any = globe.material
  const camera = v.camera
  const mode =
    v.scene.mode === SceneMode.SCENE2D ? '2D' : v.scene.mode === SceneMode.SCENE3D ? '3D' : v.scene.mode === SceneMode.COLUMBUS_VIEW ? 'CV' : 'MORPH'

  const carto = camera.positionCartographic
  const cartoHeight = carto ? carto.height : null

  let magHeight: number | null = null
  try {
    const mag = (camera as any).getMagnitude?.()
    if (typeof mag === 'number' && Number.isFinite(mag)) magHeight = mag - 6378137
  } catch {}

  const posZ = camera.position ? camera.position.z : null

  let rectHeight: number | null = null
  try {
    if (v.scene.mode === SceneMode.SCENE2D) {
      const f = camera.frustum as any
      if (typeof f?.right === 'number' && typeof f?.left === 'number' && typeof f?.top === 'number' && typeof f?.bottom === 'number') {
        rectHeight = Math.max(f.right - f.left, f.top - f.bottom)
      }
    } else {
      const rect = camera.computeViewRectangle()
      if (rect) {
        const dest = camera.getRectangleCameraCoordinates(rect)
        if (dest) rectHeight = Cartographic.fromCartesian(dest).height
      }
    }
  } catch {}

  const materialType = mat?.type ?? null
  const spacing = mat?.uniforms?.spacing ?? null
  const width = mat?.uniforms?.width ?? null
  const color = mat?.uniforms?.color
    ? `rgba(${Math.round(mat.uniforms.color.red * 255)},${Math.round(mat.uniforms.color.green * 255)},${Math.round(mat.uniforms.color.blue * 255)},${mat.uniforms.color.alpha.toFixed(2)})`
    : null

  const terrainType = tp?.constructor?.name ?? 'none'
  const hasAvailability = tp?.availability !== undefined
  const terrainReady = tp?.ready ?? false

  // App（2D）は imagery方式（DEMタイル等高線）。styleがcontourなら常に有効。
  const contourActive = isContourStyle(style)
  const contourReason = contourActive
    ? 'imagery方式（DEMタイル等高線）で適用中'
    : `style=${style} は等高線スタイルではない`
  const spacingUsed: number | null = null

  return {
    mode,
    cartoHeight,
    magHeight,
    posZ,
    rectHeight,
    gsiStyle: style,
    materialType,
    spacing,
    width,
    color,
    terrainType,
    isEllipsoid,
    hasAvailability,
    terrainReady,
    contourActive,
    contourReason,
    spacingUsed,
  }
}

function fmtNum(n: number | null): string {
  return n == null || !Number.isFinite(n) ? '--' : Math.round(n).toLocaleString()
}

function ContourDebugPanel({
  info,
  collapsed,
  onToggle,
}: {
  info: ContourDebugInfo | null
  collapsed: boolean
  onToggle: () => void
}) {
  if (!info) return null
  return (
    <div
      data-testid="contour-debug"
      style={{
        position: 'absolute',
        top: '60px',
        left: '16px',
        zIndex: 200,
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        padding: '6px 8px',
        fontSize: '10px',
        fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
        backdropFilter: 'blur(4px)',
        maxWidth: '380px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
          CONTOUR DEBUG ({info.mode})
        </span>
        <button
          onClick={onToggle}
          title={collapsed ? '展開' : '折りたたむ'}
          style={{
            background: 'var(--border)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: '3px',
            padding: '1px 6px',
            fontSize: '10px',
            cursor: 'pointer',
            lineHeight: 1.4,
          }}
        >
          {collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', lineHeight: 1.5, marginTop: '4px' }}>
          <div>
            Height: <b>{fmtNum(info.cartoHeight)}m</b>{' '}
            <span style={{ color: 'var(--text-muted)' }}>
              (carto: {fmtNum(info.cartoHeight)}, mag: {fmtNum(info.magHeight)}
              {info.mode === '2D' ? `, z: ${fmtNum(info.posZ)}` : ''}, rect: {fmtNum(info.rectHeight)})
            </span>
          </div>
          <div>Style: {info.gsiStyle}</div>
          <div>
            Material: {info.materialType ?? 'none'}
            {info.spacing != null && ` spacing:${info.spacing} width:${info.width}`}
            {info.color != null && ` color:${info.color}`}
          </div>
          <div>
            Terrain: {info.terrainType} ready:{info.terrainReady ? 'true' : 'false'} isEllipsoid:
            {info.isEllipsoid ? 'true' : 'false'} availability:{info.hasAvailability ? '有' : '無'}
          </div>
          <div style={{ color: info.contourActive ? '#4caf50' : '#ff9800', fontWeight: 600 }}>
            ContourActive: {info.contourActive ? 'true' : 'false'} ({info.contourReason})
          </div>
        </div>
      )}
    </div>
  )
}

  useEffect(() => {
    coverageVisibleRef.current = coverageVisible
    coverageOverlayRef.current?.setVisible(coverageVisible)
  }, [coverageVisible])

  const handleExport = useCallback(async () => {
    if (!selectionBounds) {
      setErrorMessage('エクスポートする前に地図で範囲を選択してください')
      return
    }
    const widthDeg = selectionBounds.east - selectionBounds.west
    const heightDeg = selectionBounds.north - selectionBounds.south
    const MAX_DEG = 0.02
    if (widthDeg > MAX_DEG || heightDeg > MAX_DEG) {
      setErrorMessage(`選択範囲が大きすぎます。各辺は${MAX_DEG}度（約2.2km）以下にしてください。`)
      return
    }
    setIsExporting(true)
    setErrorMessage(null)
    setPipelineState({ phase: 'composing', progress: 0, message: 'エクスポート準備中...', error: null })
    const exportOptions = {
      terrainThickness: parameters.terrainThickness,
      flattenBottom: parameters.flattenBottom,
      format: parameters.exportFormat as '3mf' | 'stl' | 'machimoki',
      machimokiModelFormat: parameters.exportFormat === 'machimoki' ? ('3mf' as const) : undefined,
      lod: parameters.lod,
      includeTerrain: parameters.includeTerrain,
      buildingColor: parameters.buildingColor,
      terrainColor: parameters.terrainColor,
      upAxis: parameters.upAxis as 'z-up' | 'y-up',
      scale,
      includeSpanningBuildings: parameters.includeSpanningBuildings,
      pickPoints,
      excludedGmlIds: excludedBuildingIds.length > 0 ? excludedBuildingIds : undefined,
    }
    const useWorker = exportOptions.format !== 'machimoki'
    if (useWorker) {
      try {
        setPipelineState({ phase: 'acquiring', progress: 5, message: '建物データ取得中...', error: null })
        const { buildBuildingMeshes, buildTerrainMesh } = await import('@machimoki/core')
        const buildingMeshes = await buildBuildingMeshes(selectionBounds, exportOptions.lod, exportOptions.excludedGmlIds)
        let terrainMesh: import('@machimoki/core').RawMesh | null = null
        if (exportOptions.includeTerrain) {
          setPipelineState({ phase: 'acquiring', progress: 30, message: '地形データ取得中...', error: null })
          terrainMesh = await buildTerrainMesh(selectionBounds, exportOptions.terrainThickness, exportOptions.flattenBottom)
        }
        setPipelineState({ phase: 'composing', progress: 50, message: '3Dモデル生成中（Worker）...', error: null })
        const { buffer, warnings } = await runWorkerExport(selectionBounds, exportOptions as unknown as import('@machimoki/core').ExportOptions, buildingMeshes, terrainMesh, (p, m) =>
          setPipelineState({ phase: 'composing', progress: 50 + p * 0.4, message: m, error: null }),
        )
        if (warnings.length > 0) console.warn('[Machimoki] warnings:', warnings)
        triggerDownload(buffer, exportOptions.format)
        setPipelineState({ phase: 'complete', progress: 100, message: '完了', error: null })
        setTimeout(() => setPipelineState({ phase: 'idle', progress: 0, message: '', error: null }), 2000)
        setIsExporting(false)
        return
      } catch (err) {
        console.warn('[Machimoki] Workerエクスポート失敗、APIフォールバックへ:', err)
        setPipelineState({ phase: 'composing', progress: 50, message: 'Worker失敗、サーバーで再試行中...', error: null })
      }
    }
    try {
      await exportModel(selectionBounds, {
        terrainThickness: parameters.terrainThickness,
        flattenBottom: parameters.flattenBottom,
        format: parameters.exportFormat,
        machimokiModelFormat: parameters.exportFormat === 'machimoki' ? '3mf' : undefined,
        lod: parameters.lod,
        includeTerrain: parameters.includeTerrain,
        buildingColor: parameters.buildingColor,
        terrainColor: parameters.terrainColor,
        upAxis: parameters.upAxis,
        scale,
        includeSpanningBuildings: parameters.includeSpanningBuildings,
        pickPoints,
        excludedGmlIds: excludedBuildingIds.length > 0 ? excludedBuildingIds : undefined,
      })
      setPipelineState({ phase: 'complete', progress: 100, message: '完了', error: null })
      setTimeout(() => setPipelineState({ phase: 'idle', progress: 0, message: '', error: null }), 2000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'エクスポートに失敗しました'
      setErrorMessage(msg)
      setPipelineState({ phase: 'error', progress: 0, message: '', error: msg })
    } finally {
      setIsExporting(false)
    }
  }, [parameters, selectionBounds, scale, pickPoints, excludedBuildingIds])

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
    Promise.all([import('manifold-3d/lib/wasm.js'), import('manifold-3d/manifold.wasm?url')])
      .then(async ([wasmMod, wasmUrlMod]) => {
        const wasmUrl = (wasmUrlMod as unknown as { default: string }).default
        console.log('[Machimoki] manifold-3dモジュール読み込み完了', wasmUrl)
        wasmMod.setWasmUrl(wasmUrl)
        const wasm = await wasmMod.getManifoldModule()
        console.log('[Machimoki] WASM setup()完了')
        manifoldRef.current = wasm
        setIsWasmLoading(false)
      })
      .catch((err: unknown) => {
        console.error('[Machimoki] WASM初期化エラー:', err)
        setIsWasmLoading(false)
        setErrorMessage(err instanceof Error ? `WASM初期化失敗: ${err.message}` : 'WASM初期化に失敗しました')
      })
      .finally(() => {
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
      mapProjection: new WebMercatorProjection(),
      skyBox: false,
    })

    viewer.scene.globe.baseColor = Color.WHITE
    viewer.scene.backgroundColor = Color.WHITE
    gsiLayerRef.current = viewer.imageryLayers.addImageryProvider(createGsiImageryProvider(gsiStyle), 0)

    applyContour(viewer, gsiStyle)

    setIsMapLoading(false)

    const ssec = viewer.scene.screenSpaceCameraController
    ssec.enableTilt = false
    ssec.enableRotate = false
    ssec.enableLook = false
    ssec.minimumZoomDistance = 300
    ssec.maximumZoomDistance = 5000000
    ssec.inertiaZoom = 0.4
    ssec.inertiaTranslate = 0.4
    ssec.inertiaSpin = 0
    ;(ssec as any).zoomFactor = 3.0

    // 勢いに応じた可変ズーム: ゆっくりは小さく、勢いよく回すと大きく
    {
      const canvas = viewer.scene.canvas as HTMLCanvasElement
      let lastWheelTime = 0
      canvas.addEventListener(
        'wheel',
        (e: WheelEvent) => {
          const now = Date.now()
          const delta = Math.abs(e.deltaY)
          const dt = Math.max(1, now - lastWheelTime)
          const velocity = delta / dt
          const factor = Math.min(10.0, Math.max(2.0, 1.8 + velocity * 0.35))
          ;(ssec as any).zoomFactor = factor
          lastWheelTime = now
        },
        { passive: true },
      )
    }

    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(139.6917, 35.6895, 8000.0),
      orientation: {
        heading: CesiumMath.toRadians(0.0),
        pitch: CesiumMath.toRadians(-90.0),
        roll: 0.0,
      },
    })

    setViewer(viewer)
    ;(window as any).__viewer = viewer

    // カバレッジオーバーレイの初期化（MVTレイヤーを試し、失敗時はEntity方式へフォールバック）
    let disposed = false

    setCoverageLoading(true)

    async function initCoverageOverlay(): Promise<CoverageOverlayHandle | null> {
      try {
        return await createCoverageMvtLayer(viewer, '/api/coverage/tiles/{z}/{x}/{y}')
      } catch (err) {
        console.warn('[Coverage] MVTレイヤー初期化失敗、Entityフォールバックへ:', err)
        if (disposed || viewer.isDestroyed()) return null
        try {
          const coverage = await getCoverageMuniCodes()
          return await createCoverageOverlay(viewer, coverage)
        } catch (fallbackErr) {
          console.warn('[CoverageOverlay] フォールバック初期化失敗:', fallbackErr)
          return null
        }
      }
    }

    // GSIタイルの読み込み完了を待ってからカバレッジを初期化する（ロード直後は白地図のみ表示）
    const waitForTilesLoaded = () =>
      new Promise<void>((resolve) => {
        let resolved = false
        const done = () => {
          if (resolved) return
          resolved = true
          resolve()
        }
        const check = () => {
          if (resolved) return
          if (viewer.scene.globe.tilesLoaded) {
            done()
            return
          }
          requestAnimationFrame(check)
        }
        // 最初のフレーム描画後にタイル読み込みが開始されるため、1フレーム待ってから確認する
        requestAnimationFrame(check)
        // フォールバック: 3秒タイムアウトで resolve
        setTimeout(done, 3000)
      })

    waitForTilesLoaded()
      .then(async () => {
        if (disposed || viewer.isDestroyed()) return
        const handle = await initCoverageOverlay()
        if (disposed || !handle) return
        if (viewer.isDestroyed()) {
          handle.remove()
          return
        }
        coverageOverlayRef.current = handle
        handle.setVisible(coverageVisibleRef.current)
      })
      .finally(() => {
        if (!disposed) setCoverageLoading(false)
      })

    return () => {
      disposed = true
      if (contourLayerRef.current) {
        try { viewer.imageryLayers.remove(contourLayerRef.current, true) } catch {}
        contourLayerRef.current = null
      }
      coverageOverlayRef.current?.remove()
      coverageOverlayRef.current = null
      gsiLayerRef.current = null
      setViewer(null)
      viewer.destroy()
    }
  }, [activeTab])

  // gsiStyle変更時にGSIレイヤーを差し替える（カバレッジMVTレイヤーには触れない）
  useEffect(() => {
    if (!viewer) return
    const oldLayer = gsiLayerRef.current
    if (oldLayer) {
      viewer.imageryLayers.remove(oldLayer, true)
    }
    gsiLayerRef.current = viewer.imageryLayers.addImageryProvider(createGsiImageryProvider(gsiStyle), 0)
    applyContour(viewer, gsiStyle)
  }, [viewer, gsiStyle])

  // 等高線デバッグパネル用のリアルタイム更新ループ（値が変わった時のみ再レンダリング）
  useEffect(() => {
    if (!viewer) return
    let raf = 0
    let lastJson = ''
    const update = () => {
      if (!viewer.isDestroyed()) {
        const info = collectContourDebugInfo(viewer, gsiStyleRef.current)
        const json = JSON.stringify(info)
        if (json !== lastJson) {
          lastJson = json
          setContourDebug(info)
        }
      }
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [viewer])

  // 他タブ（Preview3D等）とlocalStorage経由でスタイルを同期する
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== GSI_STORAGE_KEY) return
      const v = e.newValue as GsiTileStyle | null
      if (v && GSI_TILE_STYLES.includes(v)) {
        setGsiStyle(v)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Tab bar with app name */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        <div
          style={{
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: 700,
            color: 'var(--accent)',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          Machimoki
          {isDevMode && (
            <span
              data-testid="dev-badge"
              title="開発者モード有効 (Ctrl+Shift+Dで切替 / __dev.disable()で無効化)"
              style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255, 193, 7, 0.15)',
                color: '#ffc107',
                border: '1px solid rgba(255, 193, 7, 0.3)',
              }}
            >
              DEV
            </span>
          )}
        </div>
        <div style={{ display: 'flex' }}>
          {([
            ['map', '範囲選択'],
            ['preview', '3Dプレビュー'],
            ['viewer', 'モデルビューワー'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 20px',
                background: 'transparent',
                color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: activeTab === tab ? 600 : 400,
                transition: 'color 150ms ease, border-color 150ms ease',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setHelpOpen((v) => !v)}
          title={helpOpen ? '操作方法を閉じる' : '操作方法'}
          style={{
            marginLeft: 'auto',
            marginRight: '12px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: helpOpen ? 'var(--accent)' : 'transparent',
            color: helpOpen ? 'var(--text)' : 'var(--text-dim)',
            border: helpOpen ? 'none' : '1px solid var(--border-strong)',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'background 150ms ease, color 150ms ease',
          }}
        >
          ?
        </button>
      </div>

      {/* Selection bounds bar */}
      {selectionBounds && activeTab === 'map' && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--surface-solid)',
            color: 'var(--text-dim)',
            fontSize: '12px',
            borderBottom: '1px solid var(--border)',
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
          }}
        >
          選択範囲: W{selectionBounds.west.toFixed(4)} S{selectionBounds.south.toFixed(4)} E
          {selectionBounds.east.toFixed(4)} N{selectionBounds.north.toFixed(4)}
        </div>
      )}

      {/* Content area */}
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
            {/* Left cluster: raised above Cesium attribution */}
            <div
              style={{
                position: 'absolute',
                bottom: '36px',
                left: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '6px',
                zIndex: 100,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--surface)',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span style={{ color: 'var(--text-dim)' }}>地図タイル</span>
                <select
                  data-testid="gsi-style-select"
                  value={gsiStyle}
                  onChange={(e) => {
                    const style = e.target.value as GsiTileStyle
                    setGsiStyle(style)
                    saveGsiStyle(style)
                  }}
                  style={{
                    background: 'var(--border)',
                    color: 'var(--text)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '3px',
                    fontSize: '11px',
                    padding: '2px 4px',
                    cursor: 'pointer',
                  }}
                >
                  {GSI_TILE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {GSI_TILE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div
                style={{
                  background: 'var(--surface)',
                  color: 'var(--text-dim)',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  pointerEvents: 'none',
                  backdropFilter: 'blur(4px)',
                }}
              >
                Shift + ドラッグ で範囲選択
              </div>
              <button
                onClick={() => setIsPickMode((prev) => !prev)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  background: isPickMode ? 'var(--accent)' : 'var(--surface)',
                  color: 'var(--text)',
                  border: isPickMode ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {isPickMode ? '建物ピック中（地図をクリック）' : '建物をピックする'}
              </button>
              {isPickMode && (
                <div
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--text-dim)',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    pointerEvents: 'none',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  クリックした位置の建物だけをエクスポートします
                </div>
              )}
              {pickPoints.length > 0 && (
                <div
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    maxWidth: '260px',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <div style={{ marginBottom: '4px', fontWeight: 'bold' }}>
                    ピック: {pickPoints.length}件
                  </div>
                  {pickPoints.map((p, idx) => (
                    <div key={idx} style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                      {idx + 1}. lon {p.lon.toFixed(5)}, lat {p.lat.toFixed(5)}
                    </div>
                  ))}
                  <button
                    onClick={clearPickPoints}
                    style={{
                      marginTop: '6px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      background: 'var(--border)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                  >
                    クリア
                  </button>
                </div>
              )}
            </div>
            {/* Coordinate panel */}
            <div
              style={{
                position: 'absolute',
                bottom: '44px',
                right: '16px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(4px)',
                padding: '10px',
                borderRadius: '6px',
                fontSize: '12px',
                zIndex: 100,
                width: '220px',
              }}
            >
              <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>座標で選択</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
                {([
                  ['west', '西'],
                  ['east', '東'],
                  ['south', '南'],
                  ['north', '北'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <div
                      style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        marginBottom: '2px',
                        letterSpacing: '0.05em',
                      }}
                    >
                      {label}
                    </div>
                    <input
                      type="text"
                      placeholder={key === 'west' ? '139.805' : key === 'east' ? '139.808' : key === 'south' ? '35.747' : '35.749'}
                      value={manualCoords[key]}
                      onChange={(e) => setManualCoords((prev) => ({ ...prev, [key]: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '4px',
                        fontSize: '11px',
                        background: 'var(--border)',
                        color: 'var(--text)',
                        border: '1px solid var(--border-strong)',
                        borderRadius: '3px',
                      }}
                    />
                  </div>
                ))}
              </div>
              {isDevMode && (
                <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                  <button
                    data-testid="preset-adachi"
                    onClick={() => applyPreset({ west: 139.8053, south: 35.7470, east: 139.8080, north: 35.7495 })}
                    style={{
                      flex: 1,
                      padding: '4px',
                      fontSize: '10px',
                      background: 'var(--border)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                  >
                    足立区
                  </button>
                  <button
                    data-testid="preset-shinjuku"
                    onClick={() => applyPreset({ west: 139.6899, south: 35.7029, east: 139.6932, north: 35.7070 })}
                    style={{
                      flex: 1,
                      padding: '4px',
                      fontSize: '10px',
                      background: 'var(--border)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                  >
                    新宿
                  </button>
                  <button
                    data-testid="preset-tokyo"
                    onClick={() => applyPreset({ west: 139.7639, south: 35.6764, east: 139.7708, north: 35.6855 })}
                    style={{
                      flex: 1,
                      padding: '4px',
                      fontSize: '10px',
                      background: 'var(--border)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                  >
                    東京駅
                  </button>
                </div>
              )}
              <button
                onClick={handleManualSelect}
                style={{
                  width: '100%',
                  padding: '6px',
                  fontSize: '11px',
                  background: 'var(--accent)',
                  color: 'var(--text)',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                適用
              </button>
            </div>
            {/* Attribution bar */}
            <div
              style={{
                position: 'absolute',
                bottom: '26px',
                right: '4px',
                fontSize: '10px',
                color: 'var(--text-dim)',
                background: 'rgba(0, 0, 0, 0.35)',
                padding: '2px 6px',
                borderRadius: '3px',
                zIndex: 90,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {GSI_ATTRIBUTION} / © PLATEAU / © Cesium
            </div>
            {/* Coverage overlay panel */}
            <div
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(4px)',
                padding: '10px',
                borderRadius: '6px',
                fontSize: '12px',
                zIndex: 100,
                width: '200px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}
              >
                <span style={{ fontWeight: 'bold' }}>カバレッジ表示</span>
                <button
                  onClick={toggleCoverage}
                  title={coverageVisible ? 'カバレッジ表示をオフにする' : 'カバレッジ表示をオンにする'}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    background: coverageVisible ? 'var(--accent)' : 'var(--border)',
                    color: 'var(--text)',
                    border: coverageVisible ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
                    borderRadius: '3px',
                    fontWeight: 600,
                  }}
                >
                  {coverageVisible ? 'ON' : 'OFF'}
                </button>
              </div>
              {coverageLoading && (
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '6px' }}>
                  カバレッジデータを読み込み中...
                </div>
              )}
              {coverageVisible && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div
                      style={{
                        width: '18px',
                        height: '12px',
                        border: '2px solid #4fc3f7',
                        borderRadius: '2px',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>整備済みエリア</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div
                      style={{
                        width: '18px',
                        height: '12px',
                        background: 'rgba(128,128,128,0.35)',
                        borderRadius: '2px',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>未整備エリア</span>
                  </div>
                </div>
              )}
            </div>
            <ContourDebugPanel
              info={contourDebug}
              collapsed={contourDebugCollapsed}
              onToggle={() => setContourDebugCollapsed((v) => !v)}
            />
          </div>
        )}
        {activeTab === 'preview' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              {!selectionBounds && !isMapLoading && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '16px',
                    color: 'var(--text-dim)',
                    zIndex: 10,
                    background: 'var(--bg)',
                  }}
                >
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M9 3v18M3 9h18" />
                  </svg>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: '14px', fontWeight: 500, color: 'var(--text)' }}>
                      範囲が選択されていません
                    </p>
                    <p style={{ margin: '8px 0 0', fontSize: '13px' }}>
                      「範囲選択」タブで地図上の範囲を指定してください
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveTab('map')}
                    style={{
                      marginTop: '4px',
                      padding: '8px 20px',
                      background: 'var(--accent)',
                      color: 'var(--text)',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    範囲選択へ移動
                  </button>
                </div>
              )}
              <Preview3D
                selectionBounds={selectionBounds}
                lod={parameters.lod}
                manifoldRef={manifoldRef}
                onPipelineStateChange={setPipelineState}
                showTerrainImagery={parameters.showTerrainImagery}
                terrainThickness={parameters.terrainThickness}
                flattenBottom={parameters.flattenBottom}
                includeTerrain={parameters.includeTerrain}
                buildingColor={parameters.buildingColor}
                terrainColor={parameters.terrainColor}
                scale={scale}
                onScaleChange={setScale}
                includeSpanningBuildings={parameters.includeSpanningBuildings}
                pickPoints={pickPoints}
                excludedBuildingIds={excludedBuildingIds}
                onExcludedBuildingIdsChange={setExcludedBuildingIds}
              />
              <LoadingOverlay
                message={pipelineState.message}
                visible={pipelineState.phase !== 'idle' && pipelineState.phase !== 'complete'}
                progress={pipelineState.progress}
              />
              <LoadingOverlay
                message="エクスポート中..."
                visible={isExporting && pipelineState.phase === 'idle'}
              />
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
              availableLods={availableLods}
            />
          </div>
        )}
        {activeTab === 'viewer' && (
          <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
            <ModelViewer manifoldRef={manifoldRef} />
          </div>
        )}
        <HelpPanel mode={activeTab} isOpen={helpOpen} />
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
