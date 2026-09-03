/**
 * resolveCoverageMvtStyle の詳細/簡易モード切替テスト（Cesium 非依存の pure 関数のみ対象）。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/coverageMvtLayer.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Viewer } from 'cesium'
import { LOD_CATEGORY_STYLES } from './coverageCategories'
import { createCoverageMvtLayer, resolveCoverageMvtStyle } from './coverageMvtLayer'

interface MockLayer {
  show: boolean
}

interface MockImageryLayers {
  addedProviders: unknown[]
  removedLayers: MockLayer[]
  layers: MockLayer[]
  addImageryProvider: (provider: unknown) => MockLayer
  remove: (layer: MockLayer) => void
}

function createMockViewer(): { viewer: Viewer; imageryLayers: MockImageryLayers } {
  const imageryLayers: MockImageryLayers = {
    addedProviders: [],
    removedLayers: [],
    layers: [],
    addImageryProvider: (provider: unknown): MockLayer => {
      imageryLayers.addedProviders.push(provider)
      const layer: MockLayer = { show: true }
      imageryLayers.layers.push(layer)
      return layer
    },
    remove: (layer: MockLayer): void => {
      imageryLayers.removedLayers.push(layer)
      const index = imageryLayers.layers.indexOf(layer)
      if (index >= 0) {
        imageryLayers.layers.splice(index, 1)
      }
    },
  }
  const viewer = { imageryLayers } as unknown as Viewer
  return { viewer, imageryLayers }
}

function stubCoverageProbe(): () => void {
  const originalFetch = globalThis.fetch
  const stub = (() =>
    Promise.resolve({ ok: true } as unknown as Response)) as typeof fetch
  globalThis.fetch = stub
  return () => {
    globalThis.fetch = originalFetch
  }
}

describe('resolveCoverageMvtStyle 簡易モード（detailed=false）', () => {
  it('整備済みは透明＋#4fc3f7枠の二値表示になる', () => {
    for (const lods of ['lod1', 'lod2', 'lod3', 'lod4', 'lod1,lod2,lod3,lod4']) {
      const style = resolveCoverageMvtStyle({ properties: { lods } }, false)
      assert.equal(style.fillStyle, 'rgba(0, 0, 0, 0)')
      assert.equal(style.strokeStyle, '#4fc3f7')
    }
  })

  it('coveredフォールバック（lods欠落）も整備済み扱いになる', () => {
    const style = resolveCoverageMvtStyle({ properties: { covered: 1 } }, false)
    assert.equal(style.fillStyle, 'rgba(0, 0, 0, 0)')
    assert.equal(style.strokeStyle, '#4fc3f7')
  })

  it('未整備はグレー塗りのままになる', () => {
    for (const properties of [{ lods: '' }, {}, undefined]) {
      const style = resolveCoverageMvtStyle({ properties }, false)
      assert.equal(style.fillStyle, LOD_CATEGORY_STYLES.none.fill)
      assert.equal(style.strokeStyle, LOD_CATEGORY_STYLES.none.outline)
    }
  })
})

describe('resolveCoverageMvtStyle 詳細モード（detailed=true）', () => {
  it('5カテゴリを色定義通りに塗り分ける', () => {
    const cases = [
      { lods: '', fill: LOD_CATEGORY_STYLES.none.fill, outline: LOD_CATEGORY_STYLES.none.outline },
      { lods: 'lod1', fill: LOD_CATEGORY_STYLES.lod1.fill, outline: LOD_CATEGORY_STYLES.lod1.outline },
      { lods: 'lod1,lod2', fill: LOD_CATEGORY_STYLES.lod2.fill, outline: LOD_CATEGORY_STYLES.lod2.outline },
      { lods: 'lod3', fill: LOD_CATEGORY_STYLES.lod3plus.fill, outline: LOD_CATEGORY_STYLES.lod3plus.outline },
      { lods: 'lod1,lod4', fill: LOD_CATEGORY_STYLES.lod4.fill, outline: LOD_CATEGORY_STYLES.lod4.outline },
    ] as const
    for (const { lods, fill, outline } of cases) {
      const style = resolveCoverageMvtStyle({ properties: { lods } }, true)
      assert.equal(style.fillStyle, fill)
      assert.equal(style.strokeStyle, outline)
    }
  })

  it('整備済みは簡易モードと異なり透明にならない', () => {
    const style = resolveCoverageMvtStyle({ properties: { lods: 'lod2' } }, true)
    assert.notEqual(style.fillStyle, 'rgba(0, 0, 0, 0)')
  })
})

describe('createCoverageMvtLayer 再生成', () => {
  it('モード変化時のみ remove/add が呼ばれる', async () => {
    const restore = stubCoverageProbe()
    try {
      const { viewer, imageryLayers } = createMockViewer()
      const handle = await createCoverageMvtLayer(viewer, '/api/coverage/tiles/{z}/{x}/{y}')
      assert.equal(imageryLayers.addedProviders.length, 1)
      assert.equal(imageryLayers.removedLayers.length, 0)

      handle.setDetailedMode(true)
      assert.equal(imageryLayers.addedProviders.length, 1)
      assert.equal(imageryLayers.removedLayers.length, 0)

      handle.setDetailedMode(false)
      assert.equal(imageryLayers.addedProviders.length, 2)
      assert.equal(imageryLayers.removedLayers.length, 1)

      handle.setDetailedMode(false)
      assert.equal(imageryLayers.addedProviders.length, 2)
      assert.equal(imageryLayers.removedLayers.length, 1)

      handle.setDetailedMode(true)
      assert.equal(imageryLayers.addedProviders.length, 3)
      assert.equal(imageryLayers.removedLayers.length, 2)
    } finally {
      restore()
    }
  })

  it('setVisible の状態を作り直し後の layer に引き継ぐ', async () => {
    const restore = stubCoverageProbe()
    try {
      const { viewer, imageryLayers } = createMockViewer()
      const handle = await createCoverageMvtLayer(viewer, '/api/coverage/tiles/{z}/{x}/{y}')
      handle.setVisible(false)
      handle.setDetailedMode(false)
      assert.equal(imageryLayers.layers.length, 1)
      assert.equal(imageryLayers.layers[0]?.show, false)

      handle.setVisible(true)
      handle.setDetailedMode(true)
      assert.equal(imageryLayers.layers.length, 1)
      assert.equal(imageryLayers.layers[0]?.show, true)
    } finally {
      restore()
    }
  })

  it('remove() は作り直し後の現行 layer を除去できる', async () => {
    const restore = stubCoverageProbe()
    try {
      const { viewer, imageryLayers } = createMockViewer()
      const handle = await createCoverageMvtLayer(viewer, '/api/coverage/tiles/{z}/{x}/{y}')
      handle.setDetailedMode(false)
      const current = imageryLayers.layers[0]
      handle.remove()
      assert.equal(imageryLayers.removedLayers.length, 2)
      assert.equal(imageryLayers.removedLayers[1], current)
      assert.equal(imageryLayers.layers.length, 0)
    } finally {
      restore()
    }
  })

  it('初期モード指定時は同じモード再設定で作り直さない', async () => {
    const restore = stubCoverageProbe()
    try {
      const { viewer, imageryLayers } = createMockViewer()
      const handle = await createCoverageMvtLayer(
        viewer,
        '/api/coverage/tiles/{z}/{x}/{y}',
        false,
      )
      assert.equal(imageryLayers.addedProviders.length, 1)
      handle.setDetailedMode(false)
      assert.equal(imageryLayers.addedProviders.length, 1)
      assert.equal(imageryLayers.removedLayers.length, 0)
      handle.setDetailedMode(true)
      assert.equal(imageryLayers.addedProviders.length, 2)
      assert.equal(imageryLayers.removedLayers.length, 1)
    } finally {
      restore()
    }
  })
})
