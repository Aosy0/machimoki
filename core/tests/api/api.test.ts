import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, app } from '../../src/api/server.js';
import type { ServerType } from '@hono/node-server';

vi.mock('../../src/core/pipeline.js', () => ({
  buildPrintableModel: vi.fn(),
}));

const buildPrintableModel = vi.mocked(
  (await import('../../src/core/pipeline.js')).buildPrintableModel,
);

function getPort(server: ServerType): number {
  const address = (server as unknown as import('node:http').Server).address();
  if (address && typeof address === 'object') {
    return address.port;
  }
  throw new Error('Could not determine server port');
}

describe('API server', () => {
  let server: ServerType;
  let baseUrl: string;

  beforeAll(() => {
    server = createServer(0);
    baseUrl = `http://localhost:${getPort(server)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('returns a greeting on GET /', async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('machimoki API');
  });

  it('POST /api/export returns binary model with attachment headers', async () => {
    const fakeBuffer = Buffer.from('binary-model-data');
    buildPrintableModel.mockResolvedValue(fakeBuffer);

    const response = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: { west: 139.69, south: 35.69, east: 139.7, north: 35.7 },
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('Content-Disposition')).toContain('model.3mf');

    const arrayBuffer = await response.arrayBuffer();
    expect(Buffer.from(arrayBuffer).toString()).toBe('binary-model-data');

    expect(buildPrintableModel).toHaveBeenCalledWith(
      { west: 139.69, south: 35.69, east: 139.7, north: 35.7 },
      expect.objectContaining({
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
        lod: 'lod1',
        includeTerrain: true,
      }),
    );
  });

  it('POST /api/export supports STL format', async () => {
    buildPrintableModel.mockResolvedValue(Buffer.from('stl-data'));

    const response = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bounds: { west: 0, south: 0, east: 1, north: 1 },
        terrainThickness: 5,
        format: 'stl',
        includeTerrain: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('model.stl');
  });

  it('POST /api/export returns 400 for invalid body', async () => {
    const response = await fetch(`${baseUrl}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounds: 'invalid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeDefined();
  });

  it('POST /api/validate returns JSON result for an uploaded STL', async () => {
    const fileContent = Buffer.from('solid cube endsolid cube');
    const formData = new FormData();
    formData.append('file', new File([fileContent], 'test.stl', { type: 'model/stl' }));

    const response = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      body: formData,
    });

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('numTri');
    expect(result).toHaveProperty('volume');
  });

  it('POST /api/validate returns 400 when file field is missing', async () => {
    const formData = new FormData();
    formData.append('not-a-file', 'value');

    const response = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      body: formData,
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/missing file/i);
  });

  it('app fetch handler is exported', () => {
    expect(app.fetch).toBeInstanceOf(Function);
  });
});
