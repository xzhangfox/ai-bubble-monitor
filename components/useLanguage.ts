'use client'

import { useEffect, useState } from 'react'

export type Lang = 'en' | 'zh'
const STORAGE_KEY = 'ai-bubble-monitor-language'

function preference(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'en' || saved === 'zh' ? saved : null
  } catch {
    return null
  }
}

export function useLanguage() {
  const [lang, setLang] = useState<Lang>('en')

  useEffect(() => {
    const followSystem = () => setLang(preference() ?? ((navigator.languages[0] || navigator.language).toLowerCase().startsWith('zh') ? 'zh' : 'en'))
    followSystem()
    window.addEventListener('languagechange', followSystem)
    return () => window.removeEventListener('languagechange', followSystem)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'zh' : 'en'
    setLang(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
  }

  return { lang, toggleLanguage }
}
