import { useState, useRef, useCallback, useEffect } from 'react'
import type { SelectionBounds } from '../hooks/useRectangleSelection'

interface ModelSizeOverlayProps {
  selectionBounds: SelectionBounds | null
  scale: number
  onScaleChange: (newScale: number) => void
}

function computeNaturalDimensions(bounds: SelectionBounds): { widthM: number; depthM: number } {
  const centerLat = (bounds.north + bounds.south) / 2
  const widthDeg = bounds.east - bounds.west
  const heightDeg = bounds.north - bounds.south
  const widthM = Math.abs(widthDeg) * (Math.PI / 180) * 6371000 * Math.cos((centerLat * Math.PI) / 180)
  const depthM = Math.abs(heightDeg) * (Math.PI / 180) * 6371000
  return { widthM, depthM }
}

function formatMm(m: number): string {
  if (m >= 100) return `${m.toFixed(0)} mm`
  if (m >= 10) return `${m.toFixed(1)} mm`
  return `${m.toFixed(2)} mm`
}

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
  const outputWidth = dims ? dims.widthM * scale : 0
  const outputDepth = dims ? dims.depthM * scale : 0

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
      const newScale = val / natural
      if (newScale > 0 && isFinite(newScale)) {
        onScaleChange(newScale)
      }
    }
    setEditingField(null)
  }, [editingField, inputValue, dims, onScaleChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitEdit()
      } else if (e.key === 'Escape') {
        setEditingField(null)
      }
    },
    [commitEdit]
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
    [scale, onScaleChange]
  )

  if (!selectionBounds || !dims) return null

  const maxDim = Math.max(dims.widthM, dims.depthM)
  const autoScale = maxDim > 0 ? 150 / maxDim : 1
  const showReset = Math.abs(scale - autoScale) > 0.0001

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      {/* Drag handle */}
      <div style={dragHandleStyle} onPointerDown={startDrag} title="ドラッグでスケール調整">
        <svg width="14" height="6" viewBox="0 0 14 6" fill="none">
          <rect x="0" y="2" width="14" height="2" rx="1" fill="rgba(255,255,255,0.3)" />
        </svg>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>W</span>
        {editingField === 'width' ? (
          <input
            ref={inputRef}
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            min="0"
            step="any"
          />
        ) : (
          <span
            style={valueStyle}
            onClick={() => {
              setEditingField('width')
              setInputValue(outputWidth.toFixed(1))
            }}
            title="クリックで編集"
          >
            {formatMm(outputWidth)}
          </span>
        )}
      </div>

      <div style={dividerStyle} />

      <div style={rowStyle}>
        <span style={labelStyle}>D</span>
        {editingField === 'depth' ? (
          <input
            ref={inputRef}
            type="number"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            style={inputStyle}
            min="0"
            step="any"
          />
        ) : (
          <span
            style={valueStyle}
            onClick={() => {
              setEditingField('depth')
              setInputValue(outputDepth.toFixed(1))
            }}
            title="クリックで編集"
          >
            {formatMm(outputDepth)}
          </span>
        )}
      </div>

      {showReset && (
        <>
          <div style={dividerStyle} />
          <button
            style={resetBtnStyle}
            onClick={() => onScaleChange(autoScale)}
            title="最大辺を150mmに自動調整"
          >
            自動
          </button>
        </>
      )}
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 16,
  left: 16,
  background: 'rgba(13, 17, 23, 0.85)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 8,
  padding: '6px 10px',
  zIndex: 50,
  userSelect: 'none',
  minWidth: 120,
  pointerEvents: 'auto',
}

const dragHandleStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '0 0 4px',
  cursor: 'grab',
  touchAction: 'none',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 0',
}

const labelStyle: React.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.4)',
  fontSize: 11,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  fontWeight: 500,
  width: 14,
}

const valueStyle: React.CSSProperties = {
  color: '#e6edf3',
  fontSize: 13,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '1px 4px',
  borderRadius: 3,
  transition: 'background 0.15s',
}

const inputStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid rgba(0, 188, 212, 0.5)',
  borderRadius: 3,
  color: '#e6edf3',
  fontSize: 13,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  fontWeight: 600,
  padding: '1px 4px',
  width: 70,
  outline: 'none',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: 'rgba(255, 255, 255, 0.08)',
  margin: '2px 0',
}

const resetBtnStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: 4,
  color: 'rgba(255, 255, 255, 0.5)',
  fontSize: 10,
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  padding: '2px 6px',
  cursor: 'pointer',
  width: '100%',
  marginTop: 2,
}
