import { useEffect, useState } from 'react'

/** matchMedia の現在値を購読する。SSRやmatchMedia非対応環境ではfalse。 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (): void => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** コンパクト幅（1024px未満）か。スマホ・タブレット縦のシート化に使う。 */
export function useIsCompactLayout(): boolean {
  return useMediaQuery('(max-width: 1023px)')
}

/** タッチ主体の端末か。タップ領域・ヒント・ハンドルサイズに使う。 */
export function useHasCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)')
}
