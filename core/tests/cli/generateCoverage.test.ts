import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
}));

import {
  generateCoverage,
  parseArgs,
  normalizeMuniCode,
} from '../../src/cli/generateCoverage.js';

const CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';
const GEOJSON_URL = 'https://example.com/n03.geojson';
const CACHE_FILE = './cache/n03.geojson';
const OUTPUT_DIR = './tmp/coverage';

const catalogDataset = {
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
};

const feature = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [] },
  properties: { N03_001: '東京都', N03_003: '千代田区', N03_007: '13101' },
};

function mockFetchCatalogAndGeoJson(): MockInstance<typeof globalThis.fetch> {
  const fetchMock = vi.mocked(fetch);
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ datasets: [catalogDataset] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }), {
        status: 200,
      }),
    );
  return fetchMock;
}

function mockSpawnClose(code: number): void {
  const child = {
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close') cb(code);
      return child;
    }),
  };
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
}

function mockSpawnError(message: string): void {
  const child = {
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'error') cb(new Error(message));
      return child;
    }),
  };
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
}

function mockTilesWalk(): void {
  vi.mocked(readdir).mockImplementation(async (path) => {
    const p = String(path).replace(/\\/g, '/');
    if (p.endsWith('tiles')) {
      return [{ name: '4', isDirectory: () => true, isFile: () => false }] as unknown as Dirent[];
    }
    if (p.endsWith('tiles/4')) {
      return [{ name: '5', isDirectory: () => true, isFile: () => false }] as unknown as Dirent[];
    }
    if (p.endsWith('tiles/4/5')) {
      return [{ name: '6.pbf', isDirectory: () => false, isFile: () => true }] as unknown as Dirent[];
    }
    return [];
  });
}

function findWrite(pathSuffix: string): [string, string] | undefined {
  const call = vi
    .mocked(writeFile)
    .mock.calls.find(([p]) => String(p).endsWith(pathSuffix));
  if (!call) return undefined;
  return [String(call[0]), String(call[1])];
}

describe('generateCoverage CLI', () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('');
    vi.mocked(readdir).mockResolvedValue([]);
    vi.mocked(S3Client).mockImplementation(
      (() => ({ send: vi.fn().mockResolvedValue({}) })) as unknown as typeof S3Client,
    );
    vi.mocked(PutObjectCommand).mockImplementation(
      ((input: unknown) => input) as unknown as typeof PutObjectCommand,
    );
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('カタログ→enrich→tippecanoe→coverage.json→R2 upload の一連を実行する', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'machimoki-coverage';

    mockFetchCatalogAndGeoJson();
    mockSpawnClose(0);
    mockTilesWalk();
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.pbf')) return new Uint8Array([1, 2, 3]);
      return '';
    });

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    // fetch: カタログ + GeoJSON
    expect(fetch).toHaveBeenCalledWith(CATALOG_URL);
    expect(fetch).toHaveBeenCalledWith(GEOJSON_URL);

    // enriched.geojson に covered/lods が付与される
    const enrichedWrite = findWrite('enriched.geojson');
    expect(enrichedWrite).toBeDefined();
    const enriched = JSON.parse(enrichedWrite![1]) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(enriched.features[0].properties.covered).toBe(1);
    expect(enriched.features[0].properties.lods).toBe('lod1');

    // tippecanoe に -y covered -y lods -y N03_007 が付与される
    expect(spawn).toHaveBeenCalledWith(
      'tippecanoe',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('tiles'),
        '-Z4',
        '-z10',
        '-l',
        'coverage',
        '--no-tile-compression',
        '-y',
        'covered',
        '-y',
        'lods',
        '-y',
        'N03_007',
        '-f',
      ]),
      { stdio: 'inherit' },
    );

    // coverage.json に meta が含まれる
    const coverageWrite = findWrite('coverage.json');
    expect(coverageWrite).toBeDefined();
    const coverage = JSON.parse(coverageWrite![1]) as {
      '13101': { covered: boolean; lods: number[] };
      meta: { source: string; generatedAt: string; coverageDefinition: unknown };
    };
    expect(coverage['13101'].covered).toBe(true);
    expect(coverage['13101'].lods).toEqual([1]);
    expect(coverage.meta.source).toBe(GEOJSON_URL);
    expect(coverage.meta.generatedAt).toBeTruthy();
    expect(coverage.meta.coverageDefinition).toBeDefined();

    // R2 upload: tiles/{z}/{x}/{y}.pbf と coverage.json
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://acct.r2.cloudflarestorage.com',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      }),
    );
    const putCalls = vi.mocked(PutObjectCommand).mock.calls;
    const keys = putCalls.map(([input]) => (input as { Key: string }).Key);
    expect(keys).toContain('tiles/4/5/6.pbf');
    expect(keys).toContain('coverage.json');

    expect(result.tilesGenerated).toBe(true);
    expect(result.uploaded).toBe(2);
    expect(result.featureCount).toBe(1);
  });

  it('GeoJSON取得失敗時はキャッシュファイルから読み込む', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ datasets: [catalogDataset] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('error', { status: 500 }));
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('n03.geojson')) {
        return JSON.stringify({ type: 'FeatureCollection', features: [feature] });
      }
      return '';
    });
    mockSpawnClose(0);

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(result.featureCount).toBe(1);
    const enrichedWrite = findWrite('enriched.geojson');
    const enriched = JSON.parse(enrichedWrite![1]) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(enriched.features[0].properties.covered).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('キャッシュ'));
  });

  it('tippecanoeが無い場合は警告して続行し coverage.json を生成する', async () => {
    mockFetchCatalogAndGeoJson();
    mockSpawnError('spawn tippecanoe ENOENT');

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(result.tilesGenerated).toBe(false);
    const coverageWrite = findWrite('coverage.json');
    expect(coverageWrite).toBeDefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tippecanoe'));
  });

  it('R2環境変数が未設定の場合はアップロードをスキップする', async () => {
    mockFetchCatalogAndGeoJson();
    mockSpawnClose(0);

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(S3Client).not.toHaveBeenCalled();
    expect(result.uploaded).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('スキップ'));
  });

  it('政令指定都市は区単位（ward_code）で CoverageMap に含まれる', async () => {
    const wardDataset = {
      ...catalogDataset,
      city: '横浜市',
      city_code: '14100',
      ward: '鶴見区',
      ward_code: '14101',
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ datasets: [wardDataset] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: 'FeatureCollection', features: [feature] }), {
          status: 200,
        }),
      );
    mockSpawnClose(0);

    await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    const coverageWrite = findWrite('coverage.json');
    const coverage = JSON.parse(coverageWrite![1]) as Record<string, unknown>;
    expect(coverage['14101']).toBeDefined();
    expect((coverage['14101'] as { name: string }).name).toBe('鶴見区');
    expect(coverage['14100']).toBeUndefined();
  });

  it('N03_007 が数値の場合は5桁に正規化して enrich する', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ datasets: [catalogDataset] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [{ ...feature, properties: { N03_007: 1101 } }],
          }),
          { status: 200 },
        ),
      );
    mockSpawnClose(0);

    await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    const enrichedWrite = findWrite('enriched.geojson');
    const enriched = JSON.parse(enrichedWrite![1]) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(enriched.features[0].properties.N03_007).toBe('01101');
  });
});

describe('parseArgs', () => {
  it('デフォルト値を返す', () => {
    const options = parseArgs(['node', 'generateCoverage.ts']);
    expect(options.outputDir).toBe('./tmp/coverage');
    expect(options.geojsonUrl).toContain('smartnews-smri');
    expect(options.cacheFile).toBe('./cache/n03.geojson');
    expect(options.concurrency).toBe(20);
  });

  it('引数で上書きできる', () => {
    const options = parseArgs([
      'node',
      'generateCoverage.ts',
      '--output-dir',
      '/tmp/out',
      '--geojson-url',
      'https://x/y.json',
      '--cache-file',
      '/tmp/cache.json',
      '--concurrency',
      '5',
    ]);
    expect(options.outputDir).toBe('/tmp/out');
    expect(options.geojsonUrl).toBe('https://x/y.json');
    expect(options.cacheFile).toBe('/tmp/cache.json');
    expect(options.concurrency).toBe(5);
  });
});

describe('normalizeMuniCode', () => {
  it('5桁の文字列はそのまま返す', () => {
    expect(normalizeMuniCode('13101')).toBe('13101');
  });

  it('数値・短い文字列は先頭ゼロ埋めする', () => {
    expect(normalizeMuniCode(1101)).toBe('01101');
    expect(normalizeMuniCode('1101')).toBe('01101');
  });

  it('不正な値は null を返す', () => {
    expect(normalizeMuniCode('abc')).toBeNull();
    expect(normalizeMuniCode('123456')).toBeNull();
    expect(normalizeMuniCode(null)).toBeNull();
    expect(normalizeMuniCode(undefined)).toBeNull();
  });
});