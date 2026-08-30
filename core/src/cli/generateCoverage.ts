/**
 * generateCoverage CLI
 *
 * PLATEAUカタログ + N03 GeoJSON からカバレッジMVTタイルと coverage.json を生成し、
 * R2（S3互換）へアップロードする。自宅サーバーのcron（03:00 JST）で実行する。
 *
 * カバレッジ定義:
 *   type_en === 'bldg'（建築物モデル）かつ
 *   format === '3D Tiles' かつ
 *   lod が '1' | '2' | '3' | '4' のいずれか
 * を満たすデータセットが存在する市区町村のみ covered とする。
 * LOD1 でも covered。road / railway / dem 等の他地物型は対象外。
 *
 * Usage:
 *   npx tsx core/src/cli/generateCoverage.ts --output-dir ./tmp/coverage
 *
 * R2アップロードに必要な環境変数（未設定ならアップロードをスキップ）:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (default: machimoki-coverage)
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  buildCoverageMap,
  enrichGeoJsonFeatures,
  generateCoverageJson,
} from '../coverage/index.js';
import type {
  CatalogDataset,
  CoverageMap,
  GeoJsonFeature,
} from '../coverage/index.js';

const DEFAULT_CATALOG_URL =
  'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';
const DEFAULT_GEOJSON_URL =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_210101.json';
const DEFAULT_OUTPUT_DIR = './tmp/coverage';
const DEFAULT_CACHE_FILE = './cache/n03.geojson';
const DEFAULT_CONCURRENCY = 20;

const MVT_CONTENT_TYPE = 'application/vnd.mapbox-vector-tile';
const JSON_CONTENT_TYPE = 'application/json';

/**
 * coverage.json の meta.coverageDefinition に記載するカバレッジ定義。
 * enrich.ts の isCoveredDataset と同一の定義を明文化する。
 */
const COVERAGE_DEFINITION = {
  type_en: 'bldg',
  format: '3D Tiles',
  lods: ['1', '2', '3', '4'],
  note: '建築物モデル（bldg）かつ3D TilesかつLOD1-4のみをcoveredとする。LOD1でもcovered。road/railway/dem等の他地物型は対象外。',
} as const;

export interface GenerateCoverageOptions {
  outputDir: string;
  geojsonUrl: string;
  cacheFile: string;
  catalogUrl?: string;
  concurrency?: number;
}

export interface GenerateCoverageResult {
  coverageMap: CoverageMap;
  featureCount: number;
  tilesGenerated: boolean;
  uploaded: number;
  source: string;
}

export function parseArgs(argv: string[]): GenerateCoverageOptions {
  const program = new Command();
  program
    .name('generate-coverage')
    .description('PLATEAUカバレッジのMVTタイルとcoverage.jsonを生成しR2へアップロードする')
    .option('--output-dir <dir>', '出力ディレクトリ', DEFAULT_OUTPUT_DIR)
    .option('--geojson-url <url>', 'N03 GeoJSONのURL', DEFAULT_GEOJSON_URL)
    .option('--cache-file <file>', 'N03 GeoJSONのキャッシュファイル', DEFAULT_CACHE_FILE)
    .option('--catalog-url <url>', 'PLATEAUカタログAPIのURL', DEFAULT_CATALOG_URL)
    .option('--concurrency <number>', 'R2アップロードの並列数', (value) => {
      const num = Number(value);
      if (Number.isNaN(num) || num <= 0) {
        throw new Error(`Invalid concurrency: ${value}`);
      }
      return num;
    }, DEFAULT_CONCURRENCY);
  program.parse(argv);

  const opts = program.opts<{
    outputDir: string;
    geojsonUrl: string;
    cacheFile: string;
    catalogUrl: string;
    concurrency: number;
  }>();

  return {
    outputDir: opts.outputDir,
    geojsonUrl: opts.geojsonUrl,
    cacheFile: opts.cacheFile,
    catalogUrl: opts.catalogUrl,
    concurrency: opts.concurrency,
  };
}

/**
 * N03_007 を5桁の市区町村コードに正規化する。
 * 数値（例: 1101）や4桁文字列は先頭ゼロ埋めし、5桁以外は null を返す。
 */
export function normalizeMuniCode(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    const str = String(value);
    return str.length <= 5 ? str.padStart(5, '0') : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{5}$/.test(trimmed)) return trimmed;
    if (/^\d{1,4}$/.test(trimmed)) return trimmed.padStart(5, '0');
    return null;
  }
  return null;
}

async function fetchCatalog(catalogUrl: string): Promise<CatalogDataset[]> {
  const res = await fetch(catalogUrl);
  if (!res.ok) throw new Error(`カタログAPI失敗: ${res.status}`);
  const data = (await res.json()) as { datasets?: unknown };
  if (!Array.isArray(data.datasets)) {
    throw new Error('カタログAPIの応答にdatasetsがありません');
  }
  return data.datasets as CatalogDataset[];
}

/**
 * N03 GeoJSON を取得する。取得に失敗した場合は --cache-file から読み込む。
 * 取得に成功した場合はキャッシュを更新する。
 */
async function fetchGeoJson(
  url: string,
  cacheFile: string,
): Promise<GeoJsonFeature[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GeoJSON取得失敗: ${res.status}`);
    const data = (await res.json()) as { type?: string; features?: unknown };
    if (!Array.isArray(data.features)) {
      throw new Error('GeoJSONの応答にfeaturesがありません');
    }
    const features = data.features as GeoJsonFeature[];

    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({ type: 'FeatureCollection', features }));
    return features;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: N03 GeoJSONの取得に失敗したためキャッシュを使用します: ${message}`);
    const cached = await readFile(cacheFile, 'utf8');
    const data = JSON.parse(cached) as { type?: string; features?: unknown };
    if (!Array.isArray(data.features)) {
      throw new Error('キャッシュのGeoJSONにfeaturesがありません');
    }
    return data.features as GeoJsonFeature[];
  }
}

/**
 * tippecanoe で enriched.geojson から MVT タイルを生成する。
 * tippecanoe が無い・失敗した場合は警告して false を返す（coverage.json 生成は続行）。
 */
function runTippecanoe(enrichedPath: string, tilesDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      'tippecanoe',
      [
        '-e',
        tilesDir,
        '-Z4',
        '-z14',
        '-l',
        'coverage',
        '--no-tile-compression',
        '--drop-densest-as-needed',
        '-y',
        'covered',
        '-y',
        'lods',
        '-y',
        'N03_007',
        '-f',
        enrichedPath,
      ],
      { stdio: 'inherit' },
    );

    child.on('error', (error) => {
      console.error(`Warning: tippecanoe を実行できませんでした: ${error.message}`);
      resolve(false);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        console.error(`Warning: tippecanoe が終了コード ${code} で失敗しました`);
        resolve(false);
      }
    });
  });
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function getR2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket: process.env.R2_BUCKET ?? 'machimoki-coverage',
  };
}

function createS3Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

interface UploadEntry {
  key: string;
  body: Uint8Array;
  contentType: string;
}

async function uploadWithConcurrency(
  client: S3Client,
  bucket: string,
  entries: UploadEntry[],
  concurrency: number,
): Promise<number> {
  let index = 0;
  let uploaded = 0;
  const workerCount = Math.max(1, Math.min(concurrency, entries.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < entries.length) {
      const entry = entries[index];
      index += 1;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: entry.key,
          Body: entry.body,
          ContentType: entry.contentType,
        }),
      );
      uploaded += 1;
    }
  });

  await Promise.all(workers);
  return uploaded;
}

async function collectPbfFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.pbf')) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

/**
 * カバレッジ生成のオーケストレーション。
 * 1. カタログ取得 → CoverageMap 生成（ward_code ?? city_code、区/市を区別）
 * 2. N03 GeoJSON 取得（失敗時キャッシュ）
 * 3. N03_007 正規化 + enrichGeoJsonFeatures
 * 4. enriched.geojson 書き出し
 * 5. tippecanoe で MVT タイル生成（失敗時は警告して続行）
 * 6. coverage.json 生成（meta: source, generatedAt, coverageDefinition）
 * 7. R2 へ tiles/{z}/{x}/{y}.pbf と coverage.json をアップロード（concurrency 20）
 */
export async function generateCoverage(
  options: GenerateCoverageOptions,
): Promise<GenerateCoverageResult> {
  const {
    outputDir,
    geojsonUrl,
    cacheFile,
    catalogUrl = DEFAULT_CATALOG_URL,
    concurrency = DEFAULT_CONCURRENCY,
  } = options;

  // 1. カタログ取得 → CoverageMap
  console.error('カタログを取得中...');
  const catalog = await fetchCatalog(catalogUrl);
  const coverageMap = buildCoverageMap(catalog);
  console.error(
    `カタログ: ${catalog.length} データセット, ${Object.keys(coverageMap).length} 市区町村`,
  );

  // 2. N03 GeoJSON 取得（失敗時キャッシュ）
  console.error('N03 GeoJSONを取得中...');
  const features = await fetchGeoJson(geojsonUrl, cacheFile);
  console.error(`N03 GeoJSON: ${features.length} フィーチャ`);

  // 3. N03_007 正規化 + enrich
  for (const feature of features) {
    const normalized = normalizeMuniCode(feature.properties?.N03_007);
    if (normalized) {
      feature.properties = { ...feature.properties, N03_007: normalized };
    }
  }
  const enriched = enrichGeoJsonFeatures(features, catalog);

  // 4. enriched.geojson 書き出し
  await mkdir(outputDir, { recursive: true });
  const enrichedPath = join(outputDir, 'enriched.geojson');
  await writeFile(
    enrichedPath,
    JSON.stringify({ type: 'FeatureCollection', features: enriched }),
  );
  console.error(`enriched.geojson を書き出しました: ${enrichedPath}`);

  // 5. tippecanoe で MVT タイル生成（失敗時は警告して続行）
  const tilesDir = join(outputDir, 'tiles');
  const tilesGenerated = await runTippecanoe(enrichedPath, tilesDir);
  if (tilesGenerated) {
    console.error(`MVTタイルを生成しました: ${tilesDir}`);
  }

  // 6. coverage.json 生成
  const coverageJson = {
    ...(JSON.parse(generateCoverageJson(coverageMap)) as Record<string, unknown>),
    meta: {
      source: geojsonUrl,
      generatedAt: new Date().toISOString(),
      coverageDefinition: COVERAGE_DEFINITION,
    },
  };
  const coverageJsonString = JSON.stringify(coverageJson, null, 2);
  await writeFile(join(outputDir, 'coverage.json'), coverageJsonString);
  console.error(`coverage.json を書き出しました: ${join(outputDir, 'coverage.json')}`);

  // 7. R2 アップロード（S3互換APIを優先、失敗時はCloudflare APIにフォールバック）
  let uploaded = 0;
  const r2Config = getR2ConfigFromEnv();
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? r2Config?.accountId;
  if (!r2Config && !cfToken) {
    console.error(
      'R2環境変数（R2_* または CLOUDFLARE_API_TOKEN）が未設定のためアップロードをスキップします',
    );
  } else {
    const entries: UploadEntry[] = [];

    if (tilesGenerated) {
      const pbfFiles = await collectPbfFiles(tilesDir);
      for (const file of pbfFiles) {
        const rel = relative(tilesDir, file).split('\\').join('/');
        entries.push({
          key: `tiles/${rel}`,
          body: await readFile(file),
          contentType: MVT_CONTENT_TYPE,
        });
      }
    }

    entries.push({
      key: 'coverage.json',
      body: new TextEncoder().encode(coverageJsonString),
      contentType: JSON_CONTENT_TYPE,
    });

    // S3互換APIを試す
    let s3Failed = false;
    if (r2Config) {
      try {
        const client = createS3Client(r2Config);
        uploaded = await uploadWithConcurrency(client, r2Config.bucket, entries, concurrency);
        console.error(`R2へ ${uploaded} ファイルをアップロードしました（S3 API）`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Warning: S3 API アップロード失敗、Cloudflare APIにフォールバックします: ${msg}`);
        s3Failed = true;
      }
    } else {
      s3Failed = true;
    }

    // フォールバック: Cloudflare API (api.cloudflare.com) でput
    if (s3Failed && cfToken && cfAccountId) {
      const bucket = r2Config?.bucket ?? process.env.R2_BUCKET ?? 'machimoki-coverage';
      console.error('Cloudflare APIでアップロードを試行します...');
      let cfUploaded = 0;
      for (const entry of entries) {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/r2/buckets/${bucket}/objects/${entry.key}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${cfToken}`,
              'Content-Type': entry.contentType,
            },
            body: entry.body as unknown as BodyInit,
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Cloudflare API PUT ${entry.key} 失敗: ${res.status} ${text.slice(0, 200)}`);
        }
        cfUploaded += 1;
      }
      uploaded = cfUploaded;
      console.error(`R2へ ${uploaded} ファイルをアップロードしました（Cloudflare API）`);
    } else if (s3Failed) {
      console.error('Cloudflare APIトークン（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）が未設定のためフォールバックできません');
    }
  }

  return {
    coverageMap,
    featureCount: enriched.length,
    tilesGenerated,
    uploaded,
    source: geojsonUrl,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  await generateCoverage(options);
}

function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error: ${message}`);
    process.exit(1);
  });
}