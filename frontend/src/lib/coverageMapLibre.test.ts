/**
 * coverageMapLibre（MapLibre側カバレッジ表示）のテスト。
 * LoD5色・ズーム閾値連動・失敗分離（export非ブロック）を検証する。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/coverageMapLibre.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCoverageFillPaint,
  buildCoverageLinePaint,
  coverageTilesTemplate,
  ensureCoverageLayer,
  hasCoverageLayer,
  isCoverageDetailedZoom,
  removeCoverageLayer,
  setCoverageLayerDetailed,
  setCoverageLayerVisible,
  syncCoverageZoom,
  COVERAGE_FILL_LAYER_ID,
  COVERAGE_LINE_LAYER_ID,
  COVERAGE_SOURCE_ID,
  COVERAGE_TILE_URL_TEMPLATE,
  type CoverageMapLike,
} from './coverageMapLibre'
import { LOD_CATEGORY_STYLES } from './coverageCategories'

class FakeMap implements CoverageMapLike {
  sources = new Map<string, unknown>()
  layers = new Map<string, Record<string, unknown>>()
  layout = new Map<string, Map<string, unknown>>()
  paint = new Map<string, Map<string, unknown>>()
  zoom = 12
  isLoaded = true
  failOn: string | null = null

  private maybeFail(op: string): void {
    if (this.failOn === op) {
      throw new Error(`fake failure: ${op}`)
    }
  }

  getSource(id: string): unknown {
    return this.sources.get(id)
  }
  addSource(id: string, source: unknown): void {
    this.maybeFail('addSource')
    this.sources.set(id, source)
  }
  getLayer(id: string): unknown {
    return this.layers.get(id)
  }
  addLayer(layer: unknown): void {
    this.maybeFail('addLayer')
    const record = layer as Record<string, unknown>
    this.layers.set(record['id'] as string, record)
  }
  removeLayer(id: string): void {
    this.layers.delete(id)
  }
  removeSource(id: string): void {
    this.sources.delete(id)
  }
  setLayoutProperty(layerId: string, name: string, value: unknown): void {
    this.maybeFail('setLayoutProperty')
    if (!this.layout.has(layerId)) this.layout.set(layerId, new Map())
    this.layout.get(layerId)?.set(name, value)
  }
  setPaintProperty(layerId: string, name: string, value: unknown): void {
    this.maybeFail('setPaintProperty')
    if (!this.paint.has(layerId)) this.paint.set(layerId, new Map())
    this.paint.get(layerId)?.set(name, value)
  }
  getZoom(): number {
    return this.zoom
  }
  loaded(): boolean {
    return this.isLoaded
  }
  isStyleLoaded(): boolean {
    return this.isLoaded
  }
  once(): void {
    /* テストでは即時発火しない */
  }
}

describe('isCoverageDetailedZoom', () => {
  it('閾値で詳細・未満で簡易になる（BUILDING_OVERLAY_MIN_ZOOM連動）', () => {
    assert.equal(isCoverageDetailedZoom(13, 13), true)
    assert.equal(isCoverageDetailedZoom(12.999, 13), false)
    assert.equal(isCoverageDetailedZoom(16, 13), true)
  })

  it('推定不能時は詳細側に倒す（チラつき防止）', () => {
    assert.equal(isCoverageDetailedZoom(null, 13), true)
    assert.equal(isCoverageDetailedZoom(undefined, 13), true)
    assert.equal(isCoverageDetailedZoom(NaN, 13), true)
  })
})

describe('buildCoverageFillPaint / buildCoverageLinePaint', () => {
  it('詳細paintがLoD5色すべてを含む（二重定義なし）', () => {
    const json = JSON.stringify(buildCoverageFillPaint(true))
    for (const style of Object.values(LOD_CATEGORY_STYLES)) {
      assert.ok(json.includes(style.fill), `fill不足: ${style.fill}`)
    }
    const lineJson = JSON.stringify(buildCoverageLinePaint(true))
    for (const style of Object.values(LOD_CATEGORY_STYLES)) {
      assert.ok(lineJson.includes(style.outline), `outline不足: ${style.outline}`)
    }
  })

  it('簡易paintが二値（透明＋整備ブルー枠・グレー）に倒れる', () => {
    const json = JSON.stringify(buildCoverageFillPaint(false))
    assert.ok(json.includes('rgba(0, 0, 0, 0)'))
    assert.ok(json.includes(LOD_CATEGORY_STYLES.none.fill))
    const lineJson = JSON.stringify(buildCoverageLinePaint(false))
    assert.ok(lineJson.includes('#4fc3f7'))
    assert.ok(lineJson.includes(LOD_CATEGORY_STYLES.none.outline))
  })

  it('詳細paintが旧タイル（lods文字列のみ）でも5色に分離する', () => {
    const json = JSON.stringify(buildCoverageFillPaint(true))
    assert.ok(json.includes('"in"'), 'lods部分一致カスケード不足')
    assert.ok(json.includes('lods'), 'lods参照不足')
    for (const key of ['lod2', 'lod3plus', 'lod4'] as const) {
      assert.ok(json.includes(LOD_CATEGORY_STYLES[key].fill), `fill不足: ${key}`)
    }
    const lineJson = JSON.stringify(buildCoverageLinePaint(true))
    assert.ok(lineJson.includes('"in"'))
    for (const key of ['lod2', 'lod3plus', 'lod4'] as const) {
      assert.ok(lineJson.includes(LOD_CATEGORY_STYLES[key].outline), `outline不足: ${key}`)
    }
  })
})

describe('ensureCoverageLayer', () => {
  it('ソース＋fill/lineの2層を冪等に整備する', () => {
    const map = new FakeMap()
    assert.equal(
      ensureCoverageLayer(map, { visible: true, detailed: true }),
      true,
    )
    assert.ok(map.sources.has(COVERAGE_SOURCE_ID))
    assert.ok(map.layers.has(COVERAGE_FILL_LAYER_ID))
    assert.ok(map.layers.has(COVERAGE_LINE_LAYER_ID))
    assert.equal(hasCoverageLayer(map), true)
    // 2回目は作り直さず成功する
    assert.equal(
      ensureCoverageLayer(map, { visible: false, detailed: false }),
      true,
    )
    assert.equal(map.sources.size, 1)
    assert.equal(map.layers.size, 2)
    assert.equal(map.layout.get(COVERAGE_FILL_LAYER_ID)?.get('visibility'), 'none')
  })

  it('スタイル未読込時はfalseを返し何も作らない', () => {
    const map = new FakeMap()
    map.isLoaded = false
    assert.equal(
      ensureCoverageLayer(map, { visible: true, detailed: true }),
      false,
    )
    assert.equal(hasCoverageLayer(map), false)
  })

  it('タイル読込中でもスタイル読込済みなら層を作る', () => {
    const map = new FakeMap()
    map.loaded = (): boolean => false
    assert.equal(
      ensureCoverageLayer(map, { visible: true, detailed: true }),
      true,
    )
    assert.equal(hasCoverageLayer(map), true)
  })

  it('失敗時はfalseを返し例外を投げない（export非ブロック）', () => {
    const map = new FakeMap()
    map.failOn = 'addSource'
    assert.equal(
      ensureCoverageLayer(map, { visible: true, detailed: true }),
      false,
    )
  })

  it('removeで層とソースを片付ける', () => {
    const map = new FakeMap()
    ensureCoverageLayer(map, { visible: true, detailed: true })
    removeCoverageLayer(map)
    assert.equal(hasCoverageLayer(map), false)
  })

  it('setVisible/setDetailedが例外でも無操作で終える', () => {
    const map = new FakeMap()
    ensureCoverageLayer(map, { visible: true, detailed: true })
    map.failOn = 'setPaintProperty'
    setCoverageLayerDetailed(map, false)
    setCoverageLayerVisible(map, false)
  })

  it('tiles指定時はそのURLでソースを作る（開発時は絶対ベース）', () => {
    const map = new FakeMap()
    const template = coverageTilesTemplate('https://machimoki.aosy.f5.si')
    assert.equal(
      template,
      'https://machimoki.aosy.f5.si/api/coverage/tiles/{z}/{x}/{y}',
    )
    assert.equal(
      ensureCoverageLayer(map, {
        visible: true,
        detailed: true,
        tiles: template,
      }),
      true,
    )
    const source = map.sources.get(COVERAGE_SOURCE_ID) as {
      tiles: string[]
    }
    assert.deepEqual(source.tiles, [template])
  })

  it('tiles未指定時は相対テンプレートを使う（本番）', () => {
    const map = new FakeMap()
    assert.equal(
      coverageTilesTemplate(''),
      '/api/coverage/tiles/{z}/{x}/{y}',
    )
    assert.equal(
      ensureCoverageLayer(map, { visible: true, detailed: true }),
      true,
    )
    const source = map.sources.get(COVERAGE_SOURCE_ID) as {
      tiles: string[]
    }
    assert.deepEqual(source.tiles, [COVERAGE_TILE_URL_TEMPLATE])
  })
})

describe('syncCoverageZoom', () => {
  it('閾値以上で詳細paint・未満で簡易paintになる', () => {
    const map = new FakeMap()
    ensureCoverageLayer(map, { visible: true, detailed: false })
    map.zoom = 14
    assert.equal(syncCoverageZoom(map, true, 13), true)
    const detailed = JSON.stringify(
      map.paint.get(COVERAGE_FILL_LAYER_ID)?.get('fill-color'),
    )
    assert.ok(detailed.includes(LOD_CATEGORY_STYLES.lod4.fill))
    map.zoom = 10
    assert.equal(syncCoverageZoom(map, true, 13), false)
    const simple = JSON.stringify(
      map.paint.get(COVERAGE_FILL_LAYER_ID)?.get('fill-color'),
    )
    assert.ok(simple.includes('rgba(0, 0, 0, 0)'))
  })

  it('レイヤー未整備でも判定だけ返す', () => {
    const map = new FakeMap()
    map.zoom = 15
    assert.equal(syncCoverageZoom(map, true, 13), true)
  })
})
