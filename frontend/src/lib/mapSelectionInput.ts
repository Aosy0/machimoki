/**
 * mapタブの手入力・プリセット・現在表示範囲→SelectionBounds変換の単一集約点。
 *
 * 変換・検証は lib/selectionBounds・lib/mapBounds の集約関数のみを使う
 * （独自の経緯度正規化・面積計算の複写を禁止）。
 * App.tsx の手入力パネル・プリセット・タブ復元はこのモジュール経由で行い、
 * Cesium/MapLibre のどちらの地図から来た値も同じ判定に通す。
 */
import { createSelectionBounds } from './mapBounds'
import {
  validateSelectionBounds,
  type SelectionBounds,
} from './selectionBounds'

export interface ManualCoordsInput {
  west: string
  south: string
  east: string
  north: string
}

export interface PresetBoundsInput {
  west: number
  south: number
  east: number
  north: number
}

export type ManualParseResult =
  | { ok: true; bounds: SelectionBounds }
  | { ok: false; error: string }

/**
 * 手入力パネルの文字列4値を SelectionBounds に変換する。
 * - NaN・順序不正は従来の日本語メッセージで拒否する
 * - 経緯度範囲・反子午線の検証は createSelectionBounds（集約）に委譲する
 */
export function parseManualCoords(
  input: ManualCoordsInput,
): ManualParseResult {
  const west = parseFloat(input.west)
  const south = parseFloat(input.south)
  const east = parseFloat(input.east)
  const north = parseFloat(input.north)
  if (
    [west, south, east, north].some((value) => !Number.isFinite(value))
  ) {
    return { ok: false, error: '座標値が無効です。数値を入力してください' }
  }
  if (west >= east || south >= north) {
    return {
      ok: false,
      error: '西端は東端より、南端は北端より小さい値を指定してください',
    }
  }
  try {
    return {
      ok: true,
      bounds: createSelectionBounds(west, south, east, north),
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '座標値が無効です',
    }
  }
}

/**
 * プリセット定数を SelectionBounds 化する。
 * createSelectionBounds（範囲・順序・反子午線）＋validateSelectionBounds
 * （面積上限1000km²）の集約検証を通し、不正なら例外を投げる。
 */
export function coercePresetBounds(
  preset: PresetBoundsInput,
): SelectionBounds {
  const bounds = createSelectionBounds(
    preset.west,
    preset.south,
    preset.east,
    preset.north,
  )
  const error = validateSelectionBounds(bounds)
  if (error !== null) {
    throw new Error(error)
  }
  return bounds
}

/**
 * 現在表示範囲の生値（Map2Dの getBounds 等）を SelectionBounds 化する。
 * 面積上限などの集約検証を通し、不正なら理由文を返す（例外にしない）。
 */
export function coerceCurrentViewBounds(
  candidate: PresetBoundsInput,
): ManualParseResult {
  const error = validateSelectionBounds(candidate)
  if (error !== null) {
    return { ok: false, error }
  }
  return {
    ok: true,
    bounds: {
      west: candidate.west,
      south: candidate.south,
      east: candidate.east,
      north: candidate.north,
    },
  }
}
