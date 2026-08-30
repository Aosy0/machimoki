import { Viewer } from 'cesium'
import CesiumMVTImageryProvider from 'cesium-mvt-imagery-provider'

/**
 * PLATEAUデータカバレッジのMVTタイルレイヤー。
 *
 * サーバーサイド（Worker + R2）が配信する MVT タイルを
 * cesium-mvt-imagery-provider で描画する。
 * covered=1 の市区町村は「透明 + 青枠」、covered=0 は「半透明グレー」で塗り分ける。
 * 既存の Entity 方式（coverageOverlay.ts）と同じスタイルを踏襲する。
 *
 * データソース:
 *  - /api/coverage/tiles/{z}/{x}/{y}（tippecanoe で生成した MVT、layerName: coverage）
 *  - 事前に /api/coverage をプローブし、Worker/R2 が配信していない場合は例外を投げる
 */

const COVERED_OUTLINE_COLOR = '#4fc3f7'
const UNCOVERED_FILL_COLOR = 'rgba(128, 128, 128, 0.35)'
const UNCOVERED_OUTLINE_COLOR = 'rgba(128, 128, 128, 0.5)'

const COVERAGE_LAYER_NAME = 'coverage'

export interface MvtLayerHandle {
  /** レイヤーを削除する */
  remove: () => void
  /** 表示/非表示を切り替える */
  setVisible: (visible: boolean) => void
}

/** @mapbox/vector-tile の VectorTileFeature の最小構造（型定義が無いため構造的型で受ける） */
interface MvtFeatureLike {
  properties?: Record<string, unknown>
  type?: number
}

interface MvtStyle {
  fillStyle?: string
  strokeStyle?: string
  lineWidth?: number
  lineJoin?: CanvasLineJoin
}

function isCovered(feature: MvtFeatureLike): boolean {
  const covered = feature.properties?.covered
  return covered === 1 || covered === '1' || covered === true
}

function coverageStyle(feature: MvtFeatureLike): MvtStyle {
  if (isCovered(feature)) {
    // 整備済み: 透明 + 青枠
    return {
      fillStyle: 'rgba(0, 0, 0, 0)',
      strokeStyle: COVERED_OUTLINE_COLOR,
      lineWidth: 1,
    }
  }
  // 未整備: 半透明グレー
  return {
    fillStyle: UNCOVERED_FILL_COLOR,
    strokeStyle: UNCOVERED_OUTLINE_COLOR,
    lineWidth: 1,
  }
}

/** cesium-mvt-imagery-provider の urlTemplate 型（{z}/{x}/{y} を含むテンプレートリテラル） */
type CoverageUrlTemplate = `${`http${'s' | ''}://` | ''}${string}/{z}/{x}/{y}${string}`

/**
 * MVTカバレッジレイヤーを生成する。
 * 事前に /api/coverage をプローブし、Worker/R2 がカバレッジを配信していない場合は
 * 例外を投げる（呼び出し側で Entity フォールバックに切り替える）。
 */
const COVERAGE_API_BASE =
  (import.meta.env.VITE_COVERAGE_API_BASE as string | undefined) ??
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'https://machimoki.aosy.f5.si'
    : '')

function coverageApiUrl(path: string): string {
  return `${COVERAGE_API_BASE}${path}`
}

export async function createCoverageMvtLayer(
  viewer: Viewer,
  urlTemplate: string
): Promise<MvtLayerHandle> {
  const resolvedTemplate = urlTemplate.startsWith('http')
    ? urlTemplate
    : coverageApiUrl(urlTemplate)
  const probe = await fetch(coverageApiUrl('/api/coverage'))
  if (!probe.ok) {
    throw new Error(`カバレッジAPIが利用できません: ${probe.status}`)
  }

  const provider = new CesiumMVTImageryProvider({
    urlTemplate: resolvedTemplate as CoverageUrlTemplate,
    layerName: COVERAGE_LAYER_NAME,
    style: coverageStyle,
    // @ts-ignore - cesium-mvt-imagery-provider supports these props, but types may be outdated
    maximumZoom: 14,
    minimumZoom: 4,
  } as any)

  const layer = viewer.imageryLayers.addImageryProvider(provider)

  return {
    remove: () => {
      try {
        viewer.imageryLayers.remove(layer)
      } catch {
        /* ignore */
      }
    },
    setVisible: (visible: boolean) => {
      layer.show = visible
    },
  }
}