'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'

// Shared gold mark used across every Flux surface — same gradient stops as
// Portfolio WebSite/public/logos/*.svg so the family reads as one system.
const EcosystemGoldDefs = ({ id }: { id: string }) => (
  <defs>
    <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#BF953F" />
      <stop offset="25%" stopColor="#FCF6BA" />
      <stop offset="50%" stopColor="#B38728" />
      <stop offset="75%" stopColor="#FBF5B7" />
      <stop offset="100%" stopColor="#AA771C" />
    </linearGradient>
  </defs>
)

// Every other Flux surface, canonical order, AI Bubble Monitor excluded.
const ECOSYSTEM_APPS = [
  {
    id: 'portfolio',
    name: 'Portfolio Website',
    url: 'https://xzhangfox.github.io',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]">
        <EcosystemGoldDefs id="eco_portfolio" />
        <ellipse cx="50" cy="50" rx="40" ry="16" fill="none" stroke="url(#eco_portfolio)" strokeWidth="5" opacity="0.7" transform="rotate(-24 50 50)" />
        <circle cx="50" cy="50" r="12" fill="url(#eco_portfolio)" />
        <circle cx="83" cy="38" r="6" fill="url(#eco_portfolio)" transform="rotate(-24 50 50)" />
      </svg>
    ),
  },
  {
    id: 'nutrition',
    name: 'Flux Nutrition',
    url: 'https://flux-fox-1121.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]" fill="none">
        <EcosystemGoldDefs id="eco_nutrition" />
        <path d="M 5 45 Q 5 85 50 85 Q 95 85 95 45" stroke="url(#eco_nutrition)" strokeWidth="8" strokeLinecap="round" />
        <line x1="28" y1="72" x2="28" y2="55" stroke="url(#eco_nutrition)" strokeWidth="10" strokeLinecap="round" />
        <line x1="39" y1="78" x2="39" y2="45" stroke="url(#eco_nutrition)" strokeWidth="10" strokeLinecap="round" />
        <line x1="50" y1="80" x2="50" y2="35" stroke="url(#eco_nutrition)" strokeWidth="10" strokeLinecap="round" />
        <line x1="61" y1="78" x2="61" y2="50" stroke="url(#eco_nutrition)" strokeWidth="10" strokeLinecap="round" />
        <line x1="72" y1="72" x2="72" y2="60" stroke="url(#eco_nutrition)" strokeWidth="10" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'finance',
    name: 'Flux Finance',
    url: 'https://flux-finance-ivory.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]" fill="none">
        <EcosystemGoldDefs id="eco_finance" />
        <circle cx="50" cy="50" r="38" stroke="url(#eco_finance)" strokeWidth="12" />
        <circle cx="50" cy="50" r="24" stroke="url(#eco_finance)" strokeWidth="2" opacity="0.8" />
      </svg>
    ),
  },
  {
    id: 'career',
    name: 'Flux Career',
    url: 'https://flux-career-cyan.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]" fill="none">
        <EcosystemGoldDefs id="eco_career" />
        <rect x="25" y="25" width="50" height="50" stroke="url(#eco_career)" strokeWidth="7" />
        <rect x="40" y="40" width="20" height="20" stroke="url(#eco_career)" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: 'path',
    name: 'Flux Path',
    url: 'https://parallax-nine-taupe.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]">
        <EcosystemGoldDefs id="eco_path" />
        <path d="M 82 28 A 38 38 0 1 1 28 82" fill="none" stroke="url(#eco_path)" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
        <path d="M50 8 C53 30, 69 46, 92 50 C69 54, 53 70, 50 92 C47 70, 31 54, 8 50 C31 46, 47 30, 50 8 Z" fill="url(#eco_path)" />
      </svg>
    ),
  },
  {
    id: 'glow',
    name: 'Flux Glow',
    url: 'https://flux-glow-f60xl28cu-fox-1121.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]" fill="none">
        <EcosystemGoldDefs id="eco_glow" />
        <circle cx="50" cy="50" r="38" stroke="url(#eco_glow)" strokeWidth="6" />
        <path d="M50 20c-13.5 0-21.8 9.8-21.8 23.6 0 7.5 1.9 15 5.6 20.9 3.4 5.6 9 9.5 16.2 9.5s12.8-3.9 16.2-9.5c3.7-5.9 5.6-13.4 5.6-20.9C71.8 29.8 63.5 20 50 20z" fill="url(#eco_glow)" />
        <path d="M74 22l2.8 7.6L84.5 32.5l-7.7 2.9L74 43l-2.8-7.6-7.7-2.9 7.7-2.9L74 22z" stroke="url(#eco_glow)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'scribe',
    name: 'Flux Scribe',
    url: 'https://flux-scribe-otzr.vercel.app/',
    logo: (
      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(191,149,63,0.4)]" fill="none">
        <EcosystemGoldDefs id="eco_scribe" />
        <circle cx="50" cy="50" r="14.5" stroke="url(#eco_scribe)" strokeWidth="3.5" />
        <path d="M50.0 28.0L50.0 10.3M53.1 28.2L55.6 11.3M56.2 28.9L60.4 14.5M59.1 30.0L65.1 16.9M61.9 31.5L69.9 19.1M64.4 33.4L73.6 22.8M66.6 35.6L75.7 27.7M68.5 38.1L77.9 32.1M70.0 40.9L81.5 35.6M71.1 43.8L84.8 39.8M71.8 46.9L84.4 45.0M72.0 50.0L80.7 50.0M71.8 53.1L77.5 54.0M71.1 56.2L77.7 58.1M70.0 59.1L79.5 63.5M68.5 61.9L79.7 69.1M66.6 64.4L77.5 73.8M64.4 66.6L74.4 78.2M61.9 68.5L71.1 82.8M59.1 70.0L66.6 86.3M56.2 71.1L60.6 86.2M53.1 71.8L54.8 83.6M50.0 72.0L50.0 82.1M46.9 71.8L45.2 83.6M43.8 71.1L39.4 86.2M40.9 70.0L33.4 86.3M38.1 68.5L28.9 82.8M35.6 66.6L25.6 78.2M33.4 64.4L22.5 73.8M31.5 61.9L20.3 69.1M30.0 59.1L20.5 63.5M28.9 56.2L22.3 58.1M28.2 53.1L22.5 54.0M28.0 50.0L19.3 50.0M28.2 46.9L15.6 45.0M28.9 43.8L15.2 39.8M30.0 40.9L18.5 35.6M31.5 38.1L22.1 32.1M33.4 35.6L24.3 27.7M35.6 33.4L26.4 22.8M38.1 31.5L30.1 19.1M40.9 30.0L34.9 16.9M43.8 28.9L39.6 14.5M46.9 28.2L44.4 11.3" stroke="url(#eco_scribe)" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
] as const

export default function EcosystemTicker() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isPaused, setIsPaused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)
  const hasMoved = useRef(false)
  const displayApps = [...ECOSYSTEM_APPS, ...ECOSYSTEM_APPS, ...ECOSYSTEM_APPS]

  useEffect(() => {
    let animationId: number
    const animate = () => {
      if (scrollRef.current && !isPaused && !isDragging) {
        scrollRef.current.scrollLeft += 0.5
        const container = scrollRef.current
        const setWidth = container.scrollWidth / 3
        if (container.scrollLeft >= setWidth * 2) {
          container.scrollLeft -= setWidth
        } else if (container.scrollLeft <= 0) {
          container.scrollLeft += setWidth
        }
      }
      animationId = requestAnimationFrame(animate)
    }
    animationId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationId)
  }, [isPaused, isDragging])

  const handleAppClick = (url: string, e: MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const onMouseDown = (e: MouseEvent) => {
    setIsDragging(true)
    setIsPaused(true)
    hasMoved.current = false
    startX.current = e.pageX - scrollRef.current!.offsetLeft
    scrollLeft.current = scrollRef.current!.scrollLeft
  }
  const onMouseLeave = () => {
    setIsDragging(false)
    setIsPaused(false)
  }
  const onMouseUp = () => {
    setIsDragging(false)
    setIsPaused(false)
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!isDragging) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current!.offsetLeft
    const walk = (x - startX.current) * 1.5
    if (Math.abs(walk) > 5) hasMoved.current = true
    scrollRef.current!.scrollLeft = scrollLeft.current - walk
  }

  return (
    <div className="mt-12 pt-6 border-t border-white/5">
      <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-4">More from Flux</p>
      <div
        className="w-full overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing"
        ref={scrollRef}
        onMouseDown={onMouseDown}
        onMouseLeave={onMouseLeave}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        <div className="flex w-max">
          {displayApps.map((app, idx) => (
            <div key={`${app.id}-${idx}`} className="mx-3 py-2">
              <button
                onClick={(e) => handleAppClick(app.url, e)}
                className="w-20 h-20 rounded-2xl bg-surface-card border border-white/5 flex flex-col items-center justify-center gap-1 transition-transform duration-300 hover:scale-110 group/item relative hover:border-gold/50 hover:bg-gold/5 cursor-pointer shadow-lg shadow-black/50"
              >
                <div className="w-9 h-9 flex items-center justify-center transition-transform duration-300 group-hover/item:-translate-y-1">
                  {app.logo}
                </div>
                <span className="text-[6px] font-bold uppercase tracking-wider opacity-0 group-hover/item:opacity-100 transition-opacity absolute bottom-2 w-full text-center px-1 leading-tight text-gold">
                  {app.name}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
