import type { Parameters } from '../components/ParameterPanel'

/**
 * 詳細設定タブの項目。リロード時に復元せず、保存もしない。
 * 底面開口や土台分割を復元すると、3Dプレビューを開いた直後に重い最終形状の
 * 生成が自動で走り、読み込みが終わらないように見えるため。
 * ParameterPanel の詳細設定セクションに項目を足したらここにも足す。
 */
export const ADVANCED_PARAMETER_KEYS = [
  'upAxis',
  'includeSpanningBuildings',
  'buildingColor',
  'terrainColor',
  'terrainThickness',
  'flattenBottom',
  'reflectActualElevation',
  'openBottom',
  'shellThickness',
  'hollowBuildings',
  'splitAtGround',
  'terrainGridSize',
] as const satisfies readonly (keyof Parameters)[]

/** 詳細設定の項目を落とした保存用の値を作る（元のオブジェクトは変更しない）。 */
export function omitAdvancedParameters(parameters: Partial<Parameters>): Partial<Parameters> {
  const stored = { ...parameters }
  for (const key of ADVANCED_PARAMETER_KEYS) {
    delete stored[key]
  }
  return stored
}
