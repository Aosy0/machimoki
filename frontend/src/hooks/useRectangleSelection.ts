import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Viewer,
  Cartesian2,
  Math as CesiumMath,
  Rectangle,
  Entity,
  Color,
  CallbackProperty,
  Cartographic,
} from 'cesium'

export interface SelectionBounds {
  west: number
  south: number
  east: number
  north: number
}

export function useRectangleSelection(viewer: Viewer | null) {
  const [selectionBounds, setSelectionBounds] = useState<SelectionBounds | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const startCartographic = useRef<Cartographic | null>(null)
  const currentCartographic = useRef<Cartographic | null>(null)
  const rectangleEntity = useRef<Entity | null>(null)
  const isDrawingRef = useRef(false)

  const validateSelection = useCallback(
    (west: number, south: number, east: number, north: number): string | null => {
      const width = CesiumMath.toRadians(east - west) * 6371000
      const height = CesiumMath.toRadians(north - south) * 6371000
      const areaKm2 = (width * height) / 1_000_000
      if (areaKm2 > 1000.0) {
        return `選択範囲が広すぎます（${areaKm2.toFixed(2)} km²）。最大1000km²まで。`
      }
      return null
    },
    []
  )

  const clearError = useCallback(() => {
    setErrorMessage(null)
  }, [])

  const reset = useCallback(() => {
    if (viewer && rectangleEntity.current) {
      viewer.entities.remove(rectangleEntity.current)
    }
    rectangleEntity.current = null
    startCartographic.current = null
    currentCartographic.current = null
    isDrawingRef.current = false
    setIsDrawing(false)
    setSelectionBounds(null)
    setErrorMessage(null)
  }, [viewer])

  useEffect(() => {
    if (!viewer) return

    const canvas = viewer.scene.canvas

    const startSelection = (position: Cartesian2) => {
      const cartesian = viewer.camera.pickEllipsoid(position)
      if (!cartesian) return

      const carto = Cartographic.fromCartesian(cartesian)
      startCartographic.current = carto
      isDrawingRef.current = true
      setIsDrawing(true)

      rectangleEntity.current = viewer.entities.add({
        rectangle: {
          coordinates: new CallbackProperty(() => {
            if (!startCartographic.current) return Rectangle.fromDegrees(0, 0, 0, 0)
            const current = currentCartographic.current
            if (!current)
              return Rectangle.fromDegrees(
                CesiumMath.toDegrees(startCartographic.current.longitude),
                CesiumMath.toDegrees(startCartographic.current.latitude),
                CesiumMath.toDegrees(startCartographic.current.longitude),
                CesiumMath.toDegrees(startCartographic.current.latitude)
              )
            return Rectangle.fromDegrees(
              Math.min(
                CesiumMath.toDegrees(startCartographic.current.longitude),
                CesiumMath.toDegrees(current.longitude)
              ),
              Math.min(
                CesiumMath.toDegrees(startCartographic.current.latitude),
                CesiumMath.toDegrees(current.latitude)
              ),
              Math.max(
                CesiumMath.toDegrees(startCartographic.current.longitude),
                CesiumMath.toDegrees(current.longitude)
              ),
              Math.max(
                CesiumMath.toDegrees(startCartographic.current.latitude),
                CesiumMath.toDegrees(current.latitude)
              )
            )
          }, false),
          material: Color.CYAN.withAlpha(0.3),
          outline: true,
          outlineColor: Color.CYAN,
        },
      })
    }

    const updateSelection = (position: Cartesian2) => {
      if (!isDrawingRef.current) return
      const cartesian = viewer.camera.pickEllipsoid(position)
      if (!cartesian) return
      currentCartographic.current = Cartographic.fromCartesian(cartesian)
    }

    const finishSelection = () => {
      if (!isDrawingRef.current || !startCartographic.current || !rectangleEntity.current) return
      isDrawingRef.current = false
      setIsDrawing(false)

      const current = currentCartographic.current
      if (!current) {
        viewer.entities.remove(rectangleEntity.current)
        rectangleEntity.current = null
        startCartographic.current = null
        currentCartographic.current = null
        return
      }

      const west = CesiumMath.toDegrees(
        Math.min(startCartographic.current.longitude, current.longitude)
      )
      const south = CesiumMath.toDegrees(
        Math.min(startCartographic.current.latitude, current.latitude)
      )
      const east = CesiumMath.toDegrees(
        Math.max(startCartographic.current.longitude, current.longitude)
      )
      const north = CesiumMath.toDegrees(
        Math.max(startCartographic.current.latitude, current.latitude)
      )

      const validationError = validateSelection(west, south, east, north)
      if (validationError) {
        setErrorMessage(validationError)
        viewer.entities.remove(rectangleEntity.current)
        rectangleEntity.current = null
        startCartographic.current = null
        currentCartographic.current = null
        return
      }

      setErrorMessage(null)
      setSelectionBounds({ west, south, east, north })

      viewer.entities.remove(rectangleEntity.current)
      rectangleEntity.current = null
      startCartographic.current = null
      currentCartographic.current = null
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button === 0 && e.shiftKey) {
        e.stopPropagation()
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {}
        startSelection(new Cartesian2(e.offsetX, e.offsetY))
      }
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDrawingRef.current) return
      e.stopPropagation()
      updateSelection(new Cartesian2(e.offsetX, e.offsetY))
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!isDrawingRef.current) return
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {}
      finishSelection()
    }

    const handlePointerLeave = () => {
      if (isDrawingRef.current) {
        if (rectangleEntity.current) {
          viewer.entities.remove(rectangleEntity.current)
          rectangleEntity.current = null
        }
        startCartographic.current = null
        currentCartographic.current = null
        isDrawingRef.current = false
        setIsDrawing(false)
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown, { capture: true })
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [viewer, validateSelection])

  return {
    selectionBounds,
    setSelectionBounds,
    isDrawing,
    errorMessage,
    clearError,
    reset,
  }
}
