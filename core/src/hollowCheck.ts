/**
 * Hollow-model quality checks.
 *
 * Detects sealed cavities (voids that connect to nothing outside the model)
 * using the method verified in tests/voidConnectivity.test.ts:
 *
 *   BIG   = model bounding box expanded by a margin on every side
 *   void  = BIG - model, split with decompose()
 *   A component is "external-connected" when it intersects any of the eight
 *   corner seed cubes. The remaining components with a positive volume above
 *   the tolerance are sealed cavities.
 *
 * decompose() splits boundary topology rather than space, so a component's
 * volume sign matters: an enclosed void appears as a positive component while
 * the model's own surface appears with reversed (negative) volume.
 */

import { getManifoldModule } from 'manifold-3d/lib/wasm.js'
import type { Manifold } from 'manifold-3d'

export interface SealedCavityReport {
  /** 密閉空洞（どこにも開通していない空洞）の個数 */
  count: number
  /** 密閉空洞の体積合計（入力と同じ空間の単位^3） */
  volume: number
}

/** A seed cube counts as inside a part when at least this fraction of its volume intersects it. */
const SEED_HIT_RATIO = 0.5

/**
 * モデル内部の密閉空洞を検出する。
 *
 * 方式（テストで成立確認済み）:
 * - BIG = モデルのバウンディングボックスを全方向にマージン（対角長の10%、下限1e-3）
 *   だけ広げた箱
 * - void = BIG - model を decompose()
 * - 外部シード（BIG の8隅付近の小立方体、一辺 = BIG対角長の2%）を含む成分 =
 *   外部と連結（判定はシード体積に対する相対閾値でスケール不変にする）
 * - 外部シードを含まず、正の体積を持つ成分（体積 > スケール相対の許容誤差）を
 *   密閉空洞とみなす
 *
 * @param model 検査対象。呼び出し側が所有し、本関数は delete しない。
 */
export async function detectSealedCavities(model: Manifold): Promise<SealedCavityReport> {
  const { Manifold: ManifoldCtor } = await getManifoldModule()

  const bounds = model.boundingBox()
  const size: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ]
  const center: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const diagonal = Math.hypot(size[0], size[1], size[2])
  const margin = Math.max(diagonal * 0.1, 1e-3)

  const bigSize: [number, number, number] = [
    size[0] + 2 * margin,
    size[1] + 2 * margin,
    size[2] + 2 * margin,
  ]
  const big = ManifoldCtor.cube(bigSize, true).translate(center)

  // One seed cube near each BIG corner, safely inside the margin band so it is
  // always in the outer void.
  const seedSize = diagonal * 0.02
  const seeds: Manifold[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        seeds.push(
          ManifoldCtor.cube([seedSize, seedSize, seedSize], true).translate([
            center[0] + sx * (bigSize[0] / 2 - seedSize),
            center[1] + sy * (bigSize[1] / 2 - seedSize),
            center[2] + sz * (bigSize[2] / 2 - seedSize),
          ]),
        )
      }
    }
  }

  const created: Manifold[] = [big, ...seeds]
  try {
    const voidSolid = big.subtract(model)
    created.push(voidSolid)

    const parts: Manifold[] = voidSolid.decompose()
    created.push(...parts)

    // Ignore components at numerical-noise scale. すべてスケール相対にして、
    // 小さなモデル（例: 縮尺適用後の mm モデル）でも誤判定しないようにする。
    const seedVolume = seedSize ** 3
    const volumeTolerance = Math.max(
      1e-12,
      model.tolerance() ** 3 * 100,
      bigSize[0] * bigSize[1] * bigSize[2] * 1e-9,
    )

    let count = 0
    let volume = 0
    for (const part of parts) {
      const partVolume = part.volume()
      if (!(partVolume > volumeTolerance)) continue

      let externalConnected = false
      for (const seed of seeds) {
        const hit = part.intersect(seed)
        const hitVolume = hit.volume()
        hit.delete()
        if (hitVolume > seedVolume * SEED_HIT_RATIO) {
          externalConnected = true
          break
        }
      }

      if (!externalConnected) {
        count++
        volume += partVolume
      }
    }

    return { count, volume }
  } finally {
    for (const manifold of created) manifold.delete()
  }
}
