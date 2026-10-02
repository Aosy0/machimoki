import { useCallback, useEffect, useRef, useState } from 'react'
import { Marker } from 'maplibre-gl'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import { suggestAll, searchFacilities } from '../lib/poiSearch'
import type { PoiHit, PoiBounds } from '../lib/poiSearch'

export interface FacilitySearchBoxProps {
  map: MapLibreMap
}

function boundsFromMap(map: MapLibreMap): PoiBounds {
  const b = map.getBounds()
  return {
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  }
}

const ROOT_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '8px',
  left: '8px',
  width: 'min(300px, calc(100% - 16px))',
  zIndex: 2,
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid #ccc',
  borderRadius: '4px',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
  fontSize: '12px',
  color: '#333',
}

const INPUT_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 6px',
}

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '12px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: '#333',
  padding: '2px 0',
}

const CLEAR_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  fontSize: '12px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#666',
  padding: '2px 4px',
  lineHeight: 1,
}

const POPUP_STYLE: React.CSSProperties = {
  borderTop: '1px solid #ddd',
  maxHeight: '240px',
  overflowY: 'auto',
  background: 'rgba(255, 255, 255, 0.98)',
  borderRadius: '0 0 4px 4px',
}

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '11px',
  color: '#666',
  background: '#f3f3f3',
  padding: '3px 8px',
}

const ITEM_BUTTON_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '5px 8px',
  fontSize: '12px',
  color: '#333',
  lineHeight: 1.4,
}

const ITEM_SUB_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#777',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const META_STYLE: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '12px',
  color: '#666',
}

const ERROR_STYLE: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: '12px',
  color: '#555',
}

const RESULTS_HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '4px 8px',
  fontSize: '12px',
  color: '#333',
  background: '#f3f3f3',
}

export default function FacilitySearchBox({ map }: FacilitySearchBoxProps) {
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [facilities, setFacilities] = useState<PoiHit[]>([])
  const [addresses, setAddresses] = useState<PoiHit[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState(false)
  const [results, setResults] = useState<PoiHit[] | null>(null)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [resultsError, setResultsError] = useState(false)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const markersRef = useRef<MapLibreMarker[]>([])
  const debounceRef = useRef<number | null>(null)
  const requestIdRef = useRef(0)
  const mapRef = useRef(map)
  mapRef.current = map

  const clearMarkers = useCallback(() => {
    for (const m of markersRef.current) {
      try {
        m.remove()
      } catch {
        // 既に破棄済みのマーカーは無視
      }
    }
    markersRef.current = []
  }, [])

  // アンマウント時に全マーカー破棄
  useEffect(() => {
    return () => {
      for (const m of markersRef.current) {
        try {
          m.remove()
        } catch {
          // 無視
        }
      }
      markersRef.current = []
    }
  }, [])

  // コンポーネント外の pointerdown でドロップダウンを閉じる
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const flyToHit = useCallback((hit: PoiHit) => {
    const m = mapRef.current
    try {
      m.flyTo({ center: [hit.lng, hit.lat], zoom: 16, duration: 800 })
    } catch {
      // flyTo 失敗時はマーカー設置のみ継続
    }
  }, [])

  const placeSingleMarker = useCallback(
    (hit: PoiHit) => {
      clearMarkers()
      try {
        const marker = new Marker({ color: '#e11d48' })
          .setLngLat([hit.lng, hit.lat])
          .addTo(mapRef.current)
        markersRef.current = [marker]
      } catch {
        // マーカー設置失敗は無視
      }
    },
    [clearMarkers],
  )

  const handleSelectHit = useCallback(
    (hit: PoiHit) => {
      flyToHit(hit)
      placeSingleMarker(hit)
      setQuery(hit.name)
      setDropdownOpen(false)
    },
    [flyToHit, placeSingleMarker],
  )

  const runSuggest = useCallback(
    (q: string) => {
      const text = q.trim()
      if (text.length < 2) {
        setFacilities([])
        setAddresses([])
        setSuggestLoading(false)
        setSuggestError(false)
        setDropdownOpen(false)
        return
      }
      setSuggestLoading(true)
      setSuggestError(false)
      setDropdownOpen(true)
      const id = requestIdRef.current + 1
      requestIdRef.current = id
      let bounds: PoiBounds
      try {
        bounds = boundsFromMap(mapRef.current)
      } catch {
        setSuggestLoading(false)
        setSuggestError(true)
        return
      }
      suggestAll(text, bounds)
        .then((res) => {
          if (requestIdRef.current !== id) return
          setFacilities(res.facilities)
          setAddresses(res.addresses)
          setSuggestLoading(false)
        })
        .catch(() => {
          if (requestIdRef.current !== id) return
          setSuggestLoading(false)
          setSuggestError(true)
        })
    },
    [],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
      debounceRef.current = window.setTimeout(() => {
        runSuggest(value)
      }, 300)
    },
    [runSuggest],
  )

  // 入力クリア時のタイマー破棄
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const runFullSearch = useCallback(
    (q: string) => {
      const text = q.trim()
      if (text.length < 2) return
      setResultsLoading(true)
      setResultsError(false)
      setDropdownOpen(false)
      let bounds: PoiBounds
      try {
        bounds = boundsFromMap(mapRef.current)
      } catch {
        setResultsLoading(false)
        setResultsError(true)
        setResults([])
        return
      }
      searchFacilities(text, bounds, 50)
        .then((hits) => {
          const limited = hits.slice(0, 50)
          setResults(limited)
          setResultsLoading(false)
          clearMarkers()
          const created: MapLibreMarker[] = []
          for (const hit of limited) {
            try {
              const marker = new Marker({ color: '#e11d48' })
                .setLngLat([hit.lng, hit.lat])
                .addTo(mapRef.current)
              created.push(marker)
            } catch {
              // 個別マーカー失敗は無視
            }
          }
          markersRef.current = created
        })
        .catch(() => {
          setResultsLoading(false)
          setResultsError(true)
          setResults([])
        })
    },
    [clearMarkers],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        runFullSearch(query)
      } else if (e.key === 'Escape') {
        setDropdownOpen(false)
        setResults(null)
      }
    },
    [query, runFullSearch],
  )

  const handleClear = useCallback(() => {
    setQuery('')
    setFacilities([])
    setAddresses([])
    setSuggestError(false)
    setSuggestLoading(false)
    setDropdownOpen(false)
    setResults(null)
    setResultsError(false)
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const showDropdown = dropdownOpen && query.trim().length >= 2
  const bothEmpty = facilities.length === 0 && addresses.length === 0

  return (
    <div ref={rootRef} style={ROOT_STYLE}>
      <div style={INPUT_ROW_STYLE}>
        <input
          data-testid="facility-search-input"
          aria-label="施設・住所を検索"
          aria-expanded={showDropdown}
          placeholder="施設・住所を検索"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2) setDropdownOpen(true)
          }}
          style={INPUT_STYLE}
        />
        {query.length > 0 && (
          <button
            type="button"
            aria-label="検索文字をクリア"
            onClick={handleClear}
            style={CLEAR_BUTTON_STYLE}
          >
            ×
          </button>
        )}
      </div>
      {showDropdown && (
        <div data-testid="facility-search-dropdown" style={POPUP_STYLE}>
          {suggestLoading && <div style={META_STYLE}>検索中…</div>}
          {!suggestLoading && suggestError && <div style={ERROR_STYLE}>検索に失敗しました</div>}
          {!suggestLoading && !suggestError && bothEmpty && (
            <div style={META_STYLE}>候補が見つかりません</div>
          )}
          {!suggestLoading && !suggestError && !bothEmpty && (
            <>
              {facilities.length > 0 && (
                <div>
                  <div style={SECTION_TITLE_STYLE}>施設</div>
                  <div>
                    {facilities.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        data-testid="facility-search-item"
                        onClick={() => handleSelectHit(hit)}
                        style={ITEM_BUTTON_STYLE}
                      >
                        <span>{hit.name}</span>
                        {hit.address !== '' && <span style={ITEM_SUB_STYLE}>{hit.address}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {addresses.length > 0 && (
                <div>
                  <div style={SECTION_TITLE_STYLE}>住所</div>
                  <div>
                    {addresses.map((hit) => (
                      <button
                        key={hit.id}
                        type="button"
                        data-testid="facility-search-item"
                        onClick={() => handleSelectHit(hit)}
                        style={ITEM_BUTTON_STYLE}
                      >
                        <span>{hit.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {(results !== null || resultsLoading || resultsError) && (
        <div data-testid="facility-search-results" style={POPUP_STYLE}>
          <div style={RESULTS_HEADER_STYLE}>
            <span>
              {resultsLoading
                ? '検索中…'
                : resultsError
                  ? '検索に失敗しました'
                  : `検索結果 ${results?.length ?? 0}件`}
            </span>
            <button
              type="button"
              aria-label="検索結果を閉じる"
              onClick={() => setResults(null)}
              style={CLEAR_BUTTON_STYLE}
            >
              ×
            </button>
          </div>
          {!resultsLoading && !resultsError && results !== null && results.length === 0 && (
            <div style={META_STYLE}>該当する施設が見つかりませんでした</div>
          )}
          {!resultsLoading && !resultsError && results !== null && results.length > 0 && (
            <div>
              {results.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  data-testid="facility-search-item"
                  onClick={() => handleSelectHit(hit)}
                  style={ITEM_BUTTON_STYLE}
                >
                  <span>{hit.name}</span>
                  {hit.address !== '' && <span style={ITEM_SUB_STYLE}>{hit.address}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
