/**
 * catalogApi の resolveMuniCode タイムアウト単体テスト（Cesium 非依存）。
 *
 * 実行方法（新規npm依存の追加なし・ローカル実行のみ）:
 *   npx -y tsx --test frontend/src/lib/catalogApi.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveMuniCode } from './catalogApi'

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