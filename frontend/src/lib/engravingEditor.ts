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
