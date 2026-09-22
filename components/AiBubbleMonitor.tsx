'use client'

import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { motion } from 'framer-motion'
import FadeIn from './FadeIn'
import IndicatorIcon from './IndicatorIcon'
import EcosystemTicker from './EcosystemTicker'
import { getScoreColor } from '@/lib/scoreColor'

export interface Indicator {
  id: string
  name: string
  framework: string
  description: string
  score: number | null
  rawValue: number | null
  rawFormatted: string
}

export interface LatestData {
  asOf: string | null
  generatedAt: string | null
  compositeScore: number | null
  category: string | null
  categoryColor: string | null
  indicators: Indicator[]
  basket: string[]
  methodologyNote: string
  dataSources: string[]
}

export interface HistoryPoint {
  date: string
  compositeScore: number | null
  indicatorScores: Record<string, number | null>
}

export interface HistoryData {
  series: HistoryPoint[]
}

const STRINGS = {
  en: {
    label: 'LIVE MARKET DATA — UPDATED DAILY',
    title: 'AI Bubble Monitor',
    subtitle:
      'A daily, rules-based read on whether AI-linked markets are showing the classic warning signs of a speculative bubble — built from Ray Dalio’s bubble framework, Robert Shiller’s valuation work, and Hyman Minsky’s financial instability hypothesis.',
    asOf: 'As of',
    pendingTitle: 'Data initializing',
    pendingBody:
      'The daily data workflow has not produced a snapshot yet. Once the GitHub Action runs, this dashboard will populate automatically.',
    compositeLabel: 'Composite Bubble Score',
    scoreOutOf: '/ 100',
    indicatorsLabel: 'Indicators',
    trendLabel: 'Composite Score — Trailing History',
    trendEmpty: 'History will appear once at least one day of data has been recorded.',
    methodologyLabel: 'Methodology',
    methodologyIntro:
      'Ray Dalio’s "How to Identify Bubbles" names six recurring hallmarks of a market bubble: prices high relative to traditional measures, prices discounting continued rapid appreciation, broad bullish sentiment, purchases financed by high leverage, buyers making unusually extended forward purchases, and new, unsophisticated buyers being drawn in — often amplified by stimulative monetary policy. Robert Shiller’s work on valuation extremes and market narratives, and Hyman Minsky’s financial instability hypothesis (hedge → speculative → Ponzi financing), inform the same reading.',
    methodologyHow:
      'Each indicator below is a free, daily-updatable proxy for one of those hallmarks, scored as a percentile rank against its own trailing history up to that day (no lookahead). The composite is their equal-weighted average, 0–100.',
    dataSourcesLabel: 'Data sources',
    disclaimer:
      'Educational tool only. This is a simplified proxy inspired by public bubble frameworks — it is not Dalio’s proprietary gauge, not a trading signal, and not investment advice.',
    footerNote: 'Data refreshes daily via an automated GitHub Actions workflow, sourced entirely from free Yahoo Finance endpoints.',
    basketLabel: 'AI basket',
    langToggle: '中文',
    flipHint: 'Tap for methodology',
    flipBackHint: 'Tap to go back',
    flipAriaLabel: 'Show indicator methodology',
    categories: {
      Low: 'Low',
      Moderate: 'Moderate',
      Elevated: 'Elevated',
      High: 'High',
      Extreme: 'Extreme',
    } as Record<string, string>,
  },
  zh: {
    label: '实时市场数据 — 每日更新',
    title: 'AI 泡沫监测仪',
    subtitle:
      '一套每日更新、基于规则的指标体系，用来判断与 AI 相关的市场是否出现典型的投机泡沫信号 —— 构建依据为达里欧（Ray Dalio）的泡沫识别框架、席勒（Robert Shiller）的估值研究，以及明斯基（Hyman Minsky）的金融不稳定性假说。',
    asOf: '数据截至',
    pendingTitle: '数据初始化中',
    pendingBody: '每日数据流程尚未生成快照。GitHub Action 首次运行后，本面板会自动填充数据。',
    compositeLabel: '综合泡沫指数',
    scoreOutOf: '/ 100',
    indicatorsLabel: '分项指标',
    trendLabel: '综合指数 — 历史走势',
    trendEmpty: '累积至少一天的数据后，历史走势图将显示在此处。',
    methodologyLabel: '方法论',
    methodologyIntro:
      '达里欧在《如何识别泡沫》中提出泡沫的六个典型特征：价格相对传统估值指标偏高、价格已计入未来持续快速上涨的预期、市场情绪普遍乐观、购买行为由高杠杆融资支撑、买家进行异常超前的远期采购、以及此前未参与市场的新买家被不断吸引入场 —— 往往由宽松的货币政策进一步助推。席勒关于估值极端与市场叙事的研究，以及明斯基的金融不稳定性假说（对冲性融资 → 投机性融资 → 庞氏融资），共同支撑了这一判断框架。',
    methodologyHow:
      '下方每个指标都是对应某一特征的免费、可每日更新的替代指标，其得分为该指标相对自身截至当日历史数据的百分位排名（不使用未来数据）。综合指数为各指标得分的等权平均值，范围 0-100。',
    dataSourcesLabel: '数据来源',
    disclaimer:
      '本工具仅供学习参考。这是受公开泡沫理论启发的简化替代指标，并非达里欧本人的专有模型，不构成交易信号，也不构成投资建议。',
    footerNote: '数据通过 GitHub Actions 自动化流程每日刷新，全部来自免费的 Yahoo Finance 接口。',
    basketLabel: 'AI 篮子成分股',
    langToggle: 'EN',
    flipHint: '点击查看方法说明',
    flipBackHint: '点击返回',
    flipAriaLabel: '查看该指标的方法说明',
    categories: {
      Low: '低',
      Moderate: '中等',
      Elevated: '偏高',
      High: '高',
      Extreme: '极端',
    } as Record<string, string>,
  },
}

// The English description for each indicator comes straight from the
// daily-regenerated data file (see scripts/fetch-ai-bubble-data.mjs), so
// it always matches whatever wording that script emits. There's no
// Chinese counterpart in that pipeline, so it's hand-maintained here,
// keyed by the same indicator id — falls back to the English copy for
// any id this hasn't been translated for yet.
const INDICATOR_DESCRIPTIONS_ZH: Record<string, string> = {
  momentum:
    '过去12个月内，一篮子主要AI资本支出相关股票（NVDA、MSFT、GOOGL、AMZN、META、AVGO、ORCL）的等权重回报率。持续的大幅上涨反映出价格"已经计入了从当前高位继续快速上涨的预期"——这是达里欧提出的第二个泡沫特征，也对应明斯基金融不稳定性周期中的亢奋阶段。',
  trendExtension:
    'AI 篮子股价相对其自身200日均线的偏离幅度——在缺乏免费实时盈利数据的情况下，这是衡量达里欧第一个泡沫特征"价格相对传统估值指标偏高"的免费日度替代指标。',
  concentration:
    'AI 篮子相对罗素2000指数的6个月回报率之差。泡沫往往使涨幅集中在少数领涨股上，而大盘整体表现落后——这是席勒和格兰瑟姆都曾警示过的市场广度背离信号。',
  complacency:
    'VIX 波动率指数的反向读数。历史低位的 VIX 代表着达里欧提出的第三个泡沫特征"市场情绪普遍乐观"——投资者对下行风险的定价极低。',
  creditAppetite:
    '高收益公司债 ETF（HYG）相对久期匹配的国债 ETF（IEF）的3个月滚动回报率之差，作为信用利差走向的市场化替代指标。垃圾债跑赢国债意味着信用利差正在收窄、风险溢价被压缩——这是达里欧第四个泡沫特征"购买行为由高杠杆融资支撑"的体现。',
  monetaryStimulus:
    '10年期美债收益率的反向读数。长端利率走低会缓解为投机性估值提供支撑所需的贴现率测算——对应达里欧提出的"宽松货币政策可能进一步吹大泡沫"这一特征。',
  volumeSurge:
    'AI 篮子20日平均成交量相对其自身252日平均成交量的比值。成交量的持续激增意味着"此前未曾入场的新买家正被不断吸引进场"——这是达里欧提出的第六个泡沫特征，也对应明斯基周期中的庞氏融资阶段。',
}

function Gauge({ score, category, color }: { score: number; category: string; color: string }) {
  const clamped = Math.max(0, Math.min(100, score))
  const radius = 90
  const circumference = Math.PI * radius // semicircle
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className="relative w-full max-w-[280px] mx-auto">
      <svg viewBox="0 0 220 130" className="w-full">
        <path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <motion.path
          d="M 20 110 A 90 90 0 0 1 200 110"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <span className="text-4xl font-bold font-mono" style={{ color }}>
          {clamped.toFixed(0)}
        </span>
        <span className="text-white/40 text-xs font-mono uppercase tracking-widest mt-1">{category}</span>
      </div>
    </div>
  )
}

function IndicatorCard({ indicator, index, lang }: { indicator: Indicator; index: number; lang: 'en' | 'zh' }) {
  const s = STRINGS[lang]
  const score = indicator.score ?? 0
  const color = getScoreColor(score)
  const [flipped, setFlipped] = useState(false)
  const description = lang === 'zh' ? INDICATOR_DESCRIPTIONS_ZH[indicator.id] ?? indicator.description : indicator.description

  const header = (
    <div className="flex items-start justify-between gap-3 mb-2">
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}1A` }}>
          <IndicatorIcon id={indicator.id} color={color} />
        </span>
        <h3 className="text-white font-semibold text-sm leading-snug">{indicator.name}</h3>
      </div>
      <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[0.65rem] font-mono uppercase tracking-wide">
        {indicator.framework}
      </span>
    </div>
  )

  return (
    <FadeIn delay={0.05 * index}>
      {/* The methodology text lives on the back — click/tap either face
          to flip, a plain rotateY on a preserve-3d wrapper (no extra
          libraries) with both faces backface-hidden and the back
          absolutely stacked on the front so the card's height is
          always driven by the (denser) front face. */}
      <div
        className="relative h-full cursor-pointer"
        style={{ perspective: 1200 }}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setFlipped((f) => !f)
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={s.flipAriaLabel}
      >
        <motion.div
          className="relative h-full"
          style={{ transformStyle: 'preserve-3d' }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="rounded-2xl bg-surface-card border border-white/5 p-5 flex flex-col h-full gold-glow-hover"
            style={{ backfaceVisibility: 'hidden' }}
          >
            {header}

            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-2xl font-bold font-mono" style={{ color }}>
                {indicator.score === null ? '—' : indicator.score.toFixed(0)}
              </span>
              <span className="text-white/30 text-xs font-mono">{s.scoreOutOf}</span>
              <span className="ml-auto text-white/50 text-xs font-mono">{indicator.rawFormatted}</span>
            </div>

            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-3">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: color }}
              />
            </div>

            <span className="mt-auto text-white/25 text-[0.65rem] font-mono uppercase tracking-wide">{s.flipHint} →</span>
          </div>

          <div
            className="absolute inset-0 rounded-2xl bg-surface-card border border-white/5 p-5 flex flex-col h-full"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            {header}
            <p className="text-white/50 text-xs leading-relaxed flex-1 overflow-y-auto">{description}</p>
            <span className="mt-2 text-white/25 text-[0.65rem] font-mono uppercase tracking-wide self-end">← {s.flipBackHint}</span>
          </div>
        </motion.div>
      </div>
    </FadeIn>
  )
}

function TrendChart({ series, lang }: { series: HistoryPoint[]; lang: 'en' | 'zh' }) {
  const s = STRINGS[lang]
  const points = series.filter((p) => p.compositeScore !== null) as (HistoryPoint & { compositeScore: number })[]
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (points.length < 2) {
    return <p className="text-white/30 text-sm font-mono py-12 text-center">{s.trendEmpty}</p>
  }

  const width = 720
  const height = 220
  const padX = 8
  const padY = 16
  const padLeft = 30
  const n = points.length
  const xFor = (i: number) => padLeft + (i / (n - 1)) * (width - padLeft - padX)
  const yFor = (v: number) => height - padY - (v / 100) * (height - padY * 2)

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.compositeScore).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(n - 1).toFixed(1)} ${height - padY} L ${xFor(0).toFixed(1)} ${height - padY} Z`

  const latest = points[n - 1]
  const latestColor = getScoreColor(latest.compositeScore)

  const tickIdxs = [0, Math.floor((n - 1) / 2), n - 1]
  const active = hoverIdx !== null ? points[hoverIdx] : null
  const activeColor = active ? getScoreColor(active.compositeScore) : latestColor

  const handleMove = (e: MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * width
    const t = (relX - padLeft) / (width - padLeft - padX)
    const idx = Math.round(t * (n - 1))
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)))
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height + 24}`}
        className="w-full min-w-[480px] cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padLeft} x2={width - padX} y1={yFor(g)} y2={yFor(g)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={padLeft - 8} y={yFor(g) + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="var(--font-mono, monospace)">
              {g}
            </text>
          </g>
        ))}
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={latestColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={latestColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#trendFill)" stroke="none" />
        <path d={linePath} fill="none" stroke={latestColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={xFor(n - 1)} cy={yFor(latest.compositeScore)} r="3.5" fill={latestColor} />

        {active && (
          <>
            <line
              x1={xFor(hoverIdx!)}
              x2={xFor(hoverIdx!)}
              y1={padY}
              y2={height - padY}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle cx={xFor(hoverIdx!)} cy={yFor(active.compositeScore)} r="4.5" fill={activeColor} stroke="#0A0A0A" strokeWidth="1.5" />
          </>
        )}

        {tickIdxs.map((i) => (
          <text key={i} x={xFor(i)} y={height + 18} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="var(--font-mono, monospace)">
            {points[i].date}
          </text>
        ))}
      </svg>

      {active && (
        <div className="pointer-events-none -mt-2 flex justify-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0E0E0E] border text-xs font-mono"
            style={{ borderColor: `${activeColor}55` }}
          >
            <span className="text-white/40">{active.date}</span>
            <span className="font-semibold" style={{ color: activeColor }}>
              {active.compositeScore.toFixed(0)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AiBubbleMonitor({ latest, history }: { latest: LatestData; history: HistoryData }) {
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const s = STRINGS[lang]
  const [hasData] = useState(latest.compositeScore !== null)

  const categoryLabel = latest.category ? s.categories[latest.category] ?? latest.category : ''
  const color = latest.categoryColor ?? '#C9A84C'

  const sortedHistory = useMemo(() => [...history.series].sort((a, b) => (a.date < b.date ? -1 : 1)), [history.series])

  return (
    <main className="relative bg-bg min-h-screen">
      <div className="max-w-5xl mx-auto px-6 pt-16 md:pt-24 pb-24">
        <FadeIn>
          <div className="flex items-center justify-between mb-6">
            <div className="section-divider !mb-0 flex-1">
              <span className="section-label">{s.label}</span>
            </div>
            <button
              onClick={() => setLang((l) => (l === 'en' ? 'zh' : 'en'))}
              aria-label="Switch language"
              className="ml-4 px-3 py-1.5 text-xs font-mono tracking-widest border border-gold/30 text-gold/80 rounded-md hover:bg-gold/10 hover:border-gold/60 hover:text-gold transition-all duration-200 active:scale-95 flex-shrink-0"
            >
              {s.langToggle}
            </button>
          </div>
        </FadeIn>

        <FadeIn delay={0.05}>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="gold-gradient">{s.title}</span>
          </h1>
          <p className="text-white/50 text-sm md:text-base leading-relaxed max-w-2xl mb-2">{s.subtitle}</p>
          {latest.asOf && (
            <p className="text-white/30 text-xs font-mono mt-3">
              {s.asOf}: {latest.asOf} · {s.basketLabel}: {latest.basket.join(', ')}
            </p>
          )}
        </FadeIn>

        {!hasData ? (
          <FadeIn delay={0.1}>
            <div className="mt-10 rounded-2xl bg-surface-card border border-gold/15 p-8 text-center">
              <p className="text-gold text-sm font-mono uppercase tracking-widest mb-2">{s.pendingTitle}</p>
              <p className="text-white/40 text-sm leading-relaxed max-w-lg mx-auto mb-8">{s.pendingBody}</p>
            </div>
            <div className="mt-6 rounded-2xl bg-surface-card border border-white/5 p-8 animate-pulse">
              <div className="h-3 w-40 bg-white/10 rounded mx-auto mb-6" />
              <div className="w-full max-w-[280px] mx-auto h-[130px] bg-white/5 rounded-t-full" />
            </div>
            <div className="mt-8 grid sm:grid-cols-2 gap-5 animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-surface-card border border-white/5 p-5 h-[140px] space-y-3">
                  <div className="h-4 w-2/3 bg-white/10 rounded" />
                  <div className="h-6 w-1/3 bg-white/10 rounded" />
                  <div className="h-1.5 w-full bg-white/5 rounded-full" />
                  <div className="h-3 w-full bg-white/5 rounded" />
                </div>
              ))}
            </div>
            <div className="mt-8 rounded-2xl bg-surface-card border border-white/5 p-6 animate-pulse">
              <div className="h-[220px] w-full bg-white/5 rounded-lg" />
            </div>
          </FadeIn>
        ) : (
          <>
            <FadeIn delay={0.1}>
              <div className="mt-10 rounded-2xl bg-surface-card border border-white/5 p-8">
                <p className="section-label mb-6 text-center">{s.compositeLabel}</p>
                <Gauge score={latest.compositeScore ?? 0} category={categoryLabel} color={color} />
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div className="mt-12 mb-6">
                <p className="section-label mb-4">{s.indicatorsLabel}</p>
              </div>
            </FadeIn>
            <div className="grid sm:grid-cols-2 gap-5">
              {latest.indicators.map((ind, i) => (
                <IndicatorCard key={ind.id} indicator={ind} index={i} lang={lang} />
              ))}
            </div>

            <FadeIn delay={0.1}>
              <div className="mt-14 mb-4">
                <p className="section-label mb-4">{s.trendLabel}</p>
              </div>
              <div className="rounded-2xl bg-surface-card border border-white/5 p-6">
                <TrendChart series={sortedHistory} lang={lang} />
              </div>
            </FadeIn>
          </>
        )}

        <FadeIn delay={0.1}>
          <div className="mt-16">
            <div className="section-divider">
              <span className="section-label">{s.methodologyLabel}</span>
            </div>
            <div className="glass-card rounded-2xl p-6 md:p-8">
              <p className="text-white/45 text-sm leading-relaxed mb-4">{s.methodologyIntro}</p>
              <p className="text-white/45 text-sm leading-relaxed mb-6">{s.methodologyHow}</p>

              <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-2">{s.dataSourcesLabel}</p>
              <ul className="space-y-1">
                {latest.dataSources.map((src) => (
                  <li key={src} className="text-white/35 text-xs font-mono flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-gold/70 mt-1.5 flex-shrink-0" />
                    {src}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-white/25 text-xs leading-relaxed border-t border-white/5 mt-8 pt-6">{s.disclaimer}</p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <EcosystemTicker />
          <footer className="mt-12 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <p className="text-white/25 text-xs font-mono">{s.footerNote}</p>
            {latest.generatedAt && (
              <p className="text-white/20 text-xs font-mono">
                {new Date(latest.generatedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </footer>
        </FadeIn>
      </div>
    </main>
  )
}
