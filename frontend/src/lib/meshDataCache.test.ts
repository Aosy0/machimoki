import { describe, expect, it, vi } from 'vitest'

import {
  buildingMeshesKey,
  createLatestPromiseCache,
  meshDatasetKey,
  terrainMeshKey,
  type MeshDatasetParams,
} from './meshDataCache'

const baseParams: MeshDatasetParams = {
  bounds: { west: 139.68, south: 35.68, east: 139.7, north: 35.7 },
  lod: 'lod1',
  includeTerrain: true,
  terrainThicknessMeters: 0.01,
  flattenBottom: true,
}

describe('建物/地形の取得キー', () => {
  it('除外IDの順序・空配列・undefined を同一視する', () => {
    const a = buildingMeshesKey({ ...baseParams, excludedGmlIds: ['b', 'a'] })
    const b = buildingMeshesKey({ ...baseParams, excludedGmlIds: ['a', 'b'] })
    const empty = buildingMeshesKey({ ...baseParams, excludedGmlIds: [] })
    const none = buildingMeshesKey({ ...baseParams })
    expect(a).toBe(b)
    expect(empty).toBe(none)
  })

  it('bounds や lod が変われば建物キーが変わる', () => {
    const key = buildingMeshesKey(baseParams)
    expect(buildingMeshesKey({ ...baseParams, lod: 'lod2' })).not.toBe(key)
    expect(
      buildingMeshesKey({
        ...baseParams,
        bounds: { ...baseParams.bounds, east: 139.71 },
      }),
    ).not.toBe(key)
  })

  it('地形キーは gridSize の null/undefined を同一視し、厚みで変わる', () => {
    const a = terrainMeshKey({ ...baseParams, terrainGridSize: null })
    const b = terrainMeshKey({ ...baseParams, terrainGridSize: undefined })
    expect(a).toBe(b)
    expect(terrainMeshKey({ ...baseParams, terrainThicknessMeters: 0.02 })).not.toBe(a)
  })

  it('includeTerrain=false のデータセットキーは地形条件に依存しない', () => {
    const offA = meshDatasetKey({ ...baseParams, includeTerrain: false })
    const offB = meshDatasetKey({
      ...baseParams,
      includeTerrain: false,
      terrainThicknessMeters: 0.5,
      terrainGridSize: 256,
    })
    expect(offA).toBe(offB)

    const onA = meshDatasetKey({ ...baseParams, includeTerrain: true })
    const onB = meshDatasetKey({
      ...baseParams,
      includeTerrain: true,
      terrainThicknessMeters: 0.5,
    })
    expect(onA).not.toBe(onB)
  })
})

describe('createLatestPromiseCache', () => {
  it('同じキーには同じ Promise を返し、ローダーを1回だけ呼ぶ', async () => {
    const cache = createLatestPromiseCache<number>()
    const load = vi.fn(async () => 1)
    const first = cache.get('a', load)
    const second = cache.get('a', load)
    expect(second).toBe(first)
    await first
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.currentKey()).toBe('a')
  })

  it('キーが変わると再ロードし、最新1件だけ保持する', async () => {
    const cache = createLatestPromiseCache<number>()
    const loadA = vi.fn(async () => 1)
    const loadB = vi.fn(async () => 2)
    await cache.get('a', loadA)
    expect(await cache.get('b', loadB)).toBe(2)
    expect(cache.currentKey()).toBe('b')
    // 'a' は淘汰済みなので再度ロードされる
    await cache.get('a', loadA)
    expect(loadA).toHaveBeenCalledTimes(2)
  })

  it('失敗した Promise は保持を解除して次回リトライできる', async () => {
    const cache = createLatestPromiseCache<number>()
    const failing = vi.fn(async () => {
      throw new Error('fail')
    })
    await expect(cache.get('a', failing)).rejects.toThrow('fail')
    expect(cache.currentKey()).toBeNull()

    const retry = vi.fn(async () => 42)
    expect(await cache.get('a', retry)).toBe(42)
    expect(failing).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
