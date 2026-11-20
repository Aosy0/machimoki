import type { CSSProperties, ReactElement } from 'react'

/** 線アイコン。16px・stroke 1.5・currentColor で統一する。 */
export type IconName =
  | 'help'
  | 'close'
  | 'plus'
  | 'minus'
  | 'chevron-down'
  | 'chevron-right'
  | 'search'
  | 'warning'
  | 'reset'

export interface IconProps {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const glyphs: Record<IconName, ReactElement> = {
  help: (
    <>
      <circle cx="8" cy="8" r="6.25" {...stroke} />
      <path d="M6.3 6.15a1.85 1.85 0 1 1 2.35 1.78c-.45.16-.65.5-.65 1v.35" {...stroke} />
      <circle cx="8" cy="11.5" r="0.85" fill="currentColor" />
    </>
  ),
  close: <path d="M4.5 4.5l7 7m0-7l-7 7" {...stroke} />,
  plus: <path d="M8 3.75v8.5M3.75 8h8.5" {...stroke} />,
  minus: <path d="M3.75 8h8.5" {...stroke} />,
  'chevron-down': <path d="M4.25 6.5L8 10.25l3.75-3.75" {...stroke} />,
  'chevron-right': <path d="M6.5 4.25L10.25 8 6.5 11.75" {...stroke} />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" {...stroke} />
      <path d="M10.25 10.25L13.5 13.5" {...stroke} />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.75l5.5 10.5H2.5L8 2.75z" {...stroke} />
      <path d="M8 6.5v3.25" {...stroke} />
      <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
    </>
  ),
  reset: (
    <>
      <path d="M13 8a5 5 0 1 1-1.6-3.67" {...stroke} />
      <path d="M13.25 3.25v3.5h-3.5" {...stroke} />
    </>
  ),
}

export default function Icon({ name, size = 16, className, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name]}
    </svg>
  )
}
