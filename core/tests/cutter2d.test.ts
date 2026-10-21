import { describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'
import type { Manifold } from 'manifold-3d'

import { createManifoldFromMesh } from '../src/manifoldOps.js'
import {
  buildBuildingCutter,
  buildBuildingCutter2D,
  buildBuildingCutter3D,
  buildPrintableGeometryFromMeshes,
  createCutter2DDiagnostics,
} from '../src/pipelineUtils.js'
import type { Bounds, ExportOptions, RawMesh } from '../src/types.js'
import { createTerrainSlab } from './fixtures.js'

const bounds: Bounds = { west: 139.689, south: 35.689, east: 139.691, north: 35.691 }

/** 斜め辺を含む凸五角形（モデル XZ 断面）。 */
const CONVEX_PENTAGON = [
  [0, 0],
  [10, 0],
  [10, 6],
  [5, 10],
  [0, 6],
]

/** 非凸な L 字断面（腕の厚み 5 はモデル空間で 2t=0.004 より厚い）。 */
const L_SHAPE = [
  [0, 0],
  [10, 0],
  [10, 5],
  [5, 5],
  [5, 10],
  [0, 10],
]

/** 断面コンターを押し出した垂直プリズムを RawMesh（y-up, 底面 baseY）で返す。 */
async function prismMesh(
  contour: number[][] | number[][][],
  height: number,
  baseY: number,
  fillRule?: 'EvenOdd',
): Promise<RawMesh> {
  const wasm: any = await getManifoldModule()
  const cross = fillRule ? new wasm.CrossSection(contour, fillRule) : new wasm.CrossSection(contour)
  const zUp = cross.extrude(height)
  cross.delete()
  const yUp = zUp.rotate([-90, 0, 0])
  zUp.delete()
  const placed = yUp.translate([0, baseY, 0])
  yUp.delete()
  const geometry = placed.getMesh()
  placed.delete()
  return {
    positions: new Float32Array(geometry.vertProperties),
    indices: new Uint32Array(geometry.triVerts),
  }
}

async function symmetricDifferenceVolume(a: Manifold, b: Manifold): Promise<number> {
  const wasm: any = await getManifoldModule()
  const onlyA = a.subtract(b)
  const onlyB = b.subtract(a)
  const union = wasm.Manifold.union([onlyA, onlyB])
  try {
    return union.volume()
  } finally {
    union.delete()
    onlyA.delete()
    onlyB.delete()
  }
}

async function expectCuttersEquivalent(a: Manifold, b: Manifold): Promise<void> {
  expect(Math.abs(a.volume() - b.volume()) / a.volume()).toBeLessThan(1e-6)
  const boxA = a.boundingBox()
  const boxB = b.boundingBox()
  for (let axis = 0; axis < 3; axis++) {
    // bbox は三角形分割の丸めで 1e-8 程度ずれ得る（形状サイズ ~10 に対して十分小さい）。
    expect(Math.abs(boxA.min[axis] - boxB.min[axis])).toBeLessThan(1e-6)
    expect(Math.abs(boxA.max[axis] - boxB.max[axis])).toBeLessThan(1e-6)
  }
  const symmetric = await symmetricDifferenceVolume(a, b)
  expect(symmetric / a.volume()).toBeLessThan(1e-6)
}

function baseOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
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

describe('2D侵食の高速経路', () => {
  it('凸プリズム: 2D経路と3D経路のカッターが体積・bbox・対称差で一致する', async () => {
    const mesh = await prismMesh(CONVEX_PENTAGON, 10, 0)
    const building = await createManifoldFromMesh(mesh)
    try {
      const t = 0.5
      const minY = 0
      const maxY = 10
      const modelMinY = -1

      const via3d = await buildBuildingCutter3D(building, minY, maxY, t, modelMinY)
      const via2d = await buildBuildingCutter2D(building, minY, maxY, t, modelMinY)

      expect(via3d.status).toBe('hollowed')
      expect(via2d?.status).toBe('hollowed')
      if (via3d.status !== 'hollowed' || via2d?.status !== 'hollowed') return

      try {
        await expectCuttersEquivalent(via3d.cutter, via2d.cutter)
      } finally {
        via3d.cutter.delete()
        via2d.cutter.delete()
      }
    } finally {
      building.delete()
    }
  })

  it('L字（非凸）: 足跡プリズム経路でカッターを生成し3Dと一致する', async () => {
    const mesh = await prismMesh(L_SHAPE, 10, 0)
    const building = await createManifoldFromMesh(mesh)
    try {
      const t = 0.5
      const diagnostics = createCutter2DDiagnostics()
      const via2d = await buildBuildingCutter2D(building, 0, 10, t, -1, diagnostics)
      const via3d = await buildBuildingCutter3D(building, 0, 10, t, -1)

      expect(diagnostics.notConvexArea).toBe(1)
      expect(diagnostics.appliedFootprint).toBe(1)
      expect(via2d?.status).toBe('hollowed')
      expect(via3d.status).toBe('hollowed')
      if (via2d?.status !== 'hollowed' || via3d.status !== 'hollowed') return
      try {
        // 非凸プリズムでも足跡プリズムの minkowski は3D侵食と厳密に一致する。
        await expectCuttersEquivalent(via3d.cutter, via2d.cutter)
      } finally {
        via2d.cutter.delete()
        via3d.cutter.delete()
      }

      const auto = await buildBuildingCutter(building, 0, 10, t, -1)
      expect(auto.path).toBe('2d')
      expect(auto.status).toBe('hollowed')
      if (auto.status === 'hollowed') auto.cutter.delete()
    } finally {
      building.delete()
    }
  })

  it('中庭（穴あり）プリズムも足跡プリズム経路で3Dと一致する', async () => {
    const withHole = [
      [
        [0, 0],
        [12, 0],
        [12, 12],
        [0, 12],
      ],
      [
        [4, 4],
        [8, 4],
        [8, 8],
        [4, 8],
      ],
    ]
    const mesh = await prismMesh(withHole, 10, 0, 'EvenOdd')
    const building = await createManifoldFromMesh(mesh)
    try {
      const t = 0.5
      const diagnostics = createCutter2DDiagnostics()
      const via2d = await buildBuildingCutter2D(building, 0, 10, t, -1, diagnostics)
      const via3d = await buildBuildingCutter3D(building, 0, 10, t, -1)
      expect(diagnostics.notConvexContours).toBe(1)
      expect(diagnostics.appliedFootprint).toBe(1)
      expect(via2d?.status).toBe('hollowed')
      if (via2d?.status !== 'hollowed' || via3d.status !== 'hollowed') return
      try {
        await expectCuttersEquivalent(via3d.cutter, via2d.cutter)
      } finally {
        via2d.cutter.delete()
        via3d.cutter.delete()
      }
    } finally {
      building.delete()
    }
  })

  it('侵食が空になる凸プリズムは3Dを走らせず boolean-failed を返す', async () => {
    // 鋭角三角形: bbox は 2t より大きいが、正方形(t)が内接できない。
    const mesh = await prismMesh(
      [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
      10,
      0,
    )
    const building = await createManifoldFromMesh(mesh)
    try {
      const t = 3
      const diagnostics = createCutter2DDiagnostics()
      const via2d = await buildBuildingCutter2D(building, 0, 10, t, -1, diagnostics)
      expect(diagnostics.erosionEmpty).toBe(1)
      expect(via2d?.status).toBe('boolean-failed')
      expect(via2d?.path).toBe('2d')

      const via3d = await buildBuildingCutter3D(building, 0, 10, t, -1)
      expect(via3d.status).toBe('boolean-failed')
    } finally {
      building.delete()
    }
  })

  it('細い非凸プリズムは4シフト判定で侵食空を即断し3Dを走らせない', async () => {
    const thinL = [
      [0, 0],
      [10, 0],
      [10, 1],
      [1, 1],
      [1, 10],
      [0, 10],
    ]
    const mesh = await prismMesh(thinL, 10, 0)
    const building = await createManifoldFromMesh(mesh)
    try {
      const t = 0.75
      const diagnostics = createCutter2DDiagnostics()
      const via2d = await buildBuildingCutter2D(building, 0, 10, t, -1, diagnostics)
      expect(diagnostics.footprintEmpty).toBe(1)
      expect(via2d?.status).toBe('boolean-failed')
      expect(via2d?.path).toBe('2d')

      const via3d = await buildBuildingCutter3D(building, 0, 10, t, -1)
      expect(via3d.status).toBe('boolean-failed')
    } finally {
      building.delete()
    }
  })

  it('凸プリズムはパイプラインで2D高速経路が選ばれる（適用数で確認）', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await prismMesh(CONVEX_PENTAGON, 10, -0.3)

    const result = await buildPrintableGeometryFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions(),
    )

    expect(result.hollowing?.hollowed).toBe(1)
    expect(result.timings?.cutter2dCount).toBe(1)
    expect(result.timings?.cutter3dCount).toBe(0)
  })

  it('L字（非凸）もパイプラインで2D（足跡）経路が選ばれる', async () => {
    const slab = createTerrainSlab(8, 20, 0, -10)
    const building = await prismMesh(L_SHAPE, 10, -0.3)

    const result = await buildPrintableGeometryFromMeshes(
      [building],
      slab,
      bounds,
      baseOptions(),
    )

    expect(result.hollowing?.hollowed).toBe(1)
    expect(result.timings?.cutter2dCount).toBe(1)
    expect(result.timings?.cutter3dCount).toBe(0)
    expect(result.timings?.cutter2dAppliedFootprint).toBe(1)
  })
})
