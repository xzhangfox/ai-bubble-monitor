'use client'

import { useEffect, useRef, useState } from 'react'

/** A container's width in CSS pixels, kept current — so charts draw at their
 *  real size (text stays legible on a phone instead of shrinking with a viewBox). */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}
