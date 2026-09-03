import { describe, it, expect } from 'vitest';
import {
  aggregateMeshCoverageByCity,
  aggregateMeshCoverageByLod,
  extractMeshCodes,
  isValidMeshCode,
  matchMeshCoverage,
  meshLevel,
  normalizeMaxLod,
  normalizeMeshCode,
} from '../../src/coverage/index.js';
import type {
  CityGmlBldgFile,
  CityGmlCity,
  CityGmlResponse,
  CoverageMap,
} from '../../src/coverage/index.js';

function bldg(code: unknown, maxLod?: unknown): CityGmlBldgFile {
  return maxLod === undefined ? { code } : { code, maxLod };
}

function city(
  prefCode: string,
  cityCode: string,
  files: CityGmlBldgFile[],
  id?: string,
): CityGmlCity {
  return { id, pref_code: prefCode, city_code: cityCode, files: { bldg: files } };
}

function response(cities: CityGmlCity[]): CityGmlResponse {
  return { cities };
}

describe('normalizeMeshCode', () => {
  it('2次メッシュ（6桁）を正規化する', () => {
    expect(normalizeMeshCode('533945')).toBe('533945');
  });

  it('3次メッシュ（8桁）を正規化する', () => {
    expect(normalizeMeshCode('53394535')).toBe('53394535');
  });

  it('9桁・10桁のメッシュコードを正規化する', () => {
    expect(normalizeMeshCode('533945351')).toBe('533945351');
    expect(normalizeMeshCode('5339453512')).toBe('5339453512');
  });

  it('数値のメッシュコードを文字列に正規化する', () => {
    expect(normalizeMeshCode(53394535)).toBe('53394535');
  });

  it('前後空白を除去して正規化する', () => {
    expect(normalizeMeshCode('  53394535  ')).toBe('53394535');
  });

  it('桁数が不正なコードは null を返す', () => {
    expect(normalizeMeshCode('5339')).toBeNull(); // 1次（4桁）
    expect(normalizeMeshCode('5339453')).toBeNull(); // 7桁
    expect(normalizeMeshCode('53394535123')).toBeNull(); // 11桁
  });

  it('数字以外を含むコードは null を返す', () => {
    expect(normalizeMeshCode('5339453a')).toBeNull();
    expect(normalizeMeshCode('abc')).toBeNull();
  });

  it('null / undefined / 非数値は null を返す', () => {
    expect(normalizeMeshCode(null)).toBeNull();
    expect(normalizeMeshCode(undefined)).toBeNull();
    expect(normalizeMeshCode({})).toBeNull();
    expect(normalizeMeshCode(3.14)).toBeNull();
    expect(normalizeMeshCode(-53394535)).toBeNull();
  });
});

describe('isValidMeshCode', () => {
  it('6桁・8桁・9桁・10桁の数字のみを受理する', () => {
    expect(isValidMeshCode('533945')).toBe(true);
    expect(isValidMeshCode('53394535')).toBe(true);
    expect(isValidMeshCode('533945351')).toBe(true);
    expect(isValidMeshCode('5339453512')).toBe(true);
  });

  it('不正な形式は false を返す', () => {
    expect(isValidMeshCode('5339')).toBe(false);
    expect(isValidMeshCode('5339453')).toBe(false);
    expect(isValidMeshCode('abc')).toBe(false);
    expect(isValidMeshCode('')).toBe(false);
  });
});

describe('meshLevel', () => {
  it('桁数に応じてメッシュレベルを返す', () => {
    expect(meshLevel('533945')).toBe('secondary');
    expect(meshLevel('53394535')).toBe('tertiary');
    expect(meshLevel('533945351')).toBe('quaternary');
    expect(meshLevel('5339453512')).toBe('quaternary');
  });

  it('不正な形式は null を返す', () => {
    expect(meshLevel('5339')).toBeNull();
  });
});

describe('normalizeMaxLod', () => {
  it('数値・数字文字列の maxLod を正規化する', () => {
    expect(normalizeMaxLod(2)).toBe(2);
    expect(normalizeMaxLod('2')).toBe(2);
    expect(normalizeMaxLod(0)).toBe(0);
  });

  it('不正な maxLod は null を返す', () => {
    expect(normalizeMaxLod(null)).toBeNull();
    expect(normalizeMaxLod(undefined)).toBeNull();
    expect(normalizeMaxLod('lod2')).toBeNull();
    expect(normalizeMaxLod(-1)).toBeNull();
    expect(normalizeMaxLod(2.5)).toBeNull();
  });
});

describe('extractMeshCodes', () => {
  it('files.bldg[].code からメッシュコードの Set を抽出する', () => {
    const res = response([
      city('13', '13104', [bldg('53394535'), bldg('53394536')]),
      city('13', '13114', [bldg('53394537')]),
    ]);

    const codes = extractMeshCodes(res);

    expect(codes).toEqual(new Set(['53394535', '53394536', '53394537']));
  });

  it('重複コードは Set に集約される', () => {
    const res = response([
      city('13', '13104', [bldg('53394535'), bldg('53394535')]),
    ]);

    expect(extractMeshCodes(res)).toEqual(new Set(['53394535']));
  });

  it('空の応答は空の Set を返す', () => {
    expect(extractMeshCodes(response([]))).toEqual(new Set());
    expect(extractMeshCodes({})).toEqual(new Set());
  });

  it('不正な code はスキップされる', () => {
    const res = response([
      city('13', '13104', [bldg('53394535'), bldg('abc'), bldg(12345), bldg(null)]),
    ]);

    expect(extractMeshCodes(res)).toEqual(new Set(['53394535']));
  });

  it('maxLod の有無・混在はコード抽出に影響しない', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 1), bldg('53394536', '2'), bldg('53394537')]),
    ]);

    expect(extractMeshCodes(res)).toEqual(
      new Set(['53394535', '53394536', '53394537']),
    );
  });
});

describe('aggregateMeshCoverageByCity', () => {
  it('自治体ごとにメッシュコードと maxLod を集計する', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2), bldg('53394536', 1)]),
      city('13', '13114', [bldg('53394537', 2)]),
    ]);

    const result = aggregateMeshCoverageByCity(res);

    expect(result).toHaveLength(2);
    const shinjuku = result.find((c) => c.cityCode === '13104');
    const nakano = result.find((c) => c.cityCode === '13114');
    expect(shinjuku?.prefCode).toBe('13');
    expect(shinjuku?.meshCodes).toEqual(new Set(['53394535', '53394536']));
    expect(shinjuku?.maxLods).toEqual([1, 2]);
    expect(nakano?.meshCodes).toEqual(new Set(['53394537']));
    expect(nakano?.maxLods).toEqual([2]);
  });

  it('同一自治体の複数 city エントリはマージされる', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2)]),
      city('13', '13104', [bldg('53394536', 1)]),
    ]);

    const result = aggregateMeshCoverageByCity(res);

    expect(result).toHaveLength(1);
    expect(result[0].meshCodes).toEqual(new Set(['53394535', '53394536']));
    expect(result[0].maxLods).toEqual([1, 2]);
  });

  it('maxLod の重複は除去され昇順に整列される', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2), bldg('53394536', 2), bldg('53394537', 1)]),
    ]);

    const result = aggregateMeshCoverageByCity(res);

    expect(result[0].maxLods).toEqual([1, 2]);
  });

  it('不正な code はスキップされ、不正な maxLod も集計に含めない', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2), bldg('abc', 2), bldg('53394536', 'lod2')]),
    ]);

    const result = aggregateMeshCoverageByCity(res);

    // code が有効な '53394536' は meshCodes に含まれ、不正な maxLod のみ除外される
    expect(result[0].meshCodes).toEqual(new Set(['53394535', '53394536']));
    expect(result[0].maxLods).toEqual([2]);
  });

  it('空の応答は空配列を返す', () => {
    expect(aggregateMeshCoverageByCity(response([]))).toEqual([]);
  });
});

describe('aggregateMeshCoverageByLod', () => {
  it('maxLod ごとにメッシュコードを集計する', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2), bldg('53394536', 1)]),
      city('13', '13114', [bldg('53394537', 2)]),
    ]);

    const result = aggregateMeshCoverageByLod(res);

    expect(result.get(1)).toEqual(new Set(['53394536']));
    expect(result.get(2)).toEqual(new Set(['53394535', '53394537']));
  });

  it('maxLod が欠落・不正のエントリは含めない', () => {
    const res = response([
      city('13', '13104', [bldg('53394535', 2), bldg('53394536', undefined), bldg('53394537', 'lod2')]),
    ]);

    const result = aggregateMeshCoverageByLod(res);

    expect(result.get(2)).toEqual(new Set(['53394535']));
    expect(result.size).toBe(1);
  });

  it('空の応答は空の Map を返す', () => {
    expect(aggregateMeshCoverageByLod(response([])).size).toBe(0);
  });
});

describe('matchMeshCoverage', () => {
  const coverageMap: CoverageMap = {
    '13104': {
      muniCode: '13104',
      name: '新宿区',
      prefecture: '東京都',
      covered: true,
      lods: [1, 2],
    },
    '13114': {
      muniCode: '13114',
      name: '中野区',
      prefecture: '東京都',
      covered: false,
      lods: [],
    },
  };

  const meshToMuni = new Map<string, string>([
    ['53394535', '13104'],
    ['53394536', '13114'],
  ]);

  it('メッシュ→muniCode 解決とカバレッジマップを突合する', () => {
    const result = matchMeshCoverage(
      new Set(['53394535', '53394536']),
      meshToMuni,
      coverageMap,
    );

    expect(result).toEqual([
      { meshCode: '53394535', muniCode: '13104', covered: true, lods: [1, 2] },
      { meshCode: '53394536', muniCode: '13114', covered: false, lods: [] },
    ]);
  });

  it('muniCode に解決できないメッシュは covered=false になる', () => {
    const result = matchMeshCoverage(
      new Set(['99999999']),
      meshToMuni,
      coverageMap,
    );

    expect(result).toEqual([
      { meshCode: '99999999', muniCode: null, covered: false, lods: [] },
    ]);
  });

  it('空のメッシュ集合は空配列を返す', () => {
    expect(matchMeshCoverage(new Set(), meshToMuni, coverageMap)).toEqual([]);
  });
});