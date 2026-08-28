/**
 * Cesium terrain sampling → raw mesh.
 */

import {
  Cartesian3,
  Cartographic,
  CesiumTerrainProvider,
  Matrix4,
  sampleTerrainMostDetailed,
  Transforms,
} from 'cesium';
import type { Bounds, RawMesh } from './types';

const TERRAIN_GRID_SIZE = 128;
const DIRECT_TERRAIN_URL =
  (typeof process !== 'undefined' && (process as any).env?.TERRAIN_URL) ??
  (typeof process !== 'undefined' && (process as any).env?.VITE_TERRAIN_URL) ??
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_TERRAIN_URL) ??
  'https://tile.plateauview.mlit.go.jp/terrain';

function enuToEngine(x: number, y: number, z: number): { x: number; y: number; z: number } {
  // ENU -> engine coordinates: (X, Y, Z) -> (X, Z, -Y)
  return { x, y: z, z: -y };
}

export async function buildTerrainMesh(
  bounds: Bounds,
  thickness: number,
  flattenBottom: boolean,
): Promise<RawMesh> {
  const widthDeg = bounds.east - bounds.west;
  const heightDeg = bounds.north - bounds.south;
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;

  const positions: Cartographic[] = [];
  for (let y = 0; y < TERRAIN_GRID_SIZE; y++) {
    for (let x = 0; x < TERRAIN_GRID_SIZE; x++) {
      const lon = bounds.west + (widthDeg * x) / (TERRAIN_GRID_SIZE - 1);
      const lat = bounds.south + (heightDeg * y) / (TERRAIN_GRID_SIZE - 1);
      positions.push(Cartographic.fromDegrees(lon, lat));
    }
  }

  let sampled: Cartographic[];
  let terrainProvider: any;
  try {
    terrainProvider = await (CesiumTerrainProvider as any).fromUrl(DIRECT_TERRAIN_URL, { requestVertexNormals: true } as any);
  } catch (e) {
    throw new Error(`PLATEAU-Terrain取得失敗: ${DIRECT_TERRAIN_URL} - ${(e as Error).message}`);
  }
  try {
    sampled = await sampleTerrainMostDetailed(terrainProvider, positions);
  } catch (e) {
    throw new Error(`PLATEAU-Terrain取得失敗: ${DIRECT_TERRAIN_URL} - ${(e as Error).message}`);
  }

  // Convert to local ENU coordinates centered on selection center
  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0);
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian);
  const invCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4());

  const vertices: number[] = [];
  const topZValues: number[] = [];

  for (let i = 0; i < sampled.length; i++) {
    const cart = Cartesian3.fromRadians(
      sampled[i].longitude,
      sampled[i].latitude,
      sampled[i].height,
    );
    const localCart = Matrix4.multiplyByPoint(invCenterMatrix, cart, new Cartesian3());
    const engine = enuToEngine(localCart.x, localCart.y, localCart.z);
    vertices.push(engine.x, engine.y, engine.z);
    topZValues.push(engine.y);
  }

  const numVertices = TERRAIN_GRID_SIZE * TERRAIN_GRID_SIZE;

  // Determine bottom Z
  const minTopZ = Math.min(...topZValues);
  const bottomZ = flattenBottom ? minTopZ - thickness : -thickness;

  const allVertices: number[] = [...vertices];

  // Bottom vertices
  for (let i = 0; i < numVertices; i++) {
    const y = flattenBottom ? bottomZ : topZValues[i] - thickness;
    allVertices.push(vertices[i * 3], y, vertices[i * 3 + 2]);
  }

  const indices: number[] = [];

  // Top surface
  for (let y = 0; y < TERRAIN_GRID_SIZE - 1; y++) {
    for (let x = 0; x < TERRAIN_GRID_SIZE - 1; x++) {
      const a = y * TERRAIN_GRID_SIZE + x;
      const b = a + 1;
      const c = (y + 1) * TERRAIN_GRID_SIZE + x;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // Bottom surface
  for (let y = 0; y < TERRAIN_GRID_SIZE - 1; y++) {
    for (let x = 0; x < TERRAIN_GRID_SIZE - 1; x++) {
      const a = y * TERRAIN_GRID_SIZE + x + numVertices;
      const b = a + 1;
      const c = (y + 1) * TERRAIN_GRID_SIZE + x + numVertices;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  // Side walls
  for (let x = 0; x < TERRAIN_GRID_SIZE - 1; x++) {
    const t1 = x;
    const t2 = x + 1;
    const b1 = t1 + numVertices;
    const b2 = t2 + numVertices;
    indices.push(t1, b1, t2);
    indices.push(t2, b1, b2);
  }

  for (let x = 0; x < TERRAIN_GRID_SIZE - 1; x++) {
    const t1 = (TERRAIN_GRID_SIZE - 1) * TERRAIN_GRID_SIZE + x;
    const t2 = t1 + 1;
    const b1 = t1 + numVertices;
    const b2 = t2 + numVertices;
    indices.push(t1, t2, b1);
    indices.push(t2, b2, b1);
  }

  for (let y = 0; y < TERRAIN_GRID_SIZE - 1; y++) {
    const t1 = y * TERRAIN_GRID_SIZE;
    const t2 = (y + 1) * TERRAIN_GRID_SIZE;
    const b1 = t1 + numVertices;
    const b2 = t2 + numVertices;
    indices.push(t1, t2, b1);
    indices.push(t2, b2, b1);
  }

  for (let y = 0; y < TERRAIN_GRID_SIZE - 1; y++) {
    const t1 = y * TERRAIN_GRID_SIZE + (TERRAIN_GRID_SIZE - 1);
    const t2 = (y + 1) * TERRAIN_GRID_SIZE + (TERRAIN_GRID_SIZE - 1);
    const b1 = t1 + numVertices;
    const b2 = t2 + numVertices;
    indices.push(t1, b1, t2);
    indices.push(t2, b1, b2);
  }

  return {
    positions: new Float32Array(allVertices),
    indices: new Uint32Array(indices),
  };
}
