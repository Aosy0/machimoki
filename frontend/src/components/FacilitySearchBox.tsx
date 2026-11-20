import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Marker } from 'maplibre-gl'
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl'
import {
  suggestAll,
  searchFacilities,
  searchFallback,
  searchPrimary,
  isPoiFallbackEnabled,
} from '../lib/poiSearch'
import type { PoiHit, PoiBounds } from '../lib/poiSearch'
import Icon from './ui/Icon'

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
  width: 'min(360px, calc(100% - 16px))',
  zIndex: 2,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-panel)',
  fontSize: '13px',
  color: 'var(--text)',
}

const INPUT_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
}

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: '13px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  padding: '4px 0',
}

const CLEAR_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-control)',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  padding: 0,
}

const SEARCH_BUTTON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-control)',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  padding: 0,
  width: 32,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const POPUP_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  background: 'transparent',
}

const SECTION_TITLE_STYLE: React.CSSProperties = {
  fontSize: '12px',
  color: 'var(--text-dim)',
  background: 'var(--surface-solid)',
  padding: '8px 12px',
}

const ITEM_BUTTON_STYLE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '8px 12px',
  fontSize: '14px',
  color: 'var(--text)',
  lineHeight: 1.4,
}

const ITEM_SUB_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  color: 'var(--text-dim)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const META_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: 'var(--text-dim)',
}

const ERROR_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  color: 'var(--text-dim)',
}

const RESULTS_HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '8px 12px',
  fontSize: '13px',
  color: 'var(--text)',
  background: 'var(--surface-solid)',
}

/**
 * 下限計算の測定対象（実行時はこの固定リストのみ測り、全要素走査はしない）。
 * いずれも地図上の下部オーバーレイで、検索パネル列と横方向に重なりうるもの。
 */
const POPUP_LOWER_BOUND_TESTIDS = [
  'map2d-coord-panel',
  'map2d-drag-hint',
  'map2d-attribution',
  'map2d-fallback-notice',
] as const

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
  const [resultSource, setResultSource] = useState<'view' | 'nationwide' | 'fallback'>('view')
  const [maxPopupHeight, setMaxPopupHeight] = useState(240)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRowRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)
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

  // ポップアップ（候補/結果）の最大高さを、他のUIと重ならない範囲でギリギリまで伸ばす。
  // 下限は実測で決める: パネル列と横方向に重なり、ポップアップより下にある既知UIのうち
  // 最も上のものの上端−8px。見つからなければ画面下端−8pxが絶対下限。
  // 明示の上限クランプはしない（availableがそのまま上限）。最小120pxのみ保護。
  // 実行時は軽量に: 固定の既知UIだけを個別取得する（全要素走査はしない）。
  const recomputeMaxPopupHeight = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    let popupTop: number
    let popupLeft: number
    let popupRight: number
    try {
      const row = inputRowRef.current
      popupTop = (row ?? root).getBoundingClientRect().bottom
      const rootRect = root.getBoundingClientRect()
      popupLeft = rootRect.left
      popupRight = rootRect.right
    } catch {
      return
    }
    if (!Number.isFinite(popupTop)) return
    let lower = window.innerHeight - 8
    try {
      // 固定の既知UIだけを個別取得する（最大4要素。querySelectorAll('*') は使わない）。
      for (const testid of POPUP_LOWER_BOUND_TESTIDS) {
        const el = document.querySelector(`[data-testid="${testid}"]`)
        // 自分のパネル内は除外（現状いずれも外部だが念のため）
        if (el && root.contains(el)) continue
        if (!(el instanceof HTMLElement)) continue
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue
        // パネル列と横方向に重ならないものは無視（右上パネル等）
        if (rect.right <= popupLeft || rect.left >= popupRight) continue
        if (!Number.isFinite(rect.top) || rect.top <= popupTop) continue
        lower = Math.min(lower, rect.top - 8)
      }
    } catch {
      // 実測に失敗した場合は画面下端基準のフォールバックを使う
    }
    setMaxPopupHeight(Math.max(120, lower - popupTop))
  }, [])

  // 連続resize時の過剰計算を防ぐための rAF スロットル
  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      recomputeMaxPopupHeight()
    })
  }, [recomputeMaxPopupHeight])

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
      // 視差効果を減らす設定ではアニメーションせず即座に移動する
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      m.flyTo({ center: [hit.lng, hit.lat], zoom: 16, duration: reduceMotion ? 0 : 800 })
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

  const runSuggest = useCallback((q: string) => {
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
  }, [])

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

  const showResults = useCallback(
    (hits: PoiHit[], source: 'view' | 'nationwide' | 'fallback') => {
      const limited = hits.slice(0, 50)
      setResults(limited)
      setResultSource(source)
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
    },
    [clearMarkers],
  )

  const runFullSearch = useCallback(
    (q: string) => {
      const text = q.trim()
      if (text.length < 2) return
      setResultsLoading(true)
      setResultsError(false)
      setResultSource('view')
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
      const run = async () => {
        // 1. Photon（主プロバイダ）: 代表的な場所の座標精度を優先
        if (isPoiFallbackEnabled) {
          const primaryHits = await searchPrimary(text, bounds, 50).catch(() => [] as PoiHit[])
          if (primaryHits.length > 0) return showResults(primaryHits, 'fallback')
        }
        // 2. OpenPOI 表示範囲内（Photon0件/未設定時）
        const viewHits = await searchFacilities(text, bounds, 50)
        if (viewHits.length > 0) return showResults(viewHits, 'view')
        // 3. OpenPOI 全国
        const allHits = await searchFacilities(text, null, 50)
        if (allHits.length > 0) return showResults(allHits, 'nationwide')
        // 4. Photon（center無しで再試行）
        if (isPoiFallbackEnabled) {
          const fbHits = await searchFallback(text, null, 20)
          return showResults(fbHits, 'fallback')
        }
        showResults([], 'view')
      }

      run().catch(() => {
        setResultsLoading(false)
        setResultsError(true)
        setResultSource('view')
        setResults([])
      })
    },
    [showResults],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        // IME の変換確定 Enter で検索を発火させない
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
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
    setResultSource('view')
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const showDropdown = dropdownOpen && query.trim().length >= 2
  const bothEmpty = facilities.length === 0 && addresses.length === 0
  const submitDisabled = query.trim().length < 2 || resultsLoading
  const popupVisible = showDropdown || results !== null || resultsLoading || resultsError

  // ポップアップ表示中は上限を実測し、各種変化に追随する。
  // - 表示開始・件数変化（deps）: 即時再計算
  // - window resize / visualViewport resize: rAFスロットルで再計算
  // - map2d-container のサイズ変化（タブ切替・レイアウト変化）: ResizeObserverで再計算
  // useLayoutEffect で描画前に maxHeight を確定させ、開いた瞬間のちらつきを防ぐ。
  useLayoutEffect(() => {
    if (!popupVisible) return
    recomputeMaxPopupHeight()
    window.addEventListener('resize', scheduleRecompute)
    const vv = window.visualViewport
    vv?.addEventListener('resize', scheduleRecompute)
    let observer: ResizeObserver | null = null
    try {
      const target = document.querySelector('[data-testid="map2d-container"]') ?? rootRef.current
      if (target && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => scheduleRecompute())
        observer.observe(target)
      }
    } catch {
      // 監視できなくても resize 追随は維持する
    }
    return () => {
      window.removeEventListener('resize', scheduleRecompute)
      vv?.removeEventListener('resize', scheduleRecompute)
      observer?.disconnect()
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [popupVisible, facilities, addresses, results, recomputeMaxPopupHeight, scheduleRecompute])
  const sourceSuffix =
    resultSource === 'nationwide' ? '（全国）' : resultSource === 'fallback' ? '（OSM）' : ''

  return (
    <div ref={rootRef} style={ROOT_STYLE}>
      <div ref={inputRowRef} style={INPUT_ROW_STYLE}>
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
          <button type="button" aria-label="検索をクリア" onClick={handleClear} style={CLEAR_BUTTON_STYLE}>
            <Icon name="close" />
          </button>
        )}
        <button
          type="button"
          data-testid="facility-search-submit"
          aria-label="検索"
          disabled={submitDisabled}
          onClick={() => runFullSearch(query)}
          style={{
            ...SEARCH_BUTTON_STYLE,
            cursor: submitDisabled ? 'default' : 'pointer',
            opacity: submitDisabled ? 0.4 : 1,
          }}
        >
          <Icon name="search" size={20} />
        </button>
      </div>
      {showDropdown && (
        <div
          data-testid="facility-search-dropdown"
          style={{ ...POPUP_STYLE, maxHeight: maxPopupHeight }}
        >
          {suggestLoading && <div style={META_STYLE}>検索中…</div>}
          {!suggestLoading && suggestError && <div style={ERROR_STYLE}>検索に失敗しました</div>}
          {!suggestLoading && !suggestError && bothEmpty && (
            <div style={META_STYLE}>該当なし</div>
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
        <div
          data-testid="facility-search-results"
          style={{ ...POPUP_STYLE, maxHeight: maxPopupHeight }}
        >
          <div style={RESULTS_HEADER_STYLE}>
            <span>
              {resultsLoading
                ? '検索中…'
                : resultsError
                  ? '検索に失敗しました'
                  : `検索結果 ${results?.length ?? 0}件${sourceSuffix}`}
            </span>
            <button
              type="button"
              aria-label="検索結果を閉じる"
              onClick={() => setResults(null)}
              style={CLEAR_BUTTON_STYLE}
            >
              <Icon name="close" />
            </button>
          </div>
          {!resultsLoading && !resultsError && results !== null && results.length === 0 && (
            <div style={META_STYLE}>該当なし</div>
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
