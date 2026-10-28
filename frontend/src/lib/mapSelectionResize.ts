/**
 * MapLibre矩形選択の確定後リサイズ（辺・角ドラッグ）の純ロジック。
 * 画面px前提のヒットテストと、経緯度ベースの反転防止クランプを提供する。
 * React非依存（テストは node:test で直接呼ぶ）。
 */
import type { SelectionBounds } from './selectionBounds'

export interface ScreenPoint {
  x: number
  y: number
}

export interface LngLatPoint {
  lng: number
  lat: number
}

export type ResizeHandle = 'north' | 'south' | 'east' | 'west' | 'nw' | 'ne' | 'se' | 'sw'

/**
 * ハンドルの当たり判定・描画寸法。マウス（fine）とタッチ（coarse）で
 * 同じ値をヒットテストとMapLibreレイヤー描画の両方に使う。
 */
export interface HandleMetrics {
  key: 'fine' | 'coarse'
  /** 角円の当たり半径（px）。 */
  cornerHitPx: number
  /** 辺カプセル中心線からの許容距離（px）。 */
  edgeHitPx: number
  /** カプセル中心線の半長（px）。 */
  handleHalfLengthPx: number
  /** リサイズ時の最小画面ギャップ（px）。 */
  minGapPx: number
  /** 角円の描画半径（px）。 */
  cornerRadius: number
  /** ホバー強調の角円半径（px）。 */
  hoverCornerRadius: number
  /** ホバー強調の角円枠線幅（px）。 */
  hoverCornerStrokeWidth: number
  /** カプセル画像の長さ（px）。 */
  capsuleLengthPx: number
  /** カプセル画像の太さ（px）。 */
  capsuleWidthPx: number
  /** カプセルの枠線幅（px）。 */
  capsuleStrokePx: number
  /** ホバー強調カプセルの拡大率。 */
  hoverIconSize: number
  /** 辺カプセルを表示・ヒットさせる辺長の下限（px）。 */
  edgeMinLengthPx: number
  /** 角円を表示・ヒットさせる短辺の下限（px）。 */
  cornerMinDimensionPx: number
  /** 辺カプセルを表示・ヒットさせる短辺の下限（px）。 */
  edgeMinThicknessPx: number
  /** リサイズ開始とみなす移動量（px）。 */
  moveTolerancePx: number
}

export const FINE_HANDLE_METRICS: HandleMetrics = {
  key: 'fine',
  cornerHitPx: 12,
  edgeHitPx: 9,
  handleHalfLengthPx: 7.5,
  minGapPx: 8,
  cornerRadius: 6,
  hoverCornerRadius: 9,
  hoverCornerStrokeWidth: 3,
  capsuleLengthPx: 26,
  capsuleWidthPx: 11,
  capsuleStrokePx: 2,
  hoverIconSize: 1.2,
  edgeMinLengthPx: 38,
  cornerMinDimensionPx: 24,
  edgeMinThicknessPx: 16,
  moveTolerancePx: 3,
}

/** タッチでも掴めるよう、当たり判定と見た目を約2倍にしたプロファイル。 */
export const COARSE_HANDLE_METRICS: HandleMetrics = {
  key: 'coarse',
  cornerHitPx: 28,
  edgeHitPx: 20,
  handleHalfLengthPx: 14,
  minGapPx: 16,
  cornerRadius: 11,
  hoverCornerRadius: 15,
  hoverCornerStrokeWidth: 3,
  capsuleLengthPx: 44,
  capsuleWidthPx: 20,
  capsuleStrokePx: 2.5,
  hoverIconSize: 1.15,
  edgeMinLengthPx: 60,
  cornerMinDimensionPx: 38,
  edgeMinThicknessPx: 28,
  moveTolerancePx: 6,
}

export function handleMetricsFor(pointerType: string | undefined): HandleMetrics {
  return pointerType === 'touch' || pointerType === 'pen'
    ? COARSE_HANDLE_METRICS
    : FINE_HANDLE_METRICS
}

// 既存テスト・呼び出しとの互換（fineプロファイルの別名）。
export const RESIZE_CORNER_HIT_PX = FINE_HANDLE_METRICS.cornerHitPx
export const RESIZE_HANDLE_HIT_PX = FINE_HANDLE_METRICS.edgeHitPx
export const RESIZE_HANDLE_HALF_LENGTH_PX = FINE_HANDLE_METRICS.handleHalfLengthPx
export const HANDLE_EDGE_MIN_LENGTH_PX = FINE_HANDLE_METRICS.edgeMinLengthPx
export const HANDLE_CORNER_MIN_DIMENSION_PX = FINE_HANDLE_METRICS.cornerMinDimensionPx
export const HANDLE_EDGE_MIN_THICKNESS_PX = FINE_HANDLE_METRICS.edgeMinThicknessPx
export const RESIZE_MIN_GAP_PX = FINE_HANDLE_METRICS.minGapPx
export const RESIZE_MOVE_TOLERANCE_PX = FINE_HANDLE_METRICS.moveTolerancePx

export interface SelectionCorners {
  nw: ScreenPoint
  ne: ScreenPoint
  se: ScreenPoint
  sw: ScreenPoint
}

/** 4隅＋4辺中点のスクリーン座標。ヒットテストとハンドル描画の基準。 */
export interface SelectionHandlePoints extends SelectionCorners {
  north: ScreenPoint
  east: ScreenPoint
  south: ScreenPoint
  west: ScreenPoint
}

/** 画面pxに基づくハンドル可視性。描画の間引きとヒット判定で共有する。 */
export interface HandleVisibility {
  corners: boolean
  edges: { north: boolean; east: boolean; south: boolean; west: boolean }
}

/**
 * 8点の画面座標から各ハンドルの可視性を求める（投影距離基準・回転対応）。
 * 幅=北辺長・高さ=東辺長とし、各辺は自身の長さで判定する。
 */
export function handleVisibility(
  points: SelectionHandlePoints,
  metrics: HandleMetrics = FINE_HANDLE_METRICS,
): HandleVisibility {
  const length = (a: ScreenPoint, b: ScreenPoint): number => Math.hypot(a.x - b.x, a.y - b.y)
  const northLen = length(points.nw, points.ne)
  const eastLen = length(points.ne, points.se)
  const minDim = Math.min(northLen, eastLen)
  const edgeVisible = (len: number): boolean =>
    len >= metrics.edgeMinLengthPx && minDim >= metrics.edgeMinThicknessPx
  return {
    corners: minDim >= metrics.cornerMinDimensionPx,
    edges: {
      north: edgeVisible(northLen),
      east: edgeVisible(eastLen),
      south: edgeVisible(length(points.se, points.sw)),
      west: edgeVisible(length(points.sw, points.nw)),
    },
  }
}

/** project: [lng,lat] → キャンバス相対px。4隅を投影する。 */
export function selectionCorners(
  bounds: SelectionBounds,
  project: (lngLat: [number, number]) => ScreenPoint,
): SelectionCorners {
  return {
    nw: project([bounds.west, bounds.north]),
    ne: project([bounds.east, bounds.north]),
    se: project([bounds.east, bounds.south]),
    sw: project([bounds.west, bounds.south]),
  }
}

/** 4隅を投影し、辺中点は投影済み角の中点で求める（回転にも追随する）。 */
export function selectionHandleScreenPoints(
  bounds: SelectionBounds,
  project: (lngLat: [number, number]) => ScreenPoint,
): SelectionHandlePoints {
  const corners = selectionCorners(bounds, project)
  const mid = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })
  return {
    ...corners,
    north: mid(corners.nw, corners.ne),
    east: mid(corners.ne, corners.se),
    south: mid(corners.se, corners.sw),
    west: mid(corners.sw, corners.nw),
  }
}

/** 点pから線分abへの距離。線分長0なら点間距離。 */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

const CORNERS: Array<{ handle: ResizeHandle; key: keyof SelectionCorners }> = [
  { handle: 'nw', key: 'nw' },
  { handle: 'ne', key: 'ne' },
  { handle: 'se', key: 'se' },
  { handle: 'sw', key: 'sw' },
]

const EDGES: Array<{
  handle: 'north' | 'east' | 'south' | 'west'
  a: keyof SelectionCorners
  b: keyof SelectionCorners
}> = [
  { handle: 'north', a: 'nw', b: 'ne' },
  { handle: 'east', a: 'ne', b: 'se' },
  { handle: 'south', a: 'se', b: 'sw' },
  { handle: 'west', a: 'sw', b: 'nw' },
]

/**
 * カプセル中心線（mid ± u*HALF_LENGTH、uは辺方向の単位ベクトル）への距離。
 * 辺が点に潰れている場合は中点との距離。
 */
function distanceToHandleSpine(
  point: ScreenPoint,
  mid: ScreenPoint,
  a: ScreenPoint,
  b: ScreenPoint,
  metrics: HandleMetrics,
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(point.x - mid.x, point.y - mid.y)
  const ux = dx / length
  const uy = dy / length
  const half = metrics.handleHalfLengthPx
  return distanceToSegment(
    point,
    { x: mid.x - ux * half, y: mid.y - uy * half },
    { x: mid.x + ux * half, y: mid.y + uy * half },
  )
}

/**
 * 角優先（12px以内）、次に辺中点カプセル（中心線から9px以内）。
 * 辺線上でも中点から離れた位置はnull（=パンに任せる）。該当なしもnull。
 * 小さくて非表示のハンドルにはヒットしない（描画の間引きと同一閾値）。
 */
export function hitTestSelectionHandle(
  point: ScreenPoint,
  handles: SelectionHandlePoints,
  metrics: HandleMetrics = FINE_HANDLE_METRICS,
): ResizeHandle | null {
  const visibility = handleVisibility(handles, metrics)
  if (visibility.corners) {
    for (const { handle, key } of CORNERS) {
      const corner = handles[key]
      if (Math.hypot(point.x - corner.x, point.y - corner.y) <= metrics.cornerHitPx) {
        return handle
      }
    }
  }
  for (const { handle, a, b } of EDGES) {
    if (!visibility.edges[handle]) continue
    if (
      distanceToHandleSpine(point, handles[handle], handles[a], handles[b], metrics) <=
      metrics.edgeHitPx
    ) {
      return handle
    }
  }
  return null
}

/** ハンドルに対応するCSSカーソル。 */
export function resizeCursor(handle: ResizeHandle): string {
  switch (handle) {
    case 'north':
    case 'south':
      return 'ns-resize'
    case 'east':
    case 'west':
      return 'ew-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
  }
}

/**
 * 反転防止クランプ付きで、ドラッグ後のboundsを返す。
 * minGapは画面8px相当の経緯度デルタ（正値）。クランプ基準は常に渡されたbounds。
 */
export function applyResizeDrag(
  bounds: SelectionBounds,
  handle: ResizeHandle,
  pointer: LngLatPoint,
  minGap: { lng: number; lat: number },
): SelectionBounds {
  const next = { ...bounds }
  if (handle === 'west' || handle === 'nw' || handle === 'sw') {
    next.west = Math.min(pointer.lng, bounds.east - minGap.lng)
  }
  if (handle === 'east' || handle === 'ne' || handle === 'se') {
    next.east = Math.max(pointer.lng, bounds.west + minGap.lng)
  }
  if (handle === 'north' || handle === 'nw' || handle === 'ne') {
    next.north = Math.max(pointer.lat, bounds.south + minGap.lat)
  }
  if (handle === 'south' || handle === 'sw' || handle === 'se') {
    next.south = Math.min(pointer.lat, bounds.north - minGap.lat)
  }
  return next
}

/** 開始点から許容pxを超えて動いたか。 */
export function movedBeyondTolerance(
  start: ScreenPoint,
  end: ScreenPoint,
  tolerancePx: number = FINE_HANDLE_METRICS.moveTolerancePx,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > tolerancePx
}
