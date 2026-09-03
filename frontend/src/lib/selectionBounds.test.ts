/**
 * selectionBounds（WGS84変換・検証の単一集約点）のテスト。
 * Cesium経路の判定（上限1000km²・書式）と互換であること。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/selectionBounds.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundsFromLngLat,
  validateSelectionBounds,
  selectionAreaKm2,
  MAX_SELECTION_AREA_KM2,
} from './selectionBounds'

describe('boundsFromLngLat', () => {
  it('順序を正規化してwest<east・south<northにする', () => {
    const result = boundsFromLngLat({ lng: 139.7, lat: 35.7 }, { lng: 139.69, lat: 35.69 })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.bounds, { west: 139.69, south: 35.69, east: 139.7, north: 35.7 })
    }
  })

  it('NaNを拒否する', () => {
    const result = boundsFromLngLat({ lng: NaN, lat: 35.7 }, { lng: 139.7, lat: 35.69 })
    assert.equal(result.ok, false)
  })

  it('north<=south（高さゼロ）を拒否する', () => {
    const result = boundsFromLngLat({ lng: 139.69, lat: 35.7 }, { lng: 139.7, lat: 35.7 })
    assert.equal(result.ok, false)
  })

  it('反子午線（幅180度超）は非対応エラーにする', () => {
    const result = boundsFromLngLat({ lng: 179.9, lat: 35.0 }, { lng: -179.9, lat: 35.1 })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /子午線/)
    }
  })
})

describe('validateSelectionBounds', () => {
  it('通常の街区サイズは正常', () => {
    assert.equal(
      validateSelectionBounds({ west: 139.69, south: 35.699, east: 139.691, north: 35.7 }),
      null,
    )
  })

  it('上限超過はCesium互換メッセージで拒否する', () => {
    const error = validateSelectionBounds({ west: 139.0, south: 35.0, east: 140.0, north: 36.0 })
    assert.ok(error)
    assert.match(error as string, /広すぎます/)
    assert.match(error as string, /1000km/)
  })

  it('上限定数は1000である', () => {
    assert.equal(MAX_SELECTION_AREA_KM2, 1000)
  })

  it('面積はCesium経路と同式（半径6371000mの等距換算）である', () => {
    const area = selectionAreaKm2({ west: 139.69, south: 35.69, east: 139.7, north: 35.7 })
    assert.ok(area > 1.0 && area < 1.5)
  })
})
