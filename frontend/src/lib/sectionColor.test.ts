/**
 * sectionColor（断面色のトーンシフト）のテスト。
 *
 * 実行方法:
 *   npx vitest run frontend/src/lib/sectionColor.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { pickSectionColor, toOklab } from './sectionColor'

/** Oklabの色相角（度）。 */
function hueDeg(c: { a: number; b: number }): number {
  return (Math.atan2(c.b, c.a) * 180) / Math.PI
}

/** 角度差を[-180, 180]に正規化する。 */
function hueDiffDeg(a: number, b: number): number {
  return ((((a - b + 540) % 360) + 360) % 360) - 180
}

describe('pickSectionColor', () => {
  it('白は暗くなる（ΔL≧0.28、かつ入力と異なる）', () => {
    const out = pickSectionColor('#ffffff')
    assert.notEqual(out, '#ffffff')
    const dL = toOklab('#ffffff').L - toOklab(out).L
    assert.ok(dL >= 0.28, `ΔL=${dL}`)
  })

  it('暗色は明るくなる', () => {
    const before = toOklab('#303030').L
    const after = toOklab(pickSectionColor('#303030')).L
    assert.ok(after - before >= 0.28, `ΔL=${after - before}`)
  })

  it('有彩色は色相を保ったまま明度が変わる', () => {
    const input = '#e0703a'
    const out = pickSectionColor(input)
    const inLab = toOklab(input)
    const outLab = toOklab(out)
    assert.ok(Math.abs(hueDiffDeg(hueDeg(outLab), hueDeg(inLab))) <= 5, `hue drift`)
    assert.ok(Math.abs(outLab.L - inLab.L) >= 0.28, `ΔL=${Math.abs(outLab.L - inLab.L)}`)
  })

  it('同じ入力で同じ出力（決定性）', () => {
    assert.equal(pickSectionColor('#e0703a'), pickSectionColor('#e0703a'))
    assert.equal(pickSectionColor('#ffffff'), pickSectionColor('#ffffff'))
  })

  it('不正入力は白とみなした結果になる', () => {
    assert.equal(pickSectionColor('not-a-color'), pickSectionColor('#ffffff'))
    assert.equal(pickSectionColor(''), pickSectionColor('#ffffff'))
  })
})
