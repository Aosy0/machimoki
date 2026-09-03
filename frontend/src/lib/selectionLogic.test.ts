/**
 * selectionLogic の単体テスト。
 *
 * 実行: npx tsx --test frontend/src/lib/selectionLogic.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculatePixelBounds,
  isTooSmall,
  calculateAreaKm2,
  validateArea,
  pixelBoundsToSelectionBounds,
  MIN_WIDTH_PX,
  MIN_HEIGHT_PX,
  MAX_AREA_KM2,
  type LngLat,
  type PixelPoint,
} from './selectionLogic'

describe('calculatePixelBounds', () => {
  it('start < current の場合', () => {
    const result = calculatePixelBounds({ x: 10, y: 20 }, { x: 50, y: 60 })
    assert.equal(result.minX, 10)
    assert.equal(result.minY, 20)
    assert.equal(result.maxX, 50)
    assert.equal(result.maxY, 60)
    assert.equal(result.width, 40)
    assert.equal(result.height, 40)
  })

  it('start > current の場合（逆方向ドラッグ）', () => {
    const result = calculatePixelBounds({ x: 50, y: 60 }, { x: 10, y: 20 })
    assert.equal(result.minX, 10)
    assert.equal(result.minY, 20)
    assert.equal(result.maxX, 50)
    assert.equal(result.maxY, 60)
  })
})

describe('isTooSmall', () => {
  it('幅が閾値未満はtrue', () => {
    assert.equal(isTooSmall(MIN_WIDTH_PX - 1, 100), true)
  })

  it('高さが閾値未満はtrue', () => {
    assert.equal(isTooSmall(100, MIN_HEIGHT_PX - 1), true)
  })

  it('両方閾値以上はfalse', () => {
    assert.equal(isTooSmall(MIN_WIDTH_PX, MIN_HEIGHT_PX), false)
    assert.equal(isTooSmall(100, 100), false)
  })
})

describe('calculateAreaKm2', () => {
  it('小さな範囲の面積を計算', () => {
    const bounds = { west: 139.69, south: 35.69, east: 139.70, north: 35.70 }
    const area = calculateAreaKm2(bounds)
    assert.ok(area > 0)
    assert.ok(area < 100)
  })

  it('広い範囲の面積を計算', () => {
    const bounds = { west: 139, south: 35, east: 140, north: 36 }
    const area = calculateAreaKm2(bounds)
    assert.ok(area > 1000)
  })
})

describe('validateArea', () => {
  it('範囲内はnull', () => {
    const bounds = { west: 139.69, south: 35.69, east: 139.70, north: 35.70 }
    assert.equal(validateArea(bounds), null)
  })

  it('上限超過はエラーメッセージ', () => {
    const bounds = { west: 130, south: 30, east: 145, north: 45 }
    const result = validateArea(bounds)
    assert.ok(result)
    assert.ok(result!.includes('広すぎます'))
    assert.ok(result!.includes(MAX_AREA_KM2.toString()))
  })
})

describe('pixelBoundsToSelectionBounds', () => {
  const mockUnproject = (point: PixelPoint): LngLat | null => {
    if (point.x < 0 || point.y < 0) return null
    return { lng: 139 + point.x * 0.01, lat: 36 - point.y * 0.01 }
  }

  it('正常なピクセル範囲からboundsを生成', () => {
    const start = { x: 10, y: 10 }
    const current = { x: 100, y: 100 }
    const result = pixelBoundsToSelectionBounds(start, current, mockUnproject)
    assert.ok(result)
    assert.ok(result.west < result.east)
    assert.ok(result.south < result.north)
  })

  it('微小矩形はnullを返す', () => {
    const start = { x: 10, y: 10 }
    const current = { x: 12, y: 12 }
    const result = pixelBoundsToSelectionBounds(start, current, mockUnproject)
    assert.equal(result, null)
  })

  it('unprojectがnullを返す場合はnull', () => {
    const start = { x: -10, y: 10 }
    const current = { x: 100, y: 100 }
    const result = pixelBoundsToSelectionBounds(start, current, mockUnproject)
    assert.equal(result, null)
  })
})
