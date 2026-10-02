import { expect, type Locator, type Page } from '@playwright/test'

/** boundingBox と同形の矩形。 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 干渉チェック対象。name は失敗メッセージ用、selector は CSS 文字列または Locator。 */
export interface OverlapTarget {
  name: string
  selector: string | Locator
}

/** locator の矩形を返す（非表示等で取得できない場合は null）。 */
export async function getBox(locator: Locator): Promise<Rect | null> {
  return locator.boundingBox()
}

/**
 * 2矩形が重なるか。margin は許容する重なり量（px）。
 * 重なり幅・高さの両方が margin を超えるときだけ true。
 */
export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return overlapX > margin && overlapY > margin
}

function resolveLocator(page: Page, target: OverlapTarget): Locator {
  return typeof target.selector === 'string' ? page.locator(target.selector) : target.selector
}

/**
 * targetTestId の要素と others のうち実際に重なっているものの name 配列を返す。
 * others の要素が存在しない（count 0）場合はスキップする。
 */
export async function findOverlaps(
  page: Page,
  targetTestId: string,
  others: OverlapTarget[],
  margin = 0,
): Promise<string[]> {
  const targetBox = await getBox(page.getByTestId(targetTestId))
  if (!targetBox) throw new Error(`対象要素が表示されていません: ${targetTestId}`)

  const overlaps: string[] = []
  for (const other of others) {
    const locator = resolveLocator(page, other)
    if ((await locator.count()) === 0) continue
    const box = await getBox(locator.first())
    if (!box) continue
    if (rectsOverlap(targetBox, box, margin)) overlaps.push(other.name)
  }
  return overlaps
}

/** 重なりがあれば矩形情報付きでテスト失敗させる。 */
export async function assertNoOverlap(
  page: Page,
  targetTestId: string,
  others: OverlapTarget[],
  margin = 0,
): Promise<void> {
  const targetBox = await getBox(page.getByTestId(targetTestId))
  if (!targetBox) throw new Error(`対象要素が表示されていません: ${targetTestId}`)

  const details: string[] = []
  for (const other of others) {
    const locator = resolveLocator(page, other)
    if ((await locator.count()) === 0) continue
    const box = await getBox(locator.first())
    if (!box) continue
    if (rectsOverlap(targetBox, box, margin)) {
      details.push(`${other.name}: ${JSON.stringify(box)}`)
    }
  }

  expect(
    details,
    `パネル(${targetTestId})が他UIと重なっています。target=${JSON.stringify(targetBox)}\n` +
      details.join('\n'),
  ).toEqual([])
}

/** 干渉テストの既定「他UI」セット。存在しないものは findOverlaps 側でスキップされる。 */
export function DEFAULT_OTHER_UI(page: Page): OverlapTarget[] {
  return [
    { name: '現在の表示範囲を選択', selector: page.getByTestId('map2d-select-current-bounds') },
    { name: 'Shift + ドラッグ で範囲選択', selector: page.getByTestId('map2d-drag-hint') },
    { name: '座標で選択パネル', selector: page.getByTestId('map2d-coord-panel') },
    { name: 'dev-badge', selector: page.getByTestId('dev-badge') },
  ]
}
