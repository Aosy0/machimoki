import React, { useId } from 'react'
import Icon from './ui/Icon'

export interface ManualCoords {
  west: string
  south: string
  east: string
  north: string
}

interface CoordinateSelectionPanelProps {
  manualCoords: ManualCoords
  onCoordChange: (key: keyof ManualCoords, value: string) => void
  onApply: () => void
  applyPreset: (preset: { west: number; south: number; east: number; north: number }) => void
  isDevMode: boolean
  hasCoarsePointer: boolean
  onClose?: () => void
}

/** 座標入力・プリセット・適用。PCでは常設、スマホではシート内に表示する。 */
export default function CoordinateSelectionPanel({
  manualCoords,
  onCoordChange,
  onApply,
  applyPreset,
  isDevMode,
  hasCoarsePointer,
  onClose,
}: CoordinateSelectionPanelProps) {
  // ラベルと入力部品を関連付ける id の接頭辞。インスタンスごとに一意になる。
  const baseId = useId()

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 500 }}>座標で選択</div>
        {onClose && (
          <button
            type="button"
            className="help-detail-close"
            onClick={onClose}
            aria-label="座標パネルを閉じる"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <div
        data-testid="map2d-drag-hint"
        style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--text-dim)' }}
      >
        {hasCoarsePointer ? (
          '長押し＋ドラッグで範囲選択'
        ) : (
          <>
            <kbd style={kbdStyle}>Shift</kbd>＋ドラッグで範囲選択
          </>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        {(
          [
            ['west', '西'],
            ['east', '東'],
            ['south', '南'],
            ['north', '北'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label
              htmlFor={`${baseId}-${key}`}
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--text-dim)',
                marginBottom: '4px',
              }}
            >
              {label}
            </label>
            <input
              id={`${baseId}-${key}`}
              type="text"
              inputMode="decimal"
              placeholder={
                key === 'west'
                  ? '139.805'
                  : key === 'east'
                    ? '139.808'
                    : key === 'south'
                      ? '35.747'
                      : '35.749'
              }
              value={manualCoords[key]}
              onChange={(e) => onCoordChange(key, e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '13px',
                background: 'var(--border)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-control)',
              }}
            />
          </div>
        ))}
      </div>
      {isDevMode && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
          <button
            type="button"
            data-testid="preset-adachi"
            onClick={() =>
              applyPreset({ west: 139.8053, south: 35.747, east: 139.808, north: 35.7495 })
            }
            style={presetStyle}
          >
            足立区
          </button>
          <button
            type="button"
            data-testid="preset-shinjuku"
            onClick={() =>
              applyPreset({ west: 139.6899, south: 35.7029, east: 139.6932, north: 35.707 })
            }
            style={presetStyle}
          >
            新宿
          </button>
          <button
            type="button"
            data-testid="preset-tokyo"
            onClick={() =>
              applyPreset({ west: 139.7639, south: 35.6764, east: 139.7708, north: 35.6855 })
            }
            style={presetStyle}
          >
            東京駅
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onApply}
        style={{
          width: '100%',
          minHeight: '40px',
          padding: '0 12px',
          fontSize: '13px',
          fontWeight: 500,
          background: 'transparent',
          color: 'var(--text)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-control)',
          cursor: 'pointer',
        }}
      >
        適用
      </button>
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  fontSize: '12px',
  padding: '0 4px',
  border: '1px solid var(--border-strong)',
  borderBottomWidth: '2px',
  borderRadius: 'var(--radius-control)',
  color: 'var(--text)',
  background: 'var(--border)',
}

const presetStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 32,
  padding: '0 8px',
  fontSize: '12px',
  background: 'var(--border)',
  color: 'var(--text)',
  border: 'none',
  borderRadius: 'var(--radius-control)',
  cursor: 'pointer',
}
