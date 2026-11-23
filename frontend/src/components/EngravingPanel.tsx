import React, { useEffect, useMemo, useState } from 'react'
import type {
  EngravingAlign,
  EngravingFace,
  EngravingFaceDims,
  EngravingOptions,
} from '../../../core/src/engraving/types.ts'
import {
  ENGRAVING_ALIGNS,
  ENGRAVING_FACES,
  engravingMaxDepthMm,
} from '../../../core/src/engraving/types.ts'
import { autoFitEngraving, layoutEngraving } from '../../../core/src/engraving/layout.ts'
import type { EngravingFont } from '../../../core/src/engraving/font.ts'
import { loadEngravingFont } from '../lib/engravingFontClient'
import {
  ENGRAVING_CONTENT_DEFS,
  type EngravingContentDef,
  mergeAutoLines,
} from '../lib/engravingContent'
import {
  addContentLine,
  editorWarnings,
  removeContentLine,
  updateLineSize,
  updateLineText,
} from '../lib/engravingEditor'
import { buildGlyphPathMap } from '../lib/engravingSvg'
import Icon from './ui/Icon'

export interface EngravingPanelProps {
  /** 下書きの刻印設定（反映前） */
  options: EngravingOptions
  /** computeEngravingFaceDims の結果 */
  faces: EngravingFaceDims[]
  /** 自動計算される刻印テキスト（place/coords/mesh/scale/attribution/date） */
  autoTexts: Record<string, string>
  /** 選択範囲の地名（未取得は null） */
  placeName: string | null
  busy: boolean
  /** 下書きが適用済みの設定と一致している */
  applied: boolean
  isCompact?: boolean
  onChange: (next: EngravingOptions) => void
  onApply: () => void
  onDisable: () => void
  onClose?: () => void
}

const FACE_LABELS: Record<EngravingFace, string> = {
  bottom: '底面',
  south: '南',
  north: '北',
  east: '東',
  west: '西',
}

const ALIGN_LABELS: Record<EngravingAlign, string> = {
  left: '左',
  center: '中央',
  right: '右',
}

/** 0.1mm 単位に丸めた表示用の数値（末尾の .0 は落とす）。 */
function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10)
}

interface NumberInputProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  testId?: string
  title?: string
  style?: React.CSSProperties
}

/**
 * 数値入力。入力途中の文字列を保持し、数値として確定できた時だけ onChange する
 * （「4.」「0.」のような途中入力を value の書き戻しで壊さない）。
 * 範囲外の値は入力中には反映せず、blur 時にクランプして確定する。
 */
function NumberInput({ value, min, max, step, onChange, testId, title, style }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const handleChange = (text: string) => {
    setDraft(text)
    if (text.trim() === '') return
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return
    if (parsed < min || parsed > max) return
    if (parsed !== value) onChange(parsed)
  }

  const handleBlur = () => {
    const parsed = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    if (clamped !== value) onChange(clamped)
    setDraft(String(clamped))
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      data-testid={testId}
      title={title}
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      style={{ ...inputStyle, ...style }}
    />
  )
}

function EngravingPanel({
  options,
  faces,
  autoTexts,
  placeName,
  busy,
  applied,
  isCompact = false,
  onChange,
  onApply,
  onDisable,
  onClose,
}: EngravingPanelProps) {
  const [font, setFont] = useState<EngravingFont | null>(null)
  const [fontError, setFontError] = useState<string | null>(null)
  const [fontAttempt, setFontAttempt] = useState(0)

  // 刻印フォント（M PLUS 1p Bold）をマウント時に読み込む。
  useEffect(() => {
    let cancelled = false
    setFontError(null)
    loadEngravingFont()
      .then((loaded) => {
        if (!cancelled) setFont(loaded)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFontError(
            error instanceof Error ? error.message : '刻印フォントを読み込めませんでした',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [fontAttempt])

  const faceDims = useMemo(
    () => faces.find((candidate) => candidate.face === options.face) ?? null,
    [faces, options.face],
  )
  const layout = useMemo(
    () => (font && faceDims ? layoutEngraving(faceDims, options, font) : null),
    [font, faceDims, options],
  )
  const warnings = useMemo(
    () => (layout && faceDims ? editorWarnings(layout, faceDims, options) : []),
    [layout, faceDims, options],
  )
  const maxDepthMm = faceDims ? engravingMaxDepthMm(faceDims) : Number.POSITIVE_INFINITY

  // autoTexts（座標・縮尺など）の変化を auto:true の行だけに反映する。
  useEffect(() => {
    const merged = mergeAutoLines(options.lines, autoTexts)
    if (merged !== options.lines) onChange({ ...options, lines: merged })
  }, [autoTexts, options, onChange])

  // 文字が変わったときだけグリフ輪郭を作り直す。
  const glyphPaths = useMemo(
    () => (font && layout ? buildGlyphPathMap(font, layout) : new Map<string, string>()),
    [font, layout],
  )

  const handleFaceChange = (face: EngravingFace) => {
    if (face === options.face) return
    onChange({ ...options, face })
  }

  const handleAlignChange = (align: EngravingAlign) => {
    if (align === options.align) return
    onChange({ ...options, align })
  }

  const handleContentToggle = (def: EngravingContentDef, checked: boolean) => {
    onChange(checked ? addContentLine(options, def, autoTexts) : removeContentLine(options, def.id))
  }

  const handleAutoFit = () => {
    if (!font || !faceDims) return
    onChange(autoFitEngraving(faceDims, options, font))
  }

  const overflows =
    layout !== null && (layout.overflowX || layout.overflowY || layout.unsupportedChars.length > 0)
  const canApply =
    !busy &&
    font !== null &&
    layout !== null &&
    faceDims !== null &&
    faceDims.available &&
    layout.fits &&
    layout.unsupportedChars.length === 0
  const canAutoFit = !busy && font !== null && layout !== null && faceDims?.available === true

  return (
    <div
      data-testid="engraving-panel"
      style={{
        width: isCompact ? '100%' : '340px',
        minWidth: isCompact ? 0 : '340px',
        maxHeight: isCompact ? '74dvh' : 'calc(100dvh - 32px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface)',
        color: 'var(--text)',
      }}
    >
      {/* ヘッダー */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 500 }}>刻印</span>
        {onClose && (
          <button
            type="button"
            data-testid="engraving-close"
            onClick={onClose}
            aria-label="刻印パネルを閉じる"
            style={closeButtonStyle}
          >
            <Icon name="close" />
          </button>
        )}
      </div>

      <div
        style={{
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* 面選択 */}
        <div>
          <span style={labelStyle}>刻印する面</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
            {ENGRAVING_FACES.map((face) => {
              const dims = faces.find((candidate) => candidate.face === face)
              const available = dims?.available === true
              const active = options.face === face
              return (
                <button
                  key={face}
                  type="button"
                  data-testid={`engraving-face-${face}`}
                  onClick={() => handleFaceChange(face)}
                  disabled={!available}
                  aria-label={
                    dims
                      ? `${FACE_LABELS[face]} ${formatMm(dims.widthMm)} × ${formatMm(dims.heightMm)} mm`
                      : FACE_LABELS[face]
                  }
                  title={dims?.unavailableReason ?? undefined}
                  style={{
                    minHeight: 32,
                    padding: '8px 0',
                    fontSize: '12px',
                    borderRadius: 'var(--radius-control)',
                    background: active ? 'var(--border-strong)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-dim)',
                    border: '1px solid var(--border-strong)',
                    fontWeight: active ? 500 : 400,
                    cursor: available ? 'pointer' : 'not-allowed',
                    opacity: available ? 1 : 0.4,
                  }}
                >
                  {FACE_LABELS[face]}
                </button>
              )
            })}
          </div>
        </div>

        {/* プレビュー */}
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            <span style={{ ...labelStyle, marginBottom: 0 }}>面のレイアウト</span>
            <div style={{ display: 'flex', gap: '2px' }}>
              {ENGRAVING_ALIGNS.map((align) => {
                const active = options.align === align
                return (
                  <button
                    key={align}
                    type="button"
                    data-testid={`engraving-align-${align}`}
                    onClick={() => handleAlignChange(align)}
                    aria-pressed={active}
                    style={{
                      minHeight: 28,
                      minWidth: 32,
                      padding: '4px 8px',
                      fontSize: '12px',
                      borderRadius: 'var(--radius-control)',
                      background: active ? 'var(--border-strong)' : 'transparent',
                      color: active ? 'var(--text)' : 'var(--text-dim)',
                      border: '1px solid var(--border-strong)',
                      fontWeight: active ? 500 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {ALIGN_LABELS[align]}
                  </button>
                )
              })}
            </div>
          </div>
          {fontError ? (
            <div
              style={{
                padding: '12px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-strong)',
                background: 'var(--border)',
                fontSize: '12px',
                color: 'var(--error)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <span>{fontError}</span>
              <button
                type="button"
                onClick={() => setFontAttempt((attempt) => attempt + 1)}
                style={{ ...secondaryButtonStyle, padding: '8px' }}
              >
                再読み込み
              </button>
            </div>
          ) : !font || !layout || !faceDims ? (
            <div
              style={{
                padding: '24px 12px',
                borderRadius: 'var(--radius-control)',
                border: '1px dashed var(--border-strong)',
                fontSize: '12px',
                color: 'var(--text-dim)',
                textAlign: 'center',
              }}
            >
              刻印フォントを読み込み中…
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <svg
                data-testid="engraving-preview"
                role="img"
                aria-label="刻印プレビュー"
                viewBox={`0 0 ${layout.faceWidthMm} ${layout.faceHeightMm}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                  display: 'block',
                  width: '100%',
                  height: 'auto',
                  minHeight: '96px',
                  maxHeight: '220px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-panel)',
                }}
              >
                {/* 面（クリック/ドラッグの当たり判定も兼ねる） */}
                <rect
                  x={0}
                  y={0}
                  width={layout.faceWidthMm}
                  height={layout.faceHeightMm}
                  fill={overflows ? 'rgba(229, 57, 53, 0.08)' : 'rgba(255, 255, 255, 0.02)'}
                  stroke={overflows ? 'var(--error)' : 'var(--border-strong)'}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
                {/* 使用可能領域 */}
                <rect
                  x={layout.usable.x}
                  y={layout.faceHeightMm - (layout.usable.y + layout.usable.height)}
                  width={layout.usable.width}
                  height={layout.usable.height}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  strokeOpacity={0.7}
                  vectorEffect="non-scaling-stroke"
                />
                {/* グリフ輪郭（em 座標を面ローカルmmへ変換） */}
                {layout.lines.map((line, lineIndex) =>
                  line.glyphs.map((glyph, glyphIndex) => {
                    const data = glyphPaths.get(glyph.char)
                    if (!data) return null
                    return (
                      <g
                        key={`${lineIndex}-${glyphIndex}`}
                        transform={`translate(${line.x + glyph.x} ${
                          layout.faceHeightMm - line.baselineY
                        }) scale(${line.sizeMm} ${-line.sizeMm})`}
                      >
                        <path d={data} fill="var(--text)" fillOpacity={0.85} fillRule="nonzero" />
                      </g>
                    )
                  }),
                )}
              </svg>
              {layout.lines.length === 0 && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: 'var(--text-dim)',
                    pointerEvents: 'none',
                    textAlign: 'center',
                    padding: '0 12px',
                  }}
                >
                  刻印する内容を選んでください
                </span>
              )}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div>
          <span style={labelStyle}>刻印する内容</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {ENGRAVING_CONTENT_DEFS.map((def) => {
              const line = options.lines.find((candidate) => candidate.id === def.id)
              return (
                <div key={def.id}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid={`engraving-content-${def.id}`}
                      checked={line !== undefined}
                      onChange={(event) => handleContentToggle(def, event.target.checked)}
                    />
                    <span style={{ fontSize: '13px', flex: 1 }}>{def.label}</span>
                    {line?.auto === true && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>自動</span>
                    )}
                  </label>
                  {line && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        marginTop: '4px',
                      }}
                    >
                      {def.multiline ? (
                        <textarea
                          data-testid={`engraving-text-${def.id}`}
                          value={line.text}
                          rows={2}
                          onChange={(event) =>
                            onChange(updateLineText(options, def.id, event.target.value))
                          }
                          style={{
                            ...inputStyle,
                            flex: 1,
                            minHeight: '44px',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                          }}
                        />
                      ) : (
                        <input
                          type="text"
                          data-testid={`engraving-text-${def.id}`}
                          value={line.text}
                          onChange={(event) =>
                            onChange(updateLineText(options, def.id, event.target.value))
                          }
                          placeholder={def.id === 'place' ? (placeName ?? '') : undefined}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      )}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          width: '96px',
                          flexShrink: 0,
                        }}
                      >
                        <NumberInput
                          value={line.sizeMm}
                          min={0.5}
                          max={50}
                          step={0.5}
                          testId={`engraving-size-${def.id}`}
                          onChange={(value) => onChange(updateLineSize(options, def.id, value))}
                          style={numberStyle}
                        />
                        <span style={unitStyle}>mm</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 印刷設定 */}
        <div>
          <span style={labelStyle}>印刷設定</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <span style={fieldLabelStyle}>ノズル径</span>
              <div style={numberRowStyle}>
                <NumberInput
                  value={options.printProfile.nozzleMm}
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  testId="engraving-nozzle"
                  onChange={(value) =>
                    onChange({
                      ...options,
                      printProfile: { ...options.printProfile, nozzleMm: value },
                    })
                  }
                  style={numberStyle}
                />
                <span style={unitStyle}>mm</span>
              </div>
            </div>
            <div>
              <span style={fieldLabelStyle}>積層ピッチ</span>
              <div style={numberRowStyle}>
                <NumberInput
                  value={options.printProfile.layerHeightMm}
                  min={0.05}
                  max={1}
                  step={0.05}
                  testId="engraving-layer"
                  onChange={(value) =>
                    onChange({
                      ...options,
                      printProfile: { ...options.printProfile, layerHeightMm: value },
                    })
                  }
                  style={numberStyle}
                />
                <span style={unitStyle}>mm</span>
              </div>
            </div>
            <div>
              <span style={fieldLabelStyle}>刻印深さ</span>
              <div style={numberRowStyle}>
                <NumberInput
                  value={options.depthMm}
                  min={0.05}
                  max={10}
                  step={0.05}
                  testId="engraving-depth"
                  title={
                    Number.isFinite(maxDepthMm)
                      ? `この面の最大 ${formatMm(maxDepthMm)} mm`
                      : undefined
                  }
                  onChange={(value) => onChange({ ...options, depthMm: value })}
                  style={numberStyle}
                />
                <span style={unitStyle}>mm</span>
              </div>
            </div>
            <div>
              <span style={fieldLabelStyle}>行間</span>
              <div style={numberRowStyle}>
                <NumberInput
                  value={options.lineGapMm}
                  min={0}
                  max={10}
                  step={0.1}
                  testId="engraving-line-gap"
                  onChange={(value) => onChange({ ...options, lineGapMm: value })}
                  style={numberStyle}
                />
                <span style={unitStyle}>mm</span>
              </div>
            </div>
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            <input
              type="checkbox"
              data-testid="engraving-wrap"
              checked={options.wrap}
              onChange={(event) => onChange({ ...options, wrap: event.target.checked })}
            />
            <span style={{ fontSize: '13px' }}>折り返す</span>
          </label>
        </div>

        {/* 警告 */}
        {warnings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {warnings.map((warning, index) => (
              <div
                key={`${warning.level}-${index}`}
                data-testid="engraving-warning"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '4px',
                  fontSize: '12px',
                  lineHeight: 1.4,
                  color: warning.level === 'error' ? 'var(--error)' : 'var(--warn)',
                }}
              >
                <Icon name="warning" style={{ flexShrink: 0 }} />
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* フッター */}
      <div
        style={{
          padding: '12px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <button
            type="button"
            data-testid="engraving-autofit"
            onClick={handleAutoFit}
            disabled={!canAutoFit}
            style={{
              ...secondaryButtonStyle,
              opacity: canAutoFit ? 1 : 0.5,
              cursor: canAutoFit ? 'pointer' : 'not-allowed',
            }}
          >
            自動調整
          </button>
          <button
            type="button"
            data-testid="engraving-apply"
            onClick={onApply}
            disabled={!canApply}
            style={{
              minHeight: 32,
              padding: '8px',
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--border-strong)',
              background: 'var(--border-strong)',
              color: 'var(--text)',
              fontSize: '13px',
              fontWeight: 500,
              cursor: canApply ? 'pointer' : 'not-allowed',
              opacity: canApply ? 1 : 0.5,
            }}
          >
            {busy ? '反映中…' : '反映'}
          </button>
        </div>
        <button
          type="button"
          data-testid="engraving-disable"
          onClick={onDisable}
          disabled={busy}
          style={{
            minHeight: 32,
            padding: '8px',
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border-strong)',
            background: 'transparent',
            color: 'var(--text-dim)',
            fontSize: '12px',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}
        >
          {applied ? '刻印モードを終了' : '変更を破棄して終了'}
        </button>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: 'var(--text-dim)',
  marginBottom: '8px',
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: 'var(--text-dim)',
  marginBottom: '4px',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  fontSize: '13px',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-control)',
}

const numberStyle: React.CSSProperties = {
  flex: 1,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
}

const numberRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
}

const unitStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '24px',
  fontSize: '12px',
  color: 'var(--text-dim)',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '8px',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--border-strong)',
  background: 'var(--border)',
  color: 'var(--text)',
  fontSize: '13px',
  fontWeight: 500,
}

const closeButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--border-strong)',
  background: 'transparent',
  color: 'var(--text-dim)',
  cursor: 'pointer',
}

export default React.memo(EngravingPanel)
