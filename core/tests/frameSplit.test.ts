import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'

import {
  buildPrintableGeometryFromMeshes,
  buildPrintableModelFromMeshes,
  buildSplitModelFromFinalMesh,
} from '../src/pipelineUtils.js'
import {
  buildBaseSlabMesh,
  buildFrameCutterMesh,
  buildSlabIndices,
  buildTerrainCavityMesh,
  scaleRawMesh,
} from '../src/pipelineCore.js'
import {
  BASE_CLEARANCE_MM,
  BASE_EXTENSION_MM,
  FRAME_STEP_MM,
} from '../src/frameSplitConstants.js'
import { createManifoldFromMesh, importFrom3MF } from '../src/manifoldOps.js'
import { validateMesh } from '../src/validate.js'
import type { Bounds, ExportOptions, RawMesh } from '../src/types.js'
import { createBoxBuilding, createTerrainSlab } from './fixtures.js'

const bounds: Bounds = {
  west: 139.689,
  south: 35.689,
  east: 139.691,
  north: 35.691,
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
    splitAtGround: true,
    upAxis: 'y-up',
    ...overrides,
  }
}

/** 東方向（x）へ傾斜する地形スラブ。 */
function createSlopedSlab(
  n: number,
  size: number,
  minTop: number,
  maxTop: number,
  bottom: number,
): RawMesh {
  const positions: number[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -size / 2 + (size * j) / (n - 1)
      const z = size / 2 - (size * i) / (n - 1)
      positions.push(x, minTop + ((maxTop - minTop) * j) / (n - 1), z)
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -size / 2 + (size * j) / (n - 1)
      const z = size / 2 - (size * i) / (n - 1)
      positions.push(x, bottom, z)
    }
  }
  return { positions: new Float32Array(positions), indices: buildSlabIndices(n) }
}

describe('frame split', () => {
  it('splits a hollow model into a frame and a buildings part', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({}),
    )

    expect(result.split).toBeDefined()
    const files = unzipSync(result.buffer)
    expect(Object.keys(files).sort()).toEqual(['model_base.3mf', 'model_buildings.3mf'])

    const baseValidation = await validateMesh(result.split!.base, 'model/3mf')
    const buildingsValidation = await validateMesh(result.split!.buildings, 'model/3mf')

    expect(baseValidation.status).toBe('pass')
    expect(baseValidation.numShells).toBe(1)
    expect(baseValidation.open_edges).toBe(0)
    expect(baseValidation.non_manifold_edges).toBe(0)
    expect(baseValidation.self_intersections).toBe(0)

    // 建物カッターがベースを貫通するため、中空化ONでも密閉空洞にならない。
    expect(buildingsValidation.status).toBe('pass')
    expect(buildingsValidation.numShells).toBe(1)
    expect(buildingsValidation.open_edges).toBe(0)
    expect(buildingsValidation.non_manifold_edges).toBe(0)
    expect(buildingsValidation.self_intersections).toBe(0)
  })

  it('adds the solid base to the buildings part', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const splitResult = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({}),
    )
    const unsplitResult = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ splitAtGround: false }),
    )

    const splitBase = await validateMesh(splitResult.split!.base, 'model/3mf')
    const splitBuildings = await validateMesh(splitResult.split!.buildings, 'model/3mf')
    const unsplit = await validateMesh(unsplitResult.buffer, 'model/3mf')

    // 外周帯の表層は枠へ移るだけで合計は変わらない。分割後はパッド分だけ増える。
    const baseMesh = buildBaseSlabMesh(
      scaleRawMesh(slab, 0.001),
      0.002,
      BASE_CLEARANCE_MM * 0.001,
      BASE_EXTENSION_MM * 0.001,
    )
    expect(baseMesh).not.toBeNull()
    const baseManifold = await createManifoldFromMesh(baseMesh!)
    let baseVolume = 0
    try {
      baseVolume = baseManifold.volume()
    } finally {
      baseManifold.delete()
    }

    const splitVolume = splitBase.volume + splitBuildings.volume
    expect(splitVolume).toBeGreaterThan(unsplit.volume)
    // 増分はパッド体積以内（中空化の穴とプレートとの重なり分だけ小さい）。
    expect(splitVolume - unsplit.volume).toBeLessThan(baseVolume)
    expect(splitVolume - unsplit.volume).toBeGreaterThan(baseVolume * 0.3)
  })

  it('opens the building cavities through the solid base', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const preview = await buildPrintableGeometryFromMeshes([building], slab, bounds, baseOptions({}))
    expect(preview.split).toBeDefined()
    expect(preview.terrainMesh).not.toBeNull()

    const full = await buildPrintableModelFromMeshes([building], slab, bounds, baseOptions({}))
    // カッター無しで合体メッシュから再分割したもの（ベースに穴が空かない）。
    const withoutOpenings = await buildSplitModelFromFinalMesh(
      preview.mesh,
      preview.terrainMesh!,
      baseOptions({}),
    )

    const opened = await validateMesh(full.split!.buildings, 'model/3mf')
    const closed = await validateMesh(withoutOpenings.split.buildings, 'model/3mf')
    expect(opened.status).toBe('pass')
    expect(opened.numShells).toBe(1)
    // 建物空洞の貫通穴の分だけ、穴あきベースの体積が小さい。
    expect(opened.volume).toBeLessThan(closed.volume)
    expect(closed.status).toBe('warning')
  })

  it('builds the frame cutter as one closed L-shaped shell', async () => {
    for (const slab of [
      createTerrainSlab(8, 20, 0, -10),
      createSlopedSlab(8, 20, -5, 5, -10),
    ]) {
      const scaled = scaleRawMesh(slab, 0.001)
      const cavity = buildTerrainCavityMesh(scaled, 0.002)
      expect(cavity).not.toBeNull()
      const mesh = buildFrameCutterMesh(scaled, cavity!, 0.002, FRAME_STEP_MM * 0.001)
      expect(mesh).not.toBeNull()

      const manifold = await createManifoldFromMesh(mesh!)
      try {
        expect(manifold.status()).toBe('NoError')
        expect(manifold.volume()).toBeGreaterThan(0)
        const shells = manifold.decompose()
        expect(shells.length).toBe(1)
        for (const shell of shells) shell.delete()
      } finally {
        manifold.delete()
      }
    }
  })

  it('insets the solid base inside the frame cavity', () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    // 座標空間に依存しないヘルパーの単体確認（t=2, c=0.15, e=0.2）。
    const base = buildBaseSlabMesh(slab, 2, BASE_CLEARANCE_MM, BASE_EXTENSION_MM)
    expect(base).not.toBeNull()

    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let atBottom = 0
    const p = base!.positions
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i])
      maxX = Math.max(maxX, p[i])
      minZ = Math.min(minZ, p[i + 2])
      maxZ = Math.max(maxZ, p[i + 2])
      minY = Math.min(minY, p[i + 1])
      maxY = Math.max(maxY, p[i + 1])
      if (Math.abs(p[i + 1] - (0 - 2 - BASE_EXTENSION_MM)) < 1e-6) atBottom++
    }

    // 空洞境界（スラブ外形から t=2 内側 = ±8）よりさらに c 内側。
    expect(minX).toBeCloseTo(-10 + 2 + BASE_CLEARANCE_MM, 6)
    expect(maxX).toBeCloseTo(10 - 2 - BASE_CLEARANCE_MM, 6)
    expect(minZ).toBeCloseTo(-10 + 2 + BASE_CLEARANCE_MM, 6)
    expect(maxZ).toBeCloseTo(10 - 2 - BASE_CLEARANCE_MM, 6)
    // 底面は地形最低点 - t - e の水平面、上面は地表 - t + 0.1t。
    expect(minY).toBeCloseTo(0 - 2 - BASE_EXTENSION_MM, 6)
    expect(maxY).toBeCloseTo(0 - 2 + 0.2, 6)
    // 底面グリッドの全頂点が平らな底面に載る。
    expect(atBottom).toBe(8 * 8)
  })

  it('rejects split without openBottom or terrain', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    await expect(
      buildPrintableModelFromMeshes(
        [building],
        slab,
        bounds,
        baseOptions({ openBottom: false }),
      ),
    ).rejects.toThrow(/底面を開口/)

    await expect(
      buildPrintableModelFromMeshes(
        [building],
        null,
        bounds,
        baseOptions({ includeTerrain: false }),
      ),
    ).rejects.toThrow(/地形/)
  })

  it('enforces the minimum frame height', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    await expect(
      buildPrintableModelFromMeshes(
        [building],
        slab,
        bounds,
        baseOptions({ terrainThickness: 3.5, shellThickness: 2 }),
      ),
    ).rejects.toThrow(/2mm/)
  })

  it('keeps multiple buildings connected through the ground plate', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const left = await createBoxBuilding(-3, 0, 4, 4, -0.3, 8)
    const right = await createBoxBuilding(3, 0, 4, 4, -0.3, 8)

    const result = await buildPrintableModelFromMeshes(
      [left, right],
      slab,
      bounds,
      baseOptions({ hollowBuildings: false }),
    )

    expect(result.split).toBeDefined()
    const baseValidation = await validateMesh(result.split!.base, 'model/3mf')
    const buildingsValidation = await validateMesh(result.split!.buildings, 'model/3mf')
    expect(baseValidation.numShells).toBe(1)
    // 地表プレートが複数建物を連結するため、建物部分も単一シェルになる。
    expect(buildingsValidation.numShells).toBe(1)
    expect(buildingsValidation.status).toBe('pass')
  })

  it('supports sloped terrain without a lip', async () => {
    const slab = createSlopedSlab(8, 20, -5, 5, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ hollowBuildings: false }),
    )
    expect(result.split).toBeDefined()

    const baseManifold = await importFrom3MF(result.split!.base)
    const buildingsManifold = await importFrom3MF(result.split!.buildings)
    try {
      const baseBox = baseManifold.boundingBox()
      const buildingsBox = buildingsManifold.boundingBox()
      // スケール 1/1000: 地形は -0.005..0.005、底面 -0.01、シェル t=0.002、
      // 段差 s=0.0004、クリアランス c=0.00015。
      const halfO = 0.01
      const t = 0.002
      const s = FRAME_STEP_MM * 0.001
      const c = BASE_CLEARANCE_MM * 0.001
      // 枠は外形 O のまま。フランジ上面が地表なので最高点は地形最高点 0.005。
      expect(baseBox.min[0]).toBeCloseTo(-halfO, 6)
      expect(baseBox.max[0]).toBeCloseTo(halfO, 6)
      expect(baseBox.min[2]).toBeCloseTo(-halfO, 6)
      expect(baseBox.max[2]).toBeCloseTo(halfO, 6)
      expect(baseBox.min[1]).toBeCloseTo(-0.01, 6)
      expect(baseBox.max[1]).toBeCloseTo(0.005, 6)
      // 建物部分の最低点はベース底面（地形最低点 - t - e = -0.005 - 0.002 - 0.0002）。
      expect(buildingsBox.min[1]).toBeCloseTo(-0.0072, 6)
      // 建物側プレートの外周は S = O - (t - s) で切り取られる。
      const halfS = halfO - (t - s)
      expect(buildingsBox.min[0]).toBeCloseTo(-halfS, 6)
      expect(buildingsBox.max[0]).toBeCloseTo(halfS, 6)
      expect(buildingsBox.min[2]).toBeCloseTo(-halfS, 6)
      expect(buildingsBox.max[2]).toBeCloseTo(halfS, 6)

      // 斜面でもベース底面は水平: 最低点の頂点が底面グリッド分だけ並ぶ。
      const mesh = buildingsManifold.getMesh()
      let bottomVertices = 0
      let bottomMinX = Infinity
      let bottomMaxX = -Infinity
      for (let i = 0; i < mesh.vertProperties.length; i += 3) {
        const y = mesh.vertProperties[i + 1]
        if (Math.abs(y - buildingsBox.min[1]) >= 1e-9) continue
        bottomVertices++
        bottomMinX = Math.min(bottomMinX, mesh.vertProperties[i])
        bottomMaxX = Math.max(bottomMaxX, mesh.vertProperties[i])
      }
      expect(bottomVertices).toBeGreaterThanOrEqual(3)
      // パッド側 P と外周 S の差が s + c（= 張り出し 0.55mm）。
      expect(bottomMinX).toBeCloseTo(-(halfO - t - c), 6)
      expect(bottomMaxX).toBeCloseTo(halfO - t - c, 6)
      expect(halfS - (halfO - t - c)).toBeCloseTo(s + c, 9)

      const intersection = baseManifold.intersect(buildingsManifold)
      try {
        expect(intersection.volume()).toBeLessThan(1e-12)
      } finally {
        intersection.delete()
      }
    } finally {
      baseManifold.delete()
      buildingsManifold.delete()
    }

    const baseValidation = await validateMesh(result.split!.base, 'model/3mf')
    const buildingsValidation = await validateMesh(result.split!.buildings, 'model/3mf')
    expect(baseValidation.status).toBe('pass')
    expect(buildingsValidation.status).toBe('pass')
  })

  it('keeps the buildings part on top of the frame without a lip', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({}),
    )
    const baseManifold = await importFrom3MF(result.split!.base)
    const buildingsManifold = await importFrom3MF(result.split!.buildings)
    try {
      // リップがないので建物部分は枠の底面より上にしか存在しない。
      expect(buildingsManifold.boundingBox().min[1]).toBeGreaterThan(
        baseManifold.boundingBox().min[1],
      )
      const intersection = baseManifold.intersect(buildingsManifold)
      try {
        expect(intersection.volume()).toBeLessThan(1e-12)
      } finally {
        intersection.delete()
      }
    } finally {
      baseManifold.delete()
      buildingsManifold.delete()
    }
  })

  it('builds the same split from a cached final mesh and terrain mesh', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const preview = await buildPrintableGeometryFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ splitAtGround: false, hollowBuildings: false }),
    )
    expect(preview.terrainMesh).not.toBeNull()

    const cached = await buildSplitModelFromFinalMesh(
      preview.mesh,
      preview.terrainMesh!,
      baseOptions({ hollowBuildings: false }),
    )
    const baseValidation = await validateMesh(cached.split.base, 'model/3mf')
    const buildingsValidation = await validateMesh(cached.split.buildings, 'model/3mf')
    expect(baseValidation.status).toBe('pass')
    expect(buildingsValidation.status).toBe('pass')
    expect(baseValidation.numShells).toBe(1)
    expect(buildingsValidation.numShells).toBe(1)
  })

  it('returns the merged mesh and both split parts for preview', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const preview = await buildPrintableGeometryFromMeshes([building], slab, bounds, baseOptions({}))
    expect(preview.mesh.indices.length).toBeGreaterThan(0)
    expect(preview.split?.frame.indices.length).toBeGreaterThan(0)
    expect(preview.split?.buildings.indices.length).toBeGreaterThan(0)
  })

  it('writes split parts as STL entries when format is stl', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    const result = await buildPrintableModelFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions({ format: 'stl', hollowBuildings: false }),
    )
    expect(result.split).toBeDefined()
    const files = unzipSync(result.buffer)
    expect(Object.keys(files).sort()).toEqual(['model_base.stl', 'model_buildings.stl'])
    expect((await validateMesh(result.split!.base, 'model/stl')).status).toBe('pass')
    expect((await validateMesh(result.split!.buildings, 'model/stl')).status).toBe('pass')
  })

  it('accepts the minimum frame height boundary', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)

    await expect(
      buildPrintableModelFromMeshes(
        [building],
        slab,
        bounds,
        baseOptions({ terrainThickness: 4, shellThickness: 2 }),
      ),
    ).resolves.toHaveProperty('split')

    await expect(
      buildPrintableModelFromMeshes(
        [building],
        slab,
        bounds,
        baseOptions({ terrainThickness: 3.99, shellThickness: 2 }),
      ),
    ).rejects.toThrow(/2mm/)
  })
})
