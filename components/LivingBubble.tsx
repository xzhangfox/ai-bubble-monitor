'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, animate, motion, useAnimationFrame, useInView, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
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
// Tiny bubbles that fizz up out of the digits.
const FIZZ = Array.from({ length: 28 }, (_, i) => ({
  x: (((i * 37) % 29) / 28) * 2 - 1,
  speed: 0.1 + (((i * 13) % 17) / 17) * 0.2,
  size: 0.9 + ((i * 7) % 6) * 0.38,
  seed: ((i * 29) % 53) / 53,
  ph: i * 1.7,
}))

// The indicators ride a ring tilted 45° left-right and 45° front-back, projected
// with a mild perspective: whatever swings toward the viewer (z > 0) grows and
// passes in front of the bubble, whatever swings behind shrinks and passes behind it.
const RING = 162
const TILT = Math.PI / 4
const COS_T = Math.cos(TILT)
const SIN_T = Math.sin(TILT)
const DEPTH = 0.3
const Z_MAX = RING * 0.87

function ringPoint(a: number): [number, number, number, number] {
  const x0 = RING * Math.cos(a)
  const y0 = RING * Math.sin(a)
  const y1 = y0 * COS_T
  const z1 = y0 * SIN_T
  const x2 = x0 * COS_T + z1 * SIN_T
  const z2 = -x0 * SIN_T + z1 * COS_T
  const s = 1 + DEPTH * (z2 / RING)
  return [x2 * s, y1 * s, z2, s]
}

// The ring itself, split into the half in front of the bubble and the half behind it.
const RING_PATHS = (() => {
  const N = 90
  const pts = Array.from({ length: N + 1 }, (_, i) => ringPoint((i / N) * TAU))
  let front = ''
  let back = ''
  let prev = ''
  for (let i = 0; i < N; i++) {
    const [x0, y0, z0] = pts[i]
    const [x1, y1, z1] = pts[i + 1]
    const kind = z0 + z1 >= 0 ? 'f' : 'b'
    const seg = `${kind !== prev ? `M${x0.toFixed(1)} ${y0.toFixed(1)}` : ''}L${x1.toFixed(1)} ${y1.toFixed(1)}`
    if (kind === 'f') front += seg
    else back += seg
    prev = kind
  }
  return { front, back }
})()

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
  const fizzRefs = useRef<(SVGCircleElement | null)[]>([])
  const labelsRef = useRef<SVGGElement>(null)
  const numRef = useRef<SVGTextElement>(null)
  const numGradRef = useRef<SVGLinearGradientElement>(null)
  const ringBackRef = useRef<SVGPathElement>(null)
  const ringFrontRef = useRef<SVGPathElement>(null)
  // Each indicator is drawn twice: a copy behind the bubble and a copy in front of it,
  // and the frame loop shows whichever side of the ring it is currently on.
  // f/b = front/back; v = whole bubble, s = scaled shapes, t = number label.
  const satEls = useRef<Record<string, (SVGElement | null)[]>>({ fv: [], bv: [], fs: [], bs: [], ft: [], bt: [], hit: [] })

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
      hi2Ref.current?.setAttribute('rx', (R * 0.022).toFixed(1))
      hi2Ref.current?.setAttribute('ry', (R * 0.022).toFixed(1))
      hi2Ref.current?.setAttribute('transform', `translate(${(cx + R * 0.5 - px * 6).toFixed(1)} ${(cy + R * 0.46 - py * 6).toFixed(1)})`)

      const cracks = cracksRef.current
      if (cracks) {
        cracks.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${(R / 100).toFixed(3)})`)
        cracks.style.opacity = String(clamp((sc - 82) / 12, 0, 1))
      }

      // The big number sits dead centre; the small print hangs underneath it.
      labelsRef.current?.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`)
      const txt = String(Math.round(sc))
      const num = numRef.current
      if (num && num.textContent !== txt) num.textContent = txt
      // Light drifting up through the digits, like fizz catching the light.
      numGradRef.current?.setAttribute('gradientTransform', `translate(0 ${(-((t * 0.22) % 0.6)).toFixed(3)})`)

      // Carbonation: tiny bubbles are born at the foot of the digits and rise through them.
      const half = Math.max(16, txt.length * 15)
      const flow = 0.55 + 1.3 * f
      const yFoot = cy + 22
      const yTop = cy - R * 0.86
      FIZZ.forEach((fz, i) => {
        const el = fizzRefs.current[i]
        if (!el) return
        const u = (t * fz.speed * flow + fz.seed) % 1
        el.setAttribute('cx', (cx + fz.x * half + Math.sin(t * 1.7 + fz.ph) * (1.5 + 3 * u)).toFixed(1))
        el.setAttribute('cy', (yFoot - u * (yFoot - yTop)).toFixed(1))
        el.setAttribute('r', (fz.size * (0.6 + 0.7 * u)).toFixed(2))
        el.style.opacity = reduce ? '0' : String(Math.min(1, u / 0.1) * Math.min(1, (1 - u) / 0.3) * 0.9)
      })

      // The ring and the indicators riding it.
      const rcx = cx - px * 4
      const rcy = cy - py * 4
      const ringT = `translate(${rcx.toFixed(1)} ${rcy.toFixed(1)})`
      ringBackRef.current?.setAttribute('transform', ringT)
      ringFrontRef.current?.setAttribute('transform', ringT)

      const els = satEls.current
      const inds = indicatorsRef.current
      const n = inds.length
      const k = reduce ? 1 : 1 - Math.exp(-dt * 7)
      for (let i = 0; i < n; i++) {
        const target = targetIndsRef.current[i] ?? 0
        satVals.current[i] += (target - satVals.current[i]) * k
        const v = satVals.current[i]
        const a = (i / n) * TAU + (reduce ? 0 : t * (0.16 + 0.06 * f))
        const [dx, dy, z, s] = ringPoint(a)
        const front = z >= 0
        const side = front ? 'f' : 'b'
        const hide = els[(front ? 'b' : 'f') + 'v'][i]
        const vis = els[side + 'v'][i]
        if (hide) hide.style.display = 'none'
        const r = (12 + v * 0.09) * s * (hoverRef.current === inds[i].id ? 1.35 : 1)
        const x = rcx + dx
        const y = rcy + dy
        const hit = els.hit[i]
        if (hit) {
          hit.setAttribute('cx', x.toFixed(1))
          hit.setAttribute('cy', y.toFixed(1))
          hit.setAttribute('r', Math.max(13, r + 4).toFixed(1))
        }
        if (!vis) continue
        vis.style.display = ''
        vis.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
        vis.style.setProperty('--sat-rgb', rgbStr(scoreRgb(v)))
        vis.style.opacity = String(front ? 0.88 + 0.12 * (z / Z_MAX) : 0.42 + 0.3 * (1 + z / Z_MAX))
        els[side + 's'][i]?.setAttribute('transform', `scale(${r.toFixed(2)})`)
        const label = els[side + 't'][i]
        if (label) {
          const vt = String(Math.round(v))
          if (label.textContent !== vt) label.textContent = vt
          label.setAttribute('font-size', (r * 0.62).toFixed(1))
        }
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
    if (reduce) {
      shown.jump(targetScore)
      draw(0, 0)
    } else shown.set(targetScore)
  }, [inView, targetScore, reduce, shown, draw])

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

  // One indicator as a soap bubble: clear middle, bright edge, rainbow film, a glint, its score in faint print.
  const satVisual = (i: number, k: 'f' | 'b') => (
    <g key={k + i} ref={(el) => { satEls.current[k + 'v'][i] = el }} style={{ display: k === 'b' ? 'none' : undefined }}>
      <g ref={(el) => { satEls.current[k + 's'][i] = el }}>
        <circle r={1} style={{ fill: 'rgb(var(--sat-rgb))', fillOpacity: 0.16 }} />
        <circle r={1} fill={`url(#${uid}-fres)`} />
        <circle r={0.88} fill="none" strokeWidth={0.28} style={{ stroke: 'rgb(var(--sat-rgb))', strokeOpacity: 0.32 }} />
        <circle r={1} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
        <ellipse cx={-0.38} cy={-0.44} rx={0.28} ry={0.14} transform="rotate(-38 -0.38 -0.44)" fill="rgba(255,255,255,0.65)" />
        <circle cx={0.42} cy={0.46} r={0.07} fill="rgba(255,255,255,0.5)" />
      </g>
      <text ref={(el) => { satEls.current[k + 't'][i] = el }} textAnchor="middle" dominantBaseline="central" className="font-mono" fill="rgba(255,255,255,0.6)" pointerEvents="none">
        0
      </text>
    </g>
  )

  return (
    <div ref={rootRef} className="relative mx-auto w-full max-w-[420px]" style={{ '--bub-rgb': initialRgb } as CSSProperties}>
      <div
        ref={figRef}
        role="img"
        aria-label={ariaLabel}
        className="relative aspect-square w-full cursor-grab select-none active:cursor-grabbing"
        style={{ touchAction: 'pan-y' }}
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
            {/* The big number: a band of light that keeps climbing through the digits. */}
            <linearGradient id={`${uid}-num`} ref={numGradRef} x1="0" y1="0" x2="0" y2="0.6" spreadMethod="repeat">
              <stop offset="0%" style={{ stopColor: 'rgb(var(--bub-rgb))' }} />
              <stop offset="50%" style={{ stopColor: 'color-mix(in srgb, rgb(var(--bub-rgb)) 35%, white)' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--bub-rgb))' }} />
            </linearGradient>
            {/* Soap-bubble skin for the indicators: clear middle, bright thin edge, rainbow film. */}
            <radialGradient id={`${uid}-fres`}>
              <stop offset="55%" stopColor="rgba(255,255,255,0)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.34)" />
            </radialGradient>
            <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(170,235,255,0.95)" />
              <stop offset="45%" stopColor="rgba(255,255,255,0.5)" />
              <stop offset="75%" stopColor="rgba(255,170,235,0.85)" />
              <stop offset="100%" stopColor="rgba(190,170,255,0.9)" />
            </linearGradient>
            <radialGradient id={`${uid}-fizz`}>
              <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.38)" />
            </radialGradient>
          </defs>

          <circle ref={glowRef} cx={C} cy={C} r={110} fill={`url(#${uid}-glow)`} />

          {/* behind the bubble: far half of the ring, and the indicators currently on it */}
          <path ref={ringBackRef} d={RING_PATHS.back} fill="none" strokeWidth={1} strokeLinecap="round" style={{ stroke: 'rgba(var(--bub-rgb),0.22)' }} />
          <g aria-hidden="true" pointerEvents="none">
            {indicators.map((ind, i) => satVisual(i, 'b'))}
          </g>

          <path ref={bodyRef} d="" fill={`url(#${uid}-body)`} />
          <g ref={cracksRef} style={{ opacity: 0 }} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {CRACKS.map((d) => (
              <path key={d} d={d} stroke="rgba(255,255,255,0.85)" strokeWidth={1.6} />
            ))}
          </g>
          <path ref={rimRef} d="" fill="none" stroke={`url(#${uid}-sheen)`} strokeWidth={2.5} strokeLinejoin="round" />
          <ellipse ref={hi1Ref} cx={0} cy={0} rx={30} ry={14} fill="rgba(255,255,255,0.15)" />
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

          {/* the score: big number dead centre, the small print underneath */}
          <g ref={labelsRef} transform={`translate(${C} ${C})`} pointerEvents="none">
            <text
              ref={numRef}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={52}
              className="font-mono font-bold"
              fill={`url(#${uid}-num)`}
              style={{ filter: 'drop-shadow(0 0 7px rgba(var(--bub-rgb),0.45))' }}
            >
              0
            </text>
            <text y={35} textAnchor="middle" fontSize={9.5} className="font-mono" fill="rgba(255,255,255,0.3)">
              / 100
            </text>
            <g transform="translate(0 48)">
              <AnimatePresence mode="wait" initial={false}>
                <motion.text
                  key={categoryKey}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  textAnchor="middle"
                  fontSize={8}
                  className="font-mono uppercase"
                  style={{ fill: 'rgba(var(--bub-rgb),0.7)', letterSpacing: '0.2em' }}
                >
                  {categories[categoryKey] ?? categoryKey}
                </motion.text>
              </AnimatePresence>
            </g>
            <text y={61} textAnchor="middle" fontSize={7.5} className="font-mono" fill="rgba(255,255,255,0.28)">
              {active ? (
                active.date
              ) : (
                <>
                  <tspan fill="#4ADE80" className="animate-pulse">●</tspan> {liveLabel}
                </>
              )}
            </text>
          </g>

          {/* carbonation */}
          {FIZZ.map((fz, i) => (
            <circle key={i} ref={(el) => { fizzRefs.current[i] = el }} cx={C} cy={C} r={fz.size} fill={`url(#${uid}-fizz)`} stroke="rgba(255,255,255,0.8)" strokeWidth={0.7} opacity={0} />
          ))}

          {/* in front of the bubble: near half of the ring, and the indicators currently on it */}
          <path ref={ringFrontRef} d={RING_PATHS.front} fill="none" strokeWidth={1.3} strokeLinecap="round" style={{ stroke: 'rgba(var(--bub-rgb),0.5)' }} />
          {indicators.map((ind, i) => (
            <g
              key={ind.id}
              role="button"
              tabIndex={0}
              aria-label={`${ind.name}: ${targetInds[i] === null ? '—' : Math.round(targetInds[i] as number)}`}
              className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-white"
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
              {satVisual(i, 'f')}
              <circle ref={(el) => { satEls.current.hit[i] = el }} r={18} fill="transparent" stroke="transparent" strokeWidth={1.5} />
            </g>
          ))}
        </svg>
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
