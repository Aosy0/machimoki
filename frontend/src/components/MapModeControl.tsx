import React from 'react'
import type { MapInteractionMode } from '../hooks/useMapLibreRectangleSelection'

export interface MapModeControlProps {
  mode: MapInteractionMode
  onChange: (mode: MapInteractionMode) => void
  isCompact: boolean
  hasCoarsePointer: boolean
  onSelectCurrentView: () => void
  coordsOpen: boolean
  legendOpen: boolean
  onToggleCoords: () => void
  onToggleLegend: () => void
}

/**
 * 地図下のモード切替と補助操作。モードが変えるのは主入力
 * （PC=左クリック / タッチ=1本指）だけで、右/中ドラッグ・2本指・
 * ホイール・ハンドルはモード非依存。
 *
 * 選択中のモードは面の色、開いている補助パネルは面の有無で示す。
 * ボタンは高さ32px（タッチは44px）で、hover は index.css が持つ。
 */
export default function MapModeControl({
  mode,
  onChange,
  isCompact,
  hasCoarsePointer,
  onSelectCurrentView,
  coordsOpen,
  legendOpen,
  onToggleCoords,
  onToggleLegend,
}: MapModeControlProps) {
  const buttonHeight = hasCoarsePointer ? 44 : 32
  const buttonStyle = (active: boolean, activeSurface: string): React.CSSProperties => ({
    height: buttonHeight,
    padding: '0 12px',
    borderRadius: 'var(--radius-control)',
    border: 'none',
    background: active ? activeSurface : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color 120ms ease, color 120ms ease',
  })

  return (
    <div
      data-testid="map-mode-control"
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: isCompact ? 'calc(8px + env(safe-area-inset-bottom))' : '16px',
        zIndex: 210,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 4,
          maxWidth: '100%',
          borderRadius: 'var(--radius-panel)',
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={mode === 'move'}
            data-testid="map-mode-move"
            onClick={() => onChange('move')}
            style={buttonStyle(mode === 'move', 'var(--border-strong)')}
          >
            移動
          </button>
          <button
            type="button"
            aria-pressed={mode === 'select'}
            data-testid="map-mode-select"
            onClick={() => onChange('select')}
            style={buttonStyle(mode === 'select', 'var(--border-strong)')}
          >
            範囲選択
          </button>
        </div>
        <button
          type="button"
          onClick={onSelectCurrentView}
          style={buttonStyle(false, 'transparent')}
        >
          現在表示
        </button>
        {isCompact && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              aria-pressed={coordsOpen}
              onClick={onToggleCoords}
              style={buttonStyle(coordsOpen, 'var(--border)')}
            >
              座標
            </button>
            <button
              type="button"
              aria-pressed={legendOpen}
              onClick={onToggleLegend}
              style={buttonStyle(legendOpen, 'var(--border)')}
            >
              凡例
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
