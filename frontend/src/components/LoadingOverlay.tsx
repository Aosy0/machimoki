import React from 'react'

interface LoadingOverlayProps {
  message: string
  visible: boolean
  progress?: number
}

const MONO_FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", monospace'

function LoadingOverlay({ message, visible, progress }: LoadingOverlayProps) {
  if (!visible) return null

  // 進捗は 0〜100 に丸めてから ARIA とバーの幅に使う。
  const clampedProgress = Math.max(0, Math.min(100, progress ?? 0))
  const hasProgress = progress !== undefined

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
      {hasProgress ? (
        <>
          <div
            aria-hidden="true"
            style={{
              fontFamily: MONO_FONT,
              fontVariantNumeric: 'tabular-nums',
              fontSize: '24px',
              fontWeight: 500,
              lineHeight: 1,
            }}
          >
            {Math.round(clampedProgress)}%
          </div>
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
        </>
      ) : (
        <div className="machimoki-spinner" aria-hidden="true" />
      )}
      <p style={{ margin: '16px 0 0', fontSize: '14px' }}>{message}</p>
    </div>
  )
}

export default React.memo(LoadingOverlay)
