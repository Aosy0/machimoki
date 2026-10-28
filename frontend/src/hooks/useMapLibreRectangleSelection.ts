import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { boundsFromLngLat, validateSelectionBounds } from '../lib/selectionBounds'
import type { SelectionBounds } from '../lib/selectionBounds'
import { coerceCurrentViewBounds } from '../lib/mapSelectionInput'

export type { SelectionBounds } from '../lib/selectionBounds'
import {
  applyResizeDrag,
  COARSE_HANDLE_METRICS,
  handleMetricsFor,
  hitTestSelectionHandle,
  movedBeyondTolerance,
  resizeCursor,
  selectionHandleScreenPoints,
  type HandleMetrics,
  type ResizeHandle,
  type SelectionHandlePoints,
} from '../lib/mapSelectionResize'

/** 微小矩形のしきい値（px）。これ未満はクリック扱いで選択にしない。 */
export const MIN_SELECTION_PIXELS = 5

/** 移動モードで長押し→ドラッグ選択に切り替わるまでの時間。 */
export const LONG_PRESS_MS = 300
/** 長押し成立までの指の移動許容（px）。 */
export const LONG_PRESS_MOVE_PX = 8
/** 右/中ドラッグをパンとみなす移動量（px）。 */
export const PAN_MOVE_TOLERANCE_PX = 3

export type MapInteractionMode = 'move' | 'select'

export interface SelectionPoint {
  x: number
  y: number
}

export interface MouseButtonEventLike {
  button: number
  shiftKey: boolean
  pointerType?: string
  /** 省略時は移動モード（既存呼び出しとの互換）。 */
  mode?: MapInteractionMode
}

/**
 * 左ボタンで矩形選択を開始するか。
 * - 移動モード: Shift+左のみ
 * - 範囲選択モード: Shiftなしの左のみ（Shiftはパン）
 * タッチ・ホイール・右クリックは対象外。
 */
export function shouldStartSelection(e: MouseButtonEventLike): boolean {
  if (e.button !== 0) return false
  if (e.pointerType !== undefined && e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
    return false
  }
  const mode = e.mode ?? 'move'
  return mode === 'select' ? !e.shiftKey : e.shiftKey
}

export function isTinyRectangle(start: SelectionPoint, end: SelectionPoint): boolean {
  return (
    Math.abs(end.x - start.x) < MIN_SELECTION_PIXELS ||
    Math.abs(end.y - start.y) < MIN_SELECTION_PIXELS
  )
}

/** 実Mapでもテストモックでも受けられる最小Map形状。 */
export interface SelectionMapLike {
  boxZoom: { disable(): void; enable(): void }
  dragPan: { disable(): void; enable(): void }
  /** 右/中ドラッグの自前パン用。 */
  panBy(offset: [number, number], options?: { animate?: boolean }): void
  getCanvas(): HTMLCanvasElement
  unproject(point: [number, number]): { lng: number; lat: number }
  project(point: [number, number]): { x: number; y: number }
  getBounds(): {
    getWest(): number
    getSouth(): number
    getEast(): number
    getNorth(): number
  }
}

export interface SelectionControllerOptions {
  map: SelectionMapLike
  globalTarget: Pick<
    Window,
    'addEventListener' | 'removeEventListener'
  >
  onSelection: (bounds: SelectionBounds) => void
  onPreview?: (bounds: SelectionBounds) => void
  /** 作成ドラッグ中・取消時の寸法ラベル用プレビュー（確定stateに触れない） */
  onDrawPreview?: (bounds: SelectionBounds | null) => void
  /** ホバーハンドルの変化通知（ハイライト用。ヒットテスト結果と完全整合） */
  onHover?: (handle: ResizeHandle | null) => void
  onError?: (message: string) => void
  onDrawingChange?: (drawing: boolean) => void
  /** 初期モード。既定は移動モード。 */
  mode?: MapInteractionMode
}

export interface SelectionController {
  destroy(): void
  cancel(): void
  selectCurrentView(): void
  setBounds(bounds: SelectionBounds | null): void
  setMode(mode: MapInteractionMode): void
}

interface SelectionOverlay {
  update(a: SelectionPoint, b: SelectionPoint): void
  remove(): void
}

function createOverlay(canvas: HTMLCanvasElement): SelectionOverlay {
  const noop: SelectionOverlay = {
    update: (): void => {},
    remove: (): void => {},
  }
  if (typeof document === 'undefined') return noop
  const parent = canvas.parentElement
  if (!parent) return noop
  const box = document.createElement('div')
  box.setAttribute('data-testid', 'maplibre-selection-box')
  box.style.position = 'absolute'
  box.style.border = '2px solid #00bcd4'
  box.style.background = 'rgba(0, 188, 212, 0.15)'
  box.style.pointerEvents = 'none'
  box.style.zIndex = '10'
  parent.appendChild(box)
  return {
    update: (a: SelectionPoint, b: SelectionPoint): void => {
      box.style.left = `${Math.min(a.x, b.x)}px`
      box.style.top = `${Math.min(a.y, b.y)}px`
      box.style.width = `${Math.abs(b.x - a.x)}px`
      box.style.height = `${Math.abs(b.y - a.y)}px`
    },
    remove: (): void => {
      box.remove()
    },
  }
}

interface Crosshair {
  remove(): void
}

/** 長押し成立時に押下点へ出す小さな十字マーク。 */
function createCrosshair(canvas: HTMLCanvasElement, point: SelectionPoint): Crosshair {
  const noop: Crosshair = { remove: (): void => {} }
  if (typeof document === 'undefined') return noop
  const parent = canvas.parentElement
  if (!parent) return noop
  const dot = document.createElement('div')
  dot.setAttribute('data-testid', 'maplibre-longpress-marker')
  dot.style.position = 'absolute'
  dot.style.left = `${point.x}px`
  dot.style.top = `${point.y}px`
  dot.style.width = '18px'
  dot.style.height = '18px'
  dot.style.marginLeft = '-9px'
  dot.style.marginTop = '-9px'
  dot.style.borderRadius = '50%'
  dot.style.border = '2px solid #00bcd4'
  dot.style.background = 'rgba(0, 188, 212, 0.25)'
  dot.style.boxShadow = '0 0 0 1px rgba(255, 255, 255, 0.8)'
  dot.style.pointerEvents = 'none'
  dot.style.zIndex = '11'
  parent.appendChild(dot)
  return {
    remove: (): void => {
      dot.remove()
    },
  }
}

/**
 * MapLibre用矩形選択コントローラー（React非依存・既存Cesium経路に無干渉）。
 *
 * - 移動モード: 左ドラッグ=パン / Shift+左=矩形 / タッチ1本指長押し→ドラッグ=矩形
 * - 範囲選択モード: 左ドラッグ=矩形 / Shift+左=パン / タッチ1本指=矩形
 * - 2本指はモードに関係なくMapLibre標準の移動＋拡大に任せる
 * - 右/中ドラッグはモード非依存のパン
 * - 矩形の辺・角はモード非依存でリサイズ
 */
export function createMapLibreSelectionController(
  options: SelectionControllerOptions,
): SelectionController {
  const { map, globalTarget, onSelection } = options
  const onPreview = options.onPreview ?? ((): void => {})
  const onDrawPreview = options.onDrawPreview ?? ((): void => {})
  const onHover = options.onHover ?? ((): void => {})
  const onError = options.onError ?? ((): void => {})
  const onDrawingChange = options.onDrawingChange ?? ((): void => {})
  let mode: MapInteractionMode = options.mode ?? 'move'

  map.boxZoom.disable()

  let drawing = false
  let startPx: SelectionPoint | null = null
  let currentPx: SelectionPoint | null = null
  let overlay: SelectionOverlay | null = null
  let crosshair: Crosshair | null = null

  // 確定後リサイズ用の状態
  let currentBounds: SelectionBounds | null = null
  let resizeHandle: ResizeHandle | null = null
  let resizeMetrics: HandleMetrics = COARSE_HANDLE_METRICS
  let resizeStartBounds: SelectionBounds | null = null
  let resizeStartPx: SelectionPoint | null = null
  let resizeMoved = false
  let hoverHandle: ResizeHandle | null = null

  // 長押し（タッチ・移動モード）
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressStart: SelectionPoint | null = null
  let touchActive = false

  // 右/中ドラッグのパン
  let panButton: 1 | 2 | null = null
  let panLast: SelectionPoint | null = null
  let panMoved = false
  let rightPanMoved = false

  // dragPanを自分で止めたか（無関係な理由で既に無効な場合に勝手に戻さない）
  let dragPanDisabledByUs = false
  const disableDragPan = (): void => {
    if (dragPanDisabledByUs) return
    map.dragPan.disable()
    dragPanDisabledByUs = true
  }
  const restoreDragPan = (): void => {
    if (!dragPanDisabledByUs) return
    map.dragPan.enable()
    dragPanDisabledByUs = false
  }

  const canvas = map.getCanvas()

  const toLocal = (clientX: number, clientY: number): SelectionPoint => {
    const maybeCanvas = canvas as unknown as {
      getBoundingClientRect?: () => { left: number; top: number }
    }
    const rect =
      typeof maybeCanvas.getBoundingClientRect === 'function'
        ? maybeCanvas.getBoundingClientRect()
        : { left: 0, top: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const setDrawing = (value: boolean): void => {
    drawing = value
    onDrawingChange(value)
  }

  const removeCrosshair = (): void => {
    crosshair?.remove()
    crosshair = null
  }

  const clearLongPress = (): void => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    longPressStart = null
  }

  const unprojectPoint = (point: SelectionPoint): { lng: number; lat: number } =>
    map.unproject([point.x, point.y])

  const previewBoundsAt = (a: SelectionPoint, b: SelectionPoint): SelectionBounds | null => {
    const result = boundsFromLngLat(unprojectPoint(a), unprojectPoint(b))
    return result.ok ? result.bounds : null
  }

  const updateDrawPreview = (a: SelectionPoint, b: SelectionPoint): void => {
    if (isTinyRectangle(a, b)) return
    const bounds = previewBoundsAt(a, b)
    if (bounds !== null) onDrawPreview(bounds)
  }

  const cancelDraw = (): void => {
    if (!drawing && overlay === null && crosshair === null) {
      startPx = null
      currentPx = null
      return
    }
    setDrawing(false)
    startPx = null
    currentPx = null
    restoreDragPan()
    overlay?.remove()
    overlay = null
    removeCrosshair()
    // 描画の中止・確定時は直前の確定表示へ戻す（無ければ消す）。
    onDrawPreview(currentBounds)
  }

  const finishDraw = (): void => {
    const start = startPx
    const end = currentPx
    cancelDraw()
    if (!start || !end) return
    if (isTinyRectangle(start, end)) return
    const result = boundsFromLngLat(unprojectPoint(start), unprojectPoint(end))
    if (!result.ok) {
      onError(result.error)
      return
    }
    currentBounds = result.bounds
    onSelection(result.bounds)
  }

  const cornersOf = (bounds: SelectionBounds): SelectionHandlePoints =>
    selectionHandleScreenPoints(bounds, (lngLat): SelectionPoint => map.project(lngLat))

  // 画面metrics.minGapPx相当の経緯度デルタ（正値）。
  const minGapAt = (
    point: SelectionPoint,
    metrics: HandleMetrics,
  ): { lng: number; lat: number } => {
    const origin = map.unproject([point.x, point.y])
    const right = map.unproject([point.x + metrics.minGapPx, point.y])
    const down = map.unproject([point.x, point.y + metrics.minGapPx])
    return { lng: Math.abs(right.lng - origin.lng), lat: Math.abs(down.lat - origin.lat) }
  }

  const setCursor = (handle: ResizeHandle | null): void => {
    const style = (canvas as { style?: { cursor?: string } }).style
    if (style) style.cursor = handle ? resizeCursor(handle) : ''
  }

  const cancelResize = (): void => {
    resizeHandle = null
    resizeStartBounds = null
    resizeStartPx = null
    resizeMoved = false
    hoverHandle = null
    restoreDragPan()
    setCursor(null)
  }

  const commitResize = (endPoint: SelectionPoint | null): void => {
    if (resizeHandle === null || resizeStartBounds === null || resizeStartPx === null) return
    if (resizeMoved) {
      const next =
        endPoint === null
          ? (currentBounds ?? resizeStartBounds)
          : applyResizeDrag(
              resizeStartBounds,
              resizeHandle,
              unprojectPoint(endPoint),
              minGapAt(endPoint, resizeMetrics),
            )
      const error = validateSelectionBounds(next)
      if (error === null) {
        currentBounds = next
        onSelection(next)
      } else {
        onError(error)
        onPreview(resizeStartBounds)
        currentBounds = resizeStartBounds
      }
    }
    cancelResize()
  }

  const readClientPoint = (e: unknown): SelectionPoint | null => {
    if (typeof e !== 'object' || e === null) return null
    const record = e as Record<string, unknown>
    const clientX = record['clientX']
    const clientY = record['clientY']
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
    return toLocal(clientX, clientY)
  }

  const callPreventDefault = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    const preventDefault = (e as Record<string, unknown>)['preventDefault']
    if (typeof preventDefault === 'function') {
      ;(preventDefault as () => void).call(e)
    }
  }

  const beginDraw = (point: SelectionPoint, e: unknown, showCrosshair: boolean): void => {
    startPx = point
    currentPx = point
    setDrawing(true)
    disableDragPan()
    callPreventDefault(e)
    overlay = createOverlay(canvas)
    removeCrosshair()
    if (showCrosshair) crosshair = createCrosshair(canvas, point)
  }

  const beginResize = (
    point: SelectionPoint,
    handle: ResizeHandle,
    metrics: HandleMetrics,
    e: unknown,
  ): void => {
    resizeHandle = handle
    resizeMetrics = metrics
    resizeStartBounds = currentBounds
    resizeStartPx = point
    resizeMoved = false
    hoverHandle = handle
    onHover(handle)
    disableDragPan()
    callPreventDefault(e)
    setCursor(handle)
  }

  const handleMouseDown = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    const record = e as Record<string, unknown>
    const button = record['button']
    const shiftKey = record['shiftKey']
    if (typeof button !== 'number' || typeof shiftKey !== 'boolean') return
    const pointerType = record['pointerType']
    const resolvedPointerType = typeof pointerType === 'string' ? pointerType : 'mouse'
    const metrics = handleMetricsFor(resolvedPointerType)
    const point = readClientPoint(e)
    if (!point) return

    // 右/中ドラッグはモード非依存のパン。左ドラッグ中は無視する。
    if (button === 1 || button === 2) {
      if (drawing || resizeHandle !== null || panButton !== null) return
      rightPanMoved = false
      panButton = button === 2 ? 2 : 1
      panLast = point
      panMoved = false
      // 中ボタンのオートスクロールを抑止する（右クリック単体のメニューは残す）。
      if (button === 1) callPreventDefault(e)
      return
    }
    if (button !== 0) return
    if (drawing || panButton !== null) return

    // ハンドルはモード・Shiftに関係なく最優先でリサイズ。
    if (currentBounds !== null) {
      const handle = hitTestSelectionHandle(point, cornersOf(currentBounds), metrics)
      if (handle !== null) {
        clearLongPress()
        beginResize(point, handle, metrics, e)
        return
      }
    }

    if (!shouldStartSelection({ button, shiftKey, pointerType: resolvedPointerType, mode })) {
      return
    }
    clearLongPress()
    if (hoverHandle !== null) {
      hoverHandle = null
      onHover(null)
    }
    beginDraw(point, e, false)
  }

  const handleMouseMove = (e: unknown): void => {
    const point = readClientPoint(e)
    if (!point) return

    if (panButton !== null && panLast !== null) {
      const dx = point.x - panLast.x
      const dy = point.y - panLast.y
      if (!panMoved && Math.hypot(dx, dy) < PAN_MOVE_TOLERANCE_PX) return
      panMoved = true
      panLast = point
      map.panBy([-dx, -dy], { animate: false })
      return
    }

    // 確定後リサイズ中: プレビューをライブ更新（DOM boxには触れない）。
    if (resizeHandle !== null && resizeStartBounds !== null && resizeStartPx !== null) {
      const next = applyResizeDrag(
        resizeStartBounds,
        resizeHandle,
        unprojectPoint(point),
        minGapAt(point, resizeMetrics),
      )
      currentBounds = next
      onPreview(next)
      if (!resizeMoved && movedBeyondTolerance(resizeStartPx, point, resizeMetrics.moveTolerancePx)) {
        resizeMoved = true
      }
      return
    }

    if (drawing && startPx) {
      currentPx = point
      overlay?.update(startPx, point)
      updateDrawPreview(startPx, point)
      return
    }

    // 非ドラッグ: 矩形の辺・角ならカーソルを変更。変わったときだけ代入する。
    if (currentBounds === null) return
    const metrics = handleMetricsFor('mouse')
    const nextHover = hitTestSelectionHandle(point, cornersOf(currentBounds), metrics)
    if (nextHover !== hoverHandle) {
      hoverHandle = nextHover
      setCursor(nextHover)
      onHover(nextHover)
    }
  }

  const handleMouseUp = (e: unknown): void => {
    if (panButton !== null) {
      if (panButton === 2 && panMoved) rightPanMoved = true
      panButton = null
      panLast = null
      panMoved = false
      return
    }

    if (resizeHandle !== null && resizeStartBounds !== null && resizeStartPx !== null) {
      const endPoint = readClientPoint(e)
      commitResize(endPoint)
      // mouseup座標でホバーを再判定してカーソルを合わせ直す。
      if (endPoint !== null && currentBounds !== null) {
        const metrics = handleMetricsFor('mouse')
        hoverHandle = hitTestSelectionHandle(endPoint, cornersOf(currentBounds), metrics)
        setCursor(hoverHandle)
        onHover(hoverHandle)
      } else {
        hoverHandle = null
        onHover(null)
      }
      return
    }

    if (!drawing) return
    // canvas外（UIパネル上・キャンバス外など）でmouseupした場合、canvasの
    // mousemoveが届かずcurrentPxが古いまま残る。mouseupの座標で更新してから
    // 確定する。座標が読めないイベントでは従来通り最終mousemoveで確定する。
    const point = readClientPoint(e)
    if (point && startPx) {
      currentPx = point
      overlay?.update(startPx, point)
    }
    finishDraw()
  }

  const handleContextMenu = (e: unknown): void => {
    // 右ドラッグでパンした場合だけメニューを抑止する。
    if (rightPanMoved || (panButton === 2 && panMoved)) {
      callPreventDefault(e)
      rightPanMoved = false
    }
  }

  const handleAuxClick = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    const button = (e as Record<string, unknown>)['button']
    if (button === 1) callPreventDefault(e)
  }

  const readTouchPoint = (e: unknown, index: number): SelectionPoint | null => {
    if (typeof e !== 'object' || e === null) return null
    const touches = (e as Record<string, unknown>)['touches']
    if (typeof touches !== 'object' || touches === null) return null
    const touch = (touches as ArrayLike<{ clientX?: unknown; clientY?: unknown }>)[index]
    if (!touch) return null
    if (typeof touch.clientX !== 'number' || typeof touch.clientY !== 'number') return null
    return toLocal(touch.clientX, touch.clientY)
  }

  const readChangedTouchPoint = (e: unknown): SelectionPoint | null => {
    if (typeof e !== 'object' || e === null) return null
    const changed = (e as Record<string, unknown>)['changedTouches']
    if (typeof changed !== 'object' || changed === null) return null
    const touch = (changed as ArrayLike<{ clientX?: unknown; clientY?: unknown }>)[0]
    if (!touch) return null
    if (typeof touch.clientX !== 'number' || typeof touch.clientY !== 'number') return null
    return toLocal(touch.clientX, touch.clientY)
  }

  const touchCount = (e: unknown): number => {
    if (typeof e !== 'object' || e === null) return 0
    const touches = (e as Record<string, unknown>)['touches']
    if (typeof touches !== 'object' || touches === null) return 0
    const length = (touches as { length?: unknown }).length
    return typeof length === 'number' ? length : 0
  }

  const cancelTwoFingerGesture = (): void => {
    clearLongPress()
    if (drawing) cancelDraw()
    if (resizeHandle !== null) cancelResize()
    restoreDragPan()
  }

  const handleTouchStart = (e: unknown): void => {
    const count = touchCount(e)
    if (count >= 2) {
      cancelTwoFingerGesture()
      touchActive = true
      return
    }
    if (count !== 1) return
    const point = readTouchPoint(e, 0)
    if (!point) return
    touchActive = true

    // ハンドルはタッチでも最優先。
    if (currentBounds !== null) {
      const handle = hitTestSelectionHandle(
        point,
        cornersOf(currentBounds),
        COARSE_HANDLE_METRICS,
      )
      if (handle !== null) {
        clearLongPress()
        beginResize(point, handle, COARSE_HANDLE_METRICS, e)
        return
      }
    }

    if (mode === 'select') {
      clearLongPress()
      beginDraw(point, e, false)
      return
    }

    // 移動モード: 長押しが成立したら矩形描画へ切り替える。
    clearLongPress()
    longPressStart = point
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      const start = longPressStart
      longPressStart = null
      if (!start) return
      if (mode !== 'move' || drawing || resizeHandle !== null || panButton !== null) return
      // 押下点から矩形を開始（指はまだ動いていない前提）。
      beginDraw(start, null, true)
    }, LONG_PRESS_MS)
  }

  const handleTouchMove = (e: unknown): void => {
    if (!touchActive) return
    const count = touchCount(e)
    if (count >= 2) {
      cancelTwoFingerGesture()
      return
    }
    if (count !== 1) return
    const point = readTouchPoint(e, 0)
    if (!point) return

    if (resizeHandle !== null && resizeStartBounds !== null && resizeStartPx !== null) {
      const next = applyResizeDrag(
        resizeStartBounds,
        resizeHandle,
        unprojectPoint(point),
        minGapAt(point, resizeMetrics),
      )
      currentBounds = next
      onPreview(next)
      if (!resizeMoved && movedBeyondTolerance(resizeStartPx, point, resizeMetrics.moveTolerancePx)) {
        resizeMoved = true
      }
      callPreventDefault(e)
      return
    }

    if (drawing && startPx) {
      currentPx = point
      overlay?.update(startPx, point)
      updateDrawPreview(startPx, point)
      callPreventDefault(e)
      return
    }

    // 長押し待ち中に動いたらキャンセルし、MapLibre標準の1本指パンに任せる。
    if (longPressTimer !== null && longPressStart !== null) {
      const moved = Math.hypot(
        point.x - longPressStart.x,
        point.y - longPressStart.y,
      )
      if (moved > LONG_PRESS_MOVE_PX) clearLongPress()
    }
  }

  const handleTouchEnd = (e: unknown): void => {
    if (!touchActive) return
    if (drawing) {
      const point = readChangedTouchPoint(e)
      if (point && startPx) {
        currentPx = point
        overlay?.update(startPx, point)
      }
      finishDraw()
    } else if (resizeHandle !== null) {
      commitResize(readChangedTouchPoint(e))
    }
    clearLongPress()
    if (touchCount(e) === 0) {
      touchActive = false
      restoreDragPan()
    }
  }

  const handleTouchCancel = (): void => {
    clearLongPress()
    if (drawing) cancelDraw()
    if (resizeHandle !== null) cancelResize()
    touchActive = false
    restoreDragPan()
  }

  const handleKeyDown = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    if ((e as Record<string, unknown>)['key'] !== 'Escape') return
    if (resizeHandle !== null) {
      if (resizeStartBounds !== null) {
        onPreview(resizeStartBounds)
        currentBounds = resizeStartBounds
      }
      cancelResize()
      onHover(null)
      return
    }
    cancelDraw()
  }

  const cancelAll = (): void => {
    clearLongPress()
    if (drawing) cancelDraw()
    if (resizeHandle !== null) cancelResize()
    panButton = null
    panLast = null
    panMoved = false
    rightPanMoved = false
    touchActive = false
    restoreDragPan()
  }

  canvas.addEventListener('mousedown', handleMouseDown)
  canvas.addEventListener('mousemove', handleMouseMove)
  canvas.addEventListener('contextmenu', handleContextMenu)
  canvas.addEventListener('auxclick', handleAuxClick)
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false })
  canvas.addEventListener('touchend', handleTouchEnd)
  canvas.addEventListener('touchcancel', handleTouchCancel)
  // ドラッグ中にUIパネル上やキャンバス外へ出ても追跡を継続するためwindowでも受信する
  globalTarget.addEventListener('mousemove', handleMouseMove)
  globalTarget.addEventListener('mouseup', handleMouseUp)
  globalTarget.addEventListener('keydown', handleKeyDown)
  globalTarget.addEventListener('touchmove', handleTouchMove, { passive: false })
  globalTarget.addEventListener('touchend', handleTouchEnd)
  globalTarget.addEventListener('touchcancel', handleTouchCancel)

  return {
    cancel: cancelAll,
    setBounds: (bounds: SelectionBounds | null): void => {
      currentBounds = bounds
    },
    setMode: (next: MapInteractionMode): void => {
      if (next === mode) return
      cancelAll()
      mode = next
      // モード切替でカーソルが残らないようにする。
      setCursor(null)
      onHover(null)
    },
    destroy: (): void => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      canvas.removeEventListener('auxclick', handleAuxClick)
      canvas.removeEventListener('touchstart', handleTouchStart)
      canvas.removeEventListener('touchmove', handleTouchMove)
      canvas.removeEventListener('touchend', handleTouchEnd)
      canvas.removeEventListener('touchcancel', handleTouchCancel)
      globalTarget.removeEventListener('mousemove', handleMouseMove)
      globalTarget.removeEventListener('mouseup', handleMouseUp)
      globalTarget.removeEventListener('keydown', handleKeyDown)
      globalTarget.removeEventListener('touchmove', handleTouchMove)
      globalTarget.removeEventListener('touchend', handleTouchEnd)
      globalTarget.removeEventListener('touchcancel', handleTouchCancel)
      cancelAll()
      onHover(null)
      restoreDragPan()
      map.boxZoom.enable()
    },
    // モバイル代替「現在の表示範囲を選択」。
    selectCurrentView: (): void => {
      const b = map.getBounds()
      const result = coerceCurrentViewBounds({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      })
      if (!result.ok) {
        onError(result.error)
        return
      }
      currentBounds = result.bounds
      onSelection(result.bounds)
    },
  }
}

/** MapLibre版フック。Cesium版useRectangleSelectionとは独立（SelectionBounds形状は互換）。 */
export function useMapLibreRectangleSelection(
  map: SelectionMapLike | null,
  onPreview?: (bounds: SelectionBounds) => void,
  onHover?: (handle: ResizeHandle | null) => void,
  onDrawPreview?: (bounds: SelectionBounds | null) => void,
  mode: MapInteractionMode = 'move',
): {
  selectionBounds: SelectionBounds | null
  setSelectionBounds: Dispatch<SetStateAction<SelectionBounds | null>>
  isDrawing: boolean
  errorMessage: string | null
  clearError: () => void
  reset: () => void
  selectCurrentView: () => void
} {
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const controllerRef = useRef<SelectionController | null>(null)
  // 最新のonPreview・onHover・boundsをrefで保持し、コントローラーeffectの依存を[map]に保つ。
  const onPreviewRef = useRef(onPreview)
  const onHoverRef = useRef(onHover)
  const onDrawPreviewRef = useRef(onDrawPreview)
  const modeRef = useRef<MapInteractionMode>(mode)
  const boundsRef = useRef<SelectionBounds | null>(null)

  useEffect(() => {
    onPreviewRef.current = onPreview
  }, [onPreview])

  useEffect(() => {
    onDrawPreviewRef.current = onDrawPreview
  }, [onDrawPreview])

  useEffect(() => {
    onHoverRef.current = onHover
  }, [onHover])

  useEffect(() => {
    modeRef.current = mode
    controllerRef.current?.setMode(mode)
  }, [mode])

  useEffect(() => {
    if (!map || typeof window === 'undefined') return
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: window,
      mode: modeRef.current,
      onSelection: (bounds: SelectionBounds): void => {
        setErrorMessage(null)
        setSelectionBounds(bounds)
      },
      onPreview: (bounds: SelectionBounds): void => {
        onPreviewRef.current?.(bounds)
      },
      onDrawPreview: (bounds: SelectionBounds | null): void => {
        onDrawPreviewRef.current?.(bounds)
      },
      onHover: (handle: ResizeHandle | null): void => {
        onHoverRef.current?.(handle)
      },
      onError: (message: string): void => {
        setErrorMessage(message)
      },
      onDrawingChange: setIsDrawing,
    })
    controllerRef.current = controller
    controller.setBounds(boundsRef.current)
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [map])

  useEffect(() => {
    boundsRef.current = selectionBounds
    controllerRef.current?.setBounds(selectionBounds)
  }, [selectionBounds])

  const clearError = useCallback((): void => {
    setErrorMessage(null)
  }, [])

  const reset = useCallback((): void => {
    controllerRef.current?.cancel()
    setIsDrawing(false)
    setSelectionBounds(null)
    setErrorMessage(null)
  }, [])

  const selectCurrentView = useCallback((): void => {
    controllerRef.current?.selectCurrentView()
  }, [])

  return {
    selectionBounds,
    setSelectionBounds,
    isDrawing,
    errorMessage,
    clearError,
    reset,
    selectCurrentView,
  }
}
