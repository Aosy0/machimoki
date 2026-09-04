/**
 * GSI reverse geocoding + PLATEAU catalog API client.
 */

import type { Lod } from './types.js';

const GSI_REVERSE_GEOCODER_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const PLATEAU_CATALOG_URL = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';
const GSI_REVERSE_GEOCODER_TIMEOUT_MS = 10_000;
const N03_GEOJSON_URL =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010/N03-21_210101.json';
const N03_FETCH_TIMEOUT_MS = 20_000;

interface GsiReverseGeocodeResult {
  results: {
    muniCd: string;
    lv01Nm: string;
  };
}

interface PlateauDataset {
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

interface PlateauCatalogResponse {
  datasets: PlateauDataset[];
}

let cachedDatasets: PlateauDataset[] | null = null;
let cachedDatasetsPromise: Promise<PlateauDataset[]> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertCatalogResponse(data: unknown): PlateauCatalogResponse {
  if (!isRecord(data)) throw new Error('カタログAPIの応答がオブジェクトではありません');
  if (!Array.isArray(data.datasets)) throw new Error('カタログAPIの応答にdatasetsがありません');
  return { datasets: data.datasets as PlateauDataset[] };
}

function assertGeocodeResult(data: unknown): GsiReverseGeocodeResult {
  if (!isRecord(data)) throw new Error('逆ジオコーディングの応答がオブジェクトではありません');
  if (!isRecord(data.results)) throw new Error('市区町村コードが取得できません');
  if (typeof data.results.muniCd !== 'string') {
    throw new Error('市区町村コードが取得できません');
  }
  return { results: { muniCd: data.results.muniCd, lv01Nm: String(data.results.lv01Nm ?? '') } };
}

async function fetchCatalogDatasets(): Promise<PlateauDataset[]> {
  if (cachedDatasets) return cachedDatasets;
  if (cachedDatasetsPromise) return cachedDatasetsPromise;

  cachedDatasetsPromise = fetch(PLATEAU_CATALOG_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`カタログAPI失敗: ${res.status}`);
      return res.json();
    })
    .then((data: unknown) => {
      const catalog = assertCatalogResponse(data);
      cachedDatasets = catalog.datasets;
      return catalog.datasets;
    });

  return cachedDatasetsPromise;
}

export async function resolveMuniCode(
  lat: number,
  lon: number,
  timeoutMs: number = GSI_REVERSE_GEOCODER_TIMEOUT_MS,
): Promise<string> {
  const url = `${GSI_REVERSE_GEOCODER_URL}?lat=${lat}&lon=${lon}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('逆ジオコーディングがタイムアウトしました');
    }
    throw err;
  }
  if (!res.ok) throw new Error(`逆ジオコーディング失敗: ${res.status}`);
  const data: unknown = await res.json();
  const result = assertGeocodeResult(data);
  if (!result.results.muniCd) throw new Error('市区町村コードが取得できません');
  return result.results.muniCd;
}

export async function resolveMuniCodes(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): Promise<string[]> {
  const centerLat = (bounds.south + bounds.north) / 2;
  const centerLon = (bounds.west + bounds.east) / 2;

  const points: Array<{ lat: number; lon: number }> = [
    { lat: bounds.south, lon: bounds.west },
    { lat: bounds.south, lon: bounds.east },
    { lat: bounds.north, lon: bounds.west },
    { lat: bounds.north, lon: bounds.east },
    { lat: centerLat, lon: centerLon },
  ];

  const results = await Promise.allSettled(
    points.map(({ lat, lon }) => resolveMuniCodeWithFallback(lat, lon)),
  );

  const codes = new Set<string>();
  let anySuccess = false;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      codes.add(result.value);
      anySuccess = true;
    }
  }

  if (!anySuccess) {
    throw new Error('選択範囲の自治体コードが取得できません');
  }
  return Array.from(codes);
}

async function resolveMuniCodeWithFallback(lat: number, lon: number): Promise<string> {
  try {
    return await resolveMuniCode(lat, lon);
  } catch {
    return resolveMuniCodeLocal(lat, lon);
  }
}

interface N03Feature {
  properties?: { N03_007?: string | number };
  geometry?: { type?: string; coordinates?: unknown };
}

let cachedN03Features: N03Feature[] | null = null;
let cachedN03Promise: Promise<N03Feature[]> | null = null;

async function fetchN03Features(): Promise<N03Feature[]> {
  if (cachedN03Features) return cachedN03Features;
  if (cachedN03Promise) return cachedN03Promise;

  cachedN03Promise = (async () => {
    const res = await fetch(N03_GEOJSON_URL, {
      signal: AbortSignal.timeout(N03_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`行政区域データの取得に失敗: ${res.status}`);
    const data: unknown = await res.json();
    if (
      typeof data !== 'object' ||
      data === null ||
      !Array.isArray((data as { features?: unknown }).features)
    ) {
      throw new Error('行政区域データの形式が不正です');
    }
    cachedN03Features = (data as { features: N03Feature[] }).features;
    return cachedN03Features;
  })().catch((err: unknown) => {
    cachedN03Promise = null;
    throw err;
  });

  return cachedN03Promise;
}

export function normalizeN03Code(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) return null;
    const str = String(value);
    return str.length <= 5 ? str.padStart(5, '0') : null;
  }
  if (typeof value === 'string') {
    const str = value.trim();
    if (!/^\d{1,5}$/.test(str)) return null;
    return str.padStart(5, '0');
  }
  return null;
}

function ringContains(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringBBox(ring: number[][]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

export function featureContainsPoint(lon: number, lat: number, feature: N03Feature): boolean {
  const geometry = feature.geometry;
  if (!geometry || !Array.isArray(geometry.coordinates)) return false;
  const polys: number[][][][] =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as number[][][]]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as number[][][][])
        : [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const [w, s, e, n] = ringBBox(outer);
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (!ringContains(lon, lat, outer)) continue;
    let inHole = false;
    for (const hole of poly.slice(1)) {
      if (hole.length >= 3 && ringContains(lon, lat, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

export function findMuniCodeByPoint(
  lon: number,
  lat: number,
  features: N03Feature[],
): string | null {
  for (const feature of features) {
    if (!featureContainsPoint(lon, lat, feature)) continue;
    const code = normalizeN03Code(feature.properties?.N03_007);
    if (code) return code;
  }
  return null;
}

export async function resolveMuniCodeLocal(lat: number, lon: number): Promise<string> {
  const features = await fetchN03Features();
  const code = findMuniCodeByPoint(lon, lat, features);
  if (!code) throw new Error('市区町村コードが取得できません');
  return code;
}

export async function findTilesetUrl(muniCode: string, lod: Lod): Promise<string> {
  const datasets = await fetchCatalogDatasets();
  const prefCode = muniCode.slice(0, 2);
  const targetLod = lod.replace('lod', '');

  const candidates = datasets.filter((d) => {
    if (d.pref_code !== prefCode) return false;
    if (d.format !== '3D Tiles') return false;
    if (d.type !== '建築物モデル') return false;
    if (d.lod !== targetLod) return false;
    if (d.ward_code && d.ward_code === muniCode) return true;
    if (d.city_code === muniCode) return true;
    return false;
  });

  const candidate = candidates.find((d) => !d.texture) ?? candidates[0];

  if (!candidate) {
    throw new Error(
      `該当する3D Tilesデータセットが見つかりません: muniCode=${muniCode}, lod=${lod}`,
    );
  }

  return candidate.url;
}
