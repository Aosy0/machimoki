/**
 * 地形枠（frame）と建物部分（地表プレート＋建物＋印刷用ベース）への分割。
 *
 * 分割の考え方:
 * - 地形枠 = 外周 O・ミッド S・内周 C の 3 ループからなる L 字断面の単一
 *   メッシュ。外周帯 O..S は地表まで、内側の段差 C..S（幅 FRAME_STEP_MM）は
 *   リング上端（terrain - 0.9t）で、建物側プレートの外周が乗る。union を
 *   使わないため外周に微小スライバが残らない。
 * - 建物部分 = 完成モデルから地形枠を引いたもの（地表プレート＋建物）に、
 *   底面を平らにする「短い中実ベース」を union したもの。プレート外周は S で
 *   切り取られ、ベースは枠の空洞にクリアランス分だけ内側で嵌まる。地形の
 *   最低点から少し下まで届く。中空化ONのときは建物カッターでベースを
 *   貫通させ、建物空洞の開口を塞がない（ベース自体は中実のまま、底面に開口）。
 *
 * このモジュールはブラウザ / Worker からも安全に使える（Cesium・I/O 非依存）。
 */

import type { Manifold } from 'manifold-3d'

import {
  BASE_CLEARANCE_MM,
  BASE_EXTENSION_MM,
  FRAME_STEP_MM,
  MIN_FRAME_HEIGHT_MM,
} from './frameSplitConstants.js'
import { createManifoldFromMesh, removeTinyShells, unionManifolds } from './manifoldOps.js'
import { buildBaseSlabMesh, buildFrameCutterMesh, buildTerrainCavityMesh } from './pipelineCore.js'
import type { RawMesh } from './types.js'

export { BASE_CLEARANCE_MM, BASE_EXTENSION_MM, FRAME_STEP_MM, MIN_FRAME_HEIGHT_MM }

/** モデル空間 → 印刷mm の換算（エクスポートと同じ 1/1000）。 */
const MODEL_UNITS_PER_MM = 0.001

export interface FrameSplitParts {
  /** 地形枠（側壁＋底面リム＋外周帯の地形表層。内側上端が段差） */
  frame: Manifold
  /** 建物部分（地表プレート＋建物＋平らな底面を作る短い中実ベース） */
  buildings: Manifold
}

export interface FrameSplitPrebuilt {
  /** 既に構築済みの空洞メッシュ */
  cavityMesh?: RawMesh
  /**
   * 中空化で使った建物カッターの union。渡された場合、ベースにも同じ開口を
   * 貫通させて建物空洞を密閉しない。所有権は呼び出し側（delete しない）。
   */
  buildingCutter?: Manifold
}

/**
 * 完成モデルを地形枠と建物部分に分割する。
 *
 * `final` は変更・破棄しない（呼び出し側が所有）。戻り値の 2 つの Manifold は
 * 呼び出し側が delete する。パーツが有効なソリッドにならない場合は例外を投げる。
 *
 * @param final 中空化済みの完成モデル（Y-up・スケール済みモデル空間）
 * @param terrainMesh スケール済み地形スラブ（2·n² 頂点）
 * @param shellThickness シェル厚み（モデル空間。印刷mm/1000）
 */
export async function splitFrameAndBuildings(
  final: Manifold,
  terrainMesh: RawMesh,
  shellThickness: number,
  prebuilt?: FrameSplitPrebuilt,
): Promise<FrameSplitParts> {
  const t = shellThickness
  if (!Number.isFinite(t) || t <= 0) {
    throw new Error(`Invalid shellThickness for split: ${shellThickness}`)
  }

  const cavityMesh = prebuilt?.cavityMesh ?? buildTerrainCavityMesh(terrainMesh, t)
  if (!cavityMesh) {
    throw new Error('分割できませんでした: 地形厚みに対してシェル厚みが大きすぎます')
  }

  // L 字断面の単一メッシュ。union しないので外周に微小な残渣が出ない。
  const frameMesh = buildFrameCutterMesh(
    terrainMesh,
    cavityMesh,
    t,
    FRAME_STEP_MM * MODEL_UNITS_PER_MM,
  )
  if (!frameMesh) {
    throw new Error('分割できませんでした: 地形枠を生成できません')
  }
  const frameCutter = await createManifoldFromMesh(frameMesh)
  let frame: Manifold | null = null
  let cutBuildings: Manifold | null = null
  let buildings: Manifold | null = null
  try {
    // 枠の内壁は完成モデルの空洞壁と一致する。subtract だと一致面が
    // ゼロ厚の板として建物側に残るため、両パーツを同時に返す split を使う。
    ;[frame, cutBuildings] = final.split(frameCutter)

    if (
      frame.status() !== 'NoError' ||
      cutBuildings.status() !== 'NoError' ||
      !(frame.volume() > 0) ||
      !(cutBuildings.volume() > 0)
    ) {
      throw new Error('分割できませんでした: パーツが有効なソリッドになりませんでした')
    }

    // プレート下面の凹凸を埋める中実ベースを建物部分へ union する。
    // 足跡は空洞境界から clearance 内側なので枠とは交差しない。
    const baseMesh = buildBaseSlabMesh(
      terrainMesh,
      t,
      BASE_CLEARANCE_MM * MODEL_UNITS_PER_MM,
      BASE_EXTENSION_MM * MODEL_UNITS_PER_MM,
    )
    if (!baseMesh) {
      throw new Error('分割できませんでした: ベースを生成できません')
    }
    let base = await createManifoldFromMesh(baseMesh)
    try {
      // 中空化ONでも建物空洞の開口をベース越しに開けたままにする。
      // 穴はプレート開口と同じカッター由来なので位置が一致する。
      const buildingCutter = prebuilt?.buildingCutter
      if (buildingCutter) {
        const opened = base.subtract(buildingCutter)
        base.delete()
        base = opened
        if (base.status() !== 'NoError' || !(base.volume() > 0)) {
          throw new Error('分割できませんでした: ベースの開口に失敗しました')
        }
      }
      buildings = await unionManifolds([cutBuildings, base])
    } finally {
      base.delete()
    }
    cutBuildings.delete()
    cutBuildings = null

    // 外周のブール演算で残る微小スライバを除去する（本体だけを残す）。
    const cleaned = await removeTinyShells(buildings)
    buildings.delete()
    buildings = cleaned

    if (buildings.status() !== 'NoError' || !(buildings.volume() > 0)) {
      throw new Error('分割できませんでした: パーツが有効なソリッドになりませんでした')
    }

    const result: FrameSplitParts = { frame, buildings }
    // 返却する Manifold の二重削除を防ぐ。
    frame = null
    buildings = null
    return result
  } catch (error) {
    frame?.delete()
    cutBuildings?.delete()
    buildings?.delete()
    throw error
  } finally {
    frameCutter.delete()
  }
}
