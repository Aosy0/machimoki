import React from 'react'

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '6px',
        }}
      >
        <div style={{ fontWeight: 'bold' }}>座標で選択</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="座標パネルを閉じる"
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px',
          marginBottom: '6px',
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
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                marginBottom: '2px',
                letterSpacing: '0.05em',
              }}
            >
              {label}
            </div>
            <input
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
                padding: '4px',
                fontSize: '13px',
                background: 'var(--border)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong)',
                borderRadius: '3px',
              }}
            />
          </div>
        ))}
      </div>
      {isDevMode && (
        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
          <button
            data-testid="preset-adachi"
            onClick={() =>
              applyPreset({ west: 139.8053, south: 35.747, east: 139.808, north: 35.7495 })
            }
            style={presetStyle}
          >
            足立区
          </button>
          <button
            data-testid="preset-shinjuku"
            onClick={() =>
              applyPreset({ west: 139.6899, south: 35.7029, east: 139.6932, north: 35.707 })
            }
            style={presetStyle}
          >
            新宿
          </button>
          <button
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
        onClick={onApply}
        style={{
          width: '100%',
          minHeight: 40,
          padding: '6px',
          fontSize: '13px',
          background: 'var(--accent)',
          color: 'var(--text)',
          border: 'none',
          borderRadius: '3px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        適用
      </button>
      <div
        data-testid="map2d-drag-hint"
        style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}
      >
        {hasCoarsePointer ? '長押し→ドラッグ で範囲選択' : 'Shift + ドラッグ で範囲選択'}
      </div>
    </div>
  )
}

const presetStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 36,
  padding: '4px',
  fontSize: '12px',
  background: 'var(--border)',
  color: 'var(--text)',
  border: 'none',
  borderRadius: '3px',
  cursor: 'pointer',
}
