import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Viewer,
  Cesium3DTileset,
  Color,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  SceneMode,
  CesiumTerrainProvider,
  ClippingPlaneCollection,
  CustomShader,
  CustomShaderMode,
  CustomShaderTranslucencyMode,
  Credit,
  CreditDisplay,
  DirectionalLight,
  GridImageryProvider,
  HeadingPitchRange,
  LightingModel,
  Matrix4,
  OrthographicFrustum,
  PerspectiveFrustum,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cesium3DTileFeature,
  Material,
  srgbToLinear,
  UniformType,
} from 'cesium'
import type { BoundingSphere, Cesium3DTile, Primitive, TerrainProvider } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Ion不使用のため、Viewer既定のIonロゴを「© Cesium」に置き換える
CreditDisplay.cesiumCredit = new Credit('© Cesium', true)

import type { SelectionBounds } from '../hooks/useRectangleSelection'
import type { PipelineState } from '../types/pipeline'
import { resolveMuniCodes, findBestTilesetUrl, getCoverageDetails, type Lod } from '../lib/catalogApi'
import {
  applyClippingToTileset,
  createGlobeClippingPlanes,
  refilterPickPoints,
  refilterSpanning,
  checkFeatureBounds,
} from '../lib/clipping'
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
} from '../lib/gsiTileConfig'
import {
  sampleTerrainData,
  buildSolidTerrainPrimitive,
  type TerrainSampleData,
} from '../lib/solidTerrain'
import {
  estimatePreviewLoad,
  classifyPreviewLoad,
  adaptiveTerrainGridSize,
  previewMaxZoomDistance,
  isSmallRange,
  isLargeRange,
  pickTerrainLevel,
  type PreviewLoadEstimate,
} from '../lib/previewBudget'
import ModelSizeOverlay from './ModelSizeOverlay'
import BuildingListPanel, { type BuildingListItem } from './BuildingListPanel'

// 建物ホバー時のハイライト色。
// Cesium3DTileFeature.featureId はタイル(content)毎に 0 から振られるため、
// tileset 共通の uniform で ID 一致を取ると同一 batchId の他棟まで光ってしまう。
// feature.color に設定して棟単位で乗算させる（ダミー色は白固定）。
const HOVER_COLOR = Color.fromCssColorString('#ff9800')

function colorToLinearCartesian3(color: Color): Cartesian3 {
  return new Cartesian3(
    srgbToLinear(color.red),
    srgbToLinear(color.green),
    srgbToLinear(color.blue),
  )
}

export const DEFAULT_BUILDING_COLOR = '#f4f1ea'
const WHITE_MODEL_AMBIENT_BOOST = 0.2

// 白模型の直射光スケール。1.0だと日向面が純白(255)に張り付いて屋上の階調が消えるため、
// トーンマッピング後にクリップが残らない値まで落とす(実測: 飽和14.2%→0.04%、平均輝度ほぼ不変)。
const WHITE_MODEL_LIGHT_COLOR = 0.7

// 地面クランプの余裕(m)。includeTerrain=true では Cesium の地面衝突判定が無効なため、
// ズームで地形メッシュの裏へ抜けて見えるのを防ぐ(preRender で地表+この値まで戻す)。
const CAMERA_GROUND_CLEARANCE = 2

// 白模型用の球面調和係数(PLATEAU公式チュートリアル tpc06-2 の値)。
// 指向性ライトだけでは陰面が暗く平坦になるため、全方位の拡散光で陰影に階調を作る。
const WHITE_MODEL_SH_COEFFICIENTS = [
  new Cartesian3(1.5, 1.5, 1.5),
  new Cartesian3(1.25, 1.25, 1.25),
  new Cartesian3(1.5, 1.5, 1.5),
  new Cartesian3(-1.25, -1.25, -1.25),
  new Cartesian3(-1.0, -1.0, -1.0),
  new Cartesian3(1.25, 1.25, 1.25),
  new Cartesian3(0, 0, 0),
  new Cartesian3(-1.0, -1.0, -1.0),
  new Cartesian3(0, 0, 0),
]

function createBuildingCustomShader(color: Color): CustomShader {
  return new CustomShader({
    mode: CustomShaderMode.REPLACE_MATERIAL,
    lightingModel: LightingModel.PBR,
    translucencyMode: CustomShaderTranslucencyMode.OPAQUE,
    uniforms: {
      u_buildingColor: {
        type: UniformType.VEC3,
        value: colorToLinearCartesian3(color),
      },
      u_ambientBoost: {
        type: UniformType.FLOAT,
        value: 0.0,
      },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        // REPLACE_MATERIAL では czm_modelMaterial.specular が既定 vec3(1.0) のまま残る。
        // PBR の拡散項は (1.0 - F) * diffuse（F は specular から算出）のため、
        // F0=1 だと diffuse が消えて建物色・ホバー色が描画に反映されない。
        // 非金属の標準 F0(0.04) を設定して拡散反射を有効にする。
        material.specular = vec3(0.04);
        vec3 base = u_buildingColor;
        material.diffuse = base;
        if (u_ambientBoost > 0.0) {
          material.emissive = base * u_ambientBoost;
        }
        material.alpha = 1.0;
      }
    `,
  })
}

function clearGlobeClippingPlanes(
  globe: { clippingPlanes: ClippingPlaneCollection | undefined }
): void {
  globe.clippingPlanes = undefined
}

// 平行投影中のホイールズーム。Cesium のズームはカメラ位置を動かすだけで
// ortho の frustum.width を変えないため見た目の拡大率が変化しない。
// enableZoom を切って width を直接スケールする(1ノッチ≒5%)。
const ORTHO_ZOOM_MIN_WIDTH = 1
const ORTHO_ZOOM_MAX_WIDTH = 20000
const ORTHO_ZOOM_PER_NOTCH = 0.0005

function attachOrthographicZoom(viewer: Viewer): () => void {
  const controller = viewer.scene.screenSpaceCameraController
  controller.enableZoom = false
  const canvas = viewer.scene.canvas
  const onWheel = (e: WheelEvent): void => {
    if (viewer.isDestroyed()) return
    const frustum = viewer.camera.frustum
    if (!(frustum instanceof OrthographicFrustum)) return
    const width = frustum.width
    if (typeof width !== 'number' || !Number.isFinite(width)) return
    e.preventDefault()
    // Firefox等の line 単位ホイールをピクセル相当へ揃える
    const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY
    const factor = Math.exp(delta * ORTHO_ZOOM_PER_NOTCH)
    frustum.width = Math.min(
      Math.max(width * factor, ORTHO_ZOOM_MIN_WIDTH),
      ORTHO_ZOOM_MAX_WIDTH
    )
    viewer.scene.requestRender()
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    canvas.removeEventListener('wheel', onWheel)
    if (!viewer.isDestroyed()) {
      controller.enableZoom = true
    }
  }
}

interface WhiteModelSaved {
  fogDensity: number | null
  fogEnabled: boolean | null
  aoEnabled: boolean | null
  aoUniforms: Record<string, number | boolean> | null
  imageryBrightness: number | null
  imagerySaturation: number | null
  tilesetOriginals: WeakMap<
    object,
    {
      imageBasedLightingFactor?: Cartesian2
      sphericalHarmonicCoefficients?: Cartesian3[]
      lightColor?: Cartesian3
    }
  >
}

function saveTilesetOriginal(
  ts: Cesium3DTileset,
  saved: WhiteModelSaved | undefined,
): void {
  if (!saved) return
  if (saved.tilesetOriginals.has(ts as object)) return
  try {
    const t = ts as unknown as {
      imageBasedLighting?: {
        imageBasedLightingFactor?: Cartesian2
        sphericalHarmonicCoefficients?: Cartesian3[]
      }
      lightColor?: Cartesian3
    }
    saved.tilesetOriginals.set(ts as object, {
      imageBasedLightingFactor: t.imageBasedLighting?.imageBasedLightingFactor?.clone?.(),
      sphericalHarmonicCoefficients: t.imageBasedLighting?.sphericalHarmonicCoefficients,
      lightColor: t.lightColor?.clone?.() ?? t.lightColor,
    })
  } catch {
    void 0
  }
}

function applyWhiteModelToTileset(
  ts: Cesium3DTileset,
  enabled: boolean,
  saved?: WhiteModelSaved,
): void {
  try {
    const t = ts as unknown as {
      imageBasedLighting?: {
        imageBasedLightingFactor?: Cartesian2
        sphericalHarmonicCoefficients?: Cartesian3[]
      }
      lightColor?: Cartesian3
    }
    const ibl = t.imageBasedLighting
    if (enabled) {
      saveTilesetOriginal(ts, saved)
      if (ibl) {
        // 鏡面(specular)=0 で空由来の青い反射を遮断し、拡散光はニュートラルな
        // 球面調和係数で与える。IBL既定値のままだと白が青く濁って灰色に見える。
        ibl.imageBasedLightingFactor = new Cartesian2(1.0, 0.0)
        ibl.sphericalHarmonicCoefficients = WHITE_MODEL_SH_COEFFICIENTS
      }
      if ('lightColor' in ts) {
        t.lightColor = new Cartesian3(
          WHITE_MODEL_LIGHT_COLOR,
          WHITE_MODEL_LIGHT_COLOR,
          WHITE_MODEL_LIGHT_COLOR,
        )
      }
      return
    }
    // OFF時はONで保存した元の値だけを復元する。保存がなければ何も触らない
    // （機能実装前の描画 = Cesium既定値を維持するため）。
    if (!saved) return
    const original = saved.tilesetOriginals.get(ts as object)
    if (!original) return
    if (ibl && original.imageBasedLightingFactor !== undefined) {
      ibl.imageBasedLightingFactor = original.imageBasedLightingFactor
    }
    if (ibl) {
      ibl.sphericalHarmonicCoefficients = original.sphericalHarmonicCoefficients
    }
    if ('lightColor' in ts) {
      // 元が未設定(undefined)だった場合も含めて復元する。undefined を代入すると
      // Model側がシェーダーを再構築し、既定のシーンライト使用に戻る。
      t.lightColor = original.lightColor
    }
    saved.tilesetOriginals.delete(ts as object)
  } catch {
    void 0
  }
}

function applyWhiteModelLook(
  viewer: Viewer,
  enabled: boolean,
  imagery: { current: { brightness: number; saturation: number } | null },
  saved: WhiteModelSaved,
): void {
  if (!enabled) {
    // 白模型OFF時は常に影を有効化する（起動時点の値に依存させない）
    try {
      viewer.shadows = true
    } catch {
      void 0
    }
    try {
      const stages = viewer.scene.postProcessStages as unknown as {
        ambientOcclusion?: {
          enabled: boolean
          uniforms: Record<string, number | boolean>
        }
      }
      const ao = stages?.ambientOcclusion
      if (ao && saved.aoEnabled !== null) {
        ao.enabled = saved.aoEnabled
        if (saved.aoUniforms) {
          for (const [key, value] of Object.entries(saved.aoUniforms)) {
            try {
              ao.uniforms[key] = value
            } catch {
              void 0
            }
          }
        }
        saved.aoEnabled = null
        saved.aoUniforms = null
      }
    } catch {
      void 0
    }
    try {
      const fog = viewer.scene.fog
      if (fog) {
        if (saved.fogEnabled !== null && typeof (fog as { enabled?: unknown }).enabled === 'boolean') {
          fog.enabled = saved.fogEnabled
        }
        if (saved.fogDensity !== null && typeof fog.density === 'number') {
          fog.density = saved.fogDensity
        }
        saved.fogEnabled = null
        saved.fogDensity = null
      }
    } catch {
      void 0
    }
    try {
      const layer = imagery.current
      if (layer) {
        if (saved.imageryBrightness !== null) {
          layer.brightness = saved.imageryBrightness
          saved.imageryBrightness = null
        }
        if (saved.imagerySaturation !== null) {
          layer.saturation = saved.imagerySaturation
          saved.imagerySaturation = null
        }
      }
    } catch {
      void 0
    }
    return
  }
  // 白模型ON時も建物の落影を描画する（影なしだと平坦で浮いて見えるため）
  try {
    viewer.shadows = true
  } catch {
    void 0
  }
  try {
    const stages = viewer.scene.postProcessStages as unknown as {
      ambientOcclusion?: {
        enabled: boolean
        uniforms: Record<string, number | boolean>
      }
    }
    const ao = stages?.ambientOcclusion
    if (ao) {
      if (saved.aoEnabled === null) {
        saved.aoEnabled = ao.enabled
        saved.aoUniforms = { ...ao.uniforms }
      }
      ao.enabled = true
      // AOの細かい縞ノイズ対策。lengthCap を小さくするとサンプリングが高周波化して
      // モアレ状の縞が出るため、Cesium既定の 0.26 を使い bias も強めにする。
      ao.uniforms['intensity'] = 1.1
      ao.uniforms['bias'] = 0.3
      ao.uniforms['lengthCap'] = 0.26
      ao.uniforms['ambientOcclusionOnly'] = false
    }
  } catch {
    void 0
  }
  try {
    const fog = viewer.scene.fog
    if (fog) {
      if (saved.fogEnabled === null && typeof (fog as { enabled?: unknown }).enabled === 'boolean') {
        saved.fogEnabled = fog.enabled as boolean
      }
      if (saved.fogDensity === null && typeof fog.density === 'number') {
        saved.fogDensity = fog.density
      }
      fog.enabled = true
      fog.density = 0.00045
    }
  } catch {
    void 0
  }
  try {
    const layer = imagery.current
    if (layer) {
      if (saved.imageryBrightness === null) {
        saved.imageryBrightness = layer.brightness
      }
      if (saved.imagerySaturation === null) {
        saved.imagerySaturation = layer.saturation
      }
      layer.brightness = 1.5
      layer.saturation = 0.2
    }
  } catch {
    void 0
  }
}

function applyContour(viewer: Viewer, style: GsiTileStyle): void {
  const globe: any = viewer.scene.globe
  const tp: any = globe.terrainProvider
  const isEllipsoid = !tp || tp.constructor?.name === 'EllipsoidTerrainProvider' || tp.availability === undefined
  if (!isContourStyle(style) || isEllipsoid) {
    globe.material = undefined
    viewer.scene.requestRender()
    return
  }
  try {
    const carto = (viewer.camera as any).positionCartographic
    let h: number
    if (carto) {
      h = carto.height
    } else {
      const mag = (viewer.camera as any).getMagnitude?.()
      h = typeof mag === 'number' && Number.isFinite(mag) ? mag - 6378137 : 10000
    }
    if (h > 100000) {
      globe.material = undefined
      viewer.scene.requestRender()
      return
    }
    const spacing = h > 30000 ? 100 : h > 15000 ? 50 : h > 8000 ? 20 : 10
    const mat: any = Material.fromType(Material.ElevationContourType)
    mat.uniforms.spacing = spacing
    mat.uniforms.width = 1.5
    mat.uniforms.color = Color.fromCssColorString('#5a3a1a').withAlpha(0.6)
    globe.material = mat
  } catch {
    globe.material = undefined
  }
  viewer.scene.requestRender()
}

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

  const h = cartoHeight ?? (magHeight ?? 10000)
  let contourActive = false
  let contourReason = ''
  let spacingUsed: number | null = null
  if (!isContourStyle(style)) {
    contourReason = `style=${style} は等高線スタイルではない`
  } else if (isEllipsoid) {
    contourReason = 'terrain=Ellipsoid (availability無し)'
  } else if (h > 40000) {
    contourReason = `height ${h.toFixed(0)}m > 40000m`
  } else {
    contourActive = true
    spacingUsed = h > 20000 ? 50 : h > 8000 ? 20 : 10
    contourReason = `適用中 (spacing=${spacingUsed})`
  }

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
        top: '90px',
        right: '16px',
        zIndex: 30,
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

function sameBounds(a: SelectionBounds, b: SelectionBounds): boolean {
  return a.west === b.west && a.south === b.south && a.east === b.east && a.north === b.north
}

interface Preview3DProps {
  selectionBounds: SelectionBounds | null
  lod: Lod
  onPipelineStateChange?: (state: PipelineState) => void
  showTerrainImagery?: boolean
  terrainThickness?: number
  flattenBottom?: boolean
  includeTerrain?: boolean
  buildingColor?: string
  terrainColor?: string
  whiteModel?: boolean
  scale?: number
  onScaleChange?: (newScale: number) => void
  includeSpanningBuildings?: boolean
  pickPoints?: Array<{ lon: number; lat: number }>
  excludedBuildingIds?: string[]
  onExcludedBuildingIdsChange?: (ids: string[]) => void
  isDevMode?: boolean
}

export default function Preview3D({
  selectionBounds,
  lod,
  onPipelineStateChange,
  showTerrainImagery = false,
  terrainThickness = 10,
  flattenBottom = true,
  includeTerrain = true,
  buildingColor = DEFAULT_BUILDING_COLOR,
  terrainColor = '#ffffff',
  whiteModel = false,
  scale = 1,
  onScaleChange,
  includeSpanningBuildings = false,
  pickPoints,
  excludedBuildingIds,
  onExcludedBuildingIdsChange,
  isDevMode = false,
}: Preview3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tilesetsRef = useRef<Cesium3DTileset[]>([])
  const solidTerrainPrimitiveRef = useRef<Primitive | null>(null)
  const gridLayerRef = useRef<any>(null)
  const gsiLayerRef = useRef<any>(null)
  const terrainSampleCacheRef = useRef<TerrainSampleData | null>(null)
  const buildingMinYCacheRef = useRef<Map<string, number | null>>(new Map())
  const appliedTerrainParamsRef = useRef<{ terrainThickness: number; flattenBottom: boolean; terrainColor: string } | null>(null)
  const cameraFramedForRef = useRef<SelectionBounds | null>(null)
  const [isOrthographic, setIsOrthographic] = useState(false)
  const [gsiStyle, setGsiStyle] = useState<GsiTileStyle>(() => loadGsiStyle())
  const gsiStyleRef = useRef(gsiStyle)
  useEffect(() => { gsiStyleRef.current = gsiStyle }, [gsiStyle])
  const terrainBoundingSphereRef = useRef<BoundingSphere | null>(null)
  const [debugInfo, setDebugInfo] = useState<{isFallback:boolean, minTopHeight:number, variance:number, buildingMinY:number|null, delta:number|null, terrainPrimitive:boolean}|null>(null)
  const [contourDebug, setContourDebug] = useState<ContourDebugInfo | null>(null)
  const [contourDebugCollapsed, setContourDebugCollapsed] = useState(false)
  useEffect(() => {
    if (isDevMode) {
      ;(window as any).__terrainDebug = debugInfo
    } else {
      try {
        delete (window as any).__terrainDebug
      } catch {
        void 0
      }
    }
  }, [debugInfo, isDevMode])
  const isDevModeRef = useRef(isDevMode)
  useEffect(() => {
    isDevModeRef.current = isDevMode
  }, [isDevMode])
  const isOrthographicRef = useRef(false)
  const toggleProjectionRef = useRef<(() => void) | null>(null)
  const orthoWheelCleanupRef = useRef<(() => void) | null>(null)
  const applyPresetViewRef = useRef<
    ((headingDeg: number, pitchDeg: number, opts?: { useTop?: boolean }) => void) | null
  >(null)
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(null)
  const [terrainError, setTerrainError] = useState<string | null>(null)

  const excludedIdsRef = useRef<Set<string>>(new Set())
  const undoStackRef = useRef<string[]>([])
  const gmlidPropNameRef = useRef<string | null>(null)
  const hoveredFeatureRef = useRef<Cesium3DTileFeature | null>(null)
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null)
  const tileLoadHandlerRef = useRef<((tile: any) => void) | null>(null)
  const onExcludedChangeRef = useRef(onExcludedBuildingIdsChange)
  const buildingColorRef = useRef(buildingColor)
  const whiteModelRef = useRef(whiteModel)
  const whiteModelSavedRef = useRef<WhiteModelSaved>({
    fogDensity: null,
    fogEnabled: null,
    aoEnabled: null,
    aoUniforms: null,
    imageryBrightness: null,
    imagerySaturation: null,
    tilesetOriginals: new WeakMap(),
  })
  const registryRef = useRef<Map<string, BuildingListItem>>(new Map())
  const [excludedCount, setExcludedCount] = useState(0)
  const [excludedIdsState, setExcludedIdsState] = useState<string[]>([])
  const [buildingItems, setBuildingItems] = useState<BuildingListItem[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [totalTiles, setTotalTiles] = useState<number | null>(null)
  const [loadedTiles, setLoadedTiles] = useState<number | null>(null)
  const [buildingLoadDetail, setBuildingLoadDetail] = useState<string | null>(null)
  const [buildingLoadProgress, setBuildingLoadProgress] = useState<number | null>(null)
  const [coverageWarning, setCoverageWarning] = useState<string | null>(null)
  const [forceBuildingsBounds, setForceBuildingsBounds] = useState<SelectionBounds | null>(null)
  const [canForceBuildings, setCanForceBuildings] = useState(false)
  const maxTilesRef = useRef(0)
  const pendingMapRef = useRef<Map<Cesium3DTileset, number>>(new Map())
  const progressListenersRef = useRef<Map<Cesium3DTileset, (pending: number, processing: number) => void>>(new Map())
  const progressThrottleRef = useRef(0)
  const listRafRef = useRef<number | null>(null)

  buildingColorRef.current = buildingColor
  whiteModelRef.current = whiteModel
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
      // showはクリッピング(refilterSpanning/filterTileFeatures)の判定を維持するため触らない
      // 色は CustomShader の u_buildingColor で制御するため、
      // feature.color は乗算が掛からない白に固定する
      feature.color = Color.WHITE
    }
  }

  const setHoveredFeature = (feature: Cesium3DTileFeature | null): void => {
    const prev = hoveredFeatureRef.current
    if (prev && prev !== feature) {
      // 直前の棟の色を白（乗算なし）へ戻す
      applyStateToFeature(prev)
    }
    hoveredFeatureRef.current = feature
    if (feature && feature.show) {
      feature.color = HOVER_COLOR
    }
    viewerRef.current?.scene.requestRender()
  }

  const restoreFiltersAndColors = (): void => {
    for (const ts of tilesetsRef.current) {
      refilterSpanning(ts)
    }
    forEachBuildingFeature(applyStateToFeature)
    viewerRef.current?.scene.requestRender()
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
    setHoveredFeature(null)
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
    setHoveredFeature(null)
    if (!id || !canvas) return
    forEachBuildingFeature((feature) => {
      if (hoveredFeatureRef.current) return
      if (getBuildingId(feature) !== id || !feature.show) return
      setHoveredFeature(feature)
    })
  }

  const latestTerrainParamsRef = useRef({ terrainThickness, flattenBottom, terrainColor })
  latestTerrainParamsRef.current = { terrainThickness, flattenBottom, terrainColor }

  const toggleProjection = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (isOrthographicRef.current) {
      orthoWheelCleanupRef.current?.()
      orthoWheelCleanupRef.current = null
      viewer.camera.switchToPerspectiveFrustum()
      isOrthographicRef.current = false
      setIsOrthographic(false)
      try {
        window.dispatchEvent(
          new CustomEvent('preview:projectionChange', { detail: { mode: 'perspective' } })
        )
      } catch {}
    } else {
      viewer.camera.switchToOrthographicFrustum()
      if (selectionBounds) {
        const lat = (selectionBounds.north + selectionBounds.south) / 2
        const wM =
          Math.abs(selectionBounds.east - selectionBounds.west) *
          (Math.PI / 180) *
          6371000 *
          Math.cos((lat * Math.PI) / 180)
        const hM = Math.abs(selectionBounds.north - selectionBounds.south) * (Math.PI / 180) * 6371000
        const maxDim = Math.max(wM, hM)
        try {
          ;(viewer.camera.frustum as OrthographicFrustum).width = Math.max(maxDim * 1.6, 300)
        } catch {}
      }
      // 平行投影では Cesium 既定のズームが効かないため、wheel→frustum.width へ差し替える
      orthoWheelCleanupRef.current = attachOrthographicZoom(viewer)
      isOrthographicRef.current = true
      setIsOrthographic(true)
      try {
        window.dispatchEvent(
          new CustomEvent('preview:projectionChange', { detail: { mode: 'orthographic' } })
        )
      } catch {}
    }
    viewer.scene.requestRender()
  }, [selectionBounds])

  const applyPresetView = useCallback(
    (headingDeg: number, pitchDeg: number, opts?: { useTop?: boolean }) => {
      const viewer = viewerRef.current
      if (!viewer) return
      const bounds = selectionBounds
      if (!bounds) {
        viewer.camera.setView({
          orientation: {
            heading: CesiumMath.toRadians(headingDeg),
            pitch: CesiumMath.toRadians(pitchDeg),
            roll: 0,
          },
        })
        viewer.scene.requestRender()
        try {
          window.dispatchEvent(
            new CustomEvent('preview:viewChange', { detail: { headingDeg, pitchDeg, opts } })
          )
        } catch {}
        return
      }
      const flyLon = (bounds.west + bounds.east) / 2
      const flyLat = (bounds.south + bounds.north) / 2
      const widthDeg = bounds.east - bounds.west
      const heightDeg = bounds.north - bounds.south
      const widthMeters =
        CesiumMath.toRadians(widthDeg) * 6371000 * Math.cos(CesiumMath.toRadians(flyLat))
      const heightMeters = CesiumMath.toRadians(heightDeg) * 6371000
      const maxDim = Math.max(widthMeters, heightMeters)
      const range = Math.max(maxDim * 2.4, 300)
      const cameraHeight = Math.max(maxDim * 2, 300)

      cameraFramedForRef.current = bounds

      const useTop = opts?.useTop || pitchDeg === -90
      if (useTop) {
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(flyLon, flyLat, cameraHeight),
          orientation: {
            heading: CesiumMath.toRadians(headingDeg),
            pitch: CesiumMath.toRadians(pitchDeg),
            roll: 0,
          },
        })
      } else if (terrainBoundingSphereRef.current) {
        viewer.camera.viewBoundingSphere(
          terrainBoundingSphereRef.current,
          new HeadingPitchRange(
            CesiumMath.toRadians(headingDeg),
            CesiumMath.toRadians(pitchDeg),
            range
          )
        )
        viewer.camera.lookAtTransform(Matrix4.IDENTITY)
      } else {
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(flyLon, flyLat, range),
          orientation: {
            heading: CesiumMath.toRadians(headingDeg),
            pitch: CesiumMath.toRadians(pitchDeg),
            roll: 0,
          },
        })
      }
      viewer.scene.requestRender()
      try {
        window.dispatchEvent(
          new CustomEvent('preview:viewChange', { detail: { headingDeg, pitchDeg, opts } })
        )
      } catch {}
    },
    [selectionBounds]
  )

  void PerspectiveFrustum
  toggleProjectionRef.current = toggleProjection
  applyPresetViewRef.current = applyPresetView

  useEffect(() => {
    ;(window as any).__previewControls = {
      toggleProjection: () => toggleProjectionRef.current?.(),
      setView: (headingDeg: number, pitchDeg: number, opts?: any) =>
        applyPresetViewRef.current?.(headingDeg, pitchDeg, opts),
      getProjection: () => (isOrthographicRef.current ? 'orthographic' : 'perspective'),
      isOrthographic: () => isOrthographicRef.current,
    }
  }, [isOrthographic, selectionBounds])

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
      // 白模型ON時は影なしで起動する（OFF時にapplyWhiteModelLookで有効化される）
      shadows: !whiteModelRef.current,
    })

    viewer.scene.backgroundColor = Color.fromCssColorString('#0d1117')
    viewer.scene.globe.baseColor = Color.fromCssColorString('#5a7a9a')
    viewer.scene.globe.enableLighting = true
    viewer.scene.globe.lightingFadeOutDistance = 5000.0
    viewer.scene.globe.lightingFadeInDistance = 1000.0
    viewer.scene.globe.depthTestAgainstTerrain = true

    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 10000.0

    // ホイール1ノッチの変化が大きすぎるため、ズーム倍率を既定(5.0)から半分にする。
    // 変化量は距離比例で、1ノッチ(Chrome, deltaY=100)あたりの拡大率は zoomFactor に比例する。
    viewer.scene.screenSpaceCameraController.zoomFactor = 2.5

    // 地平線より上(地下側)を向く tilt 操作を禁止する。真横までは許可。
    // これがないと tilt で天地が反転し、モデルの裏面へ回り込めてしまう。
    viewer.scene.screenSpaceCameraController.maximumTiltAngle = Math.PI / 2

    // includeTerrain=true では globe.show=false + 地形は Primitive のため、Cesium の
    // 地面衝突判定が無効(Scene.getHeight は globe.show か enableCollision=true の3D Tilesしか
    // 見ない)。さらに globe.show=false 中は Globe の地形タイル更新自体が止まり globe.getHeight も
    // 信頼できない。そのため表示中のソリッド地形と同一のサンプル格子から地表高を補間し、
    // カメラ高さを地表+CAMERA_GROUND_CLEARANCE 以上へ戻す(範囲外はメッシュが無いため対象外)。
    const groundCartoScratch = new Cartographic()
    const groundEcefScratch = new Cartesian3()
    const groundHeightAt = (
      sample: TerrainSampleData,
      x: number,
      y: number
    ): number => {
      const i = (y * sample.gridSize + x) * 3
      groundEcefScratch.x = sample.topEcefValues[i]
      groundEcefScratch.y = sample.topEcefValues[i + 1]
      groundEcefScratch.z = sample.topEcefValues[i + 2]
      return Cartographic.fromCartesian(
        groundEcefScratch,
        undefined,
        groundCartoScratch
      ).height
    }
    const clampCameraAboveGround = (): void => {
      if (viewer.isDestroyed()) return
      const sample = terrainSampleCacheRef.current
      if (!sample || !solidTerrainPrimitiveRef.current) return
      const carto = viewer.camera.positionCartographic
      const { west, south, east, north } = sample.bounds
      const fx = (CesiumMath.toDegrees(carto.longitude) - west) / (east - west)
      const fy = (CesiumMath.toDegrees(carto.latitude) - south) / (north - south)
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
      const g = sample.gridSize - 1
      const cx = Math.min(g, Math.max(0, fx * g))
      const cy = Math.min(g, Math.max(0, fy * g))
      const x0 = Math.floor(cx)
      const y0 = Math.floor(cy)
      const x1 = Math.min(g, x0 + 1)
      const y1 = Math.min(g, y0 + 1)
      const tx = cx - x0
      const ty = cy - y0
      const h00 = groundHeightAt(sample, x0, y0)
      const h10 = groundHeightAt(sample, x1, y0)
      const h01 = groundHeightAt(sample, x0, y1)
      const h11 = groundHeightAt(sample, x1, y1)
      const ground = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty
      if (!Number.isFinite(ground)) return
      const minHeight = ground + CAMERA_GROUND_CLEARANCE
      if (carto.height < minHeight) {
        viewer.camera.position = Cartesian3.fromRadians(
          carto.longitude,
          carto.latitude,
          minHeight,
        )
      }
    }
    viewer.scene.preRender.addEventListener(clampCameraAboveGround)

    // 静止中は描画を停止してGPU負荷を抑える。シーンを変更した箇所で
    // scene.requestRender() を呼ぶ（カメラ移動・タイル読込はCesiumが自動で再描画する）。
    viewer.scene.requestRenderMode = true

    const directionalLight = new DirectionalLight({
      direction: new Cartesian3(0.5, -0.5, -1.0),
    })
    viewer.scene.light = directionalLight

    // 影の到達距離・解像度・ちらつき対策。
    // 既定の maximumDistance=5000m ではカメラから5km超の建物が影マップ対象外になり、
    // 遠方がのっぺりする。Cesium の上限(20000m)まで許容してできるだけ影を出す。
    // 実際の影カメラ far は画面内オブジェクトに追従する(Scene が near/far をフィットする)ため、
    // 狭い範囲を見ているときは品質は落ちない。size を上げて遠距離の解像度を稼ぐ。
    // softShadows(PCF) はフラット面にモアレ模様が出る既知の不具合があるため無効にする
    // (https://community.cesium.com/t/moire-pattern-when-turning-on-soft-shadows/16011)。
    const shadowMap = viewer.scene.shadowMap
    shadowMap.enabled = true
    shadowMap.size = 4096
    shadowMap.softShadows = false
    shadowMap.normalOffset = true
    shadowMap.fadingEnabled = true
    // 影の暗さ(shadowMap.darkness)を PLATEAU View 5.0 (Map環境) の実運用値と
    // 同じ 0.7 にする。0.35 では日陰面が暗く沈み、浅い角度で壁面が多く見える
    // 向きだとモデル全体が灰色に見えていた（浅視点の暗画素 54% → 0.7で0.5%）。
    shadowMap.darkness = 0.7
    shadowMap.maximumDistance = 20000.0

    // 影のエッジを柔らかくする softShadows(PCF) はフラット面にモアレを生むため使えない。
    // 代わりに FXAA(1パスのポストプロセス)を有効化し、輪郭や影エッジのジャギーを
    // 低負荷で軽減する。シーンは単色のためテクスチャがぼける副作用は出にくい。
    viewer.scene.postProcessStages.fxaa.enabled = true

    applyWhiteModelLook(viewer, whiteModelRef.current, gsiLayerRef, whiteModelSavedRef.current)

    // 直接配信の quantized-mesh (Ion不要) のみ使用
    const directTerrainUrl = (import.meta.env.VITE_TERRAIN_URL as string | undefined) ?? 'https://tile.plateauview.mlit.go.jp/terrain'

    viewerRef.current = viewer
    ;(window as any).__cesiumViewer = viewer
    ;(window as any).__previewControls = {
      toggleProjection: () => toggleProjectionRef.current?.(),
      setView: (headingDeg: number, pitchDeg: number, opts?: any) =>
        applyPresetViewRef.current?.(headingDeg, pitchDeg, opts),
      getProjection: () => (isOrthographicRef.current ? 'orthographic' : 'perspective'),
      isOrthographic: () => isOrthographicRef.current,
    }

    gsiLayerRef.current = viewer.scene.globe.imageryLayers.addImageryProvider(
      createGsiImageryProvider(gsiStyle)
    )

    applyContour(viewer, gsiStyle)
    const onMoveEnd = () => {
      if ((viewerRef.current as any)?.isDestroyed?.()) return
      if (isContourStyle(gsiStyleRef.current)) applyContour(viewer, gsiStyleRef.current)
    }
    viewer.camera.moveEnd.addEventListener(onMoveEnd)
    ;(viewer as any)._machimokiContourCleanup = () => viewer.camera.moveEnd.removeEventListener(onMoveEnd)

    // 等高線デバッグパネル用のリアルタイム更新ループ（値が変わった時のみ再レンダリング）
    let contourDebugRaf = 0
    let lastContourDebugJson = ''
    const updateContourDebug = () => {
      if (!viewer.isDestroyed() && isDevModeRef.current) {
        const info = collectContourDebugInfo(viewer, gsiStyleRef.current)
        const json = JSON.stringify(info)
        if (json !== lastContourDebugJson) {
          lastContourDebugJson = json
          setContourDebug(info)
        }
      }
      contourDebugRaf = requestAnimationFrame(updateContourDebug)
    }
    contourDebugRaf = requestAnimationFrame(updateContourDebug)

    const loadTerrain = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Terrain load timeout (10s)')), 10000)
        })
        const terrainProvider = await Promise.race([
          CesiumTerrainProvider.fromUrl(directTerrainUrl, { requestVertexNormals: true } as any),
          timeoutPromise,
        ])
        if (timeoutId) clearTimeout(timeoutId)
        if (viewerRef.current) {
          viewer.scene.terrainProvider = terrainProvider
          setTerrainProvider(terrainProvider)
          if (isContourStyle(gsiStyleRef.current)) applyContour(viewer, gsiStyleRef.current)
          console.log('[Preview3D] Terrain set successfully')
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? `PLATEAU-Terrain取得失敗: ${err.message}`
            : 'PLATEAU-Terrain取得失敗'
        console.error('[Preview3D] PLATEAU-Terrain取得失敗 (フォールバックなし):', err)
        // フォールバック地形は一切設定しない。terrainProvider は null のまま UI にエラーを表示する
        setTerrainProvider(null)
        setTerrainError(message)
        onPipelineStateChange?.({
          phase: 'error',
          progress: 0,
          message,
          error: message,
        })
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
      terrainBoundingSphereRef.current = null
      setTerrainProvider(null)
      setTerrainError(null)
      try { (viewer as any)._machimokiContourCleanup?.() } catch {}
      cancelAnimationFrame(contourDebugRaf)
      try { viewer.scene.preRender.removeEventListener(clampCameraAboveGround) } catch {}
      orthoWheelCleanupRef.current?.()
      orthoWheelCleanupRef.current = null
      viewer.destroy()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const imageryLayers = viewer.scene.globe.imageryLayers

    // GSIレイヤーは showTerrainImagery とは独立に常時表示し、
    // Gridレイヤーの表示切替（showTerrainImagery=false で表示）は維持する
    for (let i = 0; i < imageryLayers.length; i++) {
      const layer = imageryLayers.get(i)
      if (layer === gridLayerRef.current) {
        layer.show = !showTerrainImagery
      } else {
        layer.show = true
      }
    }

    if (!showTerrainImagery && !gridLayerRef.current) {
      const gridProvider = new GridImageryProvider({
        cells: 8,
        color: Color.fromCssColorString('#ffffff'),
        glowColor: Color.fromCssColorString('#00bcd4'),
        backgroundColor: Color.fromCssColorString('#00000000'),
      })
      gridLayerRef.current = imageryLayers.addImageryProvider(gridProvider)
      gridLayerRef.current.alpha = 0.4
    }

    console.log(
      `[Preview3D] Imagery layers visibility set to: ${showTerrainImagery}`
    )
    viewer.scene.requestRender()
  }, [showTerrainImagery])

  // gsiStyle変更時にGSIレイヤーを差し替える（Gridレイヤーには触れない）
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const oldLayer = gsiLayerRef.current
    if (oldLayer) {
      viewer.scene.globe.imageryLayers.remove(oldLayer, true)
    }
    gsiLayerRef.current = viewer.scene.globe.imageryLayers.addImageryProvider(
      createGsiImageryProvider(gsiStyle)
    )
    if (whiteModelRef.current) {
      applyWhiteModelLook(viewer, true, gsiLayerRef, whiteModelSavedRef.current)
    }
    applyContour(viewer, gsiStyle)
    viewer.scene.requestRender()
  }, [gsiStyle])

  // 他タブ（App.tsx等）とlocalStorage経由でスタイルを同期する
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
    progressThrottleRef.current = 0
    pendingMapRef.current.clear()
    setBuildingItems([])
    setListLoading(false)
    setTotalTiles(null)
    setLoadedTiles(null)
    setBuildingLoadDetail(null)
    setBuildingLoadProgress(null)
    setCoverageWarning(null)
    setCanForceBuildings(false)

    if (solidTerrainPrimitiveRef.current) {
      try {
        viewer.scene.primitives.remove(solidTerrainPrimitiveRef.current)
      } catch {
        void 0
      }
      solidTerrainPrimitiveRef.current = null
    }

    const cachedTerrainSample = terrainSampleCacheRef.current
    if (
      !selectionBounds ||
      !cachedTerrainSample ||
      !sameBounds(cachedTerrainSample.bounds, selectionBounds)
    ) {
      terrainSampleCacheRef.current = null
    }
    appliedTerrainParamsRef.current = null
    terrainBoundingSphereRef.current = null

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
      if (terrainError) {
        onPipelineStateChange?.({
          phase: 'error',
          progress: 0,
          message: terrainError,
          error: terrainError,
        })
      } else {
        onPipelineStateChange?.({
          phase: 'acquiring',
          progress: 0,
          message: '地形データを読み込み中',
          error: null,
        })
      }
      return
    }

    const bounds = selectionBounds
    const forceBuildings = !!forceBuildingsBounds && sameBounds(forceBuildingsBounds, bounds)
    let cancelled = false
    const estimateAbort = new AbortController()
    // 地図操作中の描画を優先し、隙間で読み込む（timeout付きで必ず実行）。
    // 後片付けは即時（古い表示を残さない）、loadだけ遅延させる。
    let cancelScheduled: (() => void) | null = null
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) {
            void load()
          }
        },
        { timeout: 1500 },
      )
      cancelScheduled = () => window.cancelIdleCallback(idleId)
    } else {
      const timer = window.setTimeout(() => {
        if (!cancelled) {
          void load()
        }
      }, 300)
      cancelScheduled = () => window.clearTimeout(timer)
    }

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

        let urls: string[] = []
        let terrainOnlyDueToBudget = false

        const largeFastPath = isLargeRange(bounds) && !forceBuildings
        if (largeFastPath) {
          // 大規模範囲はURL解決・予算推定をスキップし、即座に地形のみ表示へ進む
          terrainOnlyDueToBudget = true
          setCanForceBuildings(true)
          setCoverageWarning('選択範囲が広いため、地形のみ表示しています（建物を表示すると時間がかかります）')
          setBuildingLoadDetail('大規模範囲（地形のみ表示）')
          setBuildingLoadProgress(null)
          setListLoading(false)
          onPipelineStateChange?.({
            phase: 'composing',
            progress: 50,
            message: '選択範囲が広いため地形のみ表示',
            error: null,
          })
        } else {
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

          const firstUrlErrorRef: { current: Error | null } = { current: null }
          const urlPromises = muniCodes.map(async (code) => {
            try {
              const best = await findBestTilesetUrl(code, lod)
              return { code, url: best.url, actualLod: best.actualLod }
            } catch (err) {
              if (!firstUrlErrorRef.current && err instanceof Error) firstUrlErrorRef.current = err
              return { code, url: null as string | null, actualLod: null as Lod | null }
            }
          })
          const results = await Promise.all(urlPromises)
          urls = results
            .map((r) => r.url)
            .filter((u): u is string => u !== null)
          const failedMuniCodes = results
            .filter((r) => r.url === null)
            .map((r) => r.code)
          const fallbackEntries = results.filter(
            (r): r is { code: string; url: string; actualLod: Lod } =>
              r.url !== null && r.actualLod !== null && r.actualLod !== lod
          )
          if (cancelled) return

          if (urls.length === 0) {
            if (firstUrlErrorRef.current) console.warn('[Preview3D] 建物データなし:', firstUrlErrorRef.current.message)
            setCoverageWarning('選択範囲にPLATEAUの建物データがありません。地形のみ表示しています')
            setBuildingLoadDetail('建物データなし（地形のみ表示）')
            setBuildingLoadProgress(null)
            setListLoading(false)
            onPipelineStateChange?.({
              phase: 'composing',
              progress: 50,
              message: '建物データなし、地形のみ表示',
              error: null,
            })
          } else if (failedMuniCodes.length > 0) {
            let names: string[] = []
            try {
              const details = await getCoverageDetails()
              names = failedMuniCodes
                .map((code) => details.get(code)?.city)
                .filter((n): n is string => typeof n === 'string' && n.length > 0)
            } catch (err) {
              console.warn('[Preview3D] カバレッジ詳細の取得に失敗:', err)
            }
            if (names.length > 0) {
              setCoverageWarning(
                `選択範囲の一部でPLATEAUデータが未整備です: ${names.join('、')}。整備済みエリアの建物のみ表示しています`
              )
            } else {
              setCoverageWarning(
                `選択範囲の一部(${failedMuniCodes.length}自治体)でPLATEAUデータが未整備です。整備済みエリアの建物のみ表示しています`
              )
            }
          } else if (fallbackEntries.length > 0) {
            let fallbackNames: string[] = []
            try {
              const details = await getCoverageDetails()
              fallbackNames = fallbackEntries.map((r) => {
                const city = details.get(r.code)?.city
                return city ? `${city}(${r.actualLod.toUpperCase()})` : `${r.code}(${r.actualLod.toUpperCase()})`
              })
            } catch {
              fallbackNames = fallbackEntries.map((r) => `${r.code}(${r.actualLod.toUpperCase()})`)
            }
            setCoverageWarning(
              `選択範囲の一部は${lod.toUpperCase()}未整備のため、対応する最も詳細なレベルで表示しています: ${fallbackNames.join('、')}`
            )
          } else {
            setCoverageWarning(null)
          }

          if (forceBuildings && urls.length > 0) {
            setCoverageWarning((prev) => prev ?? '建物を手動表示しています（データ量が多いため時間がかかる場合があります）')
          }

          console.log('[Preview3D] Resolved tileset URLs:', urls)

          if (urls.length > 0 && !forceBuildings && !isSmallRange(bounds)) {
            let estimate: PreviewLoadEstimate | null = null
            try {
              estimate = await estimatePreviewLoad({
                bounds,
                lod,
                tilesetUrls: urls,
                signal: estimateAbort.signal,
              })
            } catch (err) {
              console.warn('[Preview3D] preview budget estimate failed, terrain-only fallback:', err)
              terrainOnlyDueToBudget = true
              setCanForceBuildings(true)
              setCoverageWarning('建物データ量を確認できないため、安全のため地形のみ表示しています')
              setBuildingLoadDetail('建物データ量を確認できないため地形のみ表示')
              setBuildingLoadProgress(null)
              setListLoading(false)
              onPipelineStateChange?.({
                phase: 'composing',
                progress: 50,
                message: '建物データ量を確認できないため、地形のみ表示しています',
                error: null,
              })
              estimate = null
            }
            if (cancelled) return
            if (estimateAbort.signal.aborted) return
            if (estimate) {
              const decision = classifyPreviewLoad(estimate)
              if (decision.mode === 'terrain-only') {
                terrainOnlyDueToBudget = true
                const terrainOnlyMessage = decision.reason === 'too-large'
                  ? '建物データが大きいため、地形のみ表示しています'
                  : '建物データがないため、地形のみ表示しています'
                if (decision.reason === 'too-large') {
                  setCanForceBuildings(true)
                  setCoverageWarning(`選択範囲の建物データが大きいため、地形のみ表示しています（建物約${estimate.totalBuildings}件 / タイル${estimate.contentTiles}件）`)
                  setBuildingLoadDetail('建物データが大きいため地形のみ表示')
                } else {
                  setCoverageWarning('選択範囲に建物データがありません。地形のみ表示しています')
                  setBuildingLoadDetail('建物データなし（地形のみ表示）')
                }
                setBuildingLoadProgress(null)
                setListLoading(false)
                onPipelineStateChange?.({
                  phase: 'composing',
                  progress: 50,
                  message: terrainOnlyMessage,
                  error: null,
                })
              }
            }
          }
        }

        if (urls.length > 0 && !terrainOnlyDueToBudget) {
          setBuildingLoadDetail(`3Dタイルを読み込み中（${urls.length}件）`)
          setBuildingLoadProgress(30)
          onPipelineStateChange?.({
            phase: 'acquiring',
            progress: 0,
            message: '3Dタイルを読み込み中',
            error: null,
          })
        }

        const loadedTilesets: Cesium3DTileset[] = []
        if (!terrainOnlyDueToBudget) {
          const loadOne = async (url: string): Promise<void> => {
            if (cancelled) return
            try {
              const tileset = await Cesium3DTileset.fromUrl(url, {
                // PLATEAUの粗い親タイルには建物がほぼ含まれないため、
                // 距離で粗化すると建物が消える。常に最精細まで求めて全件表示する。
                // 範囲外タイルの読込は applyClippingToTileset の update 抑止で抑える。
                maximumScreenSpaceError: 0,
                // 大規模範囲でもメモリが膨らみ続けないようキャッシュ上限を設ける
                cacheBytes: 128 * 1024 * 1024,
                maximumCacheOverflowBytes: 64 * 1024 * 1024,
                cullWithChildrenBounds: true,
              })
              if (cancelled) {
                tileset.destroy()
                return
              }

              viewer!.scene.primitives.add(tileset)
              loadedTilesets.push(tileset)
              // 白模型ON時はPLATEAU Viewと同様に拡散色を純白へ置換する
              tileset.customShader = createBuildingCustomShader(
                whiteModelRef.current ? Color.WHITE : baseBuildingColor()
              )
              tileset.customShader.setUniform(
                'u_ambientBoost',
                whiteModelRef.current ? WHITE_MODEL_AMBIENT_BOOST : 0.0,
              )
              applyWhiteModelToTileset(tileset, whiteModelRef.current, whiteModelSavedRef.current)

              const progressFn = (pending: number, processing: number): void => {
                pendingMapRef.current.set(tileset, pending + processing)
                const currentSum = Array.from(pendingMapRef.current.values()).reduce((a, b) => a + b, 0)
                const isLoading = currentSum > 0
                // タイル毎の連続発火で再レンダーが増え地図描画を圧迫するため間引く。
                // 完了時は必ず反映し、最大値の集計だけは毎回行う。
                if (isLoading && performance.now() - progressThrottleRef.current < 200) {
                  if (currentSum > maxTilesRef.current) maxTilesRef.current = currentSum
                  return
                }
                progressThrottleRef.current = performance.now()
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

          // 同時4件まで並列ロードする（順序は不問、pushは並列安全）
          const queue = [...urls]
          await Promise.all(
            Array.from({ length: 4 }, async () => {
              for (;;) {
                const url = queue.shift()
                if (url === undefined) return
                await loadOne(url)
              }
            }),
          )
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
          if (terrainOnlyDueToBudget) {
            console.warn('[Preview3D] 建物データが大きいため、地形のみ表示に進みます')
          } else if (urls.length === 0) {
            console.warn('[Preview3D] 建物データなし、地形のみ表示に進みます')
          } else if (!includeTerrain) {
            throw new Error('3Dタイルの読み込みに失敗しました')
          } else {
            console.warn('[Preview3D] 建物タイルの読み込みに失敗、地形のみ表示に進みます')
            setCoverageWarning((prev) => prev ?? '建物の読み込みに失敗しました。地形のみ表示しています')
          }
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

          // 下の平面は Ion失敗時のフォールバック height=0 (楕円体高0m) の平坦地形。正常時は地形起伏あり、shiftで建物高さ59mに補正
          const calcVariance = (s: TerrainSampleData): number => {
            const zs = s.topLocalPositions.map((p) => p.z)
            return Math.max(...zs) - Math.min(...zs)
          }
          const getBuildingMinY = async (sampleForFallback: TerrainSampleData): Promise<number | null> => {
            const cacheKey = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}:${lod}`
            if (buildingMinYCacheRef.current.has(cacheKey)) {
              return buildingMinYCacheRef.current.get(cacheKey) ?? null
            }
            let minBuildingY: number | null = null
            if (sampleForFallback.isFallback === true) {
            try {
              const core = await import('@machimoki/core')
              if (cancelled) return null
              const buildingMeshes = await core.buildBuildingMeshes(
                bounds,
                lod,
                excludedBuildingIds ?? undefined
              )
              if (cancelled) return null
              let mY = Infinity
              for (const m of buildingMeshes) {
                const p = m.positions
                for (let i = 1; i < p.length; i += 3) {
                  const y = p[i]
                  if (Number.isFinite(y) && y < mY) mY = y
                }
              }
              minBuildingY = Number.isFinite(mY) ? mY : null
              buildingMinYCacheRef.current.set(cacheKey, minBuildingY)
            } catch (e) {
              console.warn('[Preview3D] buildBuildingMeshes failed, fallback to boundingSphere', e)
            }
            }
            if (minBuildingY === null) {
              try {
                let bestFallback: number | null = null
                const tryUpdate = (v: number | null) => {
                  if (v !== null && Number.isFinite(v) && (bestFallback === null || v < bestFallback)) bestFallback = v
                }
                for (const ts of tilesetsRef.current as any[]) {
                  const center: Cartesian3 | undefined = ts?.boundingSphere?.center
                  if (center) {
                    try {
                      const carto = Cartographic.fromCartesian(center)
                      if (Number.isFinite(carto.height)) {
                        const radius = ts.boundingSphere?.radius
                        const approxBase = Number.isFinite(radius) ? carto.height - radius * 0.5 : carto.height
                        tryUpdate(approxBase)
                      }
                    } catch {}
                    try {
                      const local = Matrix4.multiplyByPoint(sampleForFallback.inverseCenterMatrix, center, new Cartesian3())
                      tryUpdate(local.z)
                    } catch {}
                  }
                  const region = ts?.root?._header?.boundingVolume?.region as number[] | undefined
                  if (region && region.length >= 6 && Number.isFinite(region[4])) {
                    const regionMinH = region[4]
                    try {
                      const carto = Cartographic.fromRadians(region[0], region[1], regionMinH)
                      const ecef = Cartesian3.fromRadians(carto.longitude, carto.latitude, regionMinH)
                      const local = Matrix4.multiplyByPoint(sampleForFallback.inverseCenterMatrix, ecef, new Cartesian3())
                      tryUpdate(local.z)
                    } catch {}
                    tryUpdate(regionMinH)
                  }
                }
                if (bestFallback !== null) {
                  minBuildingY = bestFallback
                  console.warn('[Preview3D] fallback building height (best of tilesets):', minBuildingY)
                }
                if ((minBuildingY === null || !Number.isFinite(minBuildingY)) && viewerRef.current) {
                  try {
                    const lon = (bounds.west + bounds.east) / 2
                    const lat = (bounds.south + bounds.north) / 2
                    const carto = Cartographic.fromDegrees(lon, lat)
                    const h = (viewerRef.current.scene.globe as any).getHeight?.(carto)
                    if (Number.isFinite(h)) {
                      minBuildingY = h
                      console.warn('[Preview3D] fallback building height from globe.getHeight:', h)
                    }
                  } catch {}
                }
              } catch {
                void 0
              }
              if (minBuildingY !== null) {
                buildingMinYCacheRef.current.set(cacheKey, minBuildingY)
              } else {
                console.warn('[Preview3D] all fallbacks failed, buildingMinY remains null, minZ will stay', sampleForFallback.minTopHeight)
              }
            }
            return minBuildingY
          }
          async function maybeAlignSample(sample: TerrainSampleData): Promise<{ variance: number; buildingMinY: number | null; delta: number | null }> {
            const variance = calcVariance(sample)
            if ((sample as any).isFallback !== true) return { variance, buildingMinY: await getBuildingMinY(sample), delta: null }
            const minBuildingY = await getBuildingMinY(sample)
            if (cancelled) return { variance, buildingMinY: minBuildingY, delta: null }
            if (minBuildingY !== null && Number.isFinite(minBuildingY)) {
              const delta = minBuildingY - sample.minTopHeight + 1.0
              if (Math.abs(delta) > 0.01) {
                for (const p of sample.topLocalPositions) {
                  p.z += delta
                }
                sample.minTopHeight += delta
                for (let i = 0; i < sample.topLocalPositions.length; i++) {
                  const local = sample.topLocalPositions[i]
                  const ecef = Matrix4.multiplyByPoint(
                    sample.centerMatrix,
                    local,
                    new Cartesian3()
                  )
                  sample.topEcefValues[i * 3] = ecef.x
                  sample.topEcefValues[i * 3 + 1] = ecef.y
                  sample.topEcefValues[i * 3 + 2] = ecef.z
                }
                console.log(
                  `[Preview3D] Terrain aligned (isFallback=${(sample as any).isFallback}, variance=${variance.toFixed(4)}) shifted by ${delta.toFixed(2)}m to building minY ${minBuildingY.toFixed(2)}m`
                )
                return { variance, buildingMinY: minBuildingY, delta }
              }
              return { variance, buildingMinY: minBuildingY, delta: 0 }
            }
            return { variance, buildingMinY: minBuildingY, delta: null }
          }

          let sample = terrainSampleCacheRef.current
          let debugVariance = 0
          let debugBuildingMinY: number | null = null
          let debugDelta: number | null = null
          const gridCenterLat = (bounds.south + bounds.north) / 2
          const gridWidthMeters = CesiumMath.toRadians(bounds.east - bounds.west) * 6371000 * Math.cos(CesiumMath.toRadians(gridCenterLat))
          const gridHeightMeters = CesiumMath.toRadians(bounds.north - bounds.south) * 6371000
          const gridMaxDimMeters = Math.max(gridWidthMeters, gridHeightMeters)
          const terrainGridSize = adaptiveTerrainGridSize(gridMaxDimMeters)
          // 大規模範囲のみサンプリングレベルを適応させ、通常範囲は現行の mostDetailed 品質を維持する
          const spanDeg = Math.max(bounds.east - bounds.west, bounds.north - bounds.south)
          const terrainSamplingLevel = isLargeRange(bounds)
            ? pickTerrainLevel(
                spanDeg,
                (terrainProvider as any)?.minimumLevel ?? 0,
                (terrainProvider as any)?.maximumLevel ?? 99,
              )
            : undefined
          const needsFetch =
            !sample ||
            !sameBounds(sample.bounds, bounds) ||
            sample.gridSize !== terrainGridSize ||
            (sample.samplingLevel ?? null) !== (terrainSamplingLevel ?? null)
          if (needsFetch) {
            sample = await sampleTerrainData(bounds, terrainProvider!, terrainGridSize, terrainSamplingLevel)
            if (cancelled) return
            const aligned = await maybeAlignSample(sample!)
            if (cancelled) return
            debugVariance = aligned.variance
            debugBuildingMinY = aligned.buildingMinY
            debugDelta = aligned.delta
            terrainSampleCacheRef.current = sample!
          } else {
            // キャッシュヒット時も flatなら再シフトを試みる
            const aligned = await maybeAlignSample(sample!)
            if (cancelled) return
            debugVariance = aligned.variance
            debugBuildingMinY = aligned.buildingMinY
            debugDelta = aligned.delta
            // shift後はキャッシュを更新（参照は同じだが明示）
            terrainSampleCacheRef.current = sample!
          }
          if (isDevModeRef.current) {
            ;(window as any).__terrainSample = sample
          }
          const params = latestTerrainParamsRef.current
          const solidTerrain = buildSolidTerrainPrimitive(sample!, {
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
          terrainBoundingSphereRef.current = terrainBoundingSphere
          clearGlobeClippingPlanes(viewer!.scene.globe)
          viewer!.scene.globe.show = false
          viewer!.scene.requestRender()
          console.log('[Preview3D] Solid terrain mesh applied')
          setDebugInfo({
            isFallback: (sample as TerrainSampleData).isFallback ?? false,
            minTopHeight: (sample as TerrainSampleData).minTopHeight,
            variance: debugVariance,
            buildingMinY: debugBuildingMinY,
            delta: debugDelta,
            terrainPrimitive: !!solidTerrainPrimitiveRef.current,
          })
        } else {
          const globePlanes = createGlobeClippingPlanes(bounds)
          viewer!.scene.globe.clippingPlanes = globePlanes
          viewer!.scene.globe.show = true
          viewer!.scene.requestRender()
          console.log('[Preview3D] Globe clipping planes applied')
          setDebugInfo(null)
        }

        const flyLon = (bounds.west + bounds.east) / 2
        const flyLat = (bounds.south + bounds.north) / 2
        const widthDeg = bounds.east - bounds.west
        const heightDeg = bounds.north - bounds.south
        const widthMeters = CesiumMath.toRadians(widthDeg) * 6371000 * Math.cos(CesiumMath.toRadians(flyLat))
        const heightMeters = CesiumMath.toRadians(heightDeg) * 6371000
        const maxDim = Math.max(widthMeters, heightMeters)
        const cameraHeight = Math.max(maxDim * 2, 300)
        viewer!.scene.screenSpaceCameraController.maximumZoomDistance = previewMaxZoomDistance(maxDim)

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
        if (includeTerrain && message.startsWith('PLATEAU-Terrain取得失敗: 標高サンプルが不完全です')) {
          terrainSampleCacheRef.current = null
          const globePlanes = createGlobeClippingPlanes(bounds)
          viewer!.scene.globe.clippingPlanes = globePlanes
          viewer!.scene.globe.show = true
          setCoverageWarning('地形データの一部を取得できませんでした。地球儀表示に切り替えています')
          onPipelineStateChange?.({
            phase: 'complete',
            progress: 100,
            message: '地形データの一部を取得できないため地球儀を表示中',
            error: null,
          })
          return
        }
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

    return () => {
      cancelled = true
      cancelScheduled?.()
      estimateAbort.abort()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionBounds, lod, onPipelineStateChange, terrainProvider, terrainError, includeTerrain, forceBuildingsBounds])

  useEffect(() => {
    const linear = whiteModelRef.current
      ? colorToLinearCartesian3(Color.WHITE)
      : colorToLinearCartesian3(baseBuildingColor())
    for (const ts of tilesetsRef.current) {
      if (ts.customShader) {
        ts.customShader.setUniform('u_buildingColor', linear)
      }
    }
    viewerRef.current?.scene.requestRender()
  }, [buildingColor])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    applyWhiteModelLook(viewer, whiteModel, gsiLayerRef, whiteModelSavedRef.current)
    for (const ts of tilesetsRef.current) {
      applyWhiteModelToTileset(ts, whiteModel, whiteModelSavedRef.current)
      if (ts.customShader) {
        ts.customShader.setUniform('u_ambientBoost', whiteModel ? WHITE_MODEL_AMBIENT_BOOST : 0.0)
        ts.customShader.setUniform(
          'u_buildingColor',
          whiteModel ? colorToLinearCartesian3(Color.WHITE) : colorToLinearCartesian3(baseBuildingColor()),
        )
      }
    }
    viewer.scene.requestRender()
  }, [whiteModel])

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
        setHoveredFeature(feature && feature.show ? feature : null)
        canvas.style.cursor = feature && feature.show ? 'pointer' : 'default'
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
    viewerRef.current?.scene.requestRender()
  }, [includeSpanningBuildings])

  useEffect(() => {
    for (const tileset of tilesetsRef.current) {
      refilterPickPoints(tileset, pickPoints)
    }
    viewerRef.current?.scene.requestRender()
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
    viewer.scene.requestRender()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainThickness, flattenBottom, terrainColor])

  return (
    <div style={wrapperStyle}>
      <div ref={containerRef} style={containerStyle} />
      <div
        data-testid="preview-view-controls"
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          zIndex: 20,
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
        }}
      >
        <select
          data-testid="gsi-style-select-preview"
          value={gsiStyle}
          onChange={(e) => {
            const style = e.target.value as GsiTileStyle
            setGsiStyle(style)
            saveGsiStyle(style)
          }}
          style={{
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: '6px',
            padding: '6px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
          }}
        >
          {GSI_TILE_STYLES.map((s) => (
            <option key={s} value={s}>
              {GSI_TILE_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          data-testid="projection-toggle"
          onClick={toggleProjection}
          style={{
            background: isOrthographic ? 'var(--accent)' : 'var(--surface)',
            color: isOrthographic ? '#fff' : 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '11px',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            fontWeight: 600,
            minWidth: '52px',
          }}
        >
          {isOrthographic ? '透視' : '平行'}
        </button>
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: '6px',
            padding: '4px',
            backdropFilter: 'blur(4px)',
          }}
        >
          {(
            [
              ['top', '真上', 0, -90, true],
              ['iso', '斜め', 35, -45, false],
              ['south', '南', 0, -45, false],
              ['north', '北', 180, -45, false],
              ['east', '東', 90, -45, false],
              ['west', '西', 270, -45, false],
              ['side', '真横', 0, 0, false],
            ] as const
          ).map(([id, label, h, p, top]) => (
            <button
              key={id}
              data-testid={`view-preset-${id}`}
              onClick={() => applyPresetView(h, p, { useTop: !!top })}
              style={{
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong)',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '11px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {isDevMode && debugInfo && (
        <div
          data-testid="terrain-debug-info"
          style={{
            position: 'absolute',
            top: '56px',
            right: '16px',
            zIndex: 20,
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '4px',
            backdropFilter: 'blur(4px)',
            border: '1px solid var(--border-strong)',
            pointerEvents: 'none',
          }}
        >
          {`地形: ${debugInfo.isFallback ? 'フォールバック(平坦)' : '正常'} | minZ ${debugInfo.minTopHeight.toFixed(2)}m | ばらつき ${debugInfo.variance.toFixed(4)} | 建物最下 ${debugInfo.buildingMinY?.toFixed(2) ?? '--'}m | 補正 ${debugInfo.delta?.toFixed(2) ?? '0'}m | ${debugInfo.terrainPrimitive ? '表示中' : '非表示'}`}
        </div>
      )}
      {isDevMode && (
        <ContourDebugPanel
          info={contourDebug}
          collapsed={contourDebugCollapsed}
          onToggle={() => setContourDebugCollapsed((v) => !v)}
        />
      )}
      {coverageWarning && (
        <div
          data-testid="coverage-warning"
          style={{
            position: 'absolute',
            top: '56px',
            left: '16px',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#fff7d6',
            color: '#7a5b00',
            border: '1px solid #e6c200',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            maxWidth: '420px',
          }}
        >
          <span>{coverageWarning}</span>
          {canForceBuildings && selectionBounds && (!forceBuildingsBounds || !sameBounds(forceBuildingsBounds, selectionBounds)) && (
            <button
              data-testid="coverage-warning-show-buildings"
              onClick={() => setForceBuildingsBounds(selectionBounds)}
              style={{
                background: '#e6c200',
                color: '#5c4500',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 10px',
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              建物を表示
            </button>
          )}
          <button
            data-testid="coverage-warning-close"
            onClick={() => setCoverageWarning(null)}
            aria-label="警告を閉じる"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#7a5b00',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: 1,
              padding: '2px 4px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      )}
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
          totalTiles={isDevMode ? totalTiles : null}
          loadedTiles={isDevMode ? loadedTiles : null}
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
      <div
        data-testid="preview-attribution"
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
