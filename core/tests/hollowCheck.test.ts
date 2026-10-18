import { beforeAll, describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'

import { detectSealedCavities } from '../src/hollowCheck.js'

/**
 * detectSealedCavities() against the four synthetic models used to validate the
 * method in voidConnectivity.test.ts. Coordinates are y-up; outer 20x20x20,
 * cavity 16x16, wall 2.
 */

type Manifold = any

const OUTER = 20
const WALL = 2
const CAVITY = OUTER - 2 * WALL // 16
const CAVITY_VOLUME = CAVITY ** 3 // 4096
const HALF = OUTER / 2 // 10

let M: any

beforeAll(async () => {
  M = await getManifoldModule()
})

function box(sx: number, sy: number, sz: number, cx: number, cy: number, cz: number): Manifold {
  return M.Manifold.cube([sx, sy, sz], true).translate([cx, cy, cz])
}

/** Solid 20x20x20 box, y in [0, 20]. */
function solidBox(): Manifold {
  return box(OUTER, OUTER, OUTER, 0, HALF, 0)
}

/** Tray: cavity open at the bottom (y=0), top wall left intact. */
function openTray(): Manifold {
  const outer = box(OUTER, OUTER, OUTER, 0, HALF, 0)
  const cavity = box(CAVITY, 18, CAVITY, 0, 9, 0) // y in [0, 18]
  const tray = outer.subtract(cavity)
  outer.delete()
  cavity.delete()
  return tray
}

/** Fully enclosed hollow box: cavity y in [2, 18], wall 2 all round. */
function sealedHollow(): Manifold {
  const outer = box(OUTER, OUTER, OUTER, 0, HALF, 0)
  const cavity = box(CAVITY, CAVITY, CAVITY, 0, HALF, 0) // y in [2, 18]
  const shell = outer.subtract(cavity)
  outer.delete()
  cavity.delete()
  return shell
}

/** Sealed cavity by the bottom, cylindrical tunnel through one side wall. */
function sideHoleHollow(): Manifold {
  const shell = sealedHollow()
  const tunnel = M.Manifold.cylinder(6, 1.5, 1.5, 32, false)
    .rotate([0, 90, 0]) // axis +z -> +x, x in [0, 6]
    .translate([6, HALF, 5]) // crosses the wall x in [8, 10]
  const holed = shell.subtract(tunnel)
  shell.delete()
  tunnel.delete()
  return holed
}

describe('detectSealedCavities', () => {
  it('reports no cavity for a solid box', async () => {
    const model = solidBox()
    try {
      const report = await detectSealedCavities(model)
      expect(report.count).toBe(0)
      expect(report.volume).toBe(0)
    } finally {
      model.delete()
    }
  })

  it('reports one cavity with the cavity volume for a sealed hollow box', async () => {
    const model = sealedHollow()
    try {
      const report = await detectSealedCavities(model)
      expect(report.count).toBe(1)
      expect(report.volume).toBeGreaterThan(CAVITY_VOLUME * 0.95)
      expect(report.volume).toBeLessThan(CAVITY_VOLUME * 1.05)
    } finally {
      model.delete()
    }
  })

  it('reports no cavity for a bottom-open tray', async () => {
    const model = openTray()
    try {
      const report = await detectSealedCavities(model)
      expect(report.count).toBe(0)
      expect(report.volume).toBe(0)
    } finally {
      model.delete()
    }
  })

  it('reports no cavity for a bottom-closed box with only a side hole', async () => {
    const model = sideHoleHollow()
    try {
      const report = await detectSealedCavities(model)
      expect(report.count).toBe(0)
      expect(report.volume).toBe(0)
    } finally {
      model.delete()
    }
  })

  it('does not delete or alter the input model', async () => {
    const model = sealedHollow()
    const volumeBefore = model.volume()
    try {
      await detectSealedCavities(model)
      expect(model.status()).toBe('NoError')
      expect(model.volume()).toBeCloseTo(volumeBefore, 6)
    } finally {
      model.delete()
    }
  })

  it('works at small scales (scaled model space)', async () => {
    const scale = 1e-3
    const solid = solidBox().scale(scale)
    const tray = openTray().scale(scale)
    const sealed = sealedHollow().scale(scale)
    try {
      expect((await detectSealedCavities(solid)).count).toBe(0)
      expect((await detectSealedCavities(tray)).count).toBe(0)
      const sealedReport = await detectSealedCavities(sealed)
      expect(sealedReport.count).toBe(1)
      expect(sealedReport.volume).toBeGreaterThan(CAVITY_VOLUME * scale ** 3 * 0.95)
      expect(sealedReport.volume).toBeLessThan(CAVITY_VOLUME * scale ** 3 * 1.05)
    } finally {
      solid.delete()
      tray.delete()
      sealed.delete()
    }
  })
})
