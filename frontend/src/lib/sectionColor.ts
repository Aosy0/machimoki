/**
 * 断面色のトーンシフト用カラーユーティリティ（Cesium非依存の純モジュール）。
 *
 * モデル色をOklabに変換し、明度を反対方向へずらして彩度を少し落とす。
 * Fusionの断面表示のように、元の色相を保ったまま切断面と分かる色にする。
 */

export interface Oklab {
  L: number
  a: number
  b: number
}

/** CSS色をパースしてsRGB(0-255)の三つ組にする。不正入力は白として扱う。 */
function parseHex(hex: string): [number, number, number] {
  const m = /^\s*#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\s*$/.exec(hex)
  if (!m) return [255, 255, 255]
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** sRGB(0-255)をリニアRGB(0-1)に変換する。 */
function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** リニアRGB(0-1)をsRGB(0-255)に変換する（範囲外は丸める）。 */
function linearToSrgbByte(v: number): number {
  const clamped = Math.min(1, Math.max(0, v))
  const s = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

/** CSS色（#rrggbb等）をOklabに変換する。不正入力は白として扱う。 */
export function toOklab(hex: string): Oklab {
  const [r, g, b] = parseHex(hex)
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

/** OklabをリニアRGB(0-1)に変換する（色域外もそのまま返す）。 */
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** Oklabを#rrggbb（小文字）で返す。 */
function oklabToHex(L: number, a: number, b: number): string {
  const [r, g, bl] = oklabToLinearRgb(L, a, b)
  const to2 = (v: number): string => linearToSrgbByte(v).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(bl)}`
}

/** リニアRGBがsRGB色域内に収まっているか。 */
function inSrgbGamut(L: number, a: number, b: number): boolean {
  const [r, g, bl] = oklabToLinearRgb(L, a, b)
  const eps = 1e-4
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && bl >= -eps && bl <= 1 + eps
}

/**
 * モデル色から断面色を選ぶ。明るいモデルは暗く、暗いモデルは明るくし（ΔL≧0.28）、
 * 彩度を×0.85、色相は維持する。明度シフトで色域外になる場合は、色相を保ったまま
 * 彩度だけを下げて色域内に収める（クランプによる色相ズレを防ぐ）。
 * 不正入力は白として扱う。
 */
export function pickSectionColor(modelColor: string): string {
  const { L, a, b } = toOklab(modelColor)
  const shiftedL = L > 0.5 ? Math.max(L - 0.3, 0.22) : Math.min(L + 0.3, 0.85)
  let ca = a * 0.85
  let cb = b * 0.85
  for (let i = 0; i < 32 && !inSrgbGamut(shiftedL, ca, cb); i++) {
    ca *= 0.9
    cb *= 0.9
  }
  return oklabToHex(shiftedL, ca, cb)
}
