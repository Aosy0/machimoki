import { Cartesian3, Matrix3, Matrix4, Transforms } from 'cesium'

const DEGREES_TO_RADIANS = Math.PI / 180

/**
 * 選択範囲中心の ENU 基準で、平行光源(太陽)の進行方向を ECEF で返す。
 *
 * Cesium の `DirectionalLight.direction` は「光が進む向き(光源→地表)」を
 * ワールド座標で持つ。固定の ECEF ベクトルだと緯度・経度で太陽高度が変わり、
 * 日本付近ではほぼ真上(高度70°超)になって地形に落ちる影がほとんど見えなくなる。
 * どの地域を選んでも同じ見え方になるよう、ローカル方位・高度から作る。
 *
 * @param lonDeg 中心経度(度)
 * @param latDeg 中心緯度(度)
 * @param azimuthDeg 光が進む方位(北=0°, 東=90°)
 * @param elevationDeg 光源の仰角(度)。小さいほど影が長くなる。
 */
export function sunLightDirection(
  lonDeg: number,
  latDeg: number,
  azimuthDeg = 150,
  elevationDeg = 45,
): Cartesian3 {
  const enuToFixed = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lonDeg, latDeg))
  const rotation = Matrix4.getMatrix3(enuToFixed, new Matrix3())
  const azimuth = azimuthDeg * DEGREES_TO_RADIANS
  const elevation = elevationDeg * DEGREES_TO_RADIANS
  const local = new Cartesian3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
    -Math.sin(elevation),
  )
  return Matrix3.multiplyByVector(rotation, local, new Cartesian3())
}
