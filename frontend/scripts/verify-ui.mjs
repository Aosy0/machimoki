#!/usr/bin/env node
// Playwright ベースのヘッドレス動作確認スクリプト。
// 結果 JSON を stdout に、ログは stderr に出力する。
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const USAGE = `Usage: node scripts/verify-ui.mjs [options]

Options:
  --scenario <map|drag|preview>   シナリオ (既定: map)
  --bounds <west,south,east,north>
  --drag <x1,y1,x2,y2>            0〜1 の相対座標 (scenario=drag)
  --shot                          スクリーンショットを保存
  --out <path>                    画像の出力パス
  --selector <css>                指定要素だけ撮影
  --clip <x,y,w,h>                指定矩形だけ撮影
  --headed                        ブラウザを表示
  --viewport <WxH>                既定: 1280x720
  --timeout <ms>                  既定: 30000
  --export                        preview 後にエクスポートを実行
  --export-out <path>             エクスポート先 (既定: .screenshots/export-<timestamp>)
  --fail-on-console               console.error を失敗扱いにする
  --base-url <url>                既定: http://localhost:5173
  --help
`

function log(...args) {
  console.error('[verify-ui]', ...args)
}

function parseNumbers(value) {
  return value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
}

function parseViewport(value) {
  const [w, h] = value.split('x').map((n) => Number(n.trim()))
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null
  return { width: w, height: h }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function waitForServer(baseUrl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(baseUrl, { signal: controller.signal })
    return res.ok || res.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function emit(result, ok) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = ok ? 0 : 1
}

async function main() {
  let parsed
  try {
    parsed = parseArgs({
      options: {
        scenario: { type: 'string', default: 'map' },
        bounds: { type: 'string' },
        drag: { type: 'string' },
        shot: { type: 'boolean', default: false },
        out: { type: 'string' },
        selector: { type: 'string' },
        clip: { type: 'string' },
        headed: { type: 'boolean', default: false },
        viewport: { type: 'string', default: '1280x720' },
        timeout: { type: 'string', default: '30000' },
        export: { type: 'boolean', default: false },
        'export-out': { type: 'string' },
        'fail-on-console': { type: 'boolean', default: false },
        'base-url': { type: 'string', default: 'http://localhost:5173' },
        help: { type: 'boolean', default: false },
      },
      allowPositionals: false,
    })
  } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}`)
    process.exitCode = 1
    return
  }

  const { values } = parsed
  if (values.help) {
    process.stderr.write(USAGE)
    return
  }

  if (!['map', 'drag', 'preview'].includes(values.scenario)) {
    process.stderr.write(`不明な scenario: ${values.scenario}\n${USAGE}`)
    process.exitCode = 1
    return
  }

  const baseUrl = values['base-url'].replace(/\/$/, '')
  const viewport = parseViewport(values.viewport)
  if (!viewport) {
    process.stderr.write(`不正な --viewport: ${values.viewport}\n`)
    process.exitCode = 1
    return
  }
  const timeout = Number(values.timeout) || 30000
  const bounds = values.bounds ? parseNumbers(values.bounds) : []

  const startedAt = Date.now()
  const result = {
    ok: false,
    scenario: values.scenario,
    url: baseUrl,
    viewport: values.viewport,
    selection: null,
    selectionInfo: null,
    pipeline: null,
    cesiumReady: false,
    consoleErrors: [],
    pageErrors: [],
    shot: null,
    exportFile: null,
    exportBytes: null,
    durationMs: 0,
    error: null,
  }

  if (!(await waitForServer(baseUrl))) {
    result.error = 'dev-server-unreachable'
    result.durationMs = Date.now() - startedAt
    process.stderr.write(
      '開発サーバーが起動していません。別ペインで npm run dev を実行してください\n',
    )
    emit(result, false)
    return
  }

  const browser = await chromium.launch({
    headless: !values.headed,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })

  try {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)

    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      result.pageErrors.push(String(err?.message ?? err))
    })

    let webglError = false
    let selectionInfo = null
    let pipeline = null
    let cesiumReady = false
    let shot = null
    let exportFile = null
    let exportBytes = null

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="map2d-coord-panel"]', {
      state: 'attached',
      timeout,
    })
    webglError = (await page.locator('[data-testid="map2d-webgl-error"]').count()) > 0

    const applyBounds = async () => {
      if (bounds.length !== 4) {
        throw new Error(`--bounds は west,south,east,north の4値が必要です: ${values.bounds}`)
      }
      const [west, south, east, north] = bounds
      await page.waitForFunction(() => typeof window.__applyPreset === 'function', null, {
        timeout,
      })
      await page.evaluate(
        (b) => window.__applyPreset(b),
        { west, south, east, north },
      )
      result.selection = { west, south, east, north }
    }

    const readSelectionInfo = async () => {
      const locator = page.locator('[data-testid="map-selection-info"]')
      await locator.waitFor({ state: 'visible', timeout })
      return (await locator.first().textContent())?.replace(/\s+/g, ' ').trim() ?? null
    }

    if (values.scenario === 'map') {
      await applyBounds()
      selectionInfo = await readSelectionInfo()
    } else if (values.scenario === 'drag') {
      const box = await page.locator('.maplibregl-canvas').first().boundingBox()
      if (!box) throw new Error('.maplibregl-canvas の boundingBox を取得できません')
      const rel = values.drag ? parseNumbers(values.drag) : [0.2, 0.2, 0.7, 0.7]
      if (rel.length !== 4) throw new Error(`--drag は x1,y1,x2,y2 の4値が必要です: ${values.drag}`)
      const toAbs = (rx, ry) => ({ x: box.x + box.width * rx, y: box.y + box.height * ry })
      const [x1, y1, x2, y2] = rel
      const start = toAbs(x1, y1)
      const end = toAbs(x2, y2)
      await page.keyboard.down('Shift')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 15 })
      await page.mouse.up()
      await page.keyboard.up('Shift')
      selectionInfo = await readSelectionInfo()
    } else {
      await applyBounds()
      await page.getByRole('button', { name: '3Dプレビュー' }).click()
      await page.waitForSelector('[data-testid="preview-canvas"]', { state: 'visible', timeout })
      try {
        // App が公開している pipelineState を正とする。オーバーレイの一瞬の消滅では完了扱いにしない。
        await page.waitForFunction(
          () => {
            const phase = window.__pipelineState?.phase
            return phase === 'complete' || phase === 'error'
          },
          null,
          { timeout, polling: 250 },
        )
        pipeline = await page.evaluate(() => window.__pipelineState?.phase ?? 'unknown')
        cesiumReady = await page.evaluate(() => Boolean(window.__cesiumViewer))
        if (pipeline === 'complete') {
          await page
            .locator('[data-testid="loading-overlay"]')
            .waitFor({ state: 'detached', timeout })
            .catch(() => {})
        }
      } catch {
        cesiumReady = await page.evaluate(() => Boolean(window.__cesiumViewer))
        pipeline = 'timeout'
      }

      if (values.export) {
        await page.click('[data-testid="export-button"]')
        const download = await page.waitForEvent('download', { timeout })
        const suggested = download.suggestedFilename() ?? 'export.glb'
        const ext = suggested.includes('.') ? suggested.split('.').pop() : 'glb'
        exportFile =
          values['export-out'] ??
          join(REPO_ROOT, '.screenshots', `export-${timestamp()}.${ext}`)
        mkdirSync(dirname(exportFile), { recursive: true })
        await download.saveAs(exportFile)
        exportBytes = statSync(exportFile).size
      }
    }

    if (values.shot) {
      const shotPath =
        values.out ?? join(REPO_ROOT, '.screenshots', `verify-${values.scenario}-${timestamp()}.png`)
      mkdirSync(dirname(shotPath), { recursive: true })
      if (values.selector) {
        await page.locator(values.selector).first().screenshot({ path: shotPath })
      } else if (values.clip) {
        const [x, y, w, h] = parseNumbers(values.clip)
        await page.screenshot({ path: shotPath, clip: { x, y, width: w, height: h } })
      } else {
        await page.screenshot({ path: shotPath })
      }
      shot = shotPath
    }

    result.selectionInfo = selectionInfo
    result.pipeline = pipeline
    result.cesiumReady = cesiumReady
    result.shot = shot
    result.exportFile = exportFile
    result.exportBytes = exportBytes

    const scenarioOk =
      values.scenario === 'preview'
        ? cesiumReady && pipeline === 'complete'
        : selectionInfo !== null

    result.ok =
      !webglError &&
      result.pageErrors.length === 0 &&
      scenarioOk &&
      (!values['fail-on-console'] || result.consoleErrors.length === 0)
    if (webglError) result.error = 'webgl-error'
    else if (!scenarioOk) result.error = `scenario-${values.scenario}-failed`
    else if (values['fail-on-console'] && result.consoleErrors.length > 0)
      result.error = 'console-errors'
  } catch (err) {
    result.error = String(err?.message ?? err)
    result.ok = false
  } finally {
    await browser.close().catch(() => {})
  }

  result.durationMs = Date.now() - startedAt
  emit(result, result.ok)
}

await main()
