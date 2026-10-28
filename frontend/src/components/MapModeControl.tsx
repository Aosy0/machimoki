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

function hintText(mode: MapInteractionMode, hasCoarsePointer: boolean): string {
  if (mode === 'move') {
    return hasCoarsePointer
      ? '1本指で移動 / 長押し→ドラッグで範囲選択'
      : '左ドラッグで移動 / Shift+左ドラッグで範囲選択'
  }
  return hasCoarsePointer
    ? '1本指で範囲選択 / 2本指で移動・拡大'
    : '左ドラッグで範囲選択 / Shift+左ドラッグで移動'
}

/**
 * 地図下のモード切替と補助操作。モードが変えるのは主入力
 * （PC=左クリック / タッチ=1本指）だけで、右/中ドラッグ・2本指・
 * ホイール・ハンドルはモード非依存。
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
  const buttonHeight = isCompact ? 40 : 32
  const modeButtonStyle = (active: boolean): React.CSSProperties => ({
    minHeight: buttonHeight,
    minWidth: isCompact ? 64 : 56,
    padding: isCompact ? '6px 12px' : '4px 10px',
    fontSize: isCompact ? 13 : 12,
    fontWeight: active ? 700 : 500,
    borderRadius: 6,
    border: active ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })
  const actionStyle = (active = false): React.CSSProperties => ({
    minHeight: buttonHeight,
    minWidth: isCompact ? 56 : 48,
    padding: isCompact ? '6px 10px' : '4px 8px',
    fontSize: isCompact ? 12 : 11,
    fontWeight: active ? 700 : 500,
    borderRadius: 6,
    border: active ? '1px solid var(--accent)' : '1px solid var(--border-strong)',
    background: active ? 'rgba(0, 188, 212, 0.18)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div
      data-testid="map-mode-control"
      style={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: isCompact ? 'calc(10px + env(safe-area-inset-bottom))' : '16px',
        zIndex: 210,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        maxWidth: 'calc(100% - 16px)',
        pointerEvents: 'none',
      }}
    >
      <div
        data-testid="map-mode-hint"
        style={{
          padding: '4px 10px',
          borderRadius: 999,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-dim)',
          fontSize: isCompact ? 11 : 11,
          lineHeight: 1.5,
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}
      >
        {hintText(mode, hasCoarsePointer)}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '6px',
          borderRadius: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'auto',
          maxWidth: '100%',
        }}
      >
        <button
          type="button"
          aria-pressed={mode === 'move'}
          data-testid="map-mode-move"
          onClick={() => onChange('move')}
          style={modeButtonStyle(mode === 'move')}
        >
          移動
        </button>
        <button
          type="button"
          aria-pressed={mode === 'select'}
          data-testid="map-mode-select"
          onClick={() => onChange('select')}
          style={modeButtonStyle(mode === 'select')}
        >
          範囲選択
        </button>
        <span
          aria-hidden
          style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }}
        />
        <button type="button" onClick={onSelectCurrentView} style={actionStyle()}>
          現在表示
        </button>
        {isCompact && (
          <>
            <button
              type="button"
              aria-pressed={coordsOpen}
              onClick={onToggleCoords}
              style={actionStyle(coordsOpen)}
            >
              座標
            </button>
            <button
              type="button"
              aria-pressed={legendOpen}
              onClick={onToggleLegend}
              style={actionStyle(legendOpen)}
            >
              凡例
            </button>
          </>
        )}
      </div>
    </div>
  )
}
