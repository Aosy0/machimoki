/**
 * machimoki CLI
 *
 * Commands:
 *   export   --bounds <west,south,east,north> --terrain-thickness <number>
 *            [--flatten-bottom|--no-flatten-bottom] [--format <3mf|stl>]
 *            --output <file> [--lod <lod1|lod2>] [--no-terrain]
 *            [--terrain-grid <integer 4-512>]
 *            [--open-bottom] [--shell-thickness <number>]
 *            [--hollow-buildings|--no-hollow-buildings]
 *            [--engraving <json> | --engraving-file <path>]
 *
 *   validate --file <path> [--json|--no-json]
 */

import { Command } from 'commander'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildPrintableModel } from '../pipeline.js'
import { validateMesh } from '../validate.js'
import { DEFAULT_SHELL_THICKNESS_MM } from '../pipelineUtils.js'
import { MIN_FRAME_HEIGHT_MM } from '../frameSplit.js'
import { hasMiterBase, hasMiterWall } from '../frameSplitConstants.js'
import { Bounds, ExportOptions, Lod } from '../types.js'
import type {
  EngravingAlign,
  EngravingFace,
  EngravingLine,
  EngravingOptions,
} from '../engraving/types.js'
import { ENGRAVING_ALIGNS, ENGRAVING_FACES, defaultEngravingOptions } from '../engraving/types.js'
import { configureNodeEngravingFont } from '../engraving/nodeFont.js'

export const program = new Command()

program
  .name('machimoki')
  .description('Build printable 3D models from PLATEAU data')
  .version('1.0.0')

export function parseBounds(value: string): Bounds {
  const parts = value.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid bounds format: ${value}. Expected west,south,east,north`)
  }
  const [west, south, east, north] = parts
  if (west >= east || south >= north) {
    throw new Error(`Invalid bounds: west=${west}, south=${south}, east=${east}, north=${north}`)
  }
  return { west, south, east, north }
}

export function parseFormat(value: string): '3mf' | 'stl' {
  const lower = value.toLowerCase()
  if (lower !== '3mf' && lower !== 'stl') {
    throw new Error(`Invalid format: ${value}. Expected 3mf or stl`)
  }
  return lower
}

export function parseLod(value: string): Lod {
  const lower = value.toLowerCase()
  if (lower !== 'lod1' && lower !== 'lod2' && lower !== 'lod3' && lower !== 'lod4') {
    throw new Error(`Invalid LOD: ${value}. Expected lod1, lod2, lod3 or lod4`)
  }
  return lower
}

export function parseUpAxis(value: string): 'z-up' | 'y-up' {
  const lower = value.toLowerCase()
  if (lower !== 'z-up' && lower !== 'y-up') {
    throw new Error(`Invalid up-axis: ${value}. Expected z-up or y-up`)
  }
  return lower
}

function parseEngravingNumber(label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number`)
  }
  return value
}

function parseEngravingFace(value: unknown): EngravingFace {
  if (typeof value === 'string' && (ENGRAVING_FACES as readonly string[]).includes(value)) {
    return value as EngravingFace
  }
  throw new Error(
    `Invalid engraving.face: ${String(value)}. Expected one of ${ENGRAVING_FACES.join(', ')}`,
  )
}

function parseEngravingAlign(value: unknown): EngravingAlign {
  if (typeof value === 'string' && (ENGRAVING_ALIGNS as readonly string[]).includes(value)) {
    return value as EngravingAlign
  }
  throw new Error(
    `Invalid engraving.align: ${String(value)}. Expected one of ${ENGRAVING_ALIGNS.join(', ')}`,
  )
}

function parseEngravingLine(value: unknown, index: number): EngravingLine {
  const label = `engraving.lines[${index}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`)
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') {
    throw new Error(`Invalid ${label}.id: expected a string`)
  }
  if (typeof record.text !== 'string') {
    throw new Error(`Invalid ${label}.text: expected a string`)
  }
  const sizeMm = parseEngravingNumber(`${label}.sizeMm`, record.sizeMm)
  if (sizeMm <= 0) {
    throw new Error(`Invalid ${label}.sizeMm: expected a number > 0`)
  }
  if (record.auto !== undefined && typeof record.auto !== 'boolean') {
    throw new Error(`Invalid ${label}.auto: expected a boolean`)
  }
  const line: EngravingLine = { id: record.id, text: record.text, sizeMm }
  if (record.auto !== undefined) line.auto = record.auto as boolean
  return line
}

/**
 * 刻印設定のJSONオブジェクトを `EngravingOptions` にマージ・検証する。
 *
 * `defaultEngravingOptions()` をベースに、指定されたキーだけを上書きする。
 * enabled は明示しない限り false（JSONに enabled: true が必要）。
 * 型が違う値は分かりやすいメッセージの Error にする（CLI/APIの400に対応）。
 */
export function mergeEngravingOptions(input: unknown): EngravingOptions {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid engraving settings: expected a JSON object')
  }
  const record = input as Record<string, unknown>
  const defaults = defaultEngravingOptions()
  const options: EngravingOptions = { ...defaults, printProfile: { ...defaults.printProfile } }

  if (record.enabled !== undefined) {
    if (typeof record.enabled !== 'boolean') {
      throw new Error('Invalid engraving.enabled: expected a boolean')
    }
    options.enabled = record.enabled
  }
  if (record.face !== undefined) {
    options.face = parseEngravingFace(record.face)
  }
  if (record.centerX !== undefined) {
    options.centerX = parseEngravingNumber('engraving.centerX', record.centerX)
  }
  if (record.centerY !== undefined) {
    options.centerY = parseEngravingNumber('engraving.centerY', record.centerY)
  }
  if (record.lineGapMm !== undefined) {
    const lineGapMm = parseEngravingNumber('engraving.lineGapMm', record.lineGapMm)
    if (lineGapMm < 0) {
      throw new Error('Invalid engraving.lineGapMm: expected a number >= 0')
    }
    options.lineGapMm = lineGapMm
  }
  if (record.align !== undefined) {
    options.align = parseEngravingAlign(record.align)
  }
  if (record.depthMm !== undefined) {
    const depthMm = parseEngravingNumber('engraving.depthMm', record.depthMm)
    if (depthMm <= 0) {
      throw new Error('Invalid engraving.depthMm: expected a number > 0')
    }
    options.depthMm = depthMm
  }
  if (record.wrap !== undefined) {
    if (typeof record.wrap !== 'boolean') {
      throw new Error('Invalid engraving.wrap: expected a boolean')
    }
    options.wrap = record.wrap
  }
  if (record.lines !== undefined) {
    if (!Array.isArray(record.lines)) {
      throw new Error('Invalid engraving.lines: expected an array')
    }
    options.lines = record.lines.map((line, index) => parseEngravingLine(line, index))
  }
  if (record.printProfile !== undefined) {
    if (
      typeof record.printProfile !== 'object' ||
      record.printProfile === null ||
      Array.isArray(record.printProfile)
    ) {
      throw new Error('Invalid engraving.printProfile: expected an object')
    }
    const profile = record.printProfile as Record<string, unknown>
    const nozzleMm =
      profile.nozzleMm === undefined
        ? defaults.printProfile.nozzleMm
        : parseEngravingNumber('engraving.printProfile.nozzleMm', profile.nozzleMm)
    const layerHeightMm =
      profile.layerHeightMm === undefined
        ? defaults.printProfile.layerHeightMm
        : parseEngravingNumber('engraving.printProfile.layerHeightMm', profile.layerHeightMm)
    if (nozzleMm <= 0) {
      throw new Error('Invalid engraving.printProfile.nozzleMm: expected a number > 0')
    }
    if (layerHeightMm <= 0) {
      throw new Error('Invalid engraving.printProfile.layerHeightMm: expected a number > 0')
    }
    options.printProfile = { nozzleMm, layerHeightMm }
  }
  return options
}

/** 刻印設定JSON文字列をパースして `EngravingOptions` にする。 */
export function parseEngravingOptionsJson(json: string): EngravingOptions {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid engraving JSON: ${message}`)
  }
  return mergeEngravingOptions(parsed)
}

/** `--engraving-file` のJSONファイルを読み込んで `EngravingOptions` にする。 */
export async function readEngravingOptionsFile(path: string): Promise<EngravingOptions> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`刻印設定ファイルを読み込めません: ${path}（${message}）`)
  }
  return parseEngravingOptionsJson(text)
}

export function detectMimeType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.3mf')) return 'model/3mf'
  if (lower.endsWith('.stl')) return 'model/stl'
  throw new Error(`Unsupported file extension: ${filePath}. Expected .3mf or .stl`)
}

/**
 * 分割出力のファイル名を `--output` から導出する。
 * `model.3mf` -> `model_base.3mf` / `model_buildings.3mf`
 */
export function splitOutputPaths(outputPath: string): {
  basePath: string
  buildingsPath: string
} {
  const ext = extname(outputPath)
  if (!ext) {
    throw new Error(`分割出力には拡張子が必要です: ${outputPath}. Expected .3mf or .stl`)
  }
  const stem = outputPath.slice(0, -ext.length)
  return {
    basePath: `${stem}_base${ext}`,
    buildingsPath: `${stem}_buildings${ext}`,
  }
}

export interface PickPoint {
  lon: number
  lat: number
}

export function parsePickPoint(value: string): PickPoint {
  const parts = value.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid pick-point format: ${value}. Expected lon,lat`)
  }
  const [lon, lat] = parts
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`Invalid pick-point: lon=${lon}, lat=${lat}`)
  }
  return { lon, lat }
}

function collectPickPoint(value: string, previous: PickPoint[]): PickPoint[] {
  return [...previous, parsePickPoint(value)]
}

function collectExcludeGmlId(value: string, previous: string[]): string[] {
  return [...previous, value]
}

program
  .command('export')
  .description('Export a printable 3D model')
  .requiredOption('--bounds <west,south,east,north>', 'geographic bounds', parseBounds)
  .requiredOption('--terrain-thickness <number>', 'printed terrain thickness in mm', (value) => {
    const num = Number(value)
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid terrain thickness: ${value}`)
    }
    return num
  })
  .option('--flatten-bottom', 'flatten the bottom surface', true)
  .option('--no-flatten-bottom', 'do not flatten the bottom surface')
  .option(
    '--reflect-actual-elevation',
    'place the model base at sea level (reflect actual elevation)',
    false,
  )
  .option('--format <3mf|stl>', 'output format', parseFormat, '3mf')
  .requiredOption('--output <file>', 'output file path')
  .option('--lod <lod1|lod2|lod3|lod4>', 'building LOD', parseLod, 'lod1')
  .option('--up-axis <z-up|y-up>', 'which axis points up in the output', parseUpAxis, 'z-up')
  .option('--terrain', 'include terrain generation', true)
  .option('--no-terrain', 'skip terrain generation')
  .option(
    '--include-spanning-buildings',
    'include buildings that span the selection boundary',
    false,
  )
  .option(
    '--pick-point <lon,lat>',
    'keep only buildings whose footprint contains the point (repeatable)',
    collectPickPoint,
    [],
  )
  .option(
    '--exclude-gmlid <id>',
    'exclude a building by gmlid (repeatable)',
    collectExcludeGmlId,
    [],
  )
  .option('--terrain-grid <number>', 'terrain mesh subdivisions (NxN, integer 4-512)', (value) => {
    const num = Number(value)
    if (!Number.isInteger(num) || num < 4 || num > 512) {
      throw new Error(`Invalid terrain grid: ${value}. Expected integer 4-512`)
    }
    return num
  })
  .option(
    '--scale <number>',
    'uniform scale factor (>0)',
    (value) => {
      const num = Number(value)
      if (Number.isNaN(num) || num <= 0) {
        throw new Error(`Invalid scale: ${value}. Must be > 0`)
      }
      return num
    },
    1,
  )
  .option('--open-bottom', 'export an open-bottomed hollow shell', false)
  .option('--shell-thickness <number>', 'shell wall/ceiling thickness in mm (>0)', (value) => {
    const num = Number(value)
    if (Number.isNaN(num) || num <= 0) {
      throw new Error(`Invalid shell thickness: ${value}. Must be > 0`)
    }
    return num
  })
  .option('--hollow-buildings', 'hollow building interiors (requires --open-bottom)', true)
  .option('--no-hollow-buildings', 'keep building interiors solid')
  .option(
    '--split-at-ground',
    'split into a terrain frame and a buildings part that sits on top',
    false,
  )
  .option(
    '--engraving <json>',
    'engraving settings as JSON (merged with defaults; needs "enabled": true). ' +
      'Example: {"enabled":true,"face":"bottom","lines":[{"id":"t","text":"...","sizeMm":8}]}',
  )
  .option('--engraving-file <path>', 'read engraving settings JSON from a file')
  .action(async (options) => {
    const shellThickness = options.shellThickness ?? DEFAULT_SHELL_THICKNESS_MM
    if (options.openBottom && shellThickness > options.terrainThickness - MIN_FRAME_HEIGHT_MM) {
      throw new Error(
        `Invalid shell thickness: ${shellThickness}. Terrain thickness must be at least ` +
          `shell thickness + ${MIN_FRAME_HEIGHT_MM}mm (${options.terrainThickness}mm)`,
      )
    }
    if (options.splitAtGround && !hasMiterWall(options.terrainThickness, shellThickness)) {
      throw new Error(
        `Invalid shell thickness: ${shellThickness}. Terrain thickness must be greater than ` +
          `shell thickness * 1.9 (${options.terrainThickness}mm)`,
      )
    }
    if (options.splitAtGround && !hasMiterBase(options.terrainThickness, shellThickness)) {
      throw new Error(
        `Invalid shell thickness: ${shellThickness}. Terrain thickness must be greater than ` +
          `shell thickness * 1.9 + 0.2mm (${options.terrainThickness}mm)`,
      )
    }
    if (options.splitAtGround) {
      if (!options.terrain) {
        throw new Error('--split-at-ground requires terrain (do not use --no-terrain)')
      }
      if (!options.openBottom) {
        throw new Error('--split-at-ground requires --open-bottom')
      }
    }

    const exportOptions: ExportOptions = {
      terrainThickness: options.terrainThickness,
      flattenBottom: options.flattenBottom,
      reflectActualElevation: options.reflectActualElevation,
      format: options.format,
      lod: options.lod,
      includeTerrain: options.terrain,
      upAxis: options.upAxis,
      scale: options.scale,
      includeSpanningBuildings: options.includeSpanningBuildings,
      openBottom: options.openBottom,
      shellThickness: options.shellThickness,
      hollowBuildings: options.hollowBuildings,
      splitAtGround: options.splitAtGround,
      pickPoints: options.pickPoint.length > 0 ? options.pickPoint : undefined,
      excludedGmlIds: options.excludeGmlid.length > 0 ? options.excludeGmlid : undefined,
    }

    if (options.terrainGrid !== undefined) {
      exportOptions.terrainGridSize = options.terrainGrid
    }

    // 刻印設定: --engraving（JSON文字列）か --engraving-file（JSONファイル）の
    // どちらか一方。enabled のときだけ同梱フォントを有効化する。
    if (options.engraving !== undefined || options.engravingFile !== undefined) {
      if (options.engraving !== undefined && options.engravingFile !== undefined) {
        throw new Error('--engraving と --engraving-file は同時に指定できません')
      }
      const engraving: EngravingOptions =
        options.engraving !== undefined
          ? parseEngravingOptionsJson(options.engraving)
          : await readEngravingOptionsFile(options.engravingFile)
      exportOptions.engraving = engraving
      if (engraving.enabled) {
        configureNodeEngravingFont()
        if (exportOptions.format === 'stl') {
          console.error(
            'Warning: STLはメタデータを持てないため、刻印テキストはファイルに保存されません',
          )
        }
      } else {
        console.error(
          'Warning: 刻印設定が enabled=false のため刻印しません（enabled: true を指定してください）',
        )
      }
    }

    console.error(`Building ${exportOptions.format.toUpperCase()} model for bounds`, options.bounds)

    const { buffer, warnings, split } = await buildPrintableModel(options.bounds, exportOptions)
    for (const warning of warnings) {
      console.error(`Warning: ${warning}`)
    }

    if (options.splitAtGround) {
      if (!split) {
        throw new Error('分割モデルが返りませんでした')
      }
      const { basePath, buildingsPath } = splitOutputPaths(options.output)
      await writeFile(basePath, split.base)
      await writeFile(buildingsPath, split.buildings)
      console.error(`Wrote ${split.base.length} bytes to ${basePath}`)
      console.error(`Wrote ${split.buildings.length} bytes to ${buildingsPath}`)

      const [baseResult, buildingsResult] = await Promise.all([
        validateMesh(split.base, detectMimeType(basePath)),
        validateMesh(split.buildings, detectMimeType(buildingsPath)),
      ])
      if (baseResult.status === 'fail' || buildingsResult.status === 'fail') {
        const failedName = baseResult.status === 'fail' ? 'base' : 'buildings'
        const failedResult = baseResult.status === 'fail' ? baseResult : buildingsResult
        console.error(`Validation fail (${failedName}): ${JSON.stringify(failedResult)}`)
        await Promise.all([unlink(basePath), unlink(buildingsPath)])
        process.exit(2)
      }
      for (const [name, result] of [
        ['base', baseResult],
        ['buildings', buildingsResult],
      ] as const) {
        if (result.status === 'warning') {
          console.error(`Validation warning (${name}): ${JSON.stringify(result)}`)
        } else {
          console.error(`Validation pass (${name}): ${JSON.stringify(result)}`)
        }
      }
      return
    }

    await writeFile(options.output, buffer)
    console.error(`Wrote ${buffer.length} bytes to ${options.output}`)

    const mimeType = detectMimeType(options.output)
    const result = await validateMesh(buffer, mimeType)
    if (result.status === 'fail') {
      console.error(`Validation fail: ${JSON.stringify(result)}`)
      await unlink(options.output)
      process.exit(2)
    }
    if (result.status === 'warning') {
      console.error(`Validation warning: ${JSON.stringify(result)}`)
    } else {
      console.error(`Validation pass: ${JSON.stringify(result)}`)
    }
  })

program
  .command('validate')
  .description('Validate a 3MF or STL file')
  .requiredOption('--file <path>', 'input file path')
  .option('--json', 'output JSON to stdout', true)
  .option('--no-json', 'output plain text to stdout')
  .action(async (options) => {
    const buffer = await readFile(options.file)
    const mimeType = detectMimeType(options.file)
    const result = await validateMesh(buffer, mimeType)

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`Status: ${result.status}`)
      console.log(`Triangles: ${result.numTri}`)
      console.log(`Volume: ${result.volume}`)
      console.log(`Status code: ${result.statusCode}`)
    }

    if (result.status === 'fail') {
      process.exit(2)
    }
    if (result.status === 'warning') {
      process.exit(1)
    }
  })

export async function run(argv: string[]): Promise<void> {
  await program.parseAsync(argv)
}

function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch {
    return false
  }
}

if (isMainModule()) {
  run(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`Unexpected error: ${message}`)
    process.exit(1)
  })
}
