/**
 * 完成メッシュ（エクスポートと同一の形状）の IndexedDB 永続キャッシュ。
 *
 * プレビューの自動再生成とエクスポートで同じ形状計算を共有し、
 * リロード後も作り直しを避ける。最新1件のみ保持する。
 * 失敗時（容量不足・未対応環境など）は黙って諦め、従来生成にフォールバックする。
 */

export interface FinalShapeCacheEntry {
  key: string
  positions: Float32Array
  indices: Uint32Array
  warnings: string[]
}

export interface CachedFinalShapeMesh {
  positions: Float32Array
  indices: Uint32Array
  warnings: string[]
}

const DB_NAME = 'machimoki-final-shape'
const STORE_NAME = 'meshes'
/** 最新1件のみ保持するための固定スロット。 */
const SLOT_KEY = 'latest'
/** 保存上限（positions + indices の合計バイト数）。 */
const MAX_CACHE_BYTES = 50 * 1024 * 1024

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME)
      }
      req.onsuccess = () => resolve(req.result)
      const giveUp = (): void => resolve(null)
      req.onerror = giveUp
      req.onblocked = giveUp
    } catch {
      resolve(null)
    }
  })
}

function closeDb(db: IDBDatabase): void {
  try {
    db.close()
  } catch {
    void 0
  }
}

/** 取得値の形式を検証する（Float32Array / Uint32Array でなければ null）。 */
function asValidEntry(value: unknown, key: string): CachedFinalShapeMesh | null {
  if (value == null || typeof value !== 'object') return null
  const entry = value as Partial<FinalShapeCacheEntry> & { key?: unknown }
  if (entry.key !== key) return null
  if (!(entry.positions instanceof Float32Array)) return null
  if (!(entry.indices instanceof Uint32Array)) return null
  return {
    positions: entry.positions,
    indices: entry.indices,
    warnings: Array.isArray(entry.warnings)
      ? entry.warnings.filter((w) => typeof w === 'string')
      : [],
  }
}

export async function loadFinalShapeCache(key: string): Promise<CachedFinalShapeMesh | null> {
  try {
    const db = await openDb()
    if (!db) return null
    try {
      const value = await new Promise<unknown>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly')
          const get = tx.objectStore(STORE_NAME).get(SLOT_KEY)
          get.onsuccess = () => resolve(get.result ?? null)
          get.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
      return asValidEntry(value, key)
    } finally {
      closeDb(db)
    }
  } catch {
    return null
  }
}

function putEntry(db: IDBDatabase, entry: FinalShapeCacheEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      // 最新1件のみ保持するため、保存前に全消去する。
      store.clear()
      store.put(entry, SLOT_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('finalShapeCache: put failed'))
      tx.onabort = () => reject(tx.error ?? new Error('finalShapeCache: put aborted'))
    } catch (err) {
      reject(err)
    }
  })
}

function clearStore(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('finalShapeCache: clear failed'))
      tx.onabort = () => reject(tx.error ?? new Error('finalShapeCache: clear aborted'))
    } catch (err) {
      reject(err)
    }
  })
}

function isQuotaExceeded(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'QuotaExceededError'
  )
}

export async function saveFinalShapeCache(entry: FinalShapeCacheEntry): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') return
    // 大きすぎるメッシュは保存しない。
    if (entry.positions.byteLength + entry.indices.byteLength > MAX_CACHE_BYTES) return
    const db = await openDb()
    if (!db) return
    try {
      await putEntry(db, entry)
    } catch (err) {
      if (!isQuotaExceeded(err)) return
      // 容量不足なら全消去して1回だけ再試行し、ダメなら黙って諦める。
      try {
        await clearStore(db)
        await putEntry(db, entry)
      } catch {
        void 0
      }
    } finally {
      closeDb(db)
    }
  } catch {
    void 0
  }
}
