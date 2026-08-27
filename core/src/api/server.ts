/**
 * machimoki HTTP API server.
 *
 * Endpoints:
 *   POST /api/export  -> binary 3MF/STL model
 *   POST /api/validate -> JSON ValidationResult
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve, ServerType } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { buildPrintableModel } from '../pipeline.js';
import { validateMesh } from '../validate.js';
import { Bounds, ExportOptions, Lod } from '../types.js';

const app = new Hono();

app.use('*', cors());

app.get('/', (c) => c.text('machimoki API'));

app.post('/api/export', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parseResult = parseExportBody(body);
  if (!parseResult.ok) {
    return c.json({ error: parseResult.error }, 400);
  }

  const { bounds, options } = parseResult.value;

  try {
    const { buffer, warnings } = await buildPrintableModel(bounds, options);
    const mimeType = options.format === 'stl' ? 'model/stl' : 'model/3mf';
    const validation = await validateMesh(buffer, mimeType);

    if (validation.status === 'fail') {
      return c.json({ error: 'Validation failed', warnings, validation }, 422);
    }

    const extension = options.format === 'stl' ? 'stl' : '3mf';
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="model.${extension}"`,
        'X-Validation-Status': validation.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/export] 500', message, error instanceof Error ? error.stack : '');
    return c.json({ error: message }, 500);
  }
});

app.post('/api/validate', async (c) => {
  let file: File | undefined;
  try {
    const body = await c.req.parseBody({ all: false });
    const uploaded = body.file;
    if (uploaded instanceof File) {
      file = uploaded;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Failed to parse multipart body: ${message}` }, 400);
  }

  if (!file) {
    return c.json({ error: 'Missing file field' }, 400);
  }

  const mimeType = detectMimeType(file.name);
  if (!mimeType) {
    return c.json({ error: `Unsupported file extension: ${file.name}` }, 400);
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const result = await validateMesh(buffer, mimeType);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
});

interface ParseSuccess {
  ok: true;
  value: { bounds: Bounds; options: ExportOptions };
}

interface ParseFailure {
  ok: false;
  error: string;
}

function parseExportBody(body: unknown): ParseSuccess | ParseFailure {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be an object' };
  }

  const record = body as Record<string, unknown>;

  const bounds = parseBounds(record.bounds);
  if (!bounds) {
    return { ok: false, error: 'Missing or invalid bounds' };
  }

  const terrainThickness = parseNumber(record.terrainThickness);
  if (terrainThickness === null || terrainThickness <= 0) {
    return { ok: false, error: 'Missing or invalid terrainThickness' };
  }

  const flattenBottom = typeof record.flattenBottom === 'boolean' ? record.flattenBottom : true;
  const format = parseFormat(record.format) ?? '3mf';
  const machimokiModelFormat = parseMachimokiModelFormat(record.machimokiModelFormat);
  if (machimokiModelFormat === null) {
    return { ok: false, error: 'Invalid machimokiModelFormat' };
  }
  const lod = parseLod(record.lod) ?? 'lod1';
  const includeTerrain =
    typeof record.includeTerrain === 'boolean' ? record.includeTerrain : true;
  const buildingColor = parseColor(record.buildingColor);
  const terrainColor = parseColor(record.terrainColor);
  const upAxis = parseUpAxis(record.upAxis) ?? 'z-up';
  const scaleParsed = parseNumber(record.scale);
  const scale = scaleParsed !== null && scaleParsed > 0 ? scaleParsed : 1;
  const includeSpanningBuildings =
    typeof record.includeSpanningBuildings === 'boolean' ? record.includeSpanningBuildings : false;

  let pickPoints: Array<{ lon: number; lat: number }> | undefined;
  if (record.pickPoints !== undefined) {
    const parsed = parsePickPoints(record.pickPoints);
    if (!parsed) {
      return { ok: false, error: 'Invalid pickPoints' };
    }
    pickPoints = parsed.length > 0 ? parsed : undefined;
  }

  let excludedGmlIds: string[] | undefined;
  if (record.excludedGmlIds !== undefined) {
    const parsed = parseExcludedGmlIds(record.excludedGmlIds);
    if (parsed === null) {
      return { ok: false, error: 'Invalid excludedGmlIds' };
    }
    excludedGmlIds = parsed;
  }

  const options: ExportOptions = {
    terrainThickness,
    flattenBottom,
    format,
    machimokiModelFormat,
    lod,
    includeTerrain,
    buildingColor,
    terrainColor,
    upAxis,
    scale,
    includeSpanningBuildings,
    pickPoints,
    excludedGmlIds,
  };

  return { ok: true, value: { bounds, options } };
}

function parseBounds(value: unknown): Bounds | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const west = parseNumber(record.west);
  const south = parseNumber(record.south);
  const east = parseNumber(record.east);
  const north = parseNumber(record.north);

  if (west === null || south === null || east === null || north === null) {
    return null;
  }
  if (west >= east || south >= north) {
    return null;
  }

  return { west, south, east, north };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseFormat(value: unknown): '3mf' | 'stl' | 'machimoki' | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower === '3mf' || lower === 'stl' || lower === 'machimoki') return lower;
  return null;
}

function parseMachimokiModelFormat(value: unknown): '3mf' | 'stl' | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower === '3mf' || lower === 'stl') return lower;
  return null;
}

function parseLod(value: unknown): Lod | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower === 'lod1' || lower === 'lod2' || lower === 'lod3' || lower === 'lod4') return lower;
  return null;
}

function parseUpAxis(value: unknown): 'z-up' | 'y-up' | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower === 'z-up' || lower === 'y-up') return lower;
  return null;
}

function parseColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return value;
}

function parsePickPoints(value: unknown): Array<{ lon: number; lat: number }> | null {
  if (!Array.isArray(value)) return null;
  const points: Array<{ lon: number; lat: number }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const lon = parseNumber(record.lon);
    const lat = parseNumber(record.lat);
    if (lon === null || lat === null) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    points.push({ lon, lat });
  }
  return points;
}

const MAX_EXCLUDED_GMLIDS = 10000;

function parseExcludedGmlIds(value: unknown): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  if (value.length > MAX_EXCLUDED_GMLIDS) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

function detectMimeType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.3mf')) return 'model/3mf';
  if (lower.endsWith('.stl')) return 'model/stl';
  return null;
}

export function createServer(port?: number): ServerType {
  const resolvedPort = port ?? (Number(process.env.PORT) || 3000);
  return serve({ fetch: app.fetch, port: resolvedPort });
}

function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = Number(process.env.PORT) || 3000;
  createServer(port);
  console.error(`machimoki API server listening on port ${port}`);
}

export { app };
