import { useEffect } from 'react'
import { Cartesian2, Cartographic, Math as CesiumMath, type Viewer } from 'cesium'

export interface PickPoint {
  lon: number
  lat: number
}

export function usePointPicking(
  viewer: Viewer | null,
  active: boolean,
  onPick: (point: PickPoint) => void
) {
  useEffect(() => {
    if (!viewer || !active) return

    const canvas = viewer.scene.canvas

    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.shiftKey) return
      e.stopPropagation()
      const cartesian = viewer.camera.pickEllipsoid(new Cartesian2(e.offsetX, e.offsetY))
      if (!cartesian) return
      const carto = Cartographic.fromCartesian(cartesian)
      onPick({
        lon: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
      })
    }

    canvas.addEventListener('pointerdown', handlePointerDown, { capture: true })
    return () => canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true })
  }, [viewer, active, onPick])
}
