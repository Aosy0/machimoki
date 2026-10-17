/**
 * selectionBounds の寸法計算（マップ寸法表示・ModelSizeOverlay共有）のテスト。
 *
 * 実行方法:
 *   npm exec --workspace frontend -- vitest run src/lib/selectionDimensions.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  EARTH_RADIUS_M,
  computeModelDimensions,
  computeNaturalDimensions,
  formatMm,
  formatScale,
  scaleDenominator,
  type SelectionBounds,
} from './selectionBounds'

const SHINJUKU: SelectionBounds = { west: 139.6899, south: 35.7029, east: 139.6932, north: 35.707 }

describe('computeNaturalDimensions', () => {
  it('widthM が cos(中心緯度) 補正込みの式と一致する', () => {
    const { widthM, depthM } = computeNaturalDimensions(SHINJUKU)
    const centerLat = (SHINJUKU.north + SHINJUKU.south) / 2
    const expectedWidth =
      Math.abs(SHINJUKU.east - SHINJUKU.west) *
      (Math.PI / 180) *
      EARTH_RADIUS_M *
      Math.cos((centerLat * Math.PI) / 180)
    const expectedDepth =
      Math.abs(SHINJUKU.north - SHINJUKU.south) * (Math.PI / 180) * EARTH_RADIUS_M
    assert.ok(Math.abs(widthM - expectedWidth) < 1e-9)
    assert.ok(Math.abs(depthM - expectedDepth) < 1e-9)
    // 新宿の街区サイズらしく横300m前後・縦450m前後になる
    assert.ok(widthM > 200 && widthM < 400)
    assert.ok(depthM > 300 && depthM < 600)
  })
})

describe('自動スケール', () => {
  it('150/(maxDim*1000) のとき長辺のモデル長さが 150mm になる', () => {
    const { widthM, depthM } = computeNaturalDimensions(SHINJUKU)
    const maxDim = Math.max(widthM, depthM)
    const scale = 150 / (maxDim * 1000)
    const dims = computeModelDimensions(SHINJUKU, scale)
    assert.ok(Math.abs(Math.max(dims.widthMm, dims.depthMm) - 150) < 1e-9)
    // 100mm以上は整数表示なので長辺はちょうど「150 mm」
    const longSide = dims.widthMm >= dims.depthMm ? dims.widthMm : dims.depthMm
    assert.equal(formatMm(longSide), '150 mm')
  })

  it('maxDim=150m の矩形は縮尺 1:1000 になる', () => {
    const degFor150m = 150 / ((Math.PI / 180) * EARTH_RADIUS_M)
    const lat = 35.7
    const bounds: SelectionBounds = {
      west: 139.69,
      south: lat,
      east: 139.69 + degFor150m / Math.cos((lat * Math.PI) / 180),
      north: lat + degFor150m,
    }
    const { widthM, depthM } = computeNaturalDimensions(bounds)
    assert.ok(Math.abs(widthM - 150) < 0.5)
    assert.ok(Math.abs(depthM - 150) < 1e-9)
    const scale = 150 / (Math.max(widthM, depthM) * 1000)
    assert.equal(scaleDenominator(scale), 1000)
    assert.equal(formatScale(scale), '1 : 1,000')
  })

  it('縮尺分母は 1/scale の四捨五入（例: 0.00075 → 1:1,333）', () => {
    assert.equal(scaleDenominator(0.00075), 1333)
    assert.equal(formatScale(0.00075), '1 : 1,333')
  })
})
