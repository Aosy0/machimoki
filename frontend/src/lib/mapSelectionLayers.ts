/**
 * MapLibre上の選択矩形・ピック点表示（Cesium非依存）。
 *
 * - 選択矩形: SelectionBounds→GeoJSON Polygon（閉環・[lng,lat]順）
 * - ピック点: PickPoint[]→GeoJSON Point集約（Cesium版の赤丸＋白縁相当）
 * - 実Mapへの反映は ensure/remove 系で行い、失敗は吞み込んで
 *   export経路をブロックしない。
 */
import type { SelectionBounds } from './selectionBounds'
import {
  handleVisibility,
  selectionHandleScreenPoints,
  type HandleVisibility,
  type ResizeHandle,
} from './mapSelectionResize'

export interface PickPoint {
  lon: number
  lat: number
}

/**
 * 選択系（矩形・ハンドル・ホバー）はすべて単一ソースで描く。
 * 別ソースだとGeoJSONワーカー更新がフレーム単位でずれ、高速ドラッグ中に
 * 辺とハンドル/ホバーが1フレーム遅れて描画されるため。
 */
export const SELECTION_SOURCE_ID = 'machimoki-selection'
export const SELECTION_FILL_LAYER_ID = 'machimoki-selection-fill'
export const SELECTION_LINE_LAYER_ID = 'machimoki-selection-line'
/** リサイズハンドルのレイヤー（角=circle・辺=symbol）。単一ソース参照。 */
export const SELECTION_HANDLES_LAYER_ID = 'machimoki-selection-handles'
export const SELECTION_EDGE_HANDLES_LAYER_ID = 'machimoki-selection-edge-handles'
/** 辺中点カプセルの実行時生成画像（水平/垂直×通常/ホバー強調の4枚） */
export const SELECTION_HANDLE_IMAGE_H_ID = 'machimoki-handle-h'
export const SELECTION_HANDLE_IMAGE_V_ID = 'machimoki-handle-v'
export const SELECTION_HANDLE_HOVER_IMAGE_H_ID = 'machimoki-handle-hover-h'
export const SELECTION_HANDLE_HOVER_IMAGE_V_ID = 'machimoki-handle-hover-v'
/** ホバー強調（つまみ自体）のレイヤー（辺=symbol・角=circle）。単一ソース参照。 */
export const SELECTION_HOVER_SYMBOL_LAYER_ID = 'machimoki-selection-hover-symbol'
export const SELECTION_HOVER_CIRCLE_LAYER_ID = 'machimoki-selection-hover-circle'
export const PICK_SOURCE_ID = 'machimoki-picks'
export const PICK_LAYER_ID = 'machimoki-pick-points'

/** 選択矩形の塗り（コントローラーの描画ボックスと同系色） */
export const SELECTION_FILL_COLOR = '#00bcd4'
export const SELECTION_FILL_OPACITY = 0.15
/** ハンドルの配色（白fill＋濃いめシアン枠で薄い地図上でも視認させる） */
export const SELECTION_HANDLE_FILL_COLOR = '#ffffff'
export const SELECTION_HANDLE_STROKE_COLOR = '#00bcd4'
/** 角ハンドル（円）の半径。つまめる感を出すため辺より大きめ。 */
export const SELECTION_CORNER_RADIUS = 6
/** 辺中点カプセルの見た目（長さ26×太さ11・白fill＋シアン2px枠・端は半円） */
export const SELECTION_CAPSULE_LENGTH_PX = 26
export const SELECTION_CAPSULE_WIDTH_PX = 11
export const SELECTION_CAPSULE_STROKE_PX = 2
/** ホバー強調カプセルの配色（通常の反転。シアンfill＋白枠で薄い地図上でも目立つ） */
export const SELECTION_HANDLE_HOVER_FILL_COLOR = '#00bcd4'
export const SELECTION_HANDLE_HOVER_STROKE_COLOR = '#ffffff'
/** ホバー強調カプセルの拡大率（通常に対する倍率。配色反転と組み合わせる） */
export const SELECTION_HOVER_ICON_SIZE = 1.2
/** カプセル画像のにじみ防止（2xで描いてpixelRatio指定する） */
export const SELECTION_CAPSULE_PIXEL_RATIO = 2
/** ホバー強調の角円（白丸＋シアン太枠。つまみ自体の強調として維持） */
export const SELECTION_HOVER_CORNER_RADIUS = 9
export const SELECTION_HOVER_CORNER_STROKE_WIDTH = 3
/** ピック点の塗り（Cesium版の赤丸＋白縁相当） */
export const PICK_CIRCLE_COLOR = '#ff0000'
export const PICK_CIRCLE_STROKE_COLOR = '#ffffff'

/**
 * 実MapLibreMapとの代入互換を保つ最小形状。
 * getSourceはunknownで受け、setData可否は実行時に判定する。
 */
export interface OverlayMapLike {
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  getLayer(id: string): unknown
  addLayer(layer: unknown): void
  removeLayer(id: string): void
  removeSource(id: string): void
  /** 画像登録（カプセルハンドル用）。無いモックでも動くよう任意。 */
  hasImage?(id: string): unknown
  addImage?(id: string, image: unknown, options?: unknown): void
  /** 経緯度→画面px。ハンドル間引き用。無いモックでは全表示。 */
  project?(point: [number, number]): { x: number; y: number }
}

function sourceExists(map: OverlayMapLike, id: string): boolean {
  try {
    const source = map.getSource(id)
    return source !== undefined && source !== null
  } catch {
    return false
  }
}

function layerExists(map: OverlayMapLike, id: string): boolean {
  try {
    const layer = map.getLayer(id)
    return layer !== undefined && layer !== null
  } catch {
    return false
  }
}

interface SettableSource {
  setData: (data: unknown) => void
}

/** GeoJSONソースのsetDataを安全に取り出す。無ければnull。 */
function asSettableSource(value: unknown): SettableSource | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const candidate = value as { setData?: unknown }
  if (typeof candidate.setData !== 'function') {
    return null
  }
  // メソッド呼び出し形式を保つ（切り離すとMapLibreのsetDataがthis喪失で例外になる）。
  const source = candidate as { setData: (data: unknown) => void }
  return {
    setData: (data: unknown): void => {
      source.setData(data)
    },
  }
}

/** SelectionBounds→閉環Polygon Feature（座標は[lng,lat]順）。 */
export function selectionBoundsToPolygon(bounds: SelectionBounds): Record<string, unknown> {
  const ring: Array<[number, number]> = [
    [bounds.west, bounds.south],
    [bounds.east, bounds.south],
    [bounds.east, bounds.north],
    [bounds.west, bounds.north],
    [bounds.west, bounds.south],
  ]
  return {
    type: 'Feature',
    properties: { role: 'area' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

/** PickPoint[]→Point FeatureCollection。 */
export function pickPointsToFeatureCollection(points: PickPoint[]): Record<string, unknown> {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
    })),
  }
}

/** 角ハンドルか（円を大きくする判定用）。絞り込み時は辺側に絞られる。 */
export function isCornerHandle(handle: ResizeHandle): handle is 'nw' | 'ne' | 'se' | 'sw' {
  return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
}

/** bounds→8ハンドルの経緯度（4隅＋4辺中点）。装飾レイヤー用。 */
export function selectionHandlePoints(
  bounds: SelectionBounds,
): Array<{ handle: ResizeHandle; lng: number; lat: number }> {
  const midLng = (bounds.west + bounds.east) / 2
  const midLat = (bounds.south + bounds.north) / 2
  return [
    { handle: 'nw', lng: bounds.west, lat: bounds.north },
    { handle: 'ne', lng: bounds.east, lat: bounds.north },
    { handle: 'se', lng: bounds.east, lat: bounds.south },
    { handle: 'sw', lng: bounds.west, lat: bounds.south },
    { handle: 'north', lng: midLng, lat: bounds.north },
    { handle: 'east', lng: bounds.east, lat: midLat },
    { handle: 'south', lng: midLng, lat: bounds.south },
    { handle: 'west', lng: bounds.west, lat: midLat },
  ]
}

/**
 * 単一ソースへ載せるFeatureCollection。
 * area（矩形）＋8ハンドル＋任意のhoverを同一リビジョンで返す。
 * hoverHandle=null なら hover feature を含めない（=ホバー消去）。
 * visibility省略時は全表示。非表示ハンドルはFCから除外するが、
 * hoverは可視性に関わらず含める（ドラッグ中のアクティブ表示用）。
 */
export function selectionOverlayToFeatureCollection(
  bounds: SelectionBounds,
  hoverHandle: ResizeHandle | null,
  visibility?: HandleVisibility,
): Record<string, unknown> {
  const features: Array<Record<string, unknown>> = [selectionBoundsToPolygon(bounds)]
  for (const point of selectionHandlePoints(bounds)) {
    if (visibility !== undefined) {
      if (isCornerHandle(point.handle)) {
        if (!visibility.corners) continue
      } else if (!visibility.edges[point.handle]) {
        continue
      }
    }
    features.push({
      type: 'Feature',
      properties: {
        role: 'handle',
        handle: point.handle,
        corner: isCornerHandle(point.handle),
      },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    })
  }
  if (hoverHandle !== null) {
    features.push(selectionHoverFeature(bounds, hoverHandle))
  }
  return { type: 'FeatureCollection', features }
}

/** ホバー強調用の単一Point Feature。辺=中点・角=角点。kindで層を振り分ける。 */
function selectionHoverFeature(
  bounds: SelectionBounds,
  handle: ResizeHandle,
): Record<string, unknown> {
  const midLng = (bounds.west + bounds.east) / 2
  const midLat = (bounds.south + bounds.north) / 2
  switch (handle) {
    case 'north':
      return hoverPoint(midLng, bounds.north, 'edge', handle)
    case 'east':
      return hoverPoint(bounds.east, midLat, 'edge', handle)
    case 'south':
      return hoverPoint(midLng, bounds.south, 'edge', handle)
    case 'west':
      return hoverPoint(bounds.west, midLat, 'edge', handle)
    case 'nw':
      return hoverPoint(bounds.west, bounds.north, 'corner', handle)
    case 'ne':
      return hoverPoint(bounds.east, bounds.north, 'corner', handle)
    case 'se':
      return hoverPoint(bounds.east, bounds.south, 'corner', handle)
    case 'sw':
      return hoverPoint(bounds.west, bounds.south, 'corner', handle)
  }
}

/** ホバー用のPoint Feature（該当のつまみ位置）。roleで通常ハンドルと区別する。 */
function hoverPoint(
  lng: number,
  lat: number,
  kind: 'edge' | 'corner',
  handle: ResizeHandle,
): Record<string, unknown> {
  return {
    type: 'Feature',
    properties: { role: 'hover', kind, handle },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  }
}

/**
 * 画面pxからハンドル可視性を求める。projectが無いモックではundefined（=全表示）。
 * 失敗はundefinedに倒す（exportをブロックしない）。
 */
function selectionVisibility(
  map: OverlayMapLike,
  bounds: SelectionBounds,
): HandleVisibility | undefined {
  try {
    const project = map.project
    if (typeof project !== 'function') return undefined
    return handleVisibility(
      selectionHandleScreenPoints(bounds, (lngLat) => project.call(map, lngLat)),
    )
  } catch {
    return undefined
  }
}

/**
 * map→最後に適用したFCのJSON。move/zoomで毎フレーム呼ばれても、
 * 可視性が変わった瞬間だけsetDataするための差分キャッシュ。
 */
const appliedSelectionJson = new WeakMap<object, string>()

/** 選択系6レイヤーがすべて存在するか。 */
function allSelectionLayersExist(map: OverlayMapLike): boolean {
  return [
    SELECTION_FILL_LAYER_ID,
    SELECTION_LINE_LAYER_ID,
    SELECTION_HANDLES_LAYER_ID,
    SELECTION_EDGE_HANDLES_LAYER_ID,
    SELECTION_HOVER_SYMBOL_LAYER_ID,
    SELECTION_HOVER_CIRCLE_LAYER_ID,
  ].every((id) => layerExists(map, id))
}

/**
 * 単一ソースへFCを適用する共通処理。
 * ソースと6レイヤーが揃い、JSONが直近適用と同一ならsetDataをスキップする。
 * ソース存在時もレイヤー欠損を補う（setStyle後の復元を確実にするため）。
 */
function applySelectionData(map: OverlayMapLike, data: Record<string, unknown>): void {
  const dataJson = JSON.stringify(data)
  const source = map.getSource(SELECTION_SOURCE_ID)
  const sourcePresent = source !== undefined && source !== null
  if (sourcePresent && allSelectionLayersExist(map) && appliedSelectionJson.get(map) === dataJson) {
    return
  }
  const existing = asSettableSource(source)
  if (existing !== null) {
    existing.setData(data)
  } else {
    map.addSource(SELECTION_SOURCE_ID, { type: 'geojson', data })
  }
  ensureHandleImages(map)
  ensureHoverImages(map)
  addSelectionLayers(map)
  appliedSelectionJson.set(map, dataJson)
}

/**
 * 選択矩形オーバーレイを反映する。bounds=nullで除去。
 * 失敗は吞み込む（exportをブロックしない）。
 */
export function ensureSelectionOverlay(
  map: OverlayMapLike,
  bounds: SelectionBounds | null,
  hoverHandle: ResizeHandle | null = null,
): void {
  try {
    if (bounds === null) {
      removeSelectionOverlay(map)
      return
    }
    applySelectionData(
      map,
      selectionOverlayToFeatureCollection(bounds, hoverHandle, selectionVisibility(map, bounds)),
    )
  } catch {
    /* 表示失敗は無視 */
  }
}

/** 選択系レイヤーを重なり順（fill→line→角→辺→ホバー辺→ホバー角）で作る。 */
function addSelectionLayers(map: OverlayMapLike): void {
  if (!layerExists(map, SELECTION_FILL_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_FILL_LAYER_ID,
      type: 'fill',
      source: SELECTION_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'area'],
      paint: {
        'fill-color': SELECTION_FILL_COLOR,
        'fill-opacity': SELECTION_FILL_OPACITY,
      },
    })
  }
  if (!layerExists(map, SELECTION_LINE_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_LINE_LAYER_ID,
      type: 'line',
      source: SELECTION_SOURCE_ID,
      filter: ['==', ['get', 'role'], 'area'],
      paint: { 'line-color': SELECTION_FILL_COLOR, 'line-width': 2 },
    })
  }
  if (!layerExists(map, SELECTION_HANDLES_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_HANDLES_LAYER_ID,
      type: 'circle',
      source: SELECTION_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'handle'], ['==', ['get', 'corner'], true]],
      paint: {
        'circle-color': SELECTION_HANDLE_FILL_COLOR,
        'circle-radius': SELECTION_CORNER_RADIUS,
        'circle-stroke-color': SELECTION_HANDLE_STROKE_COLOR,
        'circle-stroke-width': 2,
      },
    })
  }
  if (!layerExists(map, SELECTION_EDGE_HANDLES_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_EDGE_HANDLES_LAYER_ID,
      type: 'symbol',
      source: SELECTION_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'handle'], ['==', ['get', 'corner'], false]],
      layout: {
        // north/south=水平・east/west=垂直。map寄せで回転しても辺に追随する。
        'icon-image': [
          'match',
          ['get', 'handle'],
          'north',
          SELECTION_HANDLE_IMAGE_H_ID,
          'south',
          SELECTION_HANDLE_IMAGE_H_ID,
          SELECTION_HANDLE_IMAGE_V_ID,
        ],
        'icon-size': 1,
        'icon-rotation-alignment': 'map',
        // シンボル衝突でハンドルが消えないようにする
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }
  if (!layerExists(map, SELECTION_HOVER_SYMBOL_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_HOVER_SYMBOL_LAYER_ID,
      type: 'symbol',
      source: SELECTION_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'hover'], ['==', ['get', 'kind'], 'edge']],
      layout: {
        'icon-image': [
          'match',
          ['get', 'handle'],
          'north',
          SELECTION_HANDLE_HOVER_IMAGE_H_ID,
          'south',
          SELECTION_HANDLE_HOVER_IMAGE_H_ID,
          SELECTION_HANDLE_HOVER_IMAGE_V_ID,
        ],
        'icon-size': SELECTION_HOVER_ICON_SIZE,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    })
  }
  if (!layerExists(map, SELECTION_HOVER_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_HOVER_CIRCLE_LAYER_ID,
      type: 'circle',
      source: SELECTION_SOURCE_ID,
      filter: ['all', ['==', ['get', 'role'], 'hover'], ['==', ['get', 'kind'], 'corner']],
      paint: {
        // 角もカプセルと同じルール（反転＋拡大）。通常=白fill＋シアン枠・r6。
        'circle-color': SELECTION_HANDLE_HOVER_FILL_COLOR,
        'circle-radius': SELECTION_HOVER_CORNER_RADIUS,
        'circle-stroke-color': SELECTION_HANDLE_HOVER_STROKE_COLOR,
        'circle-stroke-width': SELECTION_HOVER_CORNER_STROKE_WIDTH,
      },
    })
  }
}

export function removeSelectionOverlay(map: OverlayMapLike): void {
  try {
    for (const id of [
      SELECTION_FILL_LAYER_ID,
      SELECTION_LINE_LAYER_ID,
      SELECTION_HANDLES_LAYER_ID,
      SELECTION_EDGE_HANDLES_LAYER_ID,
      SELECTION_HOVER_SYMBOL_LAYER_ID,
      SELECTION_HOVER_CIRCLE_LAYER_ID,
    ]) {
      if (layerExists(map, id)) {
        map.removeLayer(id)
      }
    }
    if (sourceExists(map, SELECTION_SOURCE_ID)) {
      map.removeSource(SELECTION_SOURCE_ID)
    }
    appliedSelectionJson.delete(map)
  } catch {
    /* 後片付けの失敗は無視 */
  }
}

/**
 * ホバー強調だけを単一ソースへ原子的に更新する。
 * bounds=null またはソース未作成なら何もしない。handle=null は hover を消す。
 * ハンドルも可視性で間引き直す（hover自体は常時含める）。
 * 同一内容なら差分キャッシュでsetDataをスキップする。
 */
export function ensureSelectionHover(
  map: OverlayMapLike,
  bounds: SelectionBounds | null,
  handle: ResizeHandle | null,
): void {
  try {
    if (bounds === null) return
    if (asSettableSource(map.getSource(SELECTION_SOURCE_ID)) === null) return
    applySelectionData(
      map,
      selectionOverlayToFeatureCollection(bounds, handle, selectionVisibility(map, bounds)),
    )
  } catch {
    /* 表示失敗は無視 */
  }
}

/**
 * スタジアム形（半円2つ＋直線部）を描く。角丸半径=太さの半分で端は完全な半円。
 * 垂直カプセルは回転させて同じパスで描く。寸法は定数から求める。
 */
function paintCapsule(
  ctx: CanvasRenderingContext2D,
  horizontal: boolean,
  fillColor: string,
  strokeColor: string,
): void {
  const scale = SELECTION_CAPSULE_PIXEL_RATIO
  if (!horizontal) {
    // キャンバス自体は縦長。回転して水平カプセルと同じ座標系で描く。
    ctx.translate(
      (SELECTION_CAPSULE_WIDTH_PX * scale) / 2,
      (SELECTION_CAPSULE_LENGTH_PX * scale) / 2,
    )
    ctx.rotate(Math.PI / 2)
    ctx.translate(
      -(SELECTION_CAPSULE_LENGTH_PX * scale) / 2,
      -(SELECTION_CAPSULE_WIDTH_PX * scale) / 2,
    )
  }
  const w = SELECTION_CAPSULE_LENGTH_PX * scale
  const h = SELECTION_CAPSULE_WIDTH_PX * scale
  const lineWidth = SELECTION_CAPSULE_STROKE_PX * scale
  const cx = w / 2
  const cy = h / 2
  // ストロークが外形からはみ出さないよう半分内側に寄せたパス
  const r = h / 2 - lineWidth / 2
  const straight = w / 2 - h / 2 // 中心→弧中心の距離
  ctx.beginPath()
  ctx.moveTo(cx - straight, cy - r)
  ctx.lineTo(cx + straight, cy - r)
  ctx.arc(cx + straight, cy, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(cx - straight, cy + r)
  ctx.arc(cx - straight, cy, r, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

/** カプセル画像の定義（ID・向き・配色）。通常2枚＋ホバー強調2枚。 */
interface CapsuleImageSpec {
  id: string
  horizontal: boolean
  fill: string
  stroke: string
}

/** 通常ハンドルの2枚（水平/垂直）。 */
const HANDLE_IMAGE_SPECS: CapsuleImageSpec[] = [
  {
    id: SELECTION_HANDLE_IMAGE_H_ID,
    horizontal: true,
    fill: SELECTION_HANDLE_FILL_COLOR,
    stroke: SELECTION_HANDLE_STROKE_COLOR,
  },
  {
    id: SELECTION_HANDLE_IMAGE_V_ID,
    horizontal: false,
    fill: SELECTION_HANDLE_FILL_COLOR,
    stroke: SELECTION_HANDLE_STROKE_COLOR,
  },
]

/** ホバー強調の2枚（通常の配色反転）。 */
const HOVER_IMAGE_SPECS: CapsuleImageSpec[] = [
  {
    id: SELECTION_HANDLE_HOVER_IMAGE_H_ID,
    horizontal: true,
    fill: SELECTION_HANDLE_HOVER_FILL_COLOR,
    stroke: SELECTION_HANDLE_HOVER_STROKE_COLOR,
  },
  {
    id: SELECTION_HANDLE_HOVER_IMAGE_V_ID,
    horizontal: false,
    fill: SELECTION_HANDLE_HOVER_FILL_COLOR,
    stroke: SELECTION_HANDLE_HOVER_STROKE_COLOR,
  },
]

/** 実行時生成カプセル画像（MapLibreのaddImageに渡すImageData相当）。 */
interface CapsuleImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** カプセル画像を描いて返す。document無し・失敗時はnull。 */
function createCapsuleImage(spec: CapsuleImageSpec): CapsuleImageData | null {
  try {
    if (typeof document === 'undefined') return null
    const scale = SELECTION_CAPSULE_PIXEL_RATIO
    const canvas = document.createElement('canvas')
    canvas.width =
      (spec.horizontal ? SELECTION_CAPSULE_LENGTH_PX : SELECTION_CAPSULE_WIDTH_PX) * scale
    canvas.height =
      (spec.horizontal ? SELECTION_CAPSULE_WIDTH_PX : SELECTION_CAPSULE_LENGTH_PX) * scale
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    paintCapsule(ctx, spec.horizontal, spec.fill, spec.stroke)
    // MapLibreのaddImageはcanvas要素を直接受け付けないため
    // ImageData相当（width/height/data）で渡す。
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, height: canvas.height, data: pixels.data }
  } catch {
    return null
  }
}

/** カプセル画像群を登録する（2回目以降はhasImageでスキップ）。 */
function ensureImages(map: OverlayMapLike, specs: CapsuleImageSpec[]): void {
  try {
    const hasImage = map.hasImage
    const addImage = map.addImage
    if (typeof hasImage !== 'function' || typeof addImage !== 'function') return
    for (const spec of specs) {
      if (hasImage.call(map, spec.id)) continue
      const image = createCapsuleImage(spec)
      if (image === null) return
      addImage.call(map, spec.id, image, { pixelRatio: SELECTION_CAPSULE_PIXEL_RATIO })
    }
  } catch {
    /* 画像登録の失敗は無視（円・矩形の表示は残る） */
  }
}

/** 通常ハンドルのカプセル画像2枚を登録する。 */
function ensureHandleImages(map: OverlayMapLike): void {
  ensureImages(map, HANDLE_IMAGE_SPECS)
}

/** ホバー強調のカプセル画像2枚を登録する。 */
function ensureHoverImages(map: OverlayMapLike): void {
  ensureImages(map, HOVER_IMAGE_SPECS)
}

/**
 * ピック点オーバーレイを反映する。空配列で除去。
 * 失敗は吞み込む（exportをブロックしない）。
 */
export function ensurePickOverlay(map: OverlayMapLike, points: PickPoint[]): void {
  try {
    if (points.length === 0) {
      removePickOverlay(map)
      return
    }
    const data = pickPointsToFeatureCollection(points)
    const existing = asSettableSource(map.getSource(PICK_SOURCE_ID))
    if (existing !== null) {
      existing.setData(data)
      return
    }
    map.addSource(PICK_SOURCE_ID, { type: 'geojson', data })
    if (!layerExists(map, PICK_LAYER_ID)) {
      map.addLayer({
        id: PICK_LAYER_ID,
        type: 'circle',
        source: PICK_SOURCE_ID,
        paint: {
          'circle-color': PICK_CIRCLE_COLOR,
          'circle-radius': 6,
          'circle-stroke-color': PICK_CIRCLE_STROKE_COLOR,
          'circle-stroke-width': 2,
        },
      })
    }
  } catch {
    /* 表示失敗は無視 */
  }
}

export function removePickOverlay(map: OverlayMapLike): void {
  try {
    if (layerExists(map, PICK_LAYER_ID)) {
      map.removeLayer(PICK_LAYER_ID)
    }
    if (sourceExists(map, PICK_SOURCE_ID)) {
      map.removeSource(PICK_SOURCE_ID)
    }
  } catch {
    /* 後片付けの失敗は無視 */
  }
}
