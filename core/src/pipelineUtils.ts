/**
 * Post-fetch pipeline: RawMeshes + bounds + options -> printable model buffer.
 *
 * This module is safe to import in Web Workers and browsers because it uses
 * no I/O, no Cesium, and only calls manifold-3d through existing manifoldOps.
 */

import type { Manifold } from 'manifold-3d'
import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js'
import {
  buildingBottomFootprint,
  capBuildingBottom,
  splitConnectedComponents,
  weldVertices,
} from './buildingCapper.js'
import {
  createBox,
  createFootprintExtrusion,
  createManifoldFromMesh,
  exportMeshesToSTL,
  exportTo3MF,
  unionManifolds,
  unionMeshes,
} from './manifoldOps.js'
import {
  buildTerrainCavityMesh,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
  meshToRaw,
  scaleRawMesh,
} from './pipelineCore.js'

const DEFAULT_SHELL_THICKNESS_MM = 1.6

/**
 * Build the hollowing cutter for one building.
 *
 * The building solid is extended downward by a prism of its footprint so it
 * reaches below the terrain slab, then eroded by a cube of edge 2·shellThickness.
 * The resulting solid is the building's inner cavity (wall/roof thickness
 * `shellThickness`) plus a shaft through the slab, which connects the cavity to
 * the model's open underside.
 *
 * Returns null when the building is too small to contain a cavity.
 */
async function buildBuildingCutter(
  building: Manifold,
  footprint: { hull: Array<{ x: number; z: number }>; minY: number },
  maxY: number,
  shellThickness: number,
  modelMinY: number,
): Promise<Manifold | null> {
  const t = shellThickness
  const { hull, minY } = footprint
  if (hull.length < 3) return null
  if (!(maxY - minY > 2 * t)) return null

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const point of hull) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.z < minZ) minZ = point.z
    if (point.z > maxZ) maxZ = point.z
  }
  if (!(Math.min(maxX - minX, maxZ - minZ) > 2 * t)) return null

  const yTop = minY + 2 * t
  const yBottom = Math.min(modelMinY, minY) - 2 * t
  if (!(yTop > yBottom)) return null

  const prism = await createFootprintExtrusion(hull, yBottom, yTop)
  try {
    const fused = await unionManifolds([building, prism])
    try {
      const cube = await createBox(2 * t)
      try {
        const eroded = fused.minkowskiDifference(cube)
        if (eroded.status() !== 'NoError' || !(eroded.volume() > 0)) {
          eroded.delete()
          return null
        }
        return eroded
      } finally {
        cube.delete()
      }
    } finally {
      fused.delete()
    }
  } finally {
    prism.delete()
  }
}

/**
 * Build a printable 3D model from already-fetched meshes.
 *
 * The caller must:
 * - fetch building meshes (e.g. PLATEAU 3D Tiles decoded via Cesium in main thread)
 * - fetch terrain mesh   (e.g. Cesium Terrain sampled in main thread)
 * - pass them as `RawMesh` plus original bounds and export options
 *
 * This function performs welding, connected-component splitting, deduping,
 * bounding-box / pick-point filtering, bottom-capping, manifold creation,
 * union, and export to 3MF or STL. Building color and terrain color are
 * written as 3MF colorgroup resources.
 */
export function alignFlatTerrainToBuildings(
  terrainMesh: RawMesh | null,
  buildingMeshes: RawMesh[],
): void {
  if (!terrainMesh || buildingMeshes.length === 0) return
  const tPos = terrainMesh.positions
  const totalVerts = tPos.length / 3
  const topCount = Math.floor(totalVerts / 2)
  if (topCount === 0) return
  const gridSize = Math.sqrt(topCount)
  const isGrid = Number.isInteger(gridSize) && gridSize >= 2 && gridSize * gridSize === topCount
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  if (isGrid) {
    for (let i = 0; i < topCount; i++) {
      const x = tPos[i * 3],
        z = tPos[i * 3 + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  for (const bm of buildingMeshes) {
    const p = bm.positions
    const count = p.length / 3
    if (count === 0) continue
    let centroidX = 0
    let centroidZ = 0
    let buildingMinY = Infinity
    for (let i = 0; i < count; i++) {
      centroidX += p[i * 3]
      centroidZ += p[i * 3 + 2]
      const y = p[i * 3 + 1]
      if (y < buildingMinY) buildingMinY = y
    }
    centroidX /= count
    centroidZ /= count
    if (!Number.isFinite(buildingMinY)) continue
    let terrainY: number
    if (isGrid && maxX > minX && maxZ > minZ) {
      let minH = Infinity
      for (let v = 0; v < count; v++) {
        const vx = p[v * 3],
          vz = p[v * 3 + 2]
        const fx = ((vx - minX) / (maxX - minX)) * (gridSize - 1)
        const fz = ((maxZ - vz) / (maxZ - minZ)) * (gridSize - 1)
        const clampedFx = Math.max(0, Math.min(gridSize - 1, fx))
        const clampedFz = Math.max(0, Math.min(gridSize - 1, fz))
        const xi = Math.min(gridSize - 2, Math.floor(clampedFx))
        const zi = Math.min(gridSize - 2, Math.floor(clampedFz))
        const dx = clampedFx - xi
        const dz = clampedFz - zi
        const idx00 = zi * gridSize + xi
        const idx10 = zi * gridSize + (xi + 1)
        const idx01 = (zi + 1) * gridSize + xi
        const idx11 = (zi + 1) * gridSize + (xi + 1)
        const h00 = tPos[idx00 * 3 + 1],
          h10 = tPos[idx10 * 3 + 1],
          h01 = tPos[idx01 * 3 + 1],
          h11 = tPos[idx11 * 3 + 1]
        const h =
          h00 * (1 - dx) * (1 - dz) + h10 * dx * (1 - dz) + h01 * (1 - dx) * dz + h11 * dx * dz
        if (h < minH) minH = h
      }
      terrainY = Number.isFinite(minH) ? minH : tPos[0 * 3 + 1]
    } else {
      let bestIdx = 0
      let bestDist2 = Infinity
      for (let i = 0; i < topCount; i++) {
        const dx = tPos[i * 3] - centroidX
        const dz = tPos[i * 3 + 2] - centroidZ
        const d2 = dx * dx + dz * dz
        if (d2 < bestDist2) {
          bestDist2 = d2
          bestIdx = i
        }
      }
      terrainY = tPos[bestIdx * 3 + 1]
    }
    const delta = terrainY - buildingMinY - 0.3
    if (Math.abs(delta) < 1e-6) continue
    for (let i = 0; i < count; i++) {
      p[i * 3 + 1] += delta
    }
    if (Math.abs(delta) > 0.01) {
      console.warn(
        '[pipeline] Per-building grounding: shifted building by',
        delta,
        '(minY',
        buildingMinY,
        '-> terrainY',
        terrainY,
        '-0.3m overlap)',
      )
    }
  }
}

export async function buildPrintableModelFromMeshes(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  const format = options.format
  const buildingColor = options.buildingColor ?? '#ffffff'
  const terrainColor = options.terrainColor ?? '#ffffff'
  const upAxis = options.upAxis ?? 'z-up'
  const scale = options.scale ?? 1
  const includeSpanning = options.includeSpanningBuildings ?? false
  const pickPoints = options.pickPoints ?? []
  const openBottom = options.openBottom ?? false
  const hollowBuildings = options.hollowBuildings ?? true
  const shellThickness = options.shellThickness ?? DEFAULT_SHELL_THICKNESS_MM
  const warnings: string[] = []

  if (format === 'machimoki') {
    throw new Error(
      "format 'machimoki' is not supported by buildPrintableModelFromMeshes; use exportMachimokiFromMeshes instead",
    )
  }

  // Open-bottom hollowing requires terrain: the terrain cavity provides the
  // open underside and the building cavities connect to it.
  const hollowActive = openBottom && terrainMesh !== null
  if (openBottom && !terrainMesh) {
    warnings.push('地形がないため中空シェルを適用できませんでした')
  }
  // Wall thickness in the scaled model space. Geometry is scaled by `scale`
  // before hollowing (printed mm = scaled units × 1000), so the printed shell
  // thickness maps to shellThickness / 1000 units.
  const wallThickness = hollowActive ? shellThickness / 1000 : 0
  if (hollowActive && (!Number.isFinite(wallThickness) || wallThickness <= 0)) {
    throw new Error(`Invalid shellThickness: ${shellThickness}`)
  }

  // Weld & split into connected components so each building is a separate
  // component for deduping and filtering.
  const components: RawMesh[] = []
  for (const mesh of buildingMeshes) {
    const welded = weldVertices(mesh)
    components.push(...splitConnectedComponents(welded))
  }
  const uniqueComponents = dedupeComponents(components)
  alignFlatTerrainToBuildings(terrainMesh, uniqueComponents)

  // Scale the terrain before hollowing so cavity and cutter dimensions match
  // the final model space.
  if (terrainMesh && scale !== 1) {
    terrainMesh = scaleRawMesh(terrainMesh, scale)
  }
  let terrainMinY = Infinity
  if (hollowActive && terrainMesh) {
    const positions = terrainMesh.positions
    for (let i = 1; i < positions.length; i += 3) {
      if (positions[i] < terrainMinY) terrainMinY = positions[i]
    }
  }

  // Build Manifold solids for each surviving building. When hollowing, also
  // build one erosion cutter per building that can contain a cavity.
  const buildingManifolds: Manifold[] = []
  const buildingCutters: Manifold[] = []
  let skippedHollowBuildings = 0
  for (let j = 0; j < uniqueComponents.length; j++) {
    const comp = uniqueComponents[j]
    if (pickPoints.length > 0) {
      const matched = pickPoints.some((p) => componentContainsPoint(comp, p.lon, p.lat, bounds))
      if (!matched) continue
    } else if (!componentIntersectsBounds(comp, bounds, 1e-2, includeSpanning)) {
      continue
    }
    const capped = capBuildingBottom(comp)
    const scaled = scaleRawMesh(capped, scale)
    let manifold: Manifold
    try {
      manifold = await createManifoldFromMesh(scaled)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Building ${j + 1} skipped (not printable): ${message}`)
      continue
    }
    buildingManifolds.push(manifold)

    if (hollowActive && hollowBuildings) {
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 1; i < scaled.positions.length; i += 3) {
        const y = scaled.positions[i]
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      // Real PLATEAU bottoms are noisy, so collect the footprint with a
      // tolerance relative to the building height instead of the strict 1e-6
      // used by bottom capping.
      const footprintTolerance =
        Number.isFinite(minY) && Number.isFinite(maxY)
          ? Math.max(1e-6, (maxY - minY) * 0.02)
          : undefined
      const footprint = buildingBottomFootprint(scaled, footprintTolerance)
      if (!footprint) {
        skippedHollowBuildings++
        continue
      }
      try {
        const cutter = await buildBuildingCutter(
          manifold,
          footprint,
          maxY,
          wallThickness,
          terrainMinY,
        )
        if (cutter) {
          buildingCutters.push(cutter)
        } else {
          skippedHollowBuildings++
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Building ${j + 1} hollowing skipped: ${message}`)
        skippedHollowBuildings++
      }
    }
  }

  if (pickPoints.length > 0 && buildingManifolds.length === 0) {
    warnings.push('No buildings matched the pick points')
  }
  if (hollowActive && hollowBuildings && skippedHollowBuildings > 0) {
    warnings.push(`中空化: 壁厚より小さい建物 ${skippedHollowBuildings} 棟は中実のまま残しました`)
  }

  // Union terrain + buildings into a single manifold. When an open-bottom
  // shell was requested, subtract the cutters (terrain cavity + building
  // cavities) so the model has one connected interior and an open underside.
  const meshes: RawMesh[] = []
  if (terrainMesh) meshes.push(terrainMesh)
  meshes.push(...buildingManifolds.map((m) => meshToRaw(m.getMesh())))

  if (meshes.length === 0) {
    throw new Error('No printable meshes generated for the requested bounds')
  }

  const union = await unionMeshes(meshes)
  let final: Manifold = union
  try {
    if (hollowActive && terrainMesh) {
      const cavityMesh = buildTerrainCavityMesh(terrainMesh, wallThickness)
      if (!cavityMesh) {
        throw new Error(
          '中空シェルを生成できませんでした: 地形厚みに対してシェル厚みが大きすぎます',
        )
      }
      const cavity = await createManifoldFromMesh(cavityMesh)
      let cutterUnion: Manifold
      try {
        cutterUnion = await unionManifolds([cavity, ...buildingCutters])
      } catch (error) {
        cavity.delete()
        throw error
      }
      cavity.delete()
      try {
        final = union.subtract(cutterUnion)
      } finally {
        cutterUnion.delete()
      }
    }

    if (format === 'stl') {
      return { buffer: exportMeshesToSTL([meshToRaw(final.getMesh())], upAxis), warnings }
    }

    const modelColor = terrainMesh ? terrainColor : buildingColor
    return { buffer: await exportTo3MF(final, modelColor, upAxis), warnings }
  } finally {
    if (final !== union) final.delete()
    union.delete()
    for (const manifold of buildingManifolds) manifold.delete()
    for (const cutter of buildingCutters) cutter.delete()
  }
}

/**
 * 建物メッシュ群をエクスポートと同じ侵食処理で中空化し、底面が開いたシェルメッシュを返す。
 *
 * プレビュー表示用。地形との統合（底面シャフトの接続）は行わず、建物単体を
 * 開いた底面のシェルとして返す。壁厚より小さい等で中空化できない建物は、
 * キャップ済みの元メッシュをそのまま返す（中実のまま表示される）。
 *
 * @param wallThickness 入力メッシュと同じ座標空間でのシェル厚み
 */
export async function buildHollowBuildingShells(
  buildingMeshes: RawMesh[],
  bounds: Bounds,
  wallThickness: number,
  includeSpanningBuildings = false,
): Promise<RawMesh[]> {
  if (!(wallThickness > 0) || !Number.isFinite(wallThickness)) {
    throw new Error(`Invalid wallThickness: ${wallThickness}`)
  }

  const components: RawMesh[] = []
  for (const mesh of buildingMeshes) {
    components.push(...splitConnectedComponents(weldVertices(mesh)))
  }
  const uniqueComponents = dedupeComponents(components)

  const shells: RawMesh[] = []
  for (const comp of uniqueComponents) {
    if (!componentIntersectsBounds(comp, bounds, 1e-2, includeSpanningBuildings)) continue

    const capped = capBuildingBottom(comp)

    let minY = Infinity
    let maxY = -Infinity
    for (let i = 1; i < capped.positions.length; i += 3) {
      const y = capped.positions[i]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) continue

    let shellMesh: RawMesh | null = null
    let manifold: Manifold | null = null
    try {
      manifold = await createManifoldFromMesh(capped)
      const footprintTolerance = Math.max(1e-6, (maxY - minY) * 0.02)
      const footprint = buildingBottomFootprint(capped, footprintTolerance)
      if (footprint) {
        // 地形との統合は不要なため、シャフトは建物底面直下まででよい
        const cutter = await buildBuildingCutter(
          manifold,
          footprint,
          maxY,
          wallThickness,
          footprint.minY,
        )
        if (cutter) {
          try {
            const shell = manifold.subtract(cutter)
            try {
              const mesh = shell.getMesh()
              shellMesh = {
                positions: new Float32Array(mesh.vertProperties),
                indices: new Uint32Array(mesh.triVerts),
              }
            } finally {
              shell.delete()
            }
          } finally {
            cutter.delete()
          }
        }
      }
    } catch {
      shellMesh = null
    } finally {
      manifold?.delete()
    }

    shells.push(shellMesh ?? capped)
  }

  return shells
}
