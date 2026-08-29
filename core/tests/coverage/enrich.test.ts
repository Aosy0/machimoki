import { describe, it, expect } from 'vitest';
import {
  buildCoverageMap,
  enrichGeoJsonFeatures,
  generateCoverageJson,
} from '../../src/coverage/index.js';
import type {
  CatalogDataset,
  CoverageMap,
  GeoJsonFeature,
} from '../../src/coverage/index.js';

function makeDataset(overrides: Partial<CatalogDataset> = {}): CatalogDataset {
  return {
    id: '1',
    name: '東京都千代田区建築物モデル',
    pref: '東京都',
    pref_code: '13',
    city: '千代田区',
    city_code: '13101',
    ward: null,
    ward_code: null,
    type: '建築物モデル',
    type_en: 'bldg',
    url: 'https://example.com/tileset.json',
    format: '3D Tiles',
    lod: '1',
    texture: false,
    ...overrides,
  };
}

function makeFeature(muniCode: string): GeoJsonFeature {
  return {
    type: 'Feature',
    geometry: null,
    properties: { N03_007: muniCode },
  };
}

describe('enrichGeoJsonFeatures', () => {
  it('bldg/3D Tiles/LOD1-4 のデータセットに一致する N03_007 に covered=1 を付与する', () => {
    const features = [makeFeature('13101')];
    const catalog = [makeDataset()];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(1);
  });

  it('lods を "lod1,lod2" 形式の文字列で付与する', () => {
    const features = [makeFeature('13101')];
    const catalog = [makeDataset({ lod: '1' }), makeDataset({ id: '2', lod: '2' })];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.lods).toBe('lod1,lod2');
  });

  it('LOD1 のみでも covered になる', () => {
    const features = [makeFeature('13101')];
    const catalog = [makeDataset({ lod: '1' })];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(1);
    expect(result[0].properties?.lods).toBe('lod1');
  });

  it('政令指定都市は区単位（ward_code）で区別し、親市コードでは covered にならない', () => {
    // 横浜市（14100）の鶴見区（14101）のデータセット
    const catalog = [
      makeDataset({
        city: '横浜市',
        city_code: '14100',
        ward: '鶴見区',
        ward_code: '14101',
      }),
    ];

    const features = [makeFeature('14101'), makeFeature('14100')];
    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(1); // 鶴見区
    expect(result[1].properties?.covered).toBe(0); // 横浜市（親市）
  });

  it('ward_code が null の場合は city_code で判定する', () => {
    const catalog = [makeDataset({ city_code: '13101' })];
    const features = [makeFeature('13101')];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(1);
  });

  it('bldg 以外（road 等）は covered にならない', () => {
    const catalog = [makeDataset({ type_en: 'road', type: '道路モデル' })];
    const features = [makeFeature('13101')];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(0);
    expect(result[0].properties?.lods).toBe('');
  });

  it('3D Tiles 以外のフォーマットは covered にならない', () => {
    const catalog = [makeDataset({ format: 'CityGML' })];
    const features = [makeFeature('13101')];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(0);
  });

  it('LOD5 は covered にならない', () => {
    const catalog = [makeDataset({ lod: '5' })];
    const features = [makeFeature('13101')];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(0);
  });

  it('カタログに一致しない N03_007 は covered=0 になる', () => {
    const catalog = [makeDataset()];
    const features = [makeFeature('99999')];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(0);
    expect(result[0].properties?.lods).toBe('');
  });

  it('properties が null の Feature にも covered/lods を付与する', () => {
    const catalog = [makeDataset()];
    const features: GeoJsonFeature[] = [
      { type: 'Feature', geometry: null, properties: null },
    ];

    const result = enrichGeoJsonFeatures(features, catalog);

    expect(result[0].properties?.covered).toBe(0);
    expect(result[0].properties?.lods).toBe('');
  });
});

describe('buildCoverageMap', () => {
  it('カタログの市区町村をキーに CoverageMap を構築する', () => {
    const catalog = [makeDataset()];

    const map = buildCoverageMap(catalog);

    expect(map['13101']).toEqual({
      muniCode: '13101',
      name: '千代田区',
      prefecture: '東京都',
      covered: true,
      lods: [1],
    });
  });

  it('政令指定都市は区単位（ward_code）で区別し、親市へは集約しない', () => {
    const catalog = [
      makeDataset({
        city: '横浜市',
        city_code: '14100',
        ward: '鶴見区',
        ward_code: '14101',
      }),
    ];

    const map = buildCoverageMap(catalog);

    expect(map['14101']).toBeDefined();
    expect(map['14101'].name).toBe('鶴見区');
    expect(map['14100']).toBeUndefined();
  });

  it('bldg 以外のデータセットのみの市区町村は covered=false で含まれる', () => {
    const catalog = [makeDataset({ type_en: 'road', type: '道路モデル' })];

    const map = buildCoverageMap(catalog);

    expect(map['13101']).toBeDefined();
    expect(map['13101'].covered).toBe(false);
    expect(map['13101'].lods).toEqual([]);
  });

  it('同一市区町村に複数LODがあれば lods に集約される', () => {
    const catalog = [makeDataset({ lod: '1' }), makeDataset({ id: '2', lod: '2' })];

    const map = buildCoverageMap(catalog);

    expect(map['13101'].lods).toEqual([1, 2]);
  });
});

describe('generateCoverageJson', () => {
  it('CoverageMap を JSON 文字列にシリアライズする', () => {
    const coverageMap: CoverageMap = {
      '13101': {
        muniCode: '13101',
        name: '千代田区',
        prefecture: '東京都',
        covered: true,
        lods: [1, 2],
      },
    };

    const json = generateCoverageJson(coverageMap);
    const parsed = JSON.parse(json) as CoverageMap;

    expect(parsed['13101']).toEqual({
      muniCode: '13101',
      name: '千代田区',
      prefecture: '東京都',
      covered: true,
      lods: [1, 2],
    });
  });
});