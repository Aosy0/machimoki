/**
 * generateCoverage CLI
 *
 * PLATEAUカタログ + N03 GeoJSON からカバレッジMVTタイルと coverage.json を生成し、
 * R2（S3互換）へアップロードする。自宅サーバーのcron（03:00 JST）で実行する。
 *
 * マニフェスト方式の差分生成・差分アップロード:
 * - 出力dir直下の manifest.json（アップロード対象外）に、入力ハッシュ・CODE_VERSION・
 *   各キーのSHA-256を記録する。
 * - 入力（カタログJSON＋N03 GeoJSON）不変・タイル実在・CODE_VERSION一致なら
 *   tippecanoe再生成とR2アップロードをスキップする。
 * - 入力が変わった場合は差分のみPUTし、消滅したキーはR2からDELETEする。
 * - 初回（マニフェスト無し）は従来通り全量アップロードする。
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

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

/**
 * 生成ロジックのバージョン。マニフェストの codeVersion と比較し、
 * 不一致なら入力不変でも全量再生成を強制する。
 * tippecanoe引数・カバレッジ定義・タイル生成/差分ロジックを変更した場合は
 * 必ずこの値を更新すること。
 */
const CODE_VERSION = '2026-09-03-2';
export { CODE_VERSION };

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
  /** 今回PUTしたファイル数 */
  putCount: number;
  /** 今回DELETEしたファイル数 */
  deleteCount: number;
  /** 差分なしでスキップしたファイル数 */
  skipCount: number;
  /** 入力不変により生成とアップロードをスキップしたか */
  generationSkipped: boolean;
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

/**
 * SHA-256 ハッシュを16進文字列で返す。
 */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 入力ハッシュを計算する。カタログJSONとenrich後のN03 GeoJSON
 * （enriched.geojson の実体）を連結して SHA-256 を取る。
 * enrich はカタログとGeoJSONの決定関数なので、入力が不変ならハッシュも不変。
 */
export function computeInputHash(
  catalog: CatalogDataset[],
  features: GeoJsonFeature[],
): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(catalog));
  hash.update(JSON.stringify(features));
  return hash.digest('hex');
}

/**
 * 差分生成・差分アップロード用のマニフェスト。
 * - version: マニフェスト形式のバージョン
 * - codeVersion: 生成ロジックのバージョン（CODE_VERSION）
 * - inputHash: 入力（カタログJSON＋N03 GeoJSON）のSHA-256
 * - generatedAt: 生成日時
 * - files: R2上のキー → ファイル内容のSHA-256
 */
export interface CoverageManifest {
  version: 1;
  codeVersion: string;
  inputHash: string;
  generatedAt: string;
  files: Record<string, string>;
}

/**
 * マニフェストを読み込む。存在しない・壊れている場合は null を返す。
 */
export async function readManifest(
  manifestPath: string,
): Promise<CoverageManifest | null> {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CoverageManifest>;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.version !== 1 ||
      typeof parsed.codeVersion !== 'string' ||
      typeof parsed.inputHash !== 'string' ||
      typeof parsed.generatedAt !== 'string' ||
      typeof parsed.files !== 'object' ||
      parsed.files === null ||
      !Object.values(parsed.files).every((value) => typeof value === 'string')
    ) {
      return null;
    }
    return parsed as CoverageManifest;
  } catch {
    return null;
  }
}

/**
 * マニフェストを書き出す。
 */
export async function writeManifest(
  manifestPath: string,
  manifest: CoverageManifest,
): Promise<void> {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export interface DiffResult {
  toPut: string[];
  toDelete: string[];
  skipped: number;
}

/**
 * 前回マニフェストのファイル一覧と現在のファイル一覧から差分を算出する。
 * - 新規・ハッシュが変わったキー → toPut
 * - 前回にあり現在にないキー → toDelete
 * - ハッシュが一致するキー → skipped
 */
export function computeDiff(
  previousFiles: Record<string, string>,
  currentFiles: Record<string, string>,
): DiffResult {
  const toPut: string[] = [];
  const toDelete: string[] = [];
  let skipped = 0;

  for (const [key, hash] of Object.entries(currentFiles)) {
    if (previousFiles[key] === hash) {
      skipped += 1;
    } else {
      toPut.push(key);
    }
  }
  for (const key of Object.keys(previousFiles)) {
    if (!(key in currentFiles)) {
      toDelete.push(key);
    }
  }

  return { toPut, toDelete, skipped };
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
 * タイルは gzip 圧縮される（--no-tile-compression を付けない）。
 * tippecanoe が無い・失敗した場合は警告して false を返す（coverage.json 生成は続行）。
 * 成功時は要約1行のみ、失敗時は出力の末尾30行を表示する（cronログ肥大防止）。
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
        '--drop-densest-as-needed',
        '-y',
        'covered',
        '-y',
        'lods',
        '-y',
        'maxLod',
        '-y',
        'N03_007',
        '-f',
        enrichedPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      console.error(`Warning: tippecanoe を実行できませんでした: ${error.message}`);
      resolve(false);
    });
    child.on('close', (code) => {
      if (code === 0) {
        console.error(`tippecanoe: MVTタイルを生成しました（${tilesDir}）`);
        resolve(true);
      } else {
        const output = (stderr || stdout).trim();
        const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
        const tail = lines.slice(-30).join('\n');
        console.error(`Warning: tippecanoe が終了コード ${code} で失敗しました`);
        if (tail) {
          console.error(`tippecanoe 出力（末尾30行）:\n${tail}`);
        }
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

/**
 * R2 からキーを並列削除する。削除した件数を返す。
 */
async function deleteWithConcurrency(
  client: S3Client,
  bucket: string,
  keys: string[],
  concurrency: number,
): Promise<number> {
  let index = 0;
  let deleted = 0;
  const workerCount = Math.max(1, Math.min(concurrency, keys.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < keys.length) {
      const key = keys[index];
      index += 1;
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted += 1;
    }
  });

  await Promise.all(workers);
  return deleted;
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
 * タイルディレクトリに .pbf ファイルが1つ以上存在するかを確認する。
 */
async function hasPbfFiles(dir: string): Promise<boolean> {
  try {
    const files = await collectPbfFiles(dir);
    return files.length > 0;
  } catch {
    return false;
  }
}

/**
 * カバレッジ生成のオーケストレーション。
 * 1. カタログ取得 → CoverageMap 生成（ward_code ?? city_code、区/市を区別）
 * 2. N03 GeoJSON 取得（失敗時キャッシュ）
 * 3. N03_007 正規化 + enrichGeoJsonFeatures
 * 4. 入力ハッシュ計算 + マニフェスト読込。入力不変・タイル実在・CODE_VERSION一致なら
 *    tippecanoe再生成とR2アップロードをスキップ
 * 5. enriched.geojson 書き出し
 * 6. tippecanoe で MVT タイル生成（失敗時は警告して続行）
 * 7. coverage.json 生成（meta: source, generatedAt, coverageDefinition）
 * 8. マニフェストとの差分を算出し、変更分のみ PUT・消滅分は DELETE（concurrency 20）
 * 9. アップロード成功時のみマニフェストを更新
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

  // 4. 入力ハッシュ計算 + マニフェスト読込
  const inputHash = computeInputHash(catalog, enriched);
  const manifestPath = join(outputDir, 'manifest.json');
  const previousManifest = await readManifest(manifestPath);

  // 5. 入力不変・タイル実在・CODE_VERSION一致なら生成とアップロードをスキップ
  const tilesDir = join(outputDir, 'tiles');
  const generationSkipped =
    previousManifest !== null &&
    previousManifest.codeVersion === CODE_VERSION &&
    previousManifest.inputHash === inputHash &&
    (await hasPbfFiles(tilesDir));

  if (generationSkipped) {
    const skipCount = Object.keys(previousManifest.files).length;
    console.error(
      `入力不変のためtippecanoe再生成とR2アップロードをスキップします（${skipCount} ファイル）`,
    );
    return {
      coverageMap,
      featureCount: enriched.length,
      tilesGenerated: true,
      uploaded: 0,
      source: geojsonUrl,
      putCount: 0,
      deleteCount: 0,
      skipCount,
      generationSkipped: true,
    };
  }

  // 6. enriched.geojson 書き出し
  await mkdir(outputDir, { recursive: true });
  const enrichedPath = join(outputDir, 'enriched.geojson');
  await writeFile(
    enrichedPath,
    JSON.stringify({ type: 'FeatureCollection', features: enriched }),
  );
  console.error(`enriched.geojson を書き出しました: ${enrichedPath}`);

  // 7. tippecanoe で MVT タイル生成（失敗時は警告して続行）
  const tilesGenerated = await runTippecanoe(enrichedPath, tilesDir);

  // 8. coverage.json 生成
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

  // 9. R2 アップロード（差分。S3互換APIを優先、失敗時はCloudflare APIにフォールバック）
  let uploaded = 0;
  let deleteCount = 0;
  let skipCount = 0;
  let uploadSucceeded = false;
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

    // 現在のファイルハッシュを計算し、前回マニフェストとの差分を算出
    const currentFiles: Record<string, string> = {};
    for (const entry of entries) {
      currentFiles[entry.key] = sha256Hex(entry.body);
    }
    const previousFiles = previousManifest?.files ?? {};
    const diff = computeDiff(previousFiles, currentFiles);
    const toPutEntries = entries.filter((entry) => diff.toPut.includes(entry.key));
    // tippecanoe失敗時はタイルの状態が不明なため削除しない（coverage.jsonのみ更新）
    const toDelete = tilesGenerated ? diff.toDelete : [];
    skipCount = diff.skipped;

    // S3互換APIを試す
    let s3Failed = false;
    if (r2Config) {
      try {
        const client = createS3Client(r2Config);
        uploaded = await uploadWithConcurrency(client, r2Config.bucket, toPutEntries, concurrency);
        deleteCount = await deleteWithConcurrency(client, r2Config.bucket, toDelete, concurrency);
        console.error(
          `R2へ ${uploaded} ファイルをアップロード、${deleteCount} ファイルを削除、${skipCount} ファイルをスキップしました（S3 API）`,
        );
        uploadSucceeded = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Warning: S3 API アップロード失敗、Cloudflare APIにフォールバックします: ${msg}`);
        s3Failed = true;
      }
    } else {
      s3Failed = true;
    }

    // フォールバック: Cloudflare API (api.cloudflare.com) でput/delete
    if (s3Failed && cfToken && cfAccountId) {
      const bucket = r2Config?.bucket ?? process.env.R2_BUCKET ?? 'machimoki-coverage';
      console.error('Cloudflare APIでアップロードを試行します...');
      let cfUploaded = 0;
      for (const entry of toPutEntries) {
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
      for (const key of toDelete) {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/r2/buckets/${bucket}/objects/${key}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${cfToken}` },
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Cloudflare API DELETE ${key} 失敗: ${res.status} ${text.slice(0, 200)}`);
        }
        deleteCount += 1;
      }
      uploaded = cfUploaded;
      console.error(
        `R2へ ${uploaded} ファイルをアップロード、${deleteCount} ファイルを削除、${skipCount} ファイルをスキップしました（Cloudflare API）`,
      );
      uploadSucceeded = true;
    } else if (s3Failed) {
      console.error('Cloudflare APIトークン（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）が未設定のためフォールバックできません');
    }

    // 10. アップロード成功時のみマニフェストを更新
    if (uploadSucceeded) {
      const newManifestFiles: Record<string, string> = {};
      if (tilesGenerated) {
        for (const entry of entries) {
          newManifestFiles[entry.key] = currentFiles[entry.key];
        }
      } else {
        // tippecanoe失敗時はタイルのエントリを維持し、coverage.jsonのみ更新
        for (const [key, hash] of Object.entries(previousFiles)) {
          if (key.startsWith('tiles/')) newManifestFiles[key] = hash;
        }
        newManifestFiles['coverage.json'] = currentFiles['coverage.json'];
      }
      const newManifest: CoverageManifest = {
        version: 1,
        codeVersion: CODE_VERSION,
        inputHash,
        generatedAt: new Date().toISOString(),
        files: newManifestFiles,
      };
      await writeManifest(manifestPath, newManifest);
      console.error(`マニフェストを書き出しました: ${manifestPath}`);
    }
  }

  return {
    coverageMap,
    featureCount: enriched.length,
    tilesGenerated,
    uploaded,
    source: geojsonUrl,
    putCount: uploaded,
    deleteCount,
    skipCount,
    generationSkipped: false,
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