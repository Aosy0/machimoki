/**
 * Post-fetch pipeline: RawMeshes + bounds + options -> printable model buffer.
 *
 * This module is safe to import in Web Workers and browsers because it uses
 * no I/O, no Cesium, and only calls manifold-3d through existing manifoldOps.
 */

import type { Manifold } from 'manifold-3d'
import { Bounds, ExportOptions, ExportResult, RawMesh } from './types.js'
import {
  bottomBoundaryIsConvex,
  capBuildingBottom,
  splitConnectedComponents,
  weldVertices,
} from './buildingCapper.js'
import {
  createBox,
  createManifoldFromMesh,
  createSlicePrism,
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
 * The building solid is extended downward by a prism of its *sliced* footprint
 * (taken just above the bottom, so concave outlines and courtyard holes are
 * preserved) so it reaches below the terrain slab, then eroded by a cube of
 * edge 2·shellThickness. The resulting solid is the building's inner cavity
 * (wall/roof thickness `shellThickness`) plus a shaft through the slab, which
 * connects the cavity to the model's open underside.
 *
 * Returns null when the building is too small to contain a cavity, or when a
 * valid cross-section cannot be obtained (caller keeps the building solid).
 */
async function buildBuildingCutter(
  building: Manifold,
  minY: number,
  maxY: number,
  shellThickness: number,
  modelMinY: number,
): Promise<Manifold | null> {
  const t = shellThickness
  const height = maxY - minY
  if (!(height > 2 * t)) return null

  const bbox = building.boundingBox()
  if (!(Math.min(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]) > 2 * t)) return null

  // 底面直上でスライスして真の断面を得る。ε はこの空間の単位で、
  // 建物高さの2%（下限 1e-3）を目安とし、高さの15%を上限に限定する。
  const sliceOffset = Math.min(Math.max(1e-3, height * 0.02), height * 0.15)
  const yTop = minY + 2 * t
  const yBottom = Math.min(modelMinY, minY) - 2 * t
  if (!(yTop > yBottom)) return null

  const prism = await createSlicePrism(building, sliceOffset, yBottom, yTop)
  if (!prism) return null
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
    // 閉じた底面を持つ建物（実データの大半）はそのまま Manifold 化する。
    // 開いた底面（床なし）は、底面が単一の凸ループと確認できる場合のみ
    // 凸包キャップで修復し、それ以外は修復対象外として建物ごと除外する。
    let scaled = scaleRawMesh(comp, scale)
    let manifold: Manifold | null = null
    let createError: string | null = null
    try {
      manifold = await createManifoldFromMesh(scaled)
    } catch (error) {
      createError = error instanceof Error ? error.message : String(error)
    }
    if (!manifold) {
      if (bottomBoundaryIsConvex(comp)) {
        scaled = scaleRawMesh(capBuildingBottom(comp), scale)
        try {
          manifold = await createManifoldFromMesh(scaled)
        } catch (error) {
          createError = error instanceof Error ? error.message : String(error)
        }
      } else {
        createError = 'open bottom is not a single convex loop'
      }
    }
    if (!manifold) {
      warnings.push(`Building ${j + 1} skipped (not printable): ${createError ?? 'unknown'}`)
      continue
    }
    buildingManifolds.push(manifold)

    if (hollowActive && hollowBuildings) {
      const manifoldBounds = manifold.boundingBox()
      const minY = manifoldBounds.min[1]
      const maxY = manifoldBounds.max[1]
      try {
        const cutter = await buildBuildingCutter(manifold, minY, maxY, wallThickness, terrainMinY)
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
    warnings.push(
      `中空化: 中空化できず中実のまま残した建物 ${skippedHollowBuildings} 棟（小型または断面取得不可）`,
    )
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
 * 開いた底面のシェルとして返す。中空化できない建物は元メッシュ（閉じたソリッド）
 * をそのまま返し、正常なソリッドにできない建物は結果に含めない
 * （エクスポート側の除外規則と同じ）。
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

    // 閉じた底面はそのまま Manifold 化し、開いた底面は底面が単一の凸ループと
    // 確認できるときだけ凸包キャップで修復する（エクスポート側と同じ規則）。
    let solidMesh = comp
    let manifold: Manifold | null = null
    try {
      manifold = await createManifoldFromMesh(solidMesh)
    } catch {
      manifold = null
    }
    if (!manifold && bottomBoundaryIsConvex(comp)) {
      solidMesh = capBuildingBottom(comp)
      try {
        manifold = await createManifoldFromMesh(solidMesh)
      } catch {
        manifold = null
      }
    }
    if (!manifold) continue

    let shellMesh: RawMesh | null = null
    try {
      const manifoldBounds = manifold.boundingBox()
      const minY = manifoldBounds.min[1]
      const maxY = manifoldBounds.max[1]
      // 地形との統合は不要なため、シャフトの下端は建物底面直下でよい
      const cutter = await buildBuildingCutter(manifold, minY, maxY, wallThickness, minY)
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
    } catch {
      shellMesh = null
    } finally {
      manifold.delete()
    }

    // 中空化できない建物は中実のまま表示する
    shells.push(shellMesh ?? solidMesh)
  }

  return shells
}
