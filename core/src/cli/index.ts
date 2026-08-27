/**
 * machimoki CLI
 *
 * Commands:
 *   export   --bounds <west,south,east,north> --terrain-thickness <number>
 *            [--flatten-bottom|--no-flatten-bottom] [--format <3mf|stl>]
 *            --output <file> [--lod <lod1|lod2>] [--no-terrain]
 *
 *   validate --file <path> [--json|--no-json]
 */

import { Command } from 'commander';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildPrintableModel } from '../pipeline.js';
import { validateMesh } from '../validate.js';
import { Bounds, ExportOptions, Lod } from '../types.js';

export const program = new Command();

program.name('machimoki').description('Build printable 3D models from PLATEAU data').version('1.0.0');

export function parseBounds(value: string): Bounds {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid bounds format: ${value}. Expected west,south,east,north`);
  }
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) {
    throw new Error(`Invalid bounds: west=${west}, south=${south}, east=${east}, north=${north}`);
  }
  return { west, south, east, north };
}

export function parseFormat(value: string): '3mf' | 'stl' {
  const lower = value.toLowerCase();
  if (lower !== '3mf' && lower !== 'stl') {
    throw new Error(`Invalid format: ${value}. Expected 3mf or stl`);
  }
  return lower;
}

export function parseLod(value: string): Lod {
  const lower = value.toLowerCase();
  if (lower !== 'lod1' && lower !== 'lod2' && lower !== 'lod3' && lower !== 'lod4') {
    throw new Error(`Invalid LOD: ${value}. Expected lod1, lod2, lod3 or lod4`);
  }
  return lower;
}

export function parseUpAxis(value: string): 'z-up' | 'y-up' {
  const lower = value.toLowerCase();
  if (lower !== 'z-up' && lower !== 'y-up') {
    throw new Error(`Invalid up-axis: ${value}. Expected z-up or y-up`);
  }
  return lower;
}

export function detectMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.3mf')) return 'model/3mf';
  if (lower.endsWith('.stl')) return 'model/stl';
  throw new Error(`Unsupported file extension: ${filePath}. Expected .3mf or .stl`);
}

export interface PickPoint {
  lon: number;
  lat: number;
}

export function parsePickPoint(value: string): PickPoint {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid pick-point format: ${value}. Expected lon,lat`);
  }
  const [lon, lat] = parts;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`Invalid pick-point: lon=${lon}, lat=${lat}`);
  }
  return { lon, lat };
}

function collectPickPoint(value: string, previous: PickPoint[]): PickPoint[] {
  return [...previous, parsePickPoint(value)];
}

function collectExcludeGmlId(value: string, previous: string[]): string[] {
  return [...previous, value];
}

program
  .command('export')
  .description('Export a printable 3D model')
  .requiredOption('--bounds <west,south,east,north>', 'geographic bounds', parseBounds)
  .requiredOption('--terrain-thickness <number>', 'terrain thickness', (value) => {
    const num = Number(value);
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid terrain thickness: ${value}`);
    }
    return num;
  })
  .option('--flatten-bottom', 'flatten the bottom surface', true)
  .option('--no-flatten-bottom', 'do not flatten the bottom surface')
  .option('--format <3mf|stl>', 'output format', parseFormat, '3mf')
  .requiredOption('--output <file>', 'output file path')
  .option('--lod <lod1|lod2|lod3|lod4>', 'building LOD', parseLod, 'lod1')
  .option('--up-axis <z-up|y-up>', 'which axis points up in the output', parseUpAxis, 'z-up')
  .option('--terrain', 'include terrain generation', true)
  .option('--no-terrain', 'skip terrain generation')
  .option('--include-spanning-buildings', 'include buildings that span the selection boundary', false)
  .option('--pick-point <lon,lat>', 'keep only buildings whose footprint contains the point (repeatable)', collectPickPoint, [])
  .option('--exclude-gmlid <id>', 'exclude a building by gmlid (repeatable)', collectExcludeGmlId, [])
  .option('--scale <number>', 'uniform scale factor (>0)', (value) => {
    const num = Number(value);
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid scale: ${value}. Must be > 0`);
    }
    return num;
  }, 1)
  .action(async (options) => {
    const exportOptions: ExportOptions = {
      terrainThickness: options.terrainThickness,
      flattenBottom: options.flattenBottom,
      format: options.format,
      lod: options.lod,
      includeTerrain: options.terrain,
      upAxis: options.upAxis,
      scale: options.scale,
      includeSpanningBuildings: options.includeSpanningBuildings,
      pickPoints: options.pickPoint.length > 0 ? options.pickPoint : undefined,
      excludedGmlIds: options.excludeGmlid.length > 0 ? options.excludeGmlid : undefined,
    };

    console.error(`Building ${exportOptions.format.toUpperCase()} model for bounds`, options.bounds);

    const { buffer, warnings } = await buildPrintableModel(options.bounds, exportOptions);
    for (const warning of warnings) {
      console.error(`Warning: ${warning}`);
    }

    await writeFile(options.output, buffer);
    console.error(`Wrote ${buffer.length} bytes to ${options.output}`);

    const mimeType = detectMimeType(options.output);
    const result = await validateMesh(buffer, mimeType);
    if (result.status === 'fail') {
      console.error(`Validation fail: ${JSON.stringify(result)}`);
      await unlink(options.output);
      process.exit(2);
    }
    if (result.status === 'warning') {
      console.error(`Validation warning: ${JSON.stringify(result)}`);
    } else {
      console.error(`Validation pass: ${JSON.stringify(result)}`);
    }
  });

program
  .command('validate')
  .description('Validate a 3MF or STL file')
  .requiredOption('--file <path>', 'input file path')
  .option('--json', 'output JSON to stdout', true)
  .option('--no-json', 'output plain text to stdout')
  .action(async (options) => {
    const buffer = await readFile(options.file);
    const mimeType = detectMimeType(options.file);
    const result = await validateMesh(buffer, mimeType);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Status: ${result.status}`);
      console.log(`Triangles: ${result.numTri}`);
      console.log(`Volume: ${result.volume}`);
      console.log(`Status code: ${result.statusCode}`);
    }

    if (result.status === 'fail') {
      process.exit(2);
    }
    if (result.status === 'warning') {
      process.exit(1);
    }
  });

export async function run(argv: string[]): Promise<void> {
  await program.parseAsync(argv);
}

function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  run(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unexpected error: ${message}`);
    process.exit(1);
  });
}
