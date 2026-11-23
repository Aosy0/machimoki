/**
 * 刻印レイアウト（面ローカル座標・印刷mm）。
 *
 * 面ローカルの原点は面の左下、xは面の右方向（u）、yは面の上方向（v）。
 * レイアウト結果はUIのプレビューと幾何生成の両方で使う。
 */

import type { EngravingFont } from './font.js'
import type { EngravingFace, EngravingFaceDims, EngravingOptions } from './types.js'
import { FACE_MARGIN_MM, engravingMinFontSizes, isCjkText } from './types.js'

/** 1グリフの配置（行内の左端xは面ローカルmm）。 */
export interface EngravingGlyphPlacement {
  char: string
  /** 行内の左端からの距離（mm） */
  x: number
}

export interface EngravingLayoutLine {
  /** 元の EngravingLine.id（UIの強調表示用） */
  sourceId: string
  text: string
  sizeMm: number
  /** 面ローカルmm（行の左端） */
  x: number
  /** 面ローカルmm（ベースライン） */
  baselineY: number
  /** 前進幅（mm） */
  widthMm: number
  glyphs: EngravingGlyphPlacement[]
  /** ベースラインからインク上端まで（mm、通常正） */
  inkTopMm: number
  /** ベースラインからインク下端まで（mm、通常負） */
  inkBottomMm: number
}

export interface EngravingLayout {
  face: EngravingFace
  faceWidthMm: number
  faceHeightMm: number
  usable: { x: number; y: number; width: number; height: number }
  block: { x: number; y: number; width: number; height: number }
  lines: EngravingLayoutLine[]
  overflowX: boolean
  overflowY: boolean
  unsupportedChars: string[]
  /** 最小サイズ未満の行（lines の index） */
  undersizedLineIndices: number[]
  fits: boolean
}

interface VisualLine {
  sourceId: string
  text: string
  sizeMm: number
}

const EPSILON = 1e-6
/** 未対応文字の表示用ダミー高さ（em）。 */
const UNSUPPORTED_INK_TOP_EM = 0.7

function measureWidth(text: string, sizeMm: number, font: EngravingFont): number {
  let width = 0
  for (const char of text) {
    width += font.advanceEm(char) * sizeMm
  }
  return width
}

function pushChars(
  chars: string[],
  sizeMm: number,
  maxWidthMm: number,
  font: EngravingFont,
  out: string[],
): void {
  let current = ''
  let width = 0
  for (const char of chars) {
    const advance = font.advanceEm(char) * sizeMm
    if (current !== '' && width + advance > maxWidthMm + EPSILON) {
      out.push(current)
      current = char
      width = advance
    } else {
      current += char
      width += advance
    }
  }
  if (current !== '') out.push(current)
}

/** 1段落を面の幅に収まるよう折り返す（改行なしの文字列を渡す）。 */
function wrapParagraph(
  text: string,
  sizeMm: number,
  maxWidthMm: number,
  font: EngravingFont,
  wrap: boolean,
): string[] {
  if (text === '') return ['']
  if (!wrap || maxWidthMm <= 0) return [text]
  if (measureWidth(text, sizeMm, font) <= maxWidthMm + EPSILON) return [text]

  const hasSpace = /[ \u3000]/.test(text)
  const tokens = hasSpace ? text.split(/([ \u3000]+)/).filter((token) => token !== '') : []
  if (!hasSpace) {
    const out: string[] = []
    pushChars(Array.from(text), sizeMm, maxWidthMm, font, out)
    return out.length > 0 ? out : ['']
  }

  const out: string[] = []
  let current = ''
  let currentWidth = 0
  for (const token of tokens) {
    const tokenWidth = measureWidth(token, sizeMm, font)
    if (current !== '' && currentWidth + tokenWidth > maxWidthMm + EPSILON) {
      out.push(current)
      current = ''
      currentWidth = 0
    }
    if (tokenWidth > maxWidthMm + EPSILON) {
      // 1単語が幅を超える場合は文字単位で分割する。
      const pieces: string[] = []
      pushChars(Array.from(token), sizeMm, maxWidthMm, font, pieces)
      if (current !== '') {
        pieces[0] = current + pieces[0]
        current = ''
        currentWidth = 0
      }
      out.push(...pieces)
      continue
    }
    current += token
    currentWidth += tokenWidth
  }
  if (current !== '') out.push(current)
  return out.length > 0 ? out : ['']
}

function buildVisualLines(
  options: EngravingOptions,
  maxWidthMm: number,
  font: EngravingFont,
): VisualLine[] {
  const visual: VisualLine[] = []
  for (const line of options.lines) {
    if (line.text === '') continue
    const sizeMm = Number.isFinite(line.sizeMm) ? Math.max(0.1, line.sizeMm) : 0.1
    for (const paragraph of line.text.split('\n')) {
      if (paragraph === '') continue
      for (const wrapped of wrapParagraph(paragraph, sizeMm, maxWidthMm, font, options.wrap)) {
        if (wrapped === '') continue
        visual.push({ sourceId: line.id, text: wrapped, sizeMm })
      }
    }
  }
  return visual
}

/**
 * 刻印内容を面にレイアウトする。
 *
 * - 余白 FACE_MARGIN_MM を除いた使用可能領域に、中心位置（0..1）でブロックを置く。
 * - 行はインクの高さで詰めて積む（行間 = lineGapMm）。
 * - 行はブロック枠内で align（左・中央・右）に揃える。
 * - 面に収まらない場合は overflowX/Y が立ち、fits = false になる。
 */
export function layoutEngraving(
  face: EngravingFaceDims,
  options: EngravingOptions,
  font: EngravingFont,
): EngravingLayout {
  const margin = FACE_MARGIN_MM
  const usable = {
    x: margin,
    y: margin,
    width: Math.max(0, face.widthMm - margin * 2),
    height: Math.max(0, face.heightMm - margin * 2),
  }
  const visualLines = buildVisualLines(options, usable.width, font)

  const unsupportedChars: string[] = []
  const seenUnsupported = new Set<string>()
  const undersizedLineIndices: number[] = []
  const minSizes = engravingMinFontSizes(options.printProfile)
  const gapMm = Number.isFinite(options.lineGapMm) ? Math.max(0, options.lineGapMm) : 0

  const metrics = visualLines.map((visual) => {
    const glyphs: EngravingGlyphPlacement[] = []
    let cursor = 0
    let inkTop = 0
    let inkBottom = 0
    for (const char of visual.text) {
      if (!font.has(char) && !seenUnsupported.has(char)) {
        seenUnsupported.add(char)
        unsupportedChars.push(char)
      }
      glyphs.push({ char, x: cursor })
      const advance = font.advanceEm(char) * visual.sizeMm
      const bbox = font.bboxEm(char)
      if (bbox) {
        inkTop = Math.max(inkTop, bbox.y2 * visual.sizeMm)
        inkBottom = Math.min(inkBottom, bbox.y1 * visual.sizeMm)
      } else {
        inkTop = Math.max(inkTop, UNSUPPORTED_INK_TOP_EM * visual.sizeMm)
      }
      cursor += advance
    }
    const inkTopSafe = Math.max(inkTop, 0.1)
    const lineHeight = inkTopSafe - inkBottom
    return {
      sourceId: visual.sourceId,
      text: visual.text,
      sizeMm: visual.sizeMm,
      widthMm: cursor,
      glyphs,
      inkTopMm: inkTopSafe,
      inkBottomMm: inkBottom,
      lineHeight,
    }
  })

  for (let index = 0; index < metrics.length; index++) {
    const metric = metrics[index]
    const minSize = isCjkText(metric.text) ? minSizes.cjkMm : minSizes.latinMm
    if (metric.sizeMm < minSize - 1e-6) undersizedLineIndices.push(index)
  }

  const blockWidth = metrics.reduce((max, line) => Math.max(max, line.widthMm), 0)
  const blockHeight =
    metrics.length > 0
      ? metrics.reduce((sum, line) => sum + line.lineHeight, 0) + gapMm * (metrics.length - 1)
      : 0

  const centerXRatio = Number.isFinite(options.centerX)
    ? Math.min(1, Math.max(0, options.centerX))
    : 0.5
  const centerYRatio = Number.isFinite(options.centerY)
    ? Math.min(1, Math.max(0, options.centerY))
    : 0.5
  const blockX = usable.x + centerXRatio * usable.width - blockWidth / 2
  const blockY = usable.y + centerYRatio * usable.height - blockHeight / 2

  const align = options.align === 'left' || options.align === 'right' ? options.align : 'center'
  const lines: EngravingLayoutLine[] = []
  let cursorY = blockY + blockHeight
  for (const metric of metrics) {
    cursorY -= metric.lineHeight
    const baselineY = cursorY - metric.inkBottomMm
    lines.push({
      sourceId: metric.sourceId,
      text: metric.text,
      sizeMm: metric.sizeMm,
      x:
        align === 'left'
          ? blockX
          : align === 'right'
            ? blockX + blockWidth - metric.widthMm
            : blockX + (blockWidth - metric.widthMm) / 2,
      baselineY,
      widthMm: metric.widthMm,
      glyphs: metric.glyphs,
      inkTopMm: metric.inkTopMm,
      inkBottomMm: metric.inkBottomMm,
    })
    cursorY -= gapMm
  }

  const overflowX =
    blockWidth > usable.width + EPSILON ||
    blockX < usable.x - EPSILON ||
    blockX + blockWidth > usable.x + usable.width + EPSILON
  const overflowY =
    blockHeight > usable.height + EPSILON ||
    blockY < usable.y - EPSILON ||
    blockY + blockHeight > usable.y + usable.height + EPSILON
  const fits = lines.length > 0 && !overflowX && !overflowY && unsupportedChars.length === 0

  return {
    face: face.face,
    faceWidthMm: face.widthMm,
    faceHeightMm: face.heightMm,
    usable,
    block: { x: blockX, y: blockY, width: blockWidth, height: blockHeight },
    lines,
    overflowX,
    overflowY,
    unsupportedChars,
    undersizedLineIndices,
    fits,
  }
}

/**
 * 面に収まるよう自動調整したオプションを返す。
 *
 * 1. ブロックを中央へ寄せる
 * 2. 全行を等比縮小し、最小サイズ（印刷プロファイル由来）で下限を打つ
 * 収まらない場合は最小サイズのまま（fits = false のまま）返す。
 */
export function autoFitEngraving(
  face: EngravingFaceDims,
  options: EngravingOptions,
  font: EngravingFont,
): EngravingOptions {
  const minSizes = engravingMinFontSizes(options.printProfile)
  const minSizeFor = (text: string): number => (isCjkText(text) ? minSizes.cjkMm : minSizes.latinMm)

  const centered: EngravingOptions = {
    ...options,
    centerX: 0.5,
    centerY: 0.5,
    wrap: true,
    lines: options.lines.map((line) => ({ ...line })),
  }
  if (layoutEngraving(face, centered, font).fits) return centered

  let scale = 1
  let best = centered
  for (let step = 0; step < 120; step++) {
    scale *= 0.96
    const candidate: EngravingOptions = {
      ...centered,
      lines: centered.lines.map((line) => ({
        ...line,
        sizeMm: Math.max(minSizeFor(line.text), line.sizeMm * scale),
      })),
    }
    best = candidate
    if (layoutEngraving(face, candidate, font).fits) return candidate
    const atMinimum = candidate.lines.every((line) => line.sizeMm <= minSizeFor(line.text) + 1e-6)
    if (atMinimum) break
  }
  return best
}
