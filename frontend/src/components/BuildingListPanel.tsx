import React, { useMemo, useState } from 'react'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'

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
}

const ITEM_SIZE = 28
const MAX_LIST_HEIGHT = 360

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
        gap: '6px',
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
        {item.height && <span style={{ color: 'var(--text-dim)' }}> / {item.height}m</span>}
      </span>
      <button
        onClick={() => (excluded ? data.onRestore(item.id) : data.onExclude(item.id))}
        style={{
          flexShrink: 0,
          padding: '2px 8px',
          fontSize: '10px',
          cursor: 'pointer',
          borderRadius: '3px',
          border: excluded
            ? '1px solid var(--accent)'
            : '1px solid #b3591f',
          background: excluded ? 'var(--accent)' : 'transparent',
          color: excluded ? 'var(--text)' : '#ff9800',
        }}
      >
        {excluded ? '戻す' : '削除'}
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
  const [open, setOpen] = useState(true)

  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds])
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.id.toLowerCase().includes(q))
  }, [items, filter])

  const itemData = useMemo<RowData>(
    () => ({ items: filtered, excludedSet, onExclude, onRestore, onHoverItem }),
    [filtered, excludedSet, onExclude, onRestore, onHoverItem]
  )

  const listHeight = filtered.length > 0 ? Math.min(MAX_LIST_HEIGHT, filtered.length * ITEM_SIZE) : 0

  if (items.length === 0) return null

  return (
    <div
      style={{
        position: 'absolute',
        top: '52px',
        left: '16px',
        zIndex: 10,
        width: '264px',
        maxHeight: open ? 'calc(100% - 160px)' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        fontSize: '11px',
        backdropFilter: 'blur(4px)',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', borderBottom: open ? '1px solid var(--border)' : 'none', overflow: 'hidden' }}>
        {listLoading && loadingProgress != null && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              width: `${Math.max(0, Math.min(100, loadingProgress))}%`,
              background: 'var(--accent)',
              opacity: 0.18,
              transition: 'width 0.25s ease',
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
              opacity: 0.85,
              backgroundImage: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'machimoki-indeterminate 1.2s linear infinite',
            }}
          />
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '7px 10px',
            background: 'transparent',
            border: 'none',
            width: '100%',
            cursor: 'pointer',
            color: 'var(--text)',
            fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>{open ? '▾' : '▸'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {listLoading
              ? totalTiles != null && loadedTiles != null && totalTiles > 0
                ? `建物一覧（${loadedTiles}/${totalTiles} タイル 読み込み中）`
                : '建物一覧（読み込み中…）'
              : `建物一覧（${items.length}件 / 削除済み ${excludedIds.length}件）`}
          </span>
        </button>
        <style>{`@keyframes machimoki-indeterminate { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      </div>
      {open && (
        <>
          <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="IDで絞り込み"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '4px 6px',
                fontSize: '11px',
                background: 'var(--bg)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong)',
                borderRadius: '3px',
              }}
            />
          </div>
          {listHeight > 0 ? (
            <FixedSizeList
              height={listHeight}
              width="100%"
              itemCount={filtered.length}
              itemSize={ITEM_SIZE}
              itemData={itemData}
              itemKey={(index, data) => data.items[index].id}
            >
              {Row}
            </FixedSizeList>
          ) : (
            <div style={{ padding: '10px', color: 'var(--text-dim)' }}>該当なし</div>
          )}
        </>
      )}
    </div>
  )
}
