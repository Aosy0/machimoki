import type { Bounds } from '@machimoki/core'
import type { Lod } from './catalogApi'

/**
 * 完成メッシュキャッシュのバージョン。形状生成ロジックが変わったら上げる。
 * バージョンが違うキーは一致しないため、古いキャッシュを誤って使わない。
 */
export const FINAL_SHAPE_CACHE_VERSION = 1

/** 完成メッシュのジオメトリに影響するパラメータのみ（色は含めない）。 */
export interface FinalShapeGeometryParams {
  bounds: Bounds
  lod: Lod
  excludedBuildingIds?: string[]
  includeSpanningBuildings?: boolean
  terrainThickness: number
  flattenBottom: boolean
  reflectActualElevation?: boolean
  terrainGridSize?: number | null
  includeTerrain: boolean
  scale: number
  openBottom?: boolean
  shellThickness?: number
  hollowBuildings?: boolean
}

/**
 * 完成メッシュの永続キャッシュ用キー。プレビューとエクスポートの両方から
 * 同じ値で呼べるよう、実際に形状生成へ渡す値をそのまま使うこと。
 * 色（buildingColor/terrainColor/whiteModel）は表示だけなので含めない。
 */
export function finalShapeGeometryKey(params: FinalShapeGeometryParams): string {
  return JSON.stringify({
    v: FINAL_SHAPE_CACHE_VERSION,
    west: params.bounds.west,
    south: params.bounds.south,
    east: params.bounds.east,
    north: params.bounds.north,
    lod: params.lod,
    excludedBuildingIds: [...(params.excludedBuildingIds ?? [])].sort(),
    includeSpanningBuildings: params.includeSpanningBuildings ?? false,
    terrainThickness: params.terrainThickness,
    flattenBottom: params.flattenBottom,
    reflectActualElevation: params.reflectActualElevation ?? false,
    terrainGridSize: params.terrainGridSize ?? null,
    includeTerrain: params.includeTerrain,
    scale: params.scale,
    openBottom: params.openBottom ?? false,
    shellThickness: params.shellThickness ?? null,
    hollowBuildings: params.hollowBuildings ?? true,
  })
}
