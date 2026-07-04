import React from 'react'

export interface Parameters {
  terrainThickness: number
  flattenBottom: boolean
  includeTerrain: boolean
  showTerrainImagery: boolean
  lod: 'lod1' | 'lod2'
  exportFormat: '3mf' | 'stl'
}

interface ParameterPanelProps {
  parameters: Parameters
  onChange: (params: Parameters) => void
  onExport: () => void
}

function ParameterPanel({ parameters, onChange, onExport }: ParameterPanelProps) {
  const handleChange = <K extends keyof Parameters>(key: K, value: Parameters[K]) => {
    onChange({ ...parameters, [key]: value })
  }

  return (
    <div
      style={{
        width: '280px',
        minWidth: '280px',
        background: '#1a1a1a',
        borderLeft: '1px solid #333',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        gap: '20px',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, fontSize: '16px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
        設定
      </h3>

      {/* Export Format */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: '#aaa' }}>
          出力形式
        </label>
        <select
          value={parameters.exportFormat}
          onChange={(e) => handleChange('exportFormat', e.target.value as Parameters['exportFormat'])}
          style={{
            width: '100%',
            padding: '8px',
            background: '#333',
            border: '1px solid #555',
            color: '#fff',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          <option value="3mf">3MF（推奨）</option>
          <option value="stl">STL</option>
        </select>
      </div>

      {/* LOD Selector */}
      <div>
        <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: '#aaa' }}>
          建物詳細度（LOD）
        </label>
        <select
          value={parameters.lod}
          onChange={(e) => handleChange('lod', e.target.value as Parameters['lod'])}
          style={{
            width: '100%',
            padding: '8px',
            background: '#333',
            border: '1px solid #555',
            color: '#fff',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          <option value="lod1">LOD1（シンプル）</option>
          <option value="lod2">LOD2（詳細）</option>
        </select>
        {parameters.lod === 'lod2' && (
          <p style={{ fontSize: '11px', color: '#f0a000', marginTop: '6px' }}>
            LOD2を選択すると、中庭などの開口部が正しく造形できない場合があります。
          </p>
        )}
      </div>

      {/* Terrain Settings */}
      <div style={{ borderTop: '1px solid #333', paddingTop: '16px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>地形</h4>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={parameters.includeTerrain}
            onChange={(e) => handleChange('includeTerrain', e.target.checked)}
          />
          <span style={{ fontSize: '14px' }}>地形を含める</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={parameters.showTerrainImagery}
            onChange={(e) => handleChange('showTerrainImagery', e.target.checked)}
          />
          <span style={{ fontSize: '14px' }}>航空写真テクスチャを表示</span>
        </label>

        <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: '#aaa' }}>
          地形厚み: {parameters.terrainThickness} mm
        </label>
        <input
          type="range"
          min={1}
          max={50}
          value={parameters.terrainThickness}
          onChange={(e) => handleChange('terrainThickness', Number(e.target.value))}
          style={{ width: '100%' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '12px' }}>
          <input
            type="checkbox"
            checked={parameters.flattenBottom}
            onChange={(e) => handleChange('flattenBottom', e.target.checked)}
          />
          <span style={{ fontSize: '14px' }}>底面をフラット化</span>
        </label>
      </div>

      <button
        onClick={onExport}
        style={{
          marginTop: 'auto',
          padding: '14px',
          background: '#00bcd4',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '16px',
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        エクスポート
      </button>
    </div>
  )
}

export default React.memo(ParameterPanel)
