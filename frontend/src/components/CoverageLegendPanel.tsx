import type { CSSProperties } from 'react'
import Icon from './ui/Icon'
import { LOD_CATEGORY_ORDER, LOD_CATEGORY_STYLES } from '../lib/coverageCategories'

interface CoverageLegendPanelProps {
  coverageVisible: boolean
  onToggle: () => void
  coverageLoading: boolean
  onClose?: () => void
}

const switchTrackStyle = (on: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: on ? 'flex-end' : 'flex-start',
  width: '28px',
  height: '16px',
  padding: '3px',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  background: on ? 'var(--border)' : 'transparent',
  transition: 'background-color 120ms',
})

const switchHandleStyle = (on: boolean): CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '4px',
  background: on ? 'var(--text)' : 'var(--text-dim)',
})

/** 凡例のON/OFFとLoD凡例。スマホではシート内に表示する。 */
export default function CoverageLegendPanel({
  coverageVisible,
  onToggle,
  coverageLoading,
  onClose,
}: CoverageLegendPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <button
          type="button"
          role="switch"
          aria-checked={coverageVisible}
          aria-label="凡例"
          onClick={onToggle}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            minHeight: '32px',
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: coverageVisible ? 'var(--text)' : 'var(--text-dim)',
            fontSize: '13px',
            fontWeight: 500,
          }}
        >
          <span>凡例</span>
          <span aria-hidden="true" style={switchTrackStyle(coverageVisible)}>
            <span style={switchHandleStyle(coverageVisible)} />
          </span>
        </button>
        {onClose && (
          <button
            type="button"
            className="help-detail-close"
            onClick={onClose}
            aria-label="凡例パネルを閉じる"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      {coverageLoading && (
        <div style={{ color: 'var(--text-dim)', fontSize: '12px', marginBottom: '8px' }}>
          読み込み中…
        </div>
      )}
      {coverageVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {LOD_CATEGORY_ORDER.map((category) => {
            const style = LOD_CATEGORY_STYLES[category]
            return (
              <div key={category} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '18px',
                    height: '12px',
                    flexShrink: 0,
                    background: style.fill,
                    border: `2px solid ${style.outline}`,
                    borderRadius: '4px',
                  }}
                />
                <span style={{ color: 'var(--text-dim)', fontSize: '13px' }}>{style.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
