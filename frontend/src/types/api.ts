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
  terrainGridSize?: number
  format: ExportFormat
  lod?: Lod
  includeTerrain?: boolean
  buildingColor?: string
  terrainColor?: string
  upAxis?: UpAxis
  scale?: number
  machimokiModelFormat?: '3mf' | 'stl'
  includeSpanningBuildings?: boolean
  pickPoints?: Array<{ lon: number; lat: number }>
  excludedGmlIds?: string[]
  /** 底面を開口した中空シェルとして出力する（デフォルト false） */
  openBottom?: boolean
  /** シェル厚み（印刷mm、デフォルト 1.6） */
  shellThickness?: number
  /** 建物内部も中空化する（デフォルト true、openBottom 時のみ意味を持つ） */
  hollowBuildings?: boolean
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
