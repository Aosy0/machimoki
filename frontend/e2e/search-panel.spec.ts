import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockPoiSearch } from './helpers/api'
import { DEFAULT_OTHER_UI, assertNoOverlap, getBox } from './helpers/overlap'

test.beforeEach(async ({ page }) => {
  await mockPoiSearch(page)
})

/** 2D地図タブを開き、候補ドロップダウンに候補が出るまで待つ。 */
async function openSuggestions(page: Page): Promise<void> {
  await page.goto('/')
  const input = page.getByTestId('facility-search-input')
  await expect(input).toBeVisible()
  await input.fill('テスト')
  await expect(page.getByTestId('facility-search-dropdown')).toBeVisible()
  await expect(page.getByTestId('facility-search-item').first()).toBeVisible()
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  test(`候補表示時、パネルが他UIと重ならない (${viewport.width}x${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await openSuggestions(page)
    await assertNoOverlap(page, 'facility-search-dropdown', DEFAULT_OTHER_UI(page))
  })
}

test('ウィンドウを縮めても重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openSuggestions(page)

  await page.setViewportSize({ width: 900, height: 600 })
  // resize 後の rAF 再計算を待ってから下端が画面内に収まることを確認
  await expect
    .poll(async () => {
      const box = await getBox(page.getByTestId('facility-search-dropdown'))
      return box ? Math.round(box.y + box.height) : -1
    })
    .toBeLessThanOrEqual(600)
  await assertNoOverlap(page, 'facility-search-dropdown', DEFAULT_OTHER_UI(page))
})

test('パネルの下端が画面内に収まる', async ({ page }) => {
  const viewport = { width: 1280, height: 720 }
  await page.setViewportSize(viewport)
  await openSuggestions(page)

  const box = await getBox(page.getByTestId('facility-search-dropdown'))
  expect(box).not.toBeNull()
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})

test('候補が多いとき、パネルが下限まで伸びる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1080 })
  await openSuggestions(page)

  await expect
    .poll(async () => (await getBox(page.getByTestId('facility-search-dropdown')))?.height ?? 0)
    .toBeGreaterThan(240)
  await assertNoOverlap(page, 'facility-search-dropdown', DEFAULT_OTHER_UI(page))
})

test('検索結果パネルも他UIと重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openSuggestions(page)

  await page.getByTestId('facility-search-submit').click()
  await expect(page.getByTestId('facility-search-results')).toBeVisible()
  await expect(page.getByTestId('facility-search-item').first()).toBeVisible()
  await assertNoOverlap(page, 'facility-search-results', DEFAULT_OTHER_UI(page))
})
