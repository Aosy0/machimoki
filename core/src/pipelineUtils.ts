/**
 * Post-fetch pipeline: RawMeshes + bounds + options -> printable model buffer.
 *
 * This module is safe to import in Web Workers and browsers because it uses
 * no I/O, no Cesium, and only calls manifold-3d through existing manifoldOps.
 */

import type { CrossSection, Manifold } from 'manifold-3d'
import {
  Bounds,
  ExportOptions,
  ExportResult,
  HollowingRecord,
  HollowingReport,
  RawMesh,
} from './types.js'
import {
  bottomBoundaryIsConvex,
  capBuildingBottom,
  splitConnectedComponents,
  weldVertices,
} from './buildingCapper.js'
import { detectSealedCavities } from './hollowCheck.js'
import {
  createBox,
  createManifoldFromMesh,
  createSlicePrism,
  exportMeshesToSTL,
  exportTo3MF,
  unionManifolds,
} from './manifoldOps.js'
import {
  buildTerrainCavityMesh,
  componentContainsPoint,
  componentIntersectsBounds,
  dedupeComponents,
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
 * Returns the per-building status so callers can record why a building was
 * kept solid ('small' / 'no-section' / 'boolean-failed').
 */
type CutterPath = '2d' | '3d'

type CutterResult =
  | { status: 'hollowed'; cutter: Manifold; path: CutterPath }
  | { status: 'small'; path: CutterPath }
  | { status: 'no-section'; path: CutterPath }
  | { status: 'boolean-failed'; path: CutterPath }

/** プリズム判定で断面を比較する高さ（対象高さに対する比率）。 */
const PRISM_SAMPLE_FRACTIONS = [0.12, 0.3, 0.5, 0.7, 0.88]
/** プリズム断面比較の許容誤差（面積・位置・対称差の相対値）。 */
const PRISM_MATCH_TOLERANCE = 1e-4
/** 凸判定（面積と凸包面積の相対差）の許容誤差。 */
const CONVEX_AREA_TOLERANCE = 1e-6

/** 2つの断面が許容誤差内で同一形状か（面積・bbox・対称差面積）を判定する。 */
function crossSectionsMatch(a: CrossSection, b: CrossSection, tolerance: number): boolean {
  if (a.isEmpty() || b.isEmpty()) return a.isEmpty() && b.isEmpty()
  const area = a.area()
  if (!(area > 0)) return false
  if (Math.abs(area - b.area()) > tolerance * area) return false
  const scale = Math.sqrt(area)
  const boundsA = a.bounds()
  const boundsB = b.bounds()
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(boundsA.min[axis] - boundsB.min[axis]) > tolerance * scale) return false
    if (Math.abs(boundsA.max[axis] - boundsB.max[axis]) > tolerance * scale) return false
  }
  // 形状差（対称差面積）でも一致を確認する。
  const onlyA = a.subtract(b)
  let difference = onlyA.area()
  onlyA.delete()
  const onlyB = b.subtract(a)
  difference += onlyB.area()
  onlyB.delete()
  return difference <= tolerance * area
}

/** 穴がなく、面積が凸包と一致する（= 凸）かどうか。 */
function isConvexCrossSection(cross: CrossSection): boolean {
  if (cross.isEmpty() || cross.numContour() !== 1) return false
  const area = cross.area()
  if (!(area > 0)) return false
  const hull = cross.hull()
  try {
    return Math.abs(hull.area() - area) <= CONVEX_AREA_TOLERANCE * area
  } finally {
    hull.delete()
  }
}

/**
 * 垂直プリズム＋凸足跡の建物向けの2D侵食経路。
 *
 * 垂直プリズム F×[yBottom, maxY] に対する立方体(2t)の3D侵食は、
 * 足跡の正方形(t)による2D侵食と等価: (F ⊖ square(t)) × [yBottom+t, maxY−t]。
 * 凸多角形では正方形の支持関数の最大が角で達成されるため、
 * 4つのシフトコピーの交差が厳密な侵食になる。
 *
 * 適用条件を満たさない場合（非プリズム・非凸・侵食が空など）は null を返し、
 * 呼び出し側が既存3D経路へフォールバックする。
 */
export async function buildBuildingCutter2D(
  building: Manifold,
  minY: number,
  maxY: number,
  shellThickness: number,
  modelMinY: number,
): Promise<CutterResult | null> {
  const t = shellThickness
  const height = maxY - minY
  if (!(height > 2 * t)) return null

  const bbox = building.boundingBox()
  if (!(Math.min(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]) > 2 * t)) {
    return null
  }

  // 足跡は現行の3D経路と同じスライス位置から取得する（穴も保持）。
  const sliceOffset = Math.min(Math.max(1e-3, height * 0.02), height * 0.15)
  const yTop = minY + 2 * t
  const yBottom = Math.min(modelMinY, minY) - 2 * t
  if (!(yTop > yBottom)) return null
  const erodedHeight = maxY - t - (yBottom + t)
  if (!(erodedHeight > 0)) return null

  const rotated = building.rotate([90, 0, 0])
  const samples: CrossSection[] = []
  let reference: CrossSection | null = null
  try {
    const rotatedBounds = rotated.boundingBox()
    const zMin = rotatedBounds.min[2]
    const zSpan = rotatedBounds.max[2] - zMin
    if (!(zSpan > 0)) return null
    if (!(zMin + sliceOffset < rotatedBounds.max[2])) return null

    reference = rotated.slice(zMin + sliceOffset)
    if (reference.isEmpty()) return null

    // 対象区間で垂直プリズムか: 複数高さの断面が基準断面と一致することを確認する。
    for (const fraction of PRISM_SAMPLE_FRACTIONS) {
      const sample = rotated.slice(zMin + zSpan * fraction)
      samples.push(sample)
      if (!crossSectionsMatch(reference, sample, PRISM_MATCH_TOLERANCE)) return null
    }
    // 凸足跡のみ4シフト交差が厳密な侵食になる。
    if (!isConvexCrossSection(reference)) return null

    const shiftPP = reference.translate(t, t)
    const shiftPN = reference.translate(t, -t)
    const shiftNP = reference.translate(-t, t)
    const shiftNN = reference.translate(-t, -t)
    try {
      const cornerPP = shiftPP.intersect(shiftPN)
      try {
        const cornerPN = cornerPP.intersect(shiftNP)
        try {
          const eroded = cornerPN.intersect(shiftNN)
          try {
            if (eroded.isEmpty()) return null
            const area = eroded.area()
            if (!(area > 0)) return null
            const solid = eroded.extrude(erodedHeight)
            try {
              const rotatedBack = solid.rotate([-90, 0, 0])
              try {
                const cutter = rotatedBack.translate([0, yBottom + t, 0])
                return { status: 'hollowed', cutter, path: '2d' }
              } finally {
                rotatedBack.delete()
              }
            } finally {
              solid.delete()
            }
          } finally {
            eroded.delete()
          }
        } finally {
          cornerPN.delete()
        }
      } finally {
        cornerPP.delete()
      }
    } finally {
      shiftPP.delete()
      shiftPN.delete()
      shiftNP.delete()
      shiftNN.delete()
    }
  } finally {
    for (const sample of samples) sample.delete()
    reference?.delete()
    rotated.delete()
  }
}

/** 既存の3D経路（立方体(2t)の minkowskiDifference）。 */
export async function buildBuildingCutter3D(
  building: Manifold,
  minY: number,
  maxY: number,
  shellThickness: number,
  modelMinY: number,
): Promise<CutterResult> {
  const t = shellThickness
  const height = maxY - minY
  if (!(height > 2 * t)) return { status: 'small', path: '3d' }

  const bbox = building.boundingBox()
  if (!(Math.min(bbox.max[0] - bbox.min[0], bbox.max[2] - bbox.min[2]) > 2 * t)) {
    return { status: 'small', path: '3d' }
  }

  // 底面直上でスライスして真の断面を得る。ε はこの空間の単位で、
  // 建物高さの2%（下限 1e-3）を目安とし、高さの15%を上限に限定する。
  const sliceOffset = Math.min(Math.max(1e-3, height * 0.02), height * 0.15)
  const yTop = minY + 2 * t
  const yBottom = Math.min(modelMinY, minY) - 2 * t
  if (!(yTop > yBottom)) return { status: 'no-section', path: '3d' }

  const prism = await createSlicePrism(building, sliceOffset, yBottom, yTop)
  if (!prism) return { status: 'no-section', path: '3d' }
  try {
    const fused = await unionManifolds([building, prism])
    try {
      const cube = await createBox(2 * t)
      try {
        const eroded = fused.minkowskiDifference(cube)
        if (eroded.status() !== 'NoError' || !(eroded.volume() > 0)) {
          eroded.delete()
          return { status: 'boolean-failed', path: '3d' }
        }
        return { status: 'hollowed', cutter: eroded, path: '3d' }
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
 * 建物のカッターを生成する。垂直プリズム＋凸足跡なら2D侵食の高速経路、
 * それ以外は既存の3D侵食へフォールバックする（形状は同一）。
 */
export async function buildBuildingCutter(
  building: Manifold,
  minY: number,
  maxY: number,
  shellThickness: number,
  modelMinY: number,
): Promise<CutterResult> {
  const fast = await buildBuildingCutter2D(building, minY, maxY, shellThickness, modelMinY)
  if (fast) return fast
  return buildBuildingCutter3D(building, minY, maxY, shellThickness, modelMinY)
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

export interface PrintableGeometryResult {
  /** 完成メッシュ（Y-up・スケール適用済みのモデル空間） */
  mesh: RawMesh
  warnings: string[]
  hollowing?: HollowingReport
  /** 工程別の処理時間（ミリ秒・計測用。結果の形状には影響しない） */
  timings?: Record<string, number>
}

/** シリアライズ前の内部結果。完成 Manifold の所有権は呼び出し側に移る。 */
interface PrintableGeometryBuild {
  manifold: Manifold
  warnings: string[]
  hollowing?: HollowingReport
  timings: Record<string, number>
}

/**
 * 取得済みメッシュから「完成形状」を生成する（シリアライズは行わない）。
 *
 * プレビューとエクスポートで同じ形状を共有するための共通処理。
 * 入力の `buildingMeshes` / `terrainMesh` は変更しない。
 */
export async function buildPrintableGeometryFromMeshes(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<PrintableGeometryResult> {
  const totalStart = performance.now()
  const build = await buildPrintableGeometry(buildingMeshes, terrainMesh, bounds, options)
  try {
    const getMeshStart = performance.now()
    const rawMesh = build.manifold.getMesh()
    const getMesh = performance.now() - getMeshStart
    return {
      mesh: {
        positions: new Float32Array(rawMesh.vertProperties),
        indices: new Uint32Array(rawMesh.triVerts),
      },
      warnings: build.warnings,
      hollowing: build.hollowing,
      timings: {
        ...build.timings,
        getMesh,
        total: performance.now() - totalStart,
      },
    }
  } finally {
    // メッシュ化したら完成 Manifold は不要になる。
    build.manifold.delete()
  }
}

/**
 * 完成形状の Manifold を生成する内部処理（プレビュー用メッシュ化はしない）。
 * 戻り値の `manifold` は呼び出し側が delete する。
 */
async function buildPrintableGeometry(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<PrintableGeometryBuild> {
  const scale = options.scale ?? 1
  const includeSpanning = options.includeSpanningBuildings ?? false
  const pickPoints = options.pickPoints ?? []
  const openBottom = options.openBottom ?? false
  const hollowBuildings = options.hollowBuildings ?? true
  const shellThickness = options.shellThickness ?? DEFAULT_SHELL_THICKNESS_MM
  const warnings: string[] = []
  // 工程別タイミング（計測専用。形状には影響しない）。
  const timings: Record<string, number> = {}

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
  const preprocessStart = performance.now()
  const components: RawMesh[] = []
  for (const mesh of buildingMeshes) {
    const welded = weldVertices(mesh)
    components.push(...splitConnectedComponents(welded))
  }
  const uniqueComponents = dedupeComponents(components)
  alignFlatTerrainToBuildings(terrainMesh, uniqueComponents)
  timings.preprocess = performance.now() - preprocessStart

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
  const hollowingRecords: HollowingRecord[] = []
  // 建物ごとの Manifold 化とカッター生成（2D高速経路/3D経路別）を計測する。
  let buildingManifoldMs = 0
  let cutter2dMs = 0
  let cutter3dMs = 0
  let cutter2dCount = 0
  let cutter3dCount = 0
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
    let exclusionStatus: 'cap-unsupported' | 'invalid-geometry' = 'invalid-geometry'
    const manifoldStart = performance.now()
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
        exclusionStatus = 'cap-unsupported'
      }
    }
    buildingManifoldMs += performance.now() - manifoldStart
    if (!manifold) {
      warnings.push(`Building ${j + 1} skipped (not printable): ${createError ?? 'unknown'}`)
      hollowingRecords.push({
        index: j + 1,
        status: exclusionStatus,
        reason: createError ?? undefined,
      })
      continue
    }
    buildingManifolds.push(manifold)

    if (hollowActive && hollowBuildings) {
      const manifoldBounds = manifold.boundingBox()
      const minY = manifoldBounds.min[1]
      const maxY = manifoldBounds.max[1]
      const cutterStart = performance.now()
      try {
        const result = await buildBuildingCutter(manifold, minY, maxY, wallThickness, terrainMinY)
        // 2D高速経路と3D経路の適用数・時間を分けて記録する。
        if (result.path === '2d') {
          cutter2dMs += performance.now() - cutterStart
          cutter2dCount++
        } else {
          cutter3dMs += performance.now() - cutterStart
          cutter3dCount++
        }
        if (result.status === 'hollowed') {
          buildingCutters.push(result.cutter)
          hollowingRecords.push({ index: j + 1, status: 'hollowed' })
        } else {
          hollowingRecords.push({ index: j + 1, status: result.status })
        }
      } catch (error) {
        cutter3dMs += performance.now() - cutterStart
        cutter3dCount++
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`Building ${j + 1} hollowing skipped: ${message}`)
        hollowingRecords.push({ index: j + 1, status: 'boolean-failed', reason: message })
      }
    }
  }
  timings.buildingManifold = buildingManifoldMs
  timings.cutter = cutter2dMs + cutter3dMs
  timings.cutter2d = cutter2dMs
  timings.cutter3d = cutter3dMs
  timings.cutter2dCount = cutter2dCount
  timings.cutter3dCount = cutter3dCount

  if (pickPoints.length > 0 && buildingManifolds.length === 0) {
    warnings.push('No buildings matched the pick points')
  }
  const keptSolidCount = hollowingRecords.filter(
    (record) =>
      record.status === 'small' ||
      record.status === 'no-section' ||
      record.status === 'boolean-failed',
  ).length
  if (hollowActive && hollowBuildings && keptSolidCount > 0) {
    warnings.push(
      `中空化: 中空化できず中実のまま残した建物 ${keptSolidCount} 棟（小型または断面取得不可）`,
    )
  }

  // Union terrain + buildings into a single manifold. When an open-bottom
  // shell was requested, subtract the cutters (terrain cavity + building
  // cavities) so the model has one connected interior and an open underside.
  // 建物は既に Manifold なので、メッシュへ戻して再インポートする往復をせず
  // 直接 union する。地形だけは RawMesh から1回だけ Manifold 化する。
  if (!terrainMesh && buildingManifolds.length === 0) {
    throw new Error('No printable meshes generated for the requested bounds')
  }

  const unionStart = performance.now()
  const terrainManifold = terrainMesh ? await createManifoldFromMesh(terrainMesh) : null
  let union: Manifold
  try {
    union = await unionManifolds(
      terrainManifold ? [terrainManifold, ...buildingManifolds] : buildingManifolds,
    )
  } finally {
    // union の入力は消費されないため、地形の一時 Manifold はここで破棄する。
    terrainManifold?.delete()
  }
  timings.union = performance.now() - unionStart
  let final: Manifold = union
  // 完成 Manifold を呼び出し側へ返したか（true なら finally で破棄しない）。
  let transferred = false
  try {
    const hollowStart = performance.now()
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
        const subtracted = union.subtract(cutterUnion)
        // 減算後は union が中間結果になるため破棄する。
        union.delete()
        final = subtracted
      } finally {
        cutterUnion.delete()
      }
    }
    timings.hollowCavity = performance.now() - hollowStart

    // 完成モデルの密閉空洞を検出する（検証済み方式: 非制限ボイドの分解）。
    // 底面開通の一般到達性判定は未実施のため、レポートでは unverified とする。
    let hollowingReport: HollowingReport | undefined
    const sealedStart = performance.now()
    if (hollowActive) {
      const sealed = await detectSealedCavities(final)
      if (sealed.count > 0) {
        warnings.push(
          `中空化: 密閉空洞が ${sealed.count} 個検出されました（体積 ${sealed.volume.toPrecision(3)}）`,
        )
      }
      hollowingReport = {
        records: hollowingRecords,
        hollowed: hollowingRecords.filter((record) => record.status === 'hollowed').length,
        keptSolid: keptSolidCount,
        excluded: hollowingRecords.filter(
          (record) => record.status === 'cap-unsupported' || record.status === 'invalid-geometry',
        ).length,
        sealedCavities: sealed.count,
        sealedCavityVolume: sealed.volume,
        reachability: 'unverified',
      }
    }
    timings.sealedCavityCheck = performance.now() - sealedStart

    // メッシュ化（getMesh）は呼び出し側が最後に1回だけ行う。
    transferred = true
    return {
      manifold: final,
      warnings,
      hollowing: hollowingReport,
      timings,
    }
  } finally {
    // 失敗時は完成 Manifold も破棄する（成功時は所有権が呼び出し側へ移る）。
    if (!transferred) final.delete()
    for (const manifold of buildingManifolds) manifold.delete()
    for (const cutter of buildingCutters) cutter.delete()
  }
}

/**
 * 取得済みメッシュから印刷用モデルを生成し、STL/3MF にシリアライズする。
 *
 * `buildPrintableGeometryFromMeshes` が返す完成メッシュを、指定の up-axis と
 * mm 単位（1回だけ変換）で出力する。プレビューと同じ形状になる。
 */
export async function buildPrintableModelFromMeshes(
  buildingMeshes: RawMesh[],
  terrainMesh: RawMesh | null,
  bounds: Bounds,
  options: ExportOptions,
): Promise<ExportResult> {
  if (options.format === 'machimoki') {
    throw new Error(
      "format 'machimoki' is not supported by buildPrintableModelFromMeshes; use exportMachimokiFromMeshes instead",
    )
  }

  const build = await buildPrintableGeometry(buildingMeshes, terrainMesh, bounds, options)
  const { warnings, hollowing } = build
  const upAxis = options.upAxis ?? 'z-up'
  try {
    if (options.format === 'stl') {
      // STL はメッシュが必要なので、ここで1回だけ getMesh する。
      const rawMesh = build.manifold.getMesh()
      const mesh: RawMesh = {
        positions: new Float32Array(rawMesh.vertProperties),
        indices: new Uint32Array(rawMesh.triVerts),
      }
      return { buffer: exportMeshesToSTL([mesh], upAxis), warnings, hollowing }
    }

    // 完成 Manifold をそのまま 3MF 化する（メッシュ経由の再インポートを避ける）。
    const modelColor = terrainMesh
      ? (options.terrainColor ?? '#ffffff')
      : (options.buildingColor ?? '#ffffff')
    return { buffer: await exportTo3MF(build.manifold, modelColor, upAxis), warnings, hollowing }
  } finally {
    // 完成 Manifold はここで所有権を終える。
    build.manifold.delete()
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
      const result = await buildBuildingCutter(manifold, minY, maxY, wallThickness, minY)
      if (result.status === 'hollowed') {
        const cutter = result.cutter
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
