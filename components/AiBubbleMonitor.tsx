'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import FadeIn from './FadeIn'

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
    basketLabel: 'AI basket',
    langToggle: '中文',
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
    basketLabel: 'AI 篮子成分股',
    langToggle: 'EN',
    categories: {
      Low: '低',
      Moderate: '中等',
      Elevated: '偏高',
      High: '高',
      Extreme: '极端',
    } as Record<string, string>,
  },
}

function scoreColor(score: number): string {
  if (score <= 24) return '#4ADE80'
  if (score <= 44) return '#C9A84C'
  if (score <= 64) return '#E8934A'
  if (score <= 84) return '#E8623C'
  return '#E23C4E'
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
  const color = scoreColor(score)

  return (
    <FadeIn delay={0.05 * index}>
      <div className="rounded-2xl bg-surface-card border border-white/5 p-5 flex flex-col h-full gold-glow-hover">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-white font-semibold text-sm leading-snug">{indicator.name}</h3>
          <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-white/40 text-[0.65rem] font-mono uppercase tracking-wide">
            {indicator.framework}
          </span>
        </div>

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

        <p className="text-white/40 text-xs leading-relaxed flex-1">{indicator.description}</p>
      </div>
    </FadeIn>
  )
}

function TrendChart({ series, lang }: { series: HistoryPoint[]; lang: 'en' | 'zh' }) {
  const s = STRINGS[lang]
  const points = series.filter((p) => p.compositeScore !== null) as (HistoryPoint & { compositeScore: number })[]

  if (points.length < 2) {
    return <p className="text-white/30 text-sm font-mono py-12 text-center">{s.trendEmpty}</p>
  }

  const width = 720
  const height = 220
  const padX = 8
  const padY = 16
  const n = points.length
  const xFor = (i: number) => padX + (i / (n - 1)) * (width - padX * 2)
  const yFor = (v: number) => height - padY - (v / 100) * (height - padY * 2)

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.compositeScore).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L ${xFor(n - 1).toFixed(1)} ${height - padY} L ${xFor(0).toFixed(1)} ${height - padY} Z`

  const latest = points[n - 1]
  const latestColor = scoreColor(latest.compositeScore)

  const tickIdxs = [0, Math.floor((n - 1) / 2), n - 1]

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 24}`} className="w-full min-w-[480px]" preserveAspectRatio="none">
        {[0, 25, 50, 75, 100].map((g) => (
          <line
            key={g}
            x1={padX}
            x2={width - padX}
            y1={yFor(g)}
            y2={yFor(g)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
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
        {tickIdxs.map((i) => (
          <text key={i} x={xFor(i)} y={height + 18} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill="rgba(255,255,255,0.3)" fontSize="10" fontFamily="var(--font-mono, monospace)">
            {points[i].date}
          </text>
        ))}
      </svg>
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
              <p className="text-white/40 text-sm leading-relaxed max-w-lg mx-auto">{s.pendingBody}</p>
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
            <p className="text-white/45 text-sm leading-relaxed mb-4">{s.methodologyIntro}</p>
            <p className="text-white/45 text-sm leading-relaxed mb-6">{s.methodologyHow}</p>

            <p className="text-white/30 text-xs font-mono uppercase tracking-widest mb-2">{s.dataSourcesLabel}</p>
            <ul className="space-y-1 mb-8">
              {latest.dataSources.map((src) => (
                <li key={src} className="text-white/35 text-xs font-mono flex items-start gap-2">
                  <span className="w-1 h-1 rounded-full bg-gold/70 mt-1.5 flex-shrink-0" />
                  {src}
                </li>
              ))}
            </ul>

            <p className="text-white/25 text-xs leading-relaxed border-t border-white/5 pt-6">{s.disclaimer}</p>
          </div>
        </FadeIn>
      </div>
    </main>
  )
}
