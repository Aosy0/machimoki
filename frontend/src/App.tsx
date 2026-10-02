import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import Preview3D, { DEFAULT_BUILDING_COLOR } from './components/Preview3D'
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
import {
  adaptiveTerrainGridSize,
  boundsMaxDimMeters,
  isLargeRange,
  resolveTerrainGridSize,
} from './lib/previewBudget'
import { LOD_CATEGORY_ORDER, LOD_CATEGORY_STYLES } from './lib/coverageCategories'
import {
  ensureCoverageLayer,
  setCoverageLayerVisible,
  coverageTilesTemplate,
} from './lib/coverageMapLibre'
import {
  ensureSelectionHover,
  ensureSelectionOverlay,
  type PickPoint,
} from './lib/mapSelectionLayers'
import type { ResizeHandle } from './lib/mapSelectionResize'
import {
  coerceCurrentViewBounds,
  coercePresetBounds,
  parseManualCoords,
} from './lib/mapSelectionInput'

type Tab = 'map' | 'preview'

/** カバレッジ配信のベースURL（coverageMvtLayerと同規則）。 */
function coverageApiBase(): string {
  const envBase = (import.meta as { env?: { VITE_COVERAGE_API_BASE?: string } }).env
    ?.VITE_COVERAGE_API_BASE
  if (envBase !== undefined && envBase !== '') {
    return envBase
  }
  if (
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.port === '5173')
  ) {
    return 'https://machimoki.aosy.f5.si'
  }
  return ''
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [coverageVisible, setCoverageVisible] = useState(true)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [mapLibreMap, setMapLibreMap] = useState<MapLibreMap | null>(null)
  const [mapFailed, setMapFailed] = useState(false)

  const [parameters, setParameters] = useState<Parameters>({
    terrainThickness: 10,
    flattenBottom: true,
    reflectActualElevation: false,
    terrainGridSize: null,
    includeTerrain: true,
    showTerrainImagery: false,
    lod: 'lod1',
    exportFormat: '3mf',
    buildingColor: DEFAULT_BUILDING_COLOR,
    terrainColor: '#ffffff',
    whiteModel: false,
    upAxis: 'z-up',
    includeSpanningBuildings: false,
  })

  const coverageAvailableRef = useRef(false)
  const coverageProbedMapRef = useRef<MapLibreMap | null>(null)
  // ピックUIは廃止したため常に空。エクスポート引数の形は維持する。
  const [pickPoints] = useState<PickPoint[]>([])
  const [excludedBuildingIds, setExcludedBuildingIds] = useState<string[]>([])
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

  // ホバー中の辺・角を強調する。styledata再適用用にrefへ保持する。
  const hoverHandleRef = useRef<ResizeHandle | null>(null)
  const selectionBoundsRef = useRef<SelectionBounds | null>(null)

  // リサイズ中のライブプレビュー（確定は従来どおりフック内で行う）。
  // 単一ソースへ hover 込みで1回だけ setData する（全レイヤー同一リビジョン）。
  const handleSelectionPreview = useCallback(
    (bounds: SelectionBounds) => {
      selectionBoundsRef.current = bounds
      if (!mapLibreMap) return
      ensureSelectionOverlay(mapLibreMap, bounds, hoverHandleRef.current)
    },
    [mapLibreMap],
  )

  const handleSelectionHover = useCallback(
    (handle: ResizeHandle | null) => {
      hoverHandleRef.current = handle
      if (!mapLibreMap) return
      ensureSelectionHover(mapLibreMap, selectionBoundsRef.current, handle)
    },
    [mapLibreMap],
  )

  const {
    selectionBounds,
    setSelectionBounds,
    errorMessage: selectionErrorMessage,
    clearError: clearSelectionError,
  } = useMapLibreRectangleSelection(mapLibreMap, handleSelectionPreview, handleSelectionHover)

  useEffect(() => {
    setExcludedBuildingIds([])
  }, [selectionBounds])

  useEffect(() => {
    if (!mapLibreMap) return
    selectionBoundsRef.current = selectionBounds
    if (selectionBounds === null) {
      hoverHandleRef.current = null
    }
    ensureSelectionOverlay(mapLibreMap, selectionBounds, hoverHandleRef.current)
  }, [mapLibreMap, selectionBounds])

  useEffect(() => {
    if (!selectionBounds) return
    const centerLat = (selectionBounds.north + selectionBounds.south) / 2
    const widthDeg = selectionBounds.east - selectionBounds.west
    const heightDeg = selectionBounds.north - selectionBounds.south
    const widthM =
      Math.abs(widthDeg) * (Math.PI / 180) * 6371000 * Math.cos((centerLat * Math.PI) / 180)
    const depthM = Math.abs(heightDeg) * (Math.PI / 180) * 6371000
    const maxDim = Math.max(widthM, depthM)
    if (maxDim > 0) {
      setScale(150 / (maxDim * 1000))
    }
  }, [selectionBounds])

  useEffect(() => {
    if (!selectionBounds) return
    if (isLargeRange(selectionBounds)) return

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

  const applyPreset = useCallback(
    (preset: { west: number; south: number; east: number; north: number }) => {
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
    },
    [setSelectionBounds],
  )

  const handleSelectCurrentBounds = useCallback(
    (bounds: { west: number; south: number; east: number; north: number }) => {
      const result = coerceCurrentViewBounds(bounds)
      if (!result.ok) {
        setErrorMessage(result.error)
        return
      }
      setSelectionBounds(result.bounds)
      setErrorMessage(null)
    },
    [setSelectionBounds],
  )

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

  const autoTerrainGridSize = useMemo(
    () => (selectionBounds ? adaptiveTerrainGridSize(boundsMaxDimMeters(selectionBounds)) : 128),
    [selectionBounds],
  )
  const resolvedTerrainGridSize = useMemo(
    () =>
      selectionBounds
        ? resolveTerrainGridSize(parameters.terrainGridSize, boundsMaxDimMeters(selectionBounds))
        : 128,
    [selectionBounds, parameters.terrainGridSize],
  )

  const handleExport = useCallback(async () => {
    if (!selectionBounds) {
      setErrorMessage('エクスポートする前に地図で範囲を選択してください')
      return
    }
    setIsExporting(true)
    setErrorMessage(null)
    setPipelineState({
      phase: 'composing',
      progress: 0,
      message: 'エクスポート準備中...',
      error: null,
    })
    const exportOptions = {
      terrainThickness: parameters.terrainThickness,
      flattenBottom: parameters.flattenBottom,
      reflectActualElevation: parameters.reflectActualElevation,
      terrainGridSize: resolvedTerrainGridSize,
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
        setPipelineState({
          phase: 'acquiring',
          progress: 5,
          message: '建物データ取得中...',
          error: null,
        })
        const { buildBuildingMeshes, buildTerrainMesh } = await import('@machimoki/core')
        const buildingMeshes = await buildBuildingMeshes(
          selectionBounds,
          exportOptions.lod,
          exportOptions.excludedGmlIds,
        )
        let terrainMesh: import('@machimoki/core').RawMesh | null = null
        if (exportOptions.includeTerrain) {
          setPipelineState({
            phase: 'acquiring',
            progress: 30,
            message: '地形データ取得中...',
            error: null,
          })
          // terrainThickness is user-facing printed mm; convert to model-space meters (same formula as core).
          const terrainThicknessMeters = parameters.terrainThickness / (scale * 1000)
          terrainMesh = await buildTerrainMesh(
            selectionBounds,
            terrainThicknessMeters,
            exportOptions.flattenBottom,
            exportOptions.terrainGridSize,
            exportOptions.reflectActualElevation,
          )
        }
        setPipelineState({
          phase: 'composing',
          progress: 50,
          message: '3Dモデル生成中（Worker）...',
          error: null,
        })
        const { buffer, warnings } = await runWorkerExport(
          selectionBounds,
          exportOptions as unknown as import('@machimoki/core').ExportOptions,
          buildingMeshes,
          terrainMesh,
          (p, m) =>
            setPipelineState({
              phase: 'composing',
              progress: 50 + p * 0.4,
              message: m,
              error: null,
            }),
        )
        if (warnings.length > 0) console.warn('[Machimoki] warnings:', warnings)
        triggerDownload(buffer, exportOptions.format)
        setPipelineState({ phase: 'complete', progress: 100, message: '完了', error: null })
        setTimeout(
          () => setPipelineState({ phase: 'idle', progress: 0, message: '', error: null }),
          2000,
        )
        setIsExporting(false)
        return
      } catch (err) {
        workerError = err
        console.warn('[Machimoki] Workerエクスポート失敗、APIフォールバックへ:', err)
        setPipelineState({
          phase: 'composing',
          progress: 50,
          message: 'Worker失敗、サーバーで再試行中...',
          error: null,
        })
      }
    }
    try {
      await exportModel(selectionBounds, {
        terrainThickness: parameters.terrainThickness,
        flattenBottom: parameters.flattenBottom,
        reflectActualElevation: parameters.reflectActualElevation,
        terrainGridSize: resolvedTerrainGridSize,
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
      setTimeout(
        () => setPipelineState({ phase: 'idle', progress: 0, message: '', error: null }),
        2000,
      )
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
  }, [parameters, selectionBounds, scale, pickPoints, excludedBuildingIds, resolvedTerrainGridSize])

  const displayErrorMessage = errorMessage || selectionErrorMessage || pipelineState.error
  const handleDismissError = () => {
    setErrorMessage(null)
    clearSelectionError()
    if (pipelineState.phase === 'error') {
      setPipelineState((prev) => ({ ...prev, phase: 'idle', error: null }))
    }
  }

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
          const viewer = (
            window as unknown as {
              __cesiumViewer?: { resize?: () => void; scene?: { requestRender?: () => void } }
            }
          ).__cesiumViewer
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
      // ドラッグ中のプレビューを巻き戻さないよう、確定stateではなく最新値(ref)を使う
      ensureSelectionOverlay(map, selectionBoundsRef.current, hoverHandleRef.current)
      const coverageReady = ensureCoverageLayer(map, {
        visible: coverageVisible,
        detailed: true,
        tiles: coverageTilesTemplate(coverageApiBase()),
      })
      coverageAvailableRef.current = coverageReady
    }

    map.on('styledata', reapplyAfterStyleChange)

    // パン/ズームでハンドルの間引き（可視性）が変わるため再適用する。
    // 差分キャッシュにより実更新は閾値跨ぎ時のみ。
    const handleViewChange = (): void => {
      if (disposed) return
      ensureSelectionOverlay(map, selectionBoundsRef.current, hoverHandleRef.current)
    }
    map.on('move', handleViewChange)
    map.on('resize', handleViewChange)

    if (coverageProbedMapRef.current !== map) {
      coverageProbedMapRef.current = map
      coverageAvailableRef.current = false
      setCoverageLoading(true)
      const init = (): void => {
        if (!map.isStyleLoaded()) return
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
        map.once('idle', () => {
          if (!disposed) init()
        })
      } catch {
        setCoverageLoading(false)
      }
    }

    return () => {
      disposed = true
      try {
        map.off('styledata', reapplyAfterStyleChange)
        map.off('move', handleViewChange)
        map.off('resize', handleViewChange)
      } catch {
        /* ignore */
      }
    }
  }, [mapLibreMap, activeTab, selectionBounds, coverageVisible])

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
          {(
            [
              ['map', '範囲選択'],
              ['preview', '3Dプレビュー'],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 20px',
                background: 'transparent',
                color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                border: 'none',
                borderBottom:
                  activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
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
      {isDevMode && selectionBounds && activeTab === 'map' && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--surface-solid)',
            color: 'var(--text-dim)',
            fontSize: '14px',
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
                fontSize: '13px',
                zIndex: 100,
                backdropFilter: 'blur(4px)',
              }}
            >
              地図描画に失敗しました。座標入力・プリセットで範囲を指定できます。
            </div>
          )}
          {/* Coordinate panel */}
          <div
            data-testid="map2d-coord-panel"
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
              fontSize: '14px',
              zIndex: 100,
              width: '240px',
            }}
          >
            <div style={{ marginBottom: '6px', fontWeight: 'bold' }}>座標で選択</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                marginBottom: '6px',
              }}
            >
              {(
                [
                  ['west', '西'],
                  ['east', '東'],
                  ['south', '南'],
                  ['north', '北'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      marginBottom: '2px',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {label}
                  </div>
                  <input
                    type="text"
                    placeholder={
                      key === 'west'
                        ? '139.805'
                        : key === 'east'
                          ? '139.808'
                          : key === 'south'
                            ? '35.747'
                            : '35.749'
                    }
                    value={manualCoords[key]}
                    onChange={(e) =>
                      setManualCoords((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    style={{
                      width: '100%',
                      padding: '4px',
                      fontSize: '13px',
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
                  onClick={() =>
                    applyPreset({ west: 139.8053, south: 35.747, east: 139.808, north: 35.7495 })
                  }
                  style={{
                    flex: 1,
                    padding: '4px',
                    fontSize: '12px',
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
                  onClick={() =>
                    applyPreset({ west: 139.6899, south: 35.7029, east: 139.6932, north: 35.707 })
                  }
                  style={{
                    flex: 1,
                    padding: '4px',
                    fontSize: '12px',
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
                  onClick={() =>
                    applyPreset({ west: 139.7639, south: 35.6764, east: 139.7708, north: 35.6855 })
                  }
                  style={{
                    flex: 1,
                    padding: '4px',
                    fontSize: '12px',
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
                fontSize: '13px',
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
            <div
              data-testid="map2d-drag-hint"
              style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}
            >
              Shift + ドラッグ で範囲選択
            </div>
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
              fontSize: '14px',
              zIndex: 100,
              width: '220px',
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
                title={
                  coverageVisible ? 'カバレッジ表示をオフにする' : 'カバレッジ表示をオンにする'
                }
                style={{
                  padding: '4px 10px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  background: coverageVisible ? 'var(--accent)' : 'var(--border)',
                  color: 'var(--text)',
                  border: coverageVisible
                    ? '1px solid var(--accent)'
                    : '1px solid var(--border-strong)',
                  borderRadius: '3px',
                  fontWeight: 600,
                }}
              >
                {coverageVisible ? 'ON' : 'OFF'}
              </button>
            </div>
            {coverageLoading && (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '6px' }}>
                カバレッジデータを読み込み中...
              </div>
            )}
            {coverageVisible && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {LOD_CATEGORY_ORDER.map((category) => {
                  const style = LOD_CATEGORY_STYLES[category]
                  return (
                    <div
                      key={category}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
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
                      <span style={{ color: 'var(--text-dim)', fontSize: '13px' }}>
                        {style.label}
                      </span>
                    </div>
                  )
                })}
                <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  整備状況をLoD別に色分けしています
                </div>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            display: activeTab === 'preview' ? 'flex' : 'none',
            width: '100%',
            height: '100%',
          }}
        >
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
              onPipelineStateChange={setPipelineState}
              showTerrainImagery={parameters.showTerrainImagery}
              terrainThickness={parameters.terrainThickness}
              flattenBottom={parameters.flattenBottom}
              reflectActualElevation={parameters.reflectActualElevation}
              terrainGridSize={parameters.terrainGridSize}
              includeTerrain={parameters.includeTerrain}
              buildingColor={parameters.buildingColor}
              terrainColor={parameters.terrainColor}
              whiteModel={parameters.whiteModel}
              scale={scale}
              onScaleChange={setScale}
              includeSpanningBuildings={parameters.includeSpanningBuildings}
              pickPoints={pickPoints}
              excludedBuildingIds={excludedBuildingIds}
              onExcludedBuildingIdsChange={setExcludedBuildingIds}
              isDevMode={isDevMode}
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
            autoTerrainGridSize={autoTerrainGridSize}
          />
        </div>
        <HelpPanel mode={activeTab} isOpen={helpOpen} />
      </div>

      <ErrorToast
        message={displayErrorMessage}
        onDismiss={handleDismissError}
        onRetry={pipelineState.phase === 'error' ? handleDismissError : undefined}
      />
    </div>
  )
}

export default App
