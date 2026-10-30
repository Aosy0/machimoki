import { useCallback, useEffect, useState } from 'react'
import {
  FIRST_RUN_HINT_ATTENTION_MS,
  FIRST_RUN_HINT_DELAY_MS,
  clearHardReloadFlag,
  isHardReloadShortcut,
  markHardReload,
  readHardReloadFlag,
  readHintSeen,
  shouldShowAttention,
  writeHintSeen,
} from '../lib/firstRunHint'

interface UseFirstRunHintOptions {
  /** マップタブが表示されているか。プレビュー中はタイマーを動かさない。 */
  active: boolean
  /** 地図を操作したか。操作した時点でヒントの役目は終わり。 */
  interacted: boolean
}

type HintPhase = 'idle' | 'delayed' | 'attention'

/**
 * 初回だけ下部ヒントを少し待ってから拡大表示する。表示中に地図操作・
 * モード切替・ヘルプを開くなどの操作があれば即座に既読にする。
 */
export function useFirstRunHint({ active, interacted }: UseFirstRunHintOptions) {
  // ハードリロード直後は既読でも一度だけ再表示する。
  const [hardReload] = useState(readHardReloadFlag)
  const [seen, setSeen] = useState(() => (hardReload ? false : readHintSeen()))
  const [phase, setPhase] = useState<HintPhase>('idle')

  useEffect(() => {
    if (!hardReload) return
    clearHardReloadFlag()
  }, [hardReload])

  // ハードリロードのキー操作で、リロード前に一時フラグを立てる。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isHardReloadShortcut(event)) markHardReload()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // 読み込み直後は少し待ってから拡大する。
  useEffect(() => {
    if (!shouldShowAttention({ seen, active, interacted })) {
      setPhase('idle')
      if (interacted && !seen) {
        setSeen(true)
        writeHintSeen()
      }
      return
    }

    setPhase('delayed')
    const timer = window.setTimeout(() => setPhase('attention'), FIRST_RUN_HINT_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [active, interacted, seen])

  // 拡大表示を一定時間で通常サイズに戻す。
  useEffect(() => {
    if (phase !== 'attention') return
    const timer = window.setTimeout(() => {
      setPhase('idle')
      setSeen(true)
      writeHintSeen()
    }, FIRST_RUN_HINT_ATTENTION_MS)

    return () => window.clearTimeout(timer)
  }, [phase])

  const dismiss = useCallback(() => {
    setPhase('idle')
    setSeen((prev) => {
      if (!prev) writeHintSeen()
      return true
    })
  }, [])

  return { attention: phase === 'attention', dismiss }
}
