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

export interface ExportOptions {
  terrainThickness: number;
  flattenBottom: boolean;
  format: '3mf' | 'stl';
  lod?: Lod;
  includeTerrain?: boolean;
  buildingColor?: string;
  terrainColor?: string;
  upAxis?: UpAxis;
  scale?: number;
  // 選択範囲の境界をまたぐ建物を含めるか（デフォルト false）。
  // true にすると、フットプリントが範囲に完全内包されない建物も含める。
  includeSpanningBuildings?: boolean;
}

export interface ExportRequest {
  bounds: Bounds;
  options: ExportOptions;
}

export interface ExportResult {
  buffer: Buffer;
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
