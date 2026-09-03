import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
  DeleteObjectCommand: vi.fn(),
}));

import {
  generateCoverage,
  parseArgs,
  normalizeMuniCode,
  computeDiff,
  computeInputHash,
  readManifest,
  writeManifest,
  sha256Hex,
  CODE_VERSION,
  type CoverageManifest,
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

function makeFeature(): typeof feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [] },
    properties: { N03_001: '東京都', N03_003: '千代田区', N03_007: '13101' },
  };
}

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
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close') cb(code);
      return child;
    }),
  };
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
}

function mockSpawnCloseWithStderr(code: number, lines: string[]): void {
  const child = {
    stdout: { on: vi.fn() },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') {
          for (const line of lines) cb(Buffer.from(`${line}\n`));
        }
        return child.stderr;
      }),
    },
    on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close') cb(code);
      return child;
    }),
  };
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
}

function mockSpawnError(message: string): void {
  const child = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
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
    vi.mocked(DeleteObjectCommand).mockImplementation(
      ((input: unknown) => input) as unknown as typeof DeleteObjectCommand,
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

    // enriched.geojson に covered/lods/maxLod が付与される
    const enrichedWrite = findWrite('enriched.geojson');
    expect(enrichedWrite).toBeDefined();
    const enriched = JSON.parse(enrichedWrite![1]) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(enriched.features[0].properties.covered).toBe(1);
    expect(enriched.features[0].properties.lods).toBe('lod1');
    expect(enriched.features[0].properties.maxLod).toBe(1);

    // tippecanoe に -y covered -y lods -y maxLod -y N03_007 が付与される
    // （--no-tile-compression は外し gzip 圧縮を有効化）
    expect(spawn).toHaveBeenCalledWith(
      'tippecanoe',
      expect.arrayContaining([
        '-e',
        expect.stringContaining('tiles'),
        '-Z4',
        '-z14',
        '-l',
        'coverage',
        '-y',
        'covered',
        '-y',
        'lods',
        '-y',
        'maxLod',
        '-y',
        'N03_007',
        '-f',
      ]),
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(spawn).not.toHaveBeenCalledWith(
      'tippecanoe',
      expect.arrayContaining(['--no-tile-compression']),
      expect.anything(),
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

  it('tippecanoe失敗時は出力の末尾30行のみ表示する', async () => {
    mockFetchCatalogAndGeoJson();
    const lines = Array.from({ length: 40 }, (_, i) => `tippecanoe line ${i}`);
    mockSpawnCloseWithStderr(1, lines);

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(result.tilesGenerated).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('終了コード 1'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tippecanoe line 10'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('tippecanoe line 0'));
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

  it('入力不変・タイル実在なら2回目以降は生成とアップロードをスキップする', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'machimoki-coverage';

    // 1回目: マニフェスト無し → 全量生成・アップロード
    mockFetchCatalogAndGeoJson();
    mockSpawnClose(0);
    mockTilesWalk();
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('.pbf')) return new Uint8Array([1, 2, 3]);
      return '';
    });
    const first = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });
    expect(first.generationSkipped).toBe(false);
    expect(first.putCount).toBe(2);

    const manifestWrite = findWrite('manifest.json');
    expect(manifestWrite).toBeDefined();
    const manifestJson = String(manifestWrite![1]);

    // 2回目: 入力不変・タイル実在 → スキップ
    mockFetchCatalogAndGeoJson();
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('manifest.json')) return manifestJson;
      if (String(path).endsWith('.pbf')) return new Uint8Array([1, 2, 3]);
      return '';
    });
    const second = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(second.generationSkipped).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(S3Client).toHaveBeenCalledTimes(1);
    expect(second.putCount).toBe(0);
    expect(second.deleteCount).toBe(0);
    expect(second.skipCount).toBe(2);
  });

  it('入力が変わると差分のみPUTし、消滅分はDELETEする', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'machimoki-coverage';

    mockFetchCatalogAndGeoJson();
    mockSpawnClose(0);
    mockTilesWalk();
    const manifest: CoverageManifest = {
      version: 1,
      codeVersion: CODE_VERSION,
      inputHash: 'stale-input-hash',
      generatedAt: '2026-09-02T00:00:00.000Z',
      files: {
        'tiles/4/5/6.pbf': 'old-hash',
        'tiles/4/5/7.pbf': 'deleted-hash',
        'coverage.json': 'old-coverage-hash',
      },
    };
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('manifest.json')) return JSON.stringify(manifest);
      if (String(path).endsWith('.pbf')) return new Uint8Array([1, 2, 3]);
      return '';
    });

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    const putKeys = vi
      .mocked(PutObjectCommand)
      .mock.calls.map(([input]) => (input as { Key: string }).Key);
    expect(putKeys).toContain('tiles/4/5/6.pbf');
    expect(putKeys).toContain('coverage.json');
    expect(putKeys).not.toContain('tiles/4/5/7.pbf');

    const deleteKeys = vi
      .mocked(DeleteObjectCommand)
      .mock.calls.map(([input]) => (input as { Key: string }).Key);
    expect(deleteKeys).toEqual(['tiles/4/5/7.pbf']);

    expect(result.generationSkipped).toBe(false);
    expect(result.putCount).toBe(2);
    expect(result.deleteCount).toBe(1);
    expect(result.skipCount).toBe(0);

    // 新マニフェストには消滅分が含まれない
    const manifestWrite = findWrite('manifest.json');
    expect(manifestWrite).toBeDefined();
    const newManifest = JSON.parse(String(manifestWrite![1])) as {
      files: Record<string, string>;
    };
    expect(newManifest.files['tiles/4/5/7.pbf']).toBeUndefined();
    expect(newManifest.files['tiles/4/5/6.pbf']).toBeDefined();
  });

  it('CODE_VERSIONが変わると入力不変でも再生成する', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET = 'machimoki-coverage';

    mockFetchCatalogAndGeoJson();
    mockSpawnClose(0);
    mockTilesWalk();
    const manifest: CoverageManifest = {
      version: 1,
      codeVersion: 'old-code-version',
      inputHash: computeInputHash([catalogDataset], [makeFeature()]),
      generatedAt: '2026-09-02T00:00:00.000Z',
      files: { 'tiles/4/5/6.pbf': 'h1', 'coverage.json': 'h2' },
    };
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path).endsWith('manifest.json')) return JSON.stringify(manifest);
      if (String(path).endsWith('.pbf')) return new Uint8Array([1, 2, 3]);
      return '';
    });

    const result = await generateCoverage({
      outputDir: OUTPUT_DIR,
      geojsonUrl: GEOJSON_URL,
      cacheFile: CACHE_FILE,
    });

    expect(result.generationSkipped).toBe(false);
    expect(spawn).toHaveBeenCalled();
    expect(result.putCount).toBe(2);
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

describe('computeDiff', () => {
  it('新規・変更を toPut、消滅を toDelete に分類する', () => {
    const diff = computeDiff(
      { 'a.pbf': 'h1', 'b.pbf': 'h2', 'c.pbf': 'h3' },
      { 'a.pbf': 'h1', 'b.pbf': 'h2-changed', 'd.pbf': 'h4' },
    );
    expect(diff.toPut).toEqual(['b.pbf', 'd.pbf']);
    expect(diff.toDelete).toEqual(['c.pbf']);
    expect(diff.skipped).toBe(1);
  });

  it('完全一致なら toPut/toDelete が空になる', () => {
    const diff = computeDiff({ 'a.pbf': 'h1' }, { 'a.pbf': 'h1' });
    expect(diff.toPut).toEqual([]);
    expect(diff.toDelete).toEqual([]);
    expect(diff.skipped).toBe(1);
  });

  it('前回マニフェストが無い場合は全件 toPut になる', () => {
    const diff = computeDiff({}, { 'a.pbf': 'h1', 'b.pbf': 'h2' });
    expect(diff.toPut).toEqual(['a.pbf', 'b.pbf']);
    expect(diff.toDelete).toEqual([]);
    expect(diff.skipped).toBe(0);
  });
});

describe('manifest round-trip', () => {
  it('writeManifest → readManifest で同一のマニフェストが復元できる', async () => {
    const manifest: CoverageManifest = {
      version: 1,
      codeVersion: CODE_VERSION,
      inputHash: 'abc123',
      generatedAt: '2026-09-03T00:00:00.000Z',
      files: { 'tiles/4/5/6.pbf': 'hash1', 'coverage.json': 'hash2' },
    };
    await writeManifest('/tmp/coverage/manifest.json', manifest);

    const writeCall = vi
      .mocked(writeFile)
      .mock.calls.find(([p]) => String(p).endsWith('manifest.json'));
    expect(writeCall).toBeDefined();
    expect(JSON.parse(String(writeCall![1]))).toEqual(manifest);

    vi.mocked(readFile).mockResolvedValueOnce(String(writeCall![1]));
    const read = await readManifest('/tmp/coverage/manifest.json');
    expect(read).toEqual(manifest);
  });

  it('マニフェストが無い・壊れている場合は null を返す', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('');
    expect(await readManifest('/tmp/coverage/manifest.json')).toBeNull();

    vi.mocked(readFile).mockResolvedValueOnce('not json');
    expect(await readManifest('/tmp/coverage/manifest.json')).toBeNull();

    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ version: 1, codeVersion: 'v', inputHash: 'h', files: 'invalid' }),
    );
    expect(await readManifest('/tmp/coverage/manifest.json')).toBeNull();
  });
});

describe('sha256Hex / computeInputHash', () => {
  it('sha256Hex はSHA-256の16進文字列を返す', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(sha256Hex('abc'));
  });

  it('computeInputHash は入力が変わると変化する', () => {
    const f = makeFeature();
    const h1 = computeInputHash([catalogDataset], [f]);
    const h2 = computeInputHash([{ ...catalogDataset, lod: '2' }], [f]);
    const h3 = computeInputHash([catalogDataset], [
      { ...f, properties: { ...f.properties, N03_007: '13102' } },
    ]);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).not.toBe(h1);
    expect(h3).not.toBe(h1);
  });
});