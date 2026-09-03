/**
 * Map2D Phase 1補強のうち失敗分離・帰属・load後存在チェックの検証テスト。
 * （絶対URL・Cntr・sanitizeの基礎は gsiVectorStyle.test.ts が担う）
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/map2dStyle.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vendoredStyleJson from './gsiVectorStyle.json'
import {
  sanitizeGsiStyle,
  buildFallbackStyle,
  validateStyleUrls,
  classifyMapError,
  getMissingMapContent,
  GSI_ATTRIBUTION_TEXT,
  GSI_LICENSE_URL,
} from './gsiStyle'

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  assert.equal(typeof value, 'object')
  assert.ok(value !== null)
  return value as JsonObject
}

describe('validateStyleUrls', () => {
  it('ベンダーJSONは問題なし', () => {
    assert.deepEqual(validateStyleUrls(asObject(vendoredStyleJson)), [])
  })

  it('相対spriteを検出する', () => {
    const style = asObject(structuredClone(vendoredStyleJson))
    style['sprite'] = '/sprite/std'
    const problems = validateStyleUrls(style)
    assert.ok(problems.some((p) => p.includes('sprite')))
  })

  it('帰属欠落を検出する', () => {
    const style = asObject(structuredClone(vendoredStyleJson))
    const sources = asObject(style['sources'])
    const v = asObject(sources['v'])
    v['attribution'] = 'someone else'
    const problems = validateStyleUrls(style)
    assert.ok(problems.some((p) => p.includes('帰属')))
  })
})

describe('load後のsource/layer存在（モック）', () => {
  it('source:vと全レイヤーがあれば空配列', () => {
    const mapLike = {
      getSource: (id: string): unknown => (id === 'v' ? {} : null),
      getLayer: (id: string): unknown => ({ id }),
    }
    assert.deepEqual(getMissingMapContent(mapLike, ['a', 'b']), [])
  })

  it('欠落があればsource:v・layer:idを列挙する', () => {
    const mapLike = {
      getSource: (_id: string): unknown => null,
      getLayer: (id: string): unknown => (id === 'a' ? {} : null),
    }
    assert.deepEqual(getMissingMapContent(mapLike, ['a', 'b']), ['source:v', 'layer:b'])
  })
})

describe('失敗分離', () => {
  it('sprite/glyphs失敗を分類する', () => {
    assert.equal(classifyMapError('Failed to load sprite image'), 'sprite')
    assert.equal(classifyMapError('glyphs range load error'), 'glyphs')
  })

  it('PBF一時失敗をtilesに分類する', () => {
    assert.equal(
      classifyMapError(
        'Tile load error: https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/12/1/1.pbf',
      ),
      'tiles',
    )
  })

  it('スタイル不備は内蔵最小スタイルに代替できる', () => {
    assert.throws(() => sanitizeGsiStyle({ invalid: true }))
    const fallback = asObject(buildFallbackStyle())
    const sources = asObject(asObject(fallback)['sources'])
    assert.ok(asObject(sources)['v'])
    const layers = fallback['layers']
    assert.ok(Array.isArray(layers))
    const sourceLayers = (layers as unknown[]).map(
      (l): unknown => asObject(l)['source-layer'],
    )
    assert.ok(sourceLayers.includes('RdCL'))
    assert.ok(sourceLayers.includes('AdmBdry'))
    assert.ok(sourceLayers.includes('WA'))
  })
})

describe('attribution（GSI帰属維持）', () => {
  it('帰属テキストとライセンスURLが定義されている', () => {
    assert.ok(GSI_ATTRIBUTION_TEXT.includes('国土地理院'))
    assert.ok(GSI_LICENSE_URL.startsWith('https://'))
  })

  it('sanitize後も帰属が維持される', () => {
    const sanitized = asObject(sanitizeGsiStyle(vendoredStyleJson))
    const sources = asObject(asObject(sanitized)['sources'])
    assert.equal(asObject(asObject(sources)['v'])['attribution'], GSI_ATTRIBUTION_TEXT)
  })
})
