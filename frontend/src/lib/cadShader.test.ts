import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import {
  CAD_FRAGMENT_SHADER,
  CAD_TERRAIN_FRAGMENT_SHADER,
  FACET_LIGHT_BASE,
  FACET_LIGHT_GAIN,
  FLAT_FACET_LIGHT_FACTOR,
} from './cadShader'

const near = (actual: number, expected: number) => Math.abs(actual - expected) < 1e-6

describe('地形の明るさ', () => {
  // 建物用の式は dot >= 0.41 で1に飽和し、起伏のある地形がほぼ全面純白に飛んだ。
  it('太陽高度45°の平坦面が飽和せず、日陰面は明確に暗い', () => {
    // light = sin(45°) が平坦面、light = 0 が太陽の真裏を向いた面。
    const flat = FACET_LIGHT_BASE + FACET_LIGHT_GAIN * Math.SQRT1_2
    assert.ok(near(flat, FLAT_FACET_LIGHT_FACTOR), '平坦面の明るさの定義がずれている')
    assert.ok(flat < 0.9, `平坦面が明るすぎる: ${flat}`)
    assert.ok(flat - FACET_LIGHT_BASE > 0.25, `平坦面と日陰面の差が小さい: ${flat}`)
  })

  it('真上を向いた面は純白を超えない', () => {
    assert.ok(FACET_LIGHT_BASE + FACET_LIGHT_GAIN <= 1 + 1e-9)
  })

  // 頂点法線は面内で補間されるので、そのまま使うと稜線が消えてぼやける。
  // 微分法線（三角形ごとに一定）でポリゴンの向きを残す。
  it('三角形ごとの法線と拡散光で明るさを決める', () => {
    for (const shader of [CAD_TERRAIN_FRAGMENT_SHADER, CAD_FRAGMENT_SHADER]) {
      assert.match(shader, /in vec3 v_positionEC;/)
      assert.match(shader, /cadFacetLightFactor\(v_positionEC\)/)
      assert.match(shader, /cross\(dFdx\(positionEC\), dFdy\(positionEC\)\)/)
    }
  })

  // 建物用の式は日照面が飽和するので、完成形状（印刷プレビュー）では使わない。
  it('完成形状は飽和する建物用の式を使わない', () => {
    assert.doesNotMatch(CAD_FRAGMENT_SHADER, /cadLightFactor\(/)
  })
})
