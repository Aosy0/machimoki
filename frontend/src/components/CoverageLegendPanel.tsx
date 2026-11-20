import Icon from './ui/Icon'
import Switch from './ui/Switch'
import { LOD_CATEGORY_ORDER, LOD_CATEGORY_STYLES } from '../lib/coverageCategories'

interface CoverageLegendPanelProps {
  coverageVisible: boolean
  onToggle: () => void
  onClose?: () => void
}

/** 凡例のON/OFFとLoD凡例。スマホではシート内に表示する。 */
export default function CoverageLegendPanel({
  coverageVisible,
  onToggle,
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <Switch checked={coverageVisible} onChange={onToggle} label="凡例" labelFirst />
        </div>
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
