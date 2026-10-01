/**
 * mapSelectionResize（確定後リサイズの純ロジック）のテスト。
 * ヒットテスト・反転防止クランプ・カーソルをDOM非依存で検証する。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/lib/mapSelectionResize.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyResizeDrag,
  distanceToSegment,
  handleVisibility,
  hitTestSelectionHandle,
  movedBeyondTolerance,
  resizeCursor,
  selectionHandleScreenPoints,
  HANDLE_CORNER_MIN_DIMENSION_PX,
  HANDLE_EDGE_MIN_LENGTH_PX,
  HANDLE_EDGE_MIN_THICKNESS_PX,
  RESIZE_CORNER_HIT_PX,
  RESIZE_HANDLE_HIT_PX,
  RESIZE_HANDLE_HALF_LENGTH_PX,
  RESIZE_MOVE_TOLERANCE_PX,
  type HandleVisibility,
  type ResizeHandle,
  type SelectionHandlePoints,
} from './mapSelectionResize'

const bounds = { west: 0, south: 0, east: 10, north: 10 }
const minGap = { lng: 1, lat: 1 }

/** 画面(0,0)-(100,100)相当の4隅＋4中点。 */
const square: SelectionHandlePoints = {
  nw: { x: 0, y: 0 },
  ne: { x: 100, y: 0 },
  se: { x: 100, y: 100 },
  sw: { x: 0, y: 100 },
  north: { x: 50, y: 0 },
  east: { x: 100, y: 50 },
  south: { x: 50, y: 100 },
  west: { x: 0, y: 50 },
}

describe('selectionHandleScreenPoints', () => {
  it('4隅に加えて辺中点を返す', () => {
    const points = selectionHandleScreenPoints(bounds, ([lng, lat]) => ({ x: lng, y: lat }))
    assert.deepEqual(points, {
      nw: { x: 0, y: 10 },
      ne: { x: 10, y: 10 },
      se: { x: 10, y: 0 },
      sw: { x: 0, y: 0 },
      north: { x: 5, y: 10 },
      east: { x: 10, y: 5 },
      south: { x: 5, y: 0 },
      west: { x: 0, y: 5 },
    })
  })

  it('非線形な投影でも中点は投影済み角の中点になる', () => {
    // 回転＋非線形を含む投影（地理的中点の投影とは一致しない）
    const project = ([lng, lat]: [number, number]): { x: number; y: number } => ({
      x: lng * 10 - lat * 5 + lat * lat * 0.1,
      y: lng * 5 + lat * 10,
    })
    const points = selectionHandleScreenPoints(bounds, project)
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    })
    assert.deepEqual(points.north, mid(points.nw, points.ne))
    assert.deepEqual(points.east, mid(points.ne, points.se))
    assert.deepEqual(points.south, mid(points.se, points.sw))
    assert.deepEqual(points.west, mid(points.sw, points.nw))
  })
})

describe('distanceToSegment', () => {
  it('線分上の点は0', () => {
    assert.equal(distanceToSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 0)
  })

  it('線分外の点は垂線距離', () => {
    assert.equal(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5)
  })

  it('長さ0の線分は点間距離', () => {
    assert.equal(distanceToSegment({ x: 5, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 }), 3)
  })

  it('端点より外側は端点距離になる', () => {
    assert.equal(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5)
  })
})

describe('hitTestSelectionHandle', () => {
  it('角の閾値内は該当ハンドルを返す', () => {
    assert.equal(hitTestSelectionHandle({ x: 2, y: 2 }, square), 'nw')
    assert.equal(hitTestSelectionHandle({ x: 98, y: 2 }, square), 'ne')
    assert.equal(hitTestSelectionHandle({ x: 98, y: 98 }, square), 'se')
    assert.equal(hitTestSelectionHandle({ x: 2, y: 98 }, square), 'sw')
  })

  it('辺の中点付近は辺ハンドルを返す', () => {
    assert.equal(hitTestSelectionHandle({ x: 50, y: 3 }, square), 'north')
    assert.equal(hitTestSelectionHandle({ x: 97, y: 50 }, square), 'east')
    assert.equal(hitTestSelectionHandle({ x: 50, y: 97 }, square), 'south')
    assert.equal(hitTestSelectionHandle({ x: 3, y: 50 }, square), 'west')
  })

  it('カプセル中心線の範囲内（辺方向・垂直方向）は辺ハンドルを返す', () => {
    // 中点から辺方向にHALF_LENGTH以内
    assert.equal(hitTestSelectionHandle({ x: 50 + RESIZE_HANDLE_HALF_LENGTH_PX, y: 0 }, square), 'north')
    assert.equal(hitTestSelectionHandle({ x: 100, y: 50 + RESIZE_HANDLE_HALF_LENGTH_PX }, square), 'east')
    // 中点から垂直方向にHIT_PX以内
    assert.equal(hitTestSelectionHandle({ x: 50, y: RESIZE_HANDLE_HIT_PX }, square), 'north')
    assert.equal(hitTestSelectionHandle({ x: 100 - RESIZE_HANDLE_HIT_PX, y: 50 }, square), 'east')
  })

  it('辺線上でも中点から離れた位置はnull（=パンに任せる）', () => {
    // 北辺上だが中点から30px離れている
    assert.equal(hitTestSelectionHandle({ x: 20, y: 0 }, square), null)
    assert.equal(hitTestSelectionHandle({ x: 80, y: 100 }, square), null)
    // 西辺上だが中点から30px離れている
    assert.equal(hitTestSelectionHandle({ x: 0, y: 20 }, square), null)
    // 中心線の延長上（HALF_LENGTH＋HIT_PXより外）
    const beyond = RESIZE_HANDLE_HALF_LENGTH_PX + RESIZE_HANDLE_HIT_PX + 1
    assert.equal(hitTestSelectionHandle({ x: 50 + beyond, y: 0 }, square), null)
    // 垂直方向にHIT_PXより外
    assert.equal(hitTestSelectionHandle({ x: 50, y: RESIZE_HANDLE_HIT_PX + 1 }, square), null)
  })

  it('回転した投影座標でも辺方向が正しく判定される', () => {
    // 30度回転＋平行移動の投影（アフィンなので中点は保存される）
    const angle = (Math.PI * 30) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const project = ([lng, lat]: [number, number]): { x: number; y: number } => ({
      x: 200 + lng * 10 * cos - lat * 10 * sin,
      y: 150 + lng * 10 * sin + lat * 10 * cos,
    })
    const rotated = selectionHandleScreenPoints(bounds, project)
    // 中点ちょうどは辺ハンドル
    assert.equal(hitTestSelectionHandle({ ...rotated.north }, rotated), 'north')
    assert.equal(hitTestSelectionHandle({ ...rotated.east }, rotated), 'east')
    // 北辺の1/4点（中点から約25px）はnull
    const quarter = {
      x: rotated.nw.x + (rotated.ne.x - rotated.nw.x) * 0.25,
      y: rotated.nw.y + (rotated.ne.y - rotated.nw.y) * 0.25,
    }
    assert.equal(hitTestSelectionHandle(quarter, rotated), null)
    // 北辺中点から辺の法線方向に8pxはnorth、10pxはnull
    const edgeDx = rotated.ne.x - rotated.nw.x
    const edgeDy = rotated.ne.y - rotated.nw.y
    const edgeLen = Math.hypot(edgeDx, edgeDy)
    const nx = -edgeDy / edgeLen
    const ny = edgeDx / edgeLen
    assert.equal(
      hitTestSelectionHandle({ x: rotated.north.x + nx * 8, y: rotated.north.y + ny * 8 }, rotated),
      'north',
    )
    assert.equal(
      hitTestSelectionHandle({ x: rotated.north.x + nx * 10, y: rotated.north.y + ny * 10 }, rotated),
      null,
    )
  })

  it('矩形から離れた点はnull', () => {
    assert.equal(hitTestSelectionHandle({ x: 50, y: 50 }, square), null)
    assert.equal(hitTestSelectionHandle({ x: 200, y: 200 }, square), null)
  })

  it('角と辺が近い場合は角を優先する', () => {
    // nw角から約11.3pxの点（辺中点カプセルからは遠い）
    assert.ok(Math.hypot(8, 8) <= RESIZE_CORNER_HIT_PX)
    assert.equal(hitTestSelectionHandle({ x: 8, y: 8 }, square), 'nw')
  })

  it('閾値の直外は該当しない', () => {
    const justOutsideCorner = RESIZE_CORNER_HIT_PX + 1
    const far = { x: justOutsideCorner, y: justOutsideCorner }
    // 角からも辺中点カプセルからも離れているためnull
    assert.ok(Math.hypot(justOutsideCorner, justOutsideCorner) > RESIZE_CORNER_HIT_PX)
    assert.ok(distanceToSegment(far, square.nw, square.ne) > RESIZE_HANDLE_HIT_PX)
    assert.equal(hitTestSelectionHandle(far, square), null)
  })

  it('非表示の辺カプセル・隅にはヒットしない', () => {
    // 100×20の横長: 北・南カプセルのみ有効
    const wideFlat = rectPoints(100, 20)
    assert.equal(hitTestSelectionHandle({ x: 50, y: 0 }, wideFlat), 'north')
    assert.equal(hitTestSelectionHandle({ x: 100, y: 10 }, wideFlat), null)
    assert.equal(hitTestSelectionHandle({ x: 0, y: 0 }, wideFlat), null)
    // 30×30: 隅のみ有効
    const small = rectPoints(30, 30)
    assert.equal(hitTestSelectionHandle({ x: 0, y: 0 }, small), 'nw')
    assert.equal(hitTestSelectionHandle({ x: 15, y: 0 }, small), null)
    // 10×10: 全非表示
    const tiny = rectPoints(10, 10)
    assert.equal(hitTestSelectionHandle({ x: 0, y: 0 }, tiny), null)
    assert.equal(hitTestSelectionHandle({ x: 5, y: 0 }, tiny), null)
  })
})

/** 原点基準のw×h矩形の8点を作る。 */
function rectPoints(w: number, h: number): SelectionHandlePoints {
  return {
    nw: { x: 0, y: 0 },
    ne: { x: w, y: 0 },
    se: { x: w, y: h },
    sw: { x: 0, y: h },
    north: { x: w / 2, y: 0 },
    east: { x: w, y: h / 2 },
    south: { x: w / 2, y: h },
    west: { x: 0, y: h / 2 },
  }
}

describe('handleVisibility', () => {
  it('大きい矩形は全表示', () => {
    assert.deepEqual(handleVisibility(square), {
      corners: true,
      edges: { north: true, east: true, south: true, west: true },
    })
  })

  it('細長い矩形は長い辺のカプセルのみ（短辺側・隅は非表示）', () => {
    assert.deepEqual(handleVisibility(rectPoints(100, 20)), {
      corners: false,
      edges: { north: true, east: false, south: true, west: false },
    })
    assert.deepEqual(handleVisibility(rectPoints(20, 100)), {
      corners: false,
      edges: { north: false, east: true, south: false, west: true },
    })
  })

  it('やや小さい正方形は隅のみ（辺カプセルなし）', () => {
    assert.deepEqual(handleVisibility(rectPoints(30, 30)), {
      corners: true,
      edges: { north: false, east: false, south: false, west: false },
    })
  })

  it('極小矩形は全非表示（輪郭のみ）', () => {
    const visibility = handleVisibility(rectPoints(10, 10))
    assert.equal(visibility.corners, false)
    assert.deepEqual(visibility.edges, { north: false, east: false, south: false, west: false })
  })

  it('回転した投影でも辺長基準で判定する', () => {
    const angle = (Math.PI * 30) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // 10倍スケールで100px四方→全表示
    const project100 = ([lng, lat]: [number, number]): { x: number; y: number } => ({
      x: lng * 10 * cos - lat * 10 * sin,
      y: lng * 10 * sin + lat * 10 * cos,
    })
    const full = handleVisibility(selectionHandleScreenPoints(bounds, project100))
    assert.equal(full.corners, true)
    assert.deepEqual(full.edges, { north: true, east: true, south: true, west: true })
    // 幅30px×高さ100px→南北カプセルなし・隅あり・東西あり
    const narrow = { west: 0, south: 0, east: 3, north: 10 }
    const partial = handleVisibility(selectionHandleScreenPoints(narrow, project100))
    assert.deepEqual(partial, {
      corners: true,
      edges: { north: false, east: true, south: false, west: true },
    })
  })

  it('境界値（定数ちょうどは表示・1px未満は非表示）', () => {
    const allShown: HandleVisibility = {
      corners: true,
      edges: { north: true, east: true, south: true, west: true },
    }
    // 辺長38ちょうど・短辺100
    assert.deepEqual(handleVisibility(rectPoints(HANDLE_EDGE_MIN_LENGTH_PX, 100)), allShown)
    // 辺長37（南北カプセルなし・隅は残る）
    assert.deepEqual(handleVisibility(rectPoints(HANDLE_EDGE_MIN_LENGTH_PX - 1, 100)), {
      corners: true,
      edges: { north: false, east: true, south: false, west: true },
    })
    // 短辺24ちょうど（隅あり）、23（隅なし）
    assert.equal(handleVisibility(rectPoints(100, HANDLE_CORNER_MIN_DIMENSION_PX)).corners, true)
    assert.equal(handleVisibility(rectPoints(100, HANDLE_CORNER_MIN_DIMENSION_PX - 1)).corners, false)
    // 短辺16ちょうど（南北あり）、15（南北なし）
    assert.equal(handleVisibility(rectPoints(100, HANDLE_EDGE_MIN_THICKNESS_PX)).edges.north, true)
    assert.equal(handleVisibility(rectPoints(100, HANDLE_EDGE_MIN_THICKNESS_PX - 1)).edges.north, false)
  })
})

describe('applyResizeDrag', () => {
  const cases: Array<{ handle: ResizeHandle; pointer: { lng: number; lat: number }; expect: typeof bounds }> = [
    { handle: 'north', pointer: { lng: 5, lat: 12 }, expect: { west: 0, south: 0, east: 10, north: 12 } },
    { handle: 'south', pointer: { lng: 5, lat: -5 }, expect: { west: 0, south: -5, east: 10, north: 10 } },
    { handle: 'east', pointer: { lng: 20, lat: 5 }, expect: { west: 0, south: 0, east: 20, north: 10 } },
    { handle: 'west', pointer: { lng: -5, lat: 5 }, expect: { west: -5, south: 0, east: 10, north: 10 } },
    { handle: 'nw', pointer: { lng: -5, lat: 12 }, expect: { west: -5, south: 0, east: 10, north: 12 } },
    { handle: 'ne', pointer: { lng: 20, lat: 12 }, expect: { west: 0, south: 0, east: 20, north: 12 } },
    { handle: 'se', pointer: { lng: 20, lat: -5 }, expect: { west: 0, south: -5, east: 20, north: 10 } },
    { handle: 'sw', pointer: { lng: -5, lat: -5 }, expect: { west: -5, south: -5, east: 10, north: 10 } },
  ]

  for (const { handle, pointer, expect } of cases) {
    it(`${handle} は動かす辺だけを変える`, () => {
      assert.deepEqual(applyResizeDrag(bounds, handle, pointer, minGap), expect)
    })
  }

  it('反対辺を越える入力はクランプして反転しない', () => {
    const west = applyResizeDrag(bounds, 'west', { lng: 20, lat: 5 }, minGap)
    assert.ok(west.west < west.east)
    assert.equal(west.west, 9)

    const east = applyResizeDrag(bounds, 'east', { lng: -5, lat: 5 }, minGap)
    assert.ok(east.east > east.west)
    assert.equal(east.east, 1)

    const north = applyResizeDrag(bounds, 'north', { lng: 5, lat: -5 }, minGap)
    assert.ok(north.north > north.south)
    assert.equal(north.north, 1)

    const south = applyResizeDrag(bounds, 'south', { lng: 5, lat: 20 }, minGap)
    assert.ok(south.south < south.north)
    assert.equal(south.south, 9)
  })

  it('minGap=0でも反転しない（境界で一致する）', () => {
    const zero = { lng: 0, lat: 0 }
    const west = applyResizeDrag(bounds, 'west', { lng: 20, lat: 5 }, zero)
    assert.ok(west.west <= west.east)
    assert.equal(west.west, 10)

    const east = applyResizeDrag(bounds, 'east', { lng: -5, lat: 5 }, zero)
    assert.ok(east.east >= east.west)
    assert.equal(east.east, 0)

    const south = applyResizeDrag(bounds, 'south', { lng: 5, lat: 20 }, zero)
    assert.ok(south.south <= south.north)
    assert.equal(south.south, 10)

    const north = applyResizeDrag(bounds, 'north', { lng: 5, lat: -5 }, zero)
    assert.ok(north.north >= north.south)
    assert.equal(north.north, 0)
  })

  it('元のboundsを破壊しない', () => {
    applyResizeDrag(bounds, 'nw', { lng: -5, lat: 12 }, minGap)
    assert.deepEqual(bounds, { west: 0, south: 0, east: 10, north: 10 })
  })
})

describe('resizeCursor', () => {
  it('辺はns/ew-resizeを返す', () => {
    assert.equal(resizeCursor('north'), 'ns-resize')
    assert.equal(resizeCursor('south'), 'ns-resize')
    assert.equal(resizeCursor('east'), 'ew-resize')
    assert.equal(resizeCursor('west'), 'ew-resize')
  })

  it('角はnwse/nesw-resizeを返す', () => {
    assert.equal(resizeCursor('nw'), 'nwse-resize')
    assert.equal(resizeCursor('se'), 'nwse-resize')
    assert.equal(resizeCursor('ne'), 'nesw-resize')
    assert.equal(resizeCursor('sw'), 'nesw-resize')
  })
})

describe('movedBeyondTolerance', () => {
  it('許容px以内はfalse', () => {
    assert.equal(movedBeyondTolerance({ x: 0, y: 0 }, { x: 2, y: 2 }), false)
    assert.equal(movedBeyondTolerance({ x: 0, y: 0 }, { x: 0, y: RESIZE_MOVE_TOLERANCE_PX }), false)
  })

  it('許容pxを超えたらtrue', () => {
    assert.equal(movedBeyondTolerance({ x: 0, y: 0 }, { x: 3, y: 4 }), true)
    assert.equal(movedBeyondTolerance({ x: 0, y: 0 }, { x: 0, y: RESIZE_MOVE_TOLERANCE_PX + 0.1 }), true)
  })
})
