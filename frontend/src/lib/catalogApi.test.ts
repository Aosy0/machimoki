/**
 * catalogApi の resolveMuniCode タイムアウト単体テスト（Cesium 非依存）。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/catalogApi.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveMuniCode,
  normalizeN03Code,
  featureContainsPoint,
  findMuniCodeByPoint,
} from './catalogApi'

describe('resolveMuniCode タイムアウト', () => {
  it('タイムアウトで AbortSignal が abort されエラーになる', async () => {
    const originalFetch = globalThis.fetch
    let capturedSignal: AbortSignal | undefined
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
        })
      })
    }) as typeof fetch

    try {
      const promise = resolveMuniCode(35.6895, 139.6917, 50)
      assert.ok(capturedSignal instanceof AbortSignal)
      assert.equal(capturedSignal?.aborted, false)

      await assert.rejects(promise, /逆ジオコーディングがタイムアウト/)
      assert.equal(capturedSignal?.aborted, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('N03フォールバック', () => {
  it('normalizeN03Codeが5桁に正規化する', () => {
    assert.equal(normalizeN03Code(13101), '13101')
    assert.equal(normalizeN03Code(1101), '01101')
    assert.equal(normalizeN03Code('13103'), '13103')
    assert.equal(normalizeN03Code('abc'), null)
    assert.equal(normalizeN03Code(123456), null)
  })

  it('featureContainsPointがホール付きポリゴンを判定する', () => {
    const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ]
    const withHole = {
      properties: { N03_007: '13101' },
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(3, 3, 5, 5)] },
    }
    assert.equal(featureContainsPoint(1, 1, withHole), true)
    assert.equal(featureContainsPoint(4, 4, withHole), false)
    assert.equal(featureContainsPoint(20, 20, withHole), false)
  })

  it('findMuniCodeByPointが含むフィーチャのコードを返す', () => {
    const features = [
      {
        properties: { N03_007: '13108' },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [139.7, 35.7],
              [139.8, 35.7],
              [139.8, 35.73],
              [139.7, 35.73],
              [139.7, 35.7],
            ],
          ],
        },
      },
    ]
    assert.equal(findMuniCodeByPoint(139.785, 35.714, features), '13108')
    assert.equal(findMuniCodeByPoint(139.0, 35.0, features), null)
  })
})