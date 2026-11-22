/** 画面上の矩形（px）。left/top は基準コンテナの左上を原点とする。 */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface PlaceHoverCardArgs {
  /** カーソル位置（基準コンテナ座標）。 */
  cursor: Point
  /** カードの実測サイズ。 */
  size: Size
  /** 基準コンテナのサイズ（カードをはみ出させない範囲）。 */
  bounds: Size
  /** 重ねてはいけないUI領域（data-overlay-zone の実測矩形）。 */
  obstacles?: Box[]
  /** カーソルとカードの間隔。 */
  gap?: number
  /** コンテナ端との最小余白。 */
  margin?: number
  /** 障害物を少し広めに避けるための余白。 */
  obstaclePadding?: number
}

const DEFAULT_GAP = 12
const DEFAULT_MARGIN = 8
const DEFAULT_OBSTACLE_PADDING = 4

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function inflate(box: Box, padding: number): Box {
  return {
    left: box.left - padding,
    top: box.top - padding,
    width: box.width + padding * 2,
    height: box.height + padding * 2,
  }
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

function coversPoint(box: Box, point: Point): boolean {
  return (
    point.x > box.left &&
    point.x < box.left + box.width &&
    point.y > box.top &&
    point.y < box.top + box.height
  )
}

/** 理想の4方向の位置からどれだけ動いたか。近さの比較に使う。 */
function distanceTo(rect: Box, anchors: Point[]): number {
  let nearest = Number.POSITIVE_INFINITY
  for (const anchor of anchors) {
    nearest = Math.min(nearest, Math.hypot(rect.left - anchor.x, rect.top - anchor.y))
  }
  return nearest
}

/** スコアを辞書式で比較する（前の要素ほど優先）。 */
function isBetter(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

/**
 * カーソル近傍のホバーカードの位置を決める。
 *
 * まずカーソルの右下 → 左下 → 右上 → 左上を試し、加えて障害物の辺に沿った位置も候補にする。
 * 重なりが最も少なく、カーソルを覆わず、近い位置を選ぶ。どの候補も収まらない場合は
 * 端に寄せる（マージンは守る）。
 */
export function placeHoverCard({
  cursor,
  size,
  bounds,
  obstacles = [],
  gap = DEFAULT_GAP,
  margin = DEFAULT_MARGIN,
  obstaclePadding = DEFAULT_OBSTACLE_PADDING,
}: PlaceHoverCardArgs): Point {
  const maxX = bounds.width - size.width - margin
  const maxY = bounds.height - size.height - margin
  const preferred: Point[] = [
    { x: cursor.x + gap, y: cursor.y + gap },
    { x: cursor.x - gap - size.width, y: cursor.y + gap },
    { x: cursor.x + gap, y: cursor.y - gap - size.height },
    { x: cursor.x - gap - size.width, y: cursor.y - gap - size.height },
  ]

  const paddedObstacles = obstacles.map((box) => inflate(box, obstaclePadding))

  // 障害物の辺と画面端に合わせた候補を足す。カーソルの真横が塞がっていても、
  // パネルの外側へカードを滑らせて重なりを避けられる。
  const xs = new Set<number>([cursor.x + gap, cursor.x - gap - size.width, margin, maxX])
  const ys = new Set<number>([cursor.y + gap, cursor.y - gap - size.height, margin, maxY])
  for (const obstacle of paddedObstacles) {
    xs.add(obstacle.left - size.width)
    xs.add(obstacle.left + obstacle.width)
    ys.add(obstacle.top - size.height)
    ys.add(obstacle.top + obstacle.height)
  }
  const shifted: Point[] = []
  for (const x of xs) {
    for (const y of ys) shifted.push({ x, y })
  }
  const candidates = [...preferred, ...shifted]

  let best: Point = {
    x: clamp(preferred[0].x, margin, maxX),
    y: clamp(preferred[0].y, margin, maxY),
  }
  let bestRank: number[] | null = null

  candidates.forEach((candidate, index) => {
    const x = clamp(candidate.x, margin, maxX)
    const y = clamp(candidate.y, margin, maxY)
    const rect: Box = { left: x, top: y, width: size.width, height: size.height }
    let overlap = 0
    for (const obstacle of paddedObstacles) overlap += overlapArea(rect, obstacle)
    // 優先順位: 重なりを避ける → カーソルを覆わない → 理想位置に近い → 画面端へ押しやらない。
    const rank = [
      overlap,
      coversPoint(rect, cursor) ? 1 : 0,
      distanceTo(rect, preferred),
      Math.abs(x - candidate.x) + Math.abs(y - candidate.y),
      index,
    ]
    if (!bestRank || isBetter(rank, bestRank)) {
      bestRank = rank
      best = { x, y }
    }
  })

  return best
}
