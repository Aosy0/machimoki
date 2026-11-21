import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon'

interface HintProps {
  /** 開いたときに何が出るかを示す名前。「?」だけでは読み上げの名前にならない。 */
  label: string
  /** 理由文の id。押せないコントロールの aria-describedby と揃える。 */
  id?: string
  children: ReactNode
}

/**
 * 押せない理由などを「?」から開く toggletip。
 * ホバーでは開かない（WCAG 1.4.13 の dismissible / hoverable / persistent を自前で満たさずに済む）。
 * 開いた状態は Escape と外側のクリックで閉じる。
 */
export default function Hint({ label, id, children }: HintProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fallbackId = useId()
  const tipId = id ?? fallbackId

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Escape はフォーカスを動かさずに閉じる（開いた本人に戻す）。
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus()
      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <span ref={rootRef} className="ui-hint">
      <button
        ref={buttonRef}
        type="button"
        className="ui-hint__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="help" size={16} />
      </button>
      <span id={tipId} className="ui-hint__tip" role="tooltip" hidden={!open}>
        {children}
      </span>
    </span>
  )
}
