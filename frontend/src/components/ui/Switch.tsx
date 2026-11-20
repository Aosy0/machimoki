import type { CSSProperties } from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  testId?: string
  /** ラベルをスイッチの左（行頭）に置くか、右に置くか。 */
  labelFirst?: boolean
}

const TRACK_WIDTH = 44
const TRACK_HEIGHT = 20
const THUMB_SIZE = 14
const THUMB_OFFSET = 3

const trackStyle = (checked: boolean, disabled: boolean): CSSProperties => ({
  position: 'relative',
  width: TRACK_WIDTH,
  height: TRACK_HEIGHT,
  flexShrink: 0,
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-control)',
  border: `1px solid ${checked || !disabled ? 'var(--border-strong)' : 'var(--border)'}`,
  background: checked ? 'var(--border-strong)' : disabled ? 'var(--bg)' : 'var(--surface-solid)',
  transition: 'background-color 150ms ease, border-color 150ms ease',
})

const thumbStyle = (checked: boolean, disabled: boolean): CSSProperties => ({
  position: 'absolute',
  top: THUMB_OFFSET,
  left: THUMB_OFFSET,
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  borderRadius: 'var(--radius-control)',
  background: disabled ? 'var(--text-muted)' : checked ? 'var(--text)' : 'var(--text-dim)',
  transform: `translateX(${checked ? TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET * 2 - 2 : 0}px)`,
  transition: 'transform 150ms ease, background-color 150ms ease',
})

/** ON と OFF の差が面とつまみの位置で読めるスイッチ。設定と凡例で共有する。 */
export default function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  testId,
  labelFirst = false,
}: SwitchProps) {
  const track = (
    <span aria-hidden style={trackStyle(checked, disabled)}>
      <span style={thumbStyle(checked, disabled)} />
    </span>
  )
  const text = <span>{label}</span>

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: labelFirst ? 'space-between' : 'flex-start',
        gap: 8,
        width: '100%',
        height: 32,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: disabled ? 'var(--text-dim)' : 'var(--text)',
        fontSize: 14,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {labelFirst ? (
        <>
          {text}
          {track}
        </>
      ) : (
        <>
          {track}
          {text}
        </>
      )}
    </button>
  )
}
