import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { Bounds } from '../../../core/src/types.ts'
import { formatCenterCoordinate, formatMeshCodeLine } from '../../../core/src/engraving/content.ts'
import {
  ENGRAVING_CONTENT_DEFS,
  buildAutoTexts,
  defaultEngravingLines,
  mergeAutoLines,
} from './engravingContent'
import type { EngravingLine } from '../../../core/src/engraving/types.ts'

const TOKYO_BOUNDS: Bounds = { west: 139.7, south: 35.6, east: 139.8, north: 35.7 }
const WORLD_BOUNDS: Bounds = { west: 0, south: 0, east: 1, north: 1 }

function autoTextsForPlace(placeName: string | null): Record<string, string> {
  return buildAutoTexts(TOKYO_BOUNDS, 1 / 1000, 150, 100, 10, placeName)
}

describe('ENGRAVING_CONTENT_DEFS', () => {
  it('内容のID・ラベル・既定サイズが定義どおり', () => {
    const defs = ENGRAVING_CONTENT_DEFS.map((def) => [def.id, def.label, def.defaultSizeMm])
    assert.deepEqual(defs, [
      ['place', '地名', 6],
      ['coords', '中心座標', 3.5],
      ['mesh', 'メッシュコード', 3.5],
      ['scale', '縮尺・寸法', 3.5],
      ['attribution', '出典', 3.5],
      ['date', '作成年', 3.5],
      ['custom', '自由入力', 4],
    ])
    assert.equal(ENGRAVING_CONTENT_DEFS.find((def) => def.id === 'custom')?.multiline, true)
  })
})

describe('buildAutoTexts', () => {
  it('全項目の自動テキストを組み立てる', () => {
    const autoTexts = autoTextsForPlace('千代田区')
    assert.equal(autoTexts.place, '千代田区')
    assert.equal(autoTexts.coords, formatCenterCoordinate(TOKYO_BOUNDS))
    assert.equal(autoTexts.coords, '35.65000N 139.75000E')
    assert.equal(autoTexts.mesh, formatMeshCodeLine(TOKYO_BOUNDS))
    assert.equal(autoTexts.mesh, 'MESH 5339-36-80')
    assert.equal(autoTexts.scale, '1:1,000  W150 x D100 x T10 mm')
    assert.equal(autoTexts.attribution, '© PLATEAU (MLIT)')
    assert.match(autoTexts.date, /^\d{4}\.\d{2}$/)
  })

  it('地名が未取得なら place は空文字', () => {
    assert.equal(autoTextsForPlace(null).place, '')
  })

  it('日本国外ではメッシュコードを空文字にする', () => {
    const autoTexts = buildAutoTexts(WORLD_BOUNDS, 0.001, 150, 100, 10, null)
    assert.equal(autoTexts.mesh, '')
  })
})

describe('defaultEngravingLines', () => {
  it('空でない自動項目を既定サイズ・auto:true で並べる', () => {
    const lines = defaultEngravingLines(autoTextsForPlace('千代田区'))
    assert.deepEqual(
      lines.map((line) => line.id),
      ['place', 'coords', 'mesh', 'scale', 'attribution', 'date'],
    )
    assert.deepEqual(
      lines.map((line) => line.auto),
      [true, true, true, true, true, true],
    )
    assert.equal(lines[0].sizeMm, 6)
    assert.equal(lines[1].sizeMm, 3.5)
    assert.equal(lines[4].sizeMm, 3.5)
    assert.equal(lines[0].text, '千代田区')
  })

  it('空テキストの行と自由入力は含めない', () => {
    const lines = defaultEngravingLines(buildAutoTexts(WORLD_BOUNDS, 0.001, 150, 100, 10, null))
    assert.deepEqual(
      lines.map((line) => line.id),
      ['coords', 'scale', 'attribution', 'date'],
    )
  })
})

describe('mergeAutoLines', () => {
  const baseLines: EngravingLine[] = [
    { id: 'place', text: '千代田区', sizeMm: 6, auto: true },
    { id: 'coords', text: '35.65000N 139.75000E', sizeMm: 3.5, auto: true },
    { id: 'custom', text: '手入力', sizeMm: 4, auto: false },
  ]

  it('変化が無ければ同一参照を返す（無限ループ防止）', () => {
    const merged = mergeAutoLines(baseLines, {
      place: '千代田区',
      coords: '35.65000N 139.75000E',
    })
    assert.equal(merged, baseLines)
  })

  it('auto:true の行だけテキストを差し替える', () => {
    const merged = mergeAutoLines(baseLines, {
      place: '新宿区',
      coords: '35.65000N 139.75000E',
    })
    assert.notEqual(merged, baseLines)
    assert.deepEqual(
      merged.map((line) => line.text),
      ['新宿区', '35.65000N 139.75000E', '手入力'],
    )
    assert.equal(merged[0].sizeMm, 6)
    assert.equal(merged[2], baseLines[2])
  })

  it('手入力した行（auto:false）は差し替えない', () => {
    const edited: EngravingLine[] = [{ id: 'place', text: '手書き', sizeMm: 6, auto: false }]
    const merged = mergeAutoLines(edited, { place: '千代田区' })
    assert.equal(merged, edited)
    assert.equal(merged[0].text, '手書き')
  })

  it('対応する自動値が無い行はそのまま残す', () => {
    const merged = mergeAutoLines(baseLines, { coords: '0.00000N 0.00000E' })
    assert.equal(merged[0], baseLines[0])
    assert.equal(merged[1].text, '0.00000N 0.00000E')
  })
})
