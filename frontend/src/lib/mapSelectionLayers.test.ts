/**
 * mapSelectionLayers（選択矩形・ピック点のMapLibre表示）のテスト。
 * GeoJSON形状とオーバーレイの冪等性・失敗分離を検証する。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/mapSelectionLayers.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ensurePickOverlay,
  ensureSelectionOverlay,
  pickPointsToFeatureCollection,
  selectionBoundsToPolygon,
  PICK_LAYER_ID,
  PICK_SOURCE_ID,
  SELECTION_FILL_LAYER_ID,
  SELECTION_LINE_LAYER_ID,
  SELECTION_SOURCE_ID,
  type OverlayMapLike,
} from './mapSelectionLayers'

/**
 * MapLibreのGeoJSONSource相当（setDataはthisを使うプロトタイプメソッド）。
 * 切り離し呼び出しでは例外になる実挙動を再現するための忠実なモック。
 */
class FakeGeoJSONSource {
  setDataCalls: unknown[] = []
  spec: unknown
  failSetData = false
  constructor(spec: unknown) {
    this.spec = spec
  }
  setData(data: unknown): void {
    if (this.failSetData) {
      throw new Error('fake setData failure')
    }
    this.setDataCalls.push(data)
  }
}

class FakeMap implements OverlayMapLike {
  sources = new Map<string, FakeGeoJSONSource>()
  layers = new Map<string, unknown>()
  failOn: string | null = null

  getSource(id: string): unknown {
    const entry = this.sources.get(id)
    if (!entry) return undefined
    entry.failSetData = this.failOn === 'setData'
    // 実Mapと同様にソース実体そのものを返す（メソッド呼び出し形式を保つこと）
    return entry
  }
  addSource(id: string, source: unknown): void {
    if (this.failOn === 'addSource') {
      throw new Error('fake addSource failure')
    }
    this.sources.set(id, new FakeGeoJSONSource(source))
  }
  getLayer(id: string): unknown {
    return this.layers.get(id)
  }
  addLayer(layer: unknown): void {
    const record = layer as Record<string, unknown>
    this.layers.set(record['id'] as string, layer)
  }
  removeLayer(id: string): void {
    this.layers.delete(id)
  }
  removeSource(id: string): void {
    this.sources.delete(id)
  }
}

describe('selectionBoundsToPolygon', () => {
  it('閉環・[lng,lat]順のPolygonを返す', () => {
    const feature = selectionBoundsToPolygon({
      west: 139.69,
      south: 35.699,
      east: 139.691,
      north: 35.7,
    })
    const geometry = feature['geometry'] as {
      type: string
      coordinates: number[][][]
    }
    assert.equal(geometry.type, 'Polygon')
    assert.deepEqual(geometry.coordinates, [
      [
        [139.69, 35.699],
        [139.691, 35.699],
        [139.691, 35.7],
        [139.69, 35.7],
        [139.69, 35.699],
      ],
    ])
  })
})

describe('pickPointsToFeatureCollection', () => {
  it('点群をPoint集約にする', () => {
    const collection = pickPointsToFeatureCollection([
      { lon: 139.69, lat: 35.7 },
      { lon: 139.691, lat: 35.701 },
    ])
    const features = collection['features'] as Array<{
      geometry: { type: string; coordinates: number[] }
    }>
    assert.equal(features.length, 2)
    assert.equal(features[0].geometry.type, 'Point')
    assert.deepEqual(features[0].geometry.coordinates, [139.69, 35.7])
  })

  it('空配列は空集約にする', () => {
    const collection = pickPointsToFeatureCollection([])
    assert.deepEqual(collection['features'], [])
  })
})

describe('ensureSelectionOverlay', () => {
  it('初回はソース＋2層を作り、2回目はsetData更新のみにする', () => {
    const map = new FakeMap()
    const bounds = { west: 139.69, south: 35.699, east: 139.691, north: 35.7 }
    ensureSelectionOverlay(map, bounds)
    assert.ok(map.sources.has(SELECTION_SOURCE_ID))
    assert.ok(map.layers.has(SELECTION_FILL_LAYER_ID))
    assert.ok(map.layers.has(SELECTION_LINE_LAYER_ID))
    ensureSelectionOverlay(map, { ...bounds, east: 139.692 })
    assert.equal(map.sources.size, 1)
    assert.equal(map.layers.size, 2)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 1)
  })

  it('2回目の更新内容が新しい範囲を反映する（再選択の置き換え）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, { west: 139.69, south: 35.699, east: 139.691, north: 35.7 })
    const next = { west: 139.65, south: 35.68, east: 139.66, north: 35.69 }
    ensureSelectionOverlay(map, next)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.deepEqual(entry?.setDataCalls[0], selectionBoundsToPolygon(next))
  })

  it('nullで除去する（タブ切替・選択解除の復元相当）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, {
      west: 139.69,
      south: 35.699,
      east: 139.691,
      north: 35.7,
    })
    ensureSelectionOverlay(map, null)
    assert.equal(map.sources.size, 0)
    assert.equal(map.layers.size, 0)
  })

  it('失敗時は例外を投げない', () => {
    const map = new FakeMap()
    map.failOn = 'addSource'
    ensureSelectionOverlay(map, {
      west: 139.69,
      south: 35.699,
      east: 139.691,
      north: 35.7,
    })
    map.failOn = 'setData'
    ensureSelectionOverlay(map, {
      west: 139.69,
      south: 35.699,
      east: 139.691,
      north: 35.7,
    })
  })
})

describe('ensurePickOverlay', () => {
  it('点群をソース＋circle層に反映し、空で除去する', () => {
    const map = new FakeMap()
    ensurePickOverlay(map, [{ lon: 139.69, lat: 35.7 }])
    assert.ok(map.sources.has(PICK_SOURCE_ID))
    assert.ok(map.layers.has(PICK_LAYER_ID))
    ensurePickOverlay(map, [])
    assert.equal(map.sources.size, 0)
    assert.equal(map.layers.size, 0)
  })

  it('2回目はsetDataで点群を置き換える', () => {
    const map = new FakeMap()
    ensurePickOverlay(map, [{ lon: 139.69, lat: 35.7 }])
    const next = [
      { lon: 139.7, lat: 35.71 },
      { lon: 139.701, lat: 35.711 },
    ]
    ensurePickOverlay(map, next)
    const entry = map.sources.get(PICK_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.deepEqual(entry?.setDataCalls[0], pickPointsToFeatureCollection(next))
  })
})
