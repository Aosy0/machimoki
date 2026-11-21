/**
 * 橋梁・道路レイヤーの色。
 *
 * プレビューの重ね表示と 3MF の三角形色で同じ値を使う。エクスポート時は
 * core の ExportOptions.bridgeColor / roadColor にそのまま渡す。
 */
export const LAYER_COLORS = { brid: '#8fa3ad', tran: '#7d7d7d' } as const
