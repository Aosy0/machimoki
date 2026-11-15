/**
 * 刻印（エングレーブ）の型・定数。
 *
 * 幾何計算はスケール適用済みモデル空間（Y-up・メートル）で行い、
 * UI・レイアウト・印刷条件は印刷mmで扱う（モデル空間の1m = 印刷1000mm）。
 */

export type EngravingFace = 'bottom' | 'south' | 'north' | 'east' | 'west'

export const ENGRAVING_FACES: readonly EngravingFace[] = [
  'bottom',
  'south',
  'north',
  'east',
  'west',
] as const

/** FDM/レジンなどの印刷プロファイル。最小線幅・刻印深さの根拠。 */
export interface PrintProfile {
  /** ノズル径（mm）。FDMの最小線幅 = nozzle + 0.05mm。 */
  nozzleMm: number
  /** 積層ピッチ（mm）。既定の刻印深さ = 2層分（最低0.4mm）。 */
  layerHeightMm: number
}

export const DEFAULT_PRINT_PROFILE: PrintProfile = { nozzleMm: 0.4, layerHeightMm: 0.2 }

/** 刻印後に残す最低肉厚（mm）。 */
export const MIN_REMAINING_WALL_MM = 1.0

/** 面の外周から刻印領域まで空ける余白（mm）。 */
export const FACE_MARGIN_MM = 2.0

/** 既定の行間（mm）。 */
export const DEFAULT_LINE_GAP_MM = 1.5

/** 側面に刻印するために必要な帯の最低高さ（mm）。 */
export const MIN_SIDE_BAND_HEIGHT_MM = 6.0

/** 刻印の既定深さ（2層分、最低0.4mm）。 */
export function defaultEngravingDepthMm(profile: PrintProfile = DEFAULT_PRINT_PROFILE): number {
  const twoLayers = profile.layerHeightMm * 2
  return Math.round(Math.max(0.4, twoLayers) * 100) / 100
}

/**
 * 印刷プロファイルから最小フォントサイズ（em, mm）を求める。
 *
 * 太字フォントの線幅は欧文で約0.14em、CJKで約0.09em。FDMの最小線幅
 * （nozzle + 0.05mm）を確保できるサイズを下限にする。
 */
export function engravingMinFontSizes(profile: PrintProfile): { latinMm: number; cjkMm: number } {
  const strokeMm = Math.max(0.45, profile.nozzleMm + 0.05)
  const latinMm = Math.max(3.0, strokeMm / 0.14)
  const cjkMm = Math.max(6.0, strokeMm / 0.09)
  return {
    latinMm: Math.round(latinMm * 10) / 10,
    cjkMm: Math.round(cjkMm * 10) / 10,
  }
}

/** CJK（日本語）文字か。全角記号・かな・漢字を含む。 */
export function isCjkChar(char: string): boolean {
  const code = char.codePointAt(0)
  if (code === undefined) return false
  return (
    (code >= 0x3000 && code <= 0x30ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

/** 文字列にCJK文字を含むか。 */
export function isCjkText(text: string): boolean {
  for (const char of text) {
    if (isCjkChar(char)) return true
  }
  return false
}

/** 刻印する1行。text に改行を含めると行内で分割される。 */
export interface EngravingLine {
  /** 内容の識別子（UI用。幾何には影響しない） */
  id: string
  text: string
  /** フォントサイズ（em, 印刷mm） */
  sizeMm: number
  /** true のとき自動値（座標・縮尺など）を再計算して差し替える */
  auto?: boolean
}

export interface EngravingOptions {
  enabled: boolean
  face: EngravingFace
  /** 使用可能領域内のブロック中心（0..1） */
  centerX: number
  centerY: number
  /** 行間の追加スペース（印刷mm） */
  lineGapMm: number
  lines: EngravingLine[]
  /** 刻印深さ（印刷mm） */
  depthMm: number
  printProfile: PrintProfile
  /** 面の幅に収めるため自動折り返し */
  wrap: boolean
}

export function defaultEngravingOptions(): EngravingOptions {
  return {
    enabled: false,
    face: 'bottom',
    centerX: 0.5,
    centerY: 0.5,
    lineGapMm: DEFAULT_LINE_GAP_MM,
    lines: [],
    depthMm: defaultEngravingDepthMm(),
    printProfile: { ...DEFAULT_PRINT_PROFILE },
    wrap: true,
  }
}

/** UI が面の寸法・可否を計算するための入力。 */
export interface EngravingModelDims {
  widthMm: number
  depthMm: number
  terrainThicknessMm: number
  shellThicknessMm: number
  hasTerrain: boolean
  /** 底面が水平にフラット化されているか（flattenBottom || reflectActualElevation）。 */
  flatBottom: boolean
  openBottom: boolean
  splitAtGround: boolean
}

export interface EngravingFaceDims {
  face: EngravingFace
  available: boolean
  unavailableReason?: string
  widthMm: number
  heightMm: number
  /** 面の奥行き（壁厚・印刷mm）。0 = 制限なし（ソリッド）。 */
  wallThicknessMm: number
}

/** その面に刻印できる最大深さ（mm）。制限なしは Infinity。 */
export function engravingMaxDepthMm(face: EngravingFaceDims): number {
  if (face.wallThicknessMm <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, face.wallThicknessMm - MIN_REMAINING_WALL_MM)
}
