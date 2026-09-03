/**
 * coverageCategories の単体テスト（Cesium 非依存の pure 関数のみ対象）。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/coverageCategories.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOD_CATEGORY_STYLES,
  maxLodToCategory,
  parseLodsString,
  resolveLodCategory,
} from './coverageCategories'

describe('parseLodsString', () => {
  it('空文字は空配列を返す（建物なし）', () => {
    assert.deepEqual(parseLodsString(''), [])
  })

  it('単一LoDをパースする', () => {
    assert.deepEqual(parseLodsString('lod1'), [1])
    assert.deepEqual(parseLodsString('lod4'), [4])
  })

  it('複数LoDをパースする', () => {
    assert.deepEqual(parseLodsString('lod1,lod2'), [1, 2])
  })

  it('順不同でもソートして返す', () => {
    assert.deepEqual(parseLodsString('lod3,lod1'), [1, 3])
  })

  it('空白・大文字ゆれを許容する', () => {
    assert.deepEqual(parseLodsString(' Lod1 , LOD2 '), [1, 2])
  })

  it('重複は除去する', () => {
    assert.deepEqual(parseLodsString('lod2,lod2,lod1'), [1, 2])
  })

  it('不正トークンは無視する', () => {
    assert.deepEqual(parseLodsString('lod0,lod5,lod,foo,,lod3'), [3])
  })

  it('非文字列は空配列を返す', () => {
    assert.deepEqual(parseLodsString(undefined), [])
    assert.deepEqual(parseLodsString(null), [])
    assert.deepEqual(parseLodsString(123), [])
    assert.deepEqual(parseLodsString(['lod1']), [])
  })
})

describe('maxLodToCategory', () => {
  it('null は none', () => {
    assert.equal(maxLodToCategory(null), 'none')
  })

  it('1→lod1・2→lod2・3→lod3plus・4→lod4', () => {
    assert.equal(maxLodToCategory(1), 'lod1')
    assert.equal(maxLodToCategory(2), 'lod2')
    assert.equal(maxLodToCategory(3), 'lod3plus')
    assert.equal(maxLodToCategory(4), 'lod4')
  })

  it('範囲外は none 側・lod4 側に丸める', () => {
    assert.equal(maxLodToCategory(0), 'none')
    assert.equal(maxLodToCategory(9), 'lod4')
  })
})

describe('resolveLodCategory', () => {
  it('lods から最大LoDを解決する', () => {
    assert.equal(resolveLodCategory({ lods: 'lod1,lod2' }), 'lod2')
    assert.equal(resolveLodCategory({ lods: 'lod3' }), 'lod3plus')
    assert.equal(resolveLodCategory({ lods: 'lod1,lod2,lod3,lod4' }), 'lod4')
    assert.equal(resolveLodCategory({ lods: '' }), 'none')
  })

  it('lods 欠落時は covered===1 なら lod1 フォールバック', () => {
    assert.equal(resolveLodCategory({ covered: 1 }), 'lod1')
    assert.equal(resolveLodCategory({ covered: '1' }), 'lod1')
    assert.equal(resolveLodCategory({ covered: true }), 'lod1')
    assert.equal(resolveLodCategory({ covered: 0 }), 'none')
    assert.equal(resolveLodCategory({}), 'none')
    assert.equal(resolveLodCategory(undefined), 'none')
  })
})

describe('LOD_CATEGORY_STYLES', () => {
  it('5カテゴリ全てに fill/outline/label がある', () => {
    const keys = Object.keys(LOD_CATEGORY_STYLES).sort()
    assert.deepEqual(keys, ['lod1', 'lod2', 'lod3plus', 'lod4', 'none'])
    for (const key of keys) {
      const style = LOD_CATEGORY_STYLES[key as keyof typeof LOD_CATEGORY_STYLES]
      assert.ok(style.fill.length > 0)
      assert.ok(style.outline.length > 0)
      assert.ok(style.label.length > 0)
    }
  })
})
