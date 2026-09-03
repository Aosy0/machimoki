import { useEffect, useRef, useState, useCallback } from 'react'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// Vite用worker設定（削除するとworker 404で地図が白紙になるため必須）。
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import vendoredStyleJson from '../lib/gsiVectorStyle.json'

setWorkerUrl(maplibreWorkerUrl)
import {
  sanitizeGsiStyle,
  buildFallbackStyle,
  validateStyleUrls,
  classifyMapError,
  getMissingMapContent,
  MAP2D_CENTER_LNG,
  MAP2D_CENTER_LAT,
  MAP2D_ZOOM,
  MAP2D_MIN_ZOOM,
  MAP2D_MAX_ZOOM,
  GSI_ATTRIBUTION_TEXT,
  GSI_LICENSE_URL,
  UPSTREAM_STYLE_URL,
} from '../lib/gsiStyle'

// テスト互換性のため re-export（既存テストの import パス維持）
export {
  sanitizeGsiStyle,
  buildFallbackStyle,
  validateStyleUrls,
  classifyMapError,
  getMissingMapContent,
  MAP2D_CENTER_LNG,
  MAP2D_CENTER_LAT,
  MAP2D_ZOOM,
  MAP2D_MIN_ZOOM,
  MAP2D_MAX_ZOOM,
  GSI_ATTRIBUTION_TEXT,
  GSI_LICENSE_URL,
  UPSTREAM_STYLE_URL,
} from '../lib/gsiStyle'

/**
 * MapLibre GL JS による2D地図基盤（mapタブの正規地図）。
 *
 * - ソースは国土地理院 最適化ベクトルタイル（PBF）のみ。
 * - スタイルは実行時に公式std.jsonの取得を試み、失敗時はベンダー固定コピー、
 *   それも不正な場合は道路・行政境界・水域のみの最小自前スタイルで表示する。
 * - 等高線（Cntrレイヤー）は2Dに出さない。3D側の等高線処理には触らない。
 *
 * ライフサイクル:
 * - タブ切替（visibilitychange）やリサイズ時に map.resize() を呼ぶ
 * - アンマウント時に map.remove() と全リスナー解除
 * - インスタンス重複生成防止（ref で管理）
 * - 生成したインスタンスは onMapReady で親に渡す（矩形選択・カバレッジ配線用）。
 *   破棄時は onMapUnload で親の参照を外す。
 *
 * 失敗分離:
 * - スタイル不備 → 内蔵最小スタイル（buildFallbackStyle）
 * - PBF一時失敗 → 地図維持＋状態表示（notice）
 * - WebGL失敗 → onWebGLFailure コールバックで退避（手入力・プリセットで継続可）
 */

/** load 後に検証するレイヤーID（背景・水域・行政境界・道路の主要層） */
const REQUIRED_LAYER_IDS = ['background', '水域', '行政区画', '道路中心線ククリ0']

export type MapErrorKind = 'sprite' | 'glyphs' | 'tiles' | 'webgl' | 'unknown'

export interface Map2DProps {
  className?: string
  /** WebGL 失敗時に呼び出される。UI は手入力・プリセット退避へ切り替える想定。 */
  onWebGLFailure?: (error: Error) => void
  /** MapLibreMap生成直後に呼ばれる（矩形選択・カバレッジ等の配線用）。 */
  onMapReady?: (map: MapLibreMap) => void
  /** Map破棄時（アンマウント・タブ切替）に呼ばれる。親の参照外し用。 */
  onMapUnload?: () => void
  /** 選択範囲を現在の表示範囲に設定するコールバック（モバイル代替） */
  onSelectCurrentBounds?: (bounds: {
    west: number
    south: number
    east: number
    north: number
  }) => void
}

export default function Map2D({
  className,
  onWebGLFailure,
  onMapReady,
  onMapUnload,
  onSelectCurrentBounds,
}: Map2DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<MapErrorKind | null>(null)
  // コールバックはref経由で参照し、地図インスタンスの再生成を抑止する
  const readyRef = useRef(onMapReady)
  const unloadRef = useRef(onMapUnload)
  const webglFailureRef = useRef(onWebGLFailure)
  useEffect(() => {
    readyRef.current = onMapReady
    unloadRef.current = onMapUnload
    webglFailureRef.current = onWebGLFailure
  })
  const [vendoredStyleValid] = useState<boolean>(() => {
    const problems = validateStyleUrls(vendoredStyleJson)
    return problems.length === 0
  })

  // visibilitychange によるタブ切替時の resize
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible' && mapRef.current) {
      mapRef.current.resize()
    }
  }, [])

  // window resize への対応
  const handleWindowResize = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.resize()
    }
  }, [])

  useEffect(() => {
    const container: HTMLDivElement | null = containerRef.current
    if (!container) return
    // 重複生成防止: 既に mapRef にインスタンスがあれば何もしない
    if (mapRef.current) return

    let cancelled = false
    let map: MapLibreMap | null = null

    // 初期表示はベンダー固定コピーを正規化したもの。不正時のみ最小自前スタイル。
    // 上流変更の影響を受けず、オフラインでも地図が出る。
    // 生成自体が失敗（WebGL利用不可など）した場合は手入力・プリセット退避へ。
    try {
      try {
        // ベンダーJSONのURL検証に失敗した場合もフォールバック
        if (!vendoredStyleValid) {
          throw new Error('ベンダーJSONのURL検証に失敗')
        }
        const initialStyle = sanitizeGsiStyle(vendoredStyleJson)
        map = new MapLibreMap({
          container,
          style: initialStyle,
          center: [MAP2D_CENTER_LNG, MAP2D_CENTER_LAT],
          zoom: MAP2D_ZOOM,
          minZoom: MAP2D_MIN_ZOOM,
          maxZoom: MAP2D_MAX_ZOOM,
          // attribution control は無効化しない（GSI帰属維持）
          attributionControl: { compact: true },
          // 既定の boxZoom は Shift+ドラッグと競合するため抑止
          boxZoom: false,
        })
      } catch {
        map = new MapLibreMap({
          container,
          style: buildFallbackStyle(),
          center: [MAP2D_CENTER_LNG, MAP2D_CENTER_LAT],
          zoom: MAP2D_ZOOM,
          minZoom: MAP2D_MIN_ZOOM,
          maxZoom: MAP2D_MAX_ZOOM,
          attributionControl: { compact: true },
          boxZoom: false,
        })
        setNotice('組み込みの簡易スタイルで表示しています（道路・行政境界・水域のみ）')
      }
    } catch (err) {
      map = null
      setErrorState('webgl')
      const failure =
        err instanceof Error ? err : new Error('地図の初期化に失敗しました')
      webglFailureRef.current?.(failure)
      return () => {
        mapRef.current = null
      }
    }
    const createdMap: MapLibreMap | null = map
    if (createdMap === null) {
      return () => {
        mapRef.current = null
      }
    }
    const activeMap: MapLibreMap = createdMap
    mapRef.current = activeMap
    readyRef.current?.(activeMap)

    // load イベントで source/layer の存在を検証
    activeMap.on('load', () => {
      activeMap.resize()
      const missing = getMissingMapContent(activeMap, REQUIRED_LAYER_IDS)
      if (missing.length > 0) {
        setNotice(`地図の読み込みは完了しましたが、一部のレイヤーが見つかりません: ${missing.join(', ')}`)
      }
    })

    // エラーイベント: 失敗種類を分類して状態に反映
    activeMap.on('error', (event: { error?: { message?: string } }) => {
      const message = event.error?.message ?? ''
      const kind = classifyMapError(message) as MapErrorKind
      if (kind === 'webgl') {
        setErrorState('webgl')
        webglFailureRef.current?.(new Error(message === '' ? 'WebGL error' : message))
      } else if (kind === 'sprite' || kind === 'glyphs') {
        // sprite/glyphs 失敗は地図表示を維持しつつ状態表示
        setErrorState(kind)
        setNotice(`リソースの読み込みに失敗しました（${kind}）。表示が不完全な場合があります。`)
      } else if (kind === 'tiles') {
        // PBF 一時失敗は地図維持＋状態表示
        setErrorState('tiles')
        setNotice('タイルの読み込みに失敗しました。ネットワークを確認してください。')
      }
    })

    // リスナー登録
    window.addEventListener('resize', handleWindowResize)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // 実行時取得（初回実装）: 公式std.jsonを取得できたら正規化して適用する。
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 8000)
    fetch(UPSTREAM_STYLE_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`上流スタイルの取得に失敗しました: HTTP ${res.status}`)
        }
        return res.json() as Promise<unknown>
      })
      .then((json: unknown) => {
        if (cancelled) return
        // 取得したスタイルのURLも検証
        const problems = validateStyleUrls(json)
        if (problems.length > 0) {
          setNotice('上流スタイルのURLが不正なため固定スタイルで表示しています')
          return
        }
        activeMap.setStyle(sanitizeGsiStyle(json))
      })
      .catch(() => {
        if (!cancelled) {
          setNotice('上流スタイルの取得に失敗したため固定スタイルで表示しています')
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      controller.abort()
      window.removeEventListener('resize', handleWindowResize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      activeMap.remove()
      mapRef.current = null
      unloadRef.current?.()
    }
  }, [handleVisibilityChange, handleWindowResize, vendoredStyleValid])

  // 現在の表示範囲を取得するハンドラ
  const handleSelectCurrentBounds = useCallback(() => {
    if (!mapRef.current || !onSelectCurrentBounds) return
    const bounds = mapRef.current.getBounds()
    onSelectCurrentBounds({
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    })
  }, [onSelectCurrentBounds])

  // WebGL 失敗時は手入力・プリセット退避を促す
  if (errorState === 'webgl') {
    return (
      <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div
          data-testid="map2d-webgl-error"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8f8f8',
            color: '#333',
            fontSize: '14px',
            padding: '16px',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
              地図の描画に失敗しました
            </div>
            <div>WebGL がサポートされていないか、ハードウェアアクセラレーションが無効です。</div>
            <div style={{ marginTop: '8px' }}>
              手動で範囲を入力するか、プリセットから選択してください。
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} data-testid="map2d-container" style={{ position: 'absolute', inset: 0 }} />
      <div
        data-testid="map2d-attribution"
        style={{
          position: 'absolute',
          bottom: '4px',
          right: '4px',
          fontSize: '10px',
          color: 'var(--text-dim, #666)',
          background: 'rgba(255, 255, 255, 0.7)',
          padding: '2px 6px',
          borderRadius: '3px',
          zIndex: 1,
          pointerEvents: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <a href={GSI_LICENSE_URL} target="_blank" rel="noreferrer">
          {GSI_ATTRIBUTION_TEXT}
        </a>
      </div>
      {onSelectCurrentBounds && (
        <button
          type="button"
          data-testid="map2d-select-current-bounds"
          onClick={handleSelectCurrentBounds}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            fontSize: '12px',
            background: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #ccc',
            padding: '4px 8px',
            borderRadius: '4px',
            zIndex: 1,
            cursor: 'pointer',
          }}
        >
          現在の表示範囲を選択
        </button>
      )}
      {notice ? (
        <div
          data-testid="map2d-fallback-notice"
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            fontSize: '11px',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '4px 8px',
            borderRadius: '4px',
            zIndex: 1,
          }}
        >
          {notice}
        </div>
      ) : null}
    </div>
  )
}
