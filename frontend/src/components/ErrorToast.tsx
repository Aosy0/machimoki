import React from 'react'

interface ErrorToastProps {
  message: string | null
  onRetry?: () => void
  onDismiss?: () => void
}

function ErrorToast({ message, onRetry, onDismiss }: ErrorToastProps) {
  if (!message) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--error)',
        color: 'var(--text)',
        padding: '12px 20px',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 1001,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        fontSize: '14px',
        maxWidth: '80%',
      }}
    >
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: 'transparent',
            border: '1px solid var(--text)',
            color: 'var(--text)',
            padding: '4px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          再試行
        </button>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

export default React.memo(ErrorToast)
