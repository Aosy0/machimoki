import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  FIRST_RUN_HINT_STORAGE_KEY,
  clearHardReloadFlag,
  isHardReloadShortcut,
  markHardReload,
  readHardReloadFlag,
  readHintSeen,
  shouldShowAttention,
  writeHintSeen,
} from './firstRunHint'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key: string): string | null {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      values.set(key, value)
    },
    removeItem(key: string): void {
      values.delete(key)
    },
  }
}

describe('firstRunHint', () => {
  it('未設定なら未読として扱う', () => {
    assert.equal(readHintSeen(createStorage()), false)
  })

  it('既読フラグを保存して読み出せる', () => {
    const storage = createStorage()
    writeHintSeen(storage)
    assert.equal(storage.getItem(FIRST_RUN_HINT_STORAGE_KEY), '1')
    assert.equal(readHintSeen(storage), true)
  })

  it('storage が使えない環境では既読扱いにして再表示しない', () => {
    assert.equal(readHintSeen(null), true)
    assert.doesNotThrow(() => writeHintSeen(null))
  })

  it('マップタブ表示中・未読・未操作のときだけ attention を出す', () => {
    assert.equal(shouldShowAttention({ seen: false, active: true, interacted: false }), true)
    assert.equal(shouldShowAttention({ seen: true, active: true, interacted: false }), false)
    assert.equal(shouldShowAttention({ seen: false, active: false, interacted: false }), false)
    assert.equal(shouldShowAttention({ seen: false, active: true, interacted: true }), false)
  })

  it('ハードリロードのフラグを立てて消費できる', () => {
    const storage = createStorage()
    assert.equal(readHardReloadFlag(storage), false)
    markHardReload(storage)
    assert.equal(readHardReloadFlag(storage), true)
    clearHardReloadFlag(storage)
    assert.equal(readHardReloadFlag(storage), false)
  })

  it('一般的なハードリロードのショートカットだけを検知する', () => {
    const base = {
      key: 'r',
      code: 'KeyR',
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
      altKey: false,
    }
    const input = (overrides: Partial<typeof base>) => ({ ...base, ...overrides })

    assert.equal(isHardReloadShortcut(input({ ctrlKey: true, shiftKey: true })), true)
    assert.equal(
      isHardReloadShortcut(input({ key: 'я', code: 'KeyR', ctrlKey: true, shiftKey: true })),
      true,
    )
    assert.equal(isHardReloadShortcut(input({ metaKey: true, shiftKey: true })), true)
    assert.equal(isHardReloadShortcut(input({ metaKey: true, altKey: true })), true)
    assert.equal(
      isHardReloadShortcut(input({ key: 'F5', ctrlKey: true, shiftKey: false, altKey: false })),
      true,
    )
    assert.equal(isHardReloadShortcut(input({ key: 'F5', shiftKey: true, altKey: false })), true)
    assert.equal(isHardReloadShortcut(input({ ctrlKey: true })), false)
    assert.equal(isHardReloadShortcut(input({ key: 'F5' })), false)
    assert.equal(isHardReloadShortcut(input({})), false)
  })
})
