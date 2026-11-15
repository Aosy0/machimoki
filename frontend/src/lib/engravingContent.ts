/**
 * 刻印内容（地名・座標・メッシュコード・縮尺・出典・作成年・自由入力）の定義と、
 * 自動値（bounds などから決まる文字列）の組み立て。
 *
 * 文字列の書式は core の formatter に集約し、CLI/API と同じ表記にする。
 */

import type { EngravingLine } from '../../../core/src/engraving/types.ts'
import type { Bounds } from '../../../core/src/types.ts'
import {
  formatAttribution,
  formatCenterCoordinate,
  formatDateLine,
  formatMeshCodeLine,
  formatScaleAndSize,
} from '../../../core/src/engraving/content.ts'
import { getCoverageDetails, resolveMuniCodes } from './catalogApi'

/** 刻印できる内容の種類。 */
export type EngravingContentId =
  | 'place'
  | 'coords'
  | 'mesh'
  | 'scale'
  | 'attribution'
  | 'date'
  | 'custom'

export interface EngravingContentDef {
  id: EngravingContentId
  label: string
  /** 既定の文字サイズ（印刷mm） */
  defaultSizeMm: number
  /** 複数行入力（textarea）にする */
  multiline?: boolean
}

/** 内容選択UIに並べる定義（この順番が行の並び順になる）。 */
export const ENGRAVING_CONTENT_DEFS: readonly EngravingContentDef[] = [
  { id: 'place', label: '地名', defaultSizeMm: 6 },
  { id: 'coords', label: '中心座標', defaultSizeMm: 3.5 },
  { id: 'mesh', label: 'メッシュコード', defaultSizeMm: 3.5 },
  { id: 'scale', label: '縮尺・寸法', defaultSizeMm: 3.5 },
  { id: 'attribution', label: '出典', defaultSizeMm: 3.5 },
  { id: 'date', label: '作成年', defaultSizeMm: 3.5 },
  { id: 'custom', label: '自由入力', defaultSizeMm: 4, multiline: true },
] as const

/** 選択範囲・縮尺・寸法から、自動で決まる刻印テキストを組み立てる。 */
export function buildAutoTexts(
  bounds: Bounds,
  scale: number,
  widthMm: number,
  depthMm: number,
  terrainThicknessMm: number,
  placeName: string | null,
): Record<string, string> {
  return {
    place: placeName ?? '',
    coords: formatCenterCoordinate(bounds),
    mesh: formatMeshCodeLine(bounds) ?? '',
    scale: formatScaleAndSize(scale, widthMm, depthMm, terrainThicknessMm),
    attribution: formatAttribution(),
    date: formatDateLine(),
  }
}

/** 既定でONにする内容の行を作る（空テキストの行は除外）。 */
export function defaultEngravingLines(autoTexts: Record<string, string>): EngravingLine[] {
  const lines: EngravingLine[] = []
  for (const def of ENGRAVING_CONTENT_DEFS) {
    if (def.id === 'custom') continue
    const text = autoTexts[def.id] ?? ''
    if (text === '') continue
    lines.push({ id: def.id, text, sizeMm: def.defaultSizeMm, auto: true })
  }
  return lines
}

/**
 * 自動値の変化を auto:true の行にだけ反映する。
 * 変化が無ければ同一参照を返し、useEffect からの onChange が無限ループしないようにする。
 */
export function mergeAutoLines(
  lines: EngravingLine[],
  autoTexts: Record<string, string>,
): EngravingLine[] {
  let changed = false
  const next = lines.map((line) => {
    if (line.auto !== true) return line
    const text = autoTexts[line.id]
    if (text === undefined || text === line.text) return line
    changed = true
    return { ...line, text }
  })
  return changed ? next : lines
}

const placeNameCache = new Map<string, string>()
const placeNamePending = new Map<string, Promise<string | null>>()

function boundsCacheKey(bounds: Bounds): string {
  const f = (n: number): string => Number(n).toFixed(6)
  return `${f(bounds.west)},${f(bounds.south)},${f(bounds.east)},${f(bounds.north)}`
}

/**
 * 選択範囲の地名（都道府県＋市区町村）を返す。
 *
 * カタログAPIのカバレッジ情報から解決する。取得できない場合や
 * 複数自治体にまたがる場合は「・」で連結する。失敗時は null。
 * bounds 単位で結果をキャッシュする（失敗はキャッシュせず再試行できる）。
 */
export function resolvePlaceName(bounds: Bounds): Promise<string | null> {
  const key = boundsCacheKey(bounds)
  const cached = placeNameCache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = placeNamePending.get(key)
  if (pending) return pending

  const task = (async (): Promise<string | null> => {
    try {
      const codes = await resolveMuniCodes(bounds)
      const details = await getCoverageDetails()
      const names = new Set<string>()
      for (const code of codes) {
        const detail = details.get(code)
        if (detail && detail.pref !== '' && detail.city !== '') {
          names.add(`${detail.pref}${detail.city}`)
        }
      }
      if (names.size === 0) return null
      const name = Array.from(names)
        .sort((a, b) => a.localeCompare(b, 'ja'))
        .join('・')
      placeNameCache.set(key, name)
      return name
    } catch {
      return null
    } finally {
      placeNamePending.delete(key)
    }
  })()
  placeNamePending.set(key, task)
  return task
}
