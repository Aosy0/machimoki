import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { EngravingFace } from '../../../core/src/engraving/types.ts'
import {
  engravingFaceVectors,
  faceViewDistance,
  faceViewOrthoDistance,
  faceViewOrthoWidth,
  modelVectorToEnu,
} from './engravingFaceView'

const FACES: EngravingFace[] = ['bottom', 'south', 'north', 'east', 'west']

/** 浮動小数の比較（絶対誤差）。 */
function assertClose(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${expected} but got ${actual}`)
}

describe('engravingFaceVectors', () => {
  it('面ごとにモデル空間の外向き法線と文字上方向を返す', () => {
    const expected: Record<EngravingFace, { normal: number[]; up: number[] }> = {
      bottom: { normal: [0, -1, 0], up: [0, 0, 1] },
      south: { normal: [0, 0, 1], up: [0, 1, 0] },
      north: { normal: [0, 0, -1], up: [0, 1, 0] },
      east: { normal: [1, 0, 0], up: [0, 1, 0] },
      west: { normal: [-1, 0, 0], up: [0, 1, 0] },
    }
    for (const face of FACES) {
      const vectors = engravingFaceVectors(face)
      assert.deepEqual(
        [vectors.normal.x, vectors.normal.y, vectors.normal.z],
        expected[face].normal,
      )
      assert.deepEqual([vectors.up.x, vectors.up.y, vectors.up.z], expected[face].up)
    }
  })

  it('法線と上方向は単位ベクトルで直交する', () => {
    for (const face of FACES) {
      const { normal, up } = engravingFaceVectors(face)
      const normalLength = Math.hypot(normal.x, normal.y, normal.z)
      const upLength = Math.hypot(up.x, up.y, up.z)
      const dot = normal.x * up.x + normal.y * up.y + normal.z * up.z
      assertClose(normalLength, 1)
      assertClose(upLength, 1)
      assertClose(dot, 0)
    }
  })

  it('返す配列は共有されない（呼び出し側で書き換えても次回に影響しない）', () => {
    const first = engravingFaceVectors('bottom')
    first.normal.y = 123
    first.up.z = 456
    assert.deepEqual(engravingFaceVectors('bottom'), {
      normal: { x: 0, y: -1, z: 0 },
      up: { x: 0, y: 0, z: 1 },
    })
  })
})

describe('modelVectorToEnu', () => {
  it('モデル空間の軸を ENU（東・北・上）へ変換する', () => {
    // モデル +X（東）はそのまま東。
    assert.deepEqual(modelVectorToEnu({ x: 1, y: 0, z: 0 }), { x: 1, y: 0, z: 0 })
    // モデル +Z（南）は ENU の北成分が -1。
    assert.deepEqual(modelVectorToEnu({ x: 0, y: 0, z: 1 }), { x: 0, y: -1, z: 0 })
    // モデル +Y（上）は ENU の上。
    assert.deepEqual(modelVectorToEnu({ x: 0, y: 1, z: 0 }), { x: 0, y: 0, z: 1 })
    // 底面の外向き法線（下）は ENU でも下。
    assert.deepEqual(modelVectorToEnu({ x: 0, y: -1, z: 0 }), { x: 0, y: 0, z: -1 })
  })

  it('面ごとの法線・上方向が ENU の期待値になる', () => {
    const expected: Record<EngravingFace, { normal: number[]; up: number[] }> = {
      bottom: { normal: [0, 0, -1], up: [0, -1, 0] },
      south: { normal: [0, -1, 0], up: [0, 0, 1] },
      north: { normal: [0, 1, 0], up: [0, 0, 1] },
      east: { normal: [1, 0, 0], up: [0, 0, 1] },
      west: { normal: [-1, 0, 0], up: [0, 0, 1] },
    }
    for (const face of FACES) {
      const { normal, up } = engravingFaceVectors(face)
      const normalEnu = modelVectorToEnu(normal)
      const upEnu = modelVectorToEnu(up)
      assert.deepEqual([normalEnu.x, normalEnu.y, normalEnu.z], expected[face].normal)
      assert.deepEqual([upEnu.x, upEnu.y, upEnu.z], expected[face].up)
    }
  })
})

describe('faceViewDistance', () => {
  const fovy = Math.PI / 3 // Cesium PerspectiveFrustum の既定値

  it('垂直画角と半径から球が収まる距離を返す', () => {
    // 100 / tan(30°) * 1.15
    assertClose(faceViewDistance(100, fovy), (100 / Math.tan(fovy / 2)) * 1.15)
  })

  it('縦長画面（aspect<1）では水平画角が制限になるため距離を伸ばす', () => {
    const square = faceViewDistance(100, fovy, 1)
    const portrait = faceViewDistance(100, fovy, 0.5)
    assertClose(portrait, square * 2)
  })

  it('横長画面（aspect>1）では垂直画角が制限なので距離は変わらない', () => {
    assertClose(faceViewDistance(100, fovy, 2), faceViewDistance(100, fovy, 1))
  })

  it('半径が大きいほど距離も比例して大きくなる', () => {
    assertClose(faceViewDistance(200, fovy), faceViewDistance(100, fovy) * 2)
  })

  it('半径0は距離0、不正な画角では半径×2へフォールバックする', () => {
    assert.equal(faceViewDistance(0, fovy), 0)
    assertClose(faceViewDistance(100, 0), 200)
  })
})

describe('faceViewOrthoWidth / faceViewOrthoDistance', () => {
  it('正方形画面では半径の2.4倍の幅、2倍の距離になる', () => {
    assertClose(faceViewOrthoWidth(100), 240)
    assertClose(faceViewOrthoDistance(100), 200)
  })

  it('横長画面では高さが足りるよう幅をアスペクト比倍する', () => {
    assertClose(faceViewOrthoWidth(100, 2), 480)
    assertClose(faceViewOrthoWidth(100, 0.5), 240)
  })

  it('不正な半径・アスペクト比でも安全な値を返す', () => {
    assert.equal(faceViewOrthoWidth(Number.NaN), 0)
    assert.equal(faceViewOrthoDistance(Number.NaN), 0)
    assertClose(faceViewOrthoWidth(100, Number.NaN), 240)
  })
})
