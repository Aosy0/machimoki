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
} from 'cesium'
import type { TerrainProvider } from 'cesium'
import type { Bounds, RawMesh } from './types'
import { buildTerrainSlabFromSample, type TerrainSample } from './terrainSample.js'

const TERRAIN_GRID_SIZE = 128
const TERRAIN_SAMPLE_BATCH_SIZE = 1024
const DIRECT_TERRAIN_URL =
  (typeof process !== 'undefined' ? (process as any).env?.TERRAIN_URL : undefined) ??
  (typeof process !== 'undefined' ? (process as any).env?.VITE_TERRAIN_URL : undefined) ??
  (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_TERRAIN_URL : undefined) ??
  'https://tile.plateauview.mlit.go.jp/terrain'

function enuToEngine(x: number, y: number, z: number): { x: number; y: number; z: number } {
  // ENU -> engine coordinates: (X, Y, Z) -> (X, Z, -Y)
  return { x, y: z, z: -y }
}

async function sampleTerrainInBatches(
  terrainProvider: TerrainProvider,
  positions: Cartographic[],
): Promise<Cartographic[]> {
  const sampled: Cartographic[] = []
  for (let i = 0; i < positions.length; i += TERRAIN_SAMPLE_BATCH_SIZE) {
    sampled.push(
      ...(await sampleTerrainMostDetailed(
        terrainProvider,
        positions.slice(i, i + TERRAIN_SAMPLE_BATCH_SIZE),
      )),
    )
  }
  return sampled
}

/**
 * 地形の高さグリッドをサンプリングする（Cesium Terrain を使用）。
 *
 * @param terrainProvider 既存の TerrainProvider（省略時は PLATEAU Terrain から生成）
 */
export async function sampleTerrainGrid(
  bounds: Bounds,
  gridSize: number = TERRAIN_GRID_SIZE,
  reflectActualElevation = false,
  terrainProvider?: TerrainProvider,
): Promise<TerrainSample> {
  const n = Number.isFinite(gridSize) ? Math.max(2, Math.floor(gridSize)) : TERRAIN_GRID_SIZE
  const widthDeg = bounds.east - bounds.west
  const heightDeg = bounds.north - bounds.south
  const centerLon = (bounds.west + bounds.east) / 2
  const centerLat = (bounds.south + bounds.north) / 2

  const positions: Cartographic[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const lon = bounds.west + (widthDeg * x) / (n - 1)
      const lat = bounds.south + (heightDeg * y) / (n - 1)
      positions.push(Cartographic.fromDegrees(lon, lat))
    }
  }

  let provider: TerrainProvider
  if (terrainProvider) {
    provider = terrainProvider
  } else {
    try {
      provider = await (CesiumTerrainProvider as any).fromUrl(DIRECT_TERRAIN_URL, {
        requestVertexNormals: true,
      } as any)
    } catch (e) {
      throw new Error(`PLATEAU-Terrain取得失敗: ${DIRECT_TERRAIN_URL} - ${(e as Error).message}`)
    }
  }
  let sampled: Cartographic[]
  try {
    sampled = await sampleTerrainInBatches(provider, positions)
  } catch (e) {
    throw new Error(`PLATEAU-Terrain取得失敗: ${DIRECT_TERRAIN_URL} - ${(e as Error).message}`)
  }
  if (
    sampled.length !== positions.length ||
    sampled.some((sample) => !Number.isFinite(sample.height))
  ) {
    throw new Error('PLATEAU-Terrain取得失敗: 標高サンプルが不完全です')
  }

  // Convert to local ENU coordinates centered on selection center
  const centerCartesian = Cartesian3.fromDegrees(centerLon, centerLat, 0)
  const centerMatrix = Transforms.eastNorthUpToFixedFrame(centerCartesian)
  const invCenterMatrix = Matrix4.inverse(centerMatrix, new Matrix4())

  const topPositions = new Float64Array(n * n * 3)
  const topYValues = new Float64Array(n * n)
  for (let i = 0; i < sampled.length; i++) {
    const cart = Cartesian3.fromRadians(
      sampled[i].longitude,
      sampled[i].latitude,
      sampled[i].height,
    )
    const localCart = Matrix4.multiplyByPoint(invCenterMatrix, cart, new Cartesian3())
    const engine = enuToEngine(localCart.x, localCart.y, localCart.z)
    topPositions[i * 3] = engine.x
    topPositions[i * 3 + 1] = engine.y
    topPositions[i * 3 + 2] = engine.z
    topYValues[i] = engine.y
  }

  return {
    bounds,
    gridSize: n,
    reflectActualElevation,
    topPositions,
    topYValues,
    // 従来と同じ算出方法（NaN の扱いも含めて一致させる）。
    minTopY: Math.min(...topYValues),
  }
}

/**
 * 地形の高さグリッドをサンプリングして地形スラブを構築する（従来の公開API）。
 * 厚み・flattenBottom だけを変える場合は `sampleTerrainGrid` の結果を
 * `buildTerrainSlabFromSample` に渡すことで再サンプリングを避けられる。
 */
export async function buildTerrainMesh(
  bounds: Bounds,
  thickness: number,
  flattenBottom: boolean,
  gridSize: number = TERRAIN_GRID_SIZE,
  reflectActualElevation = false,
): Promise<RawMesh> {
  const sample = await sampleTerrainGrid(bounds, gridSize, reflectActualElevation)
  return buildTerrainSlabFromSample(sample, thickness, flattenBottom)
}

export { buildTerrainSlabFromSample }
export type { TerrainSample }
