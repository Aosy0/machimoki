import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import Preview3D, { DEFAULT_BUILDING_COLOR, type SceneLoadState } from './components/Preview3D'
import ParameterPanel from './components/ParameterPanel'
import type { Parameters } from './components/ParameterPanel'
import LoadingOverlay from './components/LoadingOverlay'
import ErrorToast from './components/ErrorToast'
import HelpDetail from './components/HelpDetail'
import Map2D from './components/Map2D'
import MapSelectionInfoOverlay from './components/MapSelectionInfoOverlay'
import MapModeControl from './components/MapModeControl'
import Icon from './components/ui/Icon'
import CoordinateSelectionPanel from './components/CoordinateSelectionPanel'
import CoverageLegendPanel from './components/CoverageLegendPanel'
import { exportModel } from './lib/apiClient'
import { runWorkerExport, runWorkerSerialize, triggerDownload } from './lib/workerExport'
import { finalShapeGeometryKey } from './lib/finalShapeKey'
import { loadFinalShapeCache } from './lib/finalShapeCache'
import { loadBuildingMeshes, loadLayerMeshes, loadTerrainMesh } from './lib/meshDataCache'
import { LAYER_COLORS } from './lib/layerColors'
import EngravingPanel from './components/EngravingPanel'
import type { EngravingLine, EngravingOptions } from '../../core/src/engraving/types.ts'
import { defaultEngravingOptions } from '../../core/src/engraving/types.ts'
import type { EngravingFont } from '../../core/src/engraving/font.ts'
import type { EngravingLayout } from '../../core/src/engraving/layout.ts'
import { layoutEngraving } from '../../core/src/engraving/layout.ts'
import { computeEngravingFaceDims } from '../../core/src/engraving/faces.ts'
import { buildAutoTexts, defaultEngravingLines, resolvePlaceName } from './lib/engravingContent'
import { loadEngravingFont } from './lib/engravingFontClient'
import { buildGlyphPathMap } from './lib/engravingSvg'
import type { EngravingOverlayData } from './lib/engraving3dOverlay'
import { anchorEngravingBlock, type EngravingCorner } from './lib/engravingEditor'
import {
  useMapLibreRectangleSelection,
  type MapInteractionMode,
} from './hooks/useMapLibreRectangleSelection'
import { useHasCoarsePointer, useIsCompactLayout } from './hooks/useMediaQuery'
import { usePreviewQuality } from './hooks/usePreviewQuality'
import type { SelectionBounds } from './lib/selectionBounds'
import { useDeveloperMode } from './hooks/useDeveloperMode'
import type { PipelineState } from './types/pipeline'
import { getAvailableLods, getLayerAvailability, type LayerType, type Lod } from './lib/catalogApi'
import {
  adaptiveTerrainGridSize,
  boundsMaxDimMeters,
  isLargeRange,
  resolveTerrainGridSize,
} from './lib/previewBudget'
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
import {
  COARSE_HANDLE_METRICS,
  FINE_HANDLE_METRICS,
  type ResizeHandle,
} from './lib/mapSelectionResize'
import { coercePresetBounds, parseManualCoords } from './lib/mapSelectionInput'
import { computeModelDimensions } from './lib/selectionBounds'

type Tab = 'map' | 'preview'

// タブの並び順・表示名・対応するパネルID（ARIA の参照に使う）
const TABS = [
  { id: 'map', label: '範囲選択', panelId: 'panel-map' },
  { id: 'preview', label: '3Dプレビュー', panelId: 'panel-preview' },
] as const

// リロードで選択範囲・設定・タブが失われないよう localStorage に保存する。
const SELECTION_STORAGE_KEY = 'machimoki.selectionBounds'
const PARAMETERS_STORAGE_KEY = 'machimoki.parameters'
const TAB_STORAGE_KEY = 'machimoki.activeTab'

/** プレビュー下部の読み込み表示（パイプライン・追加読み込みで共通）。 */
const PREVIEW_LOAD_INDICATOR_STYLE = {
  position: 'absolute',
  left: '50%',
  bottom: '16px',
  transform: 'translateX(-50%)',
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 12px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-panel)',
  color: 'var(--text-dim)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  pointerEvents: 'none',
  maxWidth: 'calc(100% - 32px)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const

const DEFAULT_PARAMETERS: Parameters = {
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
  upAxis: 'z-up',
  includeSpanningBuildings: false,
  openBottom: false,
  shellThickness: 1.6,
  hollowBuildings: true,
  splitAtGround: false,
  engraving: defaultEngravingOptions(),
}

/** 保存済みの選択範囲を読む（不正値は null）。 */
function loadStoredSelectionBounds(): SelectionBounds | null {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY)
    if (!raw) return null
    const b = JSON.parse(raw) as Partial<SelectionBounds>
    if (
      typeof b.west === 'number' &&
      typeof b.south === 'number' &&
      typeof b.east === 'number' &&
      typeof b.north === 'number' &&
      Number.isFinite(b.west) &&
      Number.isFinite(b.south) &&
      Number.isFinite(b.east) &&
      Number.isFinite(b.north) &&
      b.west < b.east &&
      b.south < b.north
    ) {
      return { west: b.west, south: b.south, east: b.east, north: b.north }
    }
  } catch {
    void 0
  }
  return null
}

/** 保存済みのパラメータを既定値にマージして読む。 */
function loadStoredParameters(): Parameters {
  try {
    const raw = localStorage.getItem(PARAMETERS_STORAGE_KEY)
    if (!raw) return DEFAULT_PARAMETERS
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const stored = parsed as Partial<Parameters>
      const storedEngraving = stored.engraving
      return {
        ...DEFAULT_PARAMETERS,
        ...stored,
        engraving: {
          ...DEFAULT_PARAMETERS.engraving,
          ...(storedEngraving ?? {}),
          lines: Array.isArray(storedEngraving?.lines) ? storedEngraving.lines : [],
          printProfile: {
            ...DEFAULT_PARAMETERS.engraving.printProfile,
            ...(storedEngraving?.printProfile ?? {}),
          },
        },
      }
    }
  } catch {
    void 0
  }
  return DEFAULT_PARAMETERS
}

/** 保存済みのタブを読む。 */
function loadStoredTab(): Tab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY)
    if (raw === 'map' || raw === 'preview') return raw
  } catch {
    void 0
  }
  return 'map'
}

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
  const [activeTab, setActiveTab] = useState<Tab>(loadStoredTab)
  const [previewMounted, setPreviewMounted] = useState(activeTab === 'preview')
  const [isExporting, setIsExporting] = useState(false)
  // Preview3D の重い処理（最終形状・断面・中空シェル）が進行中か。
  const [previewBusy, setPreviewBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [coverageVisible, setCoverageVisible] = useState(true)
  const [mapLibreMap, setMapLibreMap] = useState<MapLibreMap | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const isCompact = useIsCompactLayout()
  const hasCoarsePointer = useHasCoarsePointer()
  const [mapMode, setMapMode] = useState<MapInteractionMode>('move')
  const previewQuality = usePreviewQuality()
  const [mapSheet, setMapSheet] = useState<'coords' | 'legend' | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const handleMetrics = hasCoarsePointer ? COARSE_HANDLE_METRICS : FINE_HANDLE_METRICS

  const [parameters, setParameters] = useState<Parameters>(loadStoredParameters)
  // 刻印エディタの下書き（「反映」まで完成形状には適用しない）。
  const [engravingDraft, setEngravingDraft] = useState<EngravingOptions>(() => parameters.engraving)
  // 選択範囲の地名（刻印の自動内容用。取得できなければ null）。
  const [placeName, setPlaceName] = useState<string | null>(null)
  // 刻印面ビューの再実行用カウンタ（面切替・刻印モード開始で増やす）。
  const [engravingViewNonce, setEngravingViewNonce] = useState(0)
  // 刻印モード（専用UI）。適用済み設定（parameters.engraving）とは別に持つ。
  const [engravingMode, setEngravingMode] = useState(false)
  // 3Dオーバーレイ用の刻印フォント（刻印モードON時に遅延読み込み）。
  const [engravingFont, setEngravingFont] = useState<EngravingFont | null>(null)

  // 設定とタブを保存する（リロードで復元する）。
  useEffect(() => {
    try {
      localStorage.setItem(PARAMETERS_STORAGE_KEY, JSON.stringify(parameters))
    } catch {
      void 0
    }
  }, [parameters])
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    } catch {
      void 0
    }
  }, [activeTab])

  // タブのキーボード移動でフォーカスを移すための参照。
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ map: null, preview: null })
  // モバイルの設定シートを <dialog> として開くための参照。
  const settingsDialogRef = useRef<HTMLDialogElement | null>(null)
  // 閉じたあとにフォーカスを戻すための、設定を開くボタンの参照。
  const openSettingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const restoreSettingsFocusRef = useRef(false)
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

  // 設定シートは <dialog> のモーダル表示にして、フォーカスの閉じ込めと Esc での閉じる操作を任せる。
  useEffect(() => {
    const dialog = settingsDialogRef.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    const handleClose = () => {
      // ダイアログ内の要素は閉じると消えるため、ブラウザ任せのフォーカス復帰は
      // body に落ちる。開いたボタンへ明示的に戻す。
      restoreSettingsFocusRef.current = true
      setSettingsOpen(false)
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [isCompact, settingsOpen, engravingMode])

  // 設定シートを閉じたあと、開いたボタンが再表示されてからフォーカスを戻す。
  useEffect(() => {
    if (settingsOpen || !restoreSettingsFocusRef.current) return
    restoreSettingsFocusRef.current = false
    openSettingsButtonRef.current?.focus()
  }, [settingsOpen])

  // ヘッドレス動作確認（frontend/scripts/verify-ui.mjs）から完了状態を参照するための公開。
  useEffect(() => {
    ;(window as unknown as { __pipelineState?: PipelineState }).__pipelineState = pipelineState
  }, [pipelineState])

  const [scale, setScale] = useState(1)
  const [availableLods, setAvailableLods] = useState<Lod[]>(['lod1', 'lod2'])
  // Preview3D側で建物が表示できない範囲（サイズ・データ量起因）になったとき true。
  // 地形解像度の自動値とエクスポートに反映する。
  const [terrainResolutionBoost, setTerrainResolutionBoost] = useState(false)
  // 3Dプレビューの建物表示ON/OFF（サイドパネルのトグル）。
  const [buildingsVisible, setBuildingsVisible] = useState(true)
  // 3Dプレビューの影表示ON/OFF（サイドパネルのトグル）。
  const [shadowsVisible, setShadowsVisible] = useState(true)
  // 3Dプレビューの橋梁・道路の重ね表示ON/OFF（サイドパネルのトグル）。
  const [bridgesVisible, setBridgesVisible] = useState(false)
  const [roadsVisible, setRoadsVisible] = useState(false)
  // 橋・道路・地図画像のタイル読み込み状態（プレビュー下部に表示する）。
  const [sceneLoad, setSceneLoad] = useState<SceneLoadState>({
    bridges: false,
    roads: false,
    imagery: false,
  })
  // 選択範囲の自治体が橋梁・道路の3Dデータを整備しているか。
  const [layerAvailability, setLayerAvailability] = useState<Record<LayerType, boolean>>({
    brid: false,
    tran: false,
  })
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
  // 寸法ラベルへのライブ更新口（作成ドラッグ中・リサイズ中に使う）。
  const selectionInfoPreviewRef = useRef<((bounds: SelectionBounds | null) => void) | null>(null)

  // リサイズ中のライブプレビュー（確定は従来どおりフック内で行う）。
  // 単一ソースへ hover 込みで1回だけ setData する（全レイヤー同一リビジョン）。
  const handleSelectionPreview = useCallback(
    (bounds: SelectionBounds) => {
      selectionBoundsRef.current = bounds
      selectionInfoPreviewRef.current?.(bounds)
      if (!mapLibreMap) return
      ensureSelectionOverlay(mapLibreMap, bounds, hoverHandleRef.current, handleMetrics)
    },
    [mapLibreMap, handleMetrics],
  )

  const handleSelectionHover = useCallback(
    (handle: ResizeHandle | null) => {
      hoverHandleRef.current = handle
      if (!mapLibreMap) return
      ensureSelectionHover(mapLibreMap, selectionBoundsRef.current, handle, handleMetrics)
    },
    [mapLibreMap, handleMetrics],
  )

  // 作成ドラッグ中の寸法ラベル用プレビュー（GeoJSONオーバーレイには触れない）。
  const handleSelectionDrawPreview = useCallback((bounds: SelectionBounds | null) => {
    selectionInfoPreviewRef.current?.(bounds)
  }, [])

  const [storedSelectionBounds] = useState(loadStoredSelectionBounds)
  const {
    selectionBounds,
    setSelectionBounds,
    errorMessage: selectionErrorMessage,
    clearError: clearSelectionError,
    selectCurrentView,
    reset: resetSelection,
  } = useMapLibreRectangleSelection(
    mapLibreMap,
    handleSelectionPreview,
    handleSelectionHover,
    handleSelectionDrawPreview,
    mapMode,
  )

  // 3Dプレビューは一度開いた後もマウントを維持するが、非アクティブ中の
  // 選択変更では再読み込みしない（3Dタブに戻った時だけ最新範囲を反映する）。
  const [previewBounds, setPreviewBounds] = useState<SelectionBounds | null>(null)
  useEffect(() => {
    if (activeTab === 'preview') setPreviewBounds(selectionBounds)
  }, [activeTab, selectionBounds])

  // リロード後も選択範囲を復元する（プレビューが空に見えるのを防ぐ）。
  const restoredSelectionRef = useRef(false)
  useEffect(() => {
    if (restoredSelectionRef.current) return
    restoredSelectionRef.current = true
    if (storedSelectionBounds && selectionBounds === null) {
      setSelectionBounds(storedSelectionBounds)
    }
  }, [])

  // 選択範囲を保存する（リロードで失われないように）。
  useEffect(() => {
    try {
      if (selectionBounds) {
        localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(selectionBounds))
      } else {
        localStorage.removeItem(SELECTION_STORAGE_KEY)
      }
    } catch {
      void 0
    }
  }, [selectionBounds])

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

  // 適用済みの刻印設定が変わったら下書きを追従させる（反映・解除・リロード時）。
  const appliedEngravingRef = useRef(parameters.engraving)
  useEffect(() => {
    if (appliedEngravingRef.current === parameters.engraving) return
    appliedEngravingRef.current = parameters.engraving
    setEngravingDraft(parameters.engraving)
  }, [parameters.engraving])

  // 刻印モード中は面が変わるたびに3Dプレビューのカメラをその面へ向ける。
  useEffect(() => {
    if (!engravingMode) return
    setEngravingViewNonce((nonce) => nonce + 1)
  }, [engravingMode, engravingDraft.face])

  // 3Dオーバーレイ用の刻印フォントを刻印モードON時に読み込む（初回のみ）。
  useEffect(() => {
    if (!engravingMode || engravingFont) return
    let cancelled = false
    loadEngravingFont()
      .then((font) => {
        if (!cancelled) setEngravingFont(font)
      })
      .catch(() => {
        // フォント読込エラーはエディタ側で表示する。
      })
    return () => {
      cancelled = true
    }
  }, [engravingMode, engravingFont])

  // 選択範囲の地名を取得する（刻印の既定タイトル用）。
  useEffect(() => {
    if (!selectionBounds) {
      setPlaceName(null)
      return
    }
    let cancelled = false
    resolvePlaceName(selectionBounds)
      .then((name) => {
        if (!cancelled) setPlaceName(name)
      })
      .catch(() => {
        if (!cancelled) setPlaceName(null)
      })
    return () => {
      cancelled = true
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

  // 選択範囲に橋梁・道路の3Dデータがあるかを調べ、未整備ならトグルをOFFに戻す。
  useEffect(() => {
    if (!selectionBounds) {
      setLayerAvailability({ brid: false, tran: false })
      return
    }
    let cancelled = false
    getLayerAvailability(selectionBounds)
      .then((availability) => {
        if (cancelled) return
        setLayerAvailability(availability)
        if (!availability.brid) setBridgesVisible(false)
        if (!availability.tran) setRoadsVisible(false)
      })
      .catch(() => {
        if (!cancelled) setLayerAvailability({ brid: false, tran: false })
      })
    return () => {
      cancelled = true
    }
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

  // 建物が表示できない範囲（サイズ・データ量起因）では自動の地形解像度を最高（256分割）にする
  const autoTerrainGridSize = useMemo(
    () =>
      selectionBounds
        ? terrainResolutionBoost
          ? 256
          : adaptiveTerrainGridSize(boundsMaxDimMeters(selectionBounds))
        : 128,
    [selectionBounds, terrainResolutionBoost],
  )
  const resolvedTerrainGridSize = useMemo(() => {
    if (!selectionBounds) return 128
    if (parameters.terrainGridSize == null && terrainResolutionBoost) return 256
    return resolveTerrainGridSize(parameters.terrainGridSize, boundsMaxDimMeters(selectionBounds))
  }, [selectionBounds, parameters.terrainGridSize, terrainResolutionBoost])

  // 刻印エディタ用の面寸法・自動内容。
  const engravingModelDims = useMemo(() => {
    const dims = selectionBounds ? computeModelDimensions(selectionBounds, scale) : null
    return {
      widthMm: dims?.widthMm ?? 0,
      depthMm: dims?.depthMm ?? 0,
      terrainThicknessMm: parameters.terrainThickness,
      shellThicknessMm: parameters.shellThickness,
      hasTerrain: parameters.includeTerrain,
      flatBottom: parameters.flattenBottom || parameters.reflectActualElevation,
      openBottom: parameters.openBottom,
      splitAtGround: parameters.openBottom && parameters.splitAtGround,
    }
  }, [
    selectionBounds,
    scale,
    parameters.terrainThickness,
    parameters.shellThickness,
    parameters.includeTerrain,
    parameters.flattenBottom,
    parameters.reflectActualElevation,
    parameters.openBottom,
    parameters.splitAtGround,
  ])
  const engravingFaces = useMemo(
    () => computeEngravingFaceDims(engravingModelDims),
    [engravingModelDims],
  )
  const engravingAutoTexts = useMemo(
    () =>
      selectionBounds
        ? buildAutoTexts(
            selectionBounds,
            scale,
            engravingModelDims.widthMm,
            engravingModelDims.depthMm,
            parameters.terrainThickness,
            placeName,
          )
        : {},
    [selectionBounds, scale, engravingModelDims, parameters.terrainThickness, placeName],
  )
  const engravingApplied = useMemo(
    () => JSON.stringify(parameters.engraving) === JSON.stringify(engravingDraft),
    [parameters.engraving, engravingDraft],
  )
  // 3Dオーバーレイ用: 下書きのレイアウトとグリフ輪郭（3D上での位置調整に使う）。
  const engravingDraftFaceDims = useMemo(
    () => engravingFaces.find((dims) => dims.face === engravingDraft.face) ?? null,
    [engravingFaces, engravingDraft.face],
  )
  const engravingDraftLayout = useMemo<EngravingLayout | null>(
    () =>
      engravingFont && engravingDraftFaceDims
        ? layoutEngraving(engravingDraftFaceDims, engravingDraft, engravingFont)
        : null,
    [engravingFont, engravingDraftFaceDims, engravingDraft],
  )
  const engravingOverlay = useMemo<EngravingOverlayData | null>(() => {
    if (!engravingMode || !engravingDraftLayout) return null
    if (!engravingFont) return null
    const glyphPaths = buildGlyphPathMap(engravingFont, engravingDraftLayout)
    return {
      face: engravingDraft.face,
      faceWidthMm: engravingDraftLayout.faceWidthMm,
      faceHeightMm: engravingDraftLayout.faceHeightMm,
      layout: engravingDraftLayout,
      glyphPaths,
      overflow:
        engravingDraftLayout.overflowX ||
        engravingDraftLayout.overflowY ||
        engravingDraftLayout.unsupportedChars.length > 0,
    }
  }, [engravingMode, engravingDraft.face, engravingDraftLayout, engravingFont])
  // 3Dモデル上のドラッグで決まったブロック中心（使用可能領域内の0..1）。
  const handleEngravingPositionChange = useCallback((centerX: number, centerY: number) => {
    setEngravingDraft((prev) =>
      prev.centerX === centerX && prev.centerY === centerY ? prev : { ...prev, centerX, centerY },
    )
  }, [])
  // 3Dの四隅ハンドル: 拡大後のレイアウトで、固定した対角の位置を保つよう中心を置き直す。
  const handleEngravingResize = useCallback(
    (lines: EngravingLine[], fixedCorner: EngravingCorner) => {
      const faceDims = engravingDraftFaceDims
      const font = engravingFont
      if (!faceDims || !font) return
      setEngravingDraft((prev) => {
        const next = { ...prev, lines }
        if (prev.lines.length === 0) return next
        const currentLayout = layoutEngraving(faceDims, prev, font)
        const nextLayout = layoutEngraving(faceDims, next, font)
        return anchorEngravingBlock(next, currentLayout, nextLayout, fixedCorner)
      })
    },
    [engravingDraftFaceDims, engravingFont],
  )
  // 刻印モードのズーム（タッチ端末でも使えるようにボタンから呼ぶ）。
  const zoomEngravingView = useCallback((factor: number) => {
    const controls = (
      window as unknown as {
        __previewControls?: { zoomEngraving?: (value: number) => boolean }
      }
    ).__previewControls
    controls?.zoomEngraving?.(factor)
  }, [])
  const handleEngravingApply = useCallback(() => {
    setParameters((prev) => ({ ...prev, engraving: { ...engravingDraft, enabled: true } }))
  }, [engravingDraft])
  // 刻印モード開始: 適用済み設定（無ければ既定の内容）を下書きにして専用UIへ。
  const enterEngravingMode = useCallback(() => {
    const applied = parameters.engraving
    const base = applied.enabled ? applied : defaultEngravingOptions()
    const lines = base.lines.length > 0 ? base.lines : defaultEngravingLines(engravingAutoTexts)
    setEngravingDraft({ ...base, lines, enabled: true })
    setEngravingMode(true)
    setEngravingViewNonce((nonce) => nonce + 1)
    setSettingsOpen(false)
  }, [parameters.engraving, engravingAutoTexts])
  // 刻印モード終了: 未反映の変更は破棄し、適用済み設定に戻す。
  const exitEngravingMode = useCallback(() => {
    setEngravingMode(false)
    setEngravingDraft(parameters.engraving)
  }, [parameters.engraving])
  // 適用済みの刻印を削除する（通常の設定パネルから）。
  const handleEngravingDelete = useCallback(() => {
    setEngravingMode(false)
    setParameters((prev) => ({ ...prev, engraving: { ...prev.engraving, enabled: false } }))
  }, [])
  // 刻印ONにした直後に内容が空なら既定の内容（地名・座標など）を入れる。
  const handleParametersChange = useCallback(
    (params: Parameters) => {
      if (params.engraving.enabled && params.engraving.lines.length === 0) {
        setParameters({
          ...params,
          engraving: { ...params.engraving, lines: defaultEngravingLines(engravingAutoTexts) },
        })
        return
      }
      setParameters(params)
    },
    [engravingAutoTexts],
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
      message: 'エクスポート準備中…',
      error: null,
    })
    const useWorker = parameters.exportFormat !== 'machimoki'
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
      openBottom: parameters.openBottom,
      shellThickness: parameters.shellThickness,
      hollowBuildings: parameters.hollowBuildings,
      splitAtGround: parameters.openBottom && parameters.splitAtGround,
      pickPoints,
      excludedGmlIds: excludedBuildingIds.length > 0 ? excludedBuildingIds : undefined,
      engraving: parameters.engraving.enabled ? parameters.engraving : undefined,
      // 橋梁・道路はローカル（Worker）生成だけが形状/色に反映する。machimoki は API 経路。
      ...(useWorker
        ? {
            includeBridges: bridgesVisible,
            includeRoads: roadsVisible,
            bridgeColor: LAYER_COLORS.brid,
            roadColor: LAYER_COLORS.tran,
          }
        : {}),
    }
    // 層はキャッシュ済みの完成メッシュに含まれないため、層ONではキャッシュ経路を使わない。
    const layerExportActive = useWorker && (bridgesVisible || roadsVisible)
    let workerError: unknown = null
    // 完成メッシュの永続キャッシュを照会し、ヒットしたら取得と形状生成を
    // スキップしてシリアライズのみ行う（プレビューと同一キーで共有）。
    if (useWorker && !layerExportActive) {
      let cachedMesh: {
        positions: Float32Array
        indices: Uint32Array
        terrainMesh: { positions: Float32Array; indices: Uint32Array } | null
        split: {
          frame: { positions: Float32Array; indices: Uint32Array }
          buildings: { positions: Float32Array; indices: Uint32Array }
        } | null
      } | null = null
      try {
        const geometryKey = finalShapeGeometryKey({
          bounds: selectionBounds,
          lod: exportOptions.lod,
          excludedBuildingIds: exportOptions.excludedGmlIds,
          includeSpanningBuildings: exportOptions.includeSpanningBuildings,
          terrainThickness: exportOptions.terrainThickness,
          flattenBottom: exportOptions.flattenBottom,
          reflectActualElevation: exportOptions.reflectActualElevation,
          terrainGridSize: exportOptions.terrainGridSize,
          includeTerrain: exportOptions.includeTerrain,
          scale,
          openBottom: exportOptions.openBottom,
          shellThickness: exportOptions.shellThickness,
          hollowBuildings: exportOptions.hollowBuildings,
          splitAtGround: exportOptions.splitAtGround,
          engraving: exportOptions.engraving,
        })
        const cached = await loadFinalShapeCache(geometryKey)
        if (cached) {
          cachedMesh = {
            positions: cached.positions,
            indices: cached.indices,
            terrainMesh: cached.terrainMesh,
            split: cached.split ?? null,
          }
        }
      } catch {
        cachedMesh = null
      }
      // 分割はキャッシュ済みパーツを再利用する。旧キャッシュなどで無い場合は
      // フル生成へ回す（合体メッシュからの再分割は建物カッターが無く穴が空かない）。
      if (cachedMesh && exportOptions.splitAtGround && !cachedMesh.split) {
        cachedMesh = null
      }
      if (cachedMesh) {
        try {
          setPipelineState({
            phase: 'composing',
            progress: 50,
            message: '3Dモデル生成中（キャッシュ利用）…',
            error: null,
          })
          // バッファは transfer で切り離されるため、コピーを渡す。
          const { buffer, split } = await runWorkerSerialize(
            Date.now(),
            {
              positions: cachedMesh.positions.slice(),
              indices: cachedMesh.indices.slice(),
            },
            cachedMesh.terrainMesh
              ? {
                  positions: cachedMesh.terrainMesh.positions.slice(),
                  indices: cachedMesh.terrainMesh.indices.slice(),
                }
              : null,
            exportOptions as unknown as import('@machimoki/core').ExportOptions,
            cachedMesh.split
              ? {
                  frame: {
                    positions: cachedMesh.split.frame.positions.slice(),
                    indices: cachedMesh.split.frame.indices.slice(),
                  },
                  buildings: {
                    positions: cachedMesh.split.buildings.positions.slice(),
                    indices: cachedMesh.split.buildings.indices.slice(),
                  },
                }
              : null,
          )
          triggerDownload(buffer, exportOptions.format, split)
          setPipelineState({ phase: 'complete', progress: 100, message: '完了', error: null })
          setTimeout(
            () => setPipelineState({ phase: 'idle', progress: 0, message: '', error: null }),
            2000,
          )
          setIsExporting(false)
          return
        } catch (err) {
          console.warn('[Machimoki] キャッシュからのシリアライズ失敗、フル生成へ:', err)
        }
      }
    }
    if (useWorker) {
      try {
        setPipelineState({
          phase: 'acquiring',
          progress: 5,
          message: '建物データ取得中…',
          error: null,
        })
        // 建物/地形はプレビューと共有するインメモリキャッシュから取得する
        // （同じ条件ならプレビュー側の取得結果を再利用し、二重取得しない）。
        const meshParams = {
          bounds: selectionBounds,
          lod: exportOptions.lod,
          excludedGmlIds: exportOptions.excludedGmlIds,
          includeTerrain: exportOptions.includeTerrain,
          terrainThicknessMeters: parameters.terrainThickness / (scale * 1000),
          flattenBottom: exportOptions.flattenBottom,
          terrainGridSize: exportOptions.terrainGridSize,
          reflectActualElevation: exportOptions.reflectActualElevation,
        }
        const buildingMeshes = await loadBuildingMeshes(meshParams)
        let terrainMesh: import('@machimoki/core').RawMesh | null = null
        if (exportOptions.includeTerrain) {
          setPipelineState({
            phase: 'acquiring',
            progress: 30,
            message: '地形データ取得中…',
            error: null,
          })
          terrainMesh = await loadTerrainMesh(meshParams)
        }
        let layerMeshes: import('@machimoki/core').LayerMeshes | null = null
        if (layerExportActive) {
          setPipelineState({
            phase: 'acquiring',
            progress: 40,
            message: '橋梁・道路データ取得中…',
            error: null,
          })
          // 橋梁と道路は取得元が別なので並列に取る（同じ条件ならキャッシュを再利用）。
          const [brid, tran] = await Promise.all([
            bridgesVisible
              ? loadLayerMeshes({ ...meshParams, layer: 'brid' })
              : Promise.resolve([] as import('@machimoki/core').RawMesh[]),
            roadsVisible
              ? loadLayerMeshes({ ...meshParams, layer: 'tran' })
              : Promise.resolve([] as import('@machimoki/core').RawMesh[]),
          ])
          layerMeshes = { brid, tran }
        }
        setPipelineState({
          phase: 'composing',
          progress: 50,
          message: '3Dモデル生成中（Worker）…',
          error: null,
        })
        const { buffer, warnings, split } = await runWorkerExport(
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
          layerMeshes,
        )
        if (warnings.length > 0) console.warn('[Machimoki] warnings:', warnings)
        triggerDownload(buffer, exportOptions.format, split)
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
        if (layerExportActive) {
          // API 経路は層オプションを受け取らないため、フォールバックでは層が落ちる。
          console.warn('[Machimoki] warnings:', [
            'サーバー再試行では橋梁・道路が反映されない場合があります',
          ])
        }
        setPipelineState({
          phase: 'composing',
          progress: 50,
          message: 'Worker失敗、サーバーで再試行中…',
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
        openBottom: parameters.openBottom,
        shellThickness: parameters.shellThickness,
        hollowBuildings: parameters.hollowBuildings,
        splitAtGround: parameters.openBottom && parameters.splitAtGround,
        pickPoints,
        excludedGmlIds: excludedBuildingIds.length > 0 ? excludedBuildingIds : undefined,
        engraving: parameters.engraving.enabled ? parameters.engraving : undefined,
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
  }, [
    parameters,
    selectionBounds,
    scale,
    pickPoints,
    excludedBuildingIds,
    resolvedTerrainGridSize,
    bridgesVisible,
    roadsVisible,
  ])

  const displayErrorMessage = errorMessage || selectionErrorMessage || pipelineState.error
  // 重い処理が進行中なら、他のタスクの complete/background に上書きされても
  // オーバーレイを維持する。pipelineState が完了済みの間は汎用メッセージを出す。
  const previewBusyOverlay = previewBusy && pipelineState.phase !== 'error'
  const previewBusyFallback =
    previewBusyOverlay && (pipelineState.phase === 'idle' || pipelineState.phase === 'complete')
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

  const closeHelp = useCallback(() => setHelpOpen(false), [])
  const toggleHelp = useCallback(() => {
    setMapSheet(null)
    setHelpOpen((prev) => !prev)
  }, [])
  // タブ切替時にヘルプを閉じる（別画面の内容が一瞬出ないように）。
  const handleTabChange = useCallback((tab: Tab) => {
    setHelpOpen(false)
    setActiveTab(tab)
    if (tab === 'preview') setPreviewMounted(true)
  }, [])
  // タブは左右キーとHome/Endで循環移動し、移動と同時に切り替える（automatic activation）。
  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, tab: Tab) => {
      const index = TABS.findIndex((item) => item.id === tab)
      let nextIndex: number | null = null
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
      else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = TABS.length - 1
      if (nextIndex === null) return
      event.preventDefault()
      const nextTab = TABS[nextIndex].id
      handleTabChange(nextTab)
      tabRefs.current[nextTab]?.focus()
    },
    [handleTabChange],
  )

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
        /* スタイル未完了などで購読できなくても表示だけの問題に留める */
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

  // 刻印バナーのボタンはタッチで44px、ポインタで40px（アイコンは32px）。
  const bannerButtonHeight = hasCoarsePointer ? 44 : 40
  const bannerIconSize = hasCoarsePointer ? 44 : 32

  const sceneLoadParts: string[] = []
  if (sceneLoad.bridges) sceneLoadParts.push('橋')
  if (sceneLoad.roads) sceneLoadParts.push('道路')
  if (sceneLoad.imagery) sceneLoadParts.push(parameters.showTerrainImagery ? '航空写真' : '地図')
  const sceneLoadLabel =
    sceneLoadParts.length > 0 ? `${sceneLoadParts.join('・')}を読み込み中…` : null
  // パイプラインの既存表示が出ている間は、追加読み込みの表示を重ねない。
  const pipelineLoadIndicatorVisible =
    !previewBusy &&
    (pipelineState.background ||
      (pipelineState.phase !== 'idle' &&
        pipelineState.phase !== 'complete' &&
        pipelineState.phase !== 'error'))

  return (
    <div className="app-root">
      {/* Tab bar with app name */}
      <header
        className="app-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
          flexShrink: 0,
        }}
      >
        {/* キーボードではヘッダーのタブを飛ばして本文へ移れるようにする */}
        <a className="skip-link" href="#main-content">
          本文へ移動
        </a>
        <h1
          style={{
            margin: 0,
            padding: isCompact ? '8px 12px' : '12px 16px',
            fontSize: 16,
            fontWeight: 500,
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Machimoki
          {isDevMode && (
            <span
              data-testid="dev-badge"
              title="開発者モード有効 (Ctrl+Shift+Dで切替 / __dev.disable()で無効化)"
              style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}
            >
              DEV
            </span>
          )}
        </h1>
        <div role="tablist" aria-label="表示モード" style={{ display: 'flex', flexShrink: 0 }}>
          {TABS.map(({ id, label, panelId }) => (
            <button
              key={id}
              ref={(node) => {
                tabRefs.current[id] = node
              }}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={panelId}
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => handleTabChange(id)}
              onKeyDown={(event) => handleTabKeyDown(event, id)}
              style={{
                padding: isCompact ? '8px 12px' : '12px 16px',
                background: 'transparent',
                color: activeTab === id ? 'var(--text)' : 'var(--text-dim)',
                border: 'none',
                borderBottom:
                  activeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                transition: 'color 120ms ease, border-color 120ms ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="help-trigger"
          aria-label="ヘルプ"
          aria-expanded={helpOpen}
          aria-controls={helpOpen ? 'help-detail' : undefined}
          onClick={toggleHelp}
          style={{
            marginLeft: 'auto',
            marginRight: isCompact ? 8 : 12,
            width: isCompact ? 44 : 32,
            height: isCompact ? 44 : 32,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border-strong)',
            background: helpOpen ? 'var(--border)' : 'transparent',
            color: helpOpen ? 'var(--text)' : 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
            transition: 'background-color 120ms ease, color 120ms ease',
          }}
        >
          <Icon name="help" size={16} />
        </button>
      </header>

      {/* Selection bounds bar */}
      {isDevMode && !isCompact && selectionBounds && activeTab === 'map' && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--surface-solid)',
            color: 'var(--text-dim)',
            fontSize: 12,
            borderBottom: '1px solid var(--border)',
            fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          選択範囲: W{selectionBounds.west.toFixed(4)} S{selectionBounds.south.toFixed(4)} E
          {selectionBounds.east.toFixed(4)} N{selectionBounds.north.toFixed(4)}
        </div>
      )}

      {/* Content area: マウント維持＋display切替。アンマウントするとViewer破棄で再読込になるため */}
      <main
        id="main-content"
        tabIndex={-1}
        data-testid="app-content"
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
      >
        <div
          id="panel-map"
          role="tabpanel"
          aria-labelledby="tab-map"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: タブパネルもキーボードで到達できるようにする（Biome の誤検知）
          tabIndex={0}
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
          />
          <MapSelectionInfoOverlay
            map={mapLibreMap}
            bounds={selectionBounds}
            scale={scale}
            previewRef={selectionInfoPreviewRef}
            onClear={resetSelection}
          />
          {mapFailed && (
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                background: 'var(--surface-solid)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-panel)',
                fontSize: 13,
                zIndex: 100,
              }}
            >
              <div style={{ fontWeight: 500 }}>地図を描画できません</div>
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)' }}>
                座標入力で指定できます
              </div>
            </div>
          )}
          <MapModeControl
            mode={mapMode}
            onChange={setMapMode}
            isCompact={isCompact}
            hasCoarsePointer={hasCoarsePointer}
            onSelectCurrentView={selectCurrentView}
            coordsOpen={mapSheet === 'coords'}
            legendOpen={mapSheet === 'legend'}
            onToggleCoords={() => setMapSheet((prev) => (prev === 'coords' ? null : 'coords'))}
            onToggleLegend={() => setMapSheet((prev) => (prev === 'legend' ? null : 'legend'))}
          />
          {!isCompact && (
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
                padding: 12,
                borderRadius: 'var(--radius-panel)',
                fontSize: 14,
                zIndex: 100,
                width: '240px',
              }}
            >
              <CoordinateSelectionPanel
                manualCoords={manualCoords}
                onCoordChange={(key, value) =>
                  setManualCoords((prev) => ({ ...prev, [key]: value }))
                }
                onApply={handleManualSelect}
                applyPreset={applyPreset}
                isDevMode={isDevMode}
                hasCoarsePointer={hasCoarsePointer}
              />
            </div>
          )}
          {isCompact && mapSheet === 'coords' && (
            <div
              data-testid="map2d-coord-sheet"
              style={{
                position: 'absolute',
                left: '8px',
                right: '8px',
                bottom: 'calc(104px + env(safe-area-inset-bottom))',
                maxHeight: '52dvh',
                overflowY: 'auto',
                background: 'var(--surface-solid)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: 12,
                borderRadius: 'var(--radius-panel)',
                fontSize: 14,
                zIndex: 220,
              }}
            >
              <CoordinateSelectionPanel
                manualCoords={manualCoords}
                onCoordChange={(key, value) =>
                  setManualCoords((prev) => ({ ...prev, [key]: value }))
                }
                onApply={handleManualSelect}
                applyPreset={applyPreset}
                isDevMode={isDevMode}
                hasCoarsePointer={hasCoarsePointer}
                onClose={() => setMapSheet(null)}
              />
            </div>
          )}
          {!isCompact && (
            <div
              data-testid="coverage-legend-panel"
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(4px)',
                padding: 12,
                borderRadius: 'var(--radius-panel)',
                fontSize: 14,
                zIndex: 100,
                width: '220px',
              }}
            >
              <CoverageLegendPanel coverageVisible={coverageVisible} onToggle={toggleCoverage} />
            </div>
          )}
          {isCompact && mapSheet === 'legend' && (
            <div
              data-testid="coverage-legend-sheet"
              style={{
                position: 'absolute',
                left: '8px',
                right: '8px',
                bottom: 'calc(104px + env(safe-area-inset-bottom))',
                maxHeight: '52dvh',
                overflowY: 'auto',
                background: 'var(--surface-solid)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                padding: 12,
                borderRadius: 'var(--radius-panel)',
                fontSize: 14,
                zIndex: 220,
              }}
            >
              <CoverageLegendPanel
                coverageVisible={coverageVisible}
                onToggle={toggleCoverage}
                onClose={() => setMapSheet(null)}
              />
            </div>
          )}
          <HelpDetail mode="map" isOpen={helpOpen && activeTab === 'map'} onClose={closeHelp} />
        </div>
        <div
          id="panel-preview"
          role="tabpanel"
          aria-labelledby="tab-preview"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: タブパネルもキーボードで到達できるようにする（Biome の誤検知）
          tabIndex={0}
          style={{
            display: activeTab === 'preview' ? 'flex' : 'none',
            width: '100%',
            height: '100%',
            position: 'relative',
            flexDirection: isCompact ? 'column' : 'row',
          }}
        >
          <div style={{ flex: 1, position: 'relative' }}>
            {!selectionBounds && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-dim)',
                  fontSize: 14,
                  zIndex: 10,
                  background: 'var(--bg)',
                }}
              >
                範囲が選択されていません
              </div>
            )}
            {previewMounted && (
              <Preview3D
                selectionBounds={previewBounds}
                quality={previewQuality.profile}
                lod={parameters.lod}
                onPipelineStateChange={setPipelineState}
                showTerrainImagery={parameters.showTerrainImagery}
                terrainThickness={parameters.terrainThickness}
                flattenBottom={parameters.flattenBottom}
                reflectActualElevation={parameters.reflectActualElevation}
                openBottom={parameters.openBottom}
                shellThickness={parameters.shellThickness}
                hollowBuildings={parameters.hollowBuildings}
                splitAtGround={parameters.openBottom && parameters.splitAtGround}
                terrainGridSize={resolvedTerrainGridSize}
                includeTerrain={parameters.includeTerrain}
                buildingColor={parameters.buildingColor}
                terrainColor={parameters.terrainColor}
                scale={scale}
                onScaleChange={setScale}
                includeSpanningBuildings={parameters.includeSpanningBuildings}
                pickPoints={pickPoints}
                excludedBuildingIds={excludedBuildingIds}
                onExcludedBuildingIdsChange={setExcludedBuildingIds}
                isDevMode={isDevMode}
                onTerrainResolutionBoostChange={setTerrainResolutionBoost}
                buildingsVisible={buildingsVisible}
                onBuildingsVisibleChange={setBuildingsVisible}
                bridgesVisible={bridgesVisible}
                roadsVisible={roadsVisible}
                onSceneLoadChange={setSceneLoad}
                shadowsVisible={shadowsVisible}
                onBusyChange={setPreviewBusy}
                engraving={parameters.engraving.enabled ? parameters.engraving : null}
                engravingMode={engravingMode}
                engravingView={
                  engravingMode ? { face: engravingDraft.face, nonce: engravingViewNonce } : null
                }
                engravingOverlay={engravingOverlay}
                onEngravingPositionChange={handleEngravingPositionChange}
                onEngravingResize={handleEngravingResize}
              />
            )}
            {engravingMode && (
              // 刻印モード専用バナー（モード表示・エクスポート・終了）
              <div
                data-testid="engraving-mode-banner"
                style={{
                  position: 'absolute',
                  top: isCompact ? 8 : 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 70,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: isCompact ? 4 : 8,
                  padding: 4,
                  maxWidth: 'calc(100% - 32px)',
                  borderRadius: 'var(--radius-panel)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-solid)',
                  color: 'var(--text)',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  animation: 'machimoki-engraving-banner-in 140ms ease-out',
                }}
              >
                <span style={{ padding: '0 8px', fontWeight: 500 }}>刻印モード</span>
                {!isCompact && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>視点固定</span>
                )}
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <button
                    type="button"
                    data-testid="engraving-zoom-in"
                    onClick={() => zoomEngravingView(0.8)}
                    aria-label="拡大"
                    style={{
                      width: bannerIconSize,
                      height: bannerIconSize,
                      padding: 0,
                      borderRadius: 'var(--radius-control)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                  <button
                    type="button"
                    data-testid="engraving-zoom-out"
                    onClick={() => zoomEngravingView(1.25)}
                    aria-label="縮小"
                    style={{
                      width: bannerIconSize,
                      height: bannerIconSize,
                      padding: 0,
                      borderRadius: 'var(--radius-control)',
                      border: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <Icon name="minus" size={16} />
                  </button>
                </span>
                <button
                  type="button"
                  data-testid="engraving-export-button"
                  onClick={handleExport}
                  disabled={!engravingApplied || isExporting}
                  title={
                    engravingApplied ? undefined : '変更を反映してからエクスポートしてください'
                  }
                  style={{
                    height: bannerButtonHeight,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-control)',
                    border: 'none',
                    background: engravingApplied ? 'var(--accent)' : 'var(--border)',
                    color: engravingApplied ? 'var(--accent-ink)' : 'var(--text-muted)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: engravingApplied ? 'pointer' : 'not-allowed',
                  }}
                >
                  エクスポート
                </button>
                <button
                  type="button"
                  data-testid="engraving-exit-button"
                  onClick={exitEngravingMode}
                  style={{
                    height: bannerButtonHeight,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid var(--border-strong)',
                    background: 'transparent',
                    color: 'var(--text)',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  終了
                </button>
              </div>
            )}
            {engravingMode && selectionBounds && (
              <div
                className="engraving-panel"
                style={
                  isCompact
                    ? {
                        position: 'absolute',
                        left: 8,
                        right: 8,
                        bottom: 'calc(64px + env(safe-area-inset-bottom))',
                        maxHeight: '70dvh',
                        zIndex: 260,
                        display: 'flex',
                        flexDirection: 'column',
                        borderRadius: 'var(--radius-panel)',
                        border: '1px solid var(--border)',
                        overflow: 'hidden',
                        // 背後のW/D表示などが透けないよう不透明にする。
                        background: 'var(--bg)',
                        animation: 'machimoki-engraving-panel-in 140ms ease-out',
                      }
                    : {
                        position: 'absolute',
                        left: 16,
                        top: 16,
                        bottom: 16,
                        width: 340,
                        // モデルサイズ表示（z-index 50）より手前に出す。
                        zIndex: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        borderRadius: 'var(--radius-panel)',
                        border: '1px solid var(--border)',
                        animation: 'machimoki-engraving-panel-in 140ms ease-out',
                      }
                }
              >
                <EngravingPanel
                  options={engravingDraft}
                  faces={engravingFaces}
                  autoTexts={engravingAutoTexts}
                  placeName={placeName}
                  busy={previewBusy}
                  applied={engravingApplied}
                  isCompact={isCompact}
                  onChange={setEngravingDraft}
                  onApply={handleEngravingApply}
                  onDisable={exitEngravingMode}
                  onClose={isCompact ? exitEngravingMode : undefined}
                />
              </div>
            )}
            <LoadingOverlay
              message={previewBusyFallback ? '処理中…' : pipelineState.message || '処理中…'}
              visible={previewBusyOverlay}
              progress={previewBusyFallback ? undefined : pipelineState.progress}
            />
            {pipelineLoadIndicatorVisible && (
              // 初回のタイル読み込み・パラメータ変更の再生成中は、画面を覆わず
              // 隅に小さく表示する（地形・到着済みの建物は操作可能なまま）。
              <div data-testid="preview-load-indicator" style={PREVIEW_LOAD_INDICATOR_STYLE}>
                <span>
                  {pipelineState.background ? '更新中…' : pipelineState.message || '読み込み中…'}{' '}
                  {Math.max(0, Math.min(100, Math.round(pipelineState.progress)))}%
                </span>
              </div>
            )}
            {!pipelineLoadIndicatorVisible && sceneLoadLabel && (
              // 橋・道路・地図画像はパイプライン完了後に別途読み込むため、
              // スイッチを切り替えた直後にも読み込み中であることを示す。
              <div
                data-testid="scene-load-indicator"
                role="status"
                aria-live="polite"
                style={PREVIEW_LOAD_INDICATOR_STYLE}
              >
                <span className="ui-inline-spinner" aria-hidden="true" />
                <span>{sceneLoadLabel}</span>
              </div>
            )}
            <LoadingOverlay
              message="エクスポート中…"
              visible={isExporting && pipelineState.phase === 'idle'}
            />
            {isCompact && !settingsOpen && !engravingMode && (
              <button
                type="button"
                ref={openSettingsButtonRef}
                data-testid="open-settings"
                onClick={() => setSettingsOpen(true)}
                style={{
                  position: 'absolute',
                  right: 16,
                  bottom: 'calc(56px + env(safe-area-inset-bottom))',
                  zIndex: 40,
                  minWidth: 72,
                  minHeight: 44,
                  borderRadius: 'var(--radius-panel)',
                  background: 'var(--surface-solid)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                設定
              </button>
            )}
            <HelpDetail
              mode="preview"
              isOpen={helpOpen && activeTab === 'preview'}
              onClose={closeHelp}
            />
          </div>
          {!isCompact && !engravingMode && (
            <ParameterPanel
              parameters={parameters}
              onChange={handleParametersChange}
              onExport={handleExport}
              onEnterEngravingMode={enterEngravingMode}
              onDeleteEngraving={handleEngravingDelete}
              availableLods={availableLods}
              autoTerrainGridSize={autoTerrainGridSize}
              buildingsVisible={buildingsVisible}
              onBuildingsVisibleChange={setBuildingsVisible}
              bridgesVisible={bridgesVisible}
              onBridgesVisibleChange={setBridgesVisible}
              bridgesAvailable={layerAvailability.brid}
              roadsVisible={roadsVisible}
              onRoadsVisibleChange={setRoadsVisible}
              roadsAvailable={layerAvailability.tran}
              shadowsVisible={shadowsVisible}
              onShadowsVisibleChange={setShadowsVisible}
              previewQuality={previewQuality.tier}
              previewQualityOverride={previewQuality.override}
              onPreviewQualityOverrideChange={previewQuality.setOverride}
            />
          )}
          {isCompact && settingsOpen && !engravingMode && (
            <dialog
              ref={settingsDialogRef}
              className="settings-dialog"
              aria-label="設定"
              onClick={(event) => {
                // シート外（背景）をクリックしたら閉じる。
                if (event.target === event.currentTarget) event.currentTarget.close()
              }}
            >
              <ParameterPanel
                mobile
                onClose={() => settingsDialogRef.current?.close()}
                parameters={parameters}
                onChange={handleParametersChange}
                onExport={handleExport}
                onEnterEngravingMode={enterEngravingMode}
                onDeleteEngraving={handleEngravingDelete}
                availableLods={availableLods}
                autoTerrainGridSize={autoTerrainGridSize}
                buildingsVisible={buildingsVisible}
                onBuildingsVisibleChange={setBuildingsVisible}
                bridgesVisible={bridgesVisible}
                onBridgesVisibleChange={setBridgesVisible}
                bridgesAvailable={layerAvailability.brid}
                roadsVisible={roadsVisible}
                onRoadsVisibleChange={setRoadsVisible}
                roadsAvailable={layerAvailability.tran}
                shadowsVisible={shadowsVisible}
                onShadowsVisibleChange={setShadowsVisible}
                previewQuality={previewQuality.tier}
                previewQualityOverride={previewQuality.override}
                onPreviewQualityOverrideChange={previewQuality.setOverride}
              />
            </dialog>
          )}
        </div>
      </main>

      <ErrorToast
        message={displayErrorMessage}
        onDismiss={handleDismissError}
        // 再試行ボタンはラベルどおりエクスポートをやり直させる。
        onRetry={pipelineState.phase === 'error' ? () => void handleExport() : undefined}
      />
    </div>
  )
}

export default App
