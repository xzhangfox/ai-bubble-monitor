'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, animate, motion, useAnimationFrame, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { getScoreCategory } from '@/lib/scoreColor'

export interface BubbleIndicator {
  id: string
  name: string
  score: number | null
}

export interface BubblePoint {
  date: string
  compositeScore: number | null
  indicatorScores: Record<string, number | null>
}

interface Props {
  score: number
  indicators: BubbleIndicator[]
  history: BubblePoint[]
  categories: Record<string, string>
  liveLabel: string
  hint: string
  stripLabel: string
  ariaLabel: string
  onSelectIndicator: (id: string) => void
}

const SIZE = 360
const C = SIZE / 2
const TAU = Math.PI * 2
const N_BLOB = 36

type RGB = [number, number, number]

// Same hues as lib/scoreColor's five bands, but blended between anchors so
// the bubble drifts through colour continuously instead of snapping at 24/44/64/84.
const STOPS: [number, RGB][] = [
  [8, [74, 222, 128]],
  [34, [201, 168, 76]],
  [54, [232, 147, 74]],
  [74, [232, 98, 60]],
  [92, [226, 60, 78]],
]

function scoreRgb(score: number): RGB {
  if (score <= STOPS[0][0]) return STOPS[0][1]
  for (let i = 1; i < STOPS.length; i++) {
    const [s1, c1] = STOPS[i]
    if (score <= s1) {
      const [s0, c0] = STOPS[i - 1]
      const t = (score - s0) / (s1 - s0)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

const rgbStr = (c: RGB) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// A closed wobbling outline: a circle whose radius is modulated by a few
// travelling sine waves, smoothed into cubic Béziers (Catmull-Rom).
function blobPath(cx: number, cy: number, R: number, amp: number, t: number, speed: number, jitter: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < N_BLOB; i++) {
    const th = (i / N_BLOB) * TAU
    const w = Math.sin(th * 2 + t * 0.9 * speed) * 0.5 + Math.sin(th * 3 - t * 1.3 * speed + 1.7) * 0.3 + Math.sin(th * 5 + t * 2.1 * speed + 4.1) * 0.2
    const r = R * (1 + amp * w + jitter * Math.sin(th * 9 + t * 14))
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)])
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < N_BLOB; i++) {
    const p0 = pts[(i - 1 + N_BLOB) % N_BLOB]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % N_BLOB]
    const p3 = pts[(i + 2) % N_BLOB]
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return `${d}Z`
}

// Hairline fractures that fade in as the score nears the top of the scale.
// Authored for R = 100, scaled to the live radius.
const CRACKS = [
  'M 70 -50 L 55 -38 L 60 -22 L 42 -12 L 46 2',
  'M -75 30 L -58 22 L -62 8 L -44 0',
  'M 10 88 L 18 70 L 6 58 L 14 44',
]

// Deterministic (no Math.random) so server and client render identically.
const SPARKS = Array.from({ length: 10 }, (_, i) => ({
  hx: ((i * 61) % 97) / 97,
  speed: 0.05 + ((i * 17) % 11) / 200,
  size: 1.2 + ((i * 7) % 5) * 0.35,
  seed: ((i * 29) % 53) / 53,
}))

export default function LivingBubble({ score, indicators, history, categories, liveLabel, hint, stripLabel, ariaLabel, onSelectIndicator }: Props) {
  const uid = useId().replace(/:/g, '')
  const reduce = useReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const figRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<SVGPathElement>(null)
  const rimRef = useRef<SVGPathElement>(null)
  const glowRef = useRef<SVGCircleElement>(null)
  const sheenRef = useRef<SVGLinearGradientElement>(null)
  const hi1Ref = useRef<SVGEllipseElement>(null)
  const hi2Ref = useRef<SVGEllipseElement>(null)
  const cracksRef = useRef<SVGGElement>(null)
  const sparkRefs = useRef<(SVGCircleElement | null)[]>([])
  const satGRefs = useRef<(SVGGElement | null)[]>([])
  const satCRefs = useRef<(SVGCircleElement | null)[]>([])

  const inView = useInView(rootRef, { margin: '200px' })
  const inViewRef = useRef(false)
  useEffect(() => {
    inViewRef.current = inView
  }, [inView])

  // ---- what the bubble currently shows: live, or a day picked from history ----
  const points = useMemo(() => history.filter((p) => p.compositeScore !== null), [history])
  const last = points.length - 1
  const [scrubIdx, setScrubIdx] = useState<number | null>(null)
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const holdScrub = useCallback(
    (i: number) => {
      clearTimeout(releaseTimer.current)
      setScrubIdx(clamp(i, 0, last))
    },
    [last],
  )
  const scheduleRelease = useCallback((ms = 1500) => {
    clearTimeout(releaseTimer.current)
    releaseTimer.current = setTimeout(() => setScrubIdx(null), ms)
  }, [])
  useEffect(() => () => clearTimeout(releaseTimer.current), [])

  const active = scrubIdx !== null ? points[scrubIdx] : null
  const targetScore = active ? (active.compositeScore as number) : score
  const targetInds = useMemo(() => indicators.map((ind) => (active ? active.indicatorScores[ind.id] ?? null : ind.score)), [active, indicators])
  const categoryKey = getScoreCategory(targetScore)

  const targetIndsRef = useRef(targetInds)
  const indicatorsRef = useRef(indicators)
  useEffect(() => {
    targetIndsRef.current = targetInds
    indicatorsRef.current = indicators
  }, [targetInds, indicators])

  // ---- motion values read by the frame loop ----
  const shown = useSpring(0, { stiffness: 90, damping: 15, mass: 0.9 })
  const parX = useSpring(0, { stiffness: 110, damping: 16 })
  const parY = useSpring(0, { stiffness: 110, damping: 16 })
  const squish = useMotionValue(0)
  const rounded = useTransform(shown, (v) => String(Math.round(clamp(v, 0, 100))))
  const satVals = useRef<number[]>(indicators.map((i) => i.score ?? 0))
  const hoverRef = useRef<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const started = useRef(false)

  const draw = useCallback(
    (t: number, dt: number) => {
      const root = rootRef.current
      if (!root) return
      const sc = clamp(shown.get(), 0, 100)
      const f = sc / 100
      root.style.setProperty('--bub-rgb', rgbStr(scoreRgb(sc)))

      const px = parX.get()
      const py = parY.get()
      const cx = C + px * 6
      const cy = C + py * 6
      const breath = 1 + 0.018 * Math.sin(t * (1.4 + 4.5 * f))
      const R = (74 + 0.46 * sc) * breath * (1 + 0.07 * squish.get())
      const amp = reduce ? 0 : 0.012 + 0.07 * Math.pow(f, 1.6)
      const speed = 0.5 + 1.7 * f
      const jitter = !reduce && sc > 80 ? ((sc - 80) / 20) * 0.012 : 0
      const d = blobPath(cx, cy, R, amp, t, speed, jitter)
      bodyRef.current?.setAttribute('d', d)
      rimRef.current?.setAttribute('d', d)

      glowRef.current?.setAttribute('cx', cx.toFixed(1))
      glowRef.current?.setAttribute('cy', cy.toFixed(1))
      glowRef.current?.setAttribute('r', (R * 1.5).toFixed(1))
      sheenRef.current?.setAttribute('gradientTransform', `rotate(${(t * 22 + px * 50).toFixed(1)} 0.5 0.5)`)

      hi1Ref.current?.setAttribute('rx', (R * 0.3).toFixed(1))
      hi1Ref.current?.setAttribute('ry', (R * 0.14).toFixed(1))
      hi1Ref.current?.setAttribute('transform', `translate(${(cx - R * 0.42 - px * 10).toFixed(1)} ${(cy - R * 0.46 - py * 10).toFixed(1)}) rotate(-32)`)
      hi2Ref.current?.setAttribute('rx', (R * 0.05).toFixed(1))
      hi2Ref.current?.setAttribute('ry', (R * 0.05).toFixed(1))
      hi2Ref.current?.setAttribute('transform', `translate(${(cx + R * 0.5 - px * 6).toFixed(1)} ${(cy + R * 0.46 - py * 6).toFixed(1)})`)

      const cracks = cracksRef.current
      if (cracks) {
        cracks.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${(R / 100).toFixed(3)})`)
        cracks.style.opacity = String(clamp((sc - 82) / 12, 0, 1))
      }

      SPARKS.forEach((sp, i) => {
        const el = sparkRefs.current[i]
        if (!el) return
        const u = (t * sp.speed * (0.4 + f * 1.6) + sp.seed) % 1
        el.setAttribute('cx', (cx + (sp.hx - 0.5) * R * 1.25).toFixed(1))
        el.setAttribute('cy', (cy + R * 0.72 - u * R * 1.44).toFixed(1))
        el.style.opacity = String(reduce ? 0 : Math.sin(u * Math.PI) * 0.75)
      })

      const inds = indicatorsRef.current
      const n = inds.length
      const k = reduce ? 1 : 1 - Math.exp(-dt * 7)
      for (let i = 0; i < n; i++) {
        const g = satGRefs.current[i]
        const c = satCRefs.current[i]
        if (!g || !c) continue
        const target = targetIndsRef.current[i] ?? 0
        satVals.current[i] += (target - satVals.current[i]) * k
        const v = satVals.current[i]
        const a = (i / n) * TAU + (reduce ? 0 : t * (0.16 + 0.06 * f))
        const ex = 158 * Math.cos(a)
        const ey = 138 * Math.sin(a)
        const tilt = -0.32
        const x = cx - px * 8 + ex * Math.cos(tilt) - ey * Math.sin(tilt)
        const y = cy - py * 8 + ex * Math.sin(tilt) + ey * Math.cos(tilt)
        const z = Math.sin(a)
        const r = (7 + v * 0.075) * (0.85 + 0.15 * z) * (hoverRef.current === inds[i].id ? 1.4 : 1)
        g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
        g.style.opacity = String(0.55 + 0.45 * (z * 0.5 + 0.5))
        c.setAttribute('r', r.toFixed(1))
        c.setAttribute('fill', `rgb(${rgbStr(scoreRgb(v))})`)
      }
    },
    [shown, parX, parY, squish, reduce],
  )

  useAnimationFrame((time, delta) => {
    if (reduce || !inViewRef.current) return
    draw(time / 1000, delta / 1000)
  })

  // Inflate from empty the first time it scrolls into view, then follow the target.
  useEffect(() => {
    if (!inView && !started.current) return
    started.current = true
    if (reduce) shown.jump(targetScore)
    else shown.set(targetScore)
  }, [inView, targetScore, reduce, shown])

  // Reduced motion: no loop, so repaint once whenever the target changes.
  useEffect(() => {
    if (!reduce) return
    satVals.current = targetInds.map((v) => v ?? 0)
    draw(0, 0)
  }, [reduce, targetInds, targetScore, draw])

  const [ripples, setRipples] = useState<number[]>([])
  const drag = useRef<{ startX: number; startIdx: number; width: number; moved: boolean } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { startX: e.clientX, startIdx: scrubIdx ?? last, width: rect.width, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!reduce) {
      animate(squish, [0, 1, 0], { duration: 0.55, ease: 'easeOut' })
      setRipples((r) => [...r, Date.now()])
    }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    parX.set(clamp(((e.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1))
    parY.set(clamp(((e.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1))
    const d = drag.current
    if (!d || last < 1) return
    if (!d.moved && Math.abs(e.clientX - d.startX) < 4) return
    d.moved = true
    // Relative drag: a full bubble-width sweep replays ~90% of the history,
    // so a plain tap never teleports away from today.
    holdScrub(d.startIdx + Math.round(((e.clientX - d.startX) / d.width) * points.length * 0.9))
  }
  const endDrag = () => {
    if (drag.current?.moved) scheduleRelease()
    drag.current = null
  }
  const onPointerLeave = () => {
    parX.set(0)
    parY.set(0)
  }

  const setHover = (id: string | null) => {
    hoverRef.current = id
    setHoverId(id)
  }

  const hoverIdx = hoverId ? indicators.findIndex((i) => i.id === hoverId) : -1
  const hoverVal = hoverIdx >= 0 ? targetInds[hoverIdx] : null
  const initialRgb = rgbStr(scoreRgb(score))

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-[420px]" style={{ '--bub-rgb': initialRgb } as CSSProperties}>
      <div
        ref={figRef}
        role="img"
        aria-label={ariaLabel}
        className="relative aspect-square w-full cursor-grab select-none active:cursor-grabbing"
        style={{ touchAction: 'pan-y', containerType: 'inline-size' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full overflow-visible">
          <defs>
            <radialGradient id={`${uid}-glow`}>
              <stop offset="0%" style={{ stopColor: 'rgba(var(--bub-rgb),0.30)' }} />
              <stop offset="55%" style={{ stopColor: 'rgba(var(--bub-rgb),0.10)' }} />
              <stop offset="100%" style={{ stopColor: 'rgba(var(--bub-rgb),0)' }} />
            </radialGradient>
            <radialGradient id={`${uid}-body`} cx="38%" cy="32%" r="78%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
              <stop offset="55%" style={{ stopColor: 'rgba(var(--bub-rgb),0.07)' }} />
              <stop offset="100%" style={{ stopColor: 'rgba(var(--bub-rgb),0.30)' }} />
            </radialGradient>
            <linearGradient id={`${uid}-sheen`} ref={sheenRef} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'rgba(var(--bub-rgb),0.95)' }} />
              <stop offset="28%" stopColor="rgba(120,220,255,0.85)" />
              <stop offset="50%" stopColor="rgba(255,255,255,0.95)" />
              <stop offset="72%" stopColor="rgba(255,150,230,0.85)" />
              <stop offset="100%" style={{ stopColor: 'rgba(var(--bub-rgb),0.95)' }} />
            </linearGradient>
          </defs>

          <circle ref={glowRef} cx={C} cy={C} r={110} fill={`url(#${uid}-glow)`} />

          {SPARKS.map((sp, i) => (
            <circle key={i} ref={(el) => { sparkRefs.current[i] = el }} cx={C} cy={C} r={sp.size} opacity={0} style={{ fill: 'rgb(var(--bub-rgb))' }} />
          ))}

          <path ref={bodyRef} d="" fill={`url(#${uid}-body)`} />
          <g ref={cracksRef} style={{ opacity: 0 }} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {CRACKS.map((d) => (
              <path key={d} d={d} stroke="rgba(255,255,255,0.85)" strokeWidth={1.6} />
            ))}
          </g>
          <path ref={rimRef} d="" fill="none" stroke={`url(#${uid}-sheen)`} strokeWidth={2.5} strokeLinejoin="round" />
          <ellipse ref={hi1Ref} cx={0} cy={0} rx={30} ry={14} fill="rgba(255,255,255,0.22)" />
          <ellipse ref={hi2Ref} cx={0} cy={0} rx={5} ry={5} fill="rgba(255,255,255,0.4)" />

          {ripples.map((id) => (
            <motion.circle
              key={id}
              cx={C}
              cy={C}
              r={100}
              fill="none"
              strokeWidth={2}
              style={{ stroke: 'rgba(var(--bub-rgb),0.6)', transformBox: 'fill-box', transformOrigin: 'center' }}
              initial={{ scale: 0.9, opacity: 0.7 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              onAnimationComplete={() => setRipples((r) => r.filter((x) => x !== id))}
            />
          ))}

          {indicators.map((ind, i) => (
            <g
              key={ind.id}
              ref={(el) => { satGRefs.current[i] = el }}
              role="button"
              tabIndex={0}
              aria-label={`${ind.name}: ${targetInds[i] === null ? '—' : Math.round(targetInds[i] as number)}`}
              className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-white"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerEnter={() => setHover(ind.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(ind.id)}
              onBlur={() => setHover(null)}
              onClick={() => onSelectIndicator(ind.id)}
              onKeyDown={(e: KeyboardEvent<SVGGElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectIndicator(ind.id)
                }
              }}
            >
              <circle ref={(el) => { satCRefs.current[i] = el }} r={10} fill="rgb(var(--bub-rgb))" stroke="rgba(255,255,255,0.35)" strokeWidth={1.2} />
              <circle r={18} fill="transparent" />
            </g>
          ))}
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="flex items-baseline gap-1" style={{ color: 'rgb(var(--bub-rgb))' }}>
            <motion.span className="font-mono font-bold tabular-nums leading-none" style={{ fontSize: '14cqw', textShadow: '0 2px 24px rgba(0,0,0,0.5)' }}>
              {rounded}
            </motion.span>
            <span className="font-mono text-white/35" style={{ fontSize: 'clamp(0.6rem, 3.6cqw, 0.9rem)' }}>/ 100</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={categoryKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="mt-1 font-mono uppercase tracking-[0.25em]"
              style={{ color: 'rgb(var(--bub-rgb))', fontSize: 'clamp(0.6rem, 3.2cqw, 0.8rem)' }}
            >
              {categories[categoryKey] ?? categoryKey}
            </motion.span>
          </AnimatePresence>
          <span className="mt-1.5 flex items-center gap-1.5 font-mono text-white/45" style={{ fontSize: 'clamp(0.55rem, 3cqw, 0.75rem)' }}>
            {active ? (
              active.date
            ) : (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4ADE80]" />
                {liveLabel}
              </>
            )}
          </span>
        </div>
      </div>

      <p className="mt-1 min-h-5 text-center font-mono text-xs text-white/40" aria-live="polite">
        {hoverIdx >= 0 ? `${indicators[hoverIdx].name} · ${hoverVal === null ? '—' : Math.round(hoverVal)}` : hint}
      </p>

      {last >= 1 && (
        <HistoryStrip
          points={points}
          idx={scrubIdx}
          label={stripLabel}
          onScrub={holdScrub}
          onRelease={() => scheduleRelease(2800)}
        />
      )}
    </div>
  )
}

const yPct = (score: number) => 90 - score * 0.8

function HistoryStrip({ points, idx, label, onScrub, onRelease }: { points: BubblePoint[]; idx: number | null; label: string; onScrub: (i: number) => void; onRelease: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = points.length - 1
  const cur = idx ?? last
  const curPoint = points[cur]

  const path = useMemo(() => {
    const step = Math.max(1, Math.floor(points.length / 180))
    let d = ''
    for (let i = 0; i < points.length; i += step) {
      d += `${d ? 'L' : 'M'}${((i / last) * 100).toFixed(2)} ${yPct(points[i].compositeScore as number).toFixed(1)}`
    }
    return `${d}L100 ${yPct(points[last].compositeScore as number).toFixed(1)}`
  }, [points, last])

  const fromX = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return cur
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * last)
  }

  return (
    <div className="mt-3">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={cur}
        aria-valuetext={`${curPoint.date}: ${Math.round(curPoint.compositeScore as number)}`}
        className="relative h-10 cursor-ew-resize touch-none rounded-md outline-none focus-visible:ring-1 focus-visible:ring-white/40"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onScrub(fromX(e.clientX))
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(fromX(e.clientX))
        }}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onBlur={onRelease}
        onKeyDown={(e) => {
          const big = e.shiftKey ? 30 : 1
          if (e.key === 'ArrowLeft') onScrub(cur - big)
          else if (e.key === 'ArrowRight') onScrub(cur + big)
          else if (e.key === 'Home') onScrub(0)
          else if (e.key === 'End') onScrub(last)
          else return
          e.preventDefault()
        }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <path d={path} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="absolute inset-y-0 w-px -translate-x-1/2" style={{ left: `${(cur / last) * 100}%`, backgroundColor: 'rgba(var(--bub-rgb),0.55)' }} />
        <div
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60"
          style={{ left: `${(cur / last) * 100}%`, top: `${yPct(curPoint.compositeScore as number)}%`, backgroundColor: 'rgb(var(--bub-rgb))' }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.6rem] text-white/25">
        <span>{points[0].date.slice(0, 4)}</span>
        <span>{points[last].date.slice(0, 4)}</span>
      </div>
    </div>
  )
}
