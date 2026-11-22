/**
 * placeHoverCard（DEVホバーカードの配置）のテスト。
 *
 * 実行方法:
 *   npx vitest run frontend/src/lib/hoverCardPlacement.test.ts
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { placeHoverCard, type Box } from './hoverCardPlacement'

const SIZE = { width: 200, height: 80 }
const BOUNDS = { width: 1200, height: 800 }

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

function at(cursorX: number, cursorY: number, obstacles: Box[] = []) {
  return placeHoverCard({
    cursor: { x: cursorX, y: cursorY },
    size: SIZE,
    bounds: BOUNDS,
    obstacles,
  })
}

describe('placeHoverCard', () => {
  it('障害物がなければカーソルの右下に gap 12px で置く', () => {
    assert.deepEqual(at(100, 100), { x: 112, y: 112 })
  })

  it('右端をはみ出すときはカーソルの左へ反転する', () => {
    const pos = at(1100, 100)
    assert.equal(pos.x, 1100 - 12 - SIZE.width)
    assert.equal(pos.y, 112)
  })

  it('下端をはみ出すときはカーソルの上へ反転する', () => {
    const pos = at(100, 760)
    assert.equal(pos.x, 112)
    assert.equal(pos.y, 760 - 12 - SIZE.height)
  })

  it('右下がUIパネルに重なる場合は重ならない候補を選ぶ', () => {
    // カーソル右下を塞ぐパネル（建物一覧パネル相当）
    const panel: Box = { left: 100, top: 100, width: 400, height: 500 }
    const pos = at(90, 90, [panel])
    const overlapsPanel =
      pos.x < panel.left + panel.width &&
      pos.x + SIZE.width > panel.left &&
      pos.y < panel.top + panel.height &&
      pos.y + SIZE.height > panel.top
    assert.equal(overlapsPanel, false)
  })

  it('どの候補も重なる場合は重なりが最も小さい位置を返す', () => {
    const panel: Box = { left: 0, top: 0, width: 1200, height: 800 }
    const pos = at(600, 400, [panel])
    // どの候補も全面と重なる（同点）ため、第一候補のクランプ結果を返す。
    assert.deepEqual(pos, { x: 612, y: 412 })
  })

  it('コンテナ端では必ず margin 8px 以上を空ける', () => {
    const pos = placeHoverCard({
      cursor: { x: 2, y: 2 },
      size: SIZE,
      bounds: { width: 120, height: 60 },
      margin: 8,
    })
    assert.equal(pos.x, 8)
    assert.equal(pos.y, 8)
  })

  it('縦に長いパネルとデバッグパネルがあっても重ならない位置へ滑らせる', () => {
    // 画面左の建物一覧（637件分の高さ）・右上の操作パネル・デバッグパネルに囲まれた位置。
    const bounds = { width: 1000, height: 673 }
    const size = { width: 260, height: 91 }
    const cursor = { x: 490, y: 200 }
    const obstacles: Box[] = [
      { left: 16, top: 99, width: 264, height: 461 },
      { left: 604, top: 90, width: 380, height: 265 },
      { left: 408, top: 16, width: 576, height: 32 },
      { left: 16, top: 16, width: 357, height: 34 },
    ]
    const pos = placeHoverCard({ cursor, size, bounds, obstacles })
    const card: Box = { left: pos.x, top: pos.y, width: size.width, height: size.height }
    for (const obstacle of obstacles) {
      assert.equal(overlap(card, obstacle), 0, `${obstacle.left},${obstacle.top} と重なる`)
    }
    assert.ok(pos.x >= 8 && pos.x + size.width <= bounds.width - 8)
    assert.ok(pos.y >= 8 && pos.y + size.height <= bounds.height - 8)
    // カーソルは覆わない。
    assert.ok(
      !(
        cursor.x > card.left &&
        cursor.x < card.left + card.width &&
        cursor.y > card.top &&
        cursor.y < card.top + card.height
      ),
    )
    // 画面の遠くへ飛ばさず、カーソルの近くに出す。
    assert.ok(Math.hypot(pos.x - cursor.x, pos.y - cursor.y) < 400)
  })

  it('カードがコンテナより大きい場合も原点側へ寄せる', () => {
    const pos = placeHoverCard({
      cursor: { x: 10, y: 10 },
      size: { width: 400, height: 300 },
      bounds: { width: 200, height: 150 },
      margin: 8,
    })
    assert.deepEqual(pos, { x: 8, y: 8 })
  })
})
