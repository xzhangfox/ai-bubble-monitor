'use client'

import { useState, type PointerEvent } from 'react'
import FadeIn from './FadeIn'
import { useWidth } from './useWidth'

// "What usually came next": the drawdown model (ml/model.py) — the chance of a
// 10%+ fall in the AI basket within three months, how four models did out of
// sample, what moves today's estimate, and the most similar past days.

export interface ModelData {
  asOf: string | null
  target?: { horizonDays: number; drop: number; text: string }
  backtest?: { start: string; end: string; days: number; folds: number; retrainEveryDays: number; gapDays: number; minTrainDays: number; baseRate: number; episodes: number }
  models?: { id: string; name: string; auc: number; aucCi: (number | null)[]; brier: number; brierSkill: number; brierSkillCi: (number | null)[]; today: number }[]
  headline?: { model: string; probability: number; baseRate: number; chosenBy: string; beatsBaseRate: boolean }
  drivers?: { id: string; rank: number; weight: number; contribution: number; effect: number }[]
  analogs?: { days: { date: string; composite: number; similarity: number; forwardReturn: number; maxDrawdown: number; fell: boolean }[]; nearest: number; nearestFell: number }
  chart?: { date: string; p: number; fell: number | null }[]
  longerHorizons?: { horizonDays: number; drop: number; start: string; end: string; baseRate: number; episodes: number; models: { id: string; auc: number; aucCi: (number | null)[]; brierSkill: number }[] }[]
}

type Lang = 'en' | 'zh'

const RAISES = '#E8934A'
const LOWERS = '#6FA8DC'
const FELL = 'rgba(232,98,60,0.16)'

const T = {
  en: {
    label: 'What Usually Came Next',
    intro:
      'The composite says how stretched AI markets look. This asks what followed: the chance that the AI basket falls 10% or more below the day’s close within the next three months — from models tested only on days they had not seen.',
    chance: 'chance of a 10%+ fall within 3 months',
    baseRate: (x: string) => `Base rate: ${x} of all days were followed by one`,
    by: (name: string) => `${name} — the best of four models out of sample`,
    beats: 'Beats the base rate out of sample',
    notYet: 'Not reliably better than the base rate yet',
    similar: (n: number, x: string) => `Of the ${n} most similar past days, ${x} were followed by a 10%+ fall within 3 months.`,
    baseHead: 'of all days were followed by a 10%+ fall within 3 months — the base rate',
    noneBeats: (lo: string, hi: string) => `No model beat that out of sample. Today’s estimates run from ${lo} to ${hi}; none is more reliable than the base rate.`,
    finding: (auc: string, lo: string, hi: string, verdict: string) => `The composite’s out-of-sample AUC was ${auc} (95% range ${lo}–${hi}): ${verdict} It measures how stretched AI markets are, not when they turn.`,
    verdictFlip: 'indistinguishable from a coin flip — a higher score has not meant a higher chance of a fall.',
    verdictInverse: 'falls came more often after low readings than after high ones.',
    verdictWorks: 'higher readings were followed by more falls.',
    horizonsTitle: 'Longer horizons, fixed in advance',
    horizonsNote:
      'The same walk-forward test at all three horizons, reported together so none is picked out alone. AUC below 0.5 means falls came more often after low readings. The longer the horizon, the fewer separate drawdowns there are to learn from — the 12-month figures rest on very few.',
    colHorizon: 'Fall within',
    colBase: 'Base rate',
    colComposite: 'Composite AUC',
    colLogistic: 'Logistic AUC',
    colEpisodes: 'Drawdowns',
    horizon: (days: number, drop: number) => `${Math.round(drop * 100)}%, ${days <= 63 ? '3 months' : days <= 126 ? '6 months' : '12 months'}`,
    chartTitle: 'The model’s chance over time, out of sample',
    legendLine: 'Model’s chance',
    legendFell: 'A 10%+ fall followed',
    legendBase: 'Base rate',
    pending: 'Outcome not in yet',
    fell: 'fell 10%+ within 3 months',
    didNot: 'no 10% fall within 3 months',
    waiting: 'outcome not in yet',
    modelsTitle: 'How each model did',
    modelsNote: (start: string, end: string, folds: number) =>
      `Walk-forward test, ${start} to ${end}: retrained every quarter on the past only (${folds} times), with a three-month gap so no training outcome overlaps the days it predicts. AUC: 0.5 is a coin flip, 1 is perfect. Brier skill above 0 means better than always saying the base rate. Ranges are 95% block-bootstrap intervals.`,
    colModel: 'Model',
    colAuc: 'AUC',
    colSkill: 'Brier skill',
    colToday: 'Today',
    driversTitle: 'What moves today’s estimate',
    driversNote: 'From the logistic model: how many percentage points each indicator adds or takes away, against that indicator at its average.',
    pts: 'pts',
    raises: 'raises it',
    lowers: 'lowers it',
    rank: 'rank',
    analogsTitle: 'The most similar days',
    analogsNote: 'Past days whose eight indicator ranks sit closest to today’s, at least two months apart, and what the AI basket did in the three months after each.',
    composite: 'Composite',
    similarity: 'Similarity',
    next3: 'Next 3 months',
    worst: 'worst',
    tagFell: 'Fell 10%+',
    tagNot: 'No 10% fall',
    caveat: (n: number) =>
      `Ten years hold only ${n} separate drawdowns of this size, so every number here is uncertain — the ranges show how much. This is a statistical description of the past, not a forecast to trade on and not investment advice.`,
    models: { composite: 'Composite score', logistic: 'Logistic regression', gbm: 'Gradient-boosted trees', transformer: 'Transformer (60-day sequence)' } as Record<string, string>,
  },
  zh: {
    label: '历史上接下来发生了什么',
    intro: '综合指数衡量 AI 相关市场被拉伸的程度；这里回答的是之后通常发生了什么：AI 股票篮子在未来 3 个月内从当日收盘价下跌 10% 以上的概率。模型只在它没见过的日子上检验过。',
    chance: '未来 3 个月下跌 10% 以上的概率',
    baseRate: (x: string) => `基准：所有交易日中有 ${x} 之后出现过这样的下跌`,
    by: (name: string) => `${name} —— 四个模型中样本外表现最好的`,
    beats: '样本外胜过基准',
    notYet: '目前还不能稳定胜过基准',
    similar: (n: number, x: string) => `与今天最相似的 ${n} 个历史交易日中，有 ${x} 在之后 3 个月内下跌了 10% 以上。`,
    baseHead: '的交易日之后 3 个月内出现过 10% 以上的下跌 —— 这是基准',
    noneBeats: (lo: string, hi: string) => `样本外没有一个模型胜过这个基准。今天各模型的估计在 ${lo} 到 ${hi} 之间，但都不比基准更可靠。`,
    finding: (auc: string, lo: string, hi: string, verdict: string) => `综合指数的样本外 AUC 为 ${auc}（95% 区间 ${lo}–${hi}）：${verdict}它衡量的是 AI 市场被拉伸的程度，而不是何时转向。`,
    verdictFlip: '与抛硬币无法区分——分数更高并不意味着下跌概率更高。',
    verdictInverse: '下跌更多出现在低读数之后，而不是高读数之后。',
    verdictWorks: '读数越高，之后的下跌越多。',
    horizonsTitle: '更长周期（事先设定）',
    horizonsNote: '三个周期用同样的滚动向前检验，一并报告，不单挑其中一个。AUC 低于 0.5 表示下跌更多出现在低读数之后。周期越长，可供学习的独立回撤越少——12 个月的结果只建立在很少几次回撤之上。',
    colHorizon: '期间跌幅',
    colBase: '基准',
    colComposite: '综合指数 AUC',
    colLogistic: '逻辑回归 AUC',
    colEpisodes: '回撤次数',
    horizon: (days: number, drop: number) => `${Math.round(drop * 100)}%，${days <= 63 ? '3 个月' : days <= 126 ? '6 个月' : '12 个月'}`,
    chartTitle: '模型给出的概率（样本外）',
    legendLine: '模型概率',
    legendFell: '之后下跌 10% 以上',
    legendBase: '基准',
    pending: '结果尚未揭晓',
    fell: '3 个月内下跌 10% 以上',
    didNot: '3 个月内没有下跌 10%',
    waiting: '结果尚未揭晓',
    modelsTitle: '各模型的表现',
    modelsNote: (start: string, end: string, folds: number) =>
      `滚动向前检验，${start} 至 ${end}：每个季度只用过去的数据重新训练（共 ${folds} 次），训练与预测之间留出 3 个月空档，保证训练用到的结果不与被预测的日子重叠。AUC 为 0.5 相当于抛硬币，1 为完美；Brier 技能分大于 0 表示胜过一直报基准。区间为 95% 分块自助法区间。`,
    colModel: '模型',
    colAuc: 'AUC',
    colSkill: 'Brier 技能分',
    colToday: '今天',
    driversTitle: '是什么在推动今天的估计',
    driversNote: '来自逻辑回归模型：与该指标处于平均水平相比，每个指标让概率增加或减少了多少个百分点。',
    pts: '个百分点',
    raises: '推高',
    lowers: '拉低',
    rank: '排名',
    analogsTitle: '最相似的历史交易日',
    analogsNote: '八个指标排名与今天最接近的历史交易日（彼此至少相隔两个月），以及 AI 篮子在之后 3 个月的表现。',
    composite: '综合指数',
    similarity: '相似度',
    next3: '之后 3 个月',
    worst: '最大跌幅',
    tagFell: '下跌 10%+',
    tagNot: '未跌 10%',
    caveat: (n: number) => `十年里这种幅度的独立下跌只有 ${n} 次，所以这里每个数字都有不确定性——区间显示了不确定有多大。这是对过去的统计描述，不是可以据此交易的预测，也不构成投资建议。`,
    models: { composite: '综合指数', logistic: '逻辑回归', gbm: '梯度提升树', transformer: 'Transformer（60 日序列）' } as Record<string, string>,
  },
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const signedPct = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(d)}%`
const signedPts = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}`
const ci = (r: (number | null)[], fmt: (x: number) => string) => (r[0] === null || r[1] === null ? '' : `[${fmt(r[0] as number)}, ${fmt(r[1] as number)}]`)
const num = (x: number, d = 2) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(d)

function ProbabilityChart({ points, baseRate, lang }: { points: NonNullable<ModelData['chart']>; baseRate: number; lang: Lang }) {
  const t = T[lang]
  const { ref, width } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = points.length
  if (n < 2) return null
  const height = width < 480 ? 180 : 210
  const padL = 36
  const padR = 10
  const padT = 10
  const padB = 22
  const yMax = Math.max(0.5, Math.ceil(Math.max(baseRate, ...points.map((p) => p.p)) * 10) / 10)
  const x = (i: number) => padL + (i / (n - 1)) * (width - padL - padR)
  const y = (v: number) => padT + (1 - v / yMax) * (height - padT - padB)
  const step = (width - padL - padR) / (n - 1)
  const ticks = (yMax <= 0.5 ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0, 0.25, 0.5, 0.75, 1]).filter((v) => v <= yMax + 1e-9)

  const runs: [number, number][] = []
  points.forEach((p, i) => {
    if (p.fell !== 1) return
    const last = runs[runs.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  })
  const pendingFrom = points.findIndex((p) => p.fell === null)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join('')
  const ym = (d: string) => d.slice(0, 7)
  const tickIdx = [0, Math.floor((n - 1) / 2), n - 1]

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round((e.clientX - r.left - padL) / step)
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const h = hover === null ? null : points[hover]

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} className="block touch-pan-y" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={t.chartTitle}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="var(--font-mono, monospace)">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        {runs.map(([a, b]) => (
          <rect key={a} x={Math.max(padL, x(a) - step / 2)} y={padT} width={Math.max(1, x(b) - x(a) + step)} height={height - padT - padB} fill={FELL} />
        ))}
        {pendingFrom >= 0 && (
          <g>
            <rect x={x(pendingFrom)} y={padT} width={width - padR - x(pendingFrom)} height={height - padT - padB} fill="rgba(255,255,255,0.04)" />
            <line x1={x(pendingFrom)} x2={x(pendingFrom)} y1={padT} y2={height - padB} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 3" />
          </g>
        )}
        <line x1={padL} x2={width - padR} y1={y(baseRate)} y2={y(baseRate)} stroke="rgba(255,255,255,0.45)" strokeDasharray="4 4" />
        <path d={line} fill="none" stroke="#C9A84C" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(points[n - 1].p)} r="3.5" fill="#C9A84C" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={height - padB} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.p)} r="4.5" fill="#C9A84C" stroke="#0A0A0A" strokeWidth="1.5" />
          </g>
        )}
        {tickIdx.map((i, k) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="var(--font-mono, monospace)">
            {ym(points[i].date)}
          </text>
        ))}
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/10 bg-[#0E0E0E]/95 px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(Math.max(x(hover) - 90, 0), width - 180), width: 180 }}
        >
          <p className="font-mono text-white/45">{h.date}</p>
          <p className="mt-0.5 text-white">
            <span className="font-mono font-semibold text-gold">{pct(h.p)}</span> {t.legendLine.toLowerCase()}
          </p>
          <p className="mt-0.5 text-white/60">{h.fell === 1 ? t.fell : h.fell === 0 ? t.didNot : t.waiting}</p>
        </div>
      )}
    </div>
  )
}

function Legend({ lang }: { lang: Lang }) {
  const t = T[lang]
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/55">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded bg-gold" />
        {t.legendLine}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: FELL, outline: '1px solid rgba(232,98,60,0.4)' }} />
        {t.legendFell}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t border-dashed border-white/50" />
        {t.legendBase}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-white/[0.06] outline outline-1 outline-white/15" />
        {t.pending}
      </span>
    </div>
  )
}

export default function ModelView({ model, names, lang }: { model: ModelData; names: Record<string, string>; lang: Lang }) {
  const t = T[lang]
  const { headline, models, backtest, drivers, analogs, chart } = model
  if (!headline || !models?.length || !backtest) return null
  const best = models.find((m) => m.id === headline.model) ?? models[0]
  const composite = models.find((m) => m.id === 'composite')
  const horizonRows = [
    { horizonDays: model.target?.horizonDays ?? 63, drop: model.target?.drop ?? 0.1, baseRate: backtest.baseRate, episodes: backtest.episodes, models },
    ...(model.longerHorizons ?? []),
  ]
  const aucOf = (ms: { id: string; auc: number; aucCi: (number | null)[] }[], id: string) => ms.find((m) => m.id === id)
  const maxEffect = Math.max(0.01, ...(drivers ?? []).map((d) => Math.abs(d.effect)))

  return (
    <section className="mt-16" aria-labelledby="model-view">
      <FadeIn>
        <div className="section-divider">
          <span id="model-view" className="section-label">
            {t.label}
          </span>
        </div>
        <p className="mb-6 max-w-3xl text-sm leading-relaxed text-white/50">{t.intro}</p>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="rounded-2xl border border-white/5 bg-surface-card p-5 md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            {headline.beatsBaseRate ? (
              <div>
                <p className="font-mono text-5xl font-bold text-gold">{pct(headline.probability)}</p>
                <p className="mt-1 text-sm text-white/70">{t.chance}</p>
                <p className="mt-3 text-xs text-white/45">{t.baseRate(pct(headline.baseRate))}</p>
                <p className="mt-1 text-xs text-white/45">{t.by(t.models[best.id] ?? best.name)}</p>
              </div>
            ) : (
              // No model beats the base rate: the base rate is the honest headline.
              <div className="md:max-w-xl">
                <p className="font-mono text-5xl font-bold text-white">{pct(headline.baseRate)}</p>
                <p className="mt-1 text-sm text-white/70">{t.baseHead}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/60">{t.noneBeats(pct(Math.min(...models.map((m) => m.today))), pct(Math.max(...models.map((m) => m.today))))}</p>
              </div>
            )}
            <div className="space-y-3 md:max-w-sm md:text-right">
              <span
                className={`inline-block rounded-md border px-2.5 py-1 text-xs font-medium ${headline.beatsBaseRate ? 'border-gold/40 text-gold' : 'border-white/15 text-white/60'}`}
              >
                {headline.beatsBaseRate ? t.beats : t.notYet}
              </span>
              {analogs && <p className="text-sm leading-relaxed text-white/60">{t.similar(analogs.nearest, pct(analogs.nearestFell))}</p>}
            </div>
          </div>
          {composite && composite.aucCi[0] !== null && composite.aucCi[1] !== null && (
            <p className="mt-5 border-t border-white/5 pt-4 text-sm leading-relaxed text-white/70">
              {t.finding(
                composite.auc.toFixed(2),
                (composite.aucCi[0] as number).toFixed(2),
                (composite.aucCi[1] as number).toFixed(2),
                (composite.aucCi[1] as number) < 0.5 ? t.verdictInverse : (composite.aucCi[0] as number) > 0.5 ? t.verdictWorks : t.verdictFlip
              )}
            </p>
          )}
        </div>
      </FadeIn>

      {chart && chart.length > 1 && (
        <FadeIn delay={0.05}>
          <div className="mt-5 rounded-2xl border border-white/5 bg-surface-card p-5 md:p-6">
            <p className="mb-3 text-sm font-semibold text-white">{t.chartTitle}</p>
            <Legend lang={lang} />
            <ProbabilityChart points={chart} baseRate={headline.baseRate} lang={lang} />
          </div>
        </FadeIn>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <FadeIn delay={0.05}>
          <div className="h-full rounded-2xl border border-white/5 bg-surface-card p-5 md:p-6">
            <p className="mb-3 text-sm font-semibold text-white">{t.modelsTitle}</p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-white/40">
                  <th className="pb-2 font-medium">{t.colModel}</th>
                  <th className="pb-2 text-right font-medium">{t.colAuc}</th>
                  <th className="pb-2 pl-2 text-right font-medium">{t.colSkill}</th>
                  <th className="pb-2 pl-3 text-right font-medium">{t.colToday}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const head = m.id === headline.model
                  return (
                    <tr key={m.id} className="border-t border-white/5 align-top">
                      <td className={`py-2.5 pr-2 ${head ? 'font-semibold text-white' : 'text-white/70'}`}>
                        {head && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold align-middle" />}
                        {t.models[m.id] ?? m.name}
                      </td>
                      <td className="py-2.5 text-right font-mono">
                        <span className="text-white/85">{m.auc.toFixed(2)}</span>
                        <span className="block text-[0.65rem] text-white/35">{ci(m.aucCi, (v) => v.toFixed(2))}</span>
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono">
                        <span className="text-white/85">{num(m.brierSkill)}</span>
                        <span className="block text-[0.65rem] text-white/35">{ci(m.brierSkillCi, (v) => num(v))}</span>
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono text-white/85">{pct(m.today)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[0.7rem] leading-relaxed text-white/40">{t.modelsNote(backtest.start, backtest.end, backtest.folds)}</p>
          </div>
        </FadeIn>

        {drivers && drivers.length > 0 && (
          <FadeIn delay={0.08}>
            <div className="h-full rounded-2xl border border-white/5 bg-surface-card p-5 md:p-6">
              <p className="mb-1 text-sm font-semibold text-white">{t.driversTitle}</p>
              <p className="mb-4 text-[0.7rem] leading-relaxed text-white/40">{t.driversNote}</p>
              <ul className="space-y-3">
                {drivers.map((d) => {
                  const w = (Math.abs(d.effect) / maxEffect) * 50
                  const up = d.effect >= 0
                  return (
                    <li key={d.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate text-white/75">{names[d.id] ?? d.id}</span>
                        <span className="flex-shrink-0 font-mono text-white/85">
                          {signedPts(d.effect)} {t.pts} <span className="hidden text-white/35 sm:inline">{up ? t.raises : t.lowers}</span>
                        </span>
                      </div>
                      <div className="relative h-1.5 rounded-full bg-white/5" title={`${t.rank} ${d.rank.toFixed(0)}`}>
                        <span className="absolute left-1/2 top-[-3px] h-3 w-px bg-white/25" />
                        <span
                          className="absolute top-0 h-full rounded-full"
                          style={{ left: up ? '50%' : `${50 - w}%`, width: `${Math.max(w, 0.8)}%`, background: up ? RAISES : LOWERS }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              <div className="mt-4 flex gap-4 text-[0.7rem] text-white/45">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm" style={{ background: RAISES }} />
                  {t.raises}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded-sm" style={{ background: LOWERS }} />
                  {t.lowers}
                </span>
              </div>
            </div>
          </FadeIn>
        )}
      </div>

      {(model.longerHorizons?.length ?? 0) > 0 && (
        <FadeIn delay={0.05}>
          <div className="mt-5 rounded-2xl border border-white/5 bg-surface-card p-5 md:p-6">
            <p className="mb-3 text-sm font-semibold text-white">{t.horizonsTitle}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-white/40">
                    <th className="pb-2 font-medium">{t.colHorizon}</th>
                    <th className="pb-2 text-right font-medium">{t.colBase}</th>
                    <th className="pb-2 text-right font-medium">{t.colComposite}</th>
                    <th className="hidden pb-2 text-right font-medium sm:table-cell">{t.colLogistic}</th>
                    <th className="pb-2 pl-2 text-right font-medium">{t.colEpisodes}</th>
                  </tr>
                </thead>
                <tbody>
                  {horizonRows.map((h) => (
                    <tr key={h.horizonDays} className="border-t border-white/5 align-top">
                      <td className="py-2.5 pr-2 text-white/75">{t.horizon(h.horizonDays, h.drop)}</td>
                      <td className="py-2.5 text-right font-mono text-white/85">{pct(h.baseRate)}</td>
                      {['composite', 'logistic'].map((id) => {
                        const m = aucOf(h.models, id)
                        return (
                          <td key={id} className={`py-2.5 pl-2 text-right font-mono ${id === 'logistic' ? 'hidden sm:table-cell' : ''}`}>
                            <span className="text-white/85">{m ? m.auc.toFixed(2) : '—'}</span>
                            <span className="block text-[0.65rem] text-white/35">{m ? ci(m.aucCi, (v) => v.toFixed(2)) : ''}</span>
                          </td>
                        )
                      })}
                      <td className="py-2.5 text-right font-mono text-white/85">{h.episodes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.7rem] leading-relaxed text-white/40">{t.horizonsNote}</p>
          </div>
        </FadeIn>
      )}

      {analogs && analogs.days.length > 0 && (
        <FadeIn delay={0.05}>
          <div className="mt-5 rounded-2xl border border-white/5 bg-surface-card p-5 md:p-6">
            <p className="mb-1 text-sm font-semibold text-white">{t.analogsTitle}</p>
            <p className="mb-4 text-[0.7rem] leading-relaxed text-white/40">{t.analogsNote}</p>
            <ul className="divide-y divide-white/5">
              {analogs.days.map((a) => (
                <li key={a.date} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-white">{a.date}</span>
                    <span className="text-xs text-white/45">
                      {t.composite} {a.composite.toFixed(0)} · {t.similarity} {pct(a.similarity)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-white/60">
                      {t.next3} <span className="font-mono text-white/85">{signedPct(a.forwardReturn)}</span>, {t.worst}{' '}
                      <span className="font-mono text-white/85">{signedPct(Math.min(0, a.maxDrawdown))}</span>
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[0.7rem] ${a.fell ? 'border-[#E8623C]/40 text-[#F08A68]' : 'border-white/10 text-white/50'}`}>
                      {a.fell ? t.tagFell : t.tagNot}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </FadeIn>
      )}

      <p className="mt-5 text-xs leading-relaxed text-white/35">{t.caveat(backtest.episodes)}</p>
    </section>
  )
}
