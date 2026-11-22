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

/**
 * カーソル近傍のホバーカードの位置を決める。
 *
 * 右下 → 左下 → 右上 → 左上の順に試し、UIパネルとの重なりが最も少ない位置を選ぶ。
 * どの候補もコンテナ内に収まらない場合は端に寄せる（マージンは守る）。
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
  const candidates: Point[] = [
    { x: cursor.x + gap, y: cursor.y + gap },
    { x: cursor.x - gap - size.width, y: cursor.y + gap },
    { x: cursor.x + gap, y: cursor.y - gap - size.height },
    { x: cursor.x - gap - size.width, y: cursor.y - gap - size.height },
  ]

  const paddedObstacles = obstacles.map((box) => inflate(box, obstaclePadding))
  let best: Point = candidates[0]
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const x = clamp(candidate.x, margin, maxX)
    const y = clamp(candidate.y, margin, maxY)
    const rect: Box = { left: x, top: y, width: size.width, height: size.height }
    let overlap = 0
    for (const obstacle of paddedObstacles) overlap += overlapArea(rect, obstacle)
    // 重なりが同じなら、カーソル位置から動かさずに済む候補を優先する。
    const score = overlap * 1000 + Math.abs(x - candidate.x) + Math.abs(y - candidate.y)
    if (score < bestScore) {
      bestScore = score
      best = { x, y }
    }
  }

  return best
}
