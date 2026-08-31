import {
  Credit,
  Event,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type ImageryTypes,
  type Proxy,
  type TileDiscardPolicy,
} from 'cesium'

/**
 * GSI DEM PNG タイルから等高線を描画する ImageryProvider。
 *
 * 256x256 の DEM PNG（RGBエンコード）を取得し、ピクセル単位で標高をデコードして
 * 等高線を Canvas に描画する。地形メッシュの解像度に依存しないため、
 * ズームアウトしてもローポリにならない高精細な等高線を表示できる。
 *
 * データソース: 国土地理院 標高タイル（PNG形式）
 * https://maps.gsi.go.jp/development/demtile.html
 */

const DEM_URL_TEMPLATE = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png'

const TILE_SIZE = 256

const WEB_MERCATOR_TILING_SCHEME = new WebMercatorTilingScheme()

/** 等高線の線色（#5a3a1a, alpha 0.6） */
const CONTOUR_STROKE = 'rgba(90, 58, 26, 0.6)'

/**
 * GSI DEM PNG のデコード仕様:
 *   value = R*256*256 + G*256 + B
 *   value <  2^23      -> h = value * 0.01
 *   value == 2^23      -> 無効値（(R,G,B)=(128,0,0)）
 *   value >  2^23      -> h = (value - 2^24) * 0.01
 */
function decodeDemPixel(r: number, g: number, b: number): number | null {
  const value = r * 65536 + g * 256 + b
  if (value === 8388608) return null
  if (value < 8388608) return value * 0.01
  return (value - 16777216) * 0.01
}

function getSpacingForLevel(level: number): number {
  if (level < 7) return 2000
  if (level < 8) return 1000
  if (level < 9) return 500
  if (level < 10) return 200
  if (level < 11) return 100
  if (level < 12) return 50
  if (level < 13) return 20
  return 10
}

/** DEM PNG の ImageData をデコードして標高配列（Float32Array, 無効値は NaN）を返す */
function decodeHeights(imageData: ImageData): Float32Array {
  const data = imageData.data
  const heights = new Float32Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < TILE_SIZE * TILE_SIZE; i++) {
    const h = decodeDemPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    heights[i] = h ?? NaN
  }
  return heights
}

/**
 * 標高配列から等高線を描画した透明 Canvas を生成する。
 * 各ピクセル (i,j) の標高と右隣 (i+1,j)・下隣 (i,j+1) を比較し、
 * Math.floor(h / spacing) が異なる境界に線を引く。
 */
function drawContours(heights: Float32Array, spacing: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.strokeStyle = CONTOUR_STROKE
  ctx.lineWidth = 1
  ctx.beginPath()

  // 横方向の境界（行 j と j+1 の間）
  for (let j = 0; j < TILE_SIZE - 1; j++) {
    const row = j * TILE_SIZE
    const nextRow = row + TILE_SIZE
    for (let i = 0; i < TILE_SIZE; i++) {
      const h = heights[row + i]
      const hDown = heights[nextRow + i]
      if (Number.isNaN(h) || Number.isNaN(hDown)) continue
      if (Math.floor(h / spacing) !== Math.floor(hDown / spacing)) {
        ctx.moveTo(i, j + 0.5)
        ctx.lineTo(i + 1, j + 0.5)
      }
    }
  }

  // 縦方向の境界（列 i と i+1 の間）
  for (let j = 0; j < TILE_SIZE; j++) {
    const row = j * TILE_SIZE
    for (let i = 0; i < TILE_SIZE - 1; i++) {
      const h = heights[row + i]
      const hRight = heights[row + i + 1]
      if (Number.isNaN(h) || Number.isNaN(hRight)) continue
      if (Math.floor(h / spacing) !== Math.floor(hRight / spacing)) {
        ctx.moveTo(i + 0.5, j)
        ctx.lineTo(i + 0.5, j + 1)
      }
    }
  }

  ctx.stroke()
  return canvas
}

/** 透明な 256x256 Canvas を生成する（fetch失敗時のフォールバック） */
function createTransparentTile(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = TILE_SIZE
  canvas.height = TILE_SIZE
  return canvas
}

/**
 * 国土地理院 DEM PNG タイルから等高線を描画する ImageryProvider。
 * requestImage(x, y, level) が 256x256 の等高線 Canvas を返す。
 */
export class ContourImageryProvider implements ImageryProvider {
  readonly tilingScheme = WEB_MERCATOR_TILING_SCHEME
  readonly rectangle = WEB_MERCATOR_TILING_SCHEME.rectangle
  readonly tileWidth = TILE_SIZE
  readonly tileHeight = TILE_SIZE
  readonly minimumLevel = 5
  readonly maximumLevel = 14
  readonly tileDiscardPolicy: TileDiscardPolicy = undefined as unknown as TileDiscardPolicy
  readonly errorEvent = new Event()
  readonly credit = new Credit('© 国土地理院 DEM')
  readonly proxy: Proxy = undefined as unknown as Proxy
  readonly hasAlphaChannel = true

  getTileCredits(): Credit[] {
    return []
  }

  requestImage(x: number, y: number, level: number): Promise<ImageryTypes> | undefined {
    const spacing = getSpacingForLevel(level)
    if (spacing === null) return Promise.resolve(createTransparentTile())
    const url = DEM_URL_TEMPLATE.replace('{z}', String(level)).replace('{x}', String(x)).replace('{y}', String(y))
    return fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`DEMタイル取得失敗: ${res.status}`)
        return res.blob()
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const canvas = document.createElement('canvas')
        canvas.width = TILE_SIZE
        canvas.height = TILE_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          bitmap.close()
          return createTransparentTile()
        }
        ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
        const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
        const heights = decodeHeights(imageData)
        return drawContours(heights, spacing)
      })
      .catch(() => {
        return createTransparentTile()
      })
  }

  pickFeatures(): undefined {
    return undefined
  }
}