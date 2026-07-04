import { useEffect, useRef } from 'react'
import {
  Viewer,
  Cesium3DTileset,
  Color,
  Cartesian3,
  Math as CesiumMath,
  Ion,
  CesiumTerrainProvider,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import type { PipelineState } from '../types/pipeline'
import { resolveMuniCode, findTilesetUrl } from '../lib/catalogApi'
import { applyClippingToTileset } from '../lib/clipping'

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  sceneRef?: React.MutableRefObject<any>
  lod: 'lod1' | 'lod2'
  manifoldRef?: React.MutableRefObject<any>
  onPipelineStateChange?: (state: PipelineState) => void
}

export default function Preview3D({
  selectionBounds,
  lod,
  onPipelineStateChange,
}: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tilesetRef = useRef<Cesium3DTileset | null>(null)
  const rectangleRef = useRef<any>(null)

  useEffect(() => {
    console.log('[Preview3D] Viewer useEffect fired')
    if (!containerRef.current) return

    const viewer = new Viewer(containerRef.current, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      skyBox: false,
      skyAtmosphere: false,
    })

    viewer.scene.backgroundColor = new Color(0x1a2332)
    viewer.scene.globe.baseColor = new Color(0x1a2332)

    Ion.defaultAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODVhMmQ5OS1hOWZjLTQ3YmYtODlmNi1lNWUwY2MwOGUxYTMiLCJpZCI6MTQ5ODk3LCJpYXQiOjE2ODc5MzQ3NDN9.OG0mc3i7ZxGwHQjlMv3TRjiOvKWpzxglxmJRaUIykTY'

    const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement
    if (creditContainer) {
      creditContainer.style.display = 'none'
    }

    viewerRef.current = viewer

    const loadTerrain = async () => {
      try {
        const terrainProvider = await CesiumTerrainProvider.fromIonAssetId(3258112)
        if (viewerRef.current) {
          viewer.scene.terrainProvider = terrainProvider
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
      viewer.destroy()
      viewerRef.current = null
    }
  }, [])

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

    if (rectangleRef.current) {
      try {
        viewer.entities.remove(rectangleRef.current)
      } catch {
        void 0
      }
      rectangleRef.current = null
    }

    if (!selectionBounds) {
      onPipelineStateChange?.({
        phase: 'idle',
        progress: 0,
        message: '',
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

        const w = bounds.west
        const s = bounds.south
        const e = bounds.east
        const n = bounds.north
        const rectangle = viewer!.entities.add({
          polyline: {
            positions: [
              Cartesian3.fromDegrees(w, s, 300),
              Cartesian3.fromDegrees(w, n, 300),
              Cartesian3.fromDegrees(e, n, 300),
              Cartesian3.fromDegrees(e, s, 300),
              Cartesian3.fromDegrees(w, s, 300),
            ],
            width: 15,
            material: Color.RED,
          },
        })
        rectangleRef.current = rectangle

        const flyLon = (bounds.west + bounds.east) / 2
        const flyLat = (bounds.south + bounds.north) / 2
        const widthDeg = bounds.east - bounds.west
        const heightDeg = bounds.north - bounds.south
        const widthMeters = CesiumMath.toRadians(widthDeg) * 6371000 * Math.cos(CesiumMath.toRadians(flyLat))
        const heightMeters = CesiumMath.toRadians(heightDeg) * 6371000
        const maxDim = Math.max(widthMeters, heightMeters)
        const cameraHeight = Math.max(maxDim * 2, 300)

        viewer!.camera.flyTo({
          destination: Cartesian3.fromDegrees(flyLon, flyLat, cameraHeight),
          orientation: {
            heading: 0,
            pitch: CesiumMath.toRadians(-90),
            roll: 0,
          },
        })

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
  }, [selectionBounds, lod, onPipelineStateChange])

  return <div ref={containerRef} style={containerStyle} />
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'relative',
}
