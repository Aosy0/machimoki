/**
 * mapSelectionLayers（選択矩形・ハンドル・ホバー・ピック点のMapLibre表示）のテスト。
 * 選択系が単一ソースへ原子的に反映されること・GeoJSON形状・失敗分離を検証する。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/mapSelectionLayers.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  ensurePickOverlay,
  ensureSelectionHover,
  ensureSelectionOverlay,
  isCornerHandle,
  pickPointsToFeatureCollection,
  removeSelectionOverlay,
  selectionBoundsToPolygon,
  selectionHandlePoints,
  selectionOverlayToFeatureCollection,
  PICK_LAYER_ID,
  PICK_SOURCE_ID,
  SELECTION_CAPSULE_LENGTH_PX,
  SELECTION_CAPSULE_PIXEL_RATIO,
  SELECTION_CAPSULE_STROKE_PX,
  SELECTION_CAPSULE_WIDTH_PX,
  SELECTION_CORNER_RADIUS,
  SELECTION_EDGE_HANDLES_LAYER_ID,
  SELECTION_FILL_LAYER_ID,
  SELECTION_HANDLES_LAYER_ID,
  SELECTION_HANDLE_FILL_COLOR,
  SELECTION_HANDLE_HOVER_FILL_COLOR,
  SELECTION_HANDLE_HOVER_IMAGE_H_ID,
  SELECTION_HANDLE_HOVER_IMAGE_V_ID,
  SELECTION_HANDLE_HOVER_STROKE_COLOR,
  SELECTION_HANDLE_IMAGE_H_ID,
  SELECTION_HANDLE_IMAGE_V_ID,
  SELECTION_HANDLE_STROKE_COLOR,
  SELECTION_HOVER_CIRCLE_LAYER_ID,
  SELECTION_HOVER_CORNER_RADIUS,
  SELECTION_HOVER_ICON_SIZE,
  SELECTION_HOVER_SYMBOL_LAYER_ID,
  SELECTION_LINE_LAYER_ID,
  SELECTION_SOURCE_ID,
  type OverlayMapLike,
} from './mapSelectionLayers'
import type { ResizeHandle } from './mapSelectionResize'

type FeatureLike = {
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}

/** FCのfeaturesを取り出す。 */
function featuresOf(fc: unknown): FeatureLike[] {
  return (fc as { features: FeatureLike[] }).features
}

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
  images = new Map<string, { image: unknown; options: unknown }>()
  failOn: string | null = null
  /** 設定時のみ持つ（未設定＝全表示モック）。 */
  project?: (point: [number, number]) => { x: number; y: number }

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
  hasImage(id: string): unknown {
    return this.images.has(id)
  }
  addImage(id: string, image: unknown, options?: unknown): void {
    if (this.failOn === 'addImage') {
      throw new Error('fake addImage failure')
    }
    this.images.set(id, { image, options })
  }
}

/** 記録用2Dコンテキスト（カプセル描画の検証用）。 */
interface RecordedCall {
  name: string
  args: unknown[]
}

function createRecordingContext(): { ctx: CanvasRenderingContext2D; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: (): void => {
      calls.push({ name: 'beginPath', args: [] })
    },
    moveTo: (x: number, y: number): void => {
      calls.push({ name: 'moveTo', args: [x, y] })
    },
    lineTo: (x: number, y: number): void => {
      calls.push({ name: 'lineTo', args: [x, y] })
    },
    arc: (x: number, y: number, radius: number, start: number, end: number): void => {
      calls.push({ name: 'arc', args: [x, y, radius, start, end] })
    },
    closePath: (): void => {
      calls.push({ name: 'closePath', args: [] })
    },
    fill: (): void => {
      calls.push({ name: 'fill', args: [] })
    },
    stroke: (): void => {
      calls.push({ name: 'stroke', args: [] })
    },
    translate: (x: number, y: number): void => {
      calls.push({ name: 'translate', args: [x, y] })
    },
    rotate: (angle: number): void => {
      calls.push({ name: 'rotate', args: [angle] })
    },
    getImageData: (x: number, y: number, w: number, h: number): ImageData => {
      calls.push({ name: 'getImageData', args: [x, y, w, h] })
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

/** documentスタブ用の偽キャンバス。寸法と記録用ctxを持つ。 */
interface FakeCanvas {
  width: number
  height: number
  ctx: CanvasRenderingContext2D
  getContext(kind: string): CanvasRenderingContext2D | null
}

/** 生成キャンバスの記録。 */
interface CanvasRecord {
  canvas: FakeCanvas
  calls: RecordedCall[]
}

function createFakeCanvas(records: CanvasRecord[]): FakeCanvas {
  const { ctx, calls } = createRecordingContext()
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    ctx,
    getContext: (kind: string): CanvasRenderingContext2D | null => {
      assert.equal(kind, '2d')
      return ctx
    },
  }
  records.push({ canvas, calls })
  return canvas
}

/** documentスタブ下で実行し、生成キャンバスと描画記録を渡す。 */
function withDocumentStub(run: (records: CanvasRecord[]) => void): void {
  const holder = globalThis as { document?: unknown }
  const prev = holder.document
  const records: CanvasRecord[] = []
  holder.document = {
    createElement: (tag: string): FakeCanvas => {
      assert.equal(tag, 'canvas')
      return createFakeCanvas(records)
    },
  }
  try {
    run(records)
  } finally {
    if (prev === undefined) {
      delete holder.document
    } else {
      holder.document = prev
    }
  }
}

const BOUNDS = { west: 139.69, south: 35.699, east: 139.691, north: 35.7 }

describe('selectionBoundsToPolygon', () => {
  it('閉環・[lng,lat]順のPolygonをrole:areaつきで返す', () => {
    const feature = selectionBoundsToPolygon({
      west: 139.69,
      south: 35.699,
      east: 139.691,
      north: 35.7,
    })
    assert.deepEqual(feature['properties'], { role: 'area' })
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

describe('selectionOverlayToFeatureCollection', () => {
  it('area＋8ハンドルを含み、hover=nullではhoverを含めない', () => {
    const features = featuresOf(selectionOverlayToFeatureCollection(BOUNDS, null))
    assert.equal(features.length, 9)
    assert.deepEqual(features[0].properties, { role: 'area' })
    const handles = features.filter((feature) => feature.properties['role'] === 'handle')
    assert.equal(handles.length, 8)
    for (const feature of handles) {
      const handle = feature.properties['handle'] as ResizeHandle
      assert.equal(feature.geometry.type, 'Point')
      assert.equal(feature.properties['corner'], isCornerHandle(handle))
    }
    assert.equal(features.filter((feature) => feature.properties['role'] === 'hover').length, 0)
  })

  it('辺hoverは中点にrole=hover・kind=edgeで入る', () => {
    const features = featuresOf(selectionOverlayToFeatureCollection(BOUNDS, 'north'))
    assert.equal(features.length, 10)
    assert.deepEqual(features[features.length - 1].properties, {
      role: 'hover',
      kind: 'edge',
      handle: 'north',
    })
    assert.deepEqual(features[features.length - 1].geometry.coordinates, [139.6905, 35.7])
  })

  it('角hoverは角点にrole=hover・kind=cornerで入る', () => {
    const features = featuresOf(selectionOverlayToFeatureCollection(BOUNDS, 'nw'))
    assert.deepEqual(features[features.length - 1].properties, {
      role: 'hover',
      kind: 'corner',
      handle: 'nw',
    })
    assert.deepEqual(features[features.length - 1].geometry.coordinates, [139.69, 35.7])
  })

  it('visibility指定で非表示ハンドルを除外する（矩形・ホバーは残る）', () => {
    const features = featuresOf(
      selectionOverlayToFeatureCollection(BOUNDS, 'north', {
        corners: true,
        edges: { north: true, east: false, south: false, west: false },
      }),
    )
    // area＋隅4＋北1＋hover1
    assert.equal(features.length, 7)
    const handles = features.filter((feature) => feature.properties['role'] === 'handle')
    assert.equal(handles.length, 5)
    const shown = handles.map((feature) => feature.properties['handle']).sort()
    assert.deepEqual(shown, ['ne', 'north', 'nw', 'se', 'sw'])
    const hovers = features.filter((feature) => feature.properties['role'] === 'hover')
    assert.equal(hovers.length, 1)
  })

  it('全非表示でもホバーは含める（ドラッグ中のアクティブ表示用）', () => {
    const features = featuresOf(
      selectionOverlayToFeatureCollection(BOUNDS, 'se', {
        corners: false,
        edges: { north: false, east: false, south: false, west: false },
      }),
    )
    assert.equal(features.length, 2)
    assert.deepEqual(features[0].properties, { role: 'area' })
    assert.deepEqual(features[1].properties, { role: 'hover', kind: 'corner', handle: 'se' })
  })

  it('visibility省略時は全表示（従来どおり）', () => {
    const features = featuresOf(selectionOverlayToFeatureCollection(BOUNDS, null))
    assert.equal(features.length, 9)
  })
})

describe('ensureSelectionOverlay', () => {
  it('初回は単一ソース＋6層を作り、2回目はsetData更新のみ', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    assert.equal(map.sources.size, 1)
    assert.ok(map.sources.has(SELECTION_SOURCE_ID))
    assert.equal(map.layers.size, 6)
    assert.deepEqual(
      [...map.layers.keys()],
      [
        SELECTION_FILL_LAYER_ID,
        SELECTION_LINE_LAYER_ID,
        SELECTION_HANDLES_LAYER_ID,
        SELECTION_EDGE_HANDLES_LAYER_ID,
        SELECTION_HOVER_SYMBOL_LAYER_ID,
        SELECTION_HOVER_CIRCLE_LAYER_ID,
      ],
    )
    const next = { ...BOUNDS, east: 139.692 }
    ensureSelectionOverlay(map, next)
    assert.equal(map.sources.size, 1)
    assert.equal(map.layers.size, 6)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.deepEqual(entry?.setDataCalls[0], selectionOverlayToFeatureCollection(next, null))
  })

  it('hoverHandleを渡すとhover込みのFCを同一ソースへsetDataする', () => {
    const map = new FakeMap()
    // 初回はaddSourceにデータが入るため、2回目（setData経路）で検証する
    ensureSelectionOverlay(map, BOUNDS)
    ensureSelectionOverlay(map, BOUNDS, 'east')
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.deepEqual(entry?.setDataCalls[0], selectionOverlayToFeatureCollection(BOUNDS, 'east'))
  })

  it('projectありモックでは極小矩形のハンドルを間引く（ホバーは残る）', () => {
    const map = new FakeMap()
    map.project = ([lng, lat]: [number, number]): { x: number; y: number } => ({ x: lng, y: lat })
    // 10×10px相当→ハンドル全非表示。hover指定あり。
    ensureSelectionOverlay(map, { west: 0, south: 0, east: 10, north: 10 }, 'nw')
    const spec = map.sources.get(SELECTION_SOURCE_ID)?.spec as { data: unknown }
    const features = featuresOf(spec.data)
    assert.equal(features.length, 2)
    assert.deepEqual(features[0].properties, { role: 'area' })
    assert.deepEqual(features[1].properties, { role: 'hover', kind: 'corner', handle: 'nw' })
  })

  it('projectありモックでも通常サイズは全表示', () => {
    const map = new FakeMap()
    map.project = ([lng, lat]: [number, number]): { x: number; y: number } => ({ x: lng, y: lat })
    ensureSelectionOverlay(map, { west: 0, south: 0, east: 100, north: 100 })
    const spec = map.sources.get(SELECTION_SOURCE_ID)?.spec as { data: unknown }
    const features = featuresOf(spec.data)
    assert.equal(features.length, 9)
  })

  it('projectなしモックでは極小でも全表示のまま', () => {
    const map = new FakeMap()
    assert.equal(map.project, undefined)
    ensureSelectionOverlay(map, { west: 0, south: 0, east: 10, north: 10 })
    const spec = map.sources.get(SELECTION_SOURCE_ID)?.spec as { data: unknown }
    assert.equal(featuresOf(spec.data).length, 9)
  })

  it('nullで全レイヤー・単一ソースを除去する', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS, 'nw')
    ensureSelectionOverlay(map, null)
    assert.equal(map.sources.size, 0)
    assert.equal(map.layers.size, 0)
  })

  it('失敗時は例外を投げない', () => {
    const map = new FakeMap()
    map.failOn = 'addSource'
    ensureSelectionOverlay(map, BOUNDS)
    map.failOn = 'setData'
    ensureSelectionOverlay(map, BOUNDS)
  })

  it('各レイヤーはroleで正しく振り分けるフィルタを持つ', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const fill = map.layers.get(SELECTION_FILL_LAYER_ID) as { filter: unknown }
    const line = map.layers.get(SELECTION_LINE_LAYER_ID) as { filter: unknown }
    assert.deepEqual(fill.filter, ['==', ['get', 'role'], 'area'])
    assert.deepEqual(line.filter, ['==', ['get', 'role'], 'area'])

    const corners = map.layers.get(SELECTION_HANDLES_LAYER_ID) as {
      type: string
      filter: unknown
      paint: Record<string, unknown>
    }
    assert.equal(corners.type, 'circle')
    assert.deepEqual(corners.filter, [
      'all',
      ['==', ['get', 'role'], 'handle'],
      ['==', ['get', 'corner'], true],
    ])
    assert.equal(corners.paint['circle-radius'], SELECTION_CORNER_RADIUS)

    const edges = map.layers.get(SELECTION_EDGE_HANDLES_LAYER_ID) as {
      type: string
      filter: unknown
      layout: Record<string, unknown>
    }
    assert.equal(edges.type, 'symbol')
    assert.deepEqual(edges.filter, [
      'all',
      ['==', ['get', 'role'], 'handle'],
      ['==', ['get', 'corner'], false],
    ])
    assert.deepEqual(edges.layout['icon-image'], [
      'match',
      ['get', 'handle'],
      'north',
      SELECTION_HANDLE_IMAGE_H_ID,
      'south',
      SELECTION_HANDLE_IMAGE_H_ID,
      SELECTION_HANDLE_IMAGE_V_ID,
    ])
    assert.equal(edges.layout['icon-size'], 1)
    assert.equal(edges.layout['icon-rotation-alignment'], 'map')
    assert.equal(edges.layout['icon-allow-overlap'], true)
    assert.equal(edges.layout['icon-ignore-placement'], true)

    const hoverSymbol = map.layers.get(SELECTION_HOVER_SYMBOL_LAYER_ID) as {
      type: string
      filter: unknown
      layout: Record<string, unknown>
    }
    assert.equal(hoverSymbol.type, 'symbol')
    assert.deepEqual(hoverSymbol.filter, [
      'all',
      ['==', ['get', 'role'], 'hover'],
      ['==', ['get', 'kind'], 'edge'],
    ])
    assert.deepEqual(hoverSymbol.layout['icon-image'], [
      'match',
      ['get', 'handle'],
      'north',
      SELECTION_HANDLE_HOVER_IMAGE_H_ID,
      'south',
      SELECTION_HANDLE_HOVER_IMAGE_H_ID,
      SELECTION_HANDLE_HOVER_IMAGE_V_ID,
    ])
    assert.equal(hoverSymbol.layout['icon-size'], SELECTION_HOVER_ICON_SIZE)
    assert.ok(SELECTION_HOVER_ICON_SIZE > 1)

    const hoverCircle = map.layers.get(SELECTION_HOVER_CIRCLE_LAYER_ID) as {
      type: string
      filter: unknown
      paint: Record<string, unknown>
    }
    assert.equal(hoverCircle.type, 'circle')
    assert.deepEqual(hoverCircle.filter, [
      'all',
      ['==', ['get', 'role'], 'hover'],
      ['==', ['get', 'kind'], 'corner'],
    ])
    assert.equal(hoverCircle.paint['circle-color'], SELECTION_HANDLE_HOVER_FILL_COLOR)
    assert.equal(hoverCircle.paint['circle-stroke-color'], SELECTION_HANDLE_HOVER_STROKE_COLOR)
    assert.equal(hoverCircle.paint['circle-radius'], SELECTION_HOVER_CORNER_RADIUS)
    assert.ok(SELECTION_HOVER_CORNER_RADIUS > SELECTION_CORNER_RADIUS)
  })
})

describe('選択オーバーレイの差分キャッシュ', () => {
  it('同一bounds・同一可視性の2回目はsetDataしない', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    ensureSelectionOverlay(map, BOUNDS)
    assert.equal(entry?.setDataCalls.length, 0)
  })

  it('projectの可視性が変わるとsetDataする（ズーム相当）', () => {
    const map = new FakeMap()
    let scale = 1
    map.project = ([lng, lat]: [number, number]): { x: number; y: number } => ({
      x: lng * scale,
      y: lat * scale,
    })
    const bounds = { west: 0, south: 0, east: 10, north: 10 }
    ensureSelectionOverlay(map, bounds)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    // 10px四方→ハンドル非表示（areaのみ）
    const spec = entry?.spec as { data: unknown }
    assert.equal(featuresOf(spec.data).length, 1)
    // ズームイン相当: 100px四方→全表示。可視性が変わったのでsetDataされる
    scale = 10
    ensureSelectionOverlay(map, bounds)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.equal(featuresOf(entry?.setDataCalls[0]).length, 9)
  })

  it('レイヤー欠損時はソースが存在しても作り直す', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    map.removeLayer(SELECTION_FILL_LAYER_ID)
    assert.ok(!map.layers.has(SELECTION_FILL_LAYER_ID))
    ensureSelectionOverlay(map, BOUNDS)
    assert.ok(map.layers.has(SELECTION_FILL_LAYER_ID))
    assert.equal(map.layers.size, 6)
    assert.equal(entry?.setDataCalls.length, 1)
  })

  it('removeSelectionOverlay後はキャッシュが消え再作成される', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    removeSelectionOverlay(map)
    assert.equal(map.sources.size, 0)
    assert.equal(map.layers.size, 0)
    ensureSelectionOverlay(map, BOUNDS)
    assert.ok(map.sources.has(SELECTION_SOURCE_ID))
    assert.equal(map.layers.size, 6)
  })
})

describe('辺中点カプセル画像の登録', () => {
  it('通常2枚＋ホバー2枚をpixelRatioつきで登録する', () => {
    withDocumentStub((records) => {
      const map = new FakeMap()
      ensureSelectionOverlay(map, BOUNDS)
      assert.equal(records.length, 4)
      // 通常（水平→垂直）→ホバー（水平→垂直）の順
      assert.equal(
        records[0].canvas.width,
        SELECTION_CAPSULE_LENGTH_PX * SELECTION_CAPSULE_PIXEL_RATIO,
      )
      assert.equal(
        records[0].canvas.height,
        SELECTION_CAPSULE_WIDTH_PX * SELECTION_CAPSULE_PIXEL_RATIO,
      )
      assert.equal(
        records[1].canvas.width,
        SELECTION_CAPSULE_WIDTH_PX * SELECTION_CAPSULE_PIXEL_RATIO,
      )
      assert.equal(
        records[1].canvas.height,
        SELECTION_CAPSULE_LENGTH_PX * SELECTION_CAPSULE_PIXEL_RATIO,
      )
      // addImageにはcanvas要素ではなくImageData相当を渡す（MapLibreが受け付ける形）
      for (const id of [
        SELECTION_HANDLE_IMAGE_H_ID,
        SELECTION_HANDLE_IMAGE_V_ID,
        SELECTION_HANDLE_HOVER_IMAGE_H_ID,
        SELECTION_HANDLE_HOVER_IMAGE_V_ID,
      ]) {
        const entry = map.images.get(id)
        const image = entry?.image as { width: number; height: number; data: Uint8ClampedArray }
        assert.ok(image)
        assert.ok(image.width > 0 && image.height > 0)
        assert.ok(image.data instanceof Uint8ClampedArray)
        assert.equal(image.data.length, image.width * image.height * 4)
        assert.deepEqual(entry?.options, { pixelRatio: SELECTION_CAPSULE_PIXEL_RATIO })
      }
    })
  })

  it('端は完全な半円で、通常=白fill／ホバー=反転fillにする', () => {
    withDocumentStub((records) => {
      const map = new FakeMap()
      ensureSelectionOverlay(map, BOUNDS)
      // 弧の半径 = 太さ/2 − 線幅/2（device px）。両端とも同じ=半円。
      const expectedRadius =
        (SELECTION_CAPSULE_WIDTH_PX * SELECTION_CAPSULE_PIXEL_RATIO) / 2 -
        (SELECTION_CAPSULE_STROKE_PX * SELECTION_CAPSULE_PIXEL_RATIO) / 2
      for (const { canvas, calls } of records) {
        const arcRadii = calls.filter((call) => call.name === 'arc').map((call) => call.args[2])
        assert.equal(arcRadii.length, 2)
        assert.deepEqual(arcRadii, [expectedRadius, expectedRadius])
        assert.equal(
          canvas.ctx.lineWidth,
          SELECTION_CAPSULE_STROKE_PX * SELECTION_CAPSULE_PIXEL_RATIO,
        )
        const names = calls.map((call) => call.name)
        for (const expected of ['beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke']) {
          assert.ok(names.includes(expected))
        }
      }
      // 通常2枚は白fill＋シアン枠、ホバー2枚は配色反転
      for (const { canvas } of records.slice(0, 2)) {
        assert.equal(canvas.ctx.fillStyle, SELECTION_HANDLE_FILL_COLOR)
        assert.equal(canvas.ctx.strokeStyle, SELECTION_HANDLE_STROKE_COLOR)
      }
      for (const { canvas } of records.slice(2)) {
        assert.equal(canvas.ctx.fillStyle, SELECTION_HANDLE_HOVER_FILL_COLOR)
        assert.equal(canvas.ctx.strokeStyle, SELECTION_HANDLE_HOVER_STROKE_COLOR)
      }
      // 垂直カプセルだけが回転する（通常・ホバーとも2枚目）
      assert.ok(!records[0].calls.map((call) => call.name).includes('rotate'))
      assert.ok(records[1].calls.map((call) => call.name).includes('rotate'))
      assert.ok(!records[2].calls.map((call) => call.name).includes('rotate'))
      assert.ok(records[3].calls.map((call) => call.name).includes('rotate'))
    })
  })

  it('2回目はhasImageで登録をスキップする', () => {
    withDocumentStub((records) => {
      const map = new FakeMap()
      ensureSelectionOverlay(map, BOUNDS)
      assert.equal(records.length, 4)
      // ソース削除→再作成しても画像は再利用される
      ensureSelectionOverlay(map, null)
      ensureSelectionOverlay(map, BOUNDS)
      assert.equal(records.length, 4)
    })
  })

  it('document無しでは画像登録を呼ばず層だけ作る', () => {
    assert.equal(typeof document, 'undefined')
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    assert.equal(map.images.size, 0)
    assert.ok(map.layers.has(SELECTION_EDGE_HANDLES_LAYER_ID))
  })

  it('addImage失敗時は吞み込んで層は作る', () => {
    withDocumentStub(() => {
      const map = new FakeMap()
      map.failOn = 'addImage'
      ensureSelectionOverlay(map, BOUNDS)
      assert.ok(map.layers.has(SELECTION_EDGE_HANDLES_LAYER_ID))
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

describe('selectionHandlePoints', () => {
  it('8点（4隅＋4辺中点）を返す', () => {
    const points = selectionHandlePoints(BOUNDS)
    assert.equal(points.length, 8)
    const byHandle = new Map<ResizeHandle, { lng: number; lat: number }>(
      points.map((point) => [point.handle, { lng: point.lng, lat: point.lat }]),
    )
    assert.deepEqual(byHandle.get('nw'), { lng: 139.69, lat: 35.7 })
    assert.deepEqual(byHandle.get('ne'), { lng: 139.691, lat: 35.7 })
    assert.deepEqual(byHandle.get('se'), { lng: 139.691, lat: 35.699 })
    assert.deepEqual(byHandle.get('sw'), { lng: 139.69, lat: 35.699 })
    assert.deepEqual(byHandle.get('north'), { lng: 139.6905, lat: 35.7 })
    assert.deepEqual(byHandle.get('east'), { lng: 139.691, lat: 35.6995 })
    assert.deepEqual(byHandle.get('south'), { lng: 139.6905, lat: 35.699 })
    assert.deepEqual(byHandle.get('west'), { lng: 139.69, lat: 35.6995 })
  })

  it('角だけがcorner判定になる', () => {
    const points = selectionHandlePoints(BOUNDS)
    for (const point of points) {
      const expected = point.handle.length === 2
      assert.equal(isCornerHandle(point.handle), expected)
    }
  })
})

describe('ensureSelectionHover', () => {
  it('ensureSelectionOverlayと同一ソースへsetDataする（新規ソース・層は増やさない）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    assert.equal(entry?.setDataCalls.length, 0)
    ensureSelectionHover(map, BOUNDS, 'nw')
    assert.equal(map.sources.size, 1)
    assert.equal(map.layers.size, 6)
    assert.equal(entry?.setDataCalls.length, 1)
    assert.deepEqual(entry?.setDataCalls[0], selectionOverlayToFeatureCollection(BOUNDS, 'nw'))
  })

  it('同一内容のホバー更新はsetDataしない（差分キャッシュ）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    // overlay直後はhoverなし。同じhoverなしを再適用してもsetDataしない
    ensureSelectionHover(map, BOUNDS, null)
    assert.equal(entry?.setDataCalls.length, 0)
  })

  it('handle=nullでhover featureを消す（同一ソースsetData）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS, 'east')
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    ensureSelectionHover(map, BOUNDS, null)
    const fc = entry?.setDataCalls[0]
    const features = featuresOf(fc)
    assert.equal(features.filter((feature) => feature.properties['role'] === 'hover').length, 0)
    assert.equal(features.length, 9)
  })

  it('ソース未作成なら何もしない', () => {
    const map = new FakeMap()
    ensureSelectionHover(map, BOUNDS, 'east')
    assert.equal(map.sources.size, 0)
    assert.equal(map.layers.size, 0)
  })

  it('bounds=nullなら何もしない（既存表示を保持）', () => {
    const map = new FakeMap()
    ensureSelectionOverlay(map, BOUNDS)
    const entry = map.sources.get(SELECTION_SOURCE_ID)
    ensureSelectionHover(map, null, 'east')
    assert.equal(entry?.setDataCalls.length, 0)
  })

  it('失敗時は例外を投げない', () => {
    const map = new FakeMap()
    map.failOn = 'addSource'
    ensureSelectionOverlay(map, BOUNDS)
    ensureSelectionHover(map, BOUNDS, 'east')
  })
})
