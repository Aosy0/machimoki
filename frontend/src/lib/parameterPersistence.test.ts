import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { ADVANCED_PARAMETER_KEYS, omitAdvancedParameters } from './parameterPersistence'

describe('omitAdvancedParameters', () => {
  it('詳細設定の項目を落とし、それ以外は残す', () => {
    const stored = omitAdvancedParameters({
      openBottom: true,
      splitAtGround: true,
      terrainThickness: 30,
      includeTerrain: true,
      lod: 'lod2',
    })
    assert.deepEqual(stored, { includeTerrain: true, lod: 'lod2' })
  })

  it('詳細設定のキーは ParameterPanel の詳細設定セクションの項目と一致する', () => {
    assert.deepEqual([...ADVANCED_PARAMETER_KEYS].sort(), [
      'buildingColor',
      'flattenBottom',
      'hollowBuildings',
      'includeSpanningBuildings',
      'openBottom',
      'reflectActualElevation',
      'shellThickness',
      'splitAtGround',
      'terrainColor',
      'terrainGridSize',
      'terrainThickness',
      'upAxis',
    ])
  })

  it('元のオブジェクトを変更しない', () => {
    const original = { openBottom: true, includeTerrain: true }
    omitAdvancedParameters(original)
    assert.deepEqual(original, { openBottom: true, includeTerrain: true })
  })
})
