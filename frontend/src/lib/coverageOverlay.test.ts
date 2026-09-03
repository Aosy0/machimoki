/**
 * Entityフォールバックオーバーレイ（coverageOverlay）の LoD別5色テスト。
 * viewer/entities をモックし、LoD付きマップ入力で5色の Color が割り当てられることを検証する。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/coverageOverlay.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Color, type Viewer, type Entity } from 'cesium'
import { LOD_CATEGORY_STYLES } from './coverageCategories'
import { createCoverageOverlay, __resetCoverageOverlayCacheForTest } from './coverageOverlay'

type AddedEntity = {
  polygon?: {
    material?: Color
    outline?: boolean
    outlineColor?: Color
  }
}

function createMockViewer(): { viewer: Viewer; added: AddedEntity[] } {
  const added: AddedEntity[] = []
  const viewer = {
    isDestroyed: (): boolean => false,
    entities: {
      add: (entity: AddedEntity): Entity => {
        added.push(entity)
        return entity as unknown as Entity
      },
      remove: (): boolean => true,
    },
  } as unknown as Viewer
  return { viewer, added }
}

function stubMuniGeoJSON(codes: string[]): () => void {
  const originalFetch = globalThis.fetch
  const features = codes.map((code) => ({
    properties: { N03_007: code },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [139.69, 35.69],
          [139.7, 35.69],
          [139.7, 35.7],
          [139.69, 35.69],
        ],
      ],
    },
  }))
  const stub = (() =>
    Promise.resolve({
      ok: true,
      json: (): Promise<unknown> => Promise.resolve({ features }),
    } as unknown as Response)) as typeof fetch
  globalThis.fetch = stub
  return () => {
    globalThis.fetch = originalFetch
  }
}

type CoverageDetails = Map<string, { city: string; pref: string; lods: string[] }>

function findByOutline(added: AddedEntity[], cssOutline: string): AddedEntity | undefined {
  const expected = Color.fromCssColorString(cssOutline)
  return added.find(
    (e): boolean =>
      e.polygon?.outlineColor instanceof Color && e.polygon.outlineColor.equals(expected),
  )
}

describe('createCoverageOverlay LoD別5色フォールバック', () => {
  it('LoD付きマップ入力で5カテゴリを定義色通りに描画する', async () => {
    const codes = ['01101', '02201', '03301', '04401', '05501']
    __resetCoverageOverlayCacheForTest()
    const restore = stubMuniGeoJSON(codes)
    try {
      const { viewer, added } = createMockViewer()
      const details: CoverageDetails = new Map([
        ['01101', { city: 'a', pref: 'p', lods: [] }],
        ['02201', { city: 'b', pref: 'p', lods: ['lod1'] }],
        ['03301', { city: 'c', pref: 'p', lods: ['lod1', 'lod2'] }],
        ['04401', { city: 'd', pref: 'p', lods: ['lod3'] }],
        ['05501', { city: 'e', pref: 'p', lods: ['lod1', 'lod4'] }],
      ])
      await createCoverageOverlay(viewer, details)
      assert.equal(added.length, 5)

      const expectations = [
        { category: 'none', code: '01101' },
        { category: 'lod1', code: '02201' },
        { category: 'lod2', code: '03301' },
        { category: 'lod3plus', code: '04401' },
        { category: 'lod4', code: '05501' },
      ] as const
      for (const { category } of expectations) {
        const style = LOD_CATEGORY_STYLES[category]
        const expectedFill = Color.fromCssColorString(style.fill)
        const expectedOutline = Color.fromCssColorString(style.outline)
        const entity = findByOutline(added, style.outline)
        assert.ok(entity, `${category}: outline色のEntityが存在すること`)
        assert.ok(entity?.polygon?.material instanceof Color, `${category}: materialがColorであること`)
        assert.ok(
          (entity?.polygon?.material as Color).equals(expectedFill),
          `${category}: fillが定義色と一致すること`,
        )
        assert.ok(
          (entity?.polygon?.outlineColor as Color).equals(expectedOutline),
          `${category}: outlineが定義色と一致すること`,
        )
      }
    } finally {
      restore()
    }
  })

  it('後方互換: Set<string>入力でも整備済みはlod1色・未整備はnone色になる', async () => {
    // 注: モジュール内の市区町村キャッシュを避けるため別コード帯を使う
    const codes = ['11101', '11201']
    __resetCoverageOverlayCacheForTest()
    const restore = stubMuniGeoJSON(codes)
    try {
      const { viewer, added } = createMockViewer()
      await createCoverageOverlay(viewer, new Set<string>(['11101']))
      assert.equal(added.length, 2)
      const lod1 = findByOutline(added, LOD_CATEGORY_STYLES.lod1.outline)
      assert.ok(lod1, '整備済みコードはlod1色で描画されること')
      const none = findByOutline(added, LOD_CATEGORY_STYLES.none.outline)
      assert.ok(none, '未整備コードはnone色で描画されること')
    } finally {
      restore()
    }
  })
})
