/// <reference path="../types/opentype.d.ts" />
/**
 * 刻印用フォント（TrueType/OpenType）の読み込みと輪郭抽出。
 *
 * opentype.js でグリフのパスを取り出し、2次/3次ベジェを折れ線に変換する。
 * 座標は em（1em = 1）単位・ベースラインが y=0・y軸上向きで返す。
 * 輪郭の向きはフォント由来のまま（TrueTypeの非ゼロ規則で外周/穴が決まる）。
 */

import opentype from 'opentype.js'
import type { PathCommand } from 'opentype.js'

export interface EngravingFontPoint {
  x: number
  y: number
}

export interface EngravingFontBBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface EngravingFont {
  unitsPerEm: number
  /** アセント（em、正の値） */
  ascenderEm: number
  /** ディセント（em、負の値） */
  descenderEm: number
  has(char: string): boolean
  /** 前進幅（em）。未対応文字は FALLBACK_ADVANCE_EM。 */
  advanceEm(char: string): number
  /** グリフのバウンディングボックス（em、ベースライン基準）。空グリフは null。 */
  bboxEm(char: string): EngravingFontBBox | null
  /** グリフ輪郭の折れ線（em、y軸上向き）。穴も含む。 */
  outlineEm(char: string): EngravingFontPoint[][]
}

/** 未対応文字の前進幅（em）。 */
export const FALLBACK_ADVANCE_EM = 0.5

/** ベジェの折れ線化許容誤差（em）。8mmの文字で約0.012mm。 */
const CURVE_TOLERANCE_EM = 0.0015
const MAX_SUBDIVIDE_DEPTH = 12

interface GlyphCacheEntry {
  advanceEm: number
  bboxEm: EngravingFontBBox | null
  outlineEm: EngravingFontPoint[][]
}

function midpoint(a: EngravingFontPoint, b: EngravingFontPoint): EngravingFontPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** 2次ベジェが弦から十分近いか（制御点と弦の距離で判定）。 */
function quadraticFlatEnough(
  p0: EngravingFontPoint,
  p1: EngravingFontPoint,
  p2: EngravingFontPoint,
  tolerance: number,
): boolean {
  const dx = p2.x - p0.x
  const dy = p2.y - p0.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(p1.x - p0.x, p1.y - p0.y) <= tolerance
  return Math.abs((p1.x - p0.x) * dy - (p1.y - p0.y) * dx) / length <= tolerance
}

function flattenQuadratic(
  p0: EngravingFontPoint,
  p1: EngravingFontPoint,
  p2: EngravingFontPoint,
  tolerance: number,
  out: EngravingFontPoint[],
  depth: number,
): void {
  if (depth <= 0 || quadraticFlatEnough(p0, p1, p2, tolerance)) {
    out.push(p2)
    return
  }
  const p01 = midpoint(p0, p1)
  const p12 = midpoint(p1, p2)
  const p012 = midpoint(p01, p12)
  flattenQuadratic(p0, p01, p012, tolerance, out, depth - 1)
  flattenQuadratic(p012, p12, p2, tolerance, out, depth - 1)
}

/** 3次ベジェが弦から十分近いか。 */
function cubicFlatEnough(
  p0: EngravingFontPoint,
  p1: EngravingFontPoint,
  p2: EngravingFontPoint,
  p3: EngravingFontPoint,
  tolerance: number,
): boolean {
  const dx = p3.x - p0.x
  const dy = p3.y - p0.y
  const length = Math.hypot(dx, dy)
  const distance = (p: EngravingFontPoint): number => {
    if (length === 0) return Math.hypot(p.x - p0.x, p.y - p0.y)
    return Math.abs((p.x - p0.x) * dy - (p.y - p0.y) * dx) / length
  }
  return distance(p1) <= tolerance && distance(p2) <= tolerance
}

function flattenCubic(
  p0: EngravingFontPoint,
  p1: EngravingFontPoint,
  p2: EngravingFontPoint,
  p3: EngravingFontPoint,
  tolerance: number,
  out: EngravingFontPoint[],
  depth: number,
): void {
  if (depth <= 0 || cubicFlatEnough(p0, p1, p2, p3, tolerance)) {
    out.push(p3)
    return
  }
  const p01 = midpoint(p0, p1)
  const p12 = midpoint(p1, p2)
  const p23 = midpoint(p2, p3)
  const p012 = midpoint(p01, p12)
  const p123 = midpoint(p12, p23)
  const p0123 = midpoint(p012, p123)
  flattenCubic(p0, p01, p012, p0123, tolerance, out, depth - 1)
  flattenCubic(p0123, p123, p23, p3, tolerance, out, depth - 1)
}

/**
 * opentype.js のパスコマンドを輪郭（閉じた折れ線）の配列に変換する。
 * パス座標は y 下向きなので、y を反転して y 上向きで返す。
 */
export function flattenGlyphPath(commands: PathCommand[]): EngravingFontPoint[][] {
  const contours: EngravingFontPoint[][] = []
  let current: EngravingFontPoint[] = []
  let cursor: EngravingFontPoint = { x: 0, y: 0 }
  let hasMove = false

  const finishContour = (): void => {
    if (current.length >= 3) {
      const first = current[0]
      const last = current[current.length - 1]
      if (first.x !== last.x || first.y !== last.y) current.push({ x: first.x, y: first.y })
      contours.push(current)
    }
    current = []
    hasMove = false
  }

  for (const command of commands) {
    switch (command.type) {
      case 'M': {
        finishContour()
        cursor = { x: command.x ?? 0, y: -(command.y ?? 0) }
        current.push(cursor)
        hasMove = true
        break
      }
      case 'L': {
        cursor = { x: command.x ?? 0, y: -(command.y ?? 0) }
        if (hasMove) current.push(cursor)
        break
      }
      case 'Q': {
        const control = { x: command.x1 ?? 0, y: -(command.y1 ?? 0) }
        const end = { x: command.x ?? 0, y: -(command.y ?? 0) }
        if (hasMove)
          flattenQuadratic(cursor, control, end, CURVE_TOLERANCE_EM, current, MAX_SUBDIVIDE_DEPTH)
        cursor = end
        break
      }
      case 'C': {
        const control1 = { x: command.x1 ?? 0, y: -(command.y1 ?? 0) }
        const control2 = { x: command.x2 ?? 0, y: -(command.y2 ?? 0) }
        const end = { x: command.x ?? 0, y: -(command.y ?? 0) }
        if (hasMove) {
          flattenCubic(
            cursor,
            control1,
            control2,
            end,
            CURVE_TOLERANCE_EM,
            current,
            MAX_SUBDIVIDE_DEPTH,
          )
        }
        cursor = end
        break
      }
      case 'Z': {
        finishContour()
        break
      }
      default:
        break
    }
  }
  finishContour()
  return contours
}

/**
 * フォントバイナリを解析して刻印用フォントを作る。
 * グリフの輪郭・前進幅・バウンディングボックスは文字ごとにキャッシュする。
 */
export function parseEngravingFont(data: ArrayBuffer): EngravingFont {
  const font = opentype.parse(data)
  const unitsPerEm = font.unitsPerEm > 0 ? font.unitsPerEm : 1000
  const cache = new Map<string, GlyphCacheEntry>()

  const entryFor = (char: string): GlyphCacheEntry | null => {
    const cached = cache.get(char)
    if (cached) return cached
    if (font.charToGlyphIndex(char) === 0) {
      cache.set(char, {
        advanceEm: FALLBACK_ADVANCE_EM,
        bboxEm: null,
        outlineEm: [],
      })
      return cache.get(char) ?? null
    }
    const glyph = font.charToGlyph(char)
    let outlineEm: EngravingFontPoint[][] = []
    let bboxEm: EngravingFontBBox | null = null
    try {
      const path = glyph.getPath(0, 0, 1, undefined, font)
      outlineEm = flattenGlyphPath(path.commands)
    } catch {
      outlineEm = []
    }
    try {
      const box = glyph.getBoundingBox()
      if (
        Number.isFinite(box.x1) &&
        Number.isFinite(box.y1) &&
        Number.isFinite(box.x2) &&
        Number.isFinite(box.y2)
      ) {
        if (box.x2 > box.x1 || box.y2 > box.y1) {
          bboxEm = {
            x1: box.x1 / unitsPerEm,
            y1: box.y1 / unitsPerEm,
            x2: box.x2 / unitsPerEm,
            y2: box.y2 / unitsPerEm,
          }
        }
      }
    } catch {
      bboxEm = null
    }
    const entry: GlyphCacheEntry = {
      advanceEm: (glyph.advanceWidth || 0) / unitsPerEm,
      bboxEm,
      outlineEm,
    }
    cache.set(char, entry)
    return entry
  }

  return {
    unitsPerEm,
    ascenderEm: font.ascender / unitsPerEm,
    descenderEm: font.descender / unitsPerEm,
    has(char: string): boolean {
      if (char === '') return false
      return font.charToGlyphIndex(char) !== 0
    },
    advanceEm(char: string): number {
      const entry = entryFor(char)
      return entry ? entry.advanceEm : FALLBACK_ADVANCE_EM
    },
    bboxEm(char: string): EngravingFontBBox | null {
      const entry = entryFor(char)
      return entry ? entry.bboxEm : null
    },
    outlineEm(char: string): EngravingFontPoint[][] {
      const entry = entryFor(char)
      return entry ? entry.outlineEm : []
    },
  }
}
