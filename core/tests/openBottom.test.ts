import { describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'

import { buildPrintableModelFromMeshes, buildHollowBuildingShells } from '../src/pipelineUtils.js'
import { buildSlabIndices, buildTerrainCavityMesh } from '../src/pipelineCore.js'
import { createManifoldFromMesh } from '../src/manifoldOps.js'
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
    expect(result.warnings.some((warning) => warning.includes('中実のまま残しました'))).toBe(true)

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
