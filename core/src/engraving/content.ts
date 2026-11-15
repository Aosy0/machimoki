/**
 * 刻印内容（座標・メッシュコード・縮尺・出典など）の文字列化。
 * UIとCLI/APIで同じ表記になるよう、書式はここに集約する。
 */

import type { Bounds } from '../types.js'

/** 中心座標（10進度・小数5桁 ≒ 1m）。例: 35.68120N 139.76710E */
export function formatCenterCoordinate(bounds: Bounds): string {
  const lat = (bounds.north + bounds.south) / 2
  const lon = (bounds.east + bounds.west) / 2
  return `${lat.toFixed(5)}N ${lon.toFixed(5)}E`
}

/**
 * JIS X 0410 の1kmメッシュコード。例: 5339-46-11
 * 日本国外（緯度20〜46度・経度122〜154度の外）は null。
 */
export function jisMeshCode1km(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (lat < 20 || lat > 46 || lon < 122 || lon > 154) return null

  const p = Math.floor(lat * 1.5)
  const q = Math.floor(lon - 100)
  const latMin = lat * 60 - p * 40
  const lonMin = (lon - 100 - q) * 60
  const r = Math.floor(latMin / 5)
  const s = Math.floor(lonMin / 7.5)
  const t = Math.floor((latMin - r * 5) * 2)
  const u = Math.floor((lonMin - s * 7.5) / 0.75)
  if (r < 0 || r > 7 || s < 0 || s > 7 || t < 0 || t > 9 || u < 0 || u > 9) return null
  return `${String(p).padStart(2, '0')}${String(q).padStart(2, '0')}-${r}${s}-${t}${u}`
}

/** 中心の1kmメッシュコード行。例: MESH 5339-46-11（日本国外は null） */
export function formatMeshCodeLine(bounds: Bounds): string | null {
  const lat = (bounds.north + bounds.south) / 2
  const lon = (bounds.east + bounds.west) / 2
  const code = jisMeshCode1km(lat, lon)
  return code ? `MESH ${code}` : null
}

/** 縮尺・寸法の行。例: 1:1,000  W150 x D100 x T10 mm */
export function formatScaleAndSize(
  scale: number,
  widthMm: number,
  depthMm: number,
  terrainThicknessMm: number,
): string {
  const denominator = Number.isFinite(scale) && scale > 0 ? Math.round(1 / scale) : 0
  const scaleText = denominator > 0 ? `1:${denominator.toLocaleString('en-US')}` : '1:-'
  const width = Math.round(widthMm)
  const depth = Math.round(depthMm)
  const thickness = Math.round(terrainThicknessMm)
  return `${scaleText}  W${width} x D${depth} x T${thickness} mm`
}

/** 出典（PLATEAUの帰属表示）。 */
export function formatAttribution(): string {
  return '© PLATEAU (MLIT)'
}

/** 作成年月。例: 2026.11 */
export function formatDateLine(date: Date = new Date()): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}
