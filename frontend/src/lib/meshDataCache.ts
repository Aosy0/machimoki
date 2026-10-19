/**
 * 建物/地形メッシュの取得結果を共有するインメモリ・キャッシュ。
 *
 * プレビューの完成形状生成と、エクスポートのフル生成経路で同じデータを
 * 二重取得しないようにする。最新1件のみ保持し、失敗した Promise は
 * 破棄して次回リトライできるようにする。
 */

import type { Bounds, RawMesh, TerrainSample } from '@machimoki/core'
import type { Lod } from './catalogApi'

export interface MeshDatasetParams {
  bounds: Bounds
  lod: Lod
  excludedGmlIds?: string[]
  includeTerrain: boolean
  /** モデル空間（m）の地形厚み。ユーザー mm を scale 換算した実際に渡す値。 */
  terrainThicknessMeters: number
  flattenBottom: boolean
  terrainGridSize?: number | null
  reflectActualElevation?: boolean
}

/** 除外IDは順序と空配列/undefined の差を吸収して正規化する。 */
function normalizedExcluded(ids: string[] | undefined): string[] {
  return [...(ids ?? [])].sort()
}

/** 建物メッシュの取得キー（色など表示だけの条件は含めない）。 */
export function buildingMeshesKey(params: MeshDatasetParams): string {
  return JSON.stringify({
    bounds: params.bounds,
    lod: params.lod,
    excludedGmlIds: normalizedExcluded(params.excludedGmlIds),
  })
}

/** 地形の高さグリッド（サンプル）のキー。厚み・flattenBottom は含めない。 */
export function terrainSampleKey(params: MeshDatasetParams): string {
  return JSON.stringify({
    bounds: params.bounds,
    gridSize: params.terrainGridSize ?? null,
    reflectActualElevation: params.reflectActualElevation ?? false,
  })
}

/** 地形スラブ（厚み・flattenBottom を含む）のキー。 */
export function terrainMeshKey(params: MeshDatasetParams): string {
  return JSON.stringify({
    sample: terrainSampleKey(params),
    thickness: params.terrainThicknessMeters,
    flattenBottom: params.flattenBottom,
  })
}

export interface LatestPromiseCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>
  /** 現在保持しているキー（テスト用）。 */
  currentKey(): string | null
  clear(): void
}

/**
 * 直近1件だけ Promise を保持するメモ。
 * 同じキーには同じ Promise を返し、失敗時は保持を解除して次回リトライ可能にする。
 */
export function createLatestPromiseCache<T>(): LatestPromiseCache<T> {
  let key: string | null = null
  let promise: Promise<T> | null = null
  return {
    get(nextKey, load) {
      if (promise !== null && nextKey === key) return promise
      key = nextKey
      promise = load().catch((error) => {
        // 失敗した Promise はキャッシュから除去する（次回リトライ可能に）。
        if (key === nextKey) {
          key = null
          promise = null
        }
        throw error
      })
      return promise
    },
    currentKey() {
      return key
    },
    clear() {
      key = null
      promise = null
    },
  }
}

const buildingCache = createLatestPromiseCache<RawMesh[]>()
const terrainSampleCache = createLatestPromiseCache<TerrainSample>()

/** 建物メッシュを取得する（同じキーの取得中/取得済み Promise を共有する）。 */
export function loadBuildingMeshes(params: MeshDatasetParams): Promise<RawMesh[]> {
  return buildingCache.get(buildingMeshesKey(params), async () => {
    const { buildBuildingMeshes } = await import('@machimoki/core')
    return buildBuildingMeshes(params.bounds, params.lod, params.excludedGmlIds)
  })
}

/**
 * 地形の高さグリッド（サンプル）を取得する。
 * 厚み・flattenBottom が変わっても同じサンプルを再利用できる。
 */
export function loadTerrainSample(params: MeshDatasetParams): Promise<TerrainSample | null> {
  if (!params.includeTerrain) return Promise.resolve(null)
  return terrainSampleCache.get(terrainSampleKey(params), async () => {
    const start = performance.now()
    const { sampleTerrainGrid } = await import('@machimoki/core')
    const sample = await sampleTerrainGrid(
      params.bounds,
      params.terrainGridSize ?? undefined,
      params.reflectActualElevation ?? false,
    )
    // 厚み変更時に再サンプリングしていないことを確認できる計測ログ。
    console.debug('[terrain] sample ms', Math.round(performance.now() - start))
    return sample
  })
}

/**
 * 地形スラブを取得する。高さグリッドはキャッシュから再利用し、
 * 厚み・flattenBottom の変更時はスラブ構築のみ行う。
 */
export async function loadTerrainMesh(params: MeshDatasetParams): Promise<RawMesh | null> {
  const sample = await loadTerrainSample(params)
  if (!sample) return null
  const { buildTerrainSlabFromSample } = await import('@machimoki/core')
  return buildTerrainSlabFromSample(sample, params.terrainThicknessMeters, params.flattenBottom)
}
