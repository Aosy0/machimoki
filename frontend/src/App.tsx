import { useEffect, useRef, useState, useCallback } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import Preview3D from './components/Preview3D'
import ModelViewer from './components/ModelViewer'
import ParameterPanel from './components/ParameterPanel'
import type { Parameters } from './components/ParameterPanel'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorToast from './components/ErrorToast'
import HelpPanel from './components/HelpPanel'
import Map2D from './components/Map2D'
import { exportModel } from './lib/apiClient'
import { runWorkerExport, triggerDownload } from './lib/workerExport'
import { useMapLibreRectangleSelection } from './hooks/useMapLibreRectangleSelection'
import type { SelectionBounds } from './lib/selectionBounds'
import { useDeveloperMode } from './hooks/useDeveloperMode'
import type { PipelineState } from './types/pipeline'
import { getAvailableLods, type Lod } from './lib/catalogApi'
import { LOD_CATEGORY_ORDER, LOD_CATEGORY_STYLES } from './lib/coverageCategories'
import {
  ensureCoverageLayer,
  setCoverageLayerVisible,
  coverageTilesTemplate,
} from './lib/coverageMapLibre'
import {
  ensurePickOverlay,
  ensureSelectionOverlay,
  type PickPoint,
} from './lib/mapSelectionLayers'
import {
  coerceCurrentViewBounds,
  coercePresetBounds,
  parseManualCoords,
} from './lib/mapSelectionInput'

type Tab = 'map' | 'preview' | 'viewer'

/** カバレッジ配信のベースURL（coverageMvtLayerと同規則）。 */
function coverageApiBase(): string {
  const envBase = (
    import.meta as { env?: { VITE_COVERAGE_API_BASE?: string } }
  ).env?.VITE_COVERAGE_API_BASE
  if (envBase !== undefined && envBase !== '') {
    return envBase
  }
  if (
    typeof window !== 'undefined' &&
    window.location.hostname === 'localhost'
  ) {
    return 'https://machimoki.aosy.f5.si'
  }
  return ''
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [isWasmLoading, setIsWasmLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [coverageVisible, setCoverageVisible] = useState(true)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [mapLibreMap, setMapLibreMap] = useState<MapLibreMap | null>(null)
  const [mapFailed, setMapFailed] = useState(false)

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

  const coverageAvailableRef = useRef(false)
  const coverageProbedMapRef = useRef<MapLibreMap | null>(null)
  const manifoldRef = useRef<any>(null)
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
  } = useMapLibreRectangleSelection(mapLibreMap)

  const handlePickPoint = useCallback((point: PickPoint) => {
    setPickPoints((prev) => [...prev, point])
  }, [])

  const clearPickPoints = useCallback(() => {
    setPickPoints([])
  }, [])

  useEffect(() => {
    setExcludedBuildingIds([])
  }, [selectionBounds])

  useEffect(() => {
    if (!mapLibreMap) return
    ensureSelectionOverlay(mapLibreMap, selectionBounds)
  }, [mapLibreMap, selectionBounds])

  useEffect(() => {
    if (!mapLibreMap) return
    ensurePickOverlay(mapLibreMap, pickPoints)
  }, [mapLibreMap, pickPoints])

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
    const result = parseManualCoords(manualCoords)
    if (!result.ok) {
      setErrorMessage(result.error)
      return
    }
    setSelectionBounds(result.bounds)
    setErrorMessage(null)
  }, [manualCoords, setSelectionBounds])

  const applyPreset = useCallback((preset: { west: number; south: number; east: number; north: number }) => {
    try {
      const bounds = coercePresetBounds(preset)
      setManualCoords({
        west: bounds.west.toString(),
        south: bounds.south.toString(),
        east: bounds.east.toString(),
        north: bounds.north.toString(),
      })
      setSelectionBounds(bounds)
      setErrorMessage(null)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'プリセットの適用に失敗しました')
    }
  }, [setSelectionBounds])

  const handleSelectCurrentBounds = useCallback((bounds: { west: number; south: number; east: number; north: number }) => {
    const result = coerceCurrentViewBounds(bounds)
    if (!result.ok) {
      setErrorMessage(result.error)
      return
    }
    setSelectionBounds(result.bounds)
    setErrorMessage(null)
  }, [setSelectionBounds])

  useEffect(() => {
    const target = window as unknown as {
      __applyPreset?: (preset: SelectionBounds) => void
    }
    target.__applyPreset = applyPreset
    return () => {
      try {
        delete target.__applyPreset
      } catch {
        /* ignore */
      }
    }
  }, [applyPreset])

  const toggleCoverage = useCallback(() => {
    setCoverageVisible((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!mapLibreMap) return
    setCoverageLayerVisible(mapLibreMap, coverageVisible)
  }, [mapLibreMap, coverageVisible])

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
    let workerError: unknown = null
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
        workerError = err
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
      let msg = err instanceof Error ? err.message : 'エクスポートに失敗しました'
      if (msg.includes('Origin server not configured') && workerError) {
        const wMsg = workerError instanceof Error ? workerError.message : String(workerError)
        msg = `ブラウザ側エクスポート失敗: ${wMsg}（サーバーフォールバックも利用不可のため範囲を小さくして再試行してください）`
      }
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

  const handleMapReady = useCallback((map: MapLibreMap) => {
    setMapFailed(false)
    setMapLibreMap(map)
  }, [])

  const handleMapUnload = useCallback(() => {
    setMapLibreMap(null)
  }, [])

  const handleWebGLFailure = useCallback(() => {
    setMapFailed(true)
  }, [])

  // タブ復帰時に hidden だった地図・3Dビューをリサイズする。
  // Preview3D / Map2D はマウント維持＋display切替のため、再表示直後は
  // コンテナサイズが 0 のままになり得る。ここで resize して復元する。
  useEffect(() => {
    if (activeTab === 'map' && mapLibreMap) {
      const id = requestAnimationFrame(() => {
        try {
          mapLibreMap.resize()
        } catch {
          /* ignore */
        }
      })
      return () => cancelAnimationFrame(id)
    }
    if (activeTab === 'preview') {
      const id = requestAnimationFrame(() => {
        try {
          const viewer = (window as unknown as { __cesiumViewer?: { resize?: () => void; scene?: { requestRender?: () => void } } }).__cesiumViewer
          viewer?.resize?.()
          viewer?.scene?.requestRender?.()
        } catch {
          /* ignore */
        }
        try {
          window.dispatchEvent(new Event('resize'))
        } catch {
          /* ignore */
        }
      })
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [activeTab, mapLibreMap])

  useEffect(() => {
    if (!mapLibreMap || activeTab !== 'map') return
    const map = mapLibreMap
    let disposed = false

    const reapplyAfterStyleChange = (): void => {
      if (disposed) return
      ensureSelectionOverlay(map, selectionBounds)
      ensurePickOverlay(map, pickPoints)
      if (coverageAvailableRef.current) {
        ensureCoverageLayer(map, {
          visible: coverageVisible,
          detailed: true,
          tiles: coverageTilesTemplate(coverageApiBase()),
        })
      }
    }

    map.on('styledata', reapplyAfterStyleChange)

    if (coverageProbedMapRef.current !== map) {
      coverageProbedMapRef.current = map
      coverageAvailableRef.current = false
      setCoverageLoading(true)
      const init = (): void => {
        fetch(`${coverageApiBase()}/api/coverage`)
          .then((res) => {
            if (!res.ok || disposed) return
            const ok = ensureCoverageLayer(map, {
              visible: coverageVisible,
              detailed: true,
              tiles: coverageTilesTemplate(coverageApiBase()),
            })
            coverageAvailableRef.current = ok
          })
          .catch(() => {
            /* カバレッジ取得の失敗は表示のみ。exportはブロックしない */
          })
          .finally(() => {
            if (!disposed) setCoverageLoading(false)
          })
      }
      try {
        if (map.isStyleLoaded()) {
          init()
        } else {
          map.once('load', () => {
            if (!disposed) {
              init()
            }
          })
        }
      } catch {
        setCoverageLoading(false)
      }
    }

    return () => {
      disposed = true
      try {
        map.off('styledata', reapplyAfterStyleChange)
      } catch {
        /* ignore */
      }
    }
  }, [mapLibreMap, activeTab, selectionBounds, pickPoints, coverageVisible])

  useEffect(() => {
    if (!mapLibreMap || activeTab !== 'map' || !isPickMode) return
    const handleMapClick = (event: MapMouseEvent): void => {
      if (event.originalEvent.shiftKey) return
      handlePickPoint({ lon: event.lngLat.lng, lat: event.lngLat.lat })
    }
    mapLibreMap.on('click', handleMapClick)
    return () => {
      try {
        mapLibreMap.off('click', handleMapClick)
      } catch {
        /* ignore */
      }
    }
  }, [mapLibreMap, activeTab, isPickMode, handlePickPoint])

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

      {/* Content area: マウント維持＋display切替。アンマウントするとViewer破棄で再読込になるため */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            display: activeTab === 'map' ? 'block' : 'none',
          }}
        >
            <Map2D
              onMapReady={handleMapReady}
              onMapUnload={handleMapUnload}
              onWebGLFailure={handleWebGLFailure}
              onSelectCurrentBounds={handleSelectCurrentBounds}
            />
            {mapFailed && (
              <div
                style={{
                  position: 'absolute',
                  top: '16px',
                  left: '16px',
                  background: 'var(--surface)',
                  color: 'var(--text-dim)',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  zIndex: 100,
                  backdropFilter: 'blur(4px)',
                }}
              >
                地図描画に失敗しました。座標入力・プリセットで範囲を指定できます。
              </div>
            )}
            {/* Left cluster: raised above attribution */}
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
                  {LOD_CATEGORY_ORDER.map((category) => {
                    const style = LOD_CATEGORY_STYLES[category]
                    return (
                      <div key={category} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div
                          style={{
                            width: '18px',
                            height: '12px',
                            background: style.fill,
                            border: `2px solid ${style.outline}`,
                            borderRadius: '2px',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: 'var(--text-dim)', fontSize: '11px' }}>{style.label}</span>
                      </div>
                    )
                  })}
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                    整備状況をLoD別に色分けしています
                  </div>
                </div>
              )}
            </div>
          </div>
        <div style={{ display: activeTab === 'preview' ? 'flex' : 'none', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              {!selectionBounds && (
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
        <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, display: activeTab === 'viewer' ? 'block' : 'none' }}>
            <ModelViewer manifoldRef={manifoldRef} />
          </div>
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
