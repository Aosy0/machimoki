/**
 * 矩形選択の座標変換・検証の単一集約点（WGS84）。
 * Cesium経路（useRectangleSelection）とMapLibre経路で判定を共有し、
 * 上限1000km²・メッセージ書式の互換を保つ。
 */
export interface SelectionBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface LngLat {
  lng: number
  lat: number
}

export const MAX_SELECTION_AREA_KM2 = 1000
export const EARTH_RADIUS_M = 6371000
const ANTIMERIDIAN_SPAN_DEG = 180

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Cesium経路と同式（半径6371000mの等距換算）の概算面積。 */
export function selectionAreaKm2(bounds: SelectionBounds): number {
  const widthM = ((bounds.east - bounds.west) * Math.PI) / 180 * EARTH_RADIUS_M
  const heightM = ((bounds.north - bounds.south) * Math.PI) / 180 * EARTH_RADIUS_M
  return (widthM * heightM) / 1_000_000
}

/** 不正なら理由文、正常ならnull。NaN・順序・反子午線・上限を拒否する。 */
export function validateSelectionBounds(bounds: SelectionBounds): string | null {
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(isFiniteNumber)) {
    return '選択範囲の座標が不正です（NaN）。選択し直してください'
  }
  if (!(bounds.west < bounds.east)) {
    return '選択範囲の東西が不正です。選択し直してください'
  }
  if (!(bounds.south < bounds.north)) {
    return '選択範囲の南北が不正です。選択し直してください'
  }
  if (bounds.east - bounds.west > ANTIMERIDIAN_SPAN_DEG) {
    return '反子午線をまたぐ選択には対応していません'
  }
  const areaKm2 = selectionAreaKm2(bounds)
  if (areaKm2 > MAX_SELECTION_AREA_KM2) {
    return `選択範囲が広すぎます（${areaKm2.toFixed(2)} km²）。最大1000km²まで。`
  }
  return null
}

export type BoundsResult = { ok: true; bounds: SelectionBounds } | { ok: false; error: string }

/** 2点の経緯度を正規化（west<east・south<north）して検証する。 */
export function boundsFromLngLat(a: LngLat, b: LngLat): BoundsResult {
  const candidate: SelectionBounds = {
    west: Math.min(a.lng, b.lng),
    south: Math.min(a.lat, b.lat),
    east: Math.max(a.lng, b.lng),
    north: Math.max(a.lat, b.lat),
  }
  const error = validateSelectionBounds(candidate)
  if (error !== null) return { ok: false, error }
  return { ok: true, bounds: candidate }
}
