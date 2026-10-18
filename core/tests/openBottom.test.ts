import { describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'
import type { Manifold } from 'manifold-3d'

import { buildPrintableModelFromMeshes, buildHollowBuildingShells } from '../src/pipelineUtils.js'
import {
  buildSlabIndices,
  buildTerrainCavityMesh,
  sampleTerrainHeightFromGrid,
  scaleRawMesh,
} from '../src/pipelineCore.js'
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
 * (top grid followed by bottom grid). `topYAt` overrides the flat top height.
 */
function buildTerrainSlab(
  n: number,
  size: number,
  topY: number,
  bottomY: number,
  topYAt?: (i: number, j: number) => number,
): RawMesh {
  const positions: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      positions.push(
        -size / 2 + (size * j) / (n - 1),
        topYAt ? topYAt(i, j) : topY,
        size / 2 - (size * i) / (n - 1),
      )
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
    expect(hollow.hollowing?.hollowed).toBe(1)
    expect(hollow.hollowing?.keptSolid).toBe(0)
    expect(hollow.hollowing?.excluded).toBe(0)
    expect(hollow.hollowing?.sealedCavities).toBe(0)
    expect(hollow.hollowing?.reachability).toBe('unverified')

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

  it('建物のシャフトが底面まで開通している（検査柱で確認）', async () => {
    const slab = buildTerrainSlab(8, 20, 0, -10)
    const building = await buildBoxBuilding(0, 0, 8, 8, -0.3, 10)
    const probe = { x: 0, y: -0.0075, z: 0, sizeX: 0.0005, sizeY: 0.025, sizeZ: 0.0005 }

    // 建物中心を下から貫く細い柱。底面開口から建物内部まで開通していれば
    // 完成モデルと交差しない（既知形状のシャフトに対する回帰テスト）。
    const hollow = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ upAxis: 'y-up' }),
    )
    const hollowProbe = await probeIntersectionVolume(hollow.buffer, probe)
    expect(hollowProbe).toBeLessThan(1e-11)

    // 対照: 中実（openBottom=false）では柱が材料を貫くため交差体積が正
    const solid = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ openBottom: false, upAxis: 'y-up' }),
    )
    const solidProbe = await probeIntersectionVolume(solid.buffer, probe)
    expect(solidProbe).toBeGreaterThan(1e-13)
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
    expect(result.hollowing?.keptSolid).toBe(1)
    expect(result.hollowing?.records[0]?.status).toBe('small')

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

/** 完成モデル（upAxis=y-up で出力）と検査用直方体の交差体積を返す */
async function probeIntersectionVolume(
  buffer: Uint8Array,
  probe: { x: number; y: number; z: number; sizeX: number; sizeY: number; sizeZ: number },
): Promise<number> {
  const model = await importFrom3MF(buffer)
  let box: Manifold | null = null
  let intersection: Manifold | null = null
  try {
    box = await createBox(1)
    const scaledBox = box.scale([probe.sizeX, probe.sizeY, probe.sizeZ])
    box.delete()
    box = scaledBox
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
      sizeX: 0.001,
      sizeY: 0.001,
      sizeZ: 0.001,
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
      sizeX: 0.001,
      sizeY: 0.001,
      sizeZ: 0.001,
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
    expect(result.hollowing?.excluded).toBe(1)
    expect(result.hollowing?.records[0]?.status).toBe('cap-unsupported')

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

describe('P2: 斜面でのキャビティ天井の再サンプル', () => {
  it('急斜面（45°超）でも天井が移動先の地表 − t に一致する', () => {
    const n = 8
    const size = 20
    const slope = 2 // 45°超（約63°）: +x 方向へ急降下
    const slab = buildTerrainSlab(n, size, 0, -10, (_i, j) => {
      const x = -size / 2 + (size * j) / (n - 1)
      return -slope * x
    })
    const scaled = scaleRawMesh(slab, 0.001)
    const t = 0.002
    const cavity = buildTerrainCavityMesh(scaled, t)
    expect(cavity).not.toBeNull()

    const positions = scaled.positions
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < n * n; i++) {
      minX = Math.min(minX, positions[i * 3])
      maxX = Math.max(maxX, positions[i * 3])
      minZ = Math.min(minZ, positions[i * 3 + 2])
      maxZ = Math.max(maxZ, positions[i * 3 + 2])
    }
    const gridBounds = { minX, maxX, minZ, maxZ }

    // 天井は「移動先の地表 − t」に一致し、地表を突き抜けない。
    // （旧方式: 元頂点の高さ − t では、急斜面で (slope-1)·t だけ地表より上に出る）
    for (let i = 0; i < n * n; i++) {
      const x = cavity!.positions[i * 3]
      const z = cavity!.positions[i * 3 + 2]
      const surface = sampleTerrainHeightFromGrid(positions, n, gridBounds, x, z)
      expect(surface).not.toBeNull()
      // Float32格納の丸め誤差（~1e-9）を許容する
      expect(Math.abs(cavity!.positions[i * 3 + 1] - (surface! - t))).toBeLessThan(1e-7)
      expect(cavity!.positions[i * 3 + 1]).toBeLessThanOrEqual(surface! + 1e-9)
    }
  })

  it('非平面セルでは実際の三角形分割で高さを評価する（双線形と異なる）', () => {
    const n = 3
    const size = 4
    // チェッカーボード状の高さ: 各セルの4隅が同一平面に乗らない
    const slab = buildTerrainSlab(n, size, 0, -10, (i, j) => ((i + j) % 2 === 0 ? 0 : 10))
    const positions = slab.positions
    const gridBounds = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 }
    const cell = size / (n - 1) // 2

    // セル (0,0) の角: a=0, b=10, c=10, d=0
    // u=v=0.25 は (a,b,c) 側 → ha + 0.25(hb-ha) + 0.25(hc-ha) = 5
    const t1 = sampleTerrainHeightFromGrid(
      positions,
      n,
      gridBounds,
      -2 + cell * 0.25,
      2 - cell * 0.25,
    )
    expect(t1).toBeCloseTo(5, 9)
    // u=v=0.75 は (b,d,c) 側 → hd + 0.25(hc-hd) + 0.25(hb-hd) = 5
    const t2 = sampleTerrainHeightFromGrid(
      positions,
      n,
      gridBounds,
      -2 + cell * 0.75,
      2 - cell * 0.75,
    )
    expect(t2).toBeCloseTo(5, 9)
    // 双線形補間なら 3.75 になる（三角形分割との差が今回の問題だった）
    expect(t1).not.toBeCloseTo(3.75, 6)
    expect(t2).not.toBeCloseTo(3.75, 6)
  })
})
