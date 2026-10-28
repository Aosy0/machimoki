export type PreviewQualityTier = 'high' | 'medium' | 'low'
export type PreviewQualityOverride = 'auto' | PreviewQualityTier

export interface PreviewQualityProfile {
  tier: PreviewQualityTier
  label: string
  /** MSAAのサンプル数。 */
  msaaSamples: number
  /** 影を描画するか。 */
  shadows: boolean
  /** シャドウマップの一辺（px）。 */
  shadowMapSize: number
  /** 影を描画する最大距離（m）。 */
  shadowMaximumDistance: number
  /** アンビエントオクルージョン（画面全体のポストプロセス）。 */
  ambientOcclusion: boolean
  /** Cesiumの解像度スケール。1未満で描画ピクセルを間引く。 */
  resolutionScale: number
}

export const PREVIEW_QUALITY_PROFILES: Record<PreviewQualityTier, PreviewQualityProfile> = {
  high: {
    tier: 'high',
    label: '高画質',
    msaaSamples: 4,
    shadows: true,
    shadowMapSize: 4096,
    shadowMaximumDistance: 20000,
    ambientOcclusion: true,
    resolutionScale: 1,
  },
  medium: {
    tier: 'medium',
    label: '標準',
    msaaSamples: 2,
    shadows: true,
    shadowMapSize: 1024,
    shadowMaximumDistance: 5000,
    ambientOcclusion: false,
    resolutionScale: 0.85,
  },
  low: {
    tier: 'low',
    label: '軽量',
    msaaSamples: 1,
    shadows: false,
    shadowMapSize: 1024,
    shadowMaximumDistance: 5000,
    ambientOcclusion: false,
    resolutionScale: 0.7,
  },
}

export function previewQualityProfile(tier: PreviewQualityTier): PreviewQualityProfile {
  return PREVIEW_QUALITY_PROFILES[tier]
}

/**
 * 端末性能の自動判定。PCは高画質、タッチ端末は画面幅・メモリ・コア数で
 * 低スペックを判定する。SafariはdeviceMemoryが無いため画面幅を重視する。
 */
export function detectPreviewQualityTier(): PreviewQualityTier {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'high'
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  if (!coarse) return 'high'
  const memory = (navigator as { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  const width = window.innerWidth
  if ((memory !== undefined && memory <= 4) || (cores !== undefined && cores <= 4) || width <= 480) {
    return 'low'
  }
  return 'medium'
}
