import React, { useId } from 'react'
import Icon from './ui/Icon'
import Hint from './ui/Hint'
import Switch from './ui/Switch'
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
  /** 橋梁モデル（PLATEAU brid）の重ね表示。 */
  bridgesVisible: boolean
  onBridgesVisibleChange: (visible: boolean) => void
  /** 選択範囲の自治体が橋梁モデルを整備しているか。 */
  bridgesAvailable: boolean
  /** 道路モデル（PLATEAU tran）の重ね表示。 */
  roadsVisible: boolean
  onRoadsVisibleChange: (visible: boolean) => void
  /** 選択範囲の自治体が道路モデルを整備しているか。 */
  roadsAvailable: boolean
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

/** 入力の直上に置く見出し。右端には「?」などの補助を並べられる。 */
const fieldHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 8,
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-dim)',
}

/** 行の本体を伸ばし、右端の補助（「?」）の位置をそろえる。 */
const hintRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const hintRowMainStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
}

// 見た目は index.css の select に任せ、幅だけそろえる。
const selectStyle: React.CSSProperties = {
  width: '100%',
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

const colorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 32,
}

const swatchStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  flexShrink: 0,
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-control)',
  background: 'transparent',
  cursor: 'pointer',
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

const noteStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  color: 'var(--text-dim)',
}

const flatNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--text-dim)',
}

const warnNoteStyle: React.CSSProperties = {
  ...noteStyle,
  color: 'var(--warn)',
}

function gridButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: '1 1 0',
    height: 32,
    padding: 0,
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    borderRadius: 'var(--radius-control)',
    background: active ? 'var(--border)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-dim)',
    border: active ? '1px solid var(--border-strong)' : '1px solid var(--border)',
    fontWeight: active ? 500 : 400,
  }
}

interface CheckRowProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  describedBy?: string
}

function CheckRow({ checked, onChange, label, disabled = false, describedBy }: CheckRowProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 32,
        fontSize: 14,
        color: disabled ? 'var(--text-dim)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 16,
          height: 16,
          margin: 0,
          flexShrink: 0,
          accentColor: 'var(--border-strong)',
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
      <span>{label}</span>
    </label>
  )
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
  bridgesVisible,
  onBridgesVisibleChange,
  bridgesAvailable,
  roadsVisible,
  onRoadsVisibleChange,
  roadsAvailable,
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
  const idOf = (suffix: string) => `${baseId}-${suffix}`

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

  const missingLods = LOD_ORDER.filter((lod) => !availableLods.includes(lod))
  const missingLodText = missingLods.map((lod) => lodLabels[lod]).join('・')
  const elevationLocked = parameters.reflectActualElevation

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
        borderRadius: mobile ? 'var(--radius-panel) var(--radius-panel) 0 0' : undefined,
        paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined,
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        // スクロールするのは中身だけ。エクスポートは常に右下に残す。
        overflow: 'hidden',
      }}
    >
      {mobile && (
        <div
          aria-hidden
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '8px 0',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 40,
              height: 4,
              borderRadius: 'var(--radius-control)',
              background: 'var(--border-strong)',
            }}
          />
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
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
              aria-label="閉じる"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                padding: 0,
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-control)',
                background: 'transparent',
                color: 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>出力</h4>
          <div>
            <label htmlFor={idOf('export-format')} style={labelStyle}>
              形式
            </label>
            <select
              id={idOf('export-format')}
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
            <div style={fieldHeaderStyle}>
              <label htmlFor={idOf('lod')} style={fieldLabelStyle}>
                建物LOD
              </label>
              {missingLods.length > 0 && (
                <Hint id={idOf('lod-reason')} label="選べないLODの理由">
                  この範囲に {missingLodText} はありません
                </Hint>
              )}
            </div>
            <select
              id={idOf('lod')}
              value={parameters.lod}
              onChange={(e) => handleChange('lod', e.target.value as Parameters['lod'])}
              aria-describedby={missingLods.length > 0 ? idOf('lod-reason') : undefined}
              style={selectStyle}
            >
              {LOD_ORDER.map((lod) => (
                <option key={lod} value={lod} disabled={!availableLods.includes(lod)}>
                  {lodLabels[lod]}
                </option>
              ))}
            </select>
            {parameters.lod !== 'lod1' && (
              <p style={warnNoteStyle}>中庭などの開口部が造形できない場合があります</p>
            )}
          </div>
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>地形</h4>
          <CheckRow
            checked={parameters.includeTerrain}
            onChange={(checked) => handleChange('includeTerrain', checked)}
            label="地形を含める"
          />
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>刻印</h4>
          <div style={hintRowStyle}>
            <div style={hintRowMainStyle}>
              <button
                type="button"
                data-testid="engraving-mode-button"
                disabled={!parameters.includeTerrain}
                onClick={onEnterEngravingMode}
                style={{
                  width: '100%',
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 'var(--radius-control)',
                  border: parameters.includeTerrain
                    ? '1px solid var(--border-strong)'
                    : '1px solid var(--border)',
                  background: 'transparent',
                  color: parameters.includeTerrain ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: parameters.includeTerrain ? 'pointer' : 'not-allowed',
                }}
              >
                {parameters.engraving.enabled ? '刻印を編集' : '刻印モードを開始'}
              </button>
            </div>
            {!parameters.includeTerrain && (
              <Hint id={idOf('engraving-reason')} label="刻印モードを有効にする方法">
                「地形を含める」をオンにすると使えます。地形がないと刻印する面がありません
              </Hint>
            )}
          </div>
          {parameters.engraving.enabled && (
            <button
              type="button"
              data-testid="engraving-delete-button"
              onClick={onDeleteEngraving}
              style={{
                width: '100%',
                height: 32,
                padding: '0 12px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-strong)',
                background: 'transparent',
                color: 'var(--error)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              刻印を削除
            </button>
          )}
          {parameters.includeTerrain && (
            <p style={flatNoteStyle}>モード中は視点回転が固定されます</p>
          )}
        </section>

        <section style={sectionStyle}>
          <h4 style={groupTitleStyle}>表示</h4>
          <div>
            <label htmlFor={idOf('preview-quality')} style={labelStyle}>
              プレビュー画質
            </label>
            <select
              id={idOf('preview-quality')}
              data-testid="preview-quality-select"
              value={previewQualityOverride}
              onChange={(e) =>
                onPreviewQualityOverrideChange(e.target.value as PreviewQualityOverride)
              }
              style={selectStyle}
            >
              <option value="auto">自動（{PREVIEW_QUALITY_PROFILES[previewQuality].label}）</option>
              <option value="high">高画質</option>
              <option value="medium">標準</option>
              <option value="low">軽量</option>
            </select>
          </div>

          <Switch checked={buildingsVisible} onChange={onBuildingsVisibleChange} label="建物" />

          <div style={hintRowStyle}>
            <div style={hintRowMainStyle}>
              <Switch
                checked={bridgesVisible}
                onChange={onBridgesVisibleChange}
                label="橋"
                disabled={!bridgesAvailable}
                testId="bridges-toggle"
                describedBy={bridgesAvailable ? undefined : idOf('bridges-reason')}
              />
            </div>
            {!bridgesAvailable && (
              <Hint id={idOf('bridges-reason')} label="橋を選べない理由">
                この範囲の自治体は橋梁モデル（3Dデータ）を整備していません
              </Hint>
            )}
          </div>

          <div style={hintRowStyle}>
            <div style={hintRowMainStyle}>
              <Switch
                checked={roadsVisible}
                onChange={onRoadsVisibleChange}
                label="道路"
                disabled={!roadsAvailable}
                testId="roads-toggle"
                describedBy={roadsAvailable ? undefined : idOf('roads-reason')}
              />
            </div>
            {!roadsAvailable && (
              <Hint id={idOf('roads-reason')} label="道路を選べない理由">
                この範囲の自治体は道路モデル（3Dデータ）を整備していません
              </Hint>
            )}
          </div>

          <div style={hintRowStyle}>
            <div style={hintRowMainStyle}>
              <Switch
                checked={shadowsOn}
                onChange={onShadowsVisibleChange}
                label="影"
                disabled={!shadowsAvailable}
                testId="shadows-toggle"
                describedBy={shadowsAvailable ? undefined : idOf('shadows-reason')}
              />
            </div>
            {!shadowsAvailable && (
              <Hint id={idOf('shadows-reason')} label="影を有効にする方法">
                プレビュー画質を「軽量」以外にすると使えます。軽量画質では影を描画しません
              </Hint>
            )}
          </div>

          <div style={hintRowStyle}>
            <div style={hintRowMainStyle}>
              <Switch
                checked={parameters.showTerrainImagery}
                onChange={(checked) => handleChange('showTerrainImagery', checked)}
                label="航空写真"
                disabled={parameters.includeTerrain}
                describedBy={parameters.includeTerrain ? idOf('aerial-reason') : undefined}
              />
            </div>
            {parameters.includeTerrain && (
              <Hint id={idOf('aerial-reason')} label="航空写真を有効にする方法">
                「地形を含める」をオフにすると使えます。地形を含めると地面が模型になり、地図は表示されません
              </Hint>
            )}
          </div>
        </section>

        <details className="ui-details">
          <summary>
            詳細設定
            <Icon name="chevron-down" size={16} className="ui-details__chevron" />
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor={idOf('up-axis')} style={labelStyle}>
                上方向の軸
              </label>
              <select
                id={idOf('up-axis')}
                value={parameters.upAxis}
                onChange={(e) => handleChange('upAxis', e.target.value as Parameters['upAxis'])}
                style={selectStyle}
              >
                <option value="z-up">Z軸上向き</option>
                <option value="y-up">Y軸上向き</option>
              </select>
            </div>

            <CheckRow
              checked={parameters.includeSpanningBuildings}
              onChange={(checked) => handleChange('includeSpanningBuildings', checked)}
              label="領域をまたぐ建物を含める"
            />

            <div style={colorRowStyle}>
              <label htmlFor={idOf('building-color')} style={fieldLabelStyle}>
                建物色
              </label>
              <input
                id={idOf('building-color')}
                type="color"
                value={parameters.buildingColor}
                onChange={(e) => handleChange('buildingColor', e.target.value)}
                style={swatchStyle}
              />
            </div>

            <div style={colorRowStyle}>
              <label htmlFor={idOf('terrain-color')} style={fieldLabelStyle}>
                地形色
              </label>
              <input
                id={idOf('terrain-color')}
                type="color"
                value={parameters.terrainColor}
                onChange={(e) => handleChange('terrainColor', e.target.value)}
                style={swatchStyle}
              />
            </div>

            {parameters.includeTerrain && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
                <div>
                  <div style={fieldHeaderStyle}>
                    <label htmlFor={idOf('terrain-thickness')} style={fieldLabelStyle}>
                      地形厚み
                    </label>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={valueStyle}>{parameters.terrainThickness.toFixed(1)} mm</span>
                      {elevationLocked && (
                        <Hint id={idOf('thickness-reason')} label="地形厚みを指定する方法">
                          「実際の標高を反映する」をオフにすると指定できます。オンにしている間は底面が標高に沿って決まります
                        </Hint>
                      )}
                    </span>
                  </div>
                  <input
                    id={idOf('terrain-thickness')}
                    type="range"
                    min={1}
                    max={50}
                    value={parameters.terrainThickness}
                    onChange={(e) => handleChange('terrainThickness', Number(e.target.value))}
                    disabled={elevationLocked}
                    aria-describedby={elevationLocked ? idOf('thickness-reason') : undefined}
                    style={{ width: '100%' }}
                    aria-valuetext={`${parameters.terrainThickness.toFixed(1)} mm`}
                  />
                </div>

                <div style={hintRowStyle}>
                  <div style={hintRowMainStyle}>
                    <CheckRow
                      checked={parameters.flattenBottom}
                      onChange={(checked) => handleChange('flattenBottom', checked)}
                      label="底面をフラット化"
                      disabled={elevationLocked}
                      describedBy={elevationLocked ? idOf('flatten-reason') : undefined}
                    />
                  </div>
                  {elevationLocked && (
                    <Hint id={idOf('flatten-reason')} label="底面をフラット化する方法">
                      「実際の標高を反映する」をオフにすると指定できます。オンにしている間は底面が標高に沿って決まります
                    </Hint>
                  )}
                </div>

                <CheckRow
                  checked={parameters.reflectActualElevation}
                  onChange={(checked) => handleChange('reflectActualElevation', checked)}
                  label="実際の標高を反映する"
                />
                {parameters.reflectActualElevation && (
                  <p style={flatNoteStyle}>
                    谷などの低地は土台が厚くなり、材料と印刷時間が増えます
                  </p>
                )}

                <CheckRow
                  checked={parameters.openBottom}
                  onChange={handleOpenBottomChange}
                  label="底面を開口（中空シェル）"
                />

                {parameters.openBottom && (
                  <div
                    style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 12 }}
                  >
                    <div>
                      <label htmlFor={idOf('shell-thickness')} style={rangeLabelStyle}>
                        <span>シェル厚み</span>
                        <span style={valueStyle}>{parameters.shellThickness.toFixed(1)} mm</span>
                      </label>
                      <input
                        id={idOf('shell-thickness')}
                        type="range"
                        min={0.8}
                        max={Math.min(
                          5,
                          Math.max(0.8, parameters.terrainThickness - MIN_FRAME_HEIGHT_MM),
                          Math.max(
                            0.8,
                            (parameters.terrainThickness - BASE_EXTENSION_MM) /
                              FRAME_MITER_DEPTH_RATIO,
                          ),
                        )}
                        step={0.1}
                        value={parameters.shellThickness}
                        onChange={(e) => handleChange('shellThickness', Number(e.target.value))}
                        style={{ width: '100%' }}
                        aria-valuetext={`${parameters.shellThickness.toFixed(1)} mm`}
                      />
                      {(parameters.terrainThickness - parameters.shellThickness <
                        MIN_FRAME_HEIGHT_MM ||
                        !hasMiterBase(parameters.terrainThickness, parameters.shellThickness)) && (
                        <p style={warnNoteStyle}>
                          地形厚みはシェル厚み + {MIN_FRAME_HEIGHT_MM.toFixed(1)} mm
                          以上、かつシェル厚み × {FRAME_MITER_DEPTH_RATIO} より大きい必要があります
                        </p>
                      )}
                    </div>

                    <CheckRow
                      checked={parameters.hollowBuildings}
                      onChange={(checked) => handleChange('hollowBuildings', checked)}
                      label="建物内部も中空化"
                    />

                    {parameters.hollowBuildings && (
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
                            {Math.max(
                              0,
                              parameters.terrainThickness - parameters.shellThickness,
                            ).toFixed(1)}{' '}
                            mm
                          </span>
                        </div>
                        <p style={flatNoteStyle}>内側にサポート材が必要です</p>
                      </div>
                    )}
                  </div>
                )}

                <CheckRow
                  checked={parameters.splitAtGround}
                  onChange={handleSplitAtGroundChange}
                  label="土台と建物に分割"
                />
                {parameters.splitAtGround && <p style={flatNoteStyle}>底面開口も自動でON</p>}

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <span style={fieldLabelStyle}>地形メッシュ解像度</span>
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
                      style={gridButtonStyle(parameters.terrainGridSize == null)}
                    >
                      自動
                    </button>
                    {TERRAIN_GRID_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => handleChange('terrainGridSize', preset.value)}
                        style={gridButtonStyle(parameters.terrainGridSize === preset.value)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  {parameters.terrainGridSize != null && (
                    <p style={noteStyle}>処理時間が増えます</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </details>
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: 16,
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
        }}
      >
        <button
          data-testid="export-button"
          onClick={onExport}
          style={{
            width: '100%',
            height: 40,
            padding: 0,
            background: 'var(--accent)',
            color: 'var(--accent-ink)',
            border: 'none',
            borderRadius: 'var(--radius-control)',
            fontSize: 14,
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
