/**
 * 刻印グリフの SVG path 生成（UIの面プレビューと3Dオーバーレイで共有）。
 */

import type { EngravingFont } from '../../../core/src/engraving/font.ts'
import type { EngravingLayout } from '../../../core/src/engraving/layout.ts'

/** em 単位のグリフ輪郭を SVG path データにする（穴も含む）。 */
export function glyphPathData(font: EngravingFont, char: string): string {
  let data = ''
  for (const contour of font.outlineEm(char)) {
    for (let index = 0; index < contour.length; index++) {
      const point = contour[index]
      data += `${index === 0 ? 'M' : 'L'}${point.x.toFixed(4)} ${point.y.toFixed(4)}`
    }
    data += 'Z'
  }
  return data
}

/** レイアウトに含まれる文字ごとの SVG path データを作る。 */
export function buildGlyphPathMap(
  font: EngravingFont,
  layout: EngravingLayout,
): Map<string, string> {
  const paths = new Map<string, string>()
  for (const line of layout.lines) {
    for (const glyph of line.glyphs) {
      if (!paths.has(glyph.char)) paths.set(glyph.char, glyphPathData(font, glyph.char))
    }
  }
  return paths
}
