/**
 * フロントエンド側の刻印フォント取得。
 *
 * core はブラウザAPIを使わないため、フォントバイナリ（M PLUS 1p Bold,
 * SIL OFL 1.1）の取得方法をここで注入する。fontProvider が解析結果を
 * キャッシュするので、初回のみ fetch + parse が走る。
 */

import fontUrl from '../../../core/assets/MPLUS1p-Bold.ttf?url'
import type { EngravingFont } from '../../../core/src/engraving/font.ts'
import {
  getEngravingFont,
  setEngravingFontProvider,
} from '../../../core/src/engraving/fontProvider.ts'

setEngravingFontProvider(async () => {
  const response = await fetch(fontUrl)
  if (!response.ok) {
    throw new Error(`刻印フォントの取得に失敗しました（${response.status}）`)
  }
  return response.arrayBuffer()
})

/** 刻印用フォントを取得する（初回のみ取得・解析、以降はキャッシュ）。 */
export function loadEngravingFont(): Promise<EngravingFont> {
  return getEngravingFont()
}
