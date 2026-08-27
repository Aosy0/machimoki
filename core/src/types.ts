/**
 * Core type definitions for the machimoki pipeline
 */

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type UpAxis = 'z-up' | 'y-up';

export type Lod = 'lod1' | 'lod2' | 'lod3' | 'lod4';

export type ExportFormat = '3mf' | 'stl' | 'machimoki';

export interface ExportOptions {
  terrainThickness: number;
  flattenBottom: boolean;
  format: ExportFormat;
  lod?: Lod;
  includeTerrain?: boolean;
  buildingColor?: string;
  terrainColor?: string;
  upAxis?: UpAxis;
  scale?: number;
  // When format is 'machimoki', the embedded model is produced in this format
  // ('3mf' | 'stl'). Defaults to '3mf'.
  machimokiModelFormat?: '3mf' | 'stl';
  // 選択範囲の境界をまたぐ建物を含めるか（デフォルト false）。
  // true にすると、フットプリントが範囲に完全内包されない建物も含める。
  includeSpanningBuildings?: boolean;
  // 指定した緯度経度のうち少なくとも1点をフットプリント内に含む建物のみを
  // エクスポートする。bounds はタイル取得・地形生成の範囲としてのみ使われる。
  // 未指定・空配列の場合は従来どおり bounds による矩形選択となる。
  pickPoints?: Array<{ lon: number; lat: number }>;
  // b3dm batch table の gmlid 属性で指定した建物をエクスポートから除外する。
  // 未指定・空配列の場合はすべての建物を含める。
  excludedGmlIds?: string[];
}

export interface ExportRequest {
  bounds: Bounds;
  options: ExportOptions;
}

export interface ExportResult {
  buffer: Uint8Array;
  warnings: string[];
}

export interface ValidationResult {
  status: 'pass' | 'warning' | 'fail';
  numTri: number;
  numVert: number;
  numEdge: number;
  volume: number;
  surfaceArea: number;
  genus: number;
  numShells: number;
  open_edges: number;
  non_manifold_edges: number;
  self_intersections: number;
  statusCode: string;
}

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface CatalogResult {
  muniCode: string;
  tilesetUrl: string;
}
