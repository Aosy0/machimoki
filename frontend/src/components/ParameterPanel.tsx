import React, { useRef } from 'react'
import type { Lod } from '../lib/catalogApi'
import { TERRAIN_GRID_PRESETS } from '../lib/previewBudget'

export interface Parameters {
  terrainThickness: number
  flattenBottom: boolean
  reflectActualElevation: boolean
  terrainGridSize: number | null
  includeTerrain: boolean
  showTerrainImagery: boolean
  lod: Lod
  exportFormat: '3mf' | 'stl' | 'machimoki'
  buildingColor: string
  terrainColor: string
  whiteModel: boolean
  upAxis: 'z-up' | 'y-up'
  includeSpanningBuildings: boolean
  openBottom: boolean
  shellThickness: number
  hollowBuildings: boolean
}

interface ParameterPanelProps {
  parameters: Parameters
  onChange: (params: Parameters) => void
  onExport: () => void
  availableLods?: Lod[]
  autoTerrainGridSize?: number
  buildingsVisible: boolean
  onBuildingsVisibleChange: (visible: boolean) => void
}

function ParameterPanel({
  parameters,
  onChange,
  onExport,
  availableLods = ['lod1', 'lod2'],
  autoTerrainGridSize = 128,
  buildingsVisible,
  onBuildingsVisibleChange,
}: ParameterPanelProps) {
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
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              marginBottom: '6px',
              color: 'var(--text-dim)',
            }}
          >
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
            style={{
              display: 'block',
              fontSize: '12px',
              marginTop: '10px',
              marginBottom: '6px',
              color: 'var(--text-dim)',
            }}
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

        {/* Display Mode */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>表示モード</h4>
          <div style={{ marginBottom: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px',
              }}
            >
              <button
                type="button"
                role="switch"
                aria-checked={buildingsVisible}
                onClick={() => onBuildingsVisibleChange(!buildingsVisible)}
                style={{
                  width: '36px',
                  height: '20px',
                  borderRadius: '999px',
                  border: '1px solid var(--border-strong)',
                  background: buildingsVisible ? 'var(--accent)' : 'var(--border)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background-color 150ms ease',
                }}
              >
                <span
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: '#fff',
                    transform: buildingsVisible ? 'translateX(16px)' : 'translateX(0)',
                    transition: 'transform 150ms ease',
                  }}
                />
              </button>
              <span
                onClick={() => onBuildingsVisibleChange(!buildingsVisible)}
                style={{ fontSize: '14px', cursor: 'pointer' }}
              >
                建物を表示
              </span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-dim)', margin: '0 0 0 44px' }}>
              オフにすると地形のみ表示になり、動作が軽くなります
            </p>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginBottom: '4px',
            }}
          >
            <input
              type="checkbox"
              checked={parameters.whiteModel}
              onChange={(e) => handleChange('whiteModel', e.target.checked)}
            />
            <span style={{ fontSize: '14px' }}>白模型レンダリング</span>
          </label>
          <p style={{ fontSize: '11px', color: 'var(--text-dim)', margin: '0 0 0 26px' }}>
            AO・白い下地で模型らしく表示します（実験的）
          </p>
        </div>

        {/* Export Format */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              marginBottom: '6px',
              color: 'var(--text-dim)',
            }}
          >
            出力形式
          </label>
          <select
            value={parameters.exportFormat}
            onChange={(e) =>
              handleChange('exportFormat', e.target.value as Parameters['exportFormat'])
            }
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
            {/* .machimoki は本番未対応のためUIから非表示（型・core実装は維持） */}
          </select>
        </div>

        {/* Up Axis */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              marginBottom: '6px',
              color: 'var(--text-dim)',
            }}
          >
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
          <label
            style={{
              display: 'block',
              fontSize: '12px',
              marginBottom: '6px',
              color: 'var(--text-dim)',
            }}
          >
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
                    available ? undefined : `この選択範囲では${lodLabels[lod]}は提供されていません`
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

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginBottom: '12px',
            }}
          >
            <input
              type="checkbox"
              checked={parameters.includeTerrain}
              onChange={(e) => handleChange('includeTerrain', e.target.checked)}
            />
            <span style={{ fontSize: '14px' }}>地形を含める</span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginBottom: '12px',
            }}
          >
            <input
              type="checkbox"
              checked={parameters.showTerrainImagery}
              onChange={(e) => handleChange('showTerrainImagery', e.target.checked)}
            />
            <span style={{ fontSize: '14px' }}>航空写真テクスチャを表示</span>
          </label>

          <div
            style={{
              opacity: parameters.reflectActualElevation || !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                marginBottom: '6px',
                color: 'var(--text-dim)',
              }}
            >
              地形厚み: {parameters.terrainThickness} mm
            </label>
            <input
              type="range"
              min={1}
              max={50}
              value={parameters.terrainThickness}
              onChange={(e) => handleChange('terrainThickness', Number(e.target.value))}
              disabled={parameters.reflectActualElevation || !parameters.includeTerrain}
              style={{ width: '100%' }}
            />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor:
                parameters.reflectActualElevation || !parameters.includeTerrain
                  ? 'default'
                  : 'pointer',
              marginTop: '12px',
              opacity: parameters.reflectActualElevation || !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.flattenBottom}
              onChange={(e) => handleChange('flattenBottom', e.target.checked)}
              disabled={parameters.reflectActualElevation || !parameters.includeTerrain}
            />
            <span style={{ fontSize: '14px' }}>底面をフラット化</span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: !parameters.includeTerrain ? 'default' : 'pointer',
              marginTop: '12px',
              marginBottom: '4px',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.reflectActualElevation}
              onChange={(e) => handleChange('reflectActualElevation', e.target.checked)}
              disabled={!parameters.includeTerrain}
            />
            <span style={{ fontSize: '14px' }}>実際の標高を反映する</span>
          </label>
          <p
            style={{
              fontSize: '11px',
              color: 'var(--text-dim)',
              margin: '0 0 0 26px',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            底面を海抜0mまで下ろして実際の標高のまま出力します。谷などの低地は土台が厚くなり、材料と印刷時間が増えます。
          </p>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: !parameters.includeTerrain ? 'default' : 'pointer',
              marginTop: '12px',
              marginBottom: '4px',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.openBottom}
              onChange={(e) => handleChange('openBottom', e.target.checked)}
              disabled={!parameters.includeTerrain}
            />
            <span style={{ fontSize: '14px' }}>底面を開口（中空シェル）</span>
          </label>

          {parameters.openBottom && (
            <div style={{ marginTop: '12px', marginLeft: '26px' }}>
              <div
                style={{
                  opacity: !parameters.includeTerrain ? 0.5 : 1,
                }}
              >
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    marginBottom: '6px',
                    color: 'var(--text-dim)',
                  }}
                >
                  シェル厚み: {parameters.shellThickness.toFixed(1)} mm
                </label>
                <input
                  type="range"
                  min={0.8}
                  max={Math.min(5, Math.max(0.8, parameters.terrainThickness - 0.5))}
                  step={0.1}
                  value={parameters.shellThickness}
                  onChange={(e) => handleChange('shellThickness', Number(e.target.value))}
                  disabled={!parameters.includeTerrain}
                  style={{ width: '100%' }}
                />
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: !parameters.includeTerrain ? 'default' : 'pointer',
                  marginTop: '12px',
                  opacity: !parameters.includeTerrain ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={parameters.hollowBuildings}
                  onChange={(e) => handleChange('hollowBuildings', e.target.checked)}
                  disabled={!parameters.includeTerrain}
                />
                <span style={{ fontSize: '14px' }}>建物内部も中空化</span>
              </label>

              <p
                style={{
                  fontSize: '11px',
                  color: 'var(--text-dim)',
                  marginTop: '6px',
                  marginBottom: 0,
                }}
              >
                内部にLED・タッチセンサーを配置できる空洞を作ります。外観は変わりません。印刷時は内側にサポート材が必要です。内部の高さ目安:
                約{Math.max(0, parameters.terrainThickness - parameters.shellThickness).toFixed(1)}{' '}
                mm
              </p>
            </div>
          )}

          <div style={{ marginTop: '12px', opacity: parameters.includeTerrain ? 1 : 0.5 }}>
            <label
              style={{
                display: 'block',
                fontSize: '12px',
                color: 'var(--text-dim)',
                marginBottom: '6px',
              }}
            >
              地形メッシュ解像度
              {parameters.terrainGridSize == null
                ? `（自動: ${autoTerrainGridSize}分割）`
                : `（${parameters.terrainGridSize}分割）`}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <button
                type="button"
                onClick={() => handleChange('terrainGridSize', null)}
                disabled={!parameters.includeTerrain}
                title={`範囲の広さから自動決定（現在 ${autoTerrainGridSize}分割）`}
                style={{
                  flex: '1 1 0',
                  padding: '6px 0',
                  fontSize: '11px',
                  borderRadius: '4px',
                  cursor: parameters.includeTerrain ? 'pointer' : 'default',
                  background:
                    parameters.terrainGridSize == null ? 'var(--accent)' : 'var(--border)',
                  color: parameters.terrainGridSize == null ? 'var(--text)' : 'var(--text-dim)',
                  border: '1px solid var(--border-strong)',
                  fontWeight: parameters.terrainGridSize == null ? 'bold' : 'normal',
                }}
              >
                自動
              </button>
              {TERRAIN_GRID_PRESETS.map((preset) => {
                const active = parameters.terrainGridSize === preset.value
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => handleChange('terrainGridSize', preset.value)}
                    disabled={!parameters.includeTerrain}
                    title={`${preset.value}分割`}
                    style={{
                      flex: '1 1 0',
                      padding: '6px 0',
                      fontSize: '11px',
                      borderRadius: '4px',
                      cursor: parameters.includeTerrain ? 'pointer' : 'default',
                      background: active ? 'var(--accent)' : 'var(--border)',
                      color: active ? 'var(--text)' : 'var(--text-dim)',
                      border: '1px solid var(--border-strong)',
                      fontWeight: active ? 'bold' : 'normal',
                    }}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <p
              style={{
                fontSize: '11px',
                color: 'var(--text-dim)',
                marginTop: '6px',
                marginBottom: 0,
              }}
            >
              解像度が高いほど地形が細かくなり、処理時間とメッシュサイズが増えます
            </p>
          </div>
        </div>

        {/* Spanning Buildings Setting */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: '14px' }}>建物フィルタ</h4>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginBottom: '4px',
            }}
          >
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
          data-testid="export-button"
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
