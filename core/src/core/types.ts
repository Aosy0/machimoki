/**
 * Core type definitions for the machimoki pipeline
 */

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
}

export interface ExportRequest {
  bounds: Bounds;
  options: ExportOptions;
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
