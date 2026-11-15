import React from 'react'

interface LoadingOverlayProps {
  message: string
  visible: boolean
  progress?: number
}

function LoadingOverlay({ message, visible, progress }: LoadingOverlayProps) {
  if (!visible) return null

  // 進捗は 0〜100 に丸めてから ARIA とバーの幅に使う。
  const clampedProgress = Math.max(0, Math.min(100, progress ?? 0))

  return (
    <div
      data-testid="loading-overlay"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        color: 'var(--text)',
      }}
    >
      <div className="machimoki-spinner" aria-hidden="true" />
      <p style={{ marginTop: '16px', fontSize: '14px' }}>{message}</p>
      {progress !== undefined && (
        <div
          className="machimoki-loading-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clampedProgress)}
          aria-label="進捗"
        >
          <div
            className="machimoki-loading-progress-fill"
            style={{ width: `${clampedProgress}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default React.memo(LoadingOverlay)
