import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type {
  EngravingFaceDims,
  EngravingLine,
  EngravingOptions,
} from '../../../core/src/engraving/types.ts'
import { defaultEngravingOptions } from '../../../core/src/engraving/types.ts'
import type { EngravingLayout } from '../../../core/src/engraving/layout.ts'
import {
  addContentLine,
  anchorEngravingBlock,
  editorWarnings,
  engravingCornerPoint,
  engravingCornerScale,
  engravingHandleSizeMm,
  hitEngravingCorner,
  oppositeEngravingCorner,
  removeContentLine,
  scaleEngravingLines,
  updateLineSize,
  updateLineText,
} from './engravingEditor'
import { ENGRAVING_CONTENT_DEFS } from './engravingContent'

function faceDims(overrides: Partial<EngravingFaceDims> = {}): EngravingFaceDims {
  return {
    face: 'bottom',
    available: true,
    widthMm: 100,
    heightMm: 60,
    wallThicknessMm: 0,
    ...overrides,
  }
}

function layout(overrides: Partial<EngravingLayout> = {}): EngravingLayout {
  return {
    face: 'bottom',
    faceWidthMm: 100,
    faceHeightMm: 60,
    usable: { x: 2, y: 2, width: 96, height: 56 },
    block: { x: 20, y: 20, width: 60, height: 20 },
    lines: [],
    overflowX: false,
    overflowY: false,
    unsupportedChars: [],
    undersizedLineIndices: [],
    fits: true,
    ...overrides,
  }
}

function defOf(id: string) {
  const def = ENGRAVING_CONTENT_DEFS.find((candidate) => candidate.id === id)
  assert.ok(def)
  return def
}

function optionsWithLines(lines: EngravingLine[]): EngravingOptions {
  return { ...defaultEngravingOptions(), lines }
}

function assertClose(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}

describe('addContentLine', () => {
  it('地名は自動テキスト・既定サイズ・auto:true で追加する', () => {
    const options = addContentLine(defaultEngravingOptions(), defOf('place'), {
      place: '千代田区',
    })
    assert.equal(options.lines.length, 1)
    assert.deepEqual(options.lines[0], {
      id: 'place',
      text: '千代田区',
      sizeMm: 6,
      auto: true,
    })
  })

  it('自由入力は空テキスト・auto:false で追加する', () => {
    const options = addContentLine(defaultEngravingOptions(), defOf('custom'), {})
    assert.deepEqual(options.lines[0], { id: 'custom', text: '', sizeMm: 4, auto: false })
  })

  it('定義順に挿入する', () => {
    let options = addContentLine(defaultEngravingOptions(), defOf('scale'), {})
    options = addContentLine(options, defOf('place'), {})
    options = addContentLine(options, defOf('custom'), {})
    assert.deepEqual(
      options.lines.map((line) => line.id),
      ['place', 'scale', 'custom'],
    )
  })

  it('既にONの内容は何も変えない', () => {
    const options = addContentLine(defaultEngravingOptions(), defOf('place'), {})
    assert.equal(addContentLine(options, defOf('place'), {}), options)
  })
})

describe('removeContentLine', () => {
  it('該当行を削除する', () => {
    const options = optionsWithLines([
      { id: 'place', text: '千代田区', sizeMm: 6, auto: true },
      { id: 'coords', text: '35.65000N 139.75000E', sizeMm: 3.5, auto: true },
    ])
    const next = removeContentLine(options, 'place')
    assert.deepEqual(
      next.lines.map((line) => line.id),
      ['coords'],
    )
  })

  it('該当行が無ければ同一参照を返す', () => {
    const options = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])
    assert.equal(removeContentLine(options, 'mesh'), options)
  })
})

describe('updateLineText', () => {
  it('自動行を編集すると auto:false になる', () => {
    const options = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])
    const next = updateLineText(options, 'place', '千代田区（手書き）')
    assert.equal(next.lines[0].text, '千代田区（手書き）')
    assert.equal(next.lines[0].auto, false)
    assert.equal(next.lines[0].sizeMm, 6)
  })

  it('手入力行を同じテキストで更新しても同一参照', () => {
    const options = optionsWithLines([{ id: 'custom', text: '手入力', sizeMm: 4, auto: false }])
    assert.equal(updateLineText(options, 'custom', '手入力'), options)
  })

  it('該当行が無ければ同一参照を返す', () => {
    const options = defaultEngravingOptions()
    assert.equal(updateLineText(options, 'place', '千代田区'), options)
  })
})

describe('updateLineSize', () => {
  it('文字サイズを変更する', () => {
    const options = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])
    const next = updateLineSize(options, 'place', 4.5)
    assert.equal(next.lines[0].sizeMm, 4.5)
    assert.equal(next.lines[0].auto, true)
  })

  it('0.1〜100mm にクランプする', () => {
    const options = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])
    assert.equal(updateLineSize(options, 'place', -5).lines[0].sizeMm, 0.1)
    assert.equal(updateLineSize(options, 'place', 10_000).lines[0].sizeMm, 100)
  })

  it('同じサイズ・不正値・該当なしは同一参照を返す', () => {
    const options = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])
    assert.equal(updateLineSize(options, 'place', 6), options)
    assert.equal(updateLineSize(options, 'place', Number.NaN), options)
    assert.equal(updateLineSize(options, 'mesh', 5), options)
  })
})

describe('editorWarnings', () => {
  const textOptions = optionsWithLines([{ id: 'place', text: '千代田区', sizeMm: 6, auto: true }])

  it('問題が無ければ警告を出さない', () => {
    assert.deepEqual(editorWarnings(layout(), faceDims(), textOptions), [])
  })

  it('はみ出しは error', () => {
    const warnings = editorWarnings(layout({ overflowX: true }), faceDims(), textOptions)
    assert.deepEqual(warnings, [{ level: 'error', message: '文字が面からはみ出しています' }])
    assert.equal(
      editorWarnings(layout({ overflowY: true }), faceDims(), textOptions)[0].level,
      'error',
    )
  })

  it('未対応文字は error', () => {
    const warnings = editorWarnings(
      layout({ unsupportedChars: ['あ', 'い'] }),
      faceDims(),
      textOptions,
    )
    assert.deepEqual(warnings, [{ level: 'error', message: '未対応の文字: あ い' }])
  })

  it('最小サイズ未満は warning（印刷プロファイルから算出）', () => {
    const warnings = editorWarnings(layout({ undersizedLineIndices: [0] }), faceDims(), textOptions)
    assert.deepEqual(warnings, [
      {
        level: 'warning',
        message: '文字サイズが小さすぎます（最小: 欧文3.2mm / 日本語6mm）',
      },
    ])
  })

  it('刻印深さが面の上限を超えると warning', () => {
    const deepOptions = { ...textOptions, depthMm: 1.5 }
    const warnings = editorWarnings(layout(), faceDims({ wallThicknessMm: 2 }), deepOptions)
    assert.deepEqual(warnings, [{ level: 'warning', message: '刻印が深すぎます（最大1mm）' }])
    // 上限ちょうどは警告しない
    assert.deepEqual(
      editorWarnings(layout(), faceDims({ wallThicknessMm: 2 }), { ...textOptions, depthMm: 1 }),
      [],
    )
  })

  it('使用不可の面は error（理由付き）', () => {
    const warnings = editorWarnings(
      layout(),
      faceDims({ available: false, unavailableReason: '底面がフラットではありません' }),
      textOptions,
    )
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].level, 'error')
    assert.match(warnings[0].message, /底面がフラットではありません/)
  })

  it('内容が空なら warning', () => {
    const emptyOptions = optionsWithLines([{ id: 'place', text: '', sizeMm: 6, auto: true }])
    assert.deepEqual(editorWarnings(layout(), faceDims(), emptyOptions), [
      { level: 'warning', message: '刻印する内容がありません' },
    ])
  })
})

describe('engravingCornerPoint', () => {
  it('ブロックの4隅を面ローカルmmで返す', () => {
    const block = { x: 20, y: 20, width: 60, height: 20 }
    assert.deepEqual(engravingCornerPoint(block, 'bottom-left'), { uMm: 20, vMm: 20 })
    assert.deepEqual(engravingCornerPoint(block, 'bottom-right'), { uMm: 80, vMm: 20 })
    assert.deepEqual(engravingCornerPoint(block, 'top-left'), { uMm: 20, vMm: 40 })
    assert.deepEqual(engravingCornerPoint(block, 'top-right'), { uMm: 80, vMm: 40 })
  })

  it('対角の隅を返す', () => {
    assert.equal(oppositeEngravingCorner('bottom-left'), 'top-right')
    assert.equal(oppositeEngravingCorner('top-right'), 'bottom-left')
    assert.equal(oppositeEngravingCorner('bottom-right'), 'top-left')
    assert.equal(oppositeEngravingCorner('top-left'), 'bottom-right')
  })
})

describe('hitEngravingCorner', () => {
  const block = { x: 20, y: 20, width: 60, height: 20 }

  it('隅の近くならその隅、離れた位置では null', () => {
    assert.equal(hitEngravingCorner(block, 80.5, 40.5), 'top-right')
    assert.equal(hitEngravingCorner(block, 20, 20), 'bottom-left')
    assert.equal(hitEngravingCorner(block, 50, 30), null)
  })

  it('幅か高さが0なら掴めない', () => {
    assert.equal(hitEngravingCorner({ x: 0, y: 0, width: 0, height: 20 }, 0, 20), null)
  })
})

describe('engravingHandleSizeMm', () => {
  it('短辺に比例し、1.2〜2.6mm に収まる', () => {
    assert.equal(engravingHandleSizeMm({ x: 0, y: 0, width: 60, height: 20 }), 2.6)
    assert.equal(engravingHandleSizeMm({ x: 0, y: 0, width: 60, height: 3 }), 1.2)
  })
})

describe('engravingCornerScale', () => {
  const anchor = { uMm: 20, vMm: 20 }
  const corner = { uMm: 80, vMm: 40 }

  it('隅を2倍の距離へ動かすと2になる', () => {
    assertClose(engravingCornerScale(anchor, corner, { uMm: 140, vMm: 60 }), 2)
  })

  it('隅の上なら1、固定点なら0', () => {
    assertClose(engravingCornerScale(anchor, corner, corner), 1)
    assertClose(engravingCornerScale(anchor, corner, anchor), 0)
  })

  it('固定点と隅が同じなら1', () => {
    assert.equal(engravingCornerScale(anchor, anchor, { uMm: 50, vMm: 50 }), 1)
  })
})

describe('scaleEngravingLines', () => {
  const lines: EngravingLine[] = [
    { id: 'place', text: '千代田区', sizeMm: 6, auto: true },
    { id: 'coords', text: '35.65000N 139.75000E', sizeMm: 3.5, auto: true },
  ]

  it('全行を一様に拡大し、0.1mm単位に丸める', () => {
    const scaled = scaleEngravingLines(lines, 1.05)
    assert.deepEqual(
      scaled.map((line) => line.sizeMm),
      [6.3, 3.7],
    )
  })

  it('上限50mmを超えないよう拡大率を丸める', () => {
    const scaled = scaleEngravingLines(lines, 100)
    assert.equal(scaled[0].sizeMm, 50)
    assertClose(scaled[1].sizeMm, 29.2, 0.001)
  })

  it('下限0.5mmを下回らない', () => {
    const scaled = scaleEngravingLines(lines, 0.01)
    assert.equal(scaled[1].sizeMm, 0.5)
    assertClose(scaled[0].sizeMm, 0.9, 0.001)
  })

  it('倍率1や不正値では同一参照を返す', () => {
    assert.equal(scaleEngravingLines(lines, 1), lines)
    assert.equal(scaleEngravingLines(lines, 0), lines)
    assert.equal(scaleEngravingLines(lines, Number.NaN), lines)
  })
})

describe('anchorEngravingBlock', () => {
  const current = layout()
  const next = layout({ block: { x: 10, y: 15, width: 80, height: 30 } })
  const options = defaultEngravingOptions()

  function blockOf(anchored: EngravingOptions, nextLayout: EngravingLayout) {
    return {
      x:
        nextLayout.usable.x +
        anchored.centerX * nextLayout.usable.width -
        nextLayout.block.width / 2,
      y:
        nextLayout.usable.y +
        anchored.centerY * nextLayout.usable.height -
        nextLayout.block.height / 2,
    }
  }

  it('左下を固定すると、拡大後も左下が同じ位置に残る', () => {
    const anchored = anchorEngravingBlock(options, current, next, 'bottom-left')
    const block = blockOf(anchored, next)
    assertClose(block.x, current.block.x, 1e-9)
    assertClose(block.y, current.block.y, 1e-9)
  })

  it('右上を固定すると、拡大後も右上が同じ位置に残る', () => {
    const anchored = anchorEngravingBlock(options, current, next, 'top-right')
    const block = blockOf(anchored, next)
    assertClose(block.x + next.block.width, current.block.x + current.block.width, 1e-9)
    assertClose(block.y + next.block.height, current.block.y + current.block.height, 1e-9)
  })

  it('使用可能領域からはみ出す場合は中心を0..1にクランプする', () => {
    const far = layout({ block: { x: 92, y: 50, width: 10, height: 10 } })
    const anchored = anchorEngravingBlock(options, far, next, 'bottom-left')
    assert.equal(anchored.centerX, 1)
    assert.equal(anchored.centerY, 1)
  })
})
