export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type UpAxis = 'z-up' | 'y-up'
export type Lod = 'lod1' | 'lod2' | 'lod3' | 'lod4'
export type ExportFormat = '3mf' | 'stl' | 'machimoki'

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
  machimokiModelFormat?: '3mf' | 'stl';
  includeSpanningBuildings?: boolean;
  pickPoints?: Array<{ lon: number; lat: number }>;
  excludedGmlIds?: string[];
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
