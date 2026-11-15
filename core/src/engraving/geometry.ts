/**
 * 刻印カッター（彫り込み用ソリッド）の生成。
 *
 * レイアウト済みのグリフ輪郭を面ローカルmm → モデル空間（スケール済みm）へ
 * 変換し、面の内側から外側へ押し出したソリッドを作る。パイプライン側で
 * 完成メッシュから subtract することで凹刻になる。
 */

import type { Manifold } from 'manifold-3d'
import { getManifoldModule } from 'manifold-3d/lib/wasm.js'
import type { EngravingFont } from './font.js'
import type { EngravingLayout } from './layout.js'
import type { EngravingFace } from './types.js'

/** 面の位置・向き（モデル空間・スケール済みメートル）。 */
export interface EngravingFaceFrame {
  face: EngravingFace
  /** 面の幅（印刷mm） */
  widthMm: number
  /** 面の高さ（印刷mm） */
  heightMm: number
  /** 面の中心（モデル空間m） */
  center: [number, number, number]
  /** 面内の右方向（単位ベクトル・モデル空間） */
  u: [number, number, number]
  /** 面内の上方向（単位ベクトル・モデル空間） */
  v: [number, number, number]
  /** 外向き法線（単位ベクトル・モデル空間） */
  normal: [number, number, number]
}

export interface BuildEngravingCutterParams {
  frame: EngravingFaceFrame
  layout: EngravingLayout
  font: EngravingFont
  /** 刻印深さ（印刷mm） */
  depthMm: number
}

/** 共平面ブールを避けるため面の外側へ出す量（印刷mm）。 */
const OUTSIDE_MM = 0.2

type Polygon = Array<[number, number]>

/**
 * レイアウト済みグリフからカッターの Manifold を作る。
 * 輪郭が空・退化している場合は null。
 */
export async function buildEngravingCutter(
  params: BuildEngravingCutterParams,
): Promise<Manifold | null> {
  const { frame, layout, font, depthMm } = params
  if (!(depthMm > 0) || !Number.isFinite(depthMm)) return null

  const contours: Polygon[] = []
  for (const line of layout.lines) {
    for (const glyph of line.glyphs) {
      const outline = font.outlineEm(glyph.char)
      if (outline.length === 0) continue
      for (const contour of outline) {
        if (contour.length < 3) continue
        const points: Polygon = []
        for (const point of contour) {
          const xMm = line.x + glyph.x + point.x * line.sizeMm
          const yMm = line.baselineY + point.y * line.sizeMm
          points.push([xMm / 1000, yMm / 1000])
        }
        contours.push(points)
      }
    }
  }
  if (contours.length === 0) return null

  const wasm = await getManifoldModule()
  const { CrossSection } = wasm
  const section = CrossSection.ofPolygons(contours, 'NonZero')
  if (!section) return null

  const outsideM = OUTSIDE_MM / 1000
  const depthM = depthMm / 1000
  const heightM = depthM + outsideM
  let extruded: Manifold
  try {
    extruded = section.extrude(heightM)
  } finally {
    section.delete()
  }

  // 面ローカル(x=u, y=v, z=外向き法線) → モデル空間。
  // z=0 は面から depthMm 内側で、押し出しで面の outside 分だけ外へ抜ける。
  const halfWidthM = frame.widthMm / 2000
  const halfHeightM = frame.heightMm / 2000
  const origin: [number, number, number] = [
    frame.center[0] - frame.u[0] * halfWidthM - frame.v[0] * halfHeightM - frame.normal[0] * depthM,
    frame.center[1] - frame.u[1] * halfWidthM - frame.v[1] * halfHeightM - frame.normal[1] * depthM,
    frame.center[2] - frame.u[2] * halfWidthM - frame.v[2] * halfHeightM - frame.normal[2] * depthM,
  ]

  // u × v = 外向き法線（各面の定義より）なので、この基底は右手系。
  const matrix: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ] = [
    frame.u[0],
    frame.u[1],
    frame.u[2],
    0,
    frame.v[0],
    frame.v[1],
    frame.v[2],
    0,
    frame.normal[0],
    frame.normal[1],
    frame.normal[2],
    0,
    origin[0],
    origin[1],
    origin[2],
    1,
  ]

  try {
    return extruded.transform(matrix)
  } finally {
    extruded.delete()
  }
}
