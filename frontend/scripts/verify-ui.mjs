#!/usr/bin/env node
// Playwright ベースのヘッドレス動作確認スクリプト。
// 結果 JSON を stdout に、ログは stderr に出力する。
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'
import { unzipSync } from 'fflate'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const USAGE = `Usage: node scripts/verify-ui.mjs [options]

Options:
  --scenario <map|drag|preview|touch> シナリオ (既定: map)
  --bounds <west,south,east,north>
  --drag <x1,y1,x2,y2>            0〜1 の相対座標 (scenario=drag)
  --shot                          スクリーンショットを保存
  --out <path>                    画像の出力パス
  --selector <css>                指定要素だけ撮影
  --clip <x,y,w,h>                指定矩形だけ撮影
  --headed                        ブラウザを表示
  --viewport <WxH>                既定: 1280x720 (--device 指定時はデバイス値)
  --device <name>                 Playwrightデバイス名 (例: iPhone 15, Pixel 9)
  --network <slow4g>              ネットワークをSlow 4G相当に制限
  --profile                       3Dプレビューの読み込みプロファイルを出力
  --timeout <ms>                  既定: 30000
  --export                        preview 後にエクスポートを実行
  --export-out <path>             エクスポート先 (既定: .screenshots/export-<timestamp>)
  --split                         分割印刷パラメータ（openBottom + splitAtGround）で確認
  --layers <brid,tran>            橋梁・道路の重ね表示をONにして確認 (preview)
  --engrave                       刻印パラメータで確認（パネル・面プレビュー・エクスポートのメタデータ）
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
        device: { type: 'string' },
        network: { type: 'string' },
        profile: { type: 'boolean', default: false },
        timeout: { type: 'string', default: '30000' },
        export: { type: 'boolean', default: false },
        split: { type: 'boolean', default: false },
        engrave: { type: 'boolean', default: false },
        layers: { type: 'string' },
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

  if (values.network !== undefined && values.network !== 'slow4g') {
    process.stderr.write(`不明な --network: ${values.network}（slow4g のみ対応）\n`)
    process.exitCode = 1
    return
  }
  if (!['map', 'drag', 'preview', 'touch'].includes(values.scenario)) {
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
  const deviceName = values.device ?? (values.scenario === 'touch' ? 'iPhone 15' : null)
  const device = deviceName ? devices[deviceName] : null
  if (deviceName && !device) {
    process.stderr.write(
      `不明な --device: ${deviceName}\n利用可能: ${Object.keys(devices).join(', ')}\n`,
    )
    process.exitCode = 1
    return
  }
  const effectiveViewport = device ? device.viewport : viewport
  const contextOptions = device ? { ...device } : { viewport }

  const startedAt = Date.now()
  const result = {
    ok: false,
    scenario: values.scenario,
    url: baseUrl,
    device: deviceName,
    network: values.network ?? 'none',
    viewport: `${effectiveViewport.width}x${effectiveViewport.height}`,
    previewProfile: null,
    selection: null,
    selectionInfo: null,
    pipeline: null,
    cesiumReady: false,
    longPressSelection: null,
    selectModeChanged: null,
    twoFingerSelectionUnchanged: null,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    shot: null,
    exportFile: null,
    exportBytes: null,
    splitEntries: null,
    engravingPanel: null,
    engravingModeBanner: null,
    engravingSettingsHidden: null,
    engravingGlyphPaths: null,
    engravingViewFace: null,
    engravingZoom: null,
    engravingOverlayVisible: null,
    engravingOverlayDrag: null,
    engravingResize: null,
    engravingOverflowWarning: null,
    engravingOverflowStroke: null,
    engravingViewApi: null,
    engravingMetadata: null,
    layers: null,
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
    const context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)

    page.on('console', (msg) => {
      if (msg.type() === 'error') result.consoleErrors.push(msg.text())
      else if (msg.type() === 'warning') result.consoleWarnings.push(msg.text())
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

    // 分割印刷・刻印の確認時は、アプリ起動前に local storage のパラメータを設定する。
    if (values.split || values.engrave) {
      await page.addInitScript(
        ({ split, engrave }) => {
          const parameters = {
            includeTerrain: true,
            terrainThickness: 10,
            flattenBottom: true,
            shellThickness: 1.6,
            hollowBuildings: true,
          }
          if (split) {
            Object.assign(parameters, { openBottom: true, splitAtGround: true })
          }
          if (engrave) {
            parameters.engraving = {
              enabled: true,
              face: 'bottom',
              centerX: 0.5,
              centerY: 0.5,
              lineGapMm: 1.5,
              lines: [
                { id: 'place', text: '東京都新宿区', sizeMm: 6, auto: true },
                { id: 'coords', text: '35.69000N 139.69100E', sizeMm: 3.5, auto: true },
                { id: 'scale', text: '1:1,333  W150 x D100 x T10 mm', sizeMm: 3.5, auto: true },
                { id: 'attribution', text: '© PLATEAU (MLIT)', sizeMm: 3.5, auto: true },
                { id: 'date', text: '2026.11', sizeMm: 3.5, auto: true },
              ],
              depthMm: 0.4,
              printProfile: { nozzleMm: 0.4, layerHeightMm: 0.2 },
              wrap: true,
            }
          }
          localStorage.setItem('machimoki.parameters', JSON.stringify(parameters))
        },
        { split: values.split, engrave: values.engrave },
      )
    }

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid="map2d-container"]', {
      state: 'attached',
      timeout,
    })
    webglError = (await page.locator('[data-testid="map2d-webgl-error"]').count()) > 0

    // アプリ本体（Viteの開発用モジュール）は通常速度で読み込み、3Dタイル取得だけを
    // モバイル回線相当にする。goto前に絞ると開発サーバー自体がタイムアウトするため。
    if (values.network === 'slow4g') {
      const networkCdp = await context.newCDPSession(page)
      await networkCdp.send('Network.enable')
      await networkCdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 200000,
        uploadThroughput: 84480,
        connectionType: 'cellular4g',
      })
    }

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
    } else if (values.scenario === 'touch') {
      const cdp = await context.newCDPSession(page)
      const canvas = page.locator('.maplibregl-canvas').first()
      const box = await canvas.boundingBox()
      if (!box) throw new Error('.maplibregl-canvas の boundingBox を取得できません')
      const pt = (rx, ry) => ({ x: box.x + box.width * rx, y: box.y + box.height * ry })
      const dispatch = async (type, points) => {
        await cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: points.map((p, i) => ({
            x: p.x,
            y: p.y,
            id: i,
            radiusX: 8,
            radiusY: 8,
            force: 1,
          })),
        })
      }
      const readBounds = () =>
        page.evaluate(() => localStorage.getItem('machimoki.selectionBounds'))

      // 1) 移動モード: 1本指長押し→ドラッグで矩形選択
      await dispatch('touchStart', [pt(0.2, 0.3)])
      await page.waitForTimeout(420)
      await dispatch('touchMove', [pt(0.55, 0.55)])
      await dispatch('touchEnd', [])
      result.longPressSelection = await readBounds()
      selectionInfo = await readSelectionInfo()

      // 2) 範囲選択モード: 1本指ドラッグで矩形選択
      await page.locator('[data-testid="map-mode-select"]').click()
      const beforeSelect = await readBounds()
      await dispatch('touchStart', [pt(0.3, 0.2)])
      await dispatch('touchMove', [pt(0.7, 0.5)])
      await dispatch('touchEnd', [])
      const afterSelect = await readBounds()
      result.selectModeChanged = beforeSelect !== afterSelect
      selectionInfo = await readSelectionInfo()

      // 3) 2本指はモードに関係なく移動＋拡大。選択は置き換わらない。
      const beforeTwo = await readBounds()
      await dispatch('touchStart', [pt(0.3, 0.4), pt(0.5, 0.4)])
      await dispatch('touchMove', [pt(0.34, 0.44), pt(0.54, 0.44)])
      await dispatch('touchEnd', [])
      const afterTwo = await readBounds()
      result.twoFingerSelectionUnchanged = beforeTwo === afterTwo
      selectionInfo = await readSelectionInfo()
    } else {
      await applyBounds()
      await page.getByRole('tab', { name: '3Dプレビュー' }).click()
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

      if (values.profile) {
        result.previewProfile = await page.evaluate(
          () => window.__previewLoadProfile ?? null,
        )
      }

      if (values.layers) {
        // 橋梁・道路レイヤーの重ね表示をONにする。3Dデータが無い自治体ではスイッチが無効。
        const toggles = { brid: 'bridges-toggle', tran: 'roads-toggle' }
        const state = {}
        const countTilesets = () =>
          page.evaluate(() => {
            const scene = window.__cesiumViewer?.scene
            if (!scene) return null
            let count = 0
            scene.primitives?._primitives?.forEach?.((p) => {
              if (p && p.asset) count += 1
            })
            return count
          })

        const beforeTilesets = await countTilesets()
        for (const name of values.layers.split(',').map((s) => s.trim()).filter(Boolean)) {
          const testId = toggles[name]
          if (!testId) throw new Error(`不明な --layers: ${name}（brid,tran）`)
          const toggle = page.locator(`[data-testid="${testId}"]`)
          await toggle.waitFor({ state: 'attached', timeout })
          const available = !(await toggle.isDisabled())
          state[name] = { available }
          if (!available) continue
          if (!(await toggle.isChecked())) await toggle.click()
          state[name].checked = await toggle.isChecked()
        }
        // レイヤーのタイル取得には完了通知が無いため、タイルセットの増加を待つ（上限つき）。
        if (Object.values(state).some((s) => s.checked)) {
          await page
            .waitForFunction(
              ({ before }) => {
                const scene = window.__cesiumViewer?.scene
                if (!scene) return true
                let count = 0
                scene.primitives?._primitives?.forEach?.((p) => {
                  if (p && p.asset) count += 1
                })
                return before === null || count > before
              },
              { before: beforeTilesets },
              { timeout: Math.min(timeout, 20000), polling: 250 },
            )
            .catch(() => {})
          // 初回表示はタイルの中身が揃うまで時間がかかる。
          await page.waitForTimeout(1500)
        }
        const afterTilesets = await countTilesets()
        if (beforeTilesets !== null && afterTilesets !== null) {
          state.addedTilesets = afterTilesets - beforeTilesets
        }
        result.layers = state
      }

      if (values.engrave) {
        // 刻印モード専用UIへ入る（右の設定パネルは隠れ、上部にモードバナーが出る）。
        await page.waitForSelector('[data-testid="engraving-mode-button"]', {
          state: 'visible',
          timeout,
        })
        await page.click('[data-testid="engraving-mode-button"]')
        await page.waitForSelector('[data-testid="engraving-mode-banner"]', {
          state: 'visible',
          timeout,
        })
        result.engravingModeBanner = true
        result.engravingSettingsHidden =
          (await page.locator('[data-testid="export-button"]').count()) === 0
        // 刻印モード: パネル表示・フォント読込（面プレビューのグリフpath）・面ビュー適用。
        await page.waitForSelector('[data-testid="engraving-panel"]', {
          state: 'visible',
          timeout,
        })
        result.engravingPanel = true
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="engraving-preview"] path').length > 0,
          null,
          { timeout, polling: 100 },
        )
        result.engravingGlyphPaths = await page.evaluate(
          () => document.querySelectorAll('[data-testid="engraving-preview"] path').length,
        )
        result.engravingViewApi = await page.evaluate(
          () => typeof window.__previewControls?.viewEngravingFace === 'function',
        )
        // 完成形状の表示（刻印面ビュー適用）まで待つ。未適用なら null のまま。
        try {
          await page.waitForFunction(
            () => window.__previewControls?.getEngravingViewFace?.() != null,
            null,
            { timeout: 120000, polling: 500 },
          )
        } catch {
          // 面ビューが未適用でもエクスポート確認は続行する。
        }
        result.engravingViewFace = await page.evaluate(
          () => window.__previewControls?.getEngravingViewFace?.() ?? null,
        )
        // モード中のズームボタンでカメラ距離が変わることを確認する。
        try {
          await page.waitForTimeout(1200)
          const heightBefore = await page.evaluate(
            () => window.__cesiumViewer?.camera?.positionCartographic?.height ?? null,
          )
          await page.click('[data-testid="engraving-zoom-out"]')
          await page.waitForTimeout(800)
          const heightAfter = await page.evaluate(
            () => window.__cesiumViewer?.camera?.positionCartographic?.height ?? null,
          )
          result.engravingZoom = {
            before: heightBefore === null ? null : Math.round(heightBefore * 10) / 10,
            after: heightAfter === null ? null : Math.round(heightAfter * 10) / 10,
            changed:
              heightBefore !== null &&
              heightAfter !== null &&
              Math.abs(heightAfter - heightBefore) > 1,
          }
        } catch {
          result.engravingZoom = null
        }
        // 行の揃えボタンで、ブロック内の行の左端が変わることを確認する。
        try {
          const lineStarts = () =>
            page.evaluate(() => {
              const svg = document.querySelector('[data-testid="engraving-preview"]')
              const rows = new Map()
              for (const group of svg?.querySelectorAll('g') ?? []) {
                const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(
                  group.getAttribute('transform') ?? '',
                )
                if (!match) continue
                const x = Number(match[1])
                const baseline = Number(match[2])
                const current = rows.get(baseline)
                if (current === undefined || x < current) rows.set(baseline, x)
              }
              return Array.from(rows.values()).sort((a, b) => a - b)
            })
          const alignButtons = await page.locator('[data-testid^="engraving-align-"]').count()
          await page.click('[data-testid="engraving-align-left"]')
          await page.waitForTimeout(200)
          const leftXs = await lineStarts()
          await page.click('[data-testid="engraving-align-right"]')
          await page.waitForTimeout(200)
          const rightXs = await lineStarts()
          result.engravingAlign = {
            buttons: alignButtons,
            leftXs,
            rightXs,
            changed:
              leftXs.length > 0 &&
              leftXs.length === rightXs.length &&
              leftXs.every((x, index) => rightXs[index] >= x - 1e-9) &&
              leftXs.some((x, index) => rightXs[index] > x),
          }
          await page.click('[data-testid="engraving-align-center"]')
          await page.waitForTimeout(200)
        } catch (err) {
          result.engravingAlign = { error: String(err?.message ?? err) }
        }
        // 3Dモデル上のオーバーレイをドラッグして位置が動くことを確認する。
        // 面全体のSVGは固定サイズ＋transformなので、ブロック矩形の画面位置で判定する。
        try {
          await page.waitForSelector('[data-testid="engraving-overlay"]', {
            state: 'visible',
            timeout: 30000,
          })
          result.engravingOverlayVisible = true
          const blockLocator = page.locator('[data-testid="engraving-overlay-block"]')
          // 右上のハンドルを外側へドラッグして、ブロック幅が増えることを確認する。
          try {
            const handleBox = await page
              .locator('[data-testid="engraving-overlay-handle-top-right"]')
              .boundingBox()
            const blockBox = await blockLocator.boundingBox()
            const widthBefore = Number(await blockLocator.getAttribute('width'))
            if (handleBox && blockBox && Number.isFinite(widthBefore)) {
              const hx = handleBox.x + handleBox.width / 2
              const hy = handleBox.y + handleBox.height / 2
              const dx = hx - (blockBox.x + blockBox.width / 2)
              const dy = hy - (blockBox.y + blockBox.height / 2)
              const length = Math.hypot(dx, dy) || 1
              const step = Math.max(30, length * 0.6)
              await page.mouse.move(hx, hy)
              await page.mouse.down()
              await page.mouse.move(hx + (dx / length) * step, hy + (dy / length) * step, {
                steps: 8,
              })
              await page.mouse.up()
              await page.waitForTimeout(400)
              const widthAfter = Number(await blockLocator.getAttribute('width'))
              result.engravingResize = {
                beforeWidth: widthBefore,
                afterWidth: widthAfter,
                changed: Number.isFinite(widthAfter) && widthAfter > widthBefore * 1.02,
              }
            }
          } catch (err) {
            result.engravingResize = { error: String(err?.message ?? err) }
          }
          const before = await blockLocator.boundingBox()
          const positionBefore = await page.evaluate(
            () => window.__previewControls?.getEngravingPosition?.() ?? null,
          )
          if (before) {
            const startX = before.x + before.width / 2
            const startY = before.y + before.height / 2
            await page.mouse.move(startX, startY)
            await page.mouse.down()
            await page.mouse.move(startX + 80, startY + 40, { steps: 8 })
            await page.mouse.up()
            await page.waitForTimeout(400)
            const after = await blockLocator.boundingBox()
            const positionAfter = await page.evaluate(
              () => window.__previewControls?.getEngravingPosition?.() ?? null,
            )
            const moved =
              (!!after &&
                (Math.abs(after.x - before.x) > 5 || Math.abs(after.y - before.y) > 5)) ||
              (positionBefore != null &&
                positionAfter != null &&
                (Math.abs(positionAfter.centerX - positionBefore.centerX) > 0.01 ||
                  Math.abs(positionAfter.centerY - positionBefore.centerY) > 0.01))
            result.engravingOverlayDrag = {
              before: { x: Math.round(before.x), y: Math.round(before.y) },
              after: after ? { x: Math.round(after.x), y: Math.round(after.y) } : null,
              positionBefore,
              positionAfter,
              moved,
            }
          }
        } catch {
          result.engravingOverlayVisible = false
        }
      }

      if (values.export) {
        // スマホでは設定がボトムシート内にあるため、先に開く。
        if (await page.locator('[data-testid="open-settings"]').isVisible().catch(() => false)) {
          await page.locator('[data-testid="open-settings"]').click()
        }
        if (values.engrave) {
          // ドラッグ結果を反映してから、モードバナーのエクスポートで書き出す。
          // ズーム後のドラッグでは面からはみ出すことがあるため、自動調整してから反映する。
          const autofit = page.locator('[data-testid="engraving-autofit"]')
          if ((await autofit.count()) > 0) {
            await autofit.first().click()
            await page.waitForTimeout(300)
          }
          await page.click('[data-testid="engraving-apply"]')
          await page
            .waitForFunction(
              () =>
                window.__pipelineState?.phase !== 'complete' &&
                window.__pipelineState?.phase !== 'error',
              null,
              { timeout: 60000, polling: 300 },
            )
            .catch(() => {})
          await page
            .waitForFunction(
              () =>
                window.__pipelineState?.phase === 'complete' ||
                window.__pipelineState?.phase === 'error',
              null,
              { timeout: 240000, polling: 500 },
            )
            .catch(() => {})
          await page.click('[data-testid="engraving-export-button"]')
        } else {
          await page.click('[data-testid="export-button"]')
        }
        const download = await page.waitForEvent('download', { timeout })
        const suggested = download.suggestedFilename() ?? 'export.glb'
        const ext = suggested.includes('.') ? suggested.split('.').pop() : 'glb'
        exportFile =
          values['export-out'] ??
          join(REPO_ROOT, '.screenshots', `export-${timestamp()}.${ext}`)
        mkdirSync(dirname(exportFile), { recursive: true })
        await download.saveAs(exportFile)
        exportBytes = statSync(exportFile).size
        if (values.split) {
          try {
            const files = unzipSync(new Uint8Array(readFileSync(exportFile)))
            result.splitEntries = Object.keys(files).sort()
          } catch {
            result.splitEntries = []
          }
        }
        if (values.engrave && !values.split) {
          try {
            const files = unzipSync(new Uint8Array(readFileSync(exportFile)))
            const model = files['3D/3dmodel.model']
            const xml = model ? new TextDecoder().decode(model) : ''
            const match = xml.match(/<metadata name="Description">([\s\S]*?)<\/metadata>/)
            result.engravingMetadata = {
              hasDescription: match !== null,
              description: match ? match[1].slice(0, 300) : null,
              hasEngravedText: xml.includes('東京都新宿区') || xml.includes('PLATEAU'),
            }
          } catch (err) {
            result.engravingMetadata = { error: String(err?.message ?? err) }
          }
        }
      }

      if (values.engrave) {
        // はみ出し警告: 自由入力をONにして長文＋大きすぎるサイズにし、
        // 面枠の stroke が赤（var(--error)）になることを確認する。
        const customToggle = page.locator('[data-testid="engraving-content-custom"]')
        if ((await customToggle.count()) > 0) {
          await customToggle.first().check()
          const customText = page.locator('[data-testid="engraving-text-custom"]')
          if ((await customText.count()) > 0) {
            await customText
              .first()
              .fill('東京都新宿区西新宿二丁目北九番地先交差点付近の建物模型記念品です')
          }
          const customSize = page.locator('[data-testid="engraving-size-custom"]')
          if ((await customSize.count()) > 0) {
            await customSize.first().fill('60')
            await customSize.first().blur()
          }
          await page.waitForTimeout(400)
          result.engravingOverflowWarning = await page
            .locator('[data-testid="engraving-warning"]')
            .count()
          result.engravingOverflowStroke = await page.evaluate(() => {
            const svg = document.querySelector('[data-testid="engraving-preview"]')
            const rect = svg?.querySelector('rect')
            return rect?.getAttribute('stroke') ?? null
          })
        }
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
    const touchOk =
      values.scenario !== 'touch' ||
      (result.longPressSelection !== null &&
        result.selectModeChanged === true &&
        result.twoFingerSelectionUnchanged === true)
    const splitOk =
      !values.split ||
      !values.export ||
      (Array.isArray(result.splitEntries) &&
        result.splitEntries.includes('model_base.3mf') &&
        result.splitEntries.includes('model_buildings.3mf'))
    const engravingOk =
      !values.engrave ||
      (result.engravingPanel === true &&
        result.engravingModeBanner === true &&
        result.engravingSettingsHidden === true &&
        (result.engravingGlyphPaths ?? 0) > 0 &&
        result.engravingZoom?.changed === true &&
        result.engravingOverlayVisible === true &&
        result.engravingResize?.changed === true &&
        result.engravingOverlayDrag?.moved === true &&
        result.engravingAlign?.changed === true &&
        (!values.export ||
          values.split ||
          result.engravingMetadata?.hasEngravedText === true))

    result.ok =
      !webglError &&
      result.pageErrors.length === 0 &&
      scenarioOk &&
      touchOk &&
      splitOk &&
      engravingOk &&
      (!values['fail-on-console'] || result.consoleErrors.length === 0)
    if (webglError) result.error = 'webgl-error'
    else if (!scenarioOk) result.error = `scenario-${values.scenario}-failed`
    else if (!touchOk) result.error = 'scenario-touch-assertion-failed'
    else if (!splitOk) result.error = 'split-entries-missing'
    else if (!engravingOk) result.error = 'engraving-check-failed'
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
