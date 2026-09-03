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
  return { button, shiftKey: shift, clientX: x, clientY: y, pointerType: 'mouse', preventDefault: (): void => {} }
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
    assert.equal(globalTarget.count('mouseup'), 0)
    assert.equal(globalTarget.count('keydown'), 0)
  })
})
