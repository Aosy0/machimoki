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
