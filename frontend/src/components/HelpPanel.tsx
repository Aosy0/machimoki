import React from 'react'

interface HelpPanelProps {
  mode: 'map' | 'preview' | 'viewer'
  isOpen: boolean
}

const HelpPanel: React.FC<HelpPanelProps> = ({ mode, isOpen }) => {
  const mapControls = [
    '左ドラッグ: 地図移動',
    'ホイール: ズーム',
    'Shift + 左ドラッグ: 範囲選択',
  ]

  const previewControls = [
    '左ドラッグ: 視点回転',
    '右ドラッグ: 平行移動',
    'スクロール: ズーム',
  ]

  const viewerControls = [
    '左ドラッグ: 視点回転',
    '右ドラッグ: 平行移動',
    'スクロール: ズーム',
  ]

  const controls = mode === 'map' ? mapControls : mode === 'viewer' ? viewerControls : previewControls

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        right: '16px',
        zIndex: 300,
        background: 'var(--surface)',
        color: 'var(--text)',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: '12px',
        lineHeight: '1.8',
        maxWidth: '220px',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: '6px',
          fontSize: '12px',
          color: 'var(--text-dim)',
          letterSpacing: '0.04em',
        }}
      >
        操作方法
      </div>
      {controls.map((text, i) => (
        <div key={i}>{text}</div>
      ))}
    </div>
  )
}

export default HelpPanel
