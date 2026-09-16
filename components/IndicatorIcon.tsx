import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  momentum: (
    <path d="M3 17l5-5 4 4 8-8M20 8h-4M20 8v4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  trendExtension: (
    <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" strokeLinecap="round" strokeLinejoin="round" />
  ),
  concentration: (
    <path
      d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3zM5 17h.01M19 17h.01"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  complacency: (
    <path d="M3 12h3l2-7 4 14 2-7h3M17 12h4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  creditAppetite: (
    <path
      d="M3 7h18v10H3V7zM3 10h18M7 15h4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  monetaryStimulus: (
    <path
      d="M12 2v20M17 6.5c0-1.7-2-3-5-3s-5 1.3-5 3 2 3 5 3 5 1.3 5 3-2 3-5 3-5-1.3-5-3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  volumeSurge: (
    <path d="M4 20V10M10 20V4M16 20v-7M22 20V13" strokeLinecap="round" strokeLinejoin="round" />
  ),
}

export default function IndicatorIcon({ id, color }: { id: string; color: string }) {
  const path = PATHS[id]
  if (!path) return null
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      className="flex-shrink-0"
    >
      {path}
    </svg>
  )
}
