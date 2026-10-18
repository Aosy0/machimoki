import { describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'
import type { Manifold } from 'manifold-3d'

import { buildPrintableModelFromMeshes, buildHollowBuildingShells } from '../src/pipelineUtils.js'
import { buildSlabIndices, buildTerrainCavityMesh } from '../src/pipelineCore.js'
import { createBox, createManifoldFromMesh, importFrom3MF } from '../src/manifoldOps.js'
import { validateMesh } from '../src/validate.js'
import type { Bounds, ExportOptions, RawMesh } from '../src/types.js'

const bounds: Bounds = {
  west: 139.689,
  south: 35.689,
  east: 139.691,
  north: 35.691,
}

/**
 * Terrain slab with the same 2·n² vertex layout as buildTerrainMesh
 * (top grid followed by bottom grid).
 */
function buildTerrainSlab(n: number, size: number, topY: number, bottomY: number): RawMesh {
  const positions: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      positions.push(-size / 2 + (size * j) / (n - 1), topY, size / 2 - (size * i) / (n - 1))
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      positions.push(-size / 2 + (size * j) / (n - 1), bottomY, size / 2 - (size * i) / (n - 1))
    }
  }
  return { positions: new Float32Array(positions), indices: buildSlabIndices(n) }
}

/**
 * Closed box building like real PLATEAU LOD1 output. Two bottom vertices are
 * nudged up by 1e-4 so capBuildingBottom's strict (1e-6) bottom detection does
 * not fire, matching the noisy real-world meshes.
 */
async function buildBoxBuilding(
  cx: number,
  cz: number,
  sizeX: number,
  sizeZ: number,
  yMin: number,
  yMax: number,
): Promise<RawMesh> {
  const wasm: any = await getManifoldModule()
  const mesh = wasm.Manifold.cube([sizeX, yMax - yMin, sizeZ])
    .translate([cx - sizeX / 2, yMin, cz - sizeZ / 2])
    .getMesh()
  const positions = new Float32Array(mesh.vertProperties)
  const indices = new Uint32Array(mesh.triVerts)

  let minY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i]
  }
  let raised = 0
  for (let i = 1; i < positions.length && raised < 2; i += 3) {
    if (positions[i] === minY) {
      positions[i] += 1e-4
      raised++
    }
  }
  return { positions, indices }
}

function baseOptions(overrides: Partial<ExportOptions>): ExportOptions {
  return {
    terrainThickness: 10,
    flattenBottom: true,
    format: '3mf',
    scale: 0.001,
    openBottom: true,
    shellThickness: 2,
    hollowBuildings: true,
    ...overrides,
  }
}

describe('buildTerrainCavityMesh', () => {
  it('returns a closed cavity strictly inside the slab', async () => {
    const n = 8
    const slab = buildTerrainSlab(n, 20, 0, -10)
    const t = 2
    const cavity = buildTerrainCavityMesh(slab, t)

    expect(cavity).not.toBeNull()
    expect(cavity!.positions.length).toBe(slab.positions.length)

    // Ceiling sits exactly t below the terrain surface.
    for (let i = 0; i < n * n; i++) {
      expect(cavity!.positions[i * 3 + 1]).toBeCloseTo(slab.positions[i * 3 + 1] - t, 6)
    }
    // XZ inset by t from the outer walls.
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < n * n; i++) {
      minX = Math.min(minX, cavity!.positions[i * 3])
      maxX = Math.max(maxX, cavity!.positions[i * 3])
    }
    expect(minX).toBeCloseTo(-10 + t, 6)
    expect(maxX).toBeCloseTo(10 - t, 6)

    const manifold = await createManifoldFromMesh(cavity!)
    try {
      expect(manifold.status()).toBe('NoError')
      expect(manifold.volume()).toBeGreaterThan(0)
    } finally {
      manifold.delete()
    }
  })

  it('returns null when the shell is too thick for the footprint', () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    expect(buildTerrainCavityMesh(slab, 11)).toBeNull()
  })
})

describe('open-bottom hollowing', () => {
  it('hollows terrain and building into a single watertight shell', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const building = await buildBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const hollow = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({}),
    )
    const hollowValidation = await validateMesh(hollow.buffer, 'model/3mf')
    expect(hollowValidation.status).toBe('pass')
    expect(hollowValidation.numShells).toBe(1)
    expect(hollowValidation.open_edges).toBe(0)
    expect(hollowValidation.non_manifold_edges).toBe(0)
    expect(hollowValidation.self_intersections).toBe(0)
    expect(hollow.warnings).toEqual([])

    const solid = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ openBottom: false }),
    )
    const solidValidation = await validateMesh(solid.buffer, 'model/3mf')
    expect(solidValidation.status).toBe('pass')
    expect(solidValidation.numShells).toBe(1)

    // Hollowing removes the terrain interior and the building interior.
    expect(hollowValidation.volume).toBeLessThan(solidValidation.volume * 0.7)
  })

  it('keeps buildings smaller than the wall thickness solid and warns', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    // Footprint 2 units vs 2·t = 4 units in model space (scale 0.001).
    const small = await buildBoxBuilding(0, 0, 2, 2, -0.3, 6)

    const result = await buildPrintableModelFromMeshes(
      [small],
      slab,
      bounds,
      baseOptions({}),
    )
    expect(result.warnings.some((warning) => warning.includes('中実のまま残した建物'))).toBe(true)

    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)
  })

  it('warns and stays solid when openBottom is requested without terrain', async () => {
    const building = await buildBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const result = await buildPrintableModelFromMeshes(
      [building],
      null,
      bounds,
      baseOptions({}),
    )
    expect(result.warnings.some((warning) => warning.includes('地形がないため'))).toBe(true)

    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)
  })
})

describe('buildHollowBuildingShells', () => {
  it('returns an open-bottom shell lighter than the solid building', async () => {
    const building = await buildBoxBuilding(0, 0, 8, 8, -0.3, 10)
    const wallThickness = 2

    const shells = await buildHollowBuildingShells([building], bounds, wallThickness)
    expect(shells).toHaveLength(1)
    const shell = shells[0]

    // Inner surfaces are added, so the shell has more triangles than the input.
    expect(shell.indices.length).toBeGreaterThan(building.indices.length)

    const manifold = await createManifoldFromMesh(shell)
    try {
      expect(manifold.status()).toBe('NoError')
      expect(manifold.decompose().length).toBe(1)
      expect(manifold.volume()).toBeGreaterThan(0)
      // Hollowing removes the interior (solid box would be 8×8×10.3).
      expect(manifold.volume()).toBeLessThan(8 * 8 * 10)
    } finally {
      manifold.delete()
    }
  })

  it('keeps buildings smaller than the wall thickness solid', async () => {
    const small = await buildBoxBuilding(0, 0, 2, 2, -0.3, 6)

    const shells = await buildHollowBuildingShells([small], bounds, 2)
    expect(shells).toHaveLength(1)
    expect(shells[0].indices.length).toBe(small.indices.length)
  })
})

/** L字（凹）フットプリントのコンター（CrossSection 座標・反時計回り） */
function lShapeContour(size: number, notch: number): number[][] {
  return [
    [0, 0],
    [size, 0],
    [size, size - notch],
    [size - notch, size - notch],
    [size - notch, size],
    [0, size],
  ]
}

/**
 * CrossSection のコンターから床付き建物を作り、y-up の RawMesh で返す。
 *
 * cs 座標 (x, y)（フットプリント）はモデルの (x, z) = (cs.x + dx, -cs.y + dz)
 * に写り、中心 (centerX, centerZ)・底面 y=baseY に配置される。
 * noisy=true のときは底面2頂点をわずかに浮かせ、厳密な凸包キャップ検出
 * （絶対 1e-6）が発火しないようにする（実データの底面ノイズを模す）。
 */
async function buildFlooredBuilding(
  contours: number[][][],
  fillRule: 'EvenOdd' | undefined,
  footprintX: number,
  footprintZ: number,
  height: number,
  centerX: number,
  centerZ: number,
  baseY: number,
  noisy = true,
): Promise<RawMesh> {
  const wasm: any = await getManifoldModule()
  const crossSection = new wasm.CrossSection(contours, fillRule)
  const zUp = crossSection.extrude(height)
  crossSection.delete()
  const yUp = zUp.rotate([-90, 0, 0])
  zUp.delete()
  const placed = yUp.translate([centerX - footprintX / 2, baseY, centerZ + footprintZ / 2])
  yUp.delete()
  const geometry = placed.getMesh()
  placed.delete()

  const positions = new Float32Array(geometry.vertProperties)
  const indices = new Uint32Array(geometry.triVerts)
  if (noisy) {
    let minY = Infinity
    for (let i = 1; i < positions.length; i += 3) {
      if (positions[i] < minY) minY = positions[i]
    }
    let raised = 0
    for (let i = 1; i < positions.length && raised < 2; i += 3) {
      if (positions[i] === minY) {
        positions[i] += 1e-4
        raised++
      }
    }
  }
  return { positions, indices }
}

/** 底面（全頂点が最小Yの三角形）を取り除き、床なし建物にする */
function removeBottomFaces(mesh: RawMesh): RawMesh {
  const positions = mesh.positions
  const indices = mesh.indices
  let minY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i]
  }
  const atBottom = (vertexIndex: number): boolean =>
    Math.abs(positions[vertexIndex * 3 + 1] - minY) <= 1e-6
  const kept: number[] = []
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]
    const b = indices[t + 1]
    const c = indices[t + 2]
    if (atBottom(a) && atBottom(b) && atBottom(c)) continue
    kept.push(a, b, c)
  }
  return { positions, indices: new Uint32Array(kept) }
}

/** 完成モデル（upAxis=y-up で出力）と検査用小立方体の交差体積を返す */
async function probeIntersectionVolume(
  buffer: Uint8Array,
  probe: { x: number; y: number; z: number; size: number },
): Promise<number> {
  const model = await importFrom3MF(buffer)
  let box: Manifold | null = null
  let intersection: Manifold | null = null
  try {
    box = await createBox(probe.size)
    const placedBox = box.translate([probe.x, probe.y, probe.z])
    box.delete()
    box = placedBox
    intersection = model.intersect(box)
    return intersection.volume()
  } finally {
    intersection?.delete()
    box?.delete()
    model.delete()
  }
}

describe('P1: 凹形状・中庭・床なし底面', () => {
  it('L字（凹）建物: ノッチ直下の地形が削られない', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const building = await buildFlooredBuilding(
      [lShapeContour(8, 4)],
      undefined,
      8,
      8,
      10,
      0,
      0,
      -0.3,
    )

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ upAxis: 'y-up' }),
    )
    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)
    expect(result.warnings).toEqual([])

    // ノッチ中心（モデル座標 (2, -2)、scale=0.001）直下の屋根が残っていること。
    // 凸包カッターではこの領域が削られ、交差体積が 0 になる。
    const volume = await probeIntersectionVolume(result.buffer, {
      x: 0.002,
      y: -0.001,
      z: -0.002,
      size: 0.001,
    })
    expect(volume).toBeGreaterThan(0.5 * 0.001 ** 3)
  })

  it('中庭付き建物: 中庭直下の地形が削られない（穴が保持される）', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const building = await buildFlooredBuilding(
      [
        [
          [0, 0],
          [8, 0],
          [8, 8],
          [0, 8],
        ],
        [
          [2.5, 2.5],
          [5.5, 2.5],
          [5.5, 5.5],
          [2.5, 5.5],
        ],
      ],
      'EvenOdd',
      8,
      8,
      10,
      0,
      0,
      -0.3,
    )

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ upAxis: 'y-up' }),
    )
    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)

    // 中庭中心（モデル座標 (0, 0)）直下の屋根が残っていること
    const volume = await probeIntersectionVolume(result.buffer, {
      x: 0,
      y: -0.001,
      z: 0,
      size: 0.001,
    })
    expect(volume).toBeGreaterThan(0.5 * 0.001 ** 3)
  })

  it('床なし凹形状（L字）は理由付きで出力から除外される', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const floored = await buildFlooredBuilding(
      [lShapeContour(8, 4)],
      undefined,
      8,
      8,
      10,
      0,
      0,
      -0.3,
      false,
    )
    const floorless = removeBottomFaces(floored)

    const result = await buildPrintableModelFromMeshes([floorless], slab, bounds, baseOptions({}))
    expect(
      result.warnings.some((warning) => warning.includes('open bottom is not a single convex loop')),
    ).toBe(true)

    // 建物は出力から除外され、地形のみで watertight なまま
    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)
  })

  it('床なし凸形状（箱）は凸包キャップで修復されて中空化される', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const floorless = removeBottomFaces(
      await buildFlooredBuilding(
        [
          [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
          ],
        ],
        undefined,
        8,
        8,
        10,
        0,
        0,
        -0.3,
        false,
      ),
    )

    const result = await buildPrintableModelFromMeshes([floorless], slab, bounds, baseOptions({}))
    const validation = await validateMesh(result.buffer, 'model/3mf')
    expect(validation.status).toBe('pass')
    expect(validation.numShells).toBe(1)
    expect(result.warnings).toEqual([])

    const solid = await buildPrintableModelFromMeshes(
      [floorless],
      slab,
      bounds,
      baseOptions({ openBottom: false }),
    )
    const solidValidation = await validateMesh(solid.buffer, 'model/3mf')
    expect(solidValidation.status).toBe('pass')
    expect(validation.volume).toBeLessThan(solidValidation.volume * 0.7)
  })
})
