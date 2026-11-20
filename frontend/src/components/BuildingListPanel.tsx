import React, { useId, useMemo, useState } from 'react'
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
  loadingDetail?: string | null
  loadingProgress?: number | null
  totalTiles?: number | null
  loadedTiles?: number | null
  onExclude: (id: string) => void
  onRestore: (id: string) => void
  onHoverItem: (id: string | null) => void
}

interface RowData {
  items: BuildingListItem[]
  excludedSet: Set<string>
  onExclude: (id: string) => void
  onRestore: (id: string) => void
  onHoverItem: (id: string | null) => void
  compact: boolean
}

const ITEM_SIZE = 28
const MAX_LIST_HEIGHT = 360
// 高さの列幅。数値の桁数が変わっても行頭が揃うよう固定する。
const HEIGHT_COLUMN_WIDTH = 56

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 15)}…` : id
}

const Row = React.memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const item = data.items[index]
  const excluded = data.excludedSet.has(item.id)
  return (
    <div
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 8px',
        borderBottom: '1px solid var(--border)',
        opacity: excluded ? 0.55 : 1,
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
          color: 'var(--text-dim)',
        }}
      >
        {item.height ? `${item.height} m` : ''}
      </span>
      <button
        type="button"
        onClick={() => (excluded ? data.onRestore(item.id) : data.onExclude(item.id))}
        style={{
          flexShrink: 0,
          minHeight: data.compact ? 32 : 24,
          padding: '0 8px',
          fontSize: '12px',
          lineHeight: 1.2,
          cursor: 'pointer',
          borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border-strong)',
          background: excluded ? 'var(--border-strong)' : 'transparent',
          color: excluded ? 'var(--text)' : 'var(--warn)',
        }}
      >
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
  totalTiles,
  loadedTiles,
  onExclude,
  onRestore,
  onHoverItem,
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
    () => ({ items: filtered, excludedSet, onExclude, onRestore, onHoverItem, compact: isCompact }),
    [filtered, excludedSet, onExclude, onRestore, onHoverItem, isCompact],
  )

  const listHeight =
    filtered.length > 0 ? Math.min(MAX_LIST_HEIGHT, filtered.length * itemSize) : 0

  // 読み込み中はヘッダー（と進捗）だけを出す。0件で確定したときだけ消す。
  if (items.length === 0 && !listLoading) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: isCompact ? '160px' : '52px',
        left: '16px',
        zIndex: 10,
        width: 'min(264px, calc(100vw - 32px))',
        maxHeight: open
          ? isCompact
            ? '38dvh'
            : 'calc(100% - 160px)'
          : 'auto',
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
        {listLoading && loadingProgress != null && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              transform: `scaleX(${Math.max(0, Math.min(100, loadingProgress)) / 100})`,
              transformOrigin: 'left center',
              background: 'var(--accent)',
              opacity: 0.18,
              transition: 'transform 150ms',
              pointerEvents: 'none',
            }}
          />
        )}
        {listLoading && loadingProgress == null && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '2px',
              background: 'var(--accent)',
              opacity: 0.5,
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
          <span style={{ flex: 1, minWidth: 0 }}>
            {listLoading
              ? totalTiles != null && loadedTiles != null && totalTiles > 0
                ? `建物一覧（${loadedTiles}/${totalTiles} タイル）`
                : '建物一覧（読み込み中…）'
              : `建物一覧（${items.length}件${
                  excludedIds.length > 0 ? ` / 除外 ${excludedIds.length}` : ''
                }）`}
          </span>
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
