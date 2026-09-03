/**
 * 地理的矩形範囲（SelectionBounds）の変換・検証関数。
 *
 * WGS84 decimal degrees を扱う。
 * - west < east, south < north を保証
 * - 反子午線（日期変更線）跨ぎは非対応エラー
 * - 範囲外・NaN・north<=south を拒否
 */
import type { SelectionBounds } from '../hooks/useRectangleSelection'

export interface BoundsInput {
  west: number
  south: number
  east: number
  north: number
}

const LON_MIN = -180
const LON_MAX = 180
const LAT_MIN = -90
const LAT_MAX = 90

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value)
}

function validateLon(value: number): void {
  if (!isFiniteNumber(value)) {
    throw new Error(`経度がNaNまたは無限大です: ${value}`)
  }
  if (value < LON_MIN || value > LON_MAX) {
    throw new Error(`経度が範囲外です（-180〜180）: ${value}`)
  }
}

function validateLat(value: number): void {
  if (!isFiniteNumber(value)) {
    throw new Error(`緯度がNaNまたは無限大です: ${value}`)
  }
  if (value < LAT_MIN || value > LAT_MAX) {
    throw new Error(`緯度が範囲外です（-90〜90）: ${value}`)
  }
}

export function isAntimeridianCrossing(west: number, east: number): boolean {
  return west > east
}

export function createSelectionBounds(
  west: number,
  south: number,
  east: number,
  north: number,
): SelectionBounds {
  if (!isFiniteNumber(west) || !isFiniteNumber(south) || !isFiniteNumber(east) || !isFiniteNumber(north)) {
    throw new Error('boundsにNaNが含まれています')
  }
  validateLon(west)
  validateLon(east)
  validateLat(south)
  validateLat(north)

  if (north <= south) {
    throw new Error(`north (${north}) は south (${south}) より大きい必要があります`)
  }

  if (isAntimeridianCrossing(west, east)) {
    throw new Error(`反子午線跨ぎは非対応です（west=${west}, east=${east}）`)
  }

  return { west, south, east, north }
}

export function normalizeBounds(input: BoundsInput): SelectionBounds {
  const { west, south, east, north } = input
  if (!isFiniteNumber(west) || !isFiniteNumber(south) || !isFiniteNumber(east) || !isFiniteNumber(north)) {
    throw new Error('boundsにNaNが含まれています')
  }
  validateLon(west)
  validateLon(east)
  validateLat(south)
  validateLat(north)

  const normalizedWest = Math.min(west, east)
  const normalizedEast = Math.max(west, east)
  const normalizedSouth = Math.min(south, north)
  const normalizedNorth = Math.max(south, north)

  if (normalizedNorth <= normalizedSouth) {
    throw new Error(`north (${normalizedNorth}) は south (${normalizedSouth}) より大きい必要があります`)
  }

  return {
    west: normalizedWest,
    south: normalizedSouth,
    east: normalizedEast,
    north: normalizedNorth,
  }
}
