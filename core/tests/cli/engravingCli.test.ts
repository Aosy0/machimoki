import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  program,
  mergeEngravingOptions,
  parseEngravingOptionsJson,
  readEngravingOptionsFile,
} from '../../src/cli/index.js';
import { isEngravingFontConfigured } from '../../src/engraving/fontProvider.js';
import { defaultEngravingOptions } from '../../src/engraving/types.js';

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

// commander はモジュールシングルトンでオプション値を parseAsync 間で保持するため、
// 新規フラグはテストごとに明示的にリセットする。
const exportCommand = program.commands.find((command) => command.name() === 'export')!;

describe('CLI engraving parsing', () => {
  it('merges an empty object with defaultEngravingOptions()', () => {
    expect(mergeEngravingOptions({})).toEqual(defaultEngravingOptions());
  });

  it('parses a full JSON object (Japanese text is preserved as-is)', () => {
    const parsed = parseEngravingOptionsJson(
      JSON.stringify({
        enabled: true,
        face: 'south',
        centerX: 0.25,
        centerY: 0.75,
        lineGapMm: 2,
        lines: [
          { id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 },
          { id: 'name', text: '新宿区', sizeMm: 10, auto: true },
        ],
        depthMm: 0.6,
        printProfile: { nozzleMm: 0.6, layerHeightMm: 0.3 },
        wrap: false,
      }),
    );

    expect(parsed).toEqual({
      enabled: true,
      face: 'south',
      centerX: 0.25,
      centerY: 0.75,
      lineGapMm: 2,
      lines: [
        { id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 },
        { id: 'name', text: '新宿区', sizeMm: 10, auto: true },
      ],
      depthMm: 0.6,
      printProfile: { nozzleMm: 0.6, layerHeightMm: 0.3 },
      wrap: false,
    });
  });

  it('keeps the defaults for keys that are not specified', () => {
    const parsed = parseEngravingOptionsJson('{"face":"east"}');
    expect(parsed).toEqual({ ...defaultEngravingOptions(), face: 'east' });
    // enabled は JSON で明示しない限り false（既定値）。
    expect(parsed.enabled).toBe(false);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseEngravingOptionsJson('{face:"bottom"}')).toThrow(/Invalid engraving JSON/);
    expect(() => parseEngravingOptionsJson('')).toThrow(/Invalid engraving JSON/);
  });

  it('rejects an invalid face', () => {
    expect(() => parseEngravingOptionsJson('{"face":"top"}')).toThrow(/Invalid engraving\.face/);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseEngravingOptionsJson('[]')).toThrow(/expected a JSON object/);
    expect(() => parseEngravingOptionsJson('"bottom"')).toThrow(/expected a JSON object/);
  });

  it('rejects lines that are not an array', () => {
    expect(() => parseEngravingOptionsJson('{"lines":{"id":"a"}}')).toThrow(
      /Invalid engraving\.lines: expected an array/,
    );
  });

  it('rejects a line with a missing or invalid text/sizeMm', () => {
    expect(() => parseEngravingOptionsJson('{"lines":[{"id":"a","sizeMm":8}]}')).toThrow(
      /lines\[0\]\.text/,
    );
    expect(() => parseEngravingOptionsJson('{"lines":[{"id":"a","text":"x"}]}')).toThrow(
      /lines\[0\]\.sizeMm/,
    );
    expect(() =>
      parseEngravingOptionsJson('{"lines":[{"id":"a","text":"x","sizeMm":0}]}'),
    ).toThrow(/lines\[0\]\.sizeMm: expected a number > 0/);
  });

  it('rejects invalid printProfile, depthMm, lineGapMm and wrap values', () => {
    expect(() =>
      parseEngravingOptionsJson('{"printProfile":{"nozzleMm":0}}'),
    ).toThrow(/printProfile\.nozzleMm/);
    expect(() =>
      parseEngravingOptionsJson('{"printProfile":{"layerHeightMm":-1}}'),
    ).toThrow(/printProfile\.layerHeightMm/);
    expect(() => parseEngravingOptionsJson('{"depthMm":0}')).toThrow(/engraving\.depthMm/);
    expect(() => parseEngravingOptionsJson('{"lineGapMm":-1}')).toThrow(/engraving\.lineGapMm/);
    expect(() => parseEngravingOptionsJson('{"wrap":"yes"}')).toThrow(/engraving\.wrap/);
  });

  it('reads engraving JSON from a UTF-8 file', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'machimoki-engraving-'));
    try {
      const filePath = join(tempDir, 'engraving.json');
      writeFileSync(
        filePath,
        JSON.stringify({
          enabled: true,
          face: 'north',
          lines: [{ id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 }],
        }),
        'utf8',
      );
      const parsed = await readEngravingOptionsFile(filePath);
      expect(parsed.enabled).toBe(true);
      expect(parsed.face).toBe('north');
      expect(parsed.lines).toEqual([
        { id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 },
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports a readable error when the engraving file cannot be read', async () => {
    await expect(readEngravingOptionsFile('does-not-exist.json')).rejects.toThrow(
      /刻印設定ファイルを読み込めません/,
    );
  });
});

describe('CLI export --engraving options', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'machimoki-cli-engraving-'));
    buildPrintableModel.mockReset();
    exportCommand.setOptionValue('engraving', undefined);
    exportCommand.setOptionValue('engravingFile', undefined);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('forwards --engraving JSON to the pipeline and enables the bundled font', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    buildPrintableModel.mockResolvedValue({
      buffer: new TextEncoder().encode('engraved-model'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '0,0,1,1',
      '--terrain-thickness',
      '10',
      '--engraving',
      JSON.stringify({
        enabled: true,
        face: 'bottom',
        lines: [{ id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 }],
      }),
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      { west: 0, south: 0, east: 1, north: 1 },
      expect.objectContaining({
        engraving: expect.objectContaining({
          enabled: true,
          face: 'bottom',
          lines: [{ id: 'coord', text: '35.68120N 139.76710E', sizeMm: 8 }],
          depthMm: defaultEngravingOptions().depthMm,
        }),
      }),
    );
    expect(isEngravingFontConfigured()).toBe(true);
  });

  it('forwards --engraving-file JSON to the pipeline', async () => {
    const outputPath = join(tempDir, 'out.3mf');
    const engravingPath = join(tempDir, 'engraving.json');
    writeFileSync(
      engravingPath,
      JSON.stringify({
        enabled: true,
        face: 'south',
        lines: [{ id: 'name', text: '新宿区', sizeMm: 10 }],
      }),
      'utf8',
    );
    buildPrintableModel.mockResolvedValue({
      buffer: new TextEncoder().encode('engraved-model'),
      warnings: [],
    });

    await program.parseAsync([
      'node',
      'cli',
      'export',
      '--bounds',
      '0,0,1,1',
      '--terrain-thickness',
      '10',
      '--engraving-file',
      engravingPath,
      '--output',
      outputPath,
    ]);

    expect(buildPrintableModel).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        engraving: expect.objectContaining({
          enabled: true,
          face: 'south',
          lines: [{ id: 'name', text: '新宿区', sizeMm: 10 }],
        }),
      }),
    );
  });

  it('rejects using both --engraving and --engraving-file', async () => {
    const outputPath = join(tempDir, 'out.3mf');

    await expect(
      program.parseAsync([
        'node',
        'cli',
        'export',
        '--bounds',
        '0,0,1,1',
        '--terrain-thickness',
        '10',
        '--engraving',
        '{"enabled":true}',
        '--engraving-file',
        join(tempDir, 'engraving.json'),
        '--output',
        outputPath,
      ]),
    ).rejects.toThrow(/--engraving と --engraving-file は同時に指定できません/);
  });

  it('rejects invalid --engraving JSON before building the model', async () => {
    const outputPath = join(tempDir, 'out.3mf');

    await expect(
      program.parseAsync([
        'node',
        'cli',
        'export',
        '--bounds',
        '0,0,1,1',
        '--terrain-thickness',
        '10',
        '--engraving',
        '{"enabled":true,"face":"top"}',
        '--output',
        outputPath,
      ]),
    ).rejects.toThrow(/Invalid engraving\.face/);
    expect(buildPrintableModel).not.toHaveBeenCalled();
  });
});
