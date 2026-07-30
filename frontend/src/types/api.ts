export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ExportOptions {
  terrainThickness: number;
  flattenBottom: boolean;
  format: '3mf' | 'stl';
  lod?: 'lod1' | 'lod2';
  includeTerrain?: boolean;
  buildingColor?: string;
  terrainColor?: string;
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
