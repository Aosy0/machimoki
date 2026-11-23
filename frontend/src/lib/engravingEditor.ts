/**
 * 刻印エディタの純粋ヘルパー（状態更新・ドラッグ移動・警告）。
 * React に依存させず、UI からもテストからも同じ関数を使う。
 */

import type {
  EngravingFaceDims,
  EngravingLine,
  EngravingOptions,
} from '../../../core/src/engraving/types.ts'
import { engravingMaxDepthMm, engravingMinFontSizes } from '../../../core/src/engraving/types.ts'
import type { EngravingLayout } from '../../../core/src/engraving/layout.ts'
import {
  ENGRAVING_CONTENT_DEFS,
  type EngravingContentDef,
  type EngravingContentId,
} from './engravingContent'

export interface EngravingEditorWarning {
  level: 'error' | 'warning'
  message: string
}

const CONTENT_ORDER = new Map<EngravingContentId, number>(
  ENGRAVING_CONTENT_DEFS.map((def, index) => [def.id, index]),
)

const MAX_LINE_SIZE_MM = 100

/** 3Dビューの四隅ハンドルで拡大縮小するときの行サイズ範囲（パネルの入力範囲に揃える）。 */
const RESIZE_MIN_LINE_SIZE_MM = 0.5
const RESIZE_MAX_LINE_SIZE_MM = 50

function contentOrder(id: string): number {
  return CONTENT_ORDER.get(id as EngravingContentId) ?? ENGRAVING_CONTENT_DEFS.length
}

/** 0.1mm 単位に丸めた表示用の数値（末尾の .0 は落とす）。 */
function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * 面ローカルmmの移動量を、使用可能領域内のブロック中心比（0..1）の変化に変換する。
 * （3Dモデル上でのドラッグは絶対座標から求めるため、この関数は使わない）
 */

/** 内容をONにする。既に行があれば何も変えない。 */
export function addContentLine(
  options: EngravingOptions,
  def: EngravingContentDef,
  autoTexts: Record<string, string>,
): EngravingOptions {
  if (options.lines.some((line) => line.id === def.id)) return options
  const auto = def.id !== 'custom'
  const line: EngravingLine = {
    id: def.id,
    text: auto ? (autoTexts[def.id] ?? '') : '',
    sizeMm: def.defaultSizeMm,
    auto,
  }
  const index = options.lines.findIndex(
    (existing) => contentOrder(existing.id) > contentOrder(def.id),
  )
  const lines = [...options.lines]
  if (index < 0) {
    lines.push(line)
  } else {
    lines.splice(index, 0, line)
  }
  return { ...options, lines }
}

/** 内容をOFFにする。該当行が無ければ何も変えない。 */
export function removeContentLine(options: EngravingOptions, id: string): EngravingOptions {
  const lines = options.lines.filter((line) => line.id !== id)
  if (lines.length === options.lines.length) return options
  return { ...options, lines }
}

/** 行のテキストを変更する（手入力した行は auto:false にする）。 */
export function updateLineText(
  options: EngravingOptions,
  id: string,
  text: string,
): EngravingOptions {
  const index = options.lines.findIndex((line) => line.id === id)
  if (index < 0) return options
  const line = options.lines[index]
  if (line.text === text && line.auto !== true) return options
  const lines = [...options.lines]
  lines[index] = { ...line, text, auto: false }
  return { ...options, lines }
}

/** 行の文字サイズ（印刷mm）を変更する。 */
export function updateLineSize(
  options: EngravingOptions,
  id: string,
  sizeMm: number,
): EngravingOptions {
  if (!Number.isFinite(sizeMm)) return options
  const size = Math.min(MAX_LINE_SIZE_MM, Math.max(0.1, sizeMm))
  const index = options.lines.findIndex((line) => line.id === id)
  if (index < 0) return options
  const line = options.lines[index]
  if (line.sizeMm === size) return options
  const lines = [...options.lines]
  lines[index] = { ...line, sizeMm: size }
  return { ...options, lines }
}

/** 3Dビューで掴むブロックの隅。 */
export type EngravingCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** 描画順（左上から時計回り）。 */
export const ENGRAVING_CORNERS: readonly EngravingCorner[] = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
] as const

/** 面ローカルmm座標。原点は面の左下、yは上向き。 */
export interface EngravingPointMm {
  uMm: number
  vMm: number
}

/** ブロックの隅の面ローカルmm座標。 */
export function engravingCornerPoint(
  block: EngravingLayout['block'],
  corner: EngravingCorner,
): EngravingPointMm {
  const right = corner === 'bottom-right' || corner === 'top-right'
  const top = corner === 'top-left' || corner === 'top-right'
  return {
    uMm: block.x + (right ? block.width : 0),
    vMm: block.y + (top ? block.height : 0),
  }
}

/** 対角の隅（拡大縮小時に固定する点）。 */
export function oppositeEngravingCorner(corner: EngravingCorner): EngravingCorner {
  switch (corner) {
    case 'bottom-left':
      return 'top-right'
    case 'bottom-right':
      return 'top-left'
    case 'top-left':
      return 'bottom-right'
    case 'top-right':
      return 'bottom-left'
  }
}

/** 隅ハンドルの一辺（面ローカルmm）。小さいブロックでも掴める大きさにする。 */
export function engravingHandleSizeMm(block: EngravingLayout['block']): number {
  const minSide = Math.min(block.width, block.height)
  return Math.min(2.6, Math.max(1.2, minSide * 0.25))
}

/** 面ローカルmmで、ブロックの隅ハンドルに当たる位置ならその隅を返す。 */
export function hitEngravingCorner(
  block: EngravingLayout['block'],
  uMm: number,
  vMm: number,
): EngravingCorner | null {
  if (block.width <= 0 || block.height <= 0) return null
  const radius = engravingHandleSizeMm(block) * 0.9
  let hit: EngravingCorner | null = null
  let hitDistance = Number.POSITIVE_INFINITY
  for (const corner of ENGRAVING_CORNERS) {
    const point = engravingCornerPoint(block, corner)
    const distance = Math.hypot(uMm - point.uMm, vMm - point.vMm)
    if (distance <= radius && distance < hitDistance) {
      hit = corner
      hitDistance = distance
    }
  }
  return hit
}

/**
 * 対角を固定して掴んだ隅をポインタへ動かすときの一様拡大率。
 * 固定点から隅へ伸びるベクトルへの射影で求める。
 */
export function engravingCornerScale(
  anchor: EngravingPointMm,
  corner: EngravingPointMm,
  pointer: EngravingPointMm,
): number {
  const du = corner.uMm - anchor.uMm
  const dv = corner.vMm - anchor.vMm
  const lengthSq = du * du + dv * dv
  if (!(lengthSq > 1e-9)) return 1
  return ((pointer.uMm - anchor.uMm) * du + (pointer.vMm - anchor.vMm) * dv) / lengthSq
}

/**
 * 行サイズを一様に factor 倍する。全行がパネルの入力範囲（0.5..50mm）に
 * 収まるよう factor を丸め、サイズは 0.1mm 単位に丸める。
 */
export function scaleEngravingLines(lines: EngravingLine[], factor: number): EngravingLine[] {
  if (!Number.isFinite(factor) || factor <= 0) return lines
  let minFactor = 0
  let maxFactor = Number.POSITIVE_INFINITY
  for (const line of lines) {
    const size = Number.isFinite(line.sizeMm) ? line.sizeMm : 0
    if (size <= 0) continue
    minFactor = Math.max(minFactor, RESIZE_MIN_LINE_SIZE_MM / size)
    maxFactor = Math.min(maxFactor, RESIZE_MAX_LINE_SIZE_MM / size)
  }
  if (!Number.isFinite(maxFactor) || minFactor > maxFactor) return lines
  const clamped = Math.min(maxFactor, Math.max(minFactor, factor))
  if (Math.abs(clamped - 1) < 1e-9) return lines
  let changed = false
  const scaled = lines.map((line) => {
    const sizeMm = Math.round(line.sizeMm * clamped * 10) / 10
    if (sizeMm === line.sizeMm) return line
    changed = true
    return { ...line, sizeMm }
  })
  return changed ? scaled : lines
}

/**
 * 拡大縮小後の設定で、固定した隅が元の面ローカル位置に残るようブロック中心を置き直す。
 * 使用可能領域からはみ出す場合は中心を 0..1 にクランプする。
 */
export function anchorEngravingBlock(
  options: EngravingOptions,
  currentLayout: EngravingLayout,
  nextLayout: EngravingLayout,
  fixedCorner: EngravingCorner,
): EngravingOptions {
  const anchor = engravingCornerPoint(currentLayout.block, fixedCorner)
  const right = fixedCorner === 'bottom-right' || fixedCorner === 'top-right'
  const top = fixedCorner === 'top-left' || fixedCorner === 'top-right'
  const blockX = right ? anchor.uMm - nextLayout.block.width : anchor.uMm
  const blockY = top ? anchor.vMm - nextLayout.block.height : anchor.vMm
  const usable = nextLayout.usable
  const centerX =
    usable.width > 0
      ? Math.min(1, Math.max(0, (blockX + nextLayout.block.width / 2 - usable.x) / usable.width))
      : options.centerX
  const centerY =
    usable.height > 0
      ? Math.min(1, Math.max(0, (blockY + nextLayout.block.height / 2 - usable.y) / usable.height))
      : options.centerY
  return { ...options, centerX, centerY }
}

/** レイアウト結果と印刷条件から、エディタに表示する警告を組み立てる。 */
export function editorWarnings(
  layout: EngravingLayout,
  faceDims: EngravingFaceDims,
  options: EngravingOptions,
): EngravingEditorWarning[] {
  const warnings: EngravingEditorWarning[] = []

  if (!faceDims.available) {
    warnings.push({
      level: 'error',
      message: `この面には刻印できません: ${faceDims.unavailableReason ?? '面の条件を満たしていません'}`,
    })
  }
  if (layout.overflowX || layout.overflowY) {
    warnings.push({ level: 'error', message: '文字が面からはみ出しています' })
  }
  if (layout.unsupportedChars.length > 0) {
    warnings.push({
      level: 'error',
      message: `未対応の文字: ${layout.unsupportedChars.join(' ')}`,
    })
  }
  if (layout.undersizedLineIndices.length > 0) {
    const minSizes = engravingMinFontSizes(options.printProfile)
    warnings.push({
      level: 'warning',
      message: `文字サイズが小さすぎます（最小: 欧文${formatMm(minSizes.latinMm)}mm / 日本語${formatMm(minSizes.cjkMm)}mm）`,
    })
  }
  const maxDepthMm = engravingMaxDepthMm(faceDims)
  if (Number.isFinite(maxDepthMm) && options.depthMm > maxDepthMm + 1e-6) {
    warnings.push({
      level: 'warning',
      message: `刻印が深すぎます（最大${formatMm(maxDepthMm)}mm）`,
    })
  }
  if (!options.lines.some((line) => line.text.trim() !== '')) {
    warnings.push({ level: 'warning', message: '刻印する内容がありません' })
  }

  return warnings
}
