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
  onError?: (message: string) => void
  onDrawingChange?: (drawing: boolean) => void
}

export interface SelectionController {
  destroy(): void
  cancel(): void
  selectCurrentView(): void
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
  const onError = options.onError ?? ((): void => {})
  const onDrawingChange = options.onDrawingChange ?? ((): void => {})

  map.boxZoom.disable()

  let drawing = false
  let shiftAtStart = false
  let startPx: SelectionPoint | null = null
  let currentPx: SelectionPoint | null = null
  let overlay: SelectionOverlay | null = null

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
    if (
      !shouldStartSelection({
        button,
        shiftKey,
        pointerType: typeof pointerType === 'string' ? pointerType : 'mouse',
      })
    ) {
      return
    }
    const point = readClientPoint(e)
    if (!point) return
    shiftAtStart = shiftKey
    startPx = point
    currentPx = point
    setDrawing(true)
    map.dragPan.disable()
    const preventDefault = record['preventDefault']
    if (typeof preventDefault === 'function') {
      ;(preventDefault as () => void).call(e)
    }
    overlay = createOverlay(canvas)
  }

  const handleMouseMove = (e: unknown): void => {
    if (!drawing || !startPx) return
    const point = readClientPoint(e)
    if (!point) return
    currentPx = point
    overlay?.update(startPx, point)
  }

  const handleMouseUp = (): void => {
    if (!drawing) return
    finish()
  }

  const handleKeyDown = (e: unknown): void => {
    if (typeof e !== 'object' || e === null) return
    if ((e as Record<string, unknown>)['key'] === 'Escape') cancelDraw()
  }

  canvas.addEventListener('mousedown', handleMouseDown)
  canvas.addEventListener('mousemove', handleMouseMove)
  globalTarget.addEventListener('mouseup', handleMouseUp)
  globalTarget.addEventListener('keydown', handleKeyDown)

  return {
    cancel: cancelDraw,
    destroy: (): void => {
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('mousemove', handleMouseMove)
      globalTarget.removeEventListener('mouseup', handleMouseUp)
      globalTarget.removeEventListener('keydown', handleKeyDown)
      cancelDraw()
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
export function useMapLibreRectangleSelection(map: SelectionMapLike | null): {
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

  useEffect(() => {
    if (!map || typeof window === 'undefined') return
    const controller = createMapLibreSelectionController({
      map,
      globalTarget: window,
      onSelection: (bounds: SelectionBounds): void => {
        setErrorMessage(null)
        setSelectionBounds(bounds)
      },
      onError: (message: string): void => {
        setErrorMessage(message)
      },
      onDrawingChange: setIsDrawing,
    })
    controllerRef.current = controller
    return () => {
      controller.destroy()
      controllerRef.current = null
    }
  }, [map])

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
