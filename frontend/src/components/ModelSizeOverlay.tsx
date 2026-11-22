import { useState, useRef, useCallback, useEffect } from 'react'
import type { SelectionBounds } from '../hooks/useRectangleSelection'
import { computeNaturalDimensions, formatScale } from '../lib/selectionBounds'

interface ModelSizeOverlayProps {
  selectionBounds: SelectionBounds | null
  scale: number
  onScaleChange: (newScale: number) => void
}

const MONO_FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", monospace'

const formatMillimeters = (mm: number): string => `${mm.toFixed(1)} mm`

export default function ModelSizeOverlay({
  selectionBounds,
  scale,
  onScaleChange,
}: ModelSizeOverlayProps) {
  const [editingField, setEditingField] = useState<'width' | 'depth' | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startScale: number } | null>(null)

  const dims = selectionBounds ? computeNaturalDimensions(selectionBounds) : null
  // scale is dimensionless (m/m): output size in mm = natural size in m * scale * 1000
  const outputWidth = dims ? dims.widthM * scale * 1000 : 0
  const outputDepth = dims ? dims.depthM * scale * 1000 : 0

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingField])

  const commitEdit = useCallback(() => {
    if (!editingField || !dims) return
    const val = parseFloat(inputValue)
    if (!isFinite(val) && inputValue.trim() !== '') {
      setEditingField(null)
      return
    }
    if (val > 0) {
      const natural = editingField === 'width' ? dims.widthM : dims.depthM
      const newScale = val / (natural * 1000)
      if (newScale > 0 && isFinite(newScale)) {
        onScaleChange(newScale)
      }
    }
    setEditingField(null)
  }, [editingField, inputValue, dims, onScaleChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        // IME の変換確定 Enter で確定させない
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        commitEdit()
      } else if (e.key === 'Escape') {
        setEditingField(null)
      }
    },
    [commitEdit],
  )

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { startX: e.clientX, startScale: scale }
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.startX
        const scaleFactor = 1 + dx * 0.002
        const newScale = Math.max(0.01, dragRef.current.startScale * scaleFactor)
        onScaleChange(Math.round(newScale * 100) / 100)
      }

      const onUp = () => {
        dragRef.current = null
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }

      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [scale, onScaleChange],
  )

  if (!selectionBounds || !dims) return null

  const maxDim = Math.max(dims.widthM, dims.depthM)
  // Target 150 mm for the longest natural dimension; scale is dimensionless (m/m).
  const autoScale = maxDim > 0 ? 150 / (maxDim * 1000) : 1
  const showReset = Math.abs(scale - autoScale) > 0.0001

  return (
    <div
      data-overlay-zone="model-size"
      style={panelStyle}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        style={dragHandleStyle}
        aria-label="ドラッグでスケール調整"
        onPointerDown={startDrag}
      >
        <svg width="24" height="4" viewBox="0 0 24 4" fill="none" aria-hidden="true">
          <rect width="24" height="4" rx="2" fill="var(--border-strong)" />
        </svg>
      </button>

      <div style={rowStyle}>
        <span style={labelStyle}>W</span>
        {editingField === 'width' ? (
          <input
            ref={inputRef}
            type="number"
            aria-label="W を mm で入力"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            min="0"
            step="any"
          />
        ) : (
          <button
            type="button"
            style={valueStyle}
            aria-label={`W ${formatMillimeters(outputWidth)} を編集`}
            onClick={() => {
              setEditingField('width')
              setInputValue(outputWidth.toFixed(1))
            }}
          >
            {formatMillimeters(outputWidth)}
          </button>
        )}
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>D</span>
        {editingField === 'depth' ? (
          <input
            ref={inputRef}
            type="number"
            aria-label="D を mm で入力"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            min="0"
            step="any"
          />
        ) : (
          <button
            type="button"
            style={valueStyle}
            aria-label={`D ${formatMillimeters(outputDepth)} を編集`}
            onClick={() => {
              setEditingField('depth')
              setInputValue(outputDepth.toFixed(1))
            }}
          >
            {formatMillimeters(outputDepth)}
          </button>
        )}
      </div>

      <div style={dividerStyle} />

      <div style={rowStyle}>
        <span style={labelStyle}>縮尺</span>
        <span style={scaleStyle}>{formatScale(scale)}</span>
      </div>

      {showReset && (
        <button
          type="button"
          style={resetBtnStyle}
          aria-label="選択範囲の最大辺を150mmに自動調整"
          onClick={() => onScaleChange(autoScale)}
        >
          自動
        </button>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  background: 'var(--surface)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-panel)',
  padding: '4px 12px 8px',
  zIndex: 50,
  userSelect: 'none',
  minWidth: 140,
  pointerEvents: 'auto',
}

const dragHandleStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: 24,
  padding: 0,
  background: 'transparent',
  border: 'none',
  cursor: 'grab',
  touchAction: 'none',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const labelStyle: React.CSSProperties = {
  color: 'var(--text-dim)',
  fontSize: 12,
  fontFamily: MONO_FONT,
  fontWeight: 400,
  width: 28,
  flexShrink: 0,
}

const valueStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 32,
  padding: '0 4px',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-control)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: MONO_FONT,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
  textAlign: 'right',
  cursor: 'pointer',
}

const scaleStyle: React.CSSProperties = {
  flex: 1,
  padding: '0 4px',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: MONO_FONT,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
  textAlign: 'right',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 32,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-control)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: MONO_FONT,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
  textAlign: 'right',
  padding: '0 8px',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--border)',
  margin: '4px 0',
}

const resetBtnStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  marginTop: 4,
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-control)',
  color: 'var(--text-dim)',
  fontSize: 12,
  fontFamily: MONO_FONT,
  fontWeight: 400,
  cursor: 'pointer',
}
