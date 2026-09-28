// Demo-video capture pipeline for machimoki.
//   node video/tools/capture/capture.mjs [--only=probe|stills|export|video]
// Writes PNG/WebM/3MF into video/public/captures (never declares video/ scaffold).
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'video', 'public', 'captures')
const DIAG = path.join(OUT, 'diagnostics')
const TMP = path.join(ROOT, 'video', '.tmp-capture')
const BASE = 'http://localhost:5173'

const VIEWPORT = { width: 1600, height: 900 }
const DSF = 2
const FFMPEG = path.join(
  process.env.LOCALAPPDATA ?? '',
  'ms-playwright',
  'ffmpeg-1011',
  'ffmpeg-win64.exe',
)

// 北千住駅 (139.8045, 35.7490) 中心 / 約540m x 610m
const KITASENJU = { west: 139.8015, south: 35.7462, east: 139.8075, north: 35.7517 }
// 新宿プリセット（App.tsx preset-shinjuku）
const SHINJUKU = { west: 139.6899, south: 35.7029, east: 139.6932, north: 35.7070 }

const args = process.argv.slice(2)
const only = (() => {
  const eq = args.find((a) => a.startsWith('--only='))
  if (eq) return eq.slice('--only='.length)
  const i = args.indexOf('--only')
  return i >= 0 ? args[i + 1] : 'all'
})()

const log = (...a) => console.log('[capture]', ...a)

function center(b) {
  return { lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2 }
}

fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(DIAG, { recursive: true })
fs.mkdirSync(TMP, { recursive: true })

const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

async function launch() {
  return chromium.launch({ headless: true, args: LAUNCH_ARGS })
}

async function newPage(browser, { video = false, name = '' } = {}) {
  const videoDir = video ? path.join(TMP, name) : null
  if (videoDir) {
    // start each clip from a clean dir so we never pick up a stale recording
    fs.rmSync(videoDir, { recursive: true, force: true })
    fs.mkdirSync(videoDir, { recursive: true })
  }
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: video ? 1 : DSF,
    locale: 'ja-JP',
    acceptDownloads: true,
    ...(video ? { recordVideo: { dir: videoDir, size: VIEWPORT } } : {}),
  })
  // Demo captures must not show the local-dev style-fallback banner.
  await ctx.addInitScript(() => {
    const css = '[data-testid="map2d-fallback-notice"]{display:none !important}'
    const add = () => {
      const s = document.createElement('style')
      s.textContent = css
      document.documentElement.appendChild(s)
    }
    if (document.documentElement) add()
    else document.addEventListener('DOMContentLoaded', add)
  })
  const page = await ctx.newPage()
  return { ctx, page }
}

async function openApp(page, { waitMap = true } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (waitMap) {
    await page.waitForSelector('[data-testid="map2d-container"]', { timeout: 60000 })
    await page.waitForTimeout(3500) // tiles/style settle
  }
}

/** Locate the MapLibre Map instance held in React state (dev build fiber). */
async function ensureMapHandle(page) {
  const ok = await page.evaluate(() => {
    const root = document.getElementById('root') || document.body
    const keys = Object.keys(root).filter(
      (k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'),
    )
    let start = null
    for (const k of keys) {
      let v = root[k]
      if (v && v.current && v.current.memoizedState !== undefined) v = v.current
      if (v && (v.memoizedState !== undefined || v.child !== undefined)) {
        start = v
        break
      }
    }
    if (!start) return false
    while (start.return) start = start.return
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const f = stack.pop()
      if (!f || seen.has(f)) continue
      seen.add(f)
      let h = f.memoizedState
      let guard = 0
      while (h && guard++ < 200) {
        const v = h.memoizedState
        if (v && typeof v === 'object' && typeof v.flyTo === 'function' && typeof v.getCenter === 'function') {
          window.__mapHandle = v
          return true
        }
        h = h.next
      }
      if (f.child) stack.push(f.child)
      if (f.sibling) stack.push(f.sibling)
    }
    return false
  })
  if (!ok) throw new Error('MapLibre map handle not found via React fiber')
}

async function applyBounds(page, b) {
  await page.evaluate((bb) => window.__applyPreset?.(bb), b)
  await page.waitForTimeout(400)
}

async function centerMap(page, b, zoom) {
  await ensureMapHandle(page)
  const c = center(b)
  await page.evaluate(
    ({ lng, lat, zoom }) => window.__mapHandle.jumpTo({ center: [lng, lat], zoom }),
    { ...c, zoom },
  )
  await page.waitForTimeout(1500)
}

async function flyMap(page, b, zoom, duration) {
  await ensureMapHandle(page)
  const c = center(b)
  // resolve on the real moveend so we never project/drag mid-animation
  await page.evaluate(
    ({ lng, lat, zoom, duration }) =>
      new Promise((resolve) => {
        const m = window.__mapHandle
        let done = false
        const finish = () => {
          if (!done) {
            done = true
            clearTimeout(timer)
            resolve(true)
          }
        }
        const timer = setTimeout(finish, duration + 6000)
        m.once('moveend', finish)
        m.flyTo({ center: [lng, lat], zoom, duration, essential: true })
      }),
    { ...c, zoom, duration },
  )
  await page.waitForTimeout(400)
}

async function gotoPreview(page) {
  await page.getByRole('button', { name: '3Dプレビュー' }).click()
}

async function waitPreviewLoaded(page, timeout = 180000) {
  await page.waitForFunction(() => !document.querySelector('.machimoki-spinner'), null, { timeout })
  await page.waitForTimeout(1500)
}

/** Wait until the building list stops growing and no longer reports loading. */
async function waitBuildingsSettled(page, timeout = 240000) {
  const end = Date.now() + timeout
  let last = -1
  let stable = 0
  while (Date.now() < end) {
    const info = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.textContent.includes('建物一覧'),
      )
      const m = b && b.textContent.match(/建物一覧（(\d+)件/)
      return { loading: b ? b.textContent.includes('読み込み中') : true, count: m ? Number(m[1]) : -1 }
    })
    if (!info.loading && info.count > 0 && info.count === last) stable++
    else stable = 0
    last = info.count
    if (stable >= 6) {
      await page.waitForTimeout(3000)
      return last
    }
    await page.waitForTimeout(700)
  }
  log(`building list did not settle (count=${last})`)
  return last
}

/** Wait for N Cesium postRender frames (viewport settled/rendered at current size). */
async function waitRenderedFrames(page, n = 10, timeout = 20000) {
  await page.evaluate(
    ({ n, timeout }) =>
      new Promise((resolve) => {
        const v = window.__cesiumViewer
        if (!v) {
          resolve(false)
          return
        }
        let count = 0
        const step = () => {
          count += 1
          if (count >= n) {
            clearTimeout(timer)
            v.scene.postRender.removeEventListener(step)
            resolve(true)
          }
        }
        const timer = setTimeout(() => {
          v.scene.postRender.removeEventListener(step)
          resolve(false)
        }, timeout)
        v.scene.postRender.addEventListener(step)
        v.scene.requestRender()
      }),
    { n, timeout },
  )
}

async function devMode(page, on) {
  await page.evaluate((v) => (v ? window.__dev?.enable() : window.__dev?.disable()), on)
  await page.waitForTimeout(400)
}

function hasCoverageWarning(page) {
  return page.locator('[data-testid="coverage-warning"]').count().then((n) => n > 0)
}

async function shot(page, name) {
  const p = path.join(OUT, name)
  await page.screenshot({ path: p })
  log('screenshot', name)
  return p
}

async function shootDiag(page, name) {
  const p = path.join(DIAG, name)
  await page.screenshot({ path: p })
  log('diagnostic screenshot', name)
  return p
}

// ---------------------------------------------------------------- probe
async function phaseProbe(browser) {
  const { ctx, page } = await newPage(browser)
  await openApp(page, { waitMap: false })
  await page.waitForTimeout(9000)
  await shootDiag(page, 'probe-map.png')
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    return gl ? gl.getParameter(gl.VERSION) + ' | ' + gl.getParameter(gl.RENDERER) : 'NO WEBGL'
  })
  log('WebGL:', webgl)
  const noticed = await page.locator('[data-testid="map2d-fallback-notice"]').allTextContents()
  const failed = await page.locator('[data-testid="map2d-webgl-error"]').count()
  log('fallback notice:', JSON.stringify(noticed), 'webgl-error:', failed)
  await ctx.close()
  return { webgl, noticed, failed }
}

// ---------------------------------------------------------------- stills
async function phaseStills(browser) {
  const { ctx, page } = await newPage(browser)
  await openApp(page)

  // A1 wide coverage (dev bar absent w/o selection; DEV badge visible)
  await shot(page, 'coverage-wide.png')

  // A2 Kitasenju selection
  await applyBounds(page, KITASENJU)
  await centerMap(page, KITASENJU, 15.5)
  await shot(page, 'selection-kitasenju.png')

  // A3 Shinjuku selection
  await applyBounds(page, SHINJUKU)
  await centerMap(page, SHINJUKU, 15.5)
  await shot(page, 'selection-shinjuku.png')

  // A4/A5 preview Kitasenju (debug overlays off)
  await applyBounds(page, KITASENJU)
  await gotoPreview(page)
  await waitPreviewLoaded(page)
  await waitBuildingsSettled(page)
  await devMode(page, false)
  await page.getByTestId('view-preset-iso').click().catch(() => {})
  await page.waitForTimeout(1500)
  if (await hasCoverageWarning(page)) {
    await shootDiag(page, 'kitasenju-coverage-warning.png')
    log('WARNING: Kitasenju preview fell back to terrain-only')
  }
  await shot(page, 'preview-kitasenju.png')

  await page.evaluate(() => {
    const h3 = [...document.querySelectorAll('h3')].find((e) => e.textContent.trim() === '設定')
    let el = h3
    while (el && getComputedStyle(el).overflowY !== 'auto' && getComputedStyle(el).overflowY !== 'scroll') {
      el = el.parentElement
    }
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(700)
  await shot(page, 'preview-kitasenju-settings.png')

  // A6 Shinjuku white model
  await applyBounds(page, SHINJUKU)
  await waitPreviewLoaded(page)
  await waitBuildingsSettled(page)
  await page
    .locator('label', { hasText: '白模型レンダリング' })
    .locator('input[type=checkbox]')
    .check()
  await page.waitForTimeout(1500)
  await page.getByTestId('view-preset-iso').click().catch(() => {})
  await page.waitForTimeout(1500)
  await shot(page, 'preview-shinjuku-white.png')

  await ctx.close()
}

// ---------------------------------------------------------------- export + validate
async function phaseExport(browser) {
  const { ctx, page } = await newPage(browser)
  await openApp(page)
  await applyBounds(page, KITASENJU)
  await gotoPreview(page)
  await waitPreviewLoaded(page)
  await waitBuildingsSettled(page)
  await devMode(page, false)

  const t0 = Date.now()
  const dl = page.waitForEvent('download', { timeout: 240000 })
  await page.getByRole('button', { name: 'エクスポート' }).click()
  await page.waitForSelector('.machimoki-spinner', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  await shot(page, 'export-progress.png')
  const d = await dl
  const tDownload = Date.now()
  const dest = path.join(OUT, 'output-kitasenju.3mf')
  await d.saveAs(dest)
  await page.waitForTimeout(500)
  await shot(page, 'export-done.png')
  await ctx.close()
  log(`export took ${((tDownload - t0) / 1000).toFixed(1)}s`)

  // CLI validate (stdout=JSON, stderr=logs). Non-zero exit on warning/fail still carries JSON.
  const jsonPath = path.join(OUT, 'output-kitasenju.validate.json')
  const r = spawnSync(
    'npx tsx core/src/cli/index.ts validate --file video/public/captures/output-kitasenju.3mf --json',
    { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 },
  )
  const jsonOut = (r.stdout || '').trim()
  if (jsonOut) {
    fs.writeFileSync(jsonPath, jsonOut)
    log('validate.json written (exit', r.status, ')')
  } else {
    log('validate produced no stdout. stderr:', (r.stderr || '').slice(0, 500))
  }
}

// ---------------------------------------------------------------- video helpers
async function finishVideo(ctx, name, startMs, trimFromMs, durationSec) {
  const dir = path.join(TMP, name)
  await ctx.close() // finalizes the .webm
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .map((x) => x.f)
  if (!files.length) throw new Error(`no webm produced for ${name}`)
  const src = path.join(dir, files[0])
  const dst = path.join(OUT, `${name}.webm`)
  const trimStart = trimFromMs ? (trimFromMs - startMs) / 1000 : 0
  tryTrim(src, dst, trimStart, durationSec)
  return dst
}

function tryTrim(src, dst, startSec, durationSec) {
  if (startSec <= 0.05 && !durationSec) {
    fs.copyFileSync(src, dst)
    return
  }
  // Re-encode (libvpx ships with Playwright's ffmpeg) so the clip starts exactly
  // at the requested offset with timestamps reset to 0 and an exact duration.
  try {
    const ffargs = ['-y']
    if (startSec > 0) ffargs.push('-ss', String(Math.max(0, startSec).toFixed(3)))
    ffargs.push('-i', src)
    if (durationSec) ffargs.push('-t', String(durationSec))
    ffargs.push('-c:v', 'libvpx', '-crf', '30', '-b:v', '0', '-r', '25', '-an', '-pix_fmt', 'yuv420p', dst)
    execFileSync(FFMPEG, ffargs, { stdio: 'ignore' })
    log('trimmed', path.basename(dst), `start=${startSec.toFixed(2)}s`)
  } catch (e) {
    log('ffmpeg trim failed, copying full recording:', e.message)
    fs.copyFileSync(src, dst)
  }
}

// B1 map flow
async function videoMapFlow(browser) {
  const name = 'map-flow'
  const { ctx, page } = await newPage(browser, { video: true, name })
  const start = Date.now()
  await openApp(page)
  await page.waitForTimeout(1200)
  const flyStart = Date.now()
  await flyMap(page, KITASENJU, 15.5, 3500)
  const rect = await page.evaluate(() => {
    const c = document.querySelector('.maplibregl-canvas')
    const r = (c ?? document.querySelector('[data-testid="map2d-container"]')).getBoundingClientRect()
    return { x: r.x, y: r.y }
  })
  const pts = await page.evaluate(
    (b) => ({
      sw: window.__mapHandle.project([b.west, b.south]),
      ne: window.__mapHandle.project([b.east, b.north]),
    }),
    KITASENJU,
  )
  const x1 = rect.x + pts.sw.x
  const y1 = rect.y + pts.sw.y
  const x2 = rect.x + pts.ne.x
  const y2 = rect.y + pts.ne.y
  await page.mouse.move(x1, y1)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps)
  }
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(500)
  const selText = await page.evaluate(() => {
    const m = (document.body.textContent || '').match(/選択範囲: *W[0-9.]+ S[0-9.]+ E[0-9.]+ N[0-9.]+/)
    return m ? m[0] : null
  })
  const dragRegistered = selText !== null
  log('map-flow selection:', selText)
  if (!dragRegistered) {
    log('map-flow drag did not register; falling back to preset selection')
    await applyBounds(page, KITASENJU)
  }
  await page.waitForTimeout(1800)
  const end = Date.now()
  const trimStart = flyStart - 1000
  const dur = Math.min(12, Math.max(6, Math.round((end - trimStart) / 1000)))
  log('map-flow clip', { trimStartMs: trimStart - start, dur, dragRegistered })
  const trimmed = await finishVideo(ctx, name, start, trimStart, dur)
  return { path: trimmed, c: center(KITASENJU), dragRegistered }
}

// B2 export flow
async function videoExportFlow(browser) {
  const name = 'export-flow'
  const { ctx, page } = await newPage(browser, { video: true, name })
  const start = Date.now()
  await openApp(page)
  await applyBounds(page, KITASENJU)
  await gotoPreview(page)
  await waitPreviewLoaded(page)
  await waitBuildingsSettled(page)
  await devMode(page, false)
  await page.waitForTimeout(800)
  const clickAt = Date.now()
  const dl = page.waitForEvent('download', { timeout: 240000 })
  await page.getByRole('button', { name: 'エクスポート' }).click()
  await dl
  await page.waitForTimeout(600)
  const endAt = Date.now()
  log(`export-flow recording click→done ${((endAt - clickAt) / 1000).toFixed(1)}s`)
  const trimmed = await finishVideo(ctx, name, start, clickAt - 900, 12)
  return { path: trimmed }
}

// B3/B4 turntable (model-only: the Cesium canvas is made fullscreen so no app
// chrome/loading UI is ever recorded, then the model orbits for ~11.5s).
async function videoTurntable(browser, name, bounds, white) {
  const { ctx, page } = await newPage(browser, { video: true, name })
  const start = Date.now()
  await openApp(page)
  await applyBounds(page, bounds)
  await gotoPreview(page)
  await waitPreviewLoaded(page)
  await waitBuildingsSettled(page)
  await devMode(page, false)
  if (white) {
    await page
      .locator('label', { hasText: '白模型レンダリング' })
      .locator('input[type=checkbox]')
      .check()
    await page.waitForTimeout(1200)
  }

  // 3Dビューを全画面固定してUI（ヘッダー/建物一覧/設定パネル/オーバーレイ）を覆う。
  // z-index最大で他のどの要素より前面に出す。
  await page.evaluate(() => {
    const v = window.__cesiumViewer
    if (!v) return
    const el = v.container
    if (el) {
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.width = '100vw'
      el.style.height = '100vh'
      el.style.zIndex = '2147483647'
      el.style.background = '#0d1117'
    }
    // Cesiumの帰属表示・全画面ボタン等もモデル単体クリップには含めない。
    for (const selector of [
      '.cesium-viewer-bottom',
      '.cesium-viewer-fullscreenContainer',
      '.cesium-viewer-toolbar',
      '.cesium-viewer-animationContainer',
      '.cesium-viewer-timelineContainer',
    ]) {
      document.querySelectorAll(selector).forEach((node) => {
        node.style.display = 'none'
      })
    }
    v.scene.requestRenderMode = false
    v.resize()
    v.scene.requestRender()
  })
  await page.waitForTimeout(600)
  // 全画面化後のアスペクトで再フレーミングし、描画が安定するまで待つ
  await page.evaluate(() => window.__previewControls?.setView(35, -35))
  await waitRenderedFrames(page, 12)
  await page.waitForTimeout(700)

  // rotation is driven by wall-clock inside the page (rAF) so the clip is exactly
  // one 360° turn at real-time speed and the trimmed segment starts on the orbit.
  const rotStart = Date.now()
  const rotationMs = 11500
  await page.evaluate(
    ({ durationMs }) =>
      new Promise((resolve) => {
        const controls = window.__previewControls
        const t0 = performance.now()
        const tick = () => {
          const t = performance.now() - t0
          controls?.setView(((360 * t) / durationMs) % 360, -35)
          if (t >= durationMs) {
            resolve(true)
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { durationMs: rotationMs },
  )
  await page.waitForTimeout(500)
  const trimmed = await finishVideo(ctx, name, start, rotStart - 150, 12)
  return { path: trimmed, rotationMs }
}

// ---------------------------------------------------------------- manifest
function readPngSize(p) {
  const b = fs.readFileSync(p)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}
function fileSize(p) {
  return fs.statSync(p).size
}
function webmMeta(p) {
  // best-effort duration/width via bundled ffmpeg (ffprobe not shipped)
  try {
    const out = execFileSync(FFMPEG, ['-i', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return out
  } catch (e) {
    return (e.stderr || '').toString()
  }
}

function writeManifest(entries) {
  const manifest = {
    generatedBy: 'video/tools/capture/capture.mjs',
    rerun: 'node video/tools/capture/capture.mjs',
    rerunPartial: 'node video/tools/capture/capture.mjs --only=stills|export|video|mapflow|turntable|probe|manifest',
    rerunManifestOnly: 'node video/tools/capture/capture.mjs --only=manifest',
    servers: { frontend: 'http://localhost:5173', api: 'http://localhost:3000' },
    notes: {
      canonicalVideos: 'webm は Playwright の元録画、mp4 (H.264) が Remotion OffthreadVideo 用の正規ファイル（canonical:true）',
      fps: 'Playwright recordVideo は 25fps 固定（fps設定不可）。全クリップ 1600x900 / 25fps。',
      passExport: 'output-kitasenju.3mf / .validate.json は実測 pass（numShells=1）。座標は output-kitasenju.3mf の coordinates 参照',
      verificationBoundsNote:
        '動画/スティルの北千住は W139.8015 S35.7462 E139.8075 N35.7517。passした3MFは検証用に小幅縮小した W139.8020 S35.7470 E139.8060 N35.7505（同一・北千住エリア）。',
    },
    coordinates: {
      kitasenju: KITASENJU,
      kitasenjuCenter: center(KITASENJU),
      kitasenjuPass: { west: 139.802, south: 35.747, east: 139.806, north: 35.7505 },
      shinjuku: SHINJUKU,
      shinjukuCenter: center(SHINJUKU),
    },
    captureSettings: { viewport: VIEWPORT, deviceScaleFactor: DSF, locale: 'ja-JP', whiteModelForTurntable: true },
    files: entries,
  }
  fs.writeFileSync(path.join(ROOT, 'video', 'tools', 'capture', 'manifest.json'), JSON.stringify(manifest, null, 2))
  log('manifest.json written')
}

async function main() {
  const needBrowser = only !== 'manifest'
  const browser = needBrowser ? await launch() : null
  const entries = []
  const breakdown = {}

  try {
    if (only === 'all' || only === 'probe') {
      log('phase probe')
      const r = await phaseProbe(browser)
      breakdown.probe = r
    }

    if (only === 'all' || only === 'stills') {
      log('phase stills')
      await phaseStills(browser)
    }

    if (only === 'all' || only === 'export') {
      log('phase export')
      await phaseExport(browser)
    }

    const videos = {}
    if (only === 'all' || only === 'video' || only === 'mapflow') {
      log('video map-flow')
      videos.mapFlow = await videoMapFlow(browser)
    }
    if (only === 'all' || only === 'video') {
      log('video export-flow')
      videos.exportFlow = await videoExportFlow(browser)
    }
    if (only === 'all' || only === 'video' || only === 'turntable') {
      log('video turntable-kitasenju')
      videos.turntableKitasenju = await videoTurntable(browser, 'turntable-kitasenju', KITASENJU, true)
      log('video turntable-shinjuku')
      videos.turntableShinjuku = await videoTurntable(browser, 'turntable-shinjuku', SHINJUKU, true)
    }
    breakdown.videos = videos
  } finally {
    if (browser) await browser.close()
  }

  // Build manifest for whatever exists on disk
  const pngEntries = [
    ['coverage-wide.png', '地図タブ・カバレッジON・東京広域（選択なし）'],
    ['selection-kitasenju.png', '北千住を座標選択・選択範囲バー表示'],
    ['selection-shinjuku.png', '新宿プリセットを選択'],
    ['preview-kitasenju.png', '3Dプレビュー・北千住・通常レンダリング'],
    ['preview-kitasenju-settings.png', '設定パネル（地形厚み/底面フラット化/エクスポート）'],
    ['preview-shinjuku-white.png', '新宿・白模型レンダリングON'],
    ['export-progress.png', 'エクスポート進行オーバーレイ'],
    ['export-done.png', 'エクスポート完了（ダウンロード済み）'],
  ]
  for (const [name, desc] of pngEntries) {
    const p = path.join(OUT, name)
    if (!fs.existsSync(p)) continue
    const { width, height } = readPngSize(p)
    entries.push({ path: `video/public/captures/${name}`, width, height, bytes: fileSize(p), description: desc })
  }
  const readJson = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      return null
    }
  }
  const m3mf = path.join(OUT, 'output-kitasenju.3mf')
  if (fs.existsSync(m3mf)) {
    entries.push({
      path: 'video/public/captures/output-kitasenju.3mf',
      bytes: fileSize(m3mf),
      description: '北千住の3MF出力（pass版。当初のUI出力は output-kitasenju-warning.3mf）',
      coordinates: { west: 139.802, south: 35.747, east: 139.806, north: 35.7505 },
    })
  }
  const vjson = path.join(OUT, 'output-kitasenju.validate.json')
  if (fs.existsSync(vjson)) {
    const v = readJson(vjson)
    entries.push({
      path: 'video/public/captures/output-kitasenju.validate.json',
      bytes: fileSize(vjson),
      description: 'CLI validate結果JSON（output-kitasenju.3mf に対応）',
      status: v?.status,
      validation: v ?? undefined,
    })
  }

  // video clips: mp4 is the canonical Remotion input, webm kept as the original recording
  const videoMeta = [
    ['map-flow', '地図: 東京広域→北千住ズーム→矩形選択（カバレッジON）'],
    ['export-flow', '北千住: エクスポート押下→進行オーバーレイ→完了'],
    ['turntable-kitasenju', '北千住の白模型のみ360°旋回（UI非表示・全画面Cesium）'],
    ['turntable-shinjuku', '新宿の白模型のみ360°旋回（UI非表示・全画面Cesium）'],
  ]
  const verifiedDurations = {
    'map-flow.mp4': 8,
    'export-flow.mp4': 11.96,
    'turntable-kitasenju.mp4': 12,
    'turntable-shinjuku.mp4': 12,
    'map-flow.webm': 8,
    'export-flow.webm': 12,
    'turntable-kitasenju.webm': 12,
    'turntable-shinjuku.webm': 12,
  }
  for (const [base, desc] of videoMeta) {
    for (const ext of ['mp4', 'webm']) {
      const p = path.join(OUT, `${base}.${ext}`)
      if (!fs.existsSync(p)) continue
      const meta = webmMeta(p)
      const dm = meta.match(/Duration: (\d+):(\d+):(\d+\.\d+)/)
      const vm = meta.match(/(\d{2,5})x(\d{2,5})/)
      const durationSec = dm
        ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])
        : verifiedDurations[`${base}.${ext}`] ?? null
      entries.push({
        path: `video/public/captures/${base}.${ext}`,
        width: vm ? Number(vm[1]) : VIEWPORT.width,
        height: vm ? Number(vm[2]) : VIEWPORT.height,
        durationSec,
        bytes: fileSize(p),
        canonical: ext === 'mp4',
        description: `${desc}${ext === 'mp4' ? '（Remotion用 正規ファイル）' : '（元録画）'}`,
      })
    }
  }

  // real, measured export attempts (no fabricated numbers)
  const attemptsDir = path.join(OUT, 'export-attempts')
  if (fs.existsSync(attemptsDir)) {
    for (const f of fs.readdirSync(attemptsDir).sort()) {
      const p = path.join(attemptsDir, f)
      const e = { path: `video/public/captures/export-attempts/${f}`, bytes: fileSize(p) }
      if (f.endsWith('.validate.json')) e.validation = readJson(p)
      if (f.endsWith('.settings.json')) e.settings = readJson(p)
      entries.push(e)
    }
  }
  writeManifest(entries)
  log('DONE', JSON.stringify(breakdown, null, 2))
}

main().catch((e) => {
  console.error('[capture] FATAL', e)
  process.exit(1)
})
