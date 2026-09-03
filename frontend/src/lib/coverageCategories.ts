/**
 * PLATEAU建物有無オーバーレイ（MVT）の LoD 別カテゴリ定義。
 *
 * MVT フィーチャの properties.lods（enrich が付与する "lod1,lod2" 形式。
 * 空文字は建物なし）から最大 LoD を求め、5カテゴリに塗り分ける。
 * MVT描画（coverageMvtLayer.ts）と凡例（App.tsx）の双方がこの定数を参照し、
 * 色の二重定義を禁止する。
 *
 * Cesium 非依存の pure モジュール（単体テスト可能）。
 */

export type LodCategory = 'none' | 'lod1' | 'lod2' | 'lod3plus' | 'lod4'

export interface LodCategoryStyle {
  /** ポリゴン塗り（Canvas fillStyle 形式） */
  fill: string
  /** ポリゴン枠線（Canvas strokeStyle 形式） */
  outline: string
  /** 凡例表示ラベル */
  label: string
}

/**
 * カテゴリごとの fill/outline 対。色の唯一の定義元。
 * - none: 従来の未整備グレー
 * - lod1: 従来の整備済みブルー（#4fc3f7）
 * - lod2/lod3plus/lod4: 最大 LoD が上がるほど暖色側へ
 */
export const LOD_CATEGORY_STYLES: Record<LodCategory, LodCategoryStyle> = {
  none: {
    fill: 'rgba(128, 128, 128, 0.35)',
    outline: 'rgba(128, 128, 128, 0.5)',
    label: '建物なし',
  },
  lod1: {
    fill: 'rgba(79, 195, 247, 0.30)',
    outline: '#4fc3f7',
    label: 'LoD1',
  },
  lod2: {
    fill: 'rgba(102, 187, 106, 0.35)',
    outline: '#66bb6a',
    label: 'LoD2',
  },
  lod3plus: {
    fill: 'rgba(255, 167, 38, 0.35)',
    outline: '#ffa726',
    label: 'LoD3+',
  },
  lod4: {
    fill: 'rgba(171, 71, 188, 0.35)',
    outline: '#ab47bc',
    label: 'LoD4',
  },
}

/** 凡例の表示順 */
export const LOD_CATEGORY_ORDER: readonly LodCategory[] = [
  'none',
  'lod1',
  'lod2',
  'lod3plus',
  'lod4',
]

/**
 * lods 文字列（例 "lod1,lod2"）を LoD 番号の配列にパースする。
 * 空文字・欠落・不正トークンは無視し、重複除去＋昇順ソートして返す。
 */
export function parseLodsString(value: unknown): number[] {
  if (typeof value !== 'string') return []
  const found = new Set<number>()
  for (const token of value.split(',')) {
    const match = token.trim().toLowerCase().match(/^lod([1-4])$/)
    if (match !== null) {
      found.add(Number(match[1]))
    }
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * 最大 LoD をカテゴリに変換する。null（建物なし）は 'none'。
 * 範囲外は none 側・lod4 側に丸める。
 */
export function maxLodToCategory(max: number | null): LodCategory {
  if (max === null || Number.isNaN(max)) return 'none'
  if (max <= 0) return 'none'
  if (max === 1) return 'lod1'
  if (max === 2) return 'lod2'
  if (max === 3) return 'lod3plus'
  return 'lod4'
}

function isCoveredValue(value: unknown): boolean {
  return value === 1 || value === '1' || value === true
}

/**
 * MVT フィーチャの properties から LoD カテゴリを解決する。
 * properties.lods があれば最大 LoD を使い、
 * lods 欠落時は properties.covered===1 なら lod1 扱いのフォールバックを返す。
 */
export function resolveLodCategory(
  properties: Record<string, unknown> | undefined,
): LodCategory {
  const lods = parseLodsString(properties?.lods)
  if (lods.length > 0) {
    return maxLodToCategory(Math.max(...lods))
  }
  if (isCoveredValue(properties?.covered)) {
    return 'lod1'
  }
  return 'none'
}
