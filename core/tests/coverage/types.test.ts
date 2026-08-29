import { describe, it, expect, expectTypeOf } from 'vitest';
import type { CoverageInfo, CoverageMap } from '../../src/coverage/index.js';

describe('coverage types', () => {
  it('CoverageInfo は muniCode/name/prefecture/covered/lods を持つ', () => {
    const info: CoverageInfo = {
      muniCode: '13101',
      name: '千代田区',
      prefecture: '東京都',
      covered: true,
      lods: [1, 2],
    };
    expect(info.muniCode).toBe('13101');
    expect(info.name).toBe('千代田区');
    expect(info.prefecture).toBe('東京都');
    expect(info.covered).toBe(true);
    expect(info.lods).toEqual([1, 2]);
  });

  it('year は省略可能', () => {
    const withYear: CoverageInfo = {
      muniCode: '13101',
      name: '千代田区',
      prefecture: '東京都',
      covered: true,
      lods: [1],
      year: 2023,
    };
    expect(withYear.year).toBe(2023);
  });

  it('CoverageMap は市区町村コードをキーにする', () => {
    const map: CoverageMap = {
      '13101': {
        muniCode: '13101',
        name: '千代田区',
        prefecture: '東京都',
        covered: true,
        lods: [1, 2],
      },
    };
    expect(map['13101'].name).toBe('千代田区');
  });

  it('型レベル: lods は number[]、covered は boolean、year は number | undefined', () => {
    expectTypeOf<CoverageInfo['lods']>().toEqualTypeOf<number[]>();
    expectTypeOf<CoverageInfo['covered']>().toEqualTypeOf<boolean>();
    expectTypeOf<CoverageInfo['year']>().toEqualTypeOf<number | undefined>();
  });
});