/**
 * 刻印できる面の寸法・可否の計算（UIとパイプラインで共有する純粋関数）。
 */

import type { EngravingFaceDims, EngravingModelDims } from './types.js'
import { MIN_SIDE_BAND_HEIGHT_MM } from './types.js'

/** 地形厚みから側面に刻印できる帯の高さ（印刷mm）。 */
export function engravingSideBandHeightMm(dims: EngravingModelDims): number {
  const miter = dims.splitAtGround ? 0.9 * dims.shellThicknessMm : 0
  return Math.max(0, dims.terrainThicknessMm - miter)
}

/**
 * 選択範囲・地形設定から、各面の寸法と刻印可否を求める。
 *
 * - 底面: 地形があり、底面開口がなく、底面がフラットなときだけ使える。
 * - 側面: 地形があり、帯の高さが最低高さ以上のときだけ使える。
 *   分割時は45°マイターの継ぎ目（上端 0.9×シェル厚み）より下に収める。
 * - 壁厚は底面開口時のみシェル厚み（側面の刻印深さの上限になる）。
 */
export function computeEngravingFaceDims(dims: EngravingModelDims): EngravingFaceDims[] {
  const sideHeight = engravingSideBandHeightMm(dims)
  const wallThicknessMm = dims.openBottom ? dims.shellThicknessMm : 0
  const noTerrainReason = '地形を含めない場合は刻印できません'

  let bottomReason: string | undefined
  if (!dims.hasTerrain) {
    bottomReason = noTerrainReason
  } else if (!dims.flatBottom) {
    bottomReason = '底面がフラットではありません（「底面をフラット化」を有効にしてください）'
  } else if (dims.openBottom) {
    bottomReason = '底面を開口しているため底面には刻印できません（側面は刻印できます）'
  }

  let sideReason: string | undefined
  if (!dims.hasTerrain) {
    sideReason = noTerrainReason
  } else if (sideHeight < MIN_SIDE_BAND_HEIGHT_MM) {
    sideReason = `側面の高さ（${sideHeight.toFixed(1)}mm）が足りません。地形厚みを増やしてください`
  }

  const bottom: EngravingFaceDims = {
    face: 'bottom',
    available: bottomReason === undefined,
    unavailableReason: bottomReason,
    widthMm: dims.widthMm,
    heightMm: dims.depthMm,
    // 底面は地形スラブの厚みがそのまま刻印の奥行き上限になる。
    wallThicknessMm: dims.terrainThicknessMm,
  }

  const side = (face: 'south' | 'north' | 'east' | 'west', widthMm: number): EngravingFaceDims => ({
    face,
    available: sideReason === undefined,
    unavailableReason: sideReason,
    widthMm,
    heightMm: sideHeight,
    wallThicknessMm,
  })

  return [
    bottom,
    side('south', dims.widthMm),
    side('north', dims.widthMm),
    side('east', dims.depthMm),
    side('west', dims.depthMm),
  ]
}
