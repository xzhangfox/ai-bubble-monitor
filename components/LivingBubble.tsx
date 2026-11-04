'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { AnimatePresence, animate, motion, useAnimationFrame, useInView, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { getScoreCategory } from '@/lib/scoreColor'
import { BubbleGL, type BubbleDraw, type ParticleDraw } from '@/lib/bubbleGL'

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

// The indicators ride an invisible ring around the bubble. The ring leans left-right and
// front-back by angles that wander to a new random pose every few seconds (it starts at 45°
// each), projected with a mild perspective: whatever swings toward the viewer (z > 0) grows
// and passes in front of the bubble, whatever swings behind shrinks and passes behind it.
const RING = 162
const DEPTH = 0.3

interface Tilt {
  x: number
  y: number
  tx: number
  ty: number
  next: number
}

function ringPoint(a: number, tx: number, ty: number): [number, number, number, number] {
  const x0 = RING * Math.cos(a)
  const y0 = RING * Math.sin(a)
  const y1 = y0 * Math.cos(tx)
  const z1 = y0 * Math.sin(tx)
  const x2 = x0 * Math.cos(ty) + z1 * Math.sin(ty)
  const z2 = -x0 * Math.sin(ty) + z1 * Math.cos(ty)
  const s = 1 + DEPTH * (z2 / RING)
  return [x2 * s, y1 * s, z2, s]
}

const easeOutBack = (u: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2)
}

// A popped bubble: film shards and droplets thrown outwards, and a bubble that is back
// (growing out of nothing) shortly after.
const N_TRI = 11
const N_DROP = 7
const SAT_HIDDEN = 0.85
const SAT_BACK = 1.35
const BIG_HIDDEN = 0.95
const BIG_BACK = 1.6
const SHARD_LIFE = 0.8

// ---- WebGL path: the film tears open instead of breaking into shards ----
// The canvases extend M svg units past the figure on every side so orbiting bubbles are not clipped.
const M = 56
// angular radius the hole has to reach to have eaten the whole sphere (plus its ragged edge)
const HOLE_MAX = Math.PI + 0.65
const NO_HOLE: [number, number, number, number] = [0, 0, 1, -1]

interface Pending {
  s: number
  phi: number
  kind: 0 | 1
  vr: number
  vt: number
  size: number
  life: number
  done: boolean
}

interface Part {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  age: number
  kind: 0 | 1
}

interface Pop {
  t0: number
  x: number
  y: number
  r: number
  rgb: string
  big: boolean
  tri: { ang: number; dist: number; size: number; spin: number }[]
  drop: { ang: number; dist: number; size: number }[]
  /** WebGL only: where the film was pierced (unit vector), how long the tear takes, and the droplets still to be shed */
  hole?: [number, number, number]
  T?: number
  pend?: Pending[]
}

function makeGlPop(t0: number, px: number, py: number, big: boolean): Pop {
  const d = Math.hypot(px, py)
  if (d > 0.88) {
    px *= 0.88 / d
    py *= 0.88 / d
  }
  const T = big ? 0.3 : 0.2
  const nMist = big ? 85 : 32
  const nDrop = big ? 22 : 8
  const pend: Pending[] = []
  for (let i = 0; i < nMist + nDrop; i++) {
    const drop = i >= nMist
    pend.push({
      s: Math.random() * T * 0.95,
      phi: Math.random() * TAU,
      kind: drop ? 1 : 0,
      vr: 0.25 + Math.random() * 0.9,
      vt: 0.3 + Math.random() * 1.3,
      size: drop ? (big ? 2.4 : 1.9) + Math.random() * (big ? 2.0 : 1.4) : (big ? 0.9 : 0.8) + Math.random() * 0.9,
      life: drop ? 0.45 + Math.random() * 0.5 : 0.25 + Math.random() * 0.4,
      done: false,
    })
  }
  return { t0, x: 0, y: 0, r: 0, rgb: '', big, tri: [], drop: [], hole: [px, py, Math.sqrt(1 - px * px - py * py)], T, pend }
}

// Shed the droplets whose moment has come, from wherever the tearing edge is now.
function spawnDue(pop: Pop, tau: number, cx: number, cy: number, R: number, out: Part[]) {
  const h = pop.hole
  const T = pop.T
  if (!h || !T || !pop.pend) return
  const ul = Math.hypot(h[2], h[0]) || 1
  const ux = -h[2] / ul
  const uz = h[0] / ul
  const vx = h[1] * uz
  const vy = h[2] * ux - h[0] * uz
  const speed = R * 0.7 + 30
  for (const p of pop.pend) {
    if (p.done || tau < p.s) continue
    p.done = true
    const th = HOLE_MAX * (p.s / T)
    const cp = Math.cos(p.phi)
    const sp = Math.sin(p.phi)
    const wx = cp * ux + sp * vx
    const wy = sp * vy
    const c = Math.cos(th)
    const s = Math.sin(th)
    const Px = c * h[0] + s * wx
    const Py = c * h[1] + s * wy
    const Tx = -s * h[0] + c * wx
    const Ty = -s * h[1] + c * wy
    const jit = () => (Math.random() - 0.5) * 0.5 * speed
    out.push({
      x: cx + Px * R,
      y: cy - Py * R,
      vx: (Px * p.vr + Tx * p.vt) * speed + jit(),
      vy: -(Py * p.vr + Ty * p.vt) * speed + jit(),
      size: p.size,
      life: p.life,
      age: 0,
      kind: p.kind,
    })
  }
}

interface BurstEls {
  g: SVGGElement | null
  flash: SVGCircleElement | null
  tri: (SVGPathElement | null)[]
  drop: (SVGCircleElement | null)[]
}

function makePop(t0: number, x: number, y: number, r: number, rgb: string, big: boolean): Pop {
  const reach = big ? 0.9 : 1.6
  const spread = big ? 0.9 : 1.8
  return {
    t0,
    x,
    y,
    r,
    rgb,
    big,
    tri: Array.from({ length: N_TRI }, (_, j) => ({
      ang: (j / N_TRI) * TAU + (Math.random() - 0.5) * 0.5,
      dist: r * (reach + Math.random() * spread),
      size: 0.6 + Math.random() * 0.8,
      spin: (Math.random() - 0.5) * 2.4,
    })),
    drop: Array.from({ length: N_DROP }, (_, j) => ({
      ang: (j / N_DROP) * TAU + Math.random() * 0.9,
      dist: r * (reach * 1.1 + Math.random() * spread * 1.3),
      size: 0.6 + Math.random() * 0.9,
    })),
  }
}

function paintBurst(b: BurstEls | undefined, pop: Pop | null, tau: number) {
  const g = b?.g
  if (!b || !g) return
  if (!pop || tau >= SHARD_LIFE) {
    if (g.style.display !== 'none') g.style.display = 'none'
    return
  }
  g.style.display = ''
  g.style.setProperty('--sat-rgb', pop.rgb)
  const u = tau / SHARD_LIFE
  const e = 1 - Math.pow(1 - u, 3)
  const fade = (1 - Math.pow(u, 1.6)).toFixed(2)
  const fall = pop.r * 0.9 * u * u
  const triScale = pop.r * (pop.big ? 0.12 : 0.27) * (1 - 0.45 * u)
  pop.tri.forEach((sh, j) => {
    const el = b.tri[j]
    if (!el) return
    const d = sh.dist * e
    el.setAttribute('transform', `translate(${(pop.x + Math.cos(sh.ang) * d).toFixed(1)} ${(pop.y + Math.sin(sh.ang) * d + fall).toFixed(1)}) rotate(${(sh.spin * u * 360).toFixed(0)}) scale(${(triScale * sh.size).toFixed(2)})`)
    el.style.opacity = fade
  })
  pop.drop.forEach((sh, j) => {
    const el = b.drop[j]
    if (!el) return
    const d = sh.dist * e
    el.setAttribute('cx', (pop.x + Math.cos(sh.ang) * d).toFixed(1))
    el.setAttribute('cy', (pop.y + Math.sin(sh.ang) * d + fall).toFixed(1))
    el.setAttribute('r', (pop.r * (pop.big ? 0.045 : 0.08) * sh.size * (1 - 0.6 * u)).toFixed(2))
    el.style.opacity = fade
  })
  // a ring of light that snaps outwards at the moment it goes
  const fl = b.flash
  if (fl) {
    const uf = Math.min(1, tau / 0.3)
    fl.setAttribute('cx', pop.x.toFixed(1))
    fl.setAttribute('cy', pop.y.toFixed(1))
    fl.setAttribute('r', (pop.r * (1 + 0.8 * uf)).toFixed(1))
    fl.style.opacity = ((1 - uf) * 0.9).toFixed(2)
  }
}

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
  const bodyGRef = useRef<SVGGElement>(null)
  // WebGL layers: one canvas behind the digits (far-side indicators + the big bubble), one in front of them.
  const backCv = useRef<HTMLCanvasElement>(null)
  const frontCv = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<{ back: BubbleGL; front: BubbleGL; u: number } | null>(null)
  const [glOn, setGlOn] = useState(false)
  const parts = useRef<Part[]>([])
  const tilt = useRef<Tilt>({ x: Math.PI / 4, y: Math.PI / 4, tx: Math.PI / 4, ty: Math.PI / 4, next: 3 })
  const clock = useRef(0)
  // pops[0..n-1] are the indicators, pops[n] is the big bubble; burst pools line up with them.
  const pops = useRef<(Pop | null)[]>([])
  const satPos = useRef<{ x: number; y: number; r: number }[]>([])
  const bigPos = useRef({ x: C, y: C, r: 100 })
  const burst = useRef<BurstEls[]>([])
  const burstEls = (i: number) => (burst.current[i] ??= { g: null, flash: null, tri: [], drop: [] })
  // Each indicator is drawn twice: a copy behind the bubble and a copy in front of it,
  // and the frame loop shows whichever side of the ring it is currently on.
  // f/b = front/back; v = whole bubble, s = scaled shapes, t = number label.
  const satEls = useRef<Record<string, (SVGElement | null)[]>>({ fv: [], bv: [], fs: [], bs: [], ft: [], bt: [], hit: [] })

  // Switch to the WebGL renderer when it is available; the SVG bubble stays as the fallback
  // (reduced motion, no WebGL, lost context).
  useEffect(() => {
    if (reduce) return
    const fig = figRef.current
    const bc = backCv.current
    const fc = frontCv.current
    if (!fig || !bc || !fc) return
    const back = BubbleGL.create(bc)
    const front = BubbleGL.create(fc)
    if (!back || !front) return
    const fail = () => {
      glRef.current = null
      setGlOn(false)
    }
    back.onLost = fail
    front.onLost = fail
    const fit = () => {
      const w = fig.getBoundingClientRect().width
      const u = (w / SIZE) * Math.min(window.devicePixelRatio || 1, 2)
      const px = (SIZE + 2 * M) * u
      back.resize(px, px)
      front.resize(px, px)
      if (glRef.current) glRef.current.u = u
      return u
    }
    glRef.current = { back, front, u: fit() }
    setGlOn(true)
    const ro = new ResizeObserver(fit)
    ro.observe(fig)
    return () => {
      ro.disconnect()
      glRef.current = null
      setGlOn(false)
    }
  }, [reduce])

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
      clock.current = t
      const sc = clamp(shown.get(), 0, 100)
      const f = sc / 100
      root.style.setProperty('--bub-rgb', rgbStr(scoreRgb(sc)))

      const px = parX.get()
      const py = parY.get()
      const cx = C + px * 6
      const cy = C + py * 6
      const breath = 1 + 0.018 * Math.sin(t * (1.4 + 4.5 * f))
      // The big bubble pops and grows back: pops[n] drives its size and visibility.
      const nInd = indicatorsRef.current.length
      const bigPop = pops.current[nInd]
      const gl = glRef.current
      let bigScale = 1
      let bigAlpha = 1
      let labelA = 1
      let bigHole = NO_HOLE
      if (bigPop) {
        const tau = t - bigPop.t0
        const T = bigPop.hole ? (bigPop.T as number) : 0
        if (tau < T) {
          // the film is tearing open: still there, with a hole sweeping round it
          bigHole = [bigPop.hole![0], bigPop.hole![1], bigPop.hole![2], HOLE_MAX * (tau / T)]
          labelA = 1 - 0.6 * (tau / T)
        } else if (tau < BIG_HIDDEN) {
          bigAlpha = 0
          bigScale = 0.25
          labelA = 0.4
        } else if (tau < BIG_BACK) {
          const u = (tau - BIG_HIDDEN) / (BIG_BACK - BIG_HIDDEN)
          bigScale = 0.25 + 0.75 * easeOutBack(u)
          bigAlpha = Math.min(1, u * 4)
          labelA = 0.4 + 0.6 * bigAlpha
        } else pops.current[nInd] = null
      }
      const R = (74 + 0.46 * sc) * breath * (1 + 0.07 * squish.get()) * bigScale
      bigPos.current = { x: cx, y: cy, r: (74 + 0.46 * sc) * breath }
      if (bodyGRef.current) bodyGRef.current.style.opacity = String(bigAlpha)
      const amp = reduce ? 0 : 0.012 + 0.07 * Math.pow(f, 1.6)
      if (!gl) {
        const speed = 0.5 + 1.7 * f
        const jitter = !reduce && sc > 80 ? ((sc - 80) / 20) * 0.012 : 0
        const d = blobPath(cx, cy, R, amp, t, speed, jitter)
        bodyRef.current?.setAttribute('d', d)
        rimRef.current?.setAttribute('d', d)
      }

      glowRef.current?.setAttribute('cx', cx.toFixed(1))
      glowRef.current?.setAttribute('cy', cy.toFixed(1))
      glowRef.current?.setAttribute('r', (R * 1.5).toFixed(1))
      sheenRef.current?.setAttribute('gradientTransform', `rotate(${(t * 22 + px * 50).toFixed(1)} 0.5 0.5)`)

      if (!gl) {
        hi1Ref.current?.setAttribute('rx', (R * 0.3).toFixed(1))
        hi1Ref.current?.setAttribute('ry', (R * 0.14).toFixed(1))
        hi1Ref.current?.setAttribute('transform', `translate(${(cx - R * 0.42 - px * 10).toFixed(1)} ${(cy - R * 0.46 - py * 10).toFixed(1)}) rotate(-32)`)
        hi2Ref.current?.setAttribute('rx', (R * 0.022).toFixed(1))
        hi2Ref.current?.setAttribute('ry', (R * 0.022).toFixed(1))
        hi2Ref.current?.setAttribute('transform', `translate(${(cx + R * 0.5 - px * 6).toFixed(1)} ${(cy + R * 0.46 - py * 6).toFixed(1)})`)
      }

      const cracks = cracksRef.current
      if (cracks) {
        cracks.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${(R / 100).toFixed(3)})`)
        cracks.style.opacity = String(clamp((sc - 82) / 12, 0, 1))
      }

      // The big number sits dead centre; the small print hangs underneath it.
      labelsRef.current?.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`)
      if (labelsRef.current) labelsRef.current.style.opacity = String(gl ? labelA : 0.4 + 0.6 * bigAlpha)
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
        el.style.opacity = reduce ? '0' : String(Math.min(1, u / 0.1) * Math.min(1, (1 - u) / 0.3) * 0.9 * (gl ? Math.max(0, (labelA - 0.4) / 0.6) : bigAlpha))
      })

      // The ring wanders to a new random lean every few seconds, and eases there.
      const tl = tilt.current
      if (!reduce) {
        if (t > tl.next) {
          tl.tx = 0.2 + Math.random() * 1.15
          tl.ty = (Math.random() * 2 - 1) * 1.15
          tl.next = t + 2.5 + Math.random() * 3.5
        }
        const kt = 1 - Math.exp(-dt * 0.9)
        tl.x += (tl.tx - tl.x) * kt
        tl.y += (tl.ty - tl.y) * kt
      }

      const rcx = cx - px * 4
      const rcy = cy - py * 4
      const els = satEls.current
      const inds = indicatorsRef.current
      const n = inds.length
      const k = reduce ? 1 : 1 - Math.exp(-dt * 7)
      const backList: { z: number; d: BubbleDraw }[] = []
      const frontList: { z: number; d: BubbleDraw }[] = []
      for (let i = 0; i < n; i++) {
        const target = targetIndsRef.current[i] ?? 0
        satVals.current[i] += (target - satVals.current[i]) * k
        const v = satVals.current[i]
        const a = (i / n) * TAU + (reduce ? 0 : t * (0.16 + 0.06 * f))
        const [dx, dy, z, s] = ringPoint(a, tl.x, tl.y)
        const zn = clamp(z / RING, -1, 1)
        const front = z >= 0
        const side = front ? 'f' : 'b'
        const hide = els[(front ? 'b' : 'f') + 'v'][i]
        const vis = els[side + 'v'][i]
        if (hide) hide.style.display = 'none'
        let r = (12 + v * 0.09) * s * (hoverRef.current === inds[i].id ? 1.35 : 1)
        const x = rcx + dx
        const y = rcy + dy
        satPos.current[i] = { x, y, r }
        const rgb = rgbStr(scoreRgb(v))

        // popped: nothing to see but the shards, then it grows back where it has orbited to
        let alpha = 1
        const pop = pops.current[i]
        let popped = false
        let tearing = false
        let hole = NO_HOLE
        if (pop) {
          const tau = t - pop.t0
          const T = pop.hole ? (pop.T as number) : 0
          if (tau < T) {
            tearing = true
            hole = [pop.hole![0], pop.hole![1], pop.hole![2], HOLE_MAX * (tau / T)]
            alpha = 1 - tau / T
            spawnDue(pop, tau, x, y, r, parts.current)
          } else if (tau < SAT_HIDDEN) popped = true
          else if (tau < SAT_BACK) {
            const u = (tau - SAT_HIDDEN) / (SAT_BACK - SAT_HIDDEN)
            r *= Math.max(0.01, easeOutBack(u))
            alpha = Math.min(1, u * 3)
          } else pops.current[i] = null
        }
        if (!gl) paintBurst(burst.current[i], pop ?? null, pop ? t - pop.t0 : 0)
        const hit = els.hit[i]
        if (hit) {
          hit.setAttribute('cx', x.toFixed(1))
          hit.setAttribute('cy', y.toFixed(1))
          hit.setAttribute('r', Math.max(13, r + 4).toFixed(1))
          hit.style.pointerEvents = popped || tearing ? 'none' : ''
        }
        if (gl && !popped) {
          const d: BubbleDraw = {
            x: (x + M) * gl.u,
            y: (y + M) * gl.u,
            r: r * gl.u,
            seed: 0.31 + i * 0.173,
            tint: [scoreRgb(v)[0] / 255, scoreRgb(v)[1] / 255, scoreRgb(v)[2] / 255],
            alpha: front ? 0.92 + 0.08 * zn : 0.5 + 0.3 * (1 + zn),
            wob: 0.03,
            thin: 0.12,
            glow: 1,
            hole,
          }
          ;(front ? frontList : backList).push({ z, d })
        }
        if (!vis) continue
        if (popped) {
          vis.style.display = 'none'
          continue
        }
        vis.style.display = ''
        vis.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`)
        vis.style.setProperty('--sat-rgb', rgb)
        vis.style.opacity = String(alpha * (front ? 0.88 + 0.12 * zn : 0.42 + 0.3 * (1 + zn)))
        els[side + 's'][i]?.setAttribute('transform', `scale(${r.toFixed(2)})`)
        const label = els[side + 't'][i]
        if (label) {
          const vt = String(Math.round(v))
          if (label.textContent !== vt) label.textContent = vt
          label.setAttribute('font-size', (r * 0.62).toFixed(1))
        }
      }
      if (!gl) {
        paintBurst(burst.current[n], bigPop ?? null, bigPop ? t - bigPop.t0 : 0)
        return
      }

      // ---- WebGL: hand both canvases this frame's bubbles and the flying droplets ----
      if (bigPop && bigPop.hole) spawnDue(bigPop, t - bigPop.t0, cx, cy, bigPos.current.r, parts.current)
      if (bigAlpha > 0.003 && R > 1) {
        const rgbF = scoreRgb(sc)
        backList.sort((a, b) => a.z - b.z)
        backList.push({
          z: 0,
          d: {
            x: (cx + M) * gl.u,
            y: (cy + M) * gl.u,
            r: R * gl.u,
            seed: 0.37,
            tint: [rgbF[0] / 255, rgbF[1] / 255, rgbF[2] / 255],
            alpha: bigAlpha,
            wob: amp * 0.8,
            thin: 0.22 + 0.15 * Math.sin(t * 0.09),
            glow: 1.2,
            hole: bigHole,
          },
        })
      } else backList.sort((a, b) => a.z - b.z)
      frontList.sort((a, b) => a.z - b.z)

      const step = Math.min(dt, 0.05)
      const live: ParticleDraw[] = []
      const ps = parts.current
      let w = 0
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.age += step
        if (p.age >= p.life) continue
        const drag = Math.exp(-(p.kind ? 0.7 : 2.0) * step)
        p.vx *= drag
        p.vy = p.vy * drag + (p.kind ? 190 : 60) * step
        p.x += p.vx * step
        p.y += p.vy * step
        const u = p.age / p.life
        live.push({ x: (p.x + M) * gl.u, y: (p.y + M) * gl.u, size: p.size * gl.u, alpha: Math.pow(1 - u, 1.4) * (p.kind ? 0.95 : 0.7), kind: p.kind })
        ps[w++] = p
      }
      ps.length = w
      gl.back.draw(t, backList.map((e) => e.d), [])
      gl.front.draw(t, frontList.map((e) => e.d), live)
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

  const drag = useRef<{ startX: number; startIdx: number; width: number; moved: boolean } | null>(null)

  // Where on a bubble (unit disc, y up) a pointer landed; somewhere near the middle when unknown.
  const touchPoint = (b: { x: number; y: number; r: number }, clientX?: number, clientY?: number): [number, number] => {
    const rect = figRef.current?.getBoundingClientRect()
    if (!rect || !clientX || !clientY) return [(Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8]
    const ux = ((clientX - rect.left) / rect.width) * SIZE
    const uy = ((clientY - rect.top) / rect.height) * SIZE
    return [(ux - b.x) / b.r, -(uy - b.y) / b.r]
  }
  const popSat = (i: number, clientX?: number, clientY?: number) => {
    if (reduce || pops.current[i]) return
    const p = satPos.current[i]
    if (!p) return
    if (glRef.current) {
      const [hx, hy] = touchPoint(p, clientX, clientY)
      pops.current[i] = makeGlPop(clock.current, hx, hy, false)
      return
    }
    pops.current[i] = makePop(clock.current, p.x, p.y, p.r, rgbStr(scoreRgb(satVals.current[i])), false)
  }
  const popBig = (clientX?: number, clientY?: number) => {
    const n = indicatorsRef.current.length
    if (reduce || pops.current[n]) return
    const b = bigPos.current
    if (glRef.current) {
      const [hx, hy] = touchPoint(b, clientX, clientY)
      pops.current[n] = makeGlPop(clock.current, hx, hy, true)
      return
    }
    pops.current[n] = makePop(clock.current, b.x, b.y, b.r, rgbStr(scoreRgb(shown.get())), true)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = { startX: e.clientX, startIdx: scrubIdx ?? last, width: rect.width, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!reduce) {
      animate(squish, [0, 1, 0], { duration: 0.55, ease: 'easeOut' })
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
  // a tap that goes nowhere pops the big bubble
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current && !drag.current.moved) popBig(e.clientX, e.clientY)
    endDrag()
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
  // the canvases cover the figure plus M svg units of margin on every side
  const canvasBox: CSSProperties = { left: `${(-M / SIZE) * 100}%`, top: `${(-M / SIZE) * 100}%`, width: `${((SIZE + 2 * M) / SIZE) * 100}%`, height: `${((SIZE + 2 * M) / SIZE) * 100}%`, zIndex: 2 }

  // One indicator as a soap bubble: clear middle, bright edge, rainbow film, a glint, its score in faint print.
  const satVisual = (i: number, k: 'f' | 'b') => (
    <g key={k + i} ref={(el) => { satEls.current[k + 'v'][i] = el }} style={{ display: k === 'b' ? 'none' : undefined }}>
      <g ref={(el) => { satEls.current[k + 's'][i] = el }} className="group-data-[gl=on]:hidden">
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
    <div ref={rootRef} data-gl={glOn ? 'on' : 'off'} className="group relative mx-auto w-full max-w-[420px]" style={{ '--bub-rgb': initialRgb } as CSSProperties}>
      <div
        ref={figRef}
        role="img"
        aria-label={ariaLabel}
        className="relative aspect-square w-full cursor-grab select-none active:cursor-grabbing"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
      >
        {/* the halo lives on its own layer so the WebGL bubbles are not tinted by it */}
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <defs>
            <radialGradient id={`${uid}-glow`}>
              <stop offset="0%" style={{ stopColor: 'rgba(var(--bub-rgb),0.30)' }} />
              <stop offset="55%" style={{ stopColor: 'rgba(var(--bub-rgb),0.10)' }} />
              <stop offset="100%" style={{ stopColor: 'rgba(var(--bub-rgb),0)' }} />
            </radialGradient>
          </defs>
          <circle ref={glowRef} cx={C} cy={C} r={110} fill={`url(#${uid}-glow)`} />
        </svg>
        <canvas ref={backCv} aria-hidden="true" className="pointer-events-none absolute" style={{ ...canvasBox, zIndex: 0 }} />
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative z-[1] h-full w-full overflow-visible">
          <defs>
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

          {/* behind the bubble: the indicators currently on the far side of their orbit */}
          <g aria-hidden="true" pointerEvents="none">
            {indicators.map((ind, i) => satVisual(i, 'b'))}
          </g>

          <g ref={bodyGRef}>
          <path ref={bodyRef} d="" fill={`url(#${uid}-body)`} className="group-data-[gl=on]:hidden" />
          <g ref={cracksRef} style={{ opacity: 0 }} fill="none" strokeLinecap="round" strokeLinejoin="round">
            {CRACKS.map((d) => (
              <path key={d} d={d} stroke="rgba(255,255,255,0.85)" strokeWidth={1.6} />
            ))}
          </g>
          <path ref={rimRef} d="" fill="none" stroke={`url(#${uid}-sheen)`} strokeWidth={2.5} strokeLinejoin="round" className="group-data-[gl=on]:hidden" />
          <ellipse ref={hi1Ref} cx={0} cy={0} rx={30} ry={14} fill="rgba(255,255,255,0.15)" className="group-data-[gl=on]:hidden" />
          <ellipse ref={hi2Ref} cx={0} cy={0} rx={5} ry={5} fill="rgba(255,255,255,0.4)" className="group-data-[gl=on]:hidden" />
          </g>

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

          {/* in front of the bubble: the indicators on the near side of their orbit */}
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
              onClick={(e) => popSat(i, e.clientX, e.clientY)}
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
          {/* shards of whatever has just popped */}
          <g aria-hidden="true" pointerEvents="none">
            {Array.from({ length: indicators.length + 1 }, (_, i) => (
              <g key={i} ref={(el) => { burstEls(i).g = el }} style={{ display: 'none' }}>
                <circle ref={(el) => { burstEls(i).flash = el }} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.4} opacity={0} />
                {Array.from({ length: N_TRI }, (_, j) => (
                  <path key={j} ref={(el) => { burstEls(i).tri[j] = el }} d="M0 -1L0.9 0.7L-0.9 0.7Z" strokeWidth={1.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" stroke={`url(#${uid}-rim)`} fill="rgba(255,255,255,0.2)" opacity={0} />
                ))}
                {Array.from({ length: N_DROP }, (_, j) => (
                  <circle key={j} ref={(el) => { burstEls(i).drop[j] = el }} r={1} fill="rgba(255,255,255,0.75)" opacity={0} />
                ))}
              </g>
            ))}
          </g>
        </svg>
        <canvas ref={frontCv} aria-hidden="true" className="pointer-events-none absolute" style={canvasBox} />
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
