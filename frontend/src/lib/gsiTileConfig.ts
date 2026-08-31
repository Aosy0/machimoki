import { UrlTemplateImageryProvider } from 'cesium'

export type GsiTileStyle = 'std' | 'pale' | 'blank' | 'seamlessphoto' | 'contour'

export const GSI_TILE_URLS: Record<GsiTileStyle, string> = {
  std: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  pale: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  blank: 'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png',
  seamlessphoto: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
  contour: 'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png',
}

export const GSI_TILE_LABELS: Record<GsiTileStyle, string> = {
  std: '標準地図',
  pale: '淡色地図',
  blank: '白地図',
  seamlessphoto: '航空写真',
  contour: '等高線',
}

export const GSI_ATTRIBUTION = '© 国土地理院'

export function createGsiImageryProvider(style: GsiTileStyle): UrlTemplateImageryProvider {
  const url = GSI_TILE_URLS[style]
  // maximumLevel は GSIの提供範囲に合わせる（std/paleは18、seamlessphotoは18）
  return new UrlTemplateImageryProvider({
    url,
    maximumLevel: 18,
    credit: GSI_ATTRIBUTION,
  })
}

export const GSI_TILE_STYLES: GsiTileStyle[] = ['std', 'pale', 'blank', 'seamlessphoto', 'contour']

export const CONTOUR_STYLE = 'contour' as const
export function isContourStyle(style: GsiTileStyle): boolean {
  return style === 'contour'
}

export const GSI_STORAGE_KEY = 'machimoki.gsiStyle'

export function loadGsiStyle(): GsiTileStyle {
  try {
    const v = localStorage.getItem(GSI_STORAGE_KEY) as GsiTileStyle | null
    if (v && GSI_TILE_URLS[v]) return v
  } catch {}
  return 'pale'
}

export function saveGsiStyle(style: GsiTileStyle): void {
  try {
    localStorage.setItem(GSI_STORAGE_KEY, style)
  } catch {}
}
