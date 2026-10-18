/**
 * Core type definitions for the machimoki pipeline
 */

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

export type UpAxis = 'z-up' | 'y-up'

export type Lod = 'lod1' | 'lod2' | 'lod3' | 'lod4'

export type ExportFormat = '3mf' | 'stl' | 'machimoki'

export interface ExportOptions {
  terrainThickness: number
  flattenBottom: boolean
  reflectActualElevation?: boolean
  format: ExportFormat
  lod?: Lod
  includeTerrain?: boolean
  buildingColor?: string
  terrainColor?: string
  upAxis?: UpAxis
  scale?: number
  // When format is 'machimoki', the embedded model is produced in this format
  // ('3mf' | 'stl'). Defaults to '3mf'.
  machimokiModelFormat?: '3mf' | 'stl'
  // 選択範囲の境界をまたぐ建物を含めるか（デフォルト false）。
  // true にすると、フットプリントが範囲に完全内包されない建物も含める。
  includeSpanningBuildings?: boolean
  // 指定した緯度経度のうち少なくとも1点をフットプリント内に含む建物のみを
  // エクスポートする。bounds はタイル取得・地形生成の範囲としてのみ使われる。
  // 未指定・空配列の場合は従来どおり bounds による矩形選択となる。
  pickPoints?: Array<{ lon: number; lat: number }>
  // b3dm batch table の gmlid 属性で指定した建物をエクスポートから除外する。
  // 未指定・空配列の場合はすべての建物を含める。
  excludedGmlIds?: string[]
  // 地形メッシュの分割数（NxN）。未指定時は 128。
  terrainGridSize?: number
  // 底面を開口した中空シェルとして出力する。地形スライスの内側を空洞にし、
  // 底面は外周のリム（シェル厚み分）だけを残す。デフォルト false。
  openBottom?: boolean
  // シェル（壁・天井）の厚み。ユーザー向けの印刷 mm。デフォルト 1.6。
  // openBottom が true のときのみ使用される。
  shellThickness?: number
  // 建物内部も中空化し、底面開口から建物内へ通じる空洞を作る。デフォルト true。
  // openBottom が true のときのみ使用される。
  hollowBuildings?: boolean
}

export interface ExportRequest {
  bounds: Bounds
  options: ExportOptions
}

export interface ExportResult {
  buffer: Uint8Array
  warnings: string[]
  /** openBottom 時の建物ごとの中空化結果（未指定 = 中空化なし） */
  hollowing?: HollowingReport
}

/** 建物1棟ごとの中空化ステータス */
export type HollowingStatus =
  | 'hollowed' // カッター生成済み（底面開通の一般判定は未検証）
  | 'small' // 壁厚より小さく中空化不可（中実のまま）
  | 'no-section' // 断面取得不可（中実のまま）
  | 'boolean-failed' // 侵食/ブール演算失敗（中実のまま）
  | 'cap-unsupported' // 開いた底面が単一の凸ループでない（出力から除外）
  | 'invalid-geometry' // 閉じたソリッドにできない（出力から除外）

export interface HollowingRecord {
  /** 建物インデックス（1始まり。警告の Building N と一致） */
  index: number
  status: HollowingStatus
  reason?: string
}

export interface HollowingReport {
  records: HollowingRecord[]
  /** カッター生成済みの建物数 */
  hollowed: number
  /** 中空化できず中実のまま残した建物数（small / no-section / boolean-failed） */
  keptSolid: number
  /** 出力から除外した建物数（cap-unsupported / invalid-geometry） */
  excluded: number
  /** 完成モデル内の密閉空洞の個数（0 なら健全） */
  sealedCavities: number
  /** 密閉空洞の体積合計 */
  sealedCavityVolume: number
  /** 底面開通の一般到達性判定は未実施（現状は常に 'unverified'） */
  reachability: 'unverified'
}

export interface ValidationResult {
  status: 'pass' | 'warning' | 'fail'
  numTri: number
  numVert: number
  numEdge: number
  volume: number
  surfaceArea: number
  genus: number
  numShells: number
  open_edges: number
  non_manifold_edges: number
  self_intersections: number
  statusCode: string
}

export interface RawMesh {
  positions: Float32Array
  indices: Uint32Array
}

export interface CatalogResult {
  muniCode: string
  tilesetUrl: string
}
