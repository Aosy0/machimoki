/**
 * OpenPOI検索結果の並べ替えロジックの単体検証。
 *
 * 実行方法:
 *   npx tsx --test src/lib/poiSearch.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nameMatchRank, categoryRank, sortOpenPoiHits, filterAddressTitles } from './poiSearch'
import type { PoiHit } from './poiSearch'

function hit(name: string, category?: string, id = name): PoiHit {
  return {
    id,
    kind: 'facility',
    name,
    address: '',
    lat: 35.68,
    lng: 139.69,
    source: 'openpoi',
    category,
  }
}

describe('nameMatchRank', () => {
  it('完全一致 < 前方一致 < 部分一致 < その他', () => {
    assert.equal(nameMatchRank('東京駅', '東京駅'), 0)
    assert.equal(nameMatchRank('東京駅 JPタワー', '東京駅'), 1)
    assert.equal(nameMatchRank('JR東京駅前', '東京駅'), 2)
    assert.equal(nameMatchRank('丸の内', '東京駅'), 3)
  })
})

describe('categoryRank', () => {
  it('unknown/未設定は中立(1)', () => {
    assert.equal(categoryRank(undefined), 1)
    assert.equal(categoryRank('unknown'), 1)
  })

  it('代表カテゴリは0、商業系は2', () => {
    assert.equal(categoryRank('transit'), 0)
    assert.equal(categoryRank('education'), 0)
    assert.equal(categoryRank('tourism'), 2)
    assert.equal(categoryRank('service_other'), 2)
  })
})

describe('sortOpenPoiHits', () => {
  it('完全一致が前方一致より上位（東京駅が先頭）', () => {
    const input = [
      hit('東京駅動輪の広場', 'unknown'),
      hit('東京駅八重洲の熟女キャバクラ・エース', 'tourism'),
      hit('東京駅', 'service_other'),
      hit('東京駅 JPタワー', 'retail_other'),
    ]
    const sorted = sortOpenPoiHits(input, '東京駅')
    assert.equal(sorted[0].name, '東京駅')
  })

  it('同一名称一致ランク内では代表カテゴリが上位', () => {
    const input = [
      hit('東京駅 商業施設', 'retail_other'),
      hit('東京駅 案内所', 'transit'),
      hit('東京駅 未分類', 'unknown'),
    ]
    const sorted = sortOpenPoiHits(input, '東京駅')
    assert.deepEqual(
      sorted.map((h) => h.name),
      ['東京駅 案内所', '東京駅 未分類', '東京駅 商業施設'],
    )
  })

  it('同点は元の順序を維持する（安定ソート）', () => {
    const a = hit('東京駅 同じ', 'unknown', 'A')
    const b = hit('東京駅 同じ', 'unknown', 'B')
    const sorted = sortOpenPoiHits([a, b], '東京駅')
    assert.deepEqual(
      sorted.map((h) => h.id),
      ['A', 'B'],
    )
  })
})

describe('filterAddressTitles', () => {
  it('クエリを含まない無関係な地域を除外する', () => {
    const titles = ['北海道札幌市東区', '東京駅', '東京都新宿区西新宿二丁目8番']
    assert.deepEqual(filterAddressTitles(titles, '東京駅'), ['東京駅'])
  })

  it('クエリを含む住所は残る（全角/空白も正規化）', () => {
    const titles = ['東京都新宿区西新宿二丁目８番', '新宿区西新宿']
    assert.deepEqual(filterAddressTitles(titles, '新宿区西新宿'), titles)
  })

  it('全件除外になるクエリではフィルタ前の配列を返す（フォールバック）', () => {
    const titles = ['北海道札幌市東区', '秋田県大館市東']
    assert.deepEqual(filterAddressTitles(titles, '東京駅'), titles)
  })
})
