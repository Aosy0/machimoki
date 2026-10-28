import React from 'react'
import { useHasCoarsePointer, useIsCompactLayout } from '../hooks/useMediaQuery'

interface HelpPanelProps {
  mode: 'map' | 'preview'
  isOpen: boolean
}

const HelpPanel: React.FC<HelpPanelProps> = ({ mode, isOpen }) => {
  const isCompact = useIsCompactLayout()
  const hasCoarsePointer = useHasCoarsePointer()

  const mapControls = hasCoarsePointer
    ? [
        '1本指ドラッグ: 地図移動',
        '2本指ドラッグ: 移動＋拡大',
        '1本指長押し→ドラッグ: 範囲選択',
        '矩形の辺・角: サイズ変更',
        '範囲選択モード: 1本指で矩形',
      ]
    : [
        '左ドラッグ: 地図移動',
        'ホイール: 拡大',
        'Shift + 左ドラッグ: 範囲選択',
        '右 / 中ドラッグ: 地図移動',
        '矩形の辺・角: サイズ変更',
        '範囲選択モード: 左ドラッグで矩形',
      ]

  const previewControls = hasCoarsePointer
    ? [
        '1本指ドラッグ: 視点移動',
        '2本指ドラッグ: 拡大・縮小',
        '建物をタップ: 削除',
        '「元に戻す」: 削除の取り消し',
      ]
    : [
        '左ドラッグ: 視点移動',
        '右ドラッグ / ホイール: ズーム',
        '中 / Ctrl + ドラッグ: 傾き',
        'Shift + 左ドラッグ: 見回し',
      ]

  const controls = mode === 'map' ? mapControls : previewControls

  if (!isOpen) return null

  return (
    <div
      data-testid="help-panel"
      style={{
        position: 'absolute',
        top: isCompact ? '8px' : '12px',
        right: isCompact ? '8px' : '16px',
        left: isCompact ? '8px' : undefined,
        zIndex: 300,
        background: 'var(--surface)',
        color: 'var(--text)',
        padding: '12px 16px',
        borderRadius: '8px',
        fontSize: isCompact ? '13px' : '12px',
        lineHeight: '1.8',
        maxWidth: isCompact ? 'none' : '240px',
        maxHeight: isCompact ? '62dvh' : undefined,
        overflowY: isCompact ? 'auto' : undefined,
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
      {mode === 'map' && (
        <div
          style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '11px',
            lineHeight: 1.6,
          }}
        >
          モードで変わるのはPC=左クリック / スマホ=1本指のみ。
          2本指・右中ドラッグ・ホイールは共通です。
        </div>
      )}
    </div>
  )
}

export default HelpPanel
