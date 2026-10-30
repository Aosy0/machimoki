import { expect, test } from '@playwright/test'
import { mockPoiSearch } from './helpers/api'

test.beforeEach(async ({ page }) => {
  await mockPoiSearch(page)
})

test('初回はヒントが拡大し、縮小後もヘルプボタンとして残る', async ({ page }) => {
  await page.goto('/')
  const helpButton = page.getByTestId('map-mode-help')
  await expect(helpButton).toBeVisible()
  await expect(helpButton).toHaveAttribute('data-state', 'attention')
  // 拡大のtransitionが終わるまで待ってから高さを測る。
  await expect.poll(async () => (await helpButton.boundingBox())?.height ?? 0).toBeGreaterThan(40)
  const attentionBox = await helpButton.boundingBox()

  await expect(helpButton).toHaveAttribute('data-state', 'compact', { timeout: 6000 })
  await expect.poll(async () => (await helpButton.boundingBox())?.height ?? 999).toBeLessThan(40)
  const compactBox = await helpButton.boundingBox()
  expect(attentionBox).not.toBeNull()
  expect(compactBox).not.toBeNull()
  expect(attentionBox!.height).toBeGreaterThan(compactBox!.height + 4)

  // 既読後はリロードしても拡大しない。
  await page.reload()
  await expect(page.getByTestId('map-mode-help')).toHaveAttribute('data-state', 'compact')
})

test('ヒントのボタンからヘルプを開いて閉じられる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('map-mode-help').click()

  const detail = page.getByTestId('help-detail')
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('基本の流れ')
  await expect(detail).toContainText('選択範囲は自動で長辺150mmになります。')

  await page.getByTestId('help-detail-close').click()
  await expect(detail).toBeHidden()
})

test('スーパーリロードでは再び拡大アニメーションを表示する', async ({ page }) => {
  await page.goto('/')
  const helpButton = page.getByTestId('map-mode-help')
  await expect(helpButton).toHaveAttribute('data-state', 'compact', { timeout: 6000 })

  // ブラウザのハードリロード相当（Ctrl+Shift+R / Shift+F5）を検知させる。
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F5',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('map-mode-help')).toHaveAttribute('data-state', 'attention')

  // 強制表示を消費した後の通常リロードでは再表示しない。
  await expect(page.getByTestId('map-mode-help')).toHaveAttribute('data-state', 'compact', {
    timeout: 6000,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('map-mode-help')).toHaveAttribute('data-state', 'compact')
})

test('ヘッダーの?からも同じヘルプが開く', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('help-trigger').click()
  await expect(page.getByTestId('help-detail')).toBeVisible()
})

test('モバイル幅でもdetailが画面内に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByTestId('map-mode-help').click()

  const detail = page.getByTestId('help-detail')
  await expect(detail).toBeVisible()
  const box = await detail.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
})
