/**
 * 刻印（エングレーブ）モジュール。
 *
 * ブラウザ非依存の純粋関数（レイアウト・面寸法・内容書式）と、manifold-3d を
 * 使う幾何生成・パイプライン連携を公開する。フォント取得は
 * `setEngravingFontProvider` で実行環境ごとに注入する。
 */

export * from './types.js'
export * from './faces.js'
export * from './content.js'
export * from './font.js'
export * from './fontProvider.js'
export * from './layout.js'
export * from './geometry.js'
export * from './pipeline.js'
