import React from 'react'
import Icon from './ui/Icon'

interface ErrorToastProps {
  message: string | null
  onRetry?: () => void
  onDismiss?: () => void
}

function ErrorToast({ message, onRetry, onDismiss }: ErrorToastProps) {
  if (!message) return null

  return (
    <div
      role="alert"
      aria-atomic="true"
      style={{
        position: 'absolute',
        top: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--surface-solid)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        padding: '12px 16px',
        borderRadius: 'var(--radius-panel)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 1001,
        fontSize: '13px',
        maxWidth: '80%',
      }}
    >
      <span
        aria-hidden="true"
        style={{ display: 'flex', flexShrink: 0, color: 'var(--error)' }}
      >
        <Icon name="warning" size={16} />
      </span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            height: '32px',
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            color: 'var(--text)',
            padding: '0 12px',
            borderRadius: 'var(--radius-control)',
            cursor: 'pointer',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          再試行
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="エラーを閉じる"
          onClick={onDismiss}
          style={{
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-control)',
            flexShrink: 0,
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  )
}

export default React.memo(ErrorToast)
