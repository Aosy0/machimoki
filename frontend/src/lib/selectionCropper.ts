import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import { getSelectionSizeMeters } from './enuCoordinates'

export interface CropOptions {
  geometry: BufferGeometry
  selectionBounds: SelectionBounds
  manifoldModule: any
}

export function cropGeometryToSelection(options: CropOptions): BufferGeometry {
  const { geometry, selectionBounds } = options

  const { width, height: depth } = getSelectionSizeMeters(selectionBounds)
  const tileMarginMeters = 10000
  const halfWidth = width / 2 + tileMarginMeters
  const halfDepth = depth / 2 + tileMarginMeters

  const posAttr = geometry.attributes.position
  if (!posAttr) return new BufferGeometry()

  const positions = posAttr.array as Float32Array
  const vertexCount = posAttr.count

  const indices = geometry.index ? (geometry.index.array as Uint32Array) : null

  if (indices) {
    const keptTriangles: number[] = []
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]
      const b = indices[i + 1]
      const c = indices[i + 2]

      const ax = positions[a * 3]
      const az = positions[a * 3 + 2]
      const bx = positions[b * 3]
      const bz = positions[b * 3 + 2]
      const cx = positions[c * 3]
      const cz = positions[c * 3 + 2]

      if (
        Math.abs(ax) <= halfWidth && Math.abs(az) <= halfDepth &&
        Math.abs(bx) <= halfWidth && Math.abs(bz) <= halfDepth &&
        Math.abs(cx) <= halfWidth && Math.abs(cz) <= halfDepth
      ) {
        keptTriangles.push(a, b, c)
      }
    }

    if (keptTriangles.length === 0) return new BufferGeometry()

    const resultGeo = new BufferGeometry()
    resultGeo.setAttribute('position', new Float32BufferAttribute(positions.slice(), 3))
    resultGeo.setIndex(new Uint32BufferAttribute(keptTriangles, 1))
    resultGeo.computeVertexNormals()
    return resultGeo
  } else {
    const keptPositions: number[] = []
    for (let i = 0; i < vertexCount; i++) {
      const x = positions[i * 3]
      const z = positions[i * 3 + 2]
      if (Math.abs(x) <= halfWidth && Math.abs(z) <= halfDepth) {
        keptPositions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      }
    }

    if (keptPositions.length === 0) return new BufferGeometry()

    const resultGeo = new BufferGeometry()
    resultGeo.setAttribute('position', new Float32BufferAttribute(keptPositions, 3))
    resultGeo.computeVertexNormals()
    return resultGeo
  }
}
