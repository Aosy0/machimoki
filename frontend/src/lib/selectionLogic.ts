/**
 * 矩形選択の純粋関数ロジック。
 *
 * - 選択矩形の計算（start, current → bounds）
 * - 微小矩形判定
 * - 面積計算（km²）
 *
 * Reactフックから分離することで、node:test でユニットテスト可能。
 */
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import { createSelectionBounds } from './mapBounds'

export interface PixelPoint {
  x: number
  y: number
}

export interface LngLat {
  lng: number
  lat: number
}

export const MIN_WIDTH_PX = 5
export const MIN_HEIGHT_PX = 5
export const MIN_AREA_KM2 = 0.0001

export function calculatePixelBounds(start: PixelPoint, current: PixelPoint): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} {
  const minX = Math.min(start.x, current.x)
  const minY = Math.min(start.y, current.y)
  const maxX = Math.max(start.x, current.x)
  const maxY = Math.max(start.y, current.y)
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function isTooSmall(width: number, height: number): boolean {
  return width < MIN_WIDTH_PX || height < MIN_HEIGHT_PX
}

export function calculateAreaKm2(bounds: SelectionBounds): number {
  const widthM = ((bounds.east - bounds.west) * Math.PI * 6371000 * Math.cos((bounds.south + bounds.north) / 2 * Math.PI / 180)) / 180
  const heightM = ((bounds.north - bounds.south) * Math.PI * 6371000) / 180
  return (widthM * heightM) / 1_000_000
}

export const MAX_AREA_KM2 = 1000.0

export function validateArea(bounds: SelectionBounds): string | null {
  const area = calculateAreaKm2(bounds)
  if (area > MAX_AREA_KM2) {
    return `選択範囲が広すぎます（${area.toFixed(2)} km²）。最大${MAX_AREA_KM2}km²まで。`
  }
  return null
}

export function pixelBoundsToSelectionBounds(
  start: PixelPoint,
  current: PixelPoint,
  unproject: (point: PixelPoint) => LngLat | null,
): SelectionBounds | null {
  const pixelBounds = calculatePixelBounds(start, current)
  if (isTooSmall(pixelBounds.width, pixelBounds.height)) {
    return null
  }

  const topLeft = unproject({ x: pixelBounds.minX, y: pixelBounds.minY })
  const bottomRight = unproject({ x: pixelBounds.maxX, y: pixelBounds.maxY })
  if (!topLeft || !bottomRight) {
    return null
  }

  try {
    return createSelectionBounds(topLeft.lng, bottomRight.lat, bottomRight.lng, topLeft.lat)
  } catch {
    return null
  }
}
