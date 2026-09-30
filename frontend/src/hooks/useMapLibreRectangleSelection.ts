import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from 'react'
import { boundsFromLngLat, validateSelectionBounds } from '../lib/selectionBounds'

export type { SelectionBounds } from '../lib/selectionBounds'
import type { SelectionBounds } from '../lib/selectionBounds'
import {
  applyResizeDrag,
  hitTestSelectionHandle,
  movedBeyondTolerance,
  resizeCursor,
  selectionHandleScreenPoints,
  RESIZE_MIN_GAP_PX,
  type ResizeHandle,
  type SelectionHandlePoints,
} from '../lib/mapSelectionResize'

/** 微小矩形のしきい値（px）。これ未満はクリック扱いで選択にしない。 */
export const MIN_SELECTION_PIXELS = 5

export interface SelectionPoint {
  x: number
  y: number
}

export interface MouseButtonEventLike {
  button: number
  shiftKey: boolean
  pointerType?: string
}

/** 開始条件: 左ボタン+Shift+マウスのみ。右・ホイール・タッチは開始しない。 */
export function shouldStartSelection(e: MouseButtonEventLike): boolean {
  if (e.button !== 0) return false
  if (!e.shiftKey) return false
  if (e.pointerType !== undefined && e.pointerType !== 'mouse') return false
  return true
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
  globalTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  onSelection: (bounds: SelectionBounds) => void
  onPreview?: (bounds: SelectionBounds) => void
  /** ホバーハンドルの変化通知（ハイライト用。ヒットテスト結果と完全整合） */
  onHover?: (handle: ResizeHandle | null) => void
  onError?: (message: string) => void
  onDrawingChange?: (drawing: boolean) => void
}

export interface SelectionController {
  destroy(): void
  cancel(): void
  selectCurrentView(): void
  setBounds(bounds: SelectionBounds | null): void
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

/**
 * MapLibre用矩形選択コントローラー（React非依存・既存Cesium経路に無干渉）。
 * - 生成時にboxZoomを抑止し、破棄時に戻す（通常ドラッグ=パン、ダブルクリック=ズームは既定のまま）
 * - Shift+ドラッグ=選択。地図外mouseup・remove時の解除、Esc=取消
 */
export function createMapLibreSelectionController(
  options: SelectionControllerOptions,
): SelectionController {
  const { map, globalTarget, onSelection } = options
  const onPreview = options.onPreview ?? ((): void => {})
  const onHover = options.onHover ?? ((): void => {})
  const onError = options.onError ?? ((): void => {})
  const onDrawingChange = options.onDrawingChange ?? ((): void => {})

  map.boxZoom.disable()

  let drawing = false
  let shiftAtStart = false
  let startPx: SelectionPoint | null = null
  let currentPx: SelectionPoint | null = null
  let overlay: SelectionOverlay | null = null

  // 確定後リサイズ用の状態
  let currentBounds: SelectionBounds | null = null
  let resizeHandle: ResizeHandle | null = null
  let resizeStartBounds: SelectionBounds | null = null
  let resizeStartPx: SelectionPoint | null = null
  let resizeMoved = false
  let hoverHandle: ResizeHandle | null = null

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

  const cancelDraw = (): void => {
    setDrawing(false)
    startPx = null
    currentPx = null
    map.dragPan.enable()
    overlay?.remove()
    overlay = null
  }

  const finish = (): void => {
    const start = startPx
    const end = currentPx
    cancelDraw()
    if (!start || !end) return
    // 開始時modifier採用: 開始時にShiftがなければ確定しない
    if (!shiftAtStart) return
    if (isTinyRectangle(start, end)) return
    const a = map.unproject([start.x, start.y])
    const b = map.unproject([end.x, end.y])
    const result = boundsFromLngLat(a, b)
    if (!result.ok) {
      onError(result.error)
      return
    }
    onSelection(result.bounds)
  }

  const readLngLat = (point: SelectionPoint): { lng: number; lat: number } =>
    map.unproject([point.x, point.y])

  const cornersOf = (bounds: SelectionBounds): SelectionHandlePoints =>
    selectionHandleScreenPoints(bounds, (lngLat): SelectionPoint => map.project(lngLat))

  // 画面RESIZE_MIN_GAP_PX相当の経緯度デルタ（正値）。
  const minGapAt = (point: SelectionPoint): { lng: number; lat: number } => {
    const origin = map.unproject([point.x, point.y])
    const right = map.unproject([point.x + RESIZE_MIN_GAP_PX, point.y])
    const down = map.unproject([point.x, point.y + RESIZE_MIN_GAP_PX])
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
    map.dragPan.enable()
    setCursor(null)
  }

  const readClientPoint = (e: unknown): SelectionPoint | null => {
    if (typeof e !== 'object' || e === null) return null
    const record = e as Record<string, unknown>
    const clientX = record['clientX']
    const clientY = record['clientY']
    if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
    return toLocal(clientX, clientY)
  }

  const handleMouseDown = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    const record = e as Record<string, unknown>
    const button = record['button']
    const shiftKey = record['shiftKey']
    if (typeof button !== 'number' || typeof shiftKey !== 'boolean') return
    const pointerType = record['pointerType']
    const resolvedPointerType = typeof pointerType === 'string' ? pointerType : 'mouse'
    const preventDefault = record['preventDefault']
    const callPreventDefault = (): void => {
      if (typeof preventDefault === 'function') {
        ;(preventDefault as () => void).call(e)
      }
    }

    // Shift+ドラッグは従来どおり新規選択を優先する。
    if (shouldStartSelection({ button, shiftKey, pointerType: resolvedPointerType })) {
      const point = readClientPoint(e)
      if (!point) return
      // 通常起きないが、リサイズ状態が残っていれば先に片付ける。
      if (resizeHandle !== null) cancelResize()
      // 古い矩形のホバー強調を消す（新規選択中はハイライト不要）。
      if (hoverHandle !== null) {
        hoverHandle = null
        onHover(null)
      }
      shiftAtStart = shiftKey
      startPx = point
      currentPx = point
      setDrawing(true)
      map.dragPan.disable()
      callPreventDefault()
      overlay = createOverlay(canvas)
      return
    }

    // Shiftなしの通常押下: 確定済み矩形の辺・角ならリサイズ開始。それ以外はパンに任せる。
    if (button !== 0 || resolvedPointerType !== 'mouse') return
    if (drawing || currentBounds === null) return
    const point = readClientPoint(e)
    if (!point) return
    const handle = hitTestSelectionHandle(point, cornersOf(currentBounds))
    if (handle === null) return
    resizeHandle = handle
    resizeStartBounds = currentBounds
    resizeStartPx = point
    resizeMoved = false
    // リサイズ中もアクティブなハンドルの強調を維持する（位置追従はpreview経由）。
    hoverHandle = handle
    onHover(handle)
    map.dragPan.disable()
    callPreventDefault()
    setCursor(handle)
  }

  const handleMouseMove = (e: unknown): void => {
    const point = readClientPoint(e)
    if (!point) return

    // 確定後リサイズ中: プレビューをライブ更新（DOM boxには触れない）。
    if (resizeHandle !== null && resizeStartBounds !== null && resizeStartPx !== null) {
      const next = applyResizeDrag(
        resizeStartBounds,
        resizeHandle,
        readLngLat(point),
        minGapAt(point),
      )
      currentBounds = next
      onPreview(next)
      if (!resizeMoved && movedBeyondTolerance(resizeStartPx, point)) {
        resizeMoved = true
      }
      return
    }

    if (drawing && startPx) {
      currentPx = point
      overlay?.update(startPx, point)
      return
    }

    // 非ドラッグ: 矩形の辺・角ならカーソルを変更。変わったときだけ代入する。
    if (currentBounds === null) return
    const nextHover = hitTestSelectionHandle(point, cornersOf(currentBounds))
    if (nextHover !== hoverHandle) {
      hoverHandle = nextHover
      setCursor(nextHover)
      onHover(nextHover)
    }
  }

  const handleMouseUp = (e: unknown): void => {
    if (resizeHandle !== null && resizeStartBounds !== null && resizeStartPx !== null) {
      if (resizeMoved) {
        // window mouseupで座標が取れる場合は最終点で再計算する。
        const point = readClientPoint(e)
        const next =
          point === null
            ? currentBounds ?? resizeStartBounds
            : applyResizeDrag(
                resizeStartBounds,
                resizeHandle,
                readLngLat(point),
                minGapAt(point),
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
      // mouseup座標でホバーを再判定してカーソルを合わせ直す。
      // 判定結果はそのまま通知する（矩形外ならnullでハイライト消灯）。
      const endPoint = readClientPoint(e)
      if (endPoint !== null && currentBounds !== null) {
        hoverHandle = hitTestSelectionHandle(endPoint, cornersOf(currentBounds))
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
    finish()
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

  canvas.addEventListener('mousedown', handleMouseDown)
  canvas.addEventListener('mousemove', handleMouseMove)
  // ドラッグ中にUIパネル上やキャンバス外へ出ても追跡を継続するためwindowでも受信する
  globalTarget.addEventListener('mousemove', handleMouseMove)
  globalTarget.addEventListener('mouseup', handleMouseUp)
  globalTarget.addEventListener('keydown', handleKeyDown)

  return {
    cancel: cancelDraw,
    setBounds: (bounds: SelectionBounds | null): void => {
      currentBounds = bounds
    },
    destroy: (): void => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      globalTarget.removeEventListener('mousemove', handleMouseMove)
      globalTarget.removeEventListener('mouseup', handleMouseUp)
      globalTarget.removeEventListener('keydown', handleKeyDown)
      cancelDraw()
      cancelResize()
      onHover(null)
      map.boxZoom.enable()
    },
    // モバイル代替「現在の表示範囲を選択」。
    selectCurrentView: (): void => {
      const b = map.getBounds()
      const candidate: SelectionBounds = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      }
      const error = validateSelectionBounds(candidate)
      if (error !== null) {
        onError(error)
        return
      }
      onSelection(candidate)
    },
  }
}

/** MapLibre版フック。Cesium版useRectangleSelectionとは独立（SelectionBounds形状は互換）。 */
export function useMapLibreRectangleSelection(
  map: SelectionMapLike | null,
  onPreview?: (bounds: SelectionBounds) => void,
  onHover?: (handle: ResizeHandle | null) => void,
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
  const boundsRef = useRef<SelectionBounds | null>(null)

  useEffect(() => {
    onPreviewRef.current = onPreview
  }, [onPreview])

  useEffect(() => {
    onHoverRef.current = onHover
  }, [onHover])

  useEffect(() => {
    if (!map || typeof window === 'undefined') return
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: window,
      onSelection: (bounds: SelectionBounds): void => {
        setErrorMessage(null)
        setSelectionBounds(bounds)
      },
      onPreview: (bounds: SelectionBounds): void => {
        onPreviewRef.current?.(bounds)
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

/** モバイル代替の「現在の表示範囲を選択」ボタン。配線は呼び出し側で行う。 */
export function CurrentViewSelectionButton({
  onSelectCurrentView,
}: {
  onSelectCurrentView: () => void
}): ReactElement {
  return createElement(
    'button',
    { type: 'button', 'data-testid': 'select-current-view', onClick: onSelectCurrentView },
    '現在の表示範囲を選択',
  )
}
