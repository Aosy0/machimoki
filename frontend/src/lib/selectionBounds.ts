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
  const widthM = (((bounds.east - bounds.west) * Math.PI) / 180) * EARTH_RADIUS_M
  const heightM = (((bounds.north - bounds.south) * Math.PI) / 180) * EARTH_RADIUS_M
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

/** 選択矩形の実寸（m）。横=東西（中心緯度でcos補正）、縦=南北。 */
export function computeNaturalDimensions(bounds: SelectionBounds): {
  widthM: number
  depthM: number
} {
  const centerLat = (bounds.north + bounds.south) / 2
  const widthDeg = bounds.east - bounds.west
  const heightDeg = bounds.north - bounds.south
  const widthM =
    Math.abs(widthDeg) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos((centerLat * Math.PI) / 180)
  const depthM = Math.abs(heightDeg) * (Math.PI / 180) * EARTH_RADIUS_M
  return { widthM, depthM }
}

/** モデル長さの表示用。100mm以上は整数、10mm以上は小数1桁、未満は小数2桁。 */
export function formatMm(m: number): string {
  if (m >= 100) return `${m.toFixed(0)} mm`
  if (m >= 10) return `${m.toFixed(1)} mm`
  return `${m.toFixed(2)} mm`
}

/** 実寸の表示用（m）。小数1桁＋桁区切り。 */
export function formatMeters(m: number): string {
  return `${m.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`
}

/** scale（無次元 m/m）から縮尺分母。例: 0.00075 → 1333（1:1,333）。 */
export function scaleDenominator(scale: number): number {
  return Math.round(1 / scale)
}

/** 縮尺の表示用。例: 0.00075 → "1 : 1,333"。 */
export function formatScale(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return '1 : —'
  return `1 : ${scaleDenominator(scale).toLocaleString('en-US')}`
}

/** 実寸＋モデル長さの一括計算。scale は無次元 (m/m)。 */
export function computeModelDimensions(
  bounds: SelectionBounds,
  scale: number,
): { widthM: number; depthM: number; widthMm: number; depthMm: number } {
  const { widthM, depthM } = computeNaturalDimensions(bounds)
  return { widthM, depthM, widthMm: widthM * scale * 1000, depthMm: depthM * scale * 1000 }
}
