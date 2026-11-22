import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import { useIsCompactLayout } from '../hooks/useMediaQuery'
import Icon from './ui/Icon'

export interface BuildingListItem {
  id: string
  height: string | null
  usage: string | null
}

export interface BuildingListPanelProps {
  items: BuildingListItem[]
  excludedIds: string[]
  listLoading: boolean
  loadingProgress?: number | null
  onExclude: (id: string) => void
  onRestore: (id: string) => void
  onHoverItem: (id: string | null) => void
  /** 3Dビュー側でカーソルが合っている建物ID。一覧側の行を外部ハイライトする。 */
  hoveredId?: string | null
}

interface RowData {
  items: BuildingListItem[]
  excludedSet: Set<string>
  onExclude: (id: string) => void
  onRestore: (id: string) => void
  onHoverItem: (id: string | null) => void
  hoveredId: string | null
  compact: boolean
}

// 行高は通常32px・compact 36px。中のボタンは通常24px・compact 28px。
const ITEM_SIZE = 32
const MAX_LIST_HEIGHT = 360
// 高さの列幅。数値の桁数が変わっても行頭が揃うよう固定する。
const HEIGHT_COLUMN_WIDTH = 56

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 15)}…` : id
}

const Row = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const item = data.items[index]
  const excluded = data.excludedSet.has(item.id)
  // 3Dビュー由来のハイライト。行自身の :hover より優先する（CSS 側で後勝ち）。
  const externallyHovered = data.hoveredId === item.id
  return (
    <div
      className={externallyHovered ? 'building-row building-row--external' : 'building-row'}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 8px',
        borderBottom: '1px solid var(--border)',
      }}
      onMouseEnter={() => data.onHoverItem(item.id)}
      onMouseLeave={() => data.onHoverItem(null)}
    >
      <span
        title={item.id}
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          textDecoration: excluded ? 'line-through' : 'none',
          color: excluded ? 'var(--text-dim)' : 'var(--text)',
        }}
      >
        {shortId(item.id)}
      </span>
      <span
        style={{
          flexShrink: 0,
          width: `${HEIGHT_COLUMN_WIDTH}px`,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'ui-monospace, "SF Mono", monospace',
          color: excluded ? 'var(--text-muted)' : 'var(--text-dim)',
        }}
      >
        {item.height ? `${item.height} m` : ''}
      </span>
      <button
        type="button"
        aria-label={`${item.id} を${excluded ? '戻す' : '除外'}`}
        onClick={() => (excluded ? data.onRestore(item.id) : data.onExclude(item.id))}
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          height: data.compact ? 28 : 24,
          padding: '0 8px',
          fontSize: '12px',
          fontWeight: 500,
          lineHeight: 1,
          cursor: 'pointer',
          borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border-strong)',
          background: 'rgba(255, 255, 255, 0.04)',
          color: excluded ? 'var(--text)' : 'var(--text-dim)',
        }}
      >
        {excluded && <Icon name="reset" size={14} />}
        {excluded ? '戻す' : '除外'}
      </button>
    </div>
  )
})
Row.displayName = 'BuildingListRow'

export default function BuildingListPanel({
  items,
  excludedIds,
  listLoading,
  loadingProgress,
  onExclude,
  onRestore,
  onHoverItem,
  hoveredId = null,
}: BuildingListPanelProps) {
  const [filter, setFilter] = useState('')
  // 開閉ボタンと一覧の対応を支援技術に伝えるための ID。
  const listId = useId()
  const isCompact = useIsCompactLayout()
  const [open, setOpen] = useState(!isCompact)
  const itemSize = isCompact ? 36 : ITEM_SIZE

  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds])
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.id.toLowerCase().includes(q))
  }, [items, filter])

  const itemData = useMemo<RowData>(
    () => ({
      items: filtered,
      excludedSet,
      onExclude,
      onRestore,
      onHoverItem,
      hoveredId,
      compact: isCompact,
    }),
    [filtered, excludedSet, onExclude, onRestore, onHoverItem, hoveredId, isCompact],
  )

  const listHeight = filtered.length > 0 ? Math.min(MAX_LIST_HEIGHT, filtered.length * itemSize) : 0

  const listRef = useRef<FixedSizeList<RowData>>(null)
  // hoveredId が変わったときだけスクロールする。毎レンダーでは呼ばない。
  // filtered も依存に入れるのは、絞り込みで index が変わったときに古い位置へ飛ばさないため。
  useEffect(() => {
    if (!hoveredId) return
    const index = filtered.findIndex((item) => item.id === hoveredId)
    if (index < 0) return
    listRef.current?.scrollToItem(index, 'smart')
  }, [hoveredId, filtered])

  // 読み込み中はヘッダー（と進捗）だけを出す。0件で確定したときだけ消す。
  if (items.length === 0 && !listLoading) return null

  return (
    <div
      data-overlay-zone="building-list"
      style={{
        position: 'absolute',
        top: isCompact ? '160px' : '52px',
        left: '16px',
        zIndex: 10,
        width: 'min(264px, calc(100vw - 32px))',
        maxHeight: open ? (isCompact ? '38dvh' : 'calc(100% - 160px)') : 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-panel)',
        fontSize: '12px',
        backdropFilter: 'blur(4px)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'relative',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          overflow: 'hidden',
        }}
      >
        {listLoading && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '2px',
              background: 'var(--accent)',
              opacity: 0.6,
              transform: `scaleX(${
                loadingProgress != null ? Math.max(0, Math.min(100, loadingProgress)) / 100 : 0.35
              })`,
              transformOrigin: 'left center',
              transition: 'transform 150ms',
              pointerEvents: 'none',
            }}
          />
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            width: '100%',
            cursor: 'pointer',
            color: 'var(--text)',
            fontSize: '12px',
            fontWeight: 500,
            textAlign: 'left',
          }}
        >
          <Icon
            name={open ? 'chevron-down' : 'chevron-right'}
            size={16}
            style={{ color: 'var(--text-dim)', flexShrink: 0 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>建物一覧</span>
          {!listLoading && (
            <span style={{ color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
              {items.length}
            </span>
          )}
        </button>
      </div>
      {open && (
        <div id={listId} style={{ display: 'contents' }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              aria-label="建物IDで絞り込み"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="IDで絞り込み"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 8px',
                fontSize: '12px',
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-control)',
              }}
            />
          </div>
          {listHeight > 0 ? (
            <FixedSizeList
              ref={listRef}
              height={listHeight}
              width="100%"
              itemCount={filtered.length}
              itemSize={itemSize}
              itemData={itemData}
              itemKey={(index, data) => data.items[index].id}
            >
              {Row}
            </FixedSizeList>
          ) : listLoading ? null : (
            <div style={{ padding: '8px 12px', color: 'var(--text-dim)' }}>該当なし</div>
          )}
        </div>
      )}
    </div>
  )
}
