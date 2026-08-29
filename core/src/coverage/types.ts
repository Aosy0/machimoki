/**
 * PLATEAU データカバレッジの型定義。
 */

/**
 * カタログAPIのデータセット項目（カバレッジ判定に必要なフィールドのみ）。
 * core/src/catalog.ts の PlateauDataset と構造的に互換。
 */
export interface CatalogDataset {
  id: string;
  name: string;
  pref: string;
  pref_code: string;
  city: string;
  city_code: string;
  ward: string | null;
  ward_code: string | null;
  type: string;
  type_en: string;
  url: string;
  format: string;
  lod: string;
  texture: boolean;
}

/**
 * 市区町村ごとのカバレッジ情報。
 * - muniCode: 市区町村コード（5桁。政令指定都市は区コード）
 * - name: 市区町村名（区がある場合は区名）
 * - prefecture: 都道府県名
 * - covered: カバレッジ定義を満たすデータセットが存在するか
 * - lods: 利用可能なLOD番号の昇順リスト（例: [1, 2]）
 * - year: データ整備年度（任意）
 */
export interface CoverageInfo {
  muniCode: string;
  name: string;
  prefecture: string;
  covered: boolean;
  lods: number[];
  year?: number;
}

/**
 * 市区町村コードをキーにしたカバレッジマップ。
 */
export type CoverageMap = Record<string, CoverageInfo>;

/**
 * GeoJSON Feature（enrich 対象の最小構造）。
 */
export interface GeoJsonFeature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, unknown> | null;
}