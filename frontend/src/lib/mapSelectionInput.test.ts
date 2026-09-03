/**
 * mapSelectionInput（手入力・プリセット・現在表示範囲の変換）のテスト。
 * 集約関数（mapBounds・selectionBounds）経由の判定と互換であること。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/mapSelectionInput.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseManualCoords,
  coercePresetBounds,
  coerceCurrentViewBounds,
} from './mapSelectionInput'

describe('parseManualCoords', () => {
  it('正常な文字列4値をSelectionBounds化する', () => {
    const result = parseManualCoords({
      west: '139.6903',
      south: '35.6997',
      east: '139.6906',
      north: '35.7000',
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.bounds, {
        west: 139.6903,
        south: 35.6997,
        east: 139.6906,
        north: 35.7,
      })
    }
  })

  it('非数値は従来メッセージで拒否する', () => {
    const result = parseManualCoords({
      west: 'abc',
      south: '35.6997',
      east: '139.6906',
      north: '35.7000',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /数値を入力/)
    }
  })

  it('東西・南北の順序不正は従来メッセージで拒否する', () => {
    const reversed = parseManualCoords({
      west: '139.6906',
      south: '35.6997',
      east: '139.6903',
      north: '35.7000',
    })
    assert.equal(reversed.ok, false)
    if (!reversed.ok) {
      assert.match(reversed.error, /西端は東端より/)
    }
    const flat = parseManualCoords({
      west: '139.6903',
      south: '35.7000',
      east: '139.6906',
      north: '35.7000',
    })
    assert.equal(flat.ok, false)
    if (!flat.ok) {
      assert.match(flat.error, /南端は北端より/)
    }
  })

  it('経度範囲外は集約エラーで拒否する（独自変換なし）', () => {
    const result = parseManualCoords({
      west: '-200',
      south: '35.6997',
      east: '139.6906',
      north: '35.7000',
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /経度/)
    }
  })
})

describe('coercePresetBounds', () => {
  it('足立区プリセット相当を通す', () => {
    const bounds = coercePresetBounds({
      west: 139.8053,
      south: 35.747,
      east: 139.808,
      north: 35.7495,
    })
    assert.equal(bounds.west, 139.8053)
    assert.equal(bounds.north, 35.7495)
  })

  it('上限1000km²超のプリセットは例外にする', () => {
    assert.throws(
      () =>
        coercePresetBounds({ west: 139.0, south: 35.0, east: 140.0, north: 36.0 }),
      /広すぎます/,
    )
  })

  it('順序不正のプリセットは例外にする', () => {
    assert.throws(
      () =>
        coercePresetBounds({ west: 140.0, south: 35.0, east: 139.0, north: 36.0 }),
      /./,
    )
  })
})

describe('coerceCurrentViewBounds', () => {
  it('街区サイズの表示範囲を通す（タブ復元相当）', () => {
    const result = coerceCurrentViewBounds({
      west: 139.6903,
      south: 35.6997,
      east: 139.6906,
      north: 35.7,
    })
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.bounds.east, 139.6906)
    }
  })

  it('広すぎる表示範囲は理由文で拒否する（例外にしない）', () => {
    const result = coerceCurrentViewBounds({
      west: 139.0,
      south: 35.0,
      east: 140.0,
      north: 36.0,
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error, /広すぎます/)
    }
  })
})
