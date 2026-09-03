import type { Viewer } from 'cesium'
import CesiumMVTImageryProvider, {
  type ImageryProviderOption,
} from 'cesium-mvt-imagery-provider'
import { LOD_CATEGORY_STYLES, resolveLodCategory } from './coverageCategories'

/**
 * PLATEAUデータカバレッジのMVTタイルレイヤー。
 *
 * サーバーサイド（Worker + R2）が配信する MVT タイルを
 * cesium-mvt-imagery-provider で描画する。
 * フィーチャの properties.lods（例 "lod1,lod2"、空文字は建物なし）から
 * 最大 LoD を求める。描画は詳細/簡易の2モードを持つ:
 * - 詳細（ズームイン時）: なし/LoD1/LoD2/LoD3+/LoD4 の5色に塗り分ける
 * - 簡易（ズームアウト時）: 整備済み=透明＋#4fc3f7枠、未整備=グレー塗りの二値
 * モード切替は MvtLayerHandle.setDetailedMode で imagery レイヤーを作り直し、
 * レイヤーの表示/非表示（setVisible）とは独立している（setVisible は作り直し後に引き継ぐ）。
 * 色定義は coverageCategories.ts の LOD_CATEGORY_STYLES が唯一の定義元。
 * 既存の Entity 方式（coverageOverlay.ts）は二値のまま対象外とする。
 *
 * データソース:
 *  - /api/coverage/tiles/{z}/{x}/{y}（tippecanoe で生成した MVT、layerName: coverage）
 *  - 事前に /api/coverage をプローブし、Worker/R2 が配信していない場合は例外を投げる
 */

const COVERAGE_LAYER_NAME = 'coverage'

/** 簡易モードの整備済み塗り（透明） */
const COVERED_BINARY_FILL = 'rgba(0, 0, 0, 0)'
/** 簡易モードの整備済み枠（従来の整備済みブルー） */
const COVERED_BINARY_OUTLINE = '#4fc3f7'

export interface MvtLayerHandle {
  /** レイヤーを削除する */
  remove: () => void
  /** 表示/非表示を切り替える */
  setVisible: (visible: boolean) => void
  /** 詳細（LoD5色）/簡易（二値）描画を切り替える */
  setDetailedMode: (detailed: boolean) => void
}

/** style解決が受けるフィーチャの最小構造 */
export interface CoverageMvtFeature {
  properties?: Record<string, unknown>
}

export interface CoverageMvtStyle {
  fillStyle?: string
  strokeStyle?: string
  lineWidth?: number
  lineJoin?: CanvasLineJoin
}

/**
 * フィーチャとモードからMVT描画スタイルを解決する pure 関数（単体テスト可能）。
 * - detailed=false（簡易・縮小時）: 整備済み=透明＋#4fc3f7枠、未整備=グレー塗り
 * - detailed=true（詳細・拡大時）: coverageCategories の5色
 */
export function resolveCoverageMvtStyle(
  feature: CoverageMvtFeature,
  detailed: boolean,
): CoverageMvtStyle {
  const category = resolveLodCategory(feature.properties)
  if (!detailed) {
    if (category === 'none') {
      return {
        fillStyle: LOD_CATEGORY_STYLES.none.fill,
        strokeStyle: LOD_CATEGORY_STYLES.none.outline,
        lineWidth: 1,
      }
    }
    return {
      fillStyle: COVERED_BINARY_FILL,
      strokeStyle: COVERED_BINARY_OUTLINE,
      lineWidth: 1,
    }
  }
  const style = LOD_CATEGORY_STYLES[category]
  return {
    fillStyle: style.fill,
    strokeStyle: style.outline,
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
  (import.meta as { env?: { VITE_COVERAGE_API_BASE?: string } }).env
    ?.VITE_COVERAGE_API_BASE ??
  (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'https://machimoki.aosy.f5.si'
    : '')

function coverageApiUrl(path: string): string {
  return `${COVERAGE_API_BASE}${path}`
}

export async function createCoverageMvtLayer(
  viewer: Viewer,
  urlTemplate: string,
  initialDetailed = true,
): Promise<MvtLayerHandle> {
  const resolvedTemplate = urlTemplate.startsWith('http')
    ? urlTemplate
    : coverageApiUrl(urlTemplate)
  const probe = await fetch(coverageApiUrl('/api/coverage'))
  if (!probe.ok) {
    throw new Error(`カバレッジAPIが利用できません: ${probe.status}`)
  }

  let detailedMode = initialDetailed
  let currentVisible = true
  const buildProvider = (
    detailed: boolean,
  ): CesiumMVTImageryProvider => {
    const options: ImageryProviderOption = {
      urlTemplate: resolvedTemplate as CoverageUrlTemplate,
      layerName: COVERAGE_LAYER_NAME,
      style: (feature) => resolveCoverageMvtStyle(feature, detailed),
      minimumLevel: 4,
      maximumLevel: 14,
    }
    return new CesiumMVTImageryProvider(options)
  }

  let layer = viewer.imageryLayers.addImageryProvider(
    buildProvider(detailedMode),
  )

  return {
    remove: () => {
      try {
        viewer.imageryLayers.remove(layer)
      } catch {
        /* ignore */
      }
    },
    setVisible: (visible: boolean) => {
      currentVisible = visible
      layer.show = visible
    },
    setDetailedMode: (detailed: boolean) => {
      if (detailed === detailedMode) return
      detailedMode = detailed
      try {
        viewer.imageryLayers.remove(layer)
      } catch {
        /* ignore */
      }
      layer = viewer.imageryLayers.addImageryProvider(
        buildProvider(detailedMode),
      )
      layer.show = currentVisible
    },
  }
}