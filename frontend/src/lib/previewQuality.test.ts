import { afterEach, describe, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import {
  detectPreviewQualityTier,
  PREVIEW_QUALITY_PROFILES,
  previewQualityProfile,
} from './previewQuality'

describe('previewQuality', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('段階ごとにMSAA・影・AO・解像度が下がる', () => {
    const high = PREVIEW_QUALITY_PROFILES.high
    const medium = PREVIEW_QUALITY_PROFILES.medium
    const low = PREVIEW_QUALITY_PROFILES.low
    assert.ok(high.msaaSamples > medium.msaaSamples)
    assert.ok(medium.msaaSamples > low.msaaSamples)
    assert.ok(high.shadowMapSize > medium.shadowMapSize)
    assert.equal(medium.shadows, true)
    assert.equal(low.shadows, false)
    assert.equal(low.ambientOcclusion, false)
    assert.ok(high.resolutionScale > low.resolutionScale)
    assert.equal(previewQualityProfile('medium'), medium)
  })

  it('マウス主体の端末は高画質', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
      innerWidth: 1280,
    })
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 })
    assert.equal(detectPreviewQualityTier(), 'high')
  })

  it('狭いタッチ端末は軽量、広いタッチ端末は標準', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
      innerWidth: 390,
    })
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 })
    assert.equal(detectPreviewQualityTier(), 'low')

    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
      innerWidth: 810,
    })
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8 })
    assert.equal(detectPreviewQualityTier(), 'medium')
  })

  it('低メモリ・低コア数はタッチ端末で軽量', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
      innerWidth: 810,
    })
    vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 8 })
    assert.equal(detectPreviewQualityTier(), 'low')
  })
})
