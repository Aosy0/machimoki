import { describe, it, beforeAll } from 'vitest'
import assert from 'node:assert/strict'
import { createBoxBuilding, createTerrainSlab } from './fixtures.js'
import { configureNodeEngravingFont } from '../src/engraving/nodeFont.js'
import { getEngravingFont } from '../src/engraving/fontProvider.js'
import type { EngravingFont } from '../src/engraving/font.js'
import {
  DEFAULT_PRINT_PROFILE,
  defaultEngravingDepthMm,
  defaultEngravingOptions,
  engravingMaxDepthMm,
  engravingMinFontSizes,
  type EngravingFaceDims,
  type EngravingOptions,
} from '../src/engraving/types.js'
import { computeEngravingFaceDims } from '../src/engraving/faces.js'
import { autoFitEngraving, layoutEngraving } from '../src/engraving/layout.js'
import {
  formatAttribution,
  formatCenterCoordinate,
  formatDateLine,
  formatMeshCodeLine,
  formatScaleAndSize,
  jisMeshCode1km,
} from '../src/engraving/content.js'
import { buildPrintableModelFromMeshes, engravingMetadata } from '../src/pipelineUtils.js'
import { validateMesh } from '../src/validate.js'

const BOUNDS = { west: 139.69, south: 35.69, east: 139.692, north: 35.692 }
const SCALE = 0.00075
const TERRAIN_THICKNESS_MM = 10

function baseOptions(): EngravingOptions {
  return {
    ...defaultEngravingOptions(),
    enabled: true,
    face: 'bottom',
    lines: [
      { id: 'place', text: '東京都新宿区', sizeMm: 6, auto: true },
      { id: 'coords', text: '35.69000N 139.69100E', sizeMm: 3.5, auto: true },
      { id: 'scale', text: '1:1,333  W150 x D150 x T10 mm', sizeMm: 3.5, auto: true },
      { id: 'attribution', text: '© PLATEAU (MLIT)', sizeMm: 3, auto: true },
    ],
  }
}

function modelDims(overrides: Partial<Parameters<typeof computeEngravingFaceDims>[0]> = {}) {
  return {
    widthMm: 150,
    depthMm: 150,
    terrainThicknessMm: TERRAIN_THICKNESS_MM,
    shellThicknessMm: 1.6,
    hasTerrain: true,
    flatBottom: true,
    openBottom: false,
    splitAtGround: false,
    ...overrides,
  }
}

function faceOf(faces: EngravingFaceDims[], face: EngravingFaceDims['face']): EngravingFaceDims {
  const found = faces.find((item) => item.face === face)
  if (!found) throw new Error(`face not found: ${face}`)
  return found
}

function terrainAndBuildings(): {
  terrain: ReturnType<typeof createTerrainSlab>
  buildings: Awaited<ReturnType<typeof createBoxBuilding>>[]
} {
  const thicknessMeters = TERRAIN_THICKNESS_MM / (SCALE * 1000)
  return {
    terrain: createTerrainSlab(8, 200, 0, -thicknessMeters),
    buildings: [],
  }
}

describe('刻印フォント', () => {
  let font: EngravingFont
  beforeAll(async () => {
    configureNodeEngravingFont()
    font = await getEngravingFont()
  })

  it('日本語・英数字・記号のグリフを持つ', () => {
    for (const char of ['東', '京', '都', '新', '宿', 'あ', 'ア', 'A', '1', '©', '-']) {
      assert.equal(font.has(char), true, `${char} が未対応`)
    }
    assert.equal(font.has('😀'), false)
    assert.equal(font.unitsPerEm, 1000)
    assert.ok(font.advanceEm('新') > 0.5)
    assert.ok(font.outlineEm('新').length > 0)
    assert.ok(font.outlineEm('A').length > 0)
    const bbox = font.bboxEm('新')
    assert.ok(bbox !== null)
    assert.ok(bbox.y2 > bbox.y1)
  })

  it('未対応文字は空の輪郭とフォールバック幅を返す', () => {
    assert.equal(font.outlineEm('😀').length, 0)
    assert.equal(font.bboxEm('😀'), null)
    assert.ok(font.advanceEm('😀') > 0)
  })
})

describe('刻印内容の書式', () => {
  it('中心座標は小数5桁', () => {
    assert.equal(formatCenterCoordinate(BOUNDS), '35.69100N 139.69100E')
  })

  it('1kmメッシュコードはJIS X 0410（東京駅は 5339-46-11）', () => {
    assert.equal(jisMeshCode1km(35.6812, 139.7671), '5339-46-11')
    assert.equal(formatMeshCodeLine(BOUNDS), 'MESH 5339-45-25')
    // 日本国外は null
    assert.equal(jisMeshCode1km(51.5, -0.12), null)
    assert.equal(formatMeshCodeLine({ west: -1, south: 51, east: 0, north: 52 }), null)
  })

  it('縮尺・寸法・出典・年月の表記', () => {
    assert.equal(
      formatScaleAndSize(150 / (150 * 1000), 150, 100, 10),
      '1:1,000  W150 x D100 x T10 mm',
    )
    assert.equal(formatAttribution(), '© PLATEAU (MLIT)')
    assert.equal(formatDateLine(new Date(2026, 10, 10)), '2026.11')
  })
})

describe('刻印できる面', () => {
  it('通常（底面フラット・開口なし）は底面と側面すべて使える', () => {
    const faces = computeEngravingFaceDims(modelDims())
    assert.equal(faceOf(faces, 'bottom').available, true)
    assert.equal(faceOf(faces, 'bottom').widthMm, 150)
    assert.equal(faceOf(faces, 'bottom').heightMm, 150)
    assert.equal(faceOf(faces, 'bottom').wallThicknessMm, TERRAIN_THICKNESS_MM)
    assert.equal(faceOf(faces, 'south').available, true)
    assert.equal(faceOf(faces, 'south').heightMm, TERRAIN_THICKNESS_MM)
    assert.equal(faceOf(faces, 'east').widthMm, 150)
  })

  it('底面開口時は底面不可・側面は壁厚つき', () => {
    const faces = computeEngravingFaceDims(modelDims({ openBottom: true }))
    const bottom = faceOf(faces, 'bottom')
    assert.equal(bottom.available, false)
    assert.ok((bottom.unavailableReason ?? '').includes('底面'))
    const south = faceOf(faces, 'south')
    assert.equal(south.available, true)
    assert.equal(south.wallThicknessMm, 1.6)
    assert.ok(engravingMaxDepthMm(south) <= 0.6 + 1e-9)
  })

  it('分割時はマイター分だけ側面の帯が低くなる', () => {
    const faces = computeEngravingFaceDims(modelDims({ openBottom: true, splitAtGround: true }))
    assert.ok(Math.abs(faceOf(faces, 'south').heightMm - (TERRAIN_THICKNESS_MM - 0.9 * 1.6)) < 1e-9)
  })

  it('地形なし・底面非フラットは不可', () => {
    const noTerrain = computeEngravingFaceDims(modelDims({ hasTerrain: false }))
    assert.equal(faceOf(noTerrain, 'bottom').available, false)
    assert.equal(faceOf(noTerrain, 'south').available, false)
    const bumpy = computeEngravingFaceDims(modelDims({ flatBottom: false }))
    assert.equal(faceOf(bumpy, 'bottom').available, false)
  })
})

describe('刻印レイアウト', () => {
  let font: EngravingFont
  beforeAll(async () => {
    configureNodeEngravingFont()
    font = await getEngravingFont()
  })

  it('150mm角の底面に収まる', () => {
    const face = faceOf(computeEngravingFaceDims(modelDims()), 'bottom')
    const layout = layoutEngraving(face, baseOptions(), font)
    assert.equal(layout.fits, true)
    assert.equal(layout.overflowX, false)
    assert.equal(layout.overflowY, false)
    assert.equal(layout.unsupportedChars.length, 0)
    assert.ok(layout.block.width > 0 && layout.block.height > 0)
    assert.ok(layout.block.x >= layout.usable.x)
    assert.ok(layout.block.y >= layout.usable.y)
  })

  it('大きすぎる文字ははみ出しとして検出される', () => {
    const face = faceOf(computeEngravingFaceDims(modelDims()), 'bottom')
    const options = baseOptions()
    options.lines = [{ id: 'big', text: 'とても大きな文字', sizeMm: 60 }]
    const layout = layoutEngraving(face, options, font)
    assert.equal(layout.fits, false)
    assert.ok(layout.overflowX || layout.overflowY)
  })

  it('長い文字列は折り返して幅に収める', () => {
    const face = faceOf(computeEngravingFaceDims(modelDims({ widthMm: 60, depthMm: 60 })), 'bottom')
    const options = baseOptions()
    options.wrap = true
    options.lines = [{ id: 'long', text: '東京都新宿区西新宿二丁目', sizeMm: 5 }]
    const layout = layoutEngraving(face, options, font)
    assert.ok(layout.lines.length > 1)
    assert.equal(layout.overflowX, false)
  })

  it('未対応文字と小さすぎる文字を検出する', () => {
    const face = faceOf(computeEngravingFaceDims(modelDims()), 'bottom')
    const options = baseOptions()
    options.lines = [
      { id: 'emoji', text: 'abc😀', sizeMm: 3 },
      { id: 'tiny', text: '東京都', sizeMm: 2 },
    ]
    const layout = layoutEngraving(face, options, font)
    assert.equal(layout.fits, false)
    assert.deepEqual(layout.unsupportedChars, ['😀'])
    assert.ok(layout.undersizedLineIndices.length > 0)
  })

  it('自動調整で収まるサイズまで縮小される', () => {
    const face = faceOf(computeEngravingFaceDims(modelDims({ widthMm: 60, depthMm: 60 })), 'bottom')
    const options = baseOptions()
    options.lines = [
      { id: 'place', text: '東京都新宿区', sizeMm: 20 },
      { id: 'coords', text: '35.69000N 139.69100E', sizeMm: 12 },
      { id: 'attribution', text: '© PLATEAU (MLIT)', sizeMm: 10 },
    ]
    const fitted = autoFitEngraving(face, options, font)
    const layout = layoutEngraving(face, fitted, font)
    assert.equal(layout.fits, true)
    const min = engravingMinFontSizes(DEFAULT_PRINT_PROFILE)
    assert.ok(fitted.lines.every((line) => line.sizeMm >= min.latinMm - 1e-9))
  })

  it('印刷プロファイルから最小サイズと既定深さを求める', () => {
    const sizes = engravingMinFontSizes(DEFAULT_PRINT_PROFILE)
    assert.ok(sizes.latinMm >= 3)
    assert.ok(sizes.cjkMm >= 6)
    assert.equal(defaultEngravingDepthMm(DEFAULT_PRINT_PROFILE), 0.4)
  })
})

describe('刻印の適用（パイプライン）', () => {
  it('底面刻印: 水密・単一シェルを保ち体積が減る', { timeout: 120_000 }, async () => {
    configureNodeEngravingFont()
    const { terrain } = terrainAndBuildings()
    const buildings = [await createBoxBuilding(0, 0, 20, 20, -0.3, 30)]
    const base = {
      terrainThickness: TERRAIN_THICKNESS_MM,
      flattenBottom: true,
      format: '3mf' as const,
      scale: SCALE,
    }
    const plain = await buildPrintableModelFromMeshes(buildings, terrain, BOUNDS, { ...base })
    const plainValidation = await validateMesh(plain.buffer, 'model/3mf')
    assert.equal(plainValidation.status, 'pass')

    const engraved = await buildPrintableModelFromMeshes(buildings, terrain, BOUNDS, {
      ...base,
      engraving: baseOptions(),
    })
    const validation = await validateMesh(engraved.buffer, 'model/3mf')
    assert.equal(validation.status, 'pass')
    assert.equal(validation.numShells, 1)
    assert.ok(validation.numTri > plainValidation.numTri)
    assert.ok(validation.volume < plainValidation.volume)
    assert.deepEqual(engraved.warnings, [])
  })

  it('側面刻印（南面）も水密を保つ', { timeout: 120_000 }, async () => {
    configureNodeEngravingFont()
    const { terrain } = terrainAndBuildings()
    const buildings = [await createBoxBuilding(0, 0, 20, 20, -0.3, 30)]
    const result = await buildPrintableModelFromMeshes(buildings, terrain, BOUNDS, {
      terrainThickness: TERRAIN_THICKNESS_MM,
      flattenBottom: true,
      format: '3mf',
      scale: SCALE,
      engraving: {
        ...baseOptions(),
        face: 'south',
        lines: [{ id: 'place', text: 'Shinjuku-ku', sizeMm: 4, auto: true }],
      },
    })
    const validation = await validateMesh(result.buffer, 'model/3mf')
    assert.equal(validation.status, 'pass')
    assert.deepEqual(result.warnings, [])
  })

  it('底面開口時は底面刻印をスキップして警告を返す', { timeout: 120_000 }, async () => {
    configureNodeEngravingFont()
    const { terrain } = terrainAndBuildings()
    const buildings = [await createBoxBuilding(0, 0, 20, 20, -0.3, 30)]
    const result = await buildPrintableModelFromMeshes(buildings, terrain, BOUNDS, {
      terrainThickness: TERRAIN_THICKNESS_MM,
      flattenBottom: true,
      format: '3mf',
      scale: SCALE,
      openBottom: true,
      engraving: baseOptions(),
    })
    assert.ok(result.warnings.some((warning) => warning.includes('刻印')))
  })

  it('地形なしは刻印不可の警告を返す', { timeout: 60_000 }, async () => {
    configureNodeEngravingFont()
    const buildings = [await createBoxBuilding(0, 0, 20, 20, -0.3, 30)]
    const result = await buildPrintableModelFromMeshes(buildings, null, BOUNDS, {
      terrainThickness: TERRAIN_THICKNESS_MM,
      flattenBottom: true,
      format: '3mf',
      scale: SCALE,
      includeTerrain: false,
      engraving: baseOptions(),
    })
    assert.ok(result.warnings.some((warning) => warning.includes('刻印')))
  })

  it('3MFメタデータに刻印内容が入る', () => {
    const options = baseOptions()
    const metadata = engravingMetadata({ terrainThickness: 10, flattenBottom: true, format: '3mf', engraving: options })
    assert.ok(metadata)
    assert.equal(metadata.Title, '東京都新宿区')
    assert.ok(metadata.Description.includes('© PLATEAU (MLIT)'))
    assert.equal(
      engravingMetadata({ terrainThickness: 10, flattenBottom: true, format: '3mf' }),
      undefined,
    )
  })
})
