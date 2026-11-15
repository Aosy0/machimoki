import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { EngravingFaceDims } from '../../../core/src/engraving/types.ts'
import {
  buildOverlayFaceFrame,
  computeHomography,
  faceLocalToCenter,
  faceLocalToModel,
  homographyToMatrix3d,
  modelToEnu,
  pointInFace,
  worldLengthToMm,
  type MeshBounds,
  type ScreenPoint,
} from './engraving3dOverlay'
import { buildGlyphPathMap, glyphPathData } from './engravingSvg'
import type { EngravingFont } from '../../../core/src/engraving/font.ts'
import { layoutEngraving } from '../../../core/src/engraving/layout.ts'
import { defaultEngravingOptions } from '../../../core/src/engraving/types.ts'

const BOUNDS: MeshBounds = {
  minX: -0.05,
  maxX: 0.05,
  minY: 0,
  maxY: 0.1,
  minZ: -0.075,
  maxZ: 0.075,
}

function assertVec(actual: readonly number[], expected: readonly number[], tolerance = 1e-9): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < actual.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance,
      `component ${i}: ${actual[i]} != ${expected[i]}`,
    )
  }
}

describe('buildOverlayFaceFrame', () => {
  it('底面は minY・u=+X・v=+Z（裏返して読む向き）', () => {
    const frame = buildOverlayFaceFrame('bottom', BOUNDS, 100, 150)
    assert.ok(frame)
    assertVec(frame.center, [0, 0, 0])
    assertVec(frame.u, [1, 0, 0])
    assertVec(frame.v, [0, 0, 1])
    assertVec(frame.normal, [0, -1, 0])
    assert.equal(frame.widthMm, 100)
    assert.equal(frame.heightMm, 150)
  })

  it('側面は下から高さの半分を中心にし、外向き法線を持つ', () => {
    const south = buildOverlayFaceFrame('south', BOUNDS, 100, 10)
    assert.ok(south)
    assertVec(south.center, [0, 0.005, 0.075])
    assertVec(south.u, [1, 0, 0])
    assertVec(south.v, [0, 1, 0])
    assertVec(south.normal, [0, 0, 1])

    const north = buildOverlayFaceFrame('north', BOUNDS, 100, 10)
    assert.ok(north)
    assertVec(north.u, [-1, 0, 0])
    assertVec(north.normal, [0, 0, -1])

    const east = buildOverlayFaceFrame('east', BOUNDS, 150, 10)
    assert.ok(east)
    assertVec(east.center, [0.05, 0.005, 0])
    assertVec(east.u, [0, 0, -1])
    assertVec(east.normal, [1, 0, 0])

    const west = buildOverlayFaceFrame('west', BOUNDS, 150, 10)
    assert.ok(west)
    assertVec(west.center, [-0.05, 0.005, 0])
    assertVec(west.u, [0, 0, 1])
    assertVec(west.normal, [-1, 0, 0])
  })

  it('寸法が不正なら null', () => {
    assert.equal(buildOverlayFaceFrame('bottom', BOUNDS, 0, 100), null)
    assert.equal(buildOverlayFaceFrame('bottom', BOUNDS, 100, -1), null)
  })
})

describe('faceLocalToModel', () => {
  it('左下(0,0)・右上(W,H)が面の角になる', () => {
    const frame = buildOverlayFaceFrame('bottom', BOUNDS, 100, 150)
    assert.ok(frame)
    assertVec(faceLocalToModel(frame, 0, 0), [-0.05, 0, -0.075])
    assertVec(faceLocalToModel(frame, 100, 150), [0.05, 0, 0.075])
    assertVec(faceLocalToModel(frame, 50, 75), [0, 0, 0])
  })

  it('側面（南）の面ローカルは上方向=+Y', () => {
    const frame = buildOverlayFaceFrame('south', BOUNDS, 100, 10)
    assert.ok(frame)
    assertVec(faceLocalToModel(frame, 50, 0), [0, 0, 0.075])
    assertVec(faceLocalToModel(frame, 50, 10), [0, 0.01, 0.075])
  })
})

describe('modelToEnu', () => {
  it('engine(x=東, y=上, z=南) → ENU(x=東, y=北, z=上)', () => {
    assertVec(modelToEnu([1, 2, 3], 2), [2, -6, 4])
  })

  it('分割表示のオフセットを加味する', () => {
    assertVec(modelToEnu([1, 2, 3], 2, 0.5, 1), [3, -6, 6])
  })
})

describe('pointInFace', () => {
  it('面の範囲内だけ true', () => {
    assert.equal(pointInFace(0, 0, 100, 50), true)
    assert.equal(pointInFace(100, 50, 100, 50), true)
    assert.equal(pointInFace(50, 25, 100, 50), true)
    assert.equal(pointInFace(-1, 25, 100, 50), false)
    assert.equal(pointInFace(50, 51, 100, 50), false)
  })
})

describe('worldLengthToMm', () => {
  it('ワールド長を印刷mmへ戻す（positionScale = 1/scale）', () => {
    // scale=0.001（positionScale=1000）のとき、ワールド297m = 印刷297mm。
    assert.ok(Math.abs(worldLengthToMm(297, 1000) - 297) < 1e-9)
    assert.equal(worldLengthToMm(1, 0), 0)
  })
})

describe('faceLocalToCenter', () => {
  const face: EngravingFaceDims = {
    face: 'bottom',
    available: true,
    widthMm: 100,
    heightMm: 50,
    wallThicknessMm: 10,
  }
  const options = {
    ...defaultEngravingOptions(),
    lines: [{ id: 'place', text: '新宿区', sizeMm: 6 }],
  }
  const font: EngravingFont = {
    unitsPerEm: 1000,
    ascenderEm: 0.8,
    descenderEm: -0.2,
    has: () => true,
    advanceEm: () => 1,
    bboxEm: () => ({ x1: 0, y1: 0, x2: 1, y2: 0.8 }),
    outlineEm: () => [],
  }
  const layout = layoutEngraving(face, options, font)

  it('使用可能領域の中心で 0.5/0.5 になる', () => {
    const center = faceLocalToCenter(
      layout,
      layout.usable.x + layout.usable.width / 2,
      layout.usable.y + layout.usable.height / 2,
    )
    assert.ok(Math.abs(center.centerX - 0.5) < 1e-9)
    assert.ok(Math.abs(center.centerY - 0.5) < 1e-9)
  })

  it('使用可能領域の外は 0..1 にクランプされる', () => {
    assert.deepEqual(faceLocalToCenter(layout, -100, -100), { centerX: 0, centerY: 0 })
    assert.deepEqual(faceLocalToCenter(layout, 1000, 1000), { centerX: 1, centerY: 1 })
  })
})

describe('computeHomography', () => {
  const unit: ScreenPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]

  function project(homography: readonly number[], point: ScreenPoint): ScreenPoint {
    const [h11, h12, h13, h21, h22, h23, h31, h32] = homography
    const w = h31 * point.x + h32 * point.y + 1
    return {
      x: (h11 * point.x + h12 * point.y + h13) / w,
      y: (h21 * point.x + h22 * point.y + h23) / w,
    }
  }

  it('恒等変換', () => {
    const homography = computeHomography(unit, unit)
    assert.ok(homography)
    assertVec(homography, [1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('平行移動＋拡大', () => {
    const destination = unit.map((point) => ({ x: point.x * 2 + 10, y: point.y * 3 + 20 }))
    const homography = computeHomography(unit, destination)
    assert.ok(homography)
    const projected = project(homography, { x: 0.25, y: 0.5 })
    assert.ok(Math.abs(projected.x - 10.5) < 1e-9)
    assert.ok(Math.abs(projected.y - 21.5) < 1e-9)
  })

  it('射影変換（台形）を4点で再現する', () => {
    const destination = [
      { x: 10, y: 10 },
      { x: 110, y: 15 },
      { x: 100, y: 90 },
      { x: 20, y: 85 },
    ]
    const homography = computeHomography(unit, destination)
    assert.ok(homography)
    for (let i = 0; i < 4; i++) {
      const projected = project(homography, unit[i])
      assert.ok(Math.abs(projected.x - destination[i].x) < 1e-6)
      assert.ok(Math.abs(projected.y - destination[i].y) < 1e-6)
    }
  })

  it('退化した対応点は null', () => {
    const degenerate = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]
    assert.equal(computeHomography(unit, degenerate), null)
  })

  it('matrix3d 文字列に変換できる', () => {
    const homography = computeHomography(unit, unit)
    assert.ok(homography)
    const value = homographyToMatrix3d(homography)
    assert.match(value, /^matrix3d\(/)
    assert.equal(value.split(',').length, 16)
  })
})

describe('engravingSvg', () => {
  it('輪郭を M/L/Z の path データにする', () => {
    const font: EngravingFont = {
      unitsPerEm: 1000,
      ascenderEm: 0.8,
      descenderEm: -0.2,
      has: () => true,
      advanceEm: () => 1,
      bboxEm: () => null,
      outlineEm: () => [
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    }
    assert.equal(glyphPathData(font, 'A'), 'M0.0000 0.0000L1.0000 0.0000L1.0000 1.0000Z')
  })

  it('レイアウト内の文字ごとに path を作る', () => {
    const font: EngravingFont = {
      unitsPerEm: 1000,
      ascenderEm: 0.8,
      descenderEm: -0.2,
      has: () => true,
      advanceEm: () => 1,
      bboxEm: () => ({ x1: 0, y1: 0, x2: 1, y2: 0.8 }),
      outlineEm: () => [
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 0.8 },
        ],
      ],
    }
    const face: EngravingFaceDims = {
      face: 'bottom',
      available: true,
      widthMm: 100,
      heightMm: 50,
      wallThicknessMm: 10,
    }
    const layout = layoutEngraving(
      face,
      { ...defaultEngravingOptions(), lines: [{ id: 'x', text: 'AB', sizeMm: 6 }] },
      font,
    )
    const map = buildGlyphPathMap(font, layout)
    assert.equal(map.size, 2)
    assert.ok(map.get('A')?.startsWith('M'))
    assert.ok(map.get('B')?.startsWith('M'))
  })
})
