import { useMemo, useState } from 'react'

export interface BuildingListItem {
  id: string
  height: string | null
  usage: string | null
}

interface BuildingListPanelProps {
  items: BuildingListItem[]
  excludedIds: string[]
  onExclude: (id: string) => void
  onRestore: (id: string) => void
  onHoverItem: (id: string | null) => void
}

function shortId(id: string): string {
  return id.length > 18 ? `${id.slice(0, 15)}…` : id
}

export default function BuildingListPanel({
  items,
  excludedIds,
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
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 10px',
          background: 'transparent',
          border: 'none',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer',
          color: 'var(--text)',
          fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--accent)' }}>{open ? '▾' : '▸'}</span>
        建物一覧（{items.length}件 / 削除済み {excludedIds.length}件）
      </button>
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
          <div style={{ overflowY: 'auto' }}>
            {filtered.map((item) => {
              const excluded = excludedSet.has(item.id)
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => onHoverItem(item.id)}
                  onMouseLeave={() => onHoverItem(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 8px',
                    borderBottom: '1px solid var(--border)',
                    opacity: excluded ? 0.55 : 1,
                  }}
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
                    onClick={() => (excluded ? onRestore(item.id) : onExclude(item.id))}
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
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '10px', color: 'var(--text-dim)' }}>該当なし</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
