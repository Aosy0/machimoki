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
  /** 初回ヒントを拡大表示中か。 */
  attention: boolean
  /** ヘルプ詳細が開いているか。 */
  helpOpen: boolean
  onToggleHelp: () => void
  /** 初回ヒントを既読にする（操作開始時に呼ぶ）。 */
  onDismissHint: () => void
}

function hintText(hasCoarsePointer: boolean): string {
  return hasCoarsePointer
    ? '下の「移動」「範囲選択」でモード切替'
    : '下の「移動」「範囲選択」ボタンでモード切替'
}

/**
 * 地図下のモード切替と補助操作。モードが変えるのは主入力
 * （PC=左クリック / タッチ=1本指）だけで、右/中ドラッグ・2本指・
 * ホイール・ハンドルはモード非依存。
 *
 * 上部のヒントはヘルプ詳細を開くボタンでもある。初回だけ同じ文言のまま
 * 少し拡大し、操作開始または2.5秒で通常サイズに戻る。
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
  attention,
  helpOpen,
  onToggleHelp,
  onDismissHint,
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

  const handleModeChange = (next: MapInteractionMode): void => {
    onDismissHint()
    onChange(next)
  }
  const handleSelectCurrentView = (): void => {
    onDismissHint()
    onSelectCurrentView()
  }
  const handleToggleCoords = (): void => {
    onDismissHint()
    onToggleCoords()
  }
  const handleToggleLegend = (): void => {
    onDismissHint()
    onToggleLegend()
  }
  const handleToggleHelp = (): void => {
    onDismissHint()
    onToggleHelp()
  }

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
      <button
        type="button"
        className="map-mode-hint"
        data-testid="map-mode-help"
        data-state={attention ? 'attention' : 'compact'}
        aria-expanded={helpOpen}
        aria-controls="help-detail"
        aria-label="操作方法を開く"
        title={helpOpen ? '操作方法を閉じる' : '操作方法を開く'}
        onClick={handleToggleHelp}
        style={{
          display: helpOpen ? 'none' : 'inline-flex',
          alignItems: 'center',
          gap: attention ? (isCompact ? 8 : 10) : isCompact ? 6 : 8,
          minHeight: isCompact ? 44 : 34,
          maxWidth: '100%',
          padding: attention
            ? isCompact
              ? '10px 14px'
              : '10px 18px'
            : isCompact
              ? '7px 12px'
              : '5px 12px',
          borderRadius: 999,
          fontFamily: 'inherit',
          pointerEvents: 'auto',
        }}
      >
        <span className="map-mode-hint__badge" aria-hidden="true">
          ?
        </span>
        <span
          className="map-mode-hint__text"
          data-testid="map-mode-hint"
          style={{
            fontSize: attention ? (isCompact ? 16 : 18) : isCompact ? 11 : 12,
            lineHeight: 1.5,
            textAlign: 'center',
            minWidth: 0,
          }}
        >
          {hintText(hasCoarsePointer)}
        </span>
        <svg
          className="map-mode-hint__chevron"
          width="16"
          height="16"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path
            d="M2 8l4-4 4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
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
          onClick={() => handleModeChange('move')}
          style={modeButtonStyle(mode === 'move')}
        >
          移動
        </button>
        <button
          type="button"
          aria-pressed={mode === 'select'}
          data-testid="map-mode-select"
          onClick={() => handleModeChange('select')}
          style={modeButtonStyle(mode === 'select')}
        >
          範囲選択
        </button>
        <span
          aria-hidden
          style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }}
        />
        <button type="button" onClick={handleSelectCurrentView} style={actionStyle()}>
          現在表示
        </button>
        {isCompact && (
          <>
            <button
              type="button"
              aria-pressed={coordsOpen}
              onClick={handleToggleCoords}
              style={actionStyle(coordsOpen)}
            >
              座標
            </button>
            <button
              type="button"
              aria-pressed={legendOpen}
              onClick={handleToggleLegend}
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
