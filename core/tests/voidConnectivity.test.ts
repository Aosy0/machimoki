import { beforeAll, describe, expect, it } from 'vitest'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'

/**
 * Feasibility probe for judging a hollow printable model:
 *   (a) no sealed cavity exists (a void not connected to the outside), and
 *   (b) every cavity is reachable from the model's *bottom* face - a side-wall
 *       hole that loops around the outside must NOT count as a bottom opening.
 *
 * Two candidate methods are measured against four synthetic models:
 *   - non-restricted void:  BIG - model        (sealed-cavity detection)
 *   - restricted void:      region - model     (bottom-reachability detection)
 * where `region` is an inset prism spanning [below the bottom .. above the top],
 * so only the model's bottom face is exposed inside the domain.
 *
 * decompose() splits boundary topology, not spatial regions, so we do NOT trust
 * component counts alone: a seed can fall inside several nested shells. Sealed
 * cavities are detected as "the cavity-centre seed lies in a positive component
 * that the exterior seed does not", and bottom reachability as "the just-below-
 * bottom seed shares a component with the cavity-centre seed".
 *
 * Coordinates are y-up (height = y). Outer 20x20x20, cavity 16x16, wall 2.
 */

type Manifold = any

// Model geometry.
const OUTER = 20
const WALL = 2
const CAVITY = OUTER - 2 * WALL // 16
const HALF = OUTER / 2 // 10

// Seed geometry (small probe cubes; a positive intersection volume means "inside").
const SEED = 2
const HIT_EPSILON = 1e-6

// BIG container: surrounds the model with margin below y=0 so the exterior seed
// and the just-below-bottom seed are both in the open outer void.
const BIG = 60

// Restricted prism: footprint inset by 1, extruded from below the bottom to
// above the top.
const INSET = 1
const REGION_BOTTOM = -3
const REGION_TOP = 22
const REGION_FOOT = OUTER - 2 * INSET // 18

// Side-hole model: cylindrical tunnel through one side wall only.
const TUNNEL_RADIUS = 1.5
const TUNNEL_Z = 5 // offset from the cavity centre so the interior seed stays void

let M: any
let results: Partial<Record<string, CaseResult>> = {}

beforeAll(async () => {
  M = await getManifoldModule()

  const seeds = makeSeeds()
  for (const scenario of scenarios) {
    const model = scenario.build()
    results[scenario.name] = runCase(model, seeds)
    model.delete()
  }
  for (const seed of seeds) seed.manifold.delete()
})

function box(sx: number, sy: number, sz: number, cx: number, cy: number, cz: number): Manifold {
  return M.Manifold.cube([sx, sy, sz], true).translate([cx, cy, cz])
}

function seedAt(cx: number, cy: number, cz: number): Manifold {
  return box(SEED, SEED, SEED, cx, cy, cz)
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

/** Sealed hollow box with a single cylindrical tunnel through one side wall. */
function sideHoleHollow(): Manifold {
  const shell = sealedHollow()
  // Cylinder axis defaults to +z; rotate onto +x (x in [0, 6]) and place it
  // crossing the wall x in [8, 10].
  const tunnel = M.Manifold.cylinder(6, TUNNEL_RADIUS, TUNNEL_RADIUS, 32, false)
    .rotate([0, 90, 0])
    .translate([6, HALF, TUNNEL_Z])
  const holed = shell.subtract(tunnel)
  shell.delete()
  tunnel.delete()
  return holed
}

function bigSolid(): Manifold {
  return box(BIG, BIG, BIG, 0, HALF, 0)
}

function restrictedRegion(): Manifold {
  const height = REGION_TOP - REGION_BOTTOM
  const midY = (REGION_TOP + REGION_BOTTOM) / 2
  return box(REGION_FOOT, height, REGION_FOOT, 0, midY, 0)
}

type Seed = { name: string; manifold: Manifold }

function makeSeeds(): Seed[] {
  return [
    { name: 'external', manifold: seedAt(-25, -15, -25) }, // BIG corner
    { name: 'bottom', manifold: seedAt(0, -1.5, 0) }, // just below y=0, in footprint
    { name: 'interior', manifold: seedAt(0, HALF, 0) }, // cavity centre
  ]
}

type VoidAnalysis = {
  componentCount: number
  volumes: number[]
  /** Component indices whose intersection with the seed has positive volume. */
  seedHits: Record<string, number[]>
}

function analyze(label: string, voidSolid: Manifold, seeds: Seed[]): VoidAnalysis {
  const parts: Manifold[] = voidSolid.decompose()
  const volumes: number[] = []
  const seedHits: Record<string, number[]> = {}
  for (const { name } of seeds) seedHits[name] = []

  parts.forEach((part, index) => {
    volumes.push(part.volume())
    for (const { name, manifold } of seeds) {
      const hit = part.intersect(manifold)
      const volume = hit.volume()
      hit.delete()
      if (volume > HIT_EPSILON) seedHits[name].push(index)
    }
  })

  console.log(
    `[${label}] components=${parts.length} volumes=[${volumes
      .map((v) => v.toFixed(2))
      .join(', ')}] seeds=${JSON.stringify(seedHits)}`,
  )

  parts.forEach((part) => part.delete())
  return { componentCount: parts.length, volumes, seedHits }
}

type CaseResult = { exterior: VoidAnalysis; restricted: VoidAnalysis }

function runCase(model: Manifold, seeds: Seed[]): CaseResult {
  const exteriorSolid = bigSolid().subtract(model)
  const exterior = analyze('exterior', exteriorSolid, seeds)
  exteriorSolid.delete()

  const regionSolid = restrictedRegion().subtract(model)
  const restricted = analyze('restricted', regionSolid, seeds)
  regionSolid.delete()

  return { exterior, restricted }
}

/** A sealed cavity is a positive component holding the cavity seed that the
 *  exterior seed is not inside. */
function hasSealedCavity(analysis: VoidAnalysis): boolean {
  const exterior = new Set(analysis.seedHits.external)
  return analysis.seedHits.interior.some((index) => !exterior.has(index))
}

/** A cavity is bottom-reachable when one component holds both the just-below-
 *  bottom seed and the cavity seed. */
function bottomReachesInterior(analysis: VoidAnalysis): boolean {
  const interior = new Set(analysis.seedHits.interior)
  return analysis.seedHits.bottom.some((index) => interior.has(index))
}

type Scenario = {
  name: string
  build: () => Manifold
  expectSealedCavity: boolean
  expectBottomOpen: boolean
  expectExteriorCount: number
  expectRestrictedCount: number
}

const scenarios: Scenario[] = [
  {
    name: 'solid',
    build: solidBox,
    expectSealedCavity: false,
    expectBottomOpen: false,
    expectExteriorCount: 2, // BIG shell + model surface
    expectRestrictedCount: 2, // below-bottom slab + above-top slab
  },
  {
    name: 'open-tray',
    build: openTray,
    expectSealedCavity: false,
    expectBottomOpen: true, // the point of the whole exercise
    expectExteriorCount: 2,
    expectRestrictedCount: 2, // below-bottom slab MERGED with the cavity
  },
  {
    name: 'sealed',
    build: sealedHollow,
    expectSealedCavity: true,
    expectBottomOpen: false,
    expectExteriorCount: 3, // BIG shell + outer surface + cavity blob
    expectRestrictedCount: 3, // below slab + sealed cavity + top slab
  },
  {
    name: 'side-hole',
    build: sideHoleHollow,
    expectSealedCavity: false, // open to the outside through the side
    expectBottomOpen: false, // but not through the bottom
    expectExteriorCount: 2,
    expectRestrictedCount: 3, // same count as `sealed`, different meaning
  },
]

describe('void connectivity feasibility', () => {
  describe.each(scenarios)('$name', (scenario) => {
    it('measures decompose() components and seed containment', () => {
      const result = results[scenario.name]!
      const sealedCavity = hasSealedCavity(result.exterior)
      const bottomOpen = bottomReachesInterior(result.restricted)

      console.log(
        `[summary] ${scenario.name}: sealedCavity=${sealedCavity} bottomOpen=${bottomOpen}`,
      )

      // Raw measurements, pinned so a change in Manifold behaviour is visible.
      expect(result.exterior.componentCount).toBe(scenario.expectExteriorCount)
      expect(result.restricted.componentCount).toBe(scenario.expectRestrictedCount)

      // Semantic guarantees the two methods are supposed to provide.
      expect(sealedCavity).toBe(scenario.expectSealedCavity)
      expect(bottomOpen).toBe(scenario.expectBottomOpen)
    })
  })

  it('shows component count alone cannot tell bottom-open from closed', () => {
    const solid = results.solid!
    const openTray = results['open-tray']!

    // Both decompose into the same number of restricted components, so counting
    // is not enough - only the seed-containment test separates them.
    expect(solid.restricted.componentCount).toBe(openTray.restricted.componentCount)
    expect(bottomReachesInterior(openTray.restricted)).toBe(true)
    expect(bottomReachesInterior(solid.restricted)).toBe(false)
  })
})
