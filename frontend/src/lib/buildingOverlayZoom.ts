import { Math as CesiumMath, SceneMode, type Viewer } from 'cesium'

/**
 * PLATEAU建物有無オーバーレイ（MVTレイヤー / Entityフォールバック）を
 * 表示する最小ズームレベル（Webメルカトル / GSI標準地図相当）。
 *
 * 根拠:
 * - GSI標準地図（std）で建物形状が判読できるのはズーム14以降が目安。
 *   縮小時は建物が出ない縮尺になるため、オーバーレイも隠してGSI地図のみにする。
 * - MVTカバレッジレイヤーの maximumZoom が 14 のため、それより一段手前の
 *   13 を閾値にすると、建物が見え始める直前から有無の目安を出せる。
 * - 初期視点（高度8000m・市街拡大）は閾値より十分ズームイン側、
 *   全国俯瞰（maximumZoomDistance 5,000,000m）はズームアウト側になる。
 */
export const BUILDING_OVERLAY_MIN_ZOOM = 13

/**
 * 高度フォールバック用の上限高度（メートル）。
 * 上記のズーム13相当の目安。ズーム推定ができない場合のみ使用する。
 * 初期視点8000m < 25000m < 全国俯瞰 の中間に位置する。
 */
export const BUILDING_OVERLAY_MAX_HEIGHT_M = 25000

const TILE_PX = 256
const WORLD_LON_DEG = 360
const WORLD_MERCATOR_WIDTH_M = 40075016.686

/**
 * 現在のビューをおおよそのWebメルカトルズームレベルに換算する。
 * 2D（SCENE2D）では computeViewRectangle が不定になる場合があるため、
 * App.tsx の等高線デバッグと同じく frustum（メートル単位）を優先的に使う。
 * 推定できない場合は null を返す。
 */
export function getViewerZoom(viewer: Viewer): number | null {
  try {
    const camera = viewer.camera
    const canvas = viewer.scene.canvas as HTMLCanvasElement | undefined
    const canvasWidthPx = canvas?.clientWidth ?? 0

    // 1) 可視矩形（経度スパン）からの推定。3D/CVおよび2Dで矩形が取れる場合に有効。
    try {
      const rect = camera.computeViewRectangle()
      if (rect) {
        const spanDeg = CesiumMath.toDegrees(rect.east - rect.west)
        if (Number.isFinite(spanDeg) && spanDeg > 0 && spanDeg < WORLD_LON_DEG) {
          if (canvasWidthPx > 0) {
            return Math.log2((WORLD_LON_DEG * canvasWidthPx) / (TILE_PX * spanDeg))
          }
          return Math.log2(WORLD_LON_DEG / spanDeg)
        }
      }
    } catch {
      /* fall through */
    }

    // 2) SCENE2D の frustum（可視幅メートル）からの推定。
    try {
      if (viewer.scene.mode === SceneMode.SCENE2D) {
        const frustum = camera.frustum as unknown as {
          left?: unknown
          right?: unknown
          top?: unknown
          bottom?: unknown
        }
        if (
          typeof frustum.right === 'number' &&
          typeof frustum.left === 'number' &&
          typeof frustum.top === 'number' &&
          typeof frustum.bottom === 'number'
        ) {
          const visibleWidthM = frustum.right - frustum.left
          if (Number.isFinite(visibleWidthM) && visibleWidthM > 0) {
            if (canvasWidthPx > 0) {
              return Math.log2(
                (WORLD_MERCATOR_WIDTH_M * canvasWidthPx) / (TILE_PX * visibleWidthM),
              )
            }
            return Math.log2(WORLD_MERCATOR_WIDTH_M / visibleWidthM)
          }
        }
      }
    } catch {
      /* fall through */
    }

    // 3) カメラ高度からのフォールバック（2Dでは真下視点の距離≒高度）。
    try {
      const carto = camera.positionCartographic
      if (carto && Number.isFinite(carto.height) && carto.height > 0) {
        if (canvasWidthPx > 0) {
          // 高度から可視幅を概算せず、高度しきい値との対応でズーム換算する。
          // 高度が上限の半分ごとに約1ズーム変化するとみなす。
          const ratio = BUILDING_OVERLAY_MAX_HEIGHT_M / carto.height
          return BUILDING_OVERLAY_MIN_ZOOM + Math.log2(Math.max(ratio, Number.MIN_VALUE))
        }
        return null
      }
    } catch {
      /* fall through */
    }
  } catch {
    return null
  }
  return null
}

/**
 * 建物有無オーバーレイを表示すべきズーム（ズームイン状態）かを返す。
 * ズーム推定不能時（初期化直前など）は表示側（true）に倒してチラつきを防ぐ。
 */
export function isBuildingOverlayZoomedIn(viewer: Viewer): boolean {
  const zoom = getViewerZoom(viewer)
  if (zoom == null) {
    try {
      const carto = viewer.camera.positionCartographic
      if (carto && Number.isFinite(carto.height) && carto.height > 0) {
        return carto.height <= BUILDING_OVERLAY_MAX_HEIGHT_M
      }
    } catch {
      /* ignore */
    }
    return true
  }
  return zoom >= BUILDING_OVERLAY_MIN_ZOOM
}
