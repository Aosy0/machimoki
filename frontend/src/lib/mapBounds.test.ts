/**
 * mapBounds の単体テスト。
 *
 * - WGS84 decimal degrees の検証
 * - west < east, south < north の保証
 * - 反子午線跨ぎはエラー
 * - 範囲外・NaN・north<=south 拒否
 *
 * 実行: npx tsx --test frontend/src/lib/mapBounds.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSelectionBounds,
  normalizeBounds,
  isAntimeridianCrossing,
  type BoundsInput,
} from './mapBounds'

describe('createSelectionBounds', () => {
  it('正常なboundsを生成できる', () => {
    const bounds = createSelectionBounds(139.0, 35.0, 140.0, 36.0)
    assert.equal(bounds.west, 139.0)
    assert.equal(bounds.south, 35.0)
    assert.equal(bounds.east, 140.0)
    assert.equal(bounds.north, 36.0)
  })

  it('NaNを拒否する', () => {
    assert.throws(() => createSelectionBounds(NaN, 35, 140, 36), /NaN/)
    assert.throws(() => createSelectionBounds(139, NaN, 140, 36), /NaN/)
    assert.throws(() => createSelectionBounds(139, 35, NaN, 36), /NaN/)
    assert.throws(() => createSelectionBounds(139, 35, 140, NaN), /NaN/)
  })

  it('north <= south を拒否する', () => {
    assert.throws(() => createSelectionBounds(139, 36, 140, 36), /north.*south/)
    assert.throws(() => createSelectionBounds(139, 37, 140, 36), /north.*south/)
  })

  it('経度範囲外を拒否する（-180〜180）', () => {
    assert.throws(() => createSelectionBounds(-181, 35, 140, 36), /経度/)
    assert.throws(() => createSelectionBounds(139, 35, 181, 36), /経度/)
  })

  it('緯度範囲外を拒否する（-90〜90）', () => {
    assert.throws(() => createSelectionBounds(139, -91, 140, 36), /緯度/)
    assert.throws(() => createSelectionBounds(139, 35, 140, 91), /緯度/)
  })

  it('反子午線跨ぎ（west > east）を拒否する', () => {
    assert.throws(() => createSelectionBounds(140, 35, 139, 36), /反子午線/)
  })
})

describe('normalizeBounds', () => {
  it('既に正規化されたboundsはそのまま返す', () => {
    const input: BoundsInput = { west: 139, south: 35, east: 140, north: 36 }
    const result = normalizeBounds(input)
    assert.equal(result.west, 139)
    assert.equal(result.south, 35)
    assert.equal(result.east, 140)
    assert.equal(result.north, 36)
  })

  it('west > east の場合はwest/eastを入れ替える', () => {
    const input: BoundsInput = { west: 140, south: 35, east: 139, north: 36 }
    const result = normalizeBounds(input)
    assert.equal(result.west, 139)
    assert.equal(result.east, 140)
  })

  it('south > north の場合はsouth/northを入れ替える', () => {
    const input: BoundsInput = { west: 139, south: 36, east: 140, north: 35 }
    const result = normalizeBounds(input)
    assert.equal(result.south, 35)
    assert.equal(result.north, 36)
  })

  it('NaN はエラー', () => {
    assert.throws(() => normalizeBounds({ west: NaN, south: 35, east: 140, north: 36 }), /NaN/)
  })
})

describe('isAntimeridianCrossing', () => {
  it('west > east で true', () => {
    assert.equal(isAntimeridianCrossing(140, 139), true)
  })

  it('west < east で false', () => {
    assert.equal(isAntimeridianCrossing(139, 140), false)
  })

  it('west == east で false（同一経線）', () => {
    assert.equal(isAntimeridianCrossing(139, 139), false)
  })
})
