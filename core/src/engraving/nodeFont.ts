/**
 * Node（CLI/API）用の刻印フォント設定。
 *
 * 同梱フォント（core/assets/MPLUS1p-Bold.ttf, SIL Open Font License 1.1）を
 * 読み込む。ブラウザからは import しないこと（node:fs を使うため）。
 */

import { readFile } from 'node:fs/promises'
import { setEngravingFontProvider } from './fontProvider.js'

/** 同梱フォントのパス（src/engraving からも dist/engraving からも core/assets を指す）。 */
const FONT_URL = new URL('../../assets/MPLUS1p-Bold.ttf', import.meta.url)

/** Node 実行環境で刻印フォントを有効化する。 */
export function configureNodeEngravingFont(): void {
  setEngravingFontProvider(async () => {
    const buffer = await readFile(FONT_URL)
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  })
}
