/**
 * PLATEAU カタログから GeoJSON Feature へのカバレッジ付与と、
 * coverage.json の生成を行う。
 *
 * カバレッジ定義:
 *   type_en === 'bldg'（建築物モデル）かつ
 *   format === '3D Tiles' かつ
 *   lod が '1' | '2' | '3' | '4' のいずれか
 * を満たすデータセットが存在する市区町村のみ covered とする。
 * LOD1 でも covered。road / railway / dem 等の他地物型は対象外。
 */

import type { CatalogDataset, CoverageMap, GeoJsonFeature } from './types.js';

const COVERED_LODS: readonly string[] = ['1', '2', '3', '4'];

function isCoveredDataset(dataset: CatalogDataset): boolean {
  return (
    dataset.type_en === 'bldg' &&
    dataset.format === '3D Tiles' &&
    COVERED_LODS.includes(dataset.lod)
  );
}

/**
 * カタログから市区町村コード（ward_code ?? city_code）ごとの
 * カバレッジ情報を集計する。
 * 政令指定都市は区単位（ward_code）で区別し、親市（city_code）へは集約しない。
 */
function buildCoverageByMuni(
  catalog: CatalogDataset[],
): Map<string, { covered: boolean; lods: number[] }> {
  const coverageByMuni = new Map<string, { covered: boolean; lods: number[] }>();

  for (const dataset of catalog) {
    if (!isCoveredDataset(dataset)) continue;
    const muniCode = dataset.ward_code ?? dataset.city_code;
    if (!muniCode) continue;

    const lod = Number(dataset.lod);
    const entry = coverageByMuni.get(muniCode) ?? { covered: false, lods: [] };
    if (!entry.lods.includes(lod)) entry.lods.push(lod);
    entry.covered = true;
    coverageByMuni.set(muniCode, entry);
  }

  return coverageByMuni;
}

/**
 * GeoJSON Feature の properties に covered（0|1）と lods（"lod1,lod2" 形式）を付与する。
 * キーは Feature.properties.N03_007（5桁の市区町村コード）。
 * 入力の features をそのまま変更して返す。
 */
export function enrichGeoJsonFeatures(
  features: GeoJsonFeature[],
  catalog: CatalogDataset[],
): GeoJsonFeature[] {
  const coverageByMuni = buildCoverageByMuni(catalog);

  for (const feature of features) {
    const muniCode = feature.properties?.N03_007;
    const coverage =
      typeof muniCode === 'string' ? coverageByMuni.get(muniCode) : undefined;

    const properties = feature.properties ?? {};
    properties.covered = coverage ? 1 : 0;
    properties.lods = coverage ? coverage.lods.map((lod) => `lod${lod}`).join(',') : '';
    feature.properties = properties;
  }

  return features;
}

/**
 * カタログから CoverageMap を構築する。
 * キーは ward_code ?? city_code（政令指定都市は区単位、その他は市単位）。
 * カタログに登場する全ての市区町村を含み、covered はカバレッジ定義を満たすかどうか。
 * 親市（city_code）への集約はしない。
 */
export function buildCoverageMap(catalog: CatalogDataset[]): CoverageMap {
  const coverageByMuni = buildCoverageByMuni(catalog);
  const map: CoverageMap = {};

  for (const dataset of catalog) {
    const muniCode = dataset.ward_code ?? dataset.city_code;
    if (!muniCode || map[muniCode]) continue;

    const coverage = coverageByMuni.get(muniCode);
    map[muniCode] = {
      muniCode,
      name: dataset.ward ?? dataset.city,
      prefecture: dataset.pref,
      covered: coverage?.covered ?? false,
      lods: coverage?.lods ?? [],
    };
  }

  return map;
}

/**
 * CoverageMap を coverage.json の JSON 文字列にシリアライズする。
 * 形式: { muniCode: { muniCode, name, prefecture, covered, lods, year? } }
 */
export function generateCoverageJson(coverageMap: CoverageMap): string {
  return JSON.stringify(coverageMap, null, 2);
}