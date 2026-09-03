/**
 * PLATEAU 建築物データの整備メッシュ（メッシュコード集合）を扱うモジュール。
 *
 * PLATEAU 建築物データは「自治体zip＋内部メッシュ分割GML」で構成され、
 * citygml API（/datacatalog/citygml/m:{mesh}?types=bldg）の応答
 * `files.bldg[].code`（メッシュコード集合）が整備メッシュを表す。
 *
 * 本モジュールはメッシュコードの正規化・抽出・集計・カバレッジマップとの
 * 突合のみを提供する pure 関数群。API 取得層は持たない（fetch 非依存）。
 * 将来のメッシュ塗り表示の土台。
 */

import type { CoverageMap } from './types.js';

/** メッシュレベル。2次=6桁 / 3次=8桁 / 4次=9・10桁。 */
export type MeshLevel = 'secondary' | 'tertiary' | 'quaternary';

/** citygml API 応答の files.bldg[] 1要素。外部JSON由来のため unknown で受ける。 */
export interface CityGmlBldgFile {
  code?: unknown;
  maxLod?: unknown;
  url?: unknown;
}

/** citygml API 応答の cities[] 1要素。 */
export interface CityGmlCity {
  id?: string;
  pref_code?: string;
  city_code?: string;
  files?: {
    bldg?: CityGmlBldgFile[];
  };
}

/** citygml API 応答（/datacatalog/citygml/m:{mesh}?types=bldg）。 */
export interface CityGmlResponse {
  cities?: CityGmlCity[];
}

/** 自治体ごとのメッシュカバレッジ集計結果。 */
export interface CityMeshCoverage {
  prefCode: string;
  cityCode: string;
  meshCodes: Set<string>;
  maxLods: number[];
}

/** メッシュとカバレッジマップの突合結果。 */
export interface MeshCoverageMatch {
  meshCode: string;
  muniCode: string | null;
  covered: boolean;
  lods: number[];
}

/** 受理するメッシュコードの桁数（2次6桁・3次8桁・4次9/10桁）。 */
const MESH_CODE_LENGTHS: readonly number[] = [6, 8, 9, 10];

/**
 * メッシュコードの形式を検証する。
 * 2次（6桁）・3次（8桁）・4次（9/10桁）の数字のみを受理する。
 */
export function isValidMeshCode(code: string): boolean {
  return MESH_CODE_LENGTHS.includes(code.length) && /^\d+$/.test(code);
}

/**
 * メッシュコードを正規化する。
 * 文字列は前後空白を除去し、形式が正しければそのまま返す。
 * 数値は非負整数のみ受理し、文字列化して返す。
 * 形式が不正な場合は null を返す。
 */
export function normalizeMeshCode(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    const str = String(value);
    return isValidMeshCode(str) ? str : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return isValidMeshCode(trimmed) ? trimmed : null;
  }
  return null;
}

/**
 * メッシュコードのレベルを返す。不正な形式は null。
 */
export function meshLevel(code: string): MeshLevel | null {
  if (!isValidMeshCode(code)) return null;
  switch (code.length) {
    case 6:
      return 'secondary';
    case 8:
      return 'tertiary';
    default:
      return 'quaternary';
  }
}

/**
 * maxLod を正規化する。非負整数のみ受理し、それ以外は null。
 */
export function normalizeMaxLod(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      return Number.isSafeInteger(num) ? num : null;
    }
    return null;
  }
  return null;
}

/**
 * citygml API 応答から整備メッシュコードの Set を抽出する。
 * files.bldg[].code のうち形式が正しいもののみを含む。
 */
export function extractMeshCodes(response: CityGmlResponse): Set<string> {
  const codes = new Set<string>();
  for (const city of response.cities ?? []) {
    for (const file of city.files?.bldg ?? []) {
      const normalized = normalizeMeshCode(file.code);
      if (normalized) codes.add(normalized);
    }
  }
  return codes;
}

/**
 * citygml API 応答を自治体（pref_code:city_code）ごとに集計する。
 * 同一自治体の複数 city エントリはマージされる。
 * コードが欠落している city は id / 出現順で区別する。
 * メッシュコード・maxLod はそれぞれ昇順に整列して返す。
 */
export function aggregateMeshCoverageByCity(
  response: CityGmlResponse,
): CityMeshCoverage[] {
  const byKey = new Map<string, CityMeshCoverage>();
  const cities = response.cities ?? [];

  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    const prefCode = typeof city.pref_code === 'string' ? city.pref_code : '';
    const cityCode = typeof city.city_code === 'string' ? city.city_code : '';
    const key =
      prefCode || cityCode
        ? `${prefCode}:${cityCode}`
        : typeof city.id === 'string' && city.id
          ? `id:${city.id}`
          : `index:${i}`;

    let entry = byKey.get(key);
    if (!entry) {
      entry = { prefCode, cityCode, meshCodes: new Set(), maxLods: [] };
      byKey.set(key, entry);
    }

    for (const file of city.files?.bldg ?? []) {
      const normalized = normalizeMeshCode(file.code);
      if (normalized) entry.meshCodes.add(normalized);
      const lod = normalizeMaxLod(file.maxLod);
      if (lod !== null && !entry.maxLods.includes(lod)) entry.maxLods.push(lod);
    }
  }

  return [...byKey.values()].map((entry) => ({
    ...entry,
    meshCodes: new Set([...entry.meshCodes].sort()),
    maxLods: [...entry.maxLods].sort((a, b) => a - b),
  }));
}

/**
 * citygml API 応答を LoD（maxLod）ごとに集計する。
 * キーは maxLod、値はその LoD を持つメッシュコードの Set。
 * maxLod が欠落・不正のエントリは含めない。
 */
export function aggregateMeshCoverageByLod(
  response: CityGmlResponse,
): Map<number, Set<string>> {
  const byLod = new Map<number, Set<string>>();
  for (const city of response.cities ?? []) {
    for (const file of city.files?.bldg ?? []) {
      const normalized = normalizeMeshCode(file.code);
      if (!normalized) continue;
      const lod = normalizeMaxLod(file.maxLod);
      if (lod === null) continue;
      let set = byLod.get(lod);
      if (!set) {
        set = new Set();
        byLod.set(lod, set);
      }
      set.add(normalized);
    }
  }
  return byLod;
}

/**
 * メッシュコード集合とカバレッジマップを突合する。
 * メッシュ→muniCode の解決は呼出側が meshToMuni で提供する。
 * 各メッシュについて、muniCode・covered・lods を返す。
 */
export function matchMeshCoverage(
  meshCodes: Iterable<string>,
  meshToMuni: ReadonlyMap<string, string>,
  coverageMap: CoverageMap,
): MeshCoverageMatch[] {
  const matches: MeshCoverageMatch[] = [];
  for (const meshCode of meshCodes) {
    const muniCode = meshToMuni.get(meshCode) ?? null;
    const coverage = muniCode ? coverageMap[muniCode] : undefined;
    matches.push({
      meshCode,
      muniCode,
      covered: coverage?.covered ?? false,
      lods: coverage?.lods ?? [],
    });
  }
  return matches;
}