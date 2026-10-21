import { describe, expect, it } from 'vitest'

import { createManifoldFromMesh } from '../src/manifoldOps.js'
import { buildPrintableGeometryFromMeshes } from '../src/pipelineUtils.js'
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
    upAxis: 'y-up',
    ...overrides,
  }
}

interface GeometryMetrics {
  volume: number
  triangles: number
  bbox: [number, number, number, number, number, number]
  shells: number
}

async function measure(mesh: RawMesh): Promise<GeometryMetrics> {
  const manifold = await createManifoldFromMesh(mesh)
  try {
    const bb = manifold.boundingBox()
    return {
      volume: manifold.volume(),
      triangles: mesh.indices.length / 3,
      bbox: [bb.min[0], bb.min[1], bb.min[2], bb.max[0], bb.max[1], bb.max[2]],
      shells: manifold.decompose().length,
    }
  } finally {
    manifold.delete()
  }
}

/**
 * 往復除去（建物 Mesh→Manifold の再インポートと 3MF 再インポート）前の
 * 実装で計測した値。形状が変わっていないことを固定する。
 */
const GOLDEN = {
  openBottom: {
    volume: 0.0000024320000735421946,
    // 2D高速経路では三角形分割が変わり得るため、三角形数は固定しない
    // （体積・bbox・シェル数で形状同一性を担保する）。
    triangles: undefined,
    bbox: [-0.01, -0.01, -0.01, 0.01, 0.01, 0.01] as const,
    shells: 1,
  },
  solid: {
    volume: 0.000004639999778270727,
    triangles: 260,
    bbox: [-0.01, -0.01, -0.01, 0.01, 0.01, 0.01] as const,
    shells: 1,
  },
}

async function expectGolden(
  options: ExportOptions,
  golden: (typeof GOLDEN)[keyof typeof GOLDEN],
): Promise<void> {
  const slab = createTerrainSlab(8, 20, 0, -10)
  const building = await createBoxBuilding(0, 0, 8, 8, -0.3, 10)
  const result = await buildPrintableGeometryFromMeshes([building], slab, bounds, options)
  const metrics = await measure(result.mesh)

  if (golden.triangles !== undefined) {
    expect(metrics.triangles).toBe(golden.triangles)
  } else {
    expect(metrics.triangles).toBeGreaterThan(0)
  }
  expect(metrics.shells).toBe(golden.shells)
  expect(Math.abs(metrics.volume - golden.volume) / golden.volume).toBeLessThan(1e-6)
  for (let axis = 0; axis < 3; axis++) {
    expect(metrics.bbox[axis]).toBeCloseTo(golden.bbox[axis], 9)
    expect(metrics.bbox[axis + 3]).toBeCloseTo(golden.bbox[axis + 3], 9)
  }
  // 工程別タイミングが取得できる（計測は形状に影響しない）。
  expect(Object.keys(result.timings ?? {})).toEqual(
    expect.arrayContaining([
      'preprocess',
      'buildingManifold',
      'cutter',
      'union',
      'hollowCavity',
      'sealedCavityCheck',
      'getMesh',
      'total',
    ]),
  )
}

describe('完成形状のゴールデン（往復除去の等価性）', () => {
  it('openBottom: 中空化を含む完成形状がリファクタ前と一致する', async () => {
    await expectGolden(baseOptions({}), GOLDEN.openBottom)
  })

  it('中実: 地形＋建物の union 結果がリファクタ前と一致する', async () => {
    await expectGolden(baseOptions({ openBottom: false }), GOLDEN.solid)
  })
})
