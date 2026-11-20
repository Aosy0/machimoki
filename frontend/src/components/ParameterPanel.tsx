import React, { useId, useRef } from 'react'
import {
  BASE_EXTENSION_MM,
  FRAME_MITER_DEPTH_RATIO,
  hasMiterBase,
  MIN_FRAME_HEIGHT_MM,
} from '../../../core/src/frameSplitConstants.ts'
import type { EngravingOptions } from '../../../core/src/engraving/types.ts'
import type { Lod } from '../lib/catalogApi'
import { TERRAIN_GRID_PRESETS } from '../lib/previewBudget'
import {
  PREVIEW_QUALITY_PROFILES,
  type PreviewQualityOverride,
  type PreviewQualityTier,
} from '../lib/previewQuality'

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
  /** 地形枠と建物部分に分割して出力する */
  splitAtGround: boolean
  /** 側面・底面への刻印設定 */
  engraving: EngravingOptions
}

interface ParameterPanelProps {
  parameters: Parameters
  onChange: (params: Parameters) => void
  onExport: () => void
  /** 刻印モード（専用UI）を開始する。 */
  onEnterEngravingMode: () => void
  /** 適用済みの刻印を削除する。 */
  onDeleteEngraving: () => void
  availableLods?: Lod[]
  autoTerrainGridSize?: number
  buildingsVisible: boolean
  onBuildingsVisibleChange: (visible: boolean) => void
  /** 影の表示ON/OFF。 */
  shadowsVisible: boolean
  onShadowsVisibleChange: (visible: boolean) => void
  /** スマホではサイドパネルではなくボトムシートとして表示する。 */
  mobile?: boolean
  onClose?: () => void
  /** 自動判定された現在の3Dプレビュー品質。 */
  previewQuality: PreviewQualityTier
  /** auto / high / medium / low の手動上書き。 */
  previewQualityOverride: PreviewQualityOverride
  onPreviewQualityOverrideChange: (value: PreviewQualityOverride) => void
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 8,
  fontSize: 12,
  color: 'var(--text-dim)',
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  background: 'var(--border)',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  color: 'var(--text)',
  fontSize: 14,
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const groupTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 500,
}

const rangeLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  marginBottom: 8,
  fontSize: 12,
  color: 'var(--text-dim)',
}

const valueStyle: React.CSSProperties = {
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
}

function ParameterPanel({
  parameters,
  onChange,
  onExport,
  onEnterEngravingMode,
  onDeleteEngraving,
  availableLods = ['lod1', 'lod2'],
  autoTerrainGridSize = 128,
  buildingsVisible,
  onBuildingsVisibleChange,
  shadowsVisible,
  onShadowsVisibleChange,
  mobile = false,
  onClose,
  previewQuality,
  previewQualityOverride,
  onPreviewQualityOverrideChange,
}: ParameterPanelProps) {
  // ラベルと入力部品を関連付ける id の接頭辞。インスタンスごとに一意になる。
  const baseId = useId()

  const handleChange = <K extends keyof Parameters>(key: K, value: Parameters[K]) => {
    onChange({ ...parameters, [key]: value })
  }

  const handleOpenBottomChange = (checked: boolean) => {
    onChange({
      ...parameters,
      openBottom: checked,
      ...(checked ? {} : { splitAtGround: false }),
    })
  }

  const handleSplitAtGroundChange = (checked: boolean) => {
    onChange({
      ...parameters,
      splitAtGround: checked,
      ...(checked ? { openBottom: true } : {}),
    })
  }

  const lodLabels: Record<Lod, string> = {
    lod1: 'LOD1',
    lod2: 'LOD2',
    lod3: 'LOD3',
    lod4: 'LOD4',
  }
  const LOD_ORDER: Lod[] = ['lod1', 'lod2', 'lod3', 'lod4']

  // 軽量画質では影そのものを描画しないため、トグルは無効（OFF表示）にする。
  const shadowsAvailable = PREVIEW_QUALITY_PROFILES[previewQuality].shadows
  const shadowsOn = shadowsAvailable && shadowsVisible

  const buildingColorRef = useRef<HTMLInputElement>(null)
  const terrainColorRef = useRef<HTMLInputElement>(null)

  return (
    <div
      style={{
        width: mobile ? '100%' : '280px',
        minWidth: mobile ? 0 : '280px',
        maxHeight: mobile ? '74dvh' : undefined,
        position: mobile ? 'absolute' : undefined,
        left: mobile ? 0 : undefined,
        right: mobile ? 0 : undefined,
        bottom: mobile ? 0 : undefined,
        zIndex: mobile ? 300 : undefined,
        background: 'var(--bg)',
        borderLeft: mobile ? 'none' : '1px solid var(--border)',
        borderTop: mobile ? '1px solid var(--border-strong)' : undefined,
        borderRadius: mobile ? '16px 16px 0 0' : undefined,
        boxShadow: mobile ? '0 -12px 32px rgba(0, 0, 0, 0.45)' : undefined,
        paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined,
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {mobile && (
        <div
          aria-hidden
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '8px 0 2px',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 40,
              height: 4,
              borderRadius: 999,
              background: 'var(--border-strong)',
            }}
          />
        </div>
      )}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>設定</h3>
          {mobile && onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                minWidth: 64,
                minHeight: 36,
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'transparent',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              閉じる
            </button>
          )}
        </div>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>表示</h4>
          <div>
            <label htmlFor={`${baseId}-preview-quality`} style={labelStyle}>
              プレビュー画質
            </label>
            <select
              id={`${baseId}-preview-quality`}
              data-testid="preview-quality-select"
              value={previewQualityOverride}
              onChange={(e) =>
                onPreviewQualityOverrideChange(e.target.value as PreviewQualityOverride)
              }
              style={selectStyle}
            >
              <option value="auto">
                自動（{PREVIEW_QUALITY_PROFILES[previewQuality].label}）
              </option>
              <option value="high">高画質</option>
              <option value="medium">標準</option>
              <option value="low">軽量</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>建物色</label>
            <div
              onClick={() => buildingColorRef.current?.click()}
              style={{
                width: '100%',
                height: 32,
                borderRadius: 6,
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
                aria-label="建物の色"
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
          </div>

          <div>
            <label style={labelStyle}>地形色</label>
            <div
              onClick={() => terrainColorRef.current?.click()}
              style={{
                width: '100%',
                height: 32,
                borderRadius: 6,
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
                aria-label="地形の色"
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              role="switch"
              aria-label="建物"
              aria-checked={buildingsVisible}
              onClick={() => onBuildingsVisibleChange(!buildingsVisible)}
              style={{
                width: 36,
                height: 20,
                borderRadius: 999,
                border: '1px solid var(--border-strong)',
                background: buildingsVisible ? 'var(--accent)' : 'var(--border)',
                display: 'inline-flex',
                alignItems: 'center',
                padding: 2,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background-color 150ms ease',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  transform: buildingsVisible ? 'translateX(16px)' : 'translateX(0)',
                  transition: 'transform 150ms ease',
                }}
              />
            </button>
            <span
              onClick={() => onBuildingsVisibleChange(!buildingsVisible)}
              style={{ fontSize: 14, cursor: 'pointer' }}
            >
              建物
            </span>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                role="switch"
                aria-label="影"
                aria-checked={shadowsOn}
                data-testid="shadows-toggle"
                disabled={!shadowsAvailable}
                onClick={() => onShadowsVisibleChange(!shadowsVisible)}
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 999,
                  border: '1px solid var(--border-strong)',
                  background: shadowsOn ? 'var(--accent)' : 'var(--border)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: 2,
                  cursor: shadowsAvailable ? 'pointer' : 'not-allowed',
                  opacity: shadowsAvailable ? 1 : 0.45,
                  flexShrink: 0,
                  transition: 'background-color 150ms ease',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#fff',
                    transform: shadowsOn ? 'translateX(16px)' : 'translateX(0)',
                    transition: 'transform 150ms ease',
                  }}
                />
              </button>
              <span
                onClick={() => {
                  if (shadowsAvailable) onShadowsVisibleChange(!shadowsVisible)
                }}
                style={{
                  fontSize: 14,
                  cursor: shadowsAvailable ? 'pointer' : 'not-allowed',
                  opacity: shadowsAvailable ? 1 : 0.45,
                }}
              >
                影
              </span>
            </div>
            {!shadowsAvailable && (
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0' }}>
                軽量画質では影を表示できません
              </p>
            )}
          </div>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={parameters.whiteModel}
              onChange={(e) => handleChange('whiteModel', e.target.checked)}
            />
            <span style={{ fontSize: 14 }}>白模型</span>
          </label>
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>出力</h4>
          <div>
            <label htmlFor={`${baseId}-export-format`} style={labelStyle}>
              形式
            </label>
            <select
              id={`${baseId}-export-format`}
              value={parameters.exportFormat}
              onChange={(e) =>
                handleChange('exportFormat', e.target.value as Parameters['exportFormat'])
              }
              style={selectStyle}
            >
              <option value="3mf">3MF</option>
              <option value="stl">STL</option>
              {/* .machimoki は本番未対応のためUIから非表示（型・core実装は維持） */}
            </select>
          </div>

          <div>
            <label htmlFor={`${baseId}-up-axis`} style={labelStyle}>
              上方向の軸
            </label>
            <select
              id={`${baseId}-up-axis`}
              value={parameters.upAxis}
              onChange={(e) => handleChange('upAxis', e.target.value as Parameters['upAxis'])}
              style={selectStyle}
            >
              <option value="z-up">Z軸上向き</option>
              <option value="y-up">Y軸上向き</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${baseId}-lod`} style={labelStyle}>
              建物LOD
            </label>
            <select
              id={`${baseId}-lod`}
              value={parameters.lod}
              onChange={(e) => handleChange('lod', e.target.value as Parameters['lod'])}
              style={selectStyle}
            >
              {LOD_ORDER.map((lod) => (
                <option key={lod} value={lod} disabled={!availableLods.includes(lod)}>
                  {lodLabels[lod]}
                </option>
              ))}
            </select>
            {parameters.lod !== 'lod1' && (
              <p style={{ fontSize: 12, color: 'var(--warn)', margin: '4px 0 0' }}>
                中庭などの開口部が造形できない場合があります
              </p>
            )}
          </div>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={parameters.includeSpanningBuildings}
              onChange={(e) => handleChange('includeSpanningBuildings', e.target.checked)}
            />
            <span style={{ fontSize: 14 }}>領域をまたぐ建物を含める</span>
          </label>
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>地形</h4>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={parameters.includeTerrain}
              onChange={(e) => handleChange('includeTerrain', e.target.checked)}
            />
            <span style={{ fontSize: 14 }}>地形を含める</span>
          </label>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={parameters.showTerrainImagery}
              onChange={(e) => handleChange('showTerrainImagery', e.target.checked)}
            />
            <span style={{ fontSize: 14 }}>航空写真</span>
          </label>

          <div
            style={{
              opacity: parameters.reflectActualElevation || !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <label htmlFor={`${baseId}-terrain-thickness`} style={rangeLabelStyle}>
              <span>地形厚み</span>
              <span style={valueStyle}>{parameters.terrainThickness.toFixed(1)} mm</span>
            </label>
            <input
              id={`${baseId}-terrain-thickness`}
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
              ...checkboxRowStyle,
              cursor:
                parameters.reflectActualElevation || !parameters.includeTerrain
                  ? 'default'
                  : 'pointer',
              opacity: parameters.reflectActualElevation || !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.flattenBottom}
              onChange={(e) => handleChange('flattenBottom', e.target.checked)}
              disabled={parameters.reflectActualElevation || !parameters.includeTerrain}
            />
            <span style={{ fontSize: 14 }}>底面をフラット化</span>
          </label>

          <label
            style={{
              ...checkboxRowStyle,
              cursor: !parameters.includeTerrain ? 'default' : 'pointer',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.reflectActualElevation}
              onChange={(e) => handleChange('reflectActualElevation', e.target.checked)}
              disabled={!parameters.includeTerrain}
            />
            <span style={{ fontSize: 14 }}>実際の標高を反映する</span>
          </label>
          {parameters.reflectActualElevation && parameters.includeTerrain && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
              谷などの低地は土台が厚くなり、材料と印刷時間が増えます
            </p>
          )}

          <label
            style={{
              ...checkboxRowStyle,
              cursor: !parameters.includeTerrain ? 'default' : 'pointer',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.openBottom}
              onChange={(e) => handleOpenBottomChange(e.target.checked)}
              disabled={!parameters.includeTerrain}
            />
            <span style={{ fontSize: 14 }}>底面を開口（中空シェル）</span>
          </label>

          {parameters.openBottom && (
            <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  opacity: !parameters.includeTerrain ? 0.5 : 1,
                }}
              >
                <label htmlFor={`${baseId}-shell-thickness`} style={rangeLabelStyle}>
                  <span>シェル厚み</span>
                  <span style={valueStyle}>{parameters.shellThickness.toFixed(1)} mm</span>
                </label>
                <input
                  id={`${baseId}-shell-thickness`}
                  type="range"
                  min={0.8}
                  max={Math.min(
                    5,
                    Math.max(0.8, parameters.terrainThickness - MIN_FRAME_HEIGHT_MM),
                    Math.max(
                      0.8,
                      (parameters.terrainThickness - BASE_EXTENSION_MM) / FRAME_MITER_DEPTH_RATIO,
                    ),
                  )}
                  step={0.1}
                  value={parameters.shellThickness}
                  onChange={(e) => handleChange('shellThickness', Number(e.target.value))}
                  disabled={!parameters.includeTerrain}
                  style={{ width: '100%' }}
                />
                {(parameters.terrainThickness - parameters.shellThickness < MIN_FRAME_HEIGHT_MM ||
                  !hasMiterBase(parameters.terrainThickness, parameters.shellThickness)) && (
                  <p style={{ fontSize: 12, color: 'var(--warn)', margin: '4px 0 0' }}>
                    地形厚みはシェル厚み + {MIN_FRAME_HEIGHT_MM.toFixed(1)} mm
                    以上、かつシェル厚み × {FRAME_MITER_DEPTH_RATIO} より大きい必要があります
                  </p>
                )}
              </div>

              <label
                style={{
                  ...checkboxRowStyle,
                  cursor: !parameters.includeTerrain ? 'default' : 'pointer',
                  opacity: !parameters.includeTerrain ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={parameters.hollowBuildings}
                  onChange={(e) => handleChange('hollowBuildings', e.target.checked)}
                  disabled={!parameters.includeTerrain}
                />
                <span style={{ fontSize: 14 }}>建物内部も中空化</span>
              </label>

              {parameters.hollowBuildings && parameters.includeTerrain && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      color: 'var(--text-dim)',
                    }}
                  >
                    <span>内部高さ</span>
                    <span style={valueStyle}>
                      {Math.max(0, parameters.terrainThickness - parameters.shellThickness).toFixed(
                        1,
                      )}{' '}
                      mm
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
                    内側にサポート材が必要です
                  </p>
                </div>
              )}
            </div>
          )}

          <label
            style={{
              ...checkboxRowStyle,
              cursor: !parameters.includeTerrain ? 'default' : 'pointer',
              opacity: !parameters.includeTerrain ? 0.5 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={parameters.splitAtGround}
              onChange={(e) => handleSplitAtGroundChange(e.target.checked)}
              disabled={!parameters.includeTerrain}
            />
            <span style={{ fontSize: 14 }}>土台と建物に分割</span>
          </label>
          {parameters.splitAtGround && parameters.includeTerrain && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
              底面開口も自動でON
            </p>
          )}

          <div style={{ opacity: parameters.includeTerrain ? 1 : 0.5 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>地形メッシュ解像度</span>
              <span style={valueStyle}>
                {parameters.terrainGridSize == null
                  ? `自動 ${autoTerrainGridSize}分割`
                  : `${parameters.terrainGridSize}分割`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => handleChange('terrainGridSize', null)}
                disabled={!parameters.includeTerrain}
                title={`範囲の広さから自動決定（現在 ${autoTerrainGridSize}分割）`}
                style={{
                  flex: '1 1 0',
                  padding: '6px 0',
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: parameters.includeTerrain ? 'pointer' : 'default',
                  background:
                    parameters.terrainGridSize == null ? 'var(--accent)' : 'var(--border)',
                  color: parameters.terrainGridSize == null ? 'var(--text)' : 'var(--text-dim)',
                  border: '1px solid var(--border-strong)',
                  fontWeight: parameters.terrainGridSize == null ? 500 : 400,
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
                      fontSize: 12,
                      borderRadius: 4,
                      cursor: parameters.includeTerrain ? 'pointer' : 'default',
                      background: active ? 'var(--accent)' : 'var(--border)',
                      color: active ? 'var(--text)' : 'var(--text-dim)',
                      border: '1px solid var(--border-strong)',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0' }}>
              処理時間が増えます
            </p>
          </div>
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>刻印</h4>
          <button
            type="button"
            data-testid="engraving-mode-button"
            disabled={!parameters.includeTerrain}
            onClick={onEnterEngravingMode}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 6,
              border: 'none',
              background: parameters.includeTerrain ? 'var(--accent)' : 'var(--border-strong)',
              color: parameters.includeTerrain ? '#fff' : 'var(--text-dim)',
              fontSize: 14,
              fontWeight: 500,
              cursor: parameters.includeTerrain ? 'pointer' : 'not-allowed',
            }}
          >
            {parameters.engraving.enabled ? '刻印を編集' : '刻印モードを開始'}
          </button>
          {parameters.engraving.enabled && (
            <button
              type="button"
              data-testid="engraving-delete-button"
              onClick={onDeleteEngraving}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid var(--border-strong)',
                background: 'transparent',
                color: 'var(--error)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              刻印を削除
            </button>
          )}
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
            {parameters.includeTerrain
              ? 'モード中は視点回転が固定されます'
              : '地形が必要です'}
          </p>
        </section>
      </div>

      <div
        style={{
          padding: 16,
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
            padding: 14,
            background: 'var(--accent)',
            color: 'var(--text)',
            border: 'none',
            borderRadius: 6,
            fontSize: 16,
            fontWeight: 500,
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
