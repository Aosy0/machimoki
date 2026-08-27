import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  program,
  parseBounds,
  parseFormat,
  parseLod,
  parseUpAxis,
  detectMimeType,
  parsePickPoint,
} from '../../src/cli/index.js';

vi.mock('../../src/pipeline.js', () => ({
  buildPrintableModel: vi.fn(),
}));

vi.mock('../../src/validate.js', () => ({
  validateMesh: vi.fn().mockResolvedValue({
    status: 'pass',
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
  }),
}));

const buildPrintableModel = vi.mocked(
  (await import('../../src/pipeline.js')).buildPrintableModel,
);
const validateMesh = vi.mocked(
  (await import('../../src/validate.js')).validateMesh,
);

describe('CLI argument parsers', () => {
  it('parseBounds accepts a comma-separated string', () => {
    expect(parseBounds('139.69,35.69,139.70,35.70')).toEqual({
      west: 139.69,
      south: 35.69,
      east: 139.7,
      north: 35.7,
    });
  });

  it('parseBounds rejects invalid order', () => {
    expect(() => parseBounds('139.70,35.70,139.69,35.69')).toThrow();
  });

  it('parseFormat accepts 3mf and stl', () => {
    expect(parseFormat('3mf')).toBe('3mf');
    expect(parseFormat('STL')).toBe('stl');
    expect(() => parseFormat('obj')).toThrow();
  });

  it('parseLod accepts lod1 through lod4', () => {
    expect(parseLod('lod1')).toBe('lod1');
    expect(parseLod('LOD2')).toBe('lod2');
    expect(parseLod('lod3')).toBe('lod3');
    expect(parseLod('lod4')).toBe('lod4');
    expect(() => parseLod('lod5')).toThrow();
  });

  it('parseUpAxis accepts z-up and y-up', () => {
    expect(parseUpAxis('z-up')).toBe('z-up');
    expect(parseUpAxis('Y-UP')).toBe('y-up');
    expect(() => parseUpAxis('x-up')).toThrow();
  });

  it('detectMimeType maps file extensions', () => {
    expect(detectMimeType('model.3mf')).toBe('model/3mf');
    expect(detectMimeType('model.stl')).toBe('model/stl');
    expect(() => detectMimeType('model.obj')).toThrow();
  });

  it('parsePickPoint accepts lon,lat', () => {
    expect(parsePickPoint('139.7670,35.6812')).toEqual({ lon: 139.767, lat: 35.6812 });
  });

  it('parsePickPoint rejects malformed input', () => {
    expect(() => parsePickPoint('139.7670')).toThrow();
    expect(() => parsePickPoint('abc,35.6812')).toThrow();
    expect(() => parsePickPoint('200,35.6812')).toThrow();
    expect(() => parsePickPoint('139.7670,95')).toThrow();
  });
});

describe('CLI export command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'machimoki-cli-'));
    buildPrintableModel.mockReset();
    validateMesh.mockReset();
    validateMesh.mockResolvedValue({
      status: 'pass',
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
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a model file with default options', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    buildPrintableModel.mockResolvedValue({
      buffer: Buffer.from('model-bytes'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '139.69,35.69,139.70,35.70',
      '--terrain-thickness',
      '10',
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      { west: 139.69, south: 35.69, east: 139.7, north: 35.7 },
      {
        terrainThickness: 10,
        flattenBottom: true,
        format: '3mf',
        lod: 'lod1',
        includeTerrain: true,
        upAxis: 'z-up',
        scale: 1,
        includeSpanningBuildings: false,
        pickPoints: undefined,
      },
    );
  });

  it('honors --include-spanning-buildings', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    buildPrintableModel.mockResolvedValue({
      buffer: Buffer.from('model-bytes'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '139.69,35.69,139.70,35.70',
      '--terrain-thickness',
      '10',
      '--include-spanning-buildings',
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ includeSpanningBuildings: true }),
    );
  });

  it('honors --no-terrain and --format stl', async () => {
    const outputPath = join(tempDir, 'out.stl');
    buildPrintableModel.mockResolvedValue({
      buffer: Buffer.from('stl-bytes'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '0,0,1,1',
      '--terrain-thickness',
      '5',
      '--no-terrain',
      '--format',
      'stl',
      '--lod',
      'lod2',
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        format: 'stl',
        lod: 'lod2',
        includeTerrain: false,
      }),
    );
  });

  it('honors --scale 2', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    buildPrintableModel.mockResolvedValue({
      buffer: Buffer.from('scaled-bytes'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '0,0,1,1',
      '--terrain-thickness',
      '5',
      '--scale',
      '2',
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ scale: 2 }),
    );
  });

  it('passes repeated --pick-point options to the pipeline', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    buildPrintableModel.mockResolvedValue({
      buffer: Buffer.from('picked-bytes'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '139.76,35.68,139.77,35.69',
      '--terrain-thickness',
      '5',
      '--pick-point',
      '139.7670,35.6812',
      '--pick-point',
      '139.7650,35.6815',
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        pickPoints: [
          { lon: 139.767, lat: 35.6812 },
          { lon: 139.765, lat: 35.6815 },
        ],
      }),
    );
  });
});

describe('CLI validate command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'machimoki-cli-'));
    buildPrintableModel.mockReset();
    validateMesh.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('prints JSON result for a valid file', async () => {
    const filePath = join(tempDir, 'model.stl');
    writeFileSync(filePath, Buffer.from('solid cube endsolid cube'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    validateMesh.mockResolvedValue({
      status: 'pass',
      numTri: 12,
      numVert: 8,
      numEdge: 18,
      volume: 1,
      surfaceArea: 6,
      genus: 0,
      numShells: 1,
      open_edges: 0,
      non_manifold_edges: 0,
      self_intersections: 0,
      statusCode: 'NoError',
    });

    await program.parseAsync(['node', 'cli', 'validate', '--file', filePath]);

    expect(validateMesh).toHaveBeenCalledWith(expect.any(Buffer), 'model/stl');
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(output).status).toBe('pass');

    logSpy.mockRestore();
  });
});

describe('CLI subprocess', () => {
  it('reports invalid bounds and exits non-zero', () => {
    const cliPath = 'src/cli/index.ts';
    expect(() =>
      execSync(`npx tsx ${cliPath} export --bounds 139.70,35.70,139.69,35.69 --terrain-thickness 10 --output out.3mf`, {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
