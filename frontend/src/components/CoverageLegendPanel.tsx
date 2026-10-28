import { LOD_CATEGORY_ORDER, LOD_CATEGORY_STYLES } from '../lib/coverageCategories'

interface CoverageLegendPanelProps {
  coverageVisible: boolean
  onToggle: () => void
  coverageLoading: boolean
  onClose?: () => void
}

/** カバレッジ表示のON/OFFとLoD凡例。スマホではシート内に表示する。 */
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
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>カバレッジ表示</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={onToggle}
            title={coverageVisible ? 'カバレッジ表示をオフにする' : 'カバレッジ表示をオンにする'}
            style={{
              minHeight: 32,
              padding: '4px 10px',
              fontSize: '13px',
              cursor: 'pointer',
              background: coverageVisible ? 'var(--accent)' : 'var(--border)',
              color: 'var(--text)',
              border: coverageVisible
                ? '1px solid var(--accent)'
                : '1px solid var(--border-strong)',
              borderRadius: '3px',
              fontWeight: 600,
            }}
          >
            {coverageVisible ? 'ON' : 'OFF'}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="凡例パネルを閉じる"
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
      </div>
      {coverageLoading && (
        <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '6px' }}>
          カバレッジデータを読み込み中...
        </div>
      )}
      {coverageVisible && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {LOD_CATEGORY_ORDER.map((category) => {
            const style = LOD_CATEGORY_STYLES[category]
            return (
              <div key={category} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '18px',
                    height: '12px',
                    background: style.fill,
                    border: `2px solid ${style.outline}`,
                    borderRadius: '2px',
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: 'var(--text-dim)', fontSize: '13px' }}>{style.label}</span>
              </div>
            )
          })}
          <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
            整備状況をLoD別に色分けしています
          </div>
        </div>
      )}
    </div>
  )
}
