import { describe, expect, it, vi } from 'vitest'

import {
  buildingMeshesKey,
  createLatestPromiseCache,
  terrainMeshKey,
  terrainSampleKey,
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

  it('地形サンプルキーは厚み・flatten に依存せず、gridSize の null/undefined を同一視する', () => {
    const a = terrainSampleKey({ ...baseParams, terrainGridSize: null })
    const b = terrainSampleKey({ ...baseParams, terrainGridSize: undefined })
    expect(a).toBe(b)
    // 厚み・flatten を変えても高さグリッドは取り直さない。
    expect(
      terrainSampleKey({
        ...baseParams,
        terrainThicknessMeters: 0.5,
        flattenBottom: false,
      }),
    ).toBe(a)
    // gridSize / reflectActualElevation はサンプル形状が変わるのでキーも変わる。
    expect(terrainSampleKey({ ...baseParams, terrainGridSize: 256 })).not.toBe(a)
    expect(terrainSampleKey({ ...baseParams, reflectActualElevation: true })).not.toBe(a)
  })

  it('スラブキーは厚み・flatten を含む', () => {
    const a = terrainMeshKey(baseParams)
    expect(terrainMeshKey({ ...baseParams, terrainThicknessMeters: 0.02 })).not.toBe(a)
    expect(terrainMeshKey({ ...baseParams, flattenBottom: false })).not.toBe(a)
  })

  it('データセット（建物＋サンプル）の再送判定は厚み変更で変わらない', () => {
    const building = buildingMeshesKey(baseParams)
    const sample = terrainSampleKey(baseParams)
    const afterThickness = {
      building: buildingMeshesKey({ ...baseParams, terrainThicknessMeters: 0.5 }),
      sample: terrainSampleKey({ ...baseParams, terrainThicknessMeters: 0.5 }),
    }
    expect(afterThickness.building).toBe(building)
    expect(afterThickness.sample).toBe(sample)

    // gridSize は地形サンプル形状が変わるので再取得・再送対象。
    expect(terrainSampleKey({ ...baseParams, terrainGridSize: 256 })).not.toBe(sample)
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
