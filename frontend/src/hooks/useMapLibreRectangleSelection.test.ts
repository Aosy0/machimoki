/**
 * useMapLibreRectangleSelection（Cesium経路を壊さない別フック）のテスト。
 * DOM不要のモックで開始条件・確定・取消・上限・再選択を検証する。
 *
 * 実行方法:
 *   npx tsx --test frontend/src/hooks/useMapLibreRectangleSelection.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldStartSelection,
  isTinyRectangle,
  createMapLibreSelectionController,
  MIN_SELECTION_PIXELS,
  type SelectionMapLike,
  type SelectionBounds,
} from './useMapLibreRectangleSelection'
import type { ResizeHandle } from '../lib/mapSelectionResize'

type Listener = (e: unknown) => void

class FakeTarget {
  listeners: Map<string, Set<Listener>> = new Map()
  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(fn)
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn)
  }
  dispatch(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event)
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

function createMockMap(): {
  map: SelectionMapLike
  canvas: FakeTarget
  boxZoomEnabled: { value: boolean }
  dragPanEnabled: { value: boolean }
} {
  const canvas = new FakeTarget()
  const boxZoomEnabled = { value: true }
  const dragPanEnabled = { value: true }
  const map: SelectionMapLike = {
    boxZoom: {
      disable(): void {
        boxZoomEnabled.value = false
      },
      enable(): void {
        boxZoomEnabled.value = true
      },
    },
    dragPan: {
      disable(): void {
        dragPanEnabled.value = false
      },
      enable(): void {
        dragPanEnabled.value = true
      },
    },
    getCanvas: (): HTMLCanvasElement => canvas as unknown as HTMLCanvasElement,
    unproject(point: [number, number]): { lng: number; lat: number } {
      const [x, y] = point
      return { lng: 139.69 + x * 0.00001, lat: 35.7 - y * 0.00001 }
    },
    project(point: [number, number]): { x: number; y: number } {
      const [lng, lat] = point
      return { x: (lng - 139.69) * 1e5, y: (35.7 - lat) * 1e5 }
    },
    getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number } {
      return {
        getWest: (): number => 139.69,
        getSouth: (): number => 35.699,
        getEast: (): number => 139.691,
        getNorth: (): number => 35.7,
      }
    },
  }
  return { map, canvas, boxZoomEnabled, dragPanEnabled }
}

function mouseDown(x: number, y: number, shift: boolean, button = 0): unknown {
  return {
    button,
    shiftKey: shift,
    clientX: x,
    clientY: y,
    pointerType: 'mouse',
    preventDefault: (): void => {},
  }
}

describe('shouldStartSelection', () => {
  it('左+Shift+マウスで開始する', () => {
    assert.equal(shouldStartSelection({ button: 0, shiftKey: true, pointerType: 'mouse' }), true)
  })

  it('Shiftなしでは開始しない（通常=パン）', () => {
    assert.equal(shouldStartSelection({ button: 0, shiftKey: false, pointerType: 'mouse' }), false)
  })

  it('右クリックでは開始しない', () => {
    assert.equal(shouldStartSelection({ button: 2, shiftKey: true, pointerType: 'mouse' }), false)
  })

  it('ホイール（button=1）では開始しない', () => {
    assert.equal(shouldStartSelection({ button: 1, shiftKey: true, pointerType: 'mouse' }), false)
  })

  it('タッチでは開始しない', () => {
    assert.equal(shouldStartSelection({ button: 0, shiftKey: true, pointerType: 'touch' }), false)
  })
})

describe('isTinyRectangle', () => {
  it('最小定数は正数である', () => {
    assert.ok(MIN_SELECTION_PIXELS > 0)
  })

  it('微小矩形は選択にしない', () => {
    assert.equal(isTinyRectangle({ x: 10, y: 10 }, { x: 12, y: 11 }), true)
  })

  it('十分な大きさは選択対象にする', () => {
    assert.equal(isTinyRectangle({ x: 10, y: 10 }, { x: 100, y: 80 }), false)
  })
})

describe('createMapLibreSelectionController', () => {
  it('生成時にboxZoomを抑止し、破棄時に戻す', () => {
    const { map, boxZoomEnabled } = createMockMap()
    const globalTarget = new FakeTarget()
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
    })
    assert.equal(boxZoomEnabled.value, false)
    controller.destroy()
    assert.equal(boxZoomEnabled.value, true)
  })

  it('Shift+ドラッグでSelectionBoundsが確定する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    canvas.dispatch('mousemove', { clientX: 110, clientY: 90 })
    // 地図外mouseup（global）でも確定する
    globalTarget.dispatch('mouseup', {})
    assert.ok(selected)
    const bounds = selected as unknown as SelectionBounds
    assert.ok(bounds.west < bounds.east)
    assert.ok(bounds.south < bounds.north)
    controller.destroy()
  })

  it('微小矩形では選択しない', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let called = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        called += 1
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    canvas.dispatch('mousemove', { clientX: 11, clientY: 11 })
    globalTarget.dispatch('mouseup', {})
    assert.equal(called, 0)
    controller.destroy()
  })

  it('Escで取消する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let called = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        called += 1
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    canvas.dispatch('mousemove', { clientX: 110, clientY: 90 })
    globalTarget.dispatch('keydown', { key: 'Escape' })
    globalTarget.dispatch('mouseup', {})
    assert.equal(called, 0)
    controller.destroy()
  })

  it('上限超過時は既存bounds保持＋エラーにする', () => {
    const { map, canvas } = createMockMap()
    const wideMap: SelectionMapLike = {
      ...map,
      unproject: (point: [number, number]): { lng: number; lat: number } => {
        const [x, y] = point
        return { lng: 130 + x * 0.1, lat: 40 - y * 0.1 }
      },
    }
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = { west: 1, south: 1, east: 2, north: 2 }
    let error: string | null = null
    const controller = createMapLibreSelectionController({
      map: wideMap,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
      onError: (message: string): void => {
        error = message
      },
    })
    canvas.dispatch('mousedown', mouseDown(0, 0, true))
    canvas.dispatch('mousemove', { clientX: 500, clientY: 500 })
    globalTarget.dispatch('mouseup', {})
    assert.deepEqual(selected, { west: 1, south: 1, east: 2, north: 2 })
    assert.ok(error)
    controller.destroy()
  })

  it('ダブルクリックでは選択しない（ズームに干渉しない）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let called = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        called += 1
      },
    })
    canvas.dispatch('dblclick', {})
    assert.equal(called, 0)
    controller.destroy()
  })

  it('selectCurrentViewで現在の表示範囲を選択できる', () => {
    const { map } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    controller.selectCurrentView()
    assert.deepEqual(selected, { west: 139.69, south: 35.699, east: 139.691, north: 35.7 })
    controller.destroy()
  })

  it('連続2回選択できる（再選択が無視されない）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const selections: SelectionBounds[] = []
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selections.push(bounds)
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    canvas.dispatch('mousemove', { clientX: 110, clientY: 90 })
    globalTarget.dispatch('mouseup', {})
    canvas.dispatch('mousedown', mouseDown(20, 20, true))
    canvas.dispatch('mousemove', { clientX: 200, clientY: 150 })
    globalTarget.dispatch('mouseup', {})
    assert.equal(selections.length, 2)
    assert.notDeepEqual(selections[0], selections[1])
    controller.destroy()
  })

  it('mouseupの座標で確定する（最終mousemoveが古くても取りこぼさない）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    canvas.dispatch('mousemove', { clientX: 12, clientY: 12 })
    // UIパネル上などcanvas外で離してもmouseup座標で確定する
    globalTarget.dispatch('mouseup', { clientX: 200, clientY: 150 })
    assert.ok(selected)
    const bounds = selected as unknown as SelectionBounds
    // x=200基準のeast（139.69 + 200*0.00001 = 139.692）に届いていること
    assert.ok(bounds.east > 139.6915)
    controller.destroy()
  })

  it('windowのmousemoveでも追跡する（パネル上を通過しても確定する）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    canvas.dispatch('mousedown', mouseDown(10, 10, true))
    // canvasには届かずwindowにだけ届くmousemove（UIパネル上を通過した想定）
    globalTarget.dispatch('mousemove', { clientX: 200, clientY: 150 })
    globalTarget.dispatch('mouseup', {})
    assert.ok(selected)
    controller.destroy()
  })

  it('destroy後はリスナーが解除される', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
    })
    controller.destroy()
    assert.equal(canvas.count('mousedown'), 0)
    assert.equal(globalTarget.count('mousemove'), 0)
    assert.equal(globalTarget.count('mouseup'), 0)
    assert.equal(globalTarget.count('keydown'), 0)
  })
})

/** 確定済み矩形（画面(0,0)-(100,100)相当）に写るbounds。 */
const RESIZE_START: SelectionBounds = { west: 139.69, south: 35.699, east: 139.691, north: 35.7 }

describe('確定後リサイズ', () => {
  it('東辺ドラッグでeastのみ変化し、onSelectionが1回呼ばれる', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    let selectedCount = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
        selectedCount += 1
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    canvas.dispatch('mousemove', { clientX: 150, clientY: 50 })
    globalTarget.dispatch('mouseup', { clientX: 150, clientY: 50 })
    assert.ok(selected)
    const b = selected as unknown as SelectionBounds
    assert.equal(b.west, RESIZE_START.west)
    assert.equal(b.south, RESIZE_START.south)
    assert.equal(b.north, RESIZE_START.north)
    assert.ok(b.east > RESIZE_START.east)
    assert.equal(selectedCount, 1)
    controller.destroy()
  })

  it('北西角ドラッグでwestとnorthのみ変化する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(0, 0, false))
    canvas.dispatch('mousemove', { clientX: 20, clientY: 20 })
    globalTarget.dispatch('mouseup', { clientX: 20, clientY: 20 })
    assert.ok(selected)
    const b = selected as unknown as SelectionBounds
    assert.equal(b.east, RESIZE_START.east)
    assert.equal(b.south, RESIZE_START.south)
    assert.notEqual(b.west, RESIZE_START.west)
    assert.notEqual(b.north, RESIZE_START.north)
    controller.destroy()
  })

  it('反対辺を越えてもクランプされ反転しない', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let selected: SelectionBounds | null = null
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(0, 50, false))
    canvas.dispatch('mousemove', { clientX: 120, clientY: 50 })
    globalTarget.dispatch('mouseup', { clientX: 120, clientY: 50 })
    assert.ok(selected)
    const b = selected as unknown as SelectionBounds
    assert.ok(b.west < b.east)
    controller.destroy()
  })

  it('ドラッグ中はonPreviewが複数回、確定は1回で最終プレビューと一致する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const previews: SelectionBounds[] = []
    let selected: SelectionBounds | null = null
    let selectedCount = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (bounds: SelectionBounds): void => {
        selected = bounds
        selectedCount += 1
      },
      onPreview: (bounds: SelectionBounds): void => {
        previews.push(bounds)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    canvas.dispatch('mousemove', { clientX: 120, clientY: 50 })
    canvas.dispatch('mousemove', { clientX: 140, clientY: 50 })
    globalTarget.dispatch('mouseup', { clientX: 140, clientY: 50 })
    assert.equal(previews.length, 2)
    assert.equal(selectedCount, 1)
    assert.deepEqual(selected, previews[previews.length - 1])
    controller.destroy()
  })

  it('矩形中央からの非Shiftドラッグでは何も確定しない（パンに干渉しない）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    let previewCount = 0
    let selectedCount = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        selectedCount += 1
      },
      onPreview: (): void => {
        previewCount += 1
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(50, 50, false))
    canvas.dispatch('mousemove', { clientX: 80, clientY: 80 })
    globalTarget.dispatch('mouseup', { clientX: 80, clientY: 80 })
    assert.equal(previewCount, 0)
    assert.equal(selectedCount, 0)
    controller.destroy()
  })

  it('辺線上でも中点から離れた位置のドラッグはリサイズを開始しない（パンになる）', () => {
    const { map, canvas, dragPanEnabled } = createMockMap()
    const globalTarget = new FakeTarget()
    let previewCount = 0
    let selectedCount = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        selectedCount += 1
      },
      onPreview: (): void => {
        previewCount += 1
      },
    })
    controller.setBounds({ ...RESIZE_START })
    // 北辺上だが中点(50,0)から30px離れている（カプセル外）
    canvas.dispatch('mousedown', mouseDown(20, 0, false))
    // dragPanは抑止されずパンのまま
    assert.equal(dragPanEnabled.value, true)
    canvas.dispatch('mousemove', { clientX: 60, clientY: 40 })
    globalTarget.dispatch('mouseup', { clientX: 60, clientY: 40 })
    assert.equal(previewCount, 0)
    assert.equal(selectedCount, 0)
    controller.destroy()
  })

  it('辺ドラッグ中のEscで取消し、最後のプレビューが開始時boundsに戻る', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const previews: SelectionBounds[] = []
    let selectedCount = 0
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        selectedCount += 1
      },
      onPreview: (bounds: SelectionBounds): void => {
        previews.push(bounds)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    canvas.dispatch('mousemove', { clientX: 150, clientY: 50 })
    globalTarget.dispatch('keydown', { key: 'Escape' })
    globalTarget.dispatch('mouseup', { clientX: 150, clientY: 50 })
    assert.equal(selectedCount, 0)
    assert.deepEqual(previews[previews.length - 1], RESIZE_START)
    controller.destroy()
  })

  it('面積上限超過のリサイズはonErrorで拒否しboundsを維持する', () => {
    const { map, canvas } = createMockMap()
    // 1px=0.1度で整合するマップ（project/unprojectを同じ式で上書き）
    const wideMap: SelectionMapLike = {
      ...map,
      unproject: (point: [number, number]): { lng: number; lat: number } => {
        const [x, y] = point
        return { lng: 130 + x * 0.1, lat: 40 - y * 0.1 }
      },
      project: (point: [number, number]): { x: number; y: number } => {
        const [lng, lat] = point
        return { x: (lng - 130) / 0.1, y: (40 - lat) / 0.1 }
      },
    }
    const globalTarget = new FakeTarget()
    const previews: SelectionBounds[] = []
    let selectedCount = 0
    let error: string | null = null
    const start: SelectionBounds = { west: 130, south: 35, east: 132, north: 40 }
    const controller = createMapLibreSelectionController({
      map: wideMap,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {
        selectedCount += 1
      },
      onPreview: (bounds: SelectionBounds): void => {
        previews.push(bounds)
      },
      onError: (message: string): void => {
        error = message
      },
    })
    controller.setBounds({ ...start })
    // 東辺中点は画面(20,25)相当
    canvas.dispatch('mousedown', mouseDown(20, 25, false))
    canvas.dispatch('mousemove', { clientX: 80, clientY: 25 })
    globalTarget.dispatch('mouseup', { clientX: 80, clientY: 25 })
    assert.ok(error)
    assert.equal(selectedCount, 0)
    assert.deepEqual(previews[previews.length - 1], start)
    controller.destroy()
  })
})

describe('ホバー通知 onHover', () => {
  it('ホバー変化時だけ通知する（同じ辺の移動では呼ばない）', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const hovers: Array<ResizeHandle | null> = []
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
      onHover: (handle: ResizeHandle | null): void => {
        hovers.push(handle)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousemove', { clientX: 100, clientY: 50 })
    canvas.dispatch('mousemove', { clientX: 100, clientY: 52 })
    canvas.dispatch('mousemove', { clientX: 50, clientY: 0 })
    assert.deepEqual(hovers, ['east', 'north'])
    controller.destroy()
  })

  it('リサイズ開始でアクティブハンドルを維持し、終了で再判定結果を通知する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const hovers: Array<ResizeHandle | null> = []
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
      onHover: (handle: ResizeHandle | null): void => {
        hovers.push(handle)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousemove', { clientX: 100, clientY: 50 })
    assert.deepEqual(hovers, ['east'])
    hovers.length = 0
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    // 開始時にnullにせず、掴んだハンドルの強調を維持する
    assert.deepEqual(hovers, ['east'])
    // リサイズ中の移動ではホバー通知しない（位置追従はpreview経由）
    canvas.dispatch('mousemove', { clientX: 150, clientY: 50 })
    assert.deepEqual(hovers, ['east'])
    // 確定後はmouseup座標で再判定した辺を通知する
    globalTarget.dispatch('mouseup', { clientX: 150, clientY: 50 })
    assert.deepEqual(hovers, ['east', 'east'])
    controller.destroy()
  })

  it('リサイズ終了が矩形外ならnullを通知する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const hovers: Array<ResizeHandle | null> = []
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
      onHover: (handle: ResizeHandle | null): void => {
        hovers.push(handle)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    assert.deepEqual(hovers, ['east'])
    // 東辺を掴んだまま辺の上下範囲外で離す（北辺より100px上）
    globalTarget.dispatch('mouseup', { clientX: 400, clientY: -100 })
    assert.deepEqual(hovers[hovers.length - 1], null)
    controller.destroy()
  })

  it('Escとdestroyでnullを通知する', () => {
    const { map, canvas } = createMockMap()
    const globalTarget = new FakeTarget()
    const hovers: Array<ResizeHandle | null> = []
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: globalTarget as unknown as Window,
      onSelection: (): void => {},
      onHover: (handle: ResizeHandle | null): void => {
        hovers.push(handle)
      },
    })
    controller.setBounds({ ...RESIZE_START })
    canvas.dispatch('mousedown', mouseDown(100, 50, false))
    assert.deepEqual(hovers, ['east'])
    canvas.dispatch('mousemove', { clientX: 150, clientY: 50 })
    globalTarget.dispatch('keydown', { key: 'Escape' })
    // Esc取消で強調を消す
    assert.deepEqual(hovers, ['east', null])
    hovers.length = 0
    controller.destroy()
    assert.deepEqual(hovers, [null])
  })
})
