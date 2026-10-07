'use client'

import { useState } from 'react'

// "Share this app" — every Flux app carries one (Flux UI guide §5.4): the
// system share sheet with the app's own link, or the link copied where
// there is none. Sits in the top bar beside the language toggle, in its
// style.
const APP_URL = 'https://ai-bubble-monitor-delta.vercel.app/'

export default function ShareAppButton({ label, copiedLabel, text }: { label: string; copiedLabel: string; text: string }) {
  const [copied, setCopied] = useState(false)

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Flux AI Bubble Monitor', text, url: APP_URL })
        return
      } catch (err) {
        // A dismissed share sheet isn't an error.
        if ((err as DOMException)?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(APP_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // (clipboard blocked: nothing more to do)
    }
  }

  return (
    <button
      onClick={share}
      aria-label={label}
      title={label}
      className="ml-2 h-[30px] px-2.5 text-xs font-mono tracking-widest border border-gold/30 text-gold/80 rounded-md hover:bg-gold/10 hover:border-gold/60 hover:text-gold transition-all duration-200 active:scale-95 flex-shrink-0 flex items-center gap-1.5"
    >
      {copied ? (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="6" cy="12" r="2.3" />
          <circle cx="17.5" cy="6" r="2.3" />
          <circle cx="17.5" cy="18" r="2.3" />
          <path d="M8.1 10.8l7.3-3.6M8.1 13.2l7.3 3.6" />
        </svg>
      )}
      <span className="hidden sm:inline">{copied ? copiedLabel : label}</span>
    </button>
  )
}
