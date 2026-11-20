import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import Icon from './ui/Icon'
import { useHasCoarsePointer, useIsCompactLayout } from '../hooks/useMediaQuery'

interface HelpDetailProps {
  mode: 'map' | 'preview'
  isOpen: boolean
  onClose: () => void
}

interface ControlRow {
  action: ReactNode
  effect: string
}

const kbdStyle: CSSProperties = {
  display: 'inline-block',
  padding: '0 4px',
  fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", monospace',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--text)',
  background: 'var(--border)',
  border: '1px solid var(--border-strong)',
  borderBottomWidth: '2px',
  borderRadius: 'var(--radius-control)',
  whiteSpace: 'nowrap',
}

function mapControls(hasCoarsePointer: boolean): ControlRow[] {
  return hasCoarsePointer
    ? [
        { action: '1本指ドラッグ', effect: '地図移動' },
        { action: '2本指ドラッグ', effect: '移動＋拡大' },
        { action: '1本指長押し＋ドラッグ', effect: '範囲選択' },
        { action: '矩形の辺・角', effect: 'サイズ変更' },
        { action: '範囲選択モード', effect: '1本指で矩形' },
      ]
    : [
        { action: '左ドラッグ', effect: '地図移動' },
        { action: 'ホイール', effect: '拡大' },
        {
          action: (
            <>
              <kbd style={kbdStyle}>Shift</kbd>＋左ドラッグ
            </>
          ),
          effect: '範囲選択',
        },
        { action: '右・中ドラッグ', effect: '地図移動' },
        { action: '矩形の辺・角', effect: 'サイズ変更' },
        { action: '範囲選択モード', effect: '左ドラッグで矩形' },
      ]
}

function previewControls(hasCoarsePointer: boolean): ControlRow[] {
  return hasCoarsePointer
    ? [
        { action: '1本指ドラッグ', effect: '視点移動' },
        { action: '2本指ドラッグ', effect: '拡大・縮小' },
        { action: '建物をタップ', effect: '削除' },
        { action: '「元に戻す」', effect: '削除の取り消し' },
      ]
    : [
        { action: '左ドラッグ', effect: '視点移動' },
        { action: '右ドラッグ・ホイール', effect: 'ズーム' },
        {
          action: (
            <>
              中ドラッグ・<kbd style={kbdStyle}>Ctrl</kbd>＋ドラッグ
            </>
          ),
          effect: '傾き',
        },
        {
          action: (
            <>
              <kbd style={kbdStyle}>Shift</kbd>＋左ドラッグ
            </>
          ),
          effect: '見回し',
        },
      ]
}

const sectionTitleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--text-dim)',
}

const controlsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content 1fr',
  columnGap: '16px',
  rowGap: '4px',
  alignItems: 'baseline',
  fontSize: '13px',
}

const actionStyle: CSSProperties = {
  color: 'var(--text-dim)',
}

const effectStyle: CSSProperties = {
  color: 'var(--text)',
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
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
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
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
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
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <h2 id="help-detail-title" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
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
          <Icon name="close" size={16} />
        </button>
      </div>

      <div
        className="help-detail-body"
        data-testid="help-detail-body"
        style={{
          padding: '12px 16px 16px',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          minHeight: 0,
          fontSize: '13px',
          lineHeight: 1.7,
        }}
      >
        <section>
          <h3 style={sectionTitleStyle}>操作</h3>
          <div style={controlsStyle}>
            {controls.map((row, index) => (
              <Fragment key={index}>
                <div style={actionStyle}>{row.action}</div>
                <div style={effectStyle}>{row.effect}</div>
              </Fragment>
            ))}
          </div>
        </section>

        <section style={{ marginTop: '16px' }}>
          <h3 style={sectionTitleStyle}>書き出し</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>初期スケールは最大辺 150 mm</div>
            <div>3MF は色を保持（STL は不可）</div>
            <div>地形を含めないと刻印できない</div>
          </div>
          <p style={{ margin: '12px 0 0' }}>
            <a href="/guide/" target="_blank" rel="noreferrer">
              3Dプリントの手順ガイド
            </a>
            {' / '}
            <a href="/faq/" target="_blank" rel="noreferrer">
              よくある質問
            </a>
            {' / '}
            <a href="/plateau-3dprint/" target="_blank" rel="noreferrer">
              このサイトについて
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
