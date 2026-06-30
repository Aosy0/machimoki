import React from 'react'

interface LoadingOverlayProps {
  message: string
  visible: boolean
}

function LoadingOverlay({ message, visible }: LoadingOverlayProps) {
  if (!visible) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        color: '#fff',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          border: '4px solid #333',
          borderTop: '4px solid #00bcd4',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <p style={{ marginTop: '16px', fontSize: '14px' }}>{message}</p>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default React.memo(LoadingOverlay)
