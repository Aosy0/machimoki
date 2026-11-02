/**
 * 分割の最小寸法の共通定数。
 *
 * ブラウザ UI からも参照するため、manifold-3d などの重い依存を
 * import しない独立モジュールにしている。
 */

/** 地形枠の最小高さ（印刷mm）。terrainThickness − shellThickness の下限。 */
export const MIN_FRAME_HEIGHT_MM = 2.0

/** ベース側面と枠空洞の片側クリアランス（印刷mm）。 */
export const BASE_CLEARANCE_MM = 0.15

/** 地形の最低点からベース底面を延長する量（印刷mm）。 */
export const BASE_EXTENSION_MM = 0.2

/**
 * 45°マイター内側（C側）上端の深さ。シェル厚み t に対する倍率で、
 * C側の枠壁高 = terrainThickness - 1.9t が正である必要がある。
 */
export const FRAME_MITER_DEPTH_RATIO = 1.9

/** C側の枠壁高が確保できるか（45°斜面がスラブ底面に届かないか）。 */
export function hasMiterWall(terrainThickness: number, shellThickness: number): boolean {
  // 5.7 - 1.9 * 3 のような境界を浮動小数の誤差で誤判定しないよう許容する。
  return terrainThickness - FRAME_MITER_DEPTH_RATIO * shellThickness > 1e-6
}

/** パッド底面（45°楔の先端 - BASE_EXTENSION_MM）がスラブ底面より上にあるか。 */
export function hasMiterBase(terrainThickness: number, shellThickness: number): boolean {
  return terrainThickness - FRAME_MITER_DEPTH_RATIO * shellThickness - BASE_EXTENSION_MM > 1e-6
}
