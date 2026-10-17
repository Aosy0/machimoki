import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { Marker } from 'maplibre-gl'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import {
  computeModelDimensions,
  computeNaturalDimensions,
  formatMeters,
  formatMm,
  formatScale,
  type SelectionBounds,
} from '../lib/selectionBounds'

interface MapSelectionInfoOverlayProps {
  map: MapLibreMap | null
  bounds: SelectionBounds | null
  scale: number
  /** 作成ドラッグ中・リサイズ中のライブ更新口。未指定時は props 駆動のみで動作する。 */
  previewRef?: MutableRefObject<((b: SelectionBounds | null) => void) | null>
}

interface OverlayNodes {
  widthValue: HTMLSpanElement
  depthValue: HTMLSpanElement
  scaleValue: HTMLSpanElement
}

const MONO_FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace'

/** 表示専用パネルを組み立てる（地図操作を塞がないよう pointer-events は none）。 */
function buildPanel(): { element: HTMLDivElement; nodes: OverlayNodes } {
  const element = document.createElement('div')
  element.dataset.testid = 'map-selection-info'
  element.setAttribute('aria-hidden', 'true')
  element.style.pointerEvents = 'none'
  element.style.userSelect = 'none'
  element.style.whiteSpace = 'nowrap'
  element.style.background = 'rgba(13, 17, 23, 0.88)'
  element.style.border = '1px solid rgba(255, 255, 255, 0.18)'
  element.style.borderRadius = '8px'
  element.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)'
  element.style.padding = '8px 10px'
  element.style.display = 'flex'
  element.style.flexDirection = 'column'
  element.style.gap = '3px'

  const makeRow = (label: string): { row: HTMLDivElement; value: HTMLSpanElement } => {
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.alignItems = 'baseline'
    row.style.gap = '8px'
    const labelEl = document.createElement('span')
    labelEl.textContent = label
    labelEl.style.color = 'rgba(255, 255, 255, 0.55)'
    labelEl.style.fontSize = '11px'
    labelEl.style.minWidth = '28px'
    const value = document.createElement('span')
    value.style.color = '#e6edf3'
    value.style.fontSize = '12px'
    value.style.fontWeight = '600'
    value.style.fontFamily = MONO_FONT
    value.style.fontVariantNumeric = 'tabular-nums'
    row.append(labelEl, value)
    return { row, value }
  }

  const width = makeRow('横')
  const depth = makeRow('縦')
  const divider = document.createElement('div')
  divider.style.height = '1px'
  divider.style.background = 'rgba(255, 255, 255, 0.12)'
  divider.style.margin = '2px 0'
  const scaleRow = makeRow('縮尺')
  element.append(width.row, depth.row, divider, scaleRow.row)
  return {
    element,
    nodes: { widthValue: width.value, depthValue: depth.value, scaleValue: scaleRow.value },
  }
}

/**
 * 選択矩形の寸法（実距離・モデル長さ・縮尺）を矩形の近くに出す表示専用オーバーレイ。
 * 基本位置は矩形の北辺の外側（パネル下端が北辺より 12px 上、西端は西辺に合わせる）。
 * 上にスペースが無いときは地図コンテナ内にクランプして「矩形が見えている限り必ず読める」
 * ように追従する。Marker に React 管理外の DOM を渡すため pan/zoom/resize に自動追従する。
 */
export default function MapSelectionInfoOverlay({
  map,
  bounds,
  scale,
  previewRef,
}: MapSelectionInfoOverlayProps) {
  const markerRef = useRef<MapLibreMarker | null>(null)
  const attachedMapRef = useRef<MapLibreMap | null>(null)
  const nodesRef = useRef<OverlayNodes | null>(null)
  const elementRef = useRef<HTMLDivElement | null>(null)
  // move/resize 時に再配置するための「最後に適用した bounds」。
  const lastAppliedBoundsRef = useRef<SelectionBounds | null>(null)

  /**
   * 基本位置は矩形の北辺の外側 12px（パネル下端基準）。上にスペースが無ければ
   * 地図コンテナ内へクランプし、矩形が見えている限り必ず読める位置に寄せる
   * （pan/zoom/resize のたびに再計算）。
   */
  const updatePosition = useCallback(
    (target: SelectionBounds | null) => {
      const marker = markerRef.current
      const element = elementRef.current
      if (!map || !target || !marker || !element) return
      try {
        const nw = map.project([target.west, target.north])
        const container = map.getContainer()
        const pad = 12
        const gap = 12
        const maxX = Math.max(pad, container.clientWidth - element.offsetWidth - pad)
        const maxY = Math.max(pad, container.clientHeight - element.offsetHeight - pad)
        const x = Math.min(Math.max(nw.x, pad), maxX)
        const y = Math.min(Math.max(nw.y - gap - element.offsetHeight, pad), maxY)
        marker.setLngLat(map.unproject([x, y]))
      } catch {
        /* 位置更新の失敗は無視（次回更新で再試行） */
      }
    },
    [map],
  )

  /**
   * bounds を画面へ反映する単一経路。scaleOverride=null なら自動スケール
   * （150/(maxDim*1000)）で計算する。確定時に App が同じ自動スケールを設定する
   * ため、指を離した瞬間に数値が一致する。
   */
  const applyBounds = useCallback(
    (target: SelectionBounds | null, scaleOverride: number | null) => {
      if (!map || !target) {
        markerRef.current?.remove()
        markerRef.current = null
        attachedMapRef.current = null
        nodesRef.current = null
        elementRef.current = null
        lastAppliedBoundsRef.current = null
        return
      }
      // map が差し替わったら作り直し、それ以外は使い回してテキストだけ更新する。
      if (!markerRef.current || attachedMapRef.current !== map) {
        markerRef.current?.remove()
        const { element, nodes } = buildPanel()
        nodesRef.current = nodes
        elementRef.current = element
        try {
          markerRef.current = new Marker({ element, anchor: 'top-left' })
            .setLngLat([target.west, target.north])
            .addTo(map)
          // 地図タブ内の他UI（検索ボックス z=2、座標パネル z=100 等）より前面に出す。
          // 表示専用（pointer-events: none）なので背後のUI操作は阻害しない。
          markerRef.current.getElement().style.zIndex = '150'
          attachedMapRef.current = map
        } catch {
          markerRef.current = null
          attachedMapRef.current = null
          nodesRef.current = null
          elementRef.current = null
          lastAppliedBoundsRef.current = null
          return
        }
      }
      const nodes = nodesRef.current
      if (!nodes) return
      const { widthM, depthM } = computeNaturalDimensions(target)
      const maxDim = Math.max(widthM, depthM)
      const effectiveScale = scaleOverride ?? (maxDim > 0 ? 150 / (maxDim * 1000) : 1)
      const dims = computeModelDimensions(target, effectiveScale)
      nodes.widthValue.textContent = `${formatMeters(dims.widthM)} → ${formatMm(dims.widthMm)}`
      nodes.depthValue.textContent = `${formatMeters(dims.depthM)} → ${formatMm(dims.depthMm)}`
      nodes.scaleValue.textContent = formatScale(effectiveScale)
      lastAppliedBoundsRef.current = target
      updatePosition(target)
    },
    [map, updatePosition],
  )

  // 確定値（props 駆動・従来どおり）。
  useEffect(() => {
    applyBounds(bounds, scale)
  }, [map, bounds, scale, applyBounds])

  // pan/zoom/resize でクランプ位置を再計算する（プレビュー中も追従させる）。
  useEffect(() => {
    if (!map) return
    const onMove = (): void => {
      const last = lastAppliedBoundsRef.current
      if (last) updatePosition(last)
    }
    map.on('move', onMove)
    map.on('resize', onMove)
    return () => {
      map.off('move', onMove)
      map.off('resize', onMove)
    }
  }, [map, updatePosition])

  // 最新の適用関数を ref 経由で保持し、stale closure を避ける。
  const applyBoundsRef = useRef(applyBounds)
  useEffect(() => {
    applyBoundsRef.current = applyBounds
  }, [applyBounds])

  // 作成ドラッグ中・リサイズ中のライブ更新口。クリーンアップで解除する。
  useEffect(() => {
    if (!previewRef) return
    previewRef.current = (b: SelectionBounds | null) => applyBoundsRef.current(b, null)
    return () => {
      previewRef.current = null
    }
  }, [previewRef])

  useEffect(
    () => () => {
      markerRef.current?.remove()
      markerRef.current = null
      attachedMapRef.current = null
      nodesRef.current = null
      elementRef.current = null
      lastAppliedBoundsRef.current = null
    },
    [],
  )

  return null
}
