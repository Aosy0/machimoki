import React, { useRef } from 'react'
import type { Lod } from '../lib/catalogApi'

export interface Parameters {
  terrainThickness: number
  flattenBottom: boolean
  includeTerrain: boolean
  showTerrainImagery: boolean
  lod: Lod
  exportFormat: '3mf' | 'stl' | 'machimoki'
  buildingColor: string
  terrainColor: string
  upAxis: 'z-up' | 'y-up'
  includeSpanningBuildings: boolean
}

interface ParameterPanelProps {
  parameters: Parameters
  onChange: (params: Parameters) => void
  onExport: () => void
  availableLods?: Lod[]
}

function ParameterPanel({ parameters, onChange, onExport, availableLods = ['lod1', 'lod2'] }: ParameterPanelProps) {
  const handleChange = <K extends keyof Parameters>(key: K, value: Parameters[K]) => {
    onChange({ ...parameters, [key]: value })
  }

  const lodLabels: Record<Lod, string> = {
    lod1: 'LOD1（シンプル）',
    lod2: 'LOD2（詳細）',
    lod3: 'LOD3（高詳細）',
    lod4: 'LOD4（最高詳細）',
  }
  const LOD_ORDER: Lod[] = ['lod1', 'lod2', 'lod3', 'lod4']

  const buildingColorRef = useRef<HTMLInputElement>(null)
  const terrainColorRef = useRef<HTMLInputElement>(null)

  return (
    <div
      style={{
        width: '280px',
        minWidth: '280px',
        background: 'var(--bg)',
        borderLeft: '1px solid var(--border)',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h3
          style={{
            margin: 0,
            fontSize: '16px',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '8px',
          }}
        >
          設定
        </h3>

        {/* Display Colors */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-dim)' }}>
            建物色
          </label>
          <div
            onClick={() => buildingColorRef.current?.click()}
            style={{
              width: '100%',
              height: '32px',
              borderRadius: '6px',
              background: parameters.buildingColor,
              border: '1px solid var(--border-strong)',
              cursor: 'pointer',
              position: 'relative',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
            }}
            title="クリックして色を変更"
          >
            <input
              ref={buildingColorRef}
              type="color"
              value={parameters.buildingColor}
              onChange={(e) => handleChange('buildingColor', e.target.value)}
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
          </div>
          <label
            style={{ display: 'block', fontSize: '12px', marginTop: '10px', marginBottom: '6px', color: 'var(--text-dim)' }}
          >
            地形色
          </label>
          <div
            onClick={() => terrainColorRef.current?.click()}
            style={{
              width: '100%',
              height: '32px',
              borderRadius: '6px',
              background: parameters.terrainColor,
              border: '1px solid var(--border-strong)',
              cursor: 'pointer',
              position: 'relative',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
            }}
            title="クリックして色を変更"
          >
            <input
              ref={terrainColorRef}
              type="color"
              value={parameters.terrainColor}
              onChange={(e) => handleChange('terrainColor', e.target.value)}
              style={{
                position: 'absolute',
                width: 0,
                height: 0,
                opacity: 0,
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        {/* Export Format */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-dim)' }}>
            出力形式
          </label>
          <select
            value={parameters.exportFormat}
            onChange={(e) => handleChange('exportFormat', e.target.value as Parameters['exportFormat'])}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--border)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text)',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            <option value="3mf">3MF（推奨）</option>
            <option value="stl">STL</option>
            <option value="machimoki">Machimoki（.machimoki）</option>
          </select>
          {parameters.exportFormat === 'machimoki' && (
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '6px' }}>
              .machimoki はモデル（3MF）とメタデータを1つのZIPにまとめた形式です
            </p>
          )}
        </div>

        {/* Up Axis */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-dim)' }}>
            上方向の軸
          </label>
          <select
            value={parameters.upAxis}
            onChange={(e) => handleChange('upAxis', e.target.value as Parameters['upAxis'])}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--border)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text)',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            <option value="z-up">Z軸上向き（推奨）</option>
            <option value="y-up">Y軸上向き</option>
          </select>
        </div>

        {/* LOD Selector */}
        <div>
          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-dim)' }}>
            建物詳細度（LOD）
          </label>
          <select
            value={parameters.lod}
            onChange={(e) => handleChange('lod', e.target.value as Parameters['lod'])}
            style={{
              width: '100%',
              padding: '8px',
              background: 'var(--border)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text)',
              borderRadius: '4px',
              fontSize: '14px',
            }}
          >
            {LOD_ORDER.map((lod) => {
              const available = availableLods.includes(lod)
              return (
                <option
                  key={lod}
                  value={lod}
                  disabled={!available}
                  title={
                    available
                      ? undefined
                      : `この選択範囲では${lodLabels[lod]}は提供されていません`
                  }
                  style={available ? undefined : { color: 'var(--text-muted)' }}
                >
                  {lodLabels[lod]}
                </option>
              )
            })}
          </select>
          {parameters.lod !== 'lod1' && (
            <p style={{ fontSize: '11px', color: 'var(--warn)', marginTop: '6px' }}>
              LOD2以上では、中庭などの開口部が正しく造形できない場合があります。
            </p>
          )}
          {availableLods.length < LOD_ORDER.length && (
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', marginTop: '4px' }}>
              この範囲では利用できない詳細度（LOD）があります。
            </p>
          )}
        </div>

        {/* Terrain Settings */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
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

          <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', color: 'var(--text-dim)' }}>
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

        {/* Spanning Buildings Setting */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>建物フィルタ</h4>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '4px' }}>
            <input
              type="checkbox"
              checked={parameters.includeSpanningBuildings}
              onChange={(e) => handleChange('includeSpanningBuildings', e.target.checked)}
            />
            <span style={{ fontSize: '14px' }}>領域をまたぐ建物を含める</span>
          </label>
          <p style={{ fontSize: '11px', color: 'var(--text-dim)', margin: '0 0 0 26px' }}>
            オフにすると境界をまたぐ建物を除外し、地形からはみ出しません
          </p>
        </div>
      </div>

      {/* Sticky export button */}
      <div
        style={{
          padding: '16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
          position: 'sticky',
          bottom: 0,
        }}
      >
        <button
          onClick={onExport}
          style={{
            width: '100%',
            padding: '14px',
            background: 'var(--accent)',
            color: 'var(--text)',
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
    </div>
  )
}

export default React.memo(ParameterPanel)
