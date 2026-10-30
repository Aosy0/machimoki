import { useEffect, useRef, type CSSProperties } from 'react'
import { useHasCoarsePointer, useIsCompactLayout } from '../hooks/useMediaQuery'

interface HelpDetailProps {
  mode: 'map' | 'preview'
  isOpen: boolean
  onClose: () => void
}

function mapControls(hasCoarsePointer: boolean): string[] {
  return hasCoarsePointer
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
}

function previewControls(hasCoarsePointer: boolean): string[] {
  return hasCoarsePointer
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
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 4px',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-dim)',
  letterSpacing: '0.04em',
}

const dividerStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  marginTop: '12px',
  paddingTop: '12px',
}

/**
 * 地図・プレビュー共通のヘルプ詳細。下部ヒントのボタンとヘッダーの「?」から
 * 同じ表示面を開く。モバイルではモードバーの上にボトムシートとして出す。
 */
export default function HelpDetail({ mode, isOpen, onClose }: HelpDetailProps) {
  const isCompact = useIsCompactLayout()
  const hasCoarsePointer = useHasCoarsePointer()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus?.()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const controls =
    mode === 'map' ? mapControls(hasCoarsePointer) : previewControls(hasCoarsePointer)
  const containerStyle: CSSProperties = isCompact
    ? {
        position: 'absolute',
        left: 8,
        right: 8,
        bottom:
          mode === 'map'
            ? 'calc(84px + env(safe-area-inset-bottom))'
            : 'calc(16px + env(safe-area-inset-bottom))',
        maxHeight: '66dvh',
        zIndex: 320,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface-solid)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 16,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      }
    : {
        position: 'absolute',
        left: '50%',
        bottom: mode === 'map' ? 80 : 24,
        transform: 'translateX(-50%)',
        width: 360,
        maxHeight: 'calc(100% - 100px)',
        zIndex: 320,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface-solid)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
      }

  return (
    <div
      id="help-detail"
      data-testid="help-detail"
      role="dialog"
      aria-modal="false"
      aria-labelledby="help-detail-title"
      style={containerStyle}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: isCompact ? '12px 14px' : '12px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <h2
          id="help-detail-title"
          style={{ margin: 0, fontSize: isCompact ? 15 : 14, fontWeight: 600 }}
        >
          操作方法
        </h2>
        <button
          ref={closeRef}
          type="button"
          className="help-detail-close"
          onClick={onClose}
          aria-label="操作方法を閉じる"
          data-testid="help-detail-close"
        >
          ×
        </button>
      </div>

      <div
        className="help-detail-body"
        data-testid="help-detail-body"
        style={{
          padding: isCompact ? '12px 14px 28px' : '12px 16px 28px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          minHeight: 0,
          fontSize: isCompact ? '13px' : '12px',
          lineHeight: 1.75,
        }}
      >
        <section>
          <h3 style={sectionTitleStyle}>基本の流れ</h3>
          <ol style={{ margin: '4px 0 0', paddingLeft: '20px' }}>
            <li>地図で範囲を選ぶ</li>
            <li>3Dプレビューで形を確認する</li>
            <li>エクスポートで3MF / STLを保存する</li>
          </ol>
        </section>

        {mode === 'map' && (
          <section style={dividerStyle}>
            <h3 style={sectionTitleStyle}>ボタン</h3>
            <div>移動 / 範囲選択: モードを切り替え</div>
            <div>現在表示: 今の画面範囲をそのまま選択</div>
            <div>
              {isCompact
                ? '座標 / 凡例: モードバーのボタンで開く'
                : '座標 / 凡例: 右下・右上のパネル'}
            </div>
          </section>
        )}

        <section style={dividerStyle}>
          <h3 style={sectionTitleStyle}>
            {mode === 'map' ? 'ジェスチャー / ショートカット' : '3Dプレビューの操作'}
          </h3>
          {controls.map((text) => (
            <div key={text}>{text}</div>
          ))}
          {mode === 'map' && (
            <p
              style={{
                margin: '8px 0 0',
                color: 'var(--text-muted)',
                fontSize: '11px',
                lineHeight: 1.6,
              }}
            >
              ボタンで選んだモードが、PC=左ドラッグ / スマホ=1本指の動作を切り替えます。
              Shift+ドラッグ・長押し・右中ドラッグ・ホイールはモードに関係なく使えます。
            </p>
          )}
        </section>

        <section style={dividerStyle}>
          <h3 style={sectionTitleStyle}>補足</h3>
          <div>選択範囲は自動で長辺150mmになります。</div>
          <div>設定はプレビューと書き出しの両方に反映されます。</div>
          <div>3MFは色を保持できます（推奨）。</div>
        </section>
      </div>
      {(isCompact || mode === 'map') && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            background: 'linear-gradient(to bottom, transparent, var(--surface-solid))',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
