import { describe, expect, it, vi, beforeEach } from 'vitest';

import { app, parseExportBody } from '../../src/api/server.js';
import { defaultEngravingOptions } from '../../src/engraving/types.js';

vi.mock('../../src/pipeline.js', () => ({
  buildPrintableModel: vi.fn(),
  exportMachimoki: vi.fn(),
}));

vi.mock('../../src/validate.js', () => ({
  validateMesh: vi.fn(),
}));

const buildPrintableModel = vi.mocked(
  (await import('../../src/pipeline.js')).buildPrintableModel,
);
const validateMesh = vi.mocked((await import('../../src/validate.js')).validateMesh);

const PASSING_VALIDATION = {
  status: 'pass' as const,
  numTri: 1,
  numVert: 3,
  numEdge: 3,
  volume: 1,
  surfaceArea: 1,
  genus: 0,
  numShells: 1,
  open_edges: 0,
  non_manifold_edges: 0,
  self_intersections: 0,
  statusCode: 'NoError',
};

function baseBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    terrainThickness: 10,
    flattenBottom: true,
    format: '3mf',
    ...extra,
  };
}

function requireOk(result: ReturnType<typeof parseExportBody>) {
  if (!result.ok) throw new Error(`parseExportBody failed: ${result.error}`);
  return result.value;
}

describe('parseExportBody engraving', () => {
  it('leaves engraving undefined when the body has none', () => {
    const value = requireOk(parseExportBody(baseBody()));
    expect(value.options.engraving).toBeUndefined();
  });

  it('merges the body engraving with defaultEngravingOptions()', () => {
    const value = requireOk(
      parseExportBody(baseBody({ engraving: { enabled: true, face: 'south' } })),
    );
    expect(value.options.engraving).toEqual({
      ...defaultEngravingOptions(),
      enabled: true,
      face: 'south',
    });
  });

  it('accepts all fields, including Japanese text and a custom print profile', () => {
    const engraving = {
      enabled: true,
      face: 'east',
      centerX: 0.3,
      centerY: 0.6,
      lineGapMm: 2,
      align: 'left',
      lines: [
        { id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 },
        { id: 'name', text: '新宿区', sizeMm: 10, auto: true },
      ],
      depthMm: 0.6,
      printProfile: { nozzleMm: 0.6, layerHeightMm: 0.3 },
      wrap: false,
    };
    const value = requireOk(parseExportBody(baseBody({ engraving })));
    expect(value.options.engraving).toEqual(engraving);
  });

  it('defaults enabled to false when it is omitted', () => {
    const value = requireOk(parseExportBody(baseBody({ engraving: { face: 'west' } })));
    expect(value.options.engraving?.enabled).toBe(false);
    expect(value.options.engraving?.face).toBe('west');
  });

  it('rejects an invalid face', () => {
    const result = parseExportBody(baseBody({ engraving: { enabled: true, face: 'top' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid engraving\.face/);
  });

  it('rejects an invalid align', () => {
    const result = parseExportBody(
      baseBody({ engraving: { enabled: true, align: 'justify' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid engraving\.align/);
  });

  it('rejects lines that are not an array', () => {
    const result = parseExportBody(
      baseBody({ engraving: { enabled: true, lines: { id: 'a', text: 'x', sizeMm: 8 } } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid engraving\.lines: expected an array/);
  });

  it('rejects a line whose text is not a string', () => {
    const result = parseExportBody(
      baseBody({ engraving: { enabled: true, lines: [{ id: 'a', text: 42, sizeMm: 8 }] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/lines\[0\]\.text: expected a string/);
  });

  it('rejects non-positive print profile values', () => {
    const zeroNozzle = parseExportBody(
      baseBody({ engraving: { enabled: true, printProfile: { nozzleMm: 0 } } }),
    );
    expect(zeroNozzle.ok).toBe(false);
    if (!zeroNozzle.ok) expect(zeroNozzle.error).toMatch(/printProfile\.nozzleMm/);

    const negativeLayer = parseExportBody(
      baseBody({ engraving: { enabled: true, printProfile: { layerHeightMm: -0.2 } } }),
    );
    expect(negativeLayer.ok).toBe(false);
    if (!negativeLayer.ok) expect(negativeLayer.error).toMatch(/printProfile\.layerHeightMm/);
  });

  it('rejects engraving values that are not objects', () => {
    const result = parseExportBody(baseBody({ engraving: 'bottom' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid engraving: expected an object/);
  });
});

describe('POST /api/export engraving validation', () => {
  beforeEach(() => {
    buildPrintableModel.mockReset();
    validateMesh.mockReset();
    validateMesh.mockResolvedValue(PASSING_VALIDATION);
  });

  it('returns 400 for an invalid engraving face', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody({ engraving: { enabled: true, face: 'top' } })),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Invalid engraving\.face/);
    expect(buildPrintableModel).not.toHaveBeenCalled();
  });

  it('returns 400 when engraving is not an object', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody({ engraving: ['bottom'] })),
      }),
    );

    expect(response.status).toBe(400);
    expect(buildPrintableModel).not.toHaveBeenCalled();
  });

  it('passes merged engraving options to the pipeline', async () => {
    buildPrintableModel.mockResolvedValue({
      buffer: new Uint8Array([1, 2, 3]),
      warnings: [],
    });

    const response = await app.fetch(
      new Request('http://localhost/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          baseBody({
            engraving: {
              enabled: true,
              face: 'east',
              lines: [{ id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 }],
            },
          }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildPrintableModel).toHaveBeenCalledWith(
      { west: 0, south: 0, east: 1, north: 1 },
      expect.objectContaining({
        engraving: expect.objectContaining({
          enabled: true,
          face: 'east',
          lines: [{ id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 }],
          depthMm: defaultEngravingOptions().depthMm,
        }),
      }),
    );
  });
});
