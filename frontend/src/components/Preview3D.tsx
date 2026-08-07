import { useEffect, useRef, useState } from 'react'
import {
  Viewer,
  Cesium3DTileset,
  Cesium3DTileStyle,
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
} from 'cesium'
import type { BoundingSphere, Primitive, TerrainProvider } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import type { PipelineState } from '../types/pipeline'
import { resolveMuniCodes, findTilesetUrl, type Lod } from '../lib/catalogApi'
import { applyClippingToTileset, createGlobeClippingPlanes, refilterSpanning } from '../lib/clipping'
import {
  sampleTerrainData,
  buildSolidTerrainPrimitive,
  type TerrainSampleData,
} from '../lib/solidTerrain'
import ModelSizeOverlay from './ModelSizeOverlay'

function clearGlobeClippingPlanes(
  globe: { clippingPlanes: ClippingPlaneCollection | undefined }
): void {
  globe.clippingPlanes = undefined
}

function sameBounds(a: SelectionBounds, b: SelectionBounds): boolean {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north
}

/**
 * Cesium3DTileStyleのshow式を組み立てる。
 *
 * PLATEAUタイルは `_xmin/_xmax/_ymin/_ymax`（フットプリントbbox）を持つが、
 * 一部データセットでは存在しない可能性がある。`\${_xmin} === undefined` の
 * ランタイム判定でフォールバック（中心点 `_x`/`_y`）に切り替える。
 *
 * - includeSpanning=true: フットプリントが範囲と交差する建物を表示
 * - includeSpanning=false: フットプリントが範囲に完全内包される建物のみ表示
 */
function buildShowExpr(bounds: SelectionBounds, includeSpanning: boolean): string {
  const centerExpr = `\${_x} >= ${bounds.west} && \${_x} <= ${bounds.east} && \${_y} >= ${bounds.south} && \${_y} <= ${bounds.north}`
  const footprintExpr = includeSpanning
    ? `\${_xmin} <= ${bounds.east} && \${_xmax} >= ${bounds.west} && \${_ymin} <= ${bounds.north} && \${_ymax} >= ${bounds.south}`
    : `\${_xmin} >= ${bounds.west} && \${_xmax} <= ${bounds.east} && \${_ymin} >= ${bounds.south} && \${_ymax} <= ${bounds.north}`
  return `\${_xmin} === undefined ? (${centerExpr}) : (${footprintExpr})`
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
      for (const ts of tilesetsRef.current) {
        try {
          viewer.scene.primitives.remove(ts)
        } catch {
          void 0
        }
      }
      tilesetsRef.current = []
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
      try {
        viewer.scene.primitives.remove(ts)
      } catch {
        void 0
      }
    }
    tilesetsRef.current = []

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
        onPipelineStateChange?.({
          phase: 'identifying',
          progress: 0,
          message: 'タイルセットURLを特定中',
          error: null,
        })

        const muniCodes = await resolveMuniCodes(bounds)
        if (cancelled) return

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

            applyClippingToTileset(tileset, bounds, includeSpanningBuildings)

            const showExpr = buildShowExpr(bounds, includeSpanningBuildings)
            tileset.style = new Cesium3DTileStyle({
              color: `color("${buildingColor}")`,
              show: showExpr,
            })
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
    if (tilesetsRef.current.length && selectionBounds) {
      const showExpr = buildShowExpr(selectionBounds, includeSpanningBuildings)
      for (const tileset of tilesetsRef.current) {
        tileset.style = new Cesium3DTileStyle({
          color: `color("${buildingColor}")`,
          show: showExpr,
        })
      }
    }
  }, [buildingColor, selectionBounds, includeSpanningBuildings])

  useEffect(() => {
    for (const tileset of tilesetsRef.current) {
      refilterSpanning(tileset, includeSpanningBuildings)
    }
  }, [includeSpanningBuildings])

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
