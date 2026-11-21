import { describe, expect, it } from 'vitest'

import { LAYER_COLORS } from './layerColors'

describe('LAYER_COLORS', () => {
  it('プレビューとエクスポートで共有する色を変えない', () => {
    expect(LAYER_COLORS).toEqual({ brid: '#8fa3ad', tran: '#7d7d7d' })
  })
})
