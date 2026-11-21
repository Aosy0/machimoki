import { describe, expect, it } from 'vitest'

import {
  FINAL_SHAPE_CACHE_VERSION,
  finalShapeGeometryKey,
  type FinalShapeGeometryParams,
} from './finalShapeKey'

const base: FinalShapeGeometryParams = {
  bounds: { west: 139.68, south: 35.68, east: 139.7, north: 35.7 },
  lod: 'lod1',
  terrainThickness: 1,
  flattenBottom: true,
  includeTerrain: true,
  scale: 1 / 1000,
}

describe('finalShapeGeometryKey', () => {
  it('layers が違えば別キーになり、未指定は空文字と同じ', () => {
    const none = finalShapeGeometryKey(base)
    const empty = finalShapeGeometryKey({ ...base, layers: '' })
    const brid = finalShapeGeometryKey({ ...base, layers: 'brid' })
    const both = finalShapeGeometryKey({ ...base, layers: 'brid,tran' })

    expect(empty).toBe(none)
    expect(brid).not.toBe(none)
    expect(both).not.toBe(brid)
    expect(JSON.parse(none).layers).toBe('')
    expect(JSON.parse(both).layers).toBe('brid,tran')
  })

  it('キーのバージョンは 13', () => {
    expect(FINAL_SHAPE_CACHE_VERSION).toBe(13)
    expect(JSON.parse(finalShapeGeometryKey(base)).v).toBe(13)
  })

  it('色はキーに含めない', () => {
    // 色は形状に影響しないため、同じ形状パラメータなら色に関係なく同一キー。
    const key = JSON.parse(finalShapeGeometryKey(base)) as Record<string, unknown>
    for (const colorKey of ['buildingColor', 'terrainColor', 'bridgeColor', 'roadColor']) {
      expect(key).not.toHaveProperty(colorKey)
    }
  })
})
