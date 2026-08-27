import { useEffect, useRef, useState } from 'react'
import {
  Viewer,
  Cesium3DTileset,
  Color,
  Cartesian3,
  Math as CesiumMath,
  Ion,
  CesiumTerrainProvider,
  ClippingPlaneCollection,
  DirectionalLight,
  GridImageryProvider,
  UrlTemplateImageryProvider,
  HeadingPitchRange,
  Matrix4,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cesium3DTileFeature,
} from 'cesium'
import type { BoundingSphere, Cartesian2, Cesium3DTile, Primitive, TerrainProvider } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import type { PipelineState } from '../types/pipeline'
import { resolveMuniCodes, findTilesetUrl, type Lod } from '../lib/catalogApi'
import {
  applyClippingToTileset,
  createGlobeClippingPlanes,
  refilterPickPoints,
  refilterSpanning,
  checkFeatureBounds,
} from '../lib/clipping'
import {
  sampleTerrainData,
  buildSolidTerrainPrimitive,
  type TerrainSampleData,
} from '../lib/solidTerrain'
import ModelSizeOverlay from './ModelSizeOverlay'
import BuildingListPanel, { type BuildingListItem } from './BuildingListPanel'

function clearGlobeClippingPlanes(
  globe: { clippingPlanes: ClippingPlaneCollection | undefined }
): void {
  globe.clippingPlanes = undefined
}

function sameBounds(a: SelectionBounds, b: SelectionBounds): boolean {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north
}

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  lod: Lod
  manifoldRef?: React.MutableRefObject<any>
  onPipelineStateChange?: (state: PipelineState) => void
  showTerrainImagery?: boolean
  terrainThickness?: number
  flattenBottom?: boolean
  includeTerrain?: boolean
  buildingColor?: string
  terrainColor?: string
  scale?: number
  onScaleChange?: (newScale: number) => void
  includeSpanningBuildings?: boolean
  pickPoints?: Array<{ lon: number; lat: number }>
  excludedBuildingIds?: string[]
  onExcludedBuildingIdsChange?: (ids: string[]) => void
}

export default function Preview3D({
  selectionBounds,
  lod,
  manifoldRef: _manifoldRef,
  onPipelineStateChange,
  showTerrainImagery = false,
  terrainThickness = 10,
  flattenBottom = true,
  includeTerrain = true,
  buildingColor = '#ffffff',
  terrainColor = '#ffffff',
  scale = 1,
  onScaleChange,
  includeSpanningBuildings = false,
  pickPoints,
  excludedBuildingIds,
  onExcludedBuildingIdsChange,
}: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tilesetsRef = useRef<Cesium3DTileset[]>([])
  const solidTerrainPrimitiveRef = useRef<Primitive | null>(null)
  const gridLayerRef = useRef<any>(null)
  const textureLayerRef = useRef<any>(null)
  const terrainSampleCacheRef = useRef<TerrainSampleData | null>(null)
  const appliedTerrainParamsRef = useRef<{ terrainThickness: number; flattenBottom: boolean; terrainColor: string } | null>(null)
  const cameraFramedForRef = useRef<SelectionBounds | null>(null)
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(null)

  const excludedIdsRef = useRef<Set<string>>(new Set())
  const undoStackRef = useRef<string[]>([])
  const gmlidPropNameRef = useRef<string | null>(null)
  const hoveredFeatureRef = useRef<Cesium3DTileFeature | null>(null)
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null)
  const tileLoadHandlerRef = useRef<((tile: any) => void) | null>(null)
  const onExcludedChangeRef = useRef(onExcludedBuildingIdsChange)
  const buildingColorRef = useRef(buildingColor)
  const registryRef = useRef<Map<string, BuildingListItem>>(new Map())
  const [excludedCount, setExcludedCount] = useState(0)
  const [excludedIdsState, setExcludedIdsState] = useState<string[]>([])
  const [buildingItems, setBuildingItems] = useState<BuildingListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [totalTiles, setTotalTiles] = useState<number | null>(null)
  const [loadedTiles, setLoadedTiles] = useState<number | null>(null)
  const [buildingLoadDetail, setBuildingLoadDetail] = useState<string | null>(null)
  const [buildingLoadProgress, setBuildingLoadProgress] = useState<number | null>(null)
  const maxTilesRef = useRef(0)
  const pendingMapRef = useRef<Map<Cesium3DTileset, number>>(new Map())
  const progressListenersRef = useRef<Map<Cesium3DTileset, (pending: number, processing: number) => void>>(new Map())
  const listRafRef = useRef<number | null>(null)

  buildingColorRef.current = buildingColor
  onExcludedChangeRef.current = onExcludedBuildingIdsChange

  const baseBuildingColor = (): Color => Color.fromCssColorString(buildingColorRef.current)

  const resolveGmlidProp = (feature: Cesium3DTileFeature): string | null => {
    if (gmlidPropNameRef.current) return gmlidPropNameRef.current
    const candidates = ['gmlid', 'gml_id', '_gmlid']
    for (const candidate of candidates) {
      let value: unknown
      try {
        value = feature.getProperty(candidate)
      } catch {
        continue
      }
      if (typeof value === 'string' && value.length > 0) {
        gmlidPropNameRef.current = candidate
        return candidate
      }
    }
    return null
  }

  const getBuildingId = (feature: Cesium3DTileFeature): string | null => {
    const prop = resolveGmlidProp(feature)
    if (!prop) return null
    const value: unknown = feature.getProperty(prop)
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  // scene.pick() は Cesium バージョンにより feature 自体または { id: feature } を返す
  const asTileFeature = (
    picked: unknown
  ): Cesium3DTileFeature | null => {
    if (!picked || typeof picked !== 'object') return null
    const obj = picked as { id?: unknown }
    const candidate =
      obj.id instanceof Cesium3DTileFeature ? obj.id : (picked as Cesium3DTileFeature)
    if (
      candidate instanceof Cesium3DTileFeature &&
      typeof candidate.getProperty === 'function'
    ) {
      return candidate
    }
    return null
  }

  const forEachContentFeature = (
    tile: Cesium3DTile | undefined,
    cb: (feature: Cesium3DTileFeature) => void
  ): void => {
    if (!tile) return
    const content = tile.content as any
    if (content && content.featuresLength > 0) {
      for (let i = 0; i < content.featuresLength; i++) {
        const feature = content.getFeature(i)
        if (feature) cb(feature as Cesium3DTileFeature)
      }
    }
    const children = (tile.children ?? []) as Cesium3DTile[]
    for (const child of children) {
      forEachContentFeature(child, cb)
    }
  }

  const forEachBuildingFeature = (
    cb: (feature: Cesium3DTileFeature) => void
  ): void => {
    for (const ts of tilesetsRef.current) {
      forEachContentFeature(ts.root, cb)
    }
  }

  const applyStateToFeature = (feature: Cesium3DTileFeature): void => {
    const id = getBuildingId(feature)
    if (id && excludedIdsRef.current.has(id)) {
      feature.show = false
    } else {
      feature.color = baseBuildingColor()
    }
  }

  const restoreFiltersAndColors = (): void => {
    for (const ts of tilesetsRef.current) {
      refilterSpanning(ts)
    }
    forEachBuildingFeature(applyStateToFeature)
  }

  // タイル読み込みごとに setBuildingItems を呼ぶと再レンダリングが爆発するため、
  // requestAnimationFrame で 1 フレームに 1 回だけまとめて反映する
  const scheduleListFlush = (): void => {
    if (listRafRef.current !== null) return
    listRafRef.current = requestAnimationFrame(() => {
      listRafRef.current = null
      setBuildingItems(Array.from(registryRef.current.values()))
    })
  }

  if (!tileLoadHandlerRef.current) {
    tileLoadHandlerRef.current = (tile: any) => {
      forEachContentFeature(tile, applyStateToFeature)
      // クリッピングと同一の範囲判定を使い、選択範囲外の建物はリストに含めない
      const ts = tile.tileset as
        | (Cesium3DTileset & {
            _customSelectionBounds?: SelectionBounds
            _customIncludeSpanning?: boolean
            _customPickPoints?: Array<{ lon: number; lat: number }>
          })
        | undefined
      const bounds = ts?._customSelectionBounds
      const includeSpanning = ts?._customIncludeSpanning ?? false
      const pickPoints = ts?._customPickPoints
      forEachContentFeature(tile, (feature) => {
        const id = getBuildingId(feature)
        if (!id || registryRef.current.has(id)) return
        if (bounds && !checkFeatureBounds(feature, bounds, includeSpanning, pickPoints)) {
          return
        }
        let height: string | null = null
        let usage: string | null = null
        try {
          const h = feature.getProperty('bldg:measuredHeight')
          if (h !== undefined && h !== null && String(h).length > 0) {
            height = String(Math.round(Number(h) * 10) / 10)
          }
        } catch {
          void 0
        }
        try {
          const u = feature.getProperty('bldg:usage')
          if (typeof u === 'string' && u.length > 0) usage = u
        } catch {
          void 0
        }
        registryRef.current.set(id, { id, height, usage })
      })
      scheduleListFlush()
    }
  }

  const commitExclusions = (): void => {
    const ids = [...excludedIdsRef.current]
    setExcludedCount(ids.length)
    setExcludedIdsState(ids)
    onExcludedChangeRef.current?.(ids)
  }

  const excludeBuildingById = (id: string): void => {
    if (!excludedIdsRef.current.has(id)) {
      excludedIdsRef.current.add(id)
      undoStackRef.current.push(id)
    }
    forEachBuildingFeature((feature) => {
      if (getBuildingId(feature) === id && feature.show) feature.show = false
    })
    hoveredFeatureRef.current = null
    commitExclusions()
  }

  const restoreBuildingById = (id: string): void => {
    if (!excludedIdsRef.current.has(id)) return
    excludedIdsRef.current.delete(id)
    undoStackRef.current = undoStackRef.current.filter((x) => x !== id)
    restoreFiltersAndColors()
    commitExclusions()
  }

  const highlightBuildingById = (id: string | null): void => {
    const canvas = viewerRef.current?.scene.canvas
    if (hoveredFeatureRef.current) {
      applyStateToFeature(hoveredFeatureRef.current)
      hoveredFeatureRef.current = null
    }
    if (!id || !canvas) return
    forEachBuildingFeature((feature) => {
      if (hoveredFeatureRef.current) return
      if (getBuildingId(feature) !== id || !feature.show) return
      feature.color = Color.fromCssColorString('#ff9800').withAlpha(0.8)
      hoveredFeatureRef.current = feature
    })
  }

  const latestTerrainParamsRef = useRef({ terrainThickness, flattenBottom, terrainColor })
  latestTerrainParamsRef.current = { terrainThickness, flattenBottom, terrainColor }

  useEffect(() => {
    console.log('[Preview3D] Viewer useEffect fired')
    if (!containerRef.current) return

    const viewer = new Viewer(containerRef.current, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      skyBox: false,
      skyAtmosphere: false,
      baseLayer: false,
    })

    viewer.scene.backgroundColor = Color.fromCssColorString('#0d1117')
    viewer.scene.globe.baseColor = Color.fromCssColorString('#5a7a9a')
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.lightingFadeOutDistance = 5000.0
    viewer.scene.globe.lightingFadeInDistance = 1000.0
    viewer.scene.globe.depthTestAgainstTerrain = true

    const directionalLight = new DirectionalLight({
      direction: new Cartesian3(0.5, -0.5, -1.0),
    })
    viewer.scene.light = directionalLight

    Ion.defaultAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODVhMmQ5OS1hOWZjLTQ3YmYtODlmNi1lNWUwY2MwOGUxYTMiLCJpZCI6MTQ5ODk3LCJpYXQiOjE2ODc5MzQ3NDN9.OG0mc3i7ZxGwHQjlMv3TRjiOvKWpzxglxmJRaUIykTY'

    const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement
    if (creditContainer) {
      creditContainer.style.display = 'none'
    }

    viewerRef.current = viewer
    ;(window as any).__cesiumViewer = viewer

    const textureProvider = new UrlTemplateImageryProvider({
      url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    })
    textureLayerRef.current = viewer.scene.globe.imageryLayers.addImageryProvider(textureProvider)
    textureLayerRef.current.show = false

    const loadTerrain = async () => {
      try {
        const terrainProvider = await CesiumTerrainProvider.fromIonAssetId(3258112)
        if (viewerRef.current) {
          viewer.scene.terrainProvider = terrainProvider
          setTerrainProvider(terrainProvider)
          console.log('[Preview3D] Terrain set successfully')
        }
      } catch (err) {
        console.error('[Preview3D] Terrain setup failed:', err)
      }
    }
    loadTerrain()

    return () => {
      if (listRafRef.current !== null) {
        cancelAnimationFrame(listRafRef.current)
        listRafRef.current = null
      }
      for (const ts of tilesetsRef.current) {
        if (tileLoadHandlerRef.current) {
          try {
            ts.tileLoad.removeEventListener(tileLoadHandlerRef.current)
          } catch {
            void 0
          }
        }
        const fn = progressListenersRef.current.get(ts)
        if (fn) {
          try {
            ts.loadProgress.removeEventListener(fn)
          } catch {
            void 0
          }
          progressListenersRef.current.delete(ts)
        }
        try {
          viewer.scene.primitives.remove(ts)
        } catch {
          void 0
        }
      }
      tilesetsRef.current = []
      progressListenersRef.current.clear()
      if (solidTerrainPrimitiveRef.current) {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
        solidTerrainPrimitiveRef.current = null
      }
      setTerrainProvider(null)
      viewer.destroy()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const imageryLayers = viewer.scene.globe.imageryLayers

    if (showTerrainImagery) {
      for (let i = 0; i < imageryLayers.length; i++) {
        const layer = imageryLayers.get(i)
        if (layer === gridLayerRef.current) {
          layer.show = false
        } else {
          layer.show = true
        }
      }
    } else {
      for (let i = 0; i < imageryLayers.length; i++) {
        const layer = imageryLayers.get(i)
        if (layer === gridLayerRef.current) {
          layer.show = true
        } else {
          layer.show = false
        }
      }

      if (!gridLayerRef.current) {
        const gridProvider = new GridImageryProvider({
          cells: 8,
          color: Color.fromCssColorString('#ffffff'),
          glowColor: Color.fromCssColorString('#00bcd4'),
          backgroundColor: Color.fromCssColorString('#00000000'),
        })
        gridLayerRef.current = imageryLayers.addImageryProvider(gridProvider)
        gridLayerRef.current.alpha = 0.4
      }
    }

    console.log(
      `[Preview3D] Imagery layers visibility set to: ${showTerrainImagery}`
    )
  }, [showTerrainImagery])

  useEffect(() => {
    console.log('[Preview3D] Tileset useEffect fired, selectionBounds:', selectionBounds)
    const viewer = viewerRef.current
    if (!viewer) {
      console.log('[Preview3D] No viewer yet, returning')
      return
    }

    for (const ts of tilesetsRef.current) {
      if (tileLoadHandlerRef.current) {
        try {
          ts.tileLoad.removeEventListener(tileLoadHandlerRef.current)
        } catch {
          void 0
        }
      }
      const fn = progressListenersRef.current.get(ts)
      if (fn) {
        try {
          ts.loadProgress.removeEventListener(fn)
        } catch {
          void 0
        }
        progressListenersRef.current.delete(ts)
      }
      try {
        viewer.scene.primitives.remove(ts)
      } catch {
        void 0
      }
    }
    tilesetsRef.current = []
    registryRef.current.clear()
    progressListenersRef.current.clear()
    maxTilesRef.current = 0
    pendingMapRef.current.clear()
    setBuildingItems([])
    setListLoading(false)
    setTotalTiles(null)
    setLoadedTiles(null)
    setBuildingLoadDetail(null)
    setBuildingLoadProgress(null)

    if (solidTerrainPrimitiveRef.current) {
      try {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
      } catch {
        void 0
      }
      solidTerrainPrimitiveRef.current = null
    }

    terrainSampleCacheRef.current = null
    appliedTerrainParamsRef.current = null

    viewer.scene.globe.show = true

    if (!selectionBounds) {
      if (viewer.scene.globe.clippingPlanes) {
        clearGlobeClippingPlanes(viewer.scene.globe)
        console.log('[Preview3D] Globe clipping planes cleared')
      }
      onPipelineStateChange?.({
        phase: 'idle',
        progress: 0,
        message: '',
        error: null,
      })
      return
    }

    if (includeTerrain && !terrainProvider) {
      onPipelineStateChange?.({
        phase: 'acquiring',
        progress: 0,
        message: '地形データを読み込み中',
        error: null,
      })
      return
    }

    const bounds = selectionBounds
    let cancelled = false

    async function load() {
      try {
        setBuildingLoadDetail('タイルセットURLを特定中')
        setBuildingLoadProgress(5)
        setListLoading(true)
        onPipelineStateChange?.({
          phase: 'identifying',
          progress: 0,
          message: 'タイルセットURLを特定中',
          error: null,
        })

        const muniCodes = await resolveMuniCodes(bounds)
        if (cancelled) return

        setBuildingLoadDetail('カタログからタイルセットを検索中')
        setBuildingLoadProgress(15)
        onPipelineStateChange?.({
          phase: 'identifying',
          progress: 50,
          message: 'カタログからタイルセットを検索中',
          error: null,
        })

        let firstUrlError: Error | null = null
        const urlPromises = muniCodes.map(async (code) => {
          try {
            const url = await findTilesetUrl(code, lod)
            return url
          } catch (err) {
            if (!firstUrlError && err instanceof Error) firstUrlError = err
            return null
          }
        })
        const urls = (await Promise.all(urlPromises)).filter(
          (u): u is string => u !== null
        )
        if (cancelled) return

        if (urls.length === 0) {
          throw firstUrlError ?? new Error('該当する3D Tilesデータセットが見つかりません')
        }

        console.log('[Preview3D] Resolved tileset URLs:', urls)

        setBuildingLoadDetail(`3Dタイルを読み込み中（${urls.length}件）`)
        setBuildingLoadProgress(30)
        onPipelineStateChange?.({
          phase: 'acquiring',
          progress: 0,
          message: '3Dタイルを読み込み中',
          error: null,
        })

        const loadedTilesets: Cesium3DTileset[] = []
        for (const url of urls) {
          if (cancelled) {
            for (const ts of loadedTilesets) {
              try {
                viewer!.scene.primitives.remove(ts)
              } catch {
                void 0
              }
            }
            return
          }
          try {
            const tileset = await Cesium3DTileset.fromUrl(url)
            if (cancelled) {
              for (const ts of loadedTilesets) {
                try {
                  viewer!.scene.primitives.remove(ts)
                } catch {
                  void 0
                }
              }
              tileset.destroy()
              return
            }

            viewer!.scene.primitives.add(tileset)
            loadedTilesets.push(tileset)

            const progressFn = (pending: number, processing: number): void => {
              pendingMapRef.current.set(tileset, pending + processing)
              const currentSum = Array.from(pendingMapRef.current.values()).reduce((a, b) => a + b, 0)
              const isLoading = currentSum > 0
              setListLoading(isLoading)
              if (isLoading) {
                if (currentSum > maxTilesRef.current) maxTilesRef.current = currentSum
                const max = maxTilesRef.current
                const rawLoaded = Math.max(0, max - currentSum)
                setTotalTiles(max)
                setLoadedTiles((prev) => {
                  const prevVal = prev ?? 0
                  return Math.max(prevVal, rawLoaded)
                })
                setBuildingLoadDetail(`3Dタイルを読み込み中`)
                const loadedForProgress = Math.max(loadedTiles ?? 0, rawLoaded)
                const ratio = max > 0 ? loadedForProgress / max : 0
                const p = 30 + ratio * 55
                setBuildingLoadProgress((prev) => (prev == null ? p : Math.max(prev, Math.min(85, p))))
              } else {
                const max = maxTilesRef.current
                if (max > 0) {
                  setTotalTiles(max)
                  setLoadedTiles((prev) => {
                    const prevVal = prev ?? 0
                    return Math.max(prevVal, max)
                  })
                }
                setBuildingLoadDetail('建物リストを整理中')
                setBuildingLoadProgress((prev) => (prev == null ? 90 : Math.max(prev, 90)))
              }
            }
            tileset.loadProgress.addEventListener(progressFn)
            progressListenersRef.current.set(tileset, progressFn)

            applyClippingToTileset(tileset, bounds, includeSpanningBuildings, pickPoints)

            if (tileLoadHandlerRef.current) {
              tileset.tileLoad.addEventListener(tileLoadHandlerRef.current)
            }
          } catch (err) {
            console.warn('[Preview3D] Failed to load tileset:', url, err)
          }
        }

        if (cancelled) {
          for (const ts of loadedTilesets) {
            try {
              viewer!.scene.primitives.remove(ts)
            } catch {
              void 0
            }
          }
          return
        }

        if (loadedTilesets.length === 0) {
          throw new Error('3Dタイルの読み込みに失敗しました')
        }

        tilesetsRef.current = loadedTilesets
        forEachBuildingFeature(applyStateToFeature)
        setBuildingLoadDetail('読み込み完了')
        setBuildingLoadProgress(100)
        if (maxTilesRef.current > 0) {
          setTotalTiles(maxTilesRef.current)
          setLoadedTiles(maxTilesRef.current)
        }
        setTimeout(() => {
          setListLoading(false)
          setBuildingLoadDetail(null)
          setBuildingLoadProgress(null)
          setTotalTiles(null)
          setLoadedTiles(null)
        }, 800)
        console.log('[Preview3D] Loaded tilesets:', loadedTilesets.length)

        let terrainBoundingSphere: BoundingSphere | null = null

        if (includeTerrain) {
          onPipelineStateChange?.({
            phase: 'composing',
            progress: 70,
            message: '地形を閉じたメッシュに変換中',
            error: null,
          })

          let sample = terrainSampleCacheRef.current
          if (!sample || !sameBounds(sample.bounds, bounds)) {
            sample = await sampleTerrainData(bounds, terrainProvider!)
            if (cancelled) return
            terrainSampleCacheRef.current = sample
          }
          const params = latestTerrainParamsRef.current
          const solidTerrain = buildSolidTerrainPrimitive(sample, {
            terrainThickness: params.terrainThickness,
            flattenBottom: params.flattenBottom,
            terrainColor: params.terrainColor,
          })
          if (cancelled) {
            solidTerrain.primitive.destroy()
            return
          }

          viewer!.scene.primitives.add(solidTerrain.primitive)
          solidTerrainPrimitiveRef.current = solidTerrain.primitive
          appliedTerrainParamsRef.current = { ...params }
          terrainBoundingSphere = solidTerrain.boundingSphere
          clearGlobeClippingPlanes(viewer!.scene.globe)
          viewer!.scene.globe.show = false
          console.log('[Preview3D] Solid terrain mesh applied')
        } else {
          const globePlanes = createGlobeClippingPlanes(bounds)
          viewer!.scene.globe.clippingPlanes = globePlanes
          viewer!.scene.globe.show = true
          console.log('[Preview3D] Globe clipping planes applied')
        }

        const flyLon = (bounds.west + bounds.east) / 2
        const flyLat = (bounds.south + bounds.north) / 2
        const widthDeg = bounds.east - bounds.west
        const heightDeg = bounds.north - bounds.south
        const widthMeters = CesiumMath.toRadians(widthDeg) * 6371000 * Math.cos(CesiumMath.toRadians(flyLat))
        const heightMeters = CesiumMath.toRadians(heightDeg) * 6371000
        const maxDim = Math.max(widthMeters, heightMeters)
        const cameraHeight = Math.max(maxDim * 2, 300)

        // 同じ選択範囲に対する再読み込み（LOD切替など）では視点を維持する
        const alreadyFramed =
          cameraFramedForRef.current !== null &&
          sameBounds(cameraFramedForRef.current, bounds)

        if (!alreadyFramed) {
          if (terrainBoundingSphere) {
            viewer!.camera.viewBoundingSphere(
              terrainBoundingSphere,
              new HeadingPitchRange(
                CesiumMath.toRadians(35),
                CesiumMath.toRadians(-45),
                Math.max(maxDim * 2.4, 300)
              )
            )
            viewer!.camera.lookAtTransform(Matrix4.IDENTITY)
          } else {
            viewer!.camera.setView({
              destination: Cartesian3.fromDegrees(flyLon, flyLat, cameraHeight),
              orientation: {
                heading: 0,
                pitch: CesiumMath.toRadians(-90),
                roll: 0,
              },
            })
          }
          cameraFramedForRef.current = bounds
        }

        onPipelineStateChange?.({
          phase: 'complete',
          progress: 100,
          message: '完了',
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        const message =
          err instanceof Error
            ? err.message
            : '3Dタイルの読み込みに失敗しました'
        console.error('[Preview3D]', err)
        setBuildingLoadDetail(message)
        setBuildingLoadProgress(null)
        onPipelineStateChange?.({
          phase: 'error',
          progress: 0,
          message,
          error: message,
        })
      }
    }

    load()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionBounds, lod, onPipelineStateChange, terrainProvider, includeTerrain])

  useEffect(() => {
    forEachBuildingFeature((feature) => {
      const id = getBuildingId(feature)
      if (id && excludedIdsRef.current.has(id)) return
      feature.color = baseBuildingColor()
    })
  }, [buildingColor])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    if (!selectionBounds) {
      handlerRef.current?.destroy()
      handlerRef.current = null
      hoveredFeatureRef.current = null
      viewer.scene.canvas.style.cursor = 'default'
      return
    }

    const canvas = viewer.scene.canvas
    const handler = new ScreenSpaceEventHandler(canvas)

    const clearHover = (): void => {
      const hovered = hoveredFeatureRef.current
      if (hovered) {
        applyStateToFeature(hovered)
        hoveredFeatureRef.current = null
      }
      canvas.style.cursor = 'default'
    }

    let hoverRafScheduled = false
    handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (handler.isDestroyed()) return
      if (hoverRafScheduled) return
      hoverRafScheduled = true
      const pos = movement.endPosition
      requestAnimationFrame(() => {
        hoverRafScheduled = false
        if (handler.isDestroyed()) return
        const feature = asTileFeature(viewer.scene.pick(pos))
        if (feature === hoveredFeatureRef.current) return
        clearHover()
        if (feature && feature.show) {
          feature.color = Color.fromCssColorString('#ff9800').withAlpha(0.8)
          hoveredFeatureRef.current = feature
          canvas.style.cursor = 'pointer'
        }
      })
    }, ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction((click: { position: Cartesian2 }) => {
      if (handler.isDestroyed()) return
      const feature = asTileFeature(viewer.scene.pick(click.position))
      if (!feature) return
      const id = getBuildingId(feature)
      if (!id || excludedIdsRef.current.has(id)) return
      canvas.style.cursor = 'default'
      excludeBuildingById(id)
    }, ScreenSpaceEventType.LEFT_CLICK)

    handlerRef.current = handler

    return () => {
      handler.destroy()
      handlerRef.current = null
      hoveredFeatureRef.current = null
      canvas.style.cursor = 'default'
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionBounds])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z' || e.shiftKey) return
      e.preventDefault()
      const last = undoStackRef.current.pop()
      if (!last) return
      excludedIdsRef.current.delete(last)
      restoreFiltersAndColors()
      commitExclusions()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const next = new Set(excludedBuildingIds ?? [])
    const current = excludedIdsRef.current
    const same =
      next.size === current.size &&
      Array.from(next).every((id) => current.has(id))
    if (same) return
    excludedIdsRef.current = next
    undoStackRef.current = []
    restoreFiltersAndColors()
    setExcludedCount(next.size)
    setExcludedIdsState([...next])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludedBuildingIds])

  useEffect(() => {
    for (const tileset of tilesetsRef.current) {
      refilterSpanning(tileset, includeSpanningBuildings)
    }
  }, [includeSpanningBuildings])

  useEffect(() => {
    for (const tileset of tilesetsRef.current) {
      refilterPickPoints(tileset, pickPoints)
    }
  }, [pickPoints])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !selectionBounds || !terrainProvider || !includeTerrain) return
    const sample = terrainSampleCacheRef.current
    if (!sample || !solidTerrainPrimitiveRef.current) return
    if (!sameBounds(sample.bounds, selectionBounds)) return
    const current = { terrainThickness, flattenBottom, terrainColor }
    const applied = appliedTerrainParamsRef.current
    if (applied && applied.terrainThickness === current.terrainThickness && applied.flattenBottom === current.flattenBottom && applied.terrainColor === current.terrainColor) return

    if (solidTerrainPrimitiveRef.current) {
      try {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
      } catch {
        void 0
      }
      solidTerrainPrimitiveRef.current = null
    }

    try {
      const solidTerrain = buildSolidTerrainPrimitive(sample, current)
      viewer.scene.primitives.add(solidTerrain.primitive)
      solidTerrainPrimitiveRef.current = solidTerrain.primitive
      appliedTerrainParamsRef.current = current
      clearGlobeClippingPlanes(viewer.scene.globe)
      viewer.scene.globe.show = false
    } catch (err) {
      console.error('[Preview3D] Terrain update failed:', err)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainThickness, flattenBottom, terrainColor])

  return (
    <div style={wrapperStyle}>
      <div ref={containerRef} style={containerStyle} />
      {selectionBounds && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            zIndex: 10,
            pointerEvents: 'none',
            background: 'var(--surface)',
            color: 'var(--text-dim)',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '11px',
            backdropFilter: 'blur(4px)',
          }}
        >
          建物にカーソルを合わせてクリックで削除 / Ctrl+Zで取り消し
          {excludedCount > 0 && `（削除済み ${excludedCount}件）`}
        </div>
      )}
      {selectionBounds && (
        <BuildingListPanel
          items={buildingItems}
          excludedIds={excludedIdsState}
          listLoading={listLoading}
          loadingDetail={buildingLoadDetail}
          loadingProgress={buildingLoadProgress}
          totalTiles={totalTiles}
          loadedTiles={loadedTiles}
          onExclude={excludeBuildingById}
          onRestore={restoreBuildingById}
          onHoverItem={highlightBuildingById}
        />
      )}
      <ModelSizeOverlay
        selectionBounds={selectionBounds}
        scale={scale}
        onScaleChange={onScaleChange ?? (() => {})}
      />
    </div>
  )
}

const wrapperStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
}
