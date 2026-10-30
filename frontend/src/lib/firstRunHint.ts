/** 初回ヒントの既読フラグとattention判定。DOM非依存でテストできる形にする。 */

export const FIRST_RUN_HINT_STORAGE_KEY = 'machimoki.tips.map.v1'
/** ハードリロード直後だけ初回ヒントを再表示するための一時フラグ。 */
export const HARD_RELOAD_FLAG_KEY = 'machimoki.tips.hardReload'
/** 読み込み後、拡大を始めるまでの待ち時間。 */
export const FIRST_RUN_HINT_DELAY_MS = 600
/** 初回のヒントを拡大表示しておく時間。操作があればこれより早く縮小する。 */
export const FIRST_RUN_HINT_ATTENTION_MS = 2500

export interface HintStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function getStorage(): HintStorage | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function getSessionStorage(): HintStorage | null {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage
}

/** 既読なら true。storage が使えない環境では再表示を避けるため true 扱い。 */
export function readHintSeen(storage: HintStorage | null = getStorage()): boolean {
  if (!storage) return true
  try {
    return storage.getItem(FIRST_RUN_HINT_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

/** 既読フラグを保存する。storage が使えなくても失敗は無視する。 */
export function writeHintSeen(storage: HintStorage | null = getStorage()): void {
  if (!storage) return
  try {
    storage.setItem(FIRST_RUN_HINT_STORAGE_KEY, '1')
  } catch {
    /* 保存できなくても表示自体は継続する */
  }
}

/** 初回attentionを出す条件。マップタブ表示中・未読・未操作のときだけ。 */
export function shouldShowAttention(input: {
  seen: boolean
  active: boolean
  interacted: boolean
}): boolean {
  return !input.seen && input.active && !input.interacted
}

/** ハードリロード後にattentionを強制するフラグが立っているか（読み取りのみ）。 */
export function readHardReloadFlag(storage: HintStorage | null = getSessionStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(HARD_RELOAD_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

/** ハードリロードのショートカット入力を検知したときにフラグを立てる。 */
export function markHardReload(storage: HintStorage | null = getSessionStorage()): void {
  if (!storage) return
  try {
    storage.setItem(HARD_RELOAD_FLAG_KEY, '1')
  } catch {
    /* 保存できなくても致命的ではない */
  }
}

/** 強制表示を消費したらフラグを消す。 */
export function clearHardReloadFlag(storage: HintStorage | null = getSessionStorage()): void {
  if (!storage) return
  try {
    storage.removeItem?.(HARD_RELOAD_FLAG_KEY)
  } catch {
    /* 削除できなくても続行する */
  }
}

/**
 * 一般的なハードリロードのキー操作か。
 * Windows/Linux: Ctrl+Shift+R / Ctrl+F5 / Shift+F5
 * macOS: Cmd+Shift+R / Cmd+Option+R
 */
export function isHardReloadShortcut(input: {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  const key = input.key.toLowerCase()
  const isF5 = key === 'f5' || input.code === 'F5'
  const isR = key === 'r' || input.code === 'KeyR'
  if (isF5) return input.ctrlKey || input.shiftKey
  if (!isR) return false
  if (input.ctrlKey && input.shiftKey) return true
  if (input.metaKey && input.shiftKey) return true
  if (input.metaKey && input.altKey) return true
  return false
}
