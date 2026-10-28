import { useEffect, useState } from 'react'
import {
  detectPreviewQualityTier,
  previewQualityProfile,
  type PreviewQualityOverride,
  type PreviewQualityProfile,
  type PreviewQualityTier,
} from '../lib/previewQuality'

const STORAGE_KEY = 'machimoki.previewQualityOverride'

function loadOverride(): PreviewQualityOverride {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'high' || raw === 'medium' || raw === 'low') return raw
  } catch {
    void 0
  }
  return 'auto'
}

export interface PreviewQualityState {
  tier: PreviewQualityTier
  profile: PreviewQualityProfile
  override: PreviewQualityOverride
  setOverride: (value: PreviewQualityOverride) => void
}

/** 3Dプレビューの描画品質。既定は端末性能から自動判定し、手動で上書きできる。 */
export function usePreviewQuality(): PreviewQualityState {
  const [autoTier, setAutoTier] = useState<PreviewQualityTier>(detectPreviewQualityTier)
  const [override, setOverride] = useState<PreviewQualityOverride>(loadOverride)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = (): void => setAutoTier(detectPreviewQualityTier())
    update()
    window.addEventListener('resize', update)
    const mql = window.matchMedia?.('(pointer: coarse)')
    const onChange = (): void => update()
    mql?.addEventListener?.('change', onChange)
    return () => {
      window.removeEventListener('resize', update)
      mql?.removeEventListener?.('change', onChange)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, override)
    } catch {
      void 0
    }
  }, [override])

  const tier = override === 'auto' ? autoTier : override
  return {
    tier,
    profile: previewQualityProfile(tier),
    override,
    setOverride,
  }
}
