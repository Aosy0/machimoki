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

export const RESIZE_CORNER_HIT_PX = 12
/** 辺中点カプセルの中心線からの許容距離（px）。太さ/2＋余裕3.5。辺線上でも中点から離れるとnull。 */
export const RESIZE_HANDLE_HIT_PX = 9
/** カプセル中心線の半長（px）。カプセル長/2−太さ/2 = 26/2−11/2。 */
export const RESIZE_HANDLE_HALF_LENGTH_PX = 7.5
export const RESIZE_MIN_GAP_PX = 8
export const RESIZE_MOVE_TOLERANCE_PX = 3

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
  handle: ResizeHandle
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
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(point.x - mid.x, point.y - mid.y)
  const ux = dx / length
  const uy = dy / length
  return distanceToSegment(
    point,
    { x: mid.x - ux * RESIZE_HANDLE_HALF_LENGTH_PX, y: mid.y - uy * RESIZE_HANDLE_HALF_LENGTH_PX },
    { x: mid.x + ux * RESIZE_HANDLE_HALF_LENGTH_PX, y: mid.y + uy * RESIZE_HANDLE_HALF_LENGTH_PX },
  )
}

/**
 * 角優先（12px以内）、次に辺中点カプセル（中心線から8px以内）。
 * 辺線上でも中点から離れた位置はnull（=パンに任せる）。該当なしもnull。
 */
export function hitTestSelectionHandle(
  point: ScreenPoint,
  handles: SelectionHandlePoints,
): ResizeHandle | null {
  for (const { handle, key } of CORNERS) {
    const corner = handles[key]
    if (Math.hypot(point.x - corner.x, point.y - corner.y) <= RESIZE_CORNER_HIT_PX) {
      return handle
    }
  }
  for (const { handle, a, b } of EDGES) {
    if (distanceToHandleSpine(point, handles[handle], handles[a], handles[b]) <= RESIZE_HANDLE_HIT_PX) {
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
export function movedBeyondTolerance(start: ScreenPoint, end: ScreenPoint): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > RESIZE_MOVE_TOLERANCE_PX
}
