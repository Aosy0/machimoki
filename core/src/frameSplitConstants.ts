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

/** 地形枠の内側上端に作る段差（棚）の幅（印刷mm）。建物側プレート外周が乗る。 */
export const FRAME_STEP_MM = 0.4
