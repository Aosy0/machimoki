/**
 * MapLibre GL JS 用の矩形選択フック。
 *
 * - Shift+ドラッグで選択、通常ドラッグ=パン、ダブルクリック=ズーム
 * - Esc でキャンセル
 * - 右クリック・ホイール・タッチでは選択開始しない
 * - 地図外 mouseup・remove 時のリスナー解除
 * - 開始時 modifier を採用し途中 Shift 離しも継続
 * - クリック同然の微小矩形は選択にしない
 * - 上限超過時は既存 bounds 破棄せずエラー＋再選択可
 *
 * 既存 Cesium 版（useRectangleSelection）とは独立。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { SelectionBounds } from './useRectangleSelection'
import {
  pixelBoundsToSelectionBounds,
  validateArea,
  type PixelPoint,
} from '../lib/selectionLogic'

export function useRectangleSelectionMapLibre(map: MapLibreMap | null) {
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const startPointRef = useRef<PixelPoint | null>(null)
  const isDrawingRef = useRef(false)
  const selectionBoundsRef = useRef<SelectionBounds | null>(null)

  // selectionBounds を ref にも保持（上限超過時の既存bounds維持用）
  useEffect(() => {
    selectionBoundsRef.current = selectionBounds
  }, [selectionBounds])

  const clearError = useCallback(() => {
    setErrorMessage(null)
  }, [])

  const reset = useCallback(() => {
    startPointRef.current = null
    isDrawingRef.current = false
    setIsDrawing(false)
    setSelectionBounds(null)
    setErrorMessage(null)
  }, [])

  useEffect(() => {
    if (!map) return

    const handleMouseDown = (e: MapMouseEvent) => {
      const originalEvent = e.originalEvent
      // Shift+左クリックのみ選択開始
      if (!originalEvent.shiftKey || originalEvent.button !== 0) return

      e.preventDefault()

      startPointRef.current = { x: originalEvent.clientX, y: originalEvent.clientY }
      isDrawingRef.current = true
      setIsDrawing(true)

      // パン操作を無効化（選択中）
      map.dragPan.disable()
    }

    const handleMouseMove = (e: MapMouseEvent) => {
      if (!isDrawingRef.current || !startPointRef.current) return
      e.preventDefault()

      // 描画用の矩形表示は省略（必要に応じてOverlayで描画）
      // bounds は確定時のみ使用
    }

    const handleMouseUp = (e: MapMouseEvent) => {
      if (!isDrawingRef.current || !startPointRef.current) return
      e.preventDefault()

      const currentPoint: PixelPoint = { x: e.originalEvent.clientX, y: e.originalEvent.clientY }
      const bounds = pixelBoundsToSelectionBounds(
        startPointRef.current,
        currentPoint,
        (point) => {
          const lngLat = map.unproject([point.x, point.y])
          return { lng: lngLat.lng, lat: lngLat.lat }
        },
      )

      // パン操作を再有効化
      map.dragPan.enable()

      startPointRef.current = null
      isDrawingRef.current = false
      setIsDrawing(false)

      if (!bounds) {
        // 微小矩形または変換失敗
        return
      }

      // 面積上限チェック
      const areaError = validateArea(bounds)
      if (areaError) {
        setErrorMessage(areaError)
        // 既存 bounds は維持（破棄しない）
        return
      }

      setErrorMessage(null)
      setSelectionBounds(bounds)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawingRef.current) {
        startPointRef.current = null
        isDrawingRef.current = false
        setIsDrawing(false)
        map.dragPan.enable()
      }
    }

    const handleWindowMouseUp = () => {
      // 地図外でmouseupされた場合のクリーンアップ
      if (isDrawingRef.current) {
        startPointRef.current = null
        isDrawingRef.current = false
        setIsDrawing(false)
        map.dragPan.enable()
      }
    }

    const handleRemove = () => {
      // map remove時のクリーンアップ
      if (isDrawingRef.current) {
        startPointRef.current = null
        isDrawingRef.current = false
        setIsDrawing(false)
      }
    }

    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('remove', handleRemove)
    window.addEventListener('mouseup', handleWindowMouseUp)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      map.off('mousedown', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('remove', handleRemove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
      // クリーンアップ時にパンを再有効化
      if (map.dragPan) {
        map.dragPan.enable()
      }
    }
  }, [map])

  return {
    selectionBounds,
    setSelectionBounds,
    isDrawing,
    errorMessage,
    clearError,
    reset,
  }
}
