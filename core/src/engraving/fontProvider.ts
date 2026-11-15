/**
 * 刻印フォントのプロバイダ。
 *
 * core はブラウザAPIもNode APIも直接使わないため、フォントバイナリの取得方法は
 * 実行環境ごとに注入する（CLI/API = 同梱ファイル、Web Worker = fetch）。
 */

import type { EngravingFont } from './font.js'
import { parseEngravingFont } from './font.js'

type FontDataProvider = () => Promise<ArrayBuffer>

let provider: FontDataProvider | null = null
let cached: Promise<EngravingFont> | null = null

/** フォント取得関数を設定する（null で解除）。 */
export function setEngravingFontProvider(next: FontDataProvider | null): void {
  provider = next
  cached = null
}

/** フォント取得関数が設定済みか。 */
export function isEngravingFontConfigured(): boolean {
  return provider !== null
}

/**
 * 刻印用フォントを取得する。初回のみバイナリ取得＋解析し、以降はキャッシュする。
 * プロバイダ未設定時はエラー（刻印は警告付きでスキップされる）。
 */
export async function getEngravingFont(): Promise<EngravingFont> {
  if (!provider) {
    throw new Error('刻印フォントが読み込まれていません')
  }
  if (!cached) {
    const load = provider
    cached = load()
      .then((data) => parseEngravingFont(data))
      .catch((error: unknown) => {
        cached = null
        throw error
      })
  }
  return cached
}
