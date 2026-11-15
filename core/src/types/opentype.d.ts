declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }

  export interface Path {
    commands: PathCommand[]
  }

  export interface BoundingBox {
    x1: number
    y1: number
    x2: number
    y2: number
  }

  export interface Glyph {
    index: number
    advanceWidth: number
    getPath(x: number, y: number, fontSize: number, options?: unknown, font?: Font): Path
    getBoundingBox(): BoundingBox
  }

  export interface Font {
    unitsPerEm: number
    ascender: number
    descender: number
    numGlyphs: number
    charToGlyphIndex(char: string): number
    charToGlyph(char: string): Glyph
  }

  export function parse(buffer: ArrayBuffer): Font

  const opentype: { parse: typeof parse }
  export default opentype
}
