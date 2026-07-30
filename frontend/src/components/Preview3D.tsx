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
import { resolveMuniCode, findTilesetUrl } from '../lib/catalogApi'
import { applyClippingToTileset, createGlobeClippingPlanes } from '../lib/clipping'
import { createSolidTerrainPrimitive } from '../lib/solidTerrain'

function clearGlobeClippingPlanes(
  globe: { clippingPlanes: ClippingPlaneCollection | undefined }
): void {
  globe.clippingPlanes = undefined
}

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  lod: 'lod1' | 'lod2'
  manifoldRef?: React.MutableRefObject<any>
  onPipelineStateChange?: (state: PipelineState) => void
  showTerrainImagery?: boolean
  terrainThickness?: number
  flattenBottom?: boolean
  includeTerrain?: boolean
  buildingColor?: string
  terrainColor?: string
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
}: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tilesetRef = useRef<Cesium3DTileset | null>(null)
  const solidTerrainPrimitiveRef = useRef<Primitive | null>(null)
  const gridLayerRef = useRef<any>(null)
  const textureLayerRef = useRef<any>(null)
  const appliedTerrainColorRef = useRef<string | undefined>()
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(null)

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
      if (tilesetRef.current) {
        viewer.scene.primitives.remove(tilesetRef.current)
        tilesetRef.current = null
      }
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

    if (tilesetRef.current) {
      try {
        viewer.scene.primitives.remove(tilesetRef.current)
      } catch {
        void 0
      }
      tilesetRef.current = null
    }

    if (solidTerrainPrimitiveRef.current) {
      try {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
      } catch {
        void 0
      }
      solidTerrainPrimitiveRef.current = null
    }

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

        const centerLat = (bounds.north + bounds.south) / 2
        const centerLon = (bounds.east + bounds.west) / 2

        const muniCode = await resolveMuniCode(centerLat, centerLon)
        if (cancelled) return

        onPipelineStateChange?.({
          phase: 'identifying',
          progress: 50,
          message: 'カタログからタイルセットを検索中',
          error: null,
        })

        const url = await findTilesetUrl(muniCode, lod)
        if (cancelled) return

        console.log('[Preview3D] Resolved tileset URL:', url)

        onPipelineStateChange?.({
          phase: 'acquiring',
          progress: 0,
          message: '3Dタイルを読み込み中',
          error: null,
        })

        const tileset = await Cesium3DTileset.fromUrl(url)
        if (cancelled) {
          tileset.destroy()
          return
        }

        viewer!.scene.primitives.add(tileset)
        tilesetRef.current = tileset

        applyClippingToTileset(tileset, bounds)

        const showExpr = `\${_x} >= ${bounds.west} && \${_x} <= ${bounds.east} && \${_y} >= ${bounds.south} && \${_y} <= ${bounds.north}`
        tileset.style = new Cesium3DTileStyle({
          color: `color("${buildingColor}")`,
          show: showExpr,
        })

        let terrainBoundingSphere: BoundingSphere | null = null

        if (includeTerrain) {
          onPipelineStateChange?.({
            phase: 'composing',
            progress: 70,
            message: '地形を閉じたメッシュに変換中',
            error: null,
          })

          const solidTerrain = await createSolidTerrainPrimitive(bounds, terrainProvider!, {
            terrainThickness,
            flattenBottom,
            terrainColor,
          })
          if (cancelled) {
            solidTerrain.primitive.destroy()
            return
          }

          viewer!.scene.primitives.add(solidTerrain.primitive)
          solidTerrainPrimitiveRef.current = solidTerrain.primitive
          appliedTerrainColorRef.current = terrainColor
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
  }, [selectionBounds, lod, onPipelineStateChange, terrainProvider, includeTerrain, terrainThickness, flattenBottom])

  useEffect(() => {
    if (tilesetRef.current && selectionBounds) {
      const showExpr = `\${_x} >= ${selectionBounds.west} && \${_x} <= ${selectionBounds.east} && \${_y} >= ${selectionBounds.south} && \${_y} <= ${selectionBounds.north}`
      tilesetRef.current.style = new Cesium3DTileStyle({
        color: `color("${buildingColor}")`,
        show: showExpr,
      })
    }
  }, [buildingColor, selectionBounds])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || !selectionBounds || !terrainProvider || !includeTerrain) return
    if (!solidTerrainPrimitiveRef.current) return
    if (appliedTerrainColorRef.current === terrainColor) return

    if (solidTerrainPrimitiveRef.current) {
      try {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
      } catch {
        void 0
      }
      solidTerrainPrimitiveRef.current = null
    }

    ;(async () => {
      try {
        const solidTerrain = await createSolidTerrainPrimitive(selectionBounds, terrainProvider, {
          terrainThickness,
          flattenBottom,
          terrainColor,
        })
        viewer.scene.primitives.add(solidTerrain.primitive)
        solidTerrainPrimitiveRef.current = solidTerrain.primitive
        appliedTerrainColorRef.current = terrainColor
        clearGlobeClippingPlanes(viewer.scene.globe)
        viewer.scene.globe.show = false
      } catch (err) {
        console.error('[Preview3D] Terrain color update failed:', err)
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainColor])

  return <div ref={containerRef} style={containerStyle} />
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
}
