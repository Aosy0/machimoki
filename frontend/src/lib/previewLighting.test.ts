import assert from 'node:assert/strict'
import { Cartesian3, Matrix3, Matrix4, Transforms } from 'cesium'
import { describe, it } from 'vitest'
import { sunLightDirection } from './previewLighting'

const DEG = Math.PI / 180

describe('sunLightDirection', () => {
  it('単位ベクトルで、指定した仰角・方位のローカル方向になる', () => {
    const lon = 139.69
    const lat = 35.7
    const direction = sunLightDirection(lon, lat, 150, 45)

    assert.ok(Math.abs(Cartesian3.magnitude(direction) - 1) < 1e-9)

    const enuToFixed = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat))
    const rotation = Matrix4.getMatrix3(enuToFixed, new Matrix3())
    const local = Matrix3.multiplyByVector(
      Matrix3.transpose(rotation, new Matrix3()),
      direction,
      new Cartesian3(),
    )

    // 光は下向き(up 成分が -sin(仰角))で、方位150°(南東)へ進む。
    assert.ok(Math.abs(Math.asin(-local.z) / DEG - 45) < 1e-9)
    assert.ok(local.x > 0)
    assert.ok(local.y < 0)
  })

  it('緯度・経度が変わっても仰角は一定', () => {
    for (const [lon, lat] of [
      [139.69, 35.7],
      [130.4, 33.6],
      [127.7, 26.2],
      [141.35, 43.06],
    ]) {
      const direction = sunLightDirection(lon, lat, 150, 45)
      const enuToFixed = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat))
      const rotation = Matrix4.getMatrix3(enuToFixed, new Matrix3())
      const up = Matrix3.getColumn(rotation, 2, new Cartesian3())
      // 回転行列の列は正規直交なので、そのまま鉛直方向として使える。
      const downDot = Cartesian3.dot(direction, up)
      assert.ok(Math.abs(Math.asin(-downDot) / DEG - 45) < 1e-6)
    }
  })
})
