import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'machimoki:devMode'

function getInitialValue(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
  } catch {}
  if (import.meta.env.DEV) return true
  try {
    if (new URLSearchParams(window.location.search).has('dev')) return true
  } catch {}
  return false
}

export interface DeveloperModeApi {
  enable: () => void
  disable: () => void
  toggle: () => void
  isEnabled: () => boolean
}

declare global {
  interface Window {
    __dev?: DeveloperModeApi
  }
}

export function useDeveloperMode() {
  const [isDevMode, setIsDevMode] = useState(getInitialValue)

  const enable = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {}
    setIsDevMode(true)
  }, [])

  const disable = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '0')
    } catch {}
    // ?dev=1 が付いている場合はURLから除去しないと再読込で復活するため、
    // URLクエリも除去する
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('dev')) {
        url.searchParams.delete('dev')
        window.history.replaceState(null, '', url.toString())
      }
    } catch {}
    setIsDevMode(false)
  }, [])

  const toggle = useCallback(() => {
    setIsDevMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
        if (!next) {
          const url = new URL(window.location.href)
          if (url.searchParams.has('dev')) {
            url.searchParams.delete('dev')
            window.history.replaceState(null, '', url.toString())
          }
        }
      } catch {}
      return next
    })
  }, [])

  const isEnabled = useCallback(() => isDevMode, [isDevMode])

  useEffect(() => {
    // キーボードトグル: Ctrl+Shift+D
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // コンソールAPI: window.__dev
    const api: DeveloperModeApi = { enable, disable, toggle, isEnabled }
    window.__dev = api

    // ?dev=1 で来た場合は localStorage にも保存してリロード後も維持
    try {
      if (new URLSearchParams(window.location.search).has('dev')) {
        localStorage.setItem(STORAGE_KEY, '1')
      }
    } catch {}

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [enable, disable, toggle, isEnabled])

  return { isDevMode, enable, disable, toggle }
}
