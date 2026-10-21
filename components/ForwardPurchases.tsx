'use client'

import { useState, type PointerEvent } from 'react'
import FadeIn from './FadeIn'
import { useWidth } from './useWidth'

// Dalio's fifth hallmark, from the hyperscalers' own filings: capital spending
// against revenue (SEC XBRL, ml/sec_capex.py) and the commitments they've
// signed but not yet spent, read from the filing text by an LLM and checked
// against it sentence by sentence (ml/filings_llm.py).

export interface CapexPoint {
  date: string
  intensity: number
  capexTtmBn: number
  revenueTtmBn: number
  members: Record<string, { periodEnd: string; capexTtmBn: number; revenueTtmBn: number }>
}

export interface CapexData {
  latest?: CapexPoint
  yearAgo?: CapexPoint | null
  series?: { date: string; intensity: number }[]
}

interface Commitment {
  kind: 'leases_not_commenced' | 'purchase_commitments'
  amountBn: number
  amountText: string
  asOf: string
  whatFor: string
  quote: string
}

export interface CommitmentsData {
  model?: string
  summary?: {
    companies: {
      ticker: string
      name: string
      form: string
      filed: string
      reportDate: string
      url: string
      totals: Partial<Record<Commitment['kind'], number>>
      items: Commitment[]
      yearAgo: { reportDate: string; totals: Partial<Record<Commitment['kind'], number>>; url: string } | null
    }[]
    totalBn: number
    compared: string[]
    comparedNowBn: number
    comparedYearAgoBn: number
    change: number | null
    checked: { filings: number; kept: number; dropped: number }
  } | null
}

type Lang = 'en' | 'zh'

const T = {
  en: {
    label: 'Forward Purchases — From the Filings',
    intro:
      'Dalio’s fifth hallmark is buyers committing to purchases far ahead of need. For AI that is the hyperscalers’ data-centre build-out, so this reads what Microsoft, Alphabet, Amazon, Meta and Oracle report to the SEC.',
    intensity: 'of revenue goes to capital spending',
    intensityNote: (bn: string) => `Trailing 12 months, the five together: ${bn} of capex. Counted from the day after each filing.`,
    yearAgo: (x: string) => `${x} a year earlier`,
    chartTitle: 'Capex as a share of revenue, as each filing came out',
    committedTitle: 'Signed, not yet spent',
    committedIntro:
      'Leases signed for data centres and other sites that have not begun, and purchase commitments for servers, network gear and capacity — money already promised. An LLM reads the latest 10-Q or 10-K; a figure is kept only if the sentence it quotes is in the filing word for word and states that amount.',
    leases: 'Leases not yet begun',
    purchases: 'Purchase commitments',
    total: (bn: string) => `${bn} committed across the five, by their latest filings`,
    change: (x: string, names: string) => `${x} against the same quarter a year earlier (${names})`,
    checked: (kept: number, dropped: number, filings: number) => `${filings} filings read: ${kept} figures kept, ${dropped} dropped by the checks.`,
    from: 'From the filing',
    source: 'filing',
    none: 'No commitment figures found in its latest filing.',
    vs: 'a year earlier',
  },
  zh: {
    label: '超前采购 —— 来自财报',
    intro: '达里欧的第五个泡沫特征是买家远在需要之前就做出采购承诺。对 AI 而言，这就是大厂的数据中心建设，所以这里读取微软、Alphabet、亚马逊、Meta 和甲骨文向美国证监会提交的财报。',
    intensity: '的收入投入了资本开支',
    intensityNote: (bn: string) => `五家合计、过去 12 个月：资本开支 ${bn}。从每份财报发布的次日起计入。`,
    yearAgo: (x: string) => `一年前为 ${x}`,
    chartTitle: '资本开支占收入比例（按每份财报发布时点）',
    committedTitle: '已签约、尚未花出的钱',
    committedIntro: '已签约但尚未开始的数据中心等租约，以及服务器、网络设备和算力的采购承诺 —— 已经许诺出去的钱。由 LLM 阅读最新的 10-Q 或 10-K；只有当它引用的句子在财报中一字不差地存在、并且写明了这个金额时，数字才会被保留。',
    leases: '尚未开始的租约',
    purchases: '采购承诺',
    total: (bn: string) => `按最新财报，五家合计已承诺 ${bn}`,
    change: (x: string, names: string) => `与一年前同季度相比 ${x}（${names}）`,
    checked: (kept: number, dropped: number, filings: number) => `已读 ${filings} 份财报：保留 ${kept} 个数字，${dropped} 个未通过核对被丢弃。`,
    from: '财报原文',
    source: '财报',
    none: '最新财报中未找到承诺金额。',
    vs: '一年前',
  },
}

const bn = (x: number) => (x >= 1000 ? `$${(x / 1000).toFixed(2)} trillion` : `$${x.toFixed(1)} billion`)
const bnZh = (x: number) => `${Math.round(x * 10).toLocaleString('en-US')} 亿美元`
// (compact, for chips and per-company figures)
const bnShort = (x: number) => (x >= 1000 ? `$${(x / 1000).toFixed(2)}T` : `$${x.toFixed(1)}B`)
const bnShortZh = (x: number) => `${Math.round(x * 10).toLocaleString('en-US')} 亿`
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const signed = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%`

function IntensityChart({ series, lang }: { series: NonNullable<CapexData['series']>; lang: Lang }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = series.length
  if (n < 2) return null
  const height = 150
  const padL = 36
  const padR = 10
  const padT = 10
  const padB = 22
  const t0 = Date.parse(series[0].date)
  const t1 = Date.parse(series[n - 1].date)
  const vMax = Math.ceil(Math.max(...series.map((p) => p.intensity)) * 20) / 20
  const x = (d: string) => padL + ((Date.parse(d) - t0) / (t1 - t0 || 1)) * (width - padL - padR)
  const y = (v: number) => padT + (1 - v / vMax) * (height - padT - padB)
  // a step line: each reading holds until the next filing
  const path = series.map((p, i) => (i ? `H${x(p.date).toFixed(1)}V${y(p.intensity).toFixed(1)}` : `M${x(p.date).toFixed(1)},${y(p.intensity).toFixed(1)}`)).join('')
  const ticks = Array.from({ length: Math.floor(vMax / 0.1 + 1e-9) + 1 }, (_, i) => i * 0.1)
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const tx = t0 + ((e.clientX - r.left - padL) / (width - padL - padR)) * (t1 - t0)
    let i = 0
    while (i + 1 < n && Date.parse(series[i + 1].date) <= tx) i++
    setHover(i)
  }
  const h = hover === null ? null : series[hover]
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} className="block touch-pan-y" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={T[lang].chartTitle}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="var(--font-mono, monospace)">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#C9A84C" strokeWidth="2" strokeLinejoin="round" />
        {h && <circle cx={x(h.date)} cy={y(h.intensity)} r="4.5" fill="#C9A84C" stroke="#0A0A0A" strokeWidth="1.5" />}
        {[series[0], series[n - 1]].map((p, k) => (
          <text key={p.date} x={x(p.date)} y={height - 6} textAnchor={k ? 'end' : 'start'} fill="rgba(255,255,255,0.35)" fontSize="10" fontFamily="var(--font-mono, monospace)">
            {p.date.slice(0, 7)}
          </text>
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 z-10 rounded-lg border border-white/10 bg-[#0E0E0E]/95 px-3 py-1.5 text-xs shadow-xl" style={{ left: Math.min(Math.max(x(h.date) - 60, 0), width - 120), width: 120 }}>
          <p className="font-mono text-white/45">{h.date}</p>
          <p className="font-mono font-semibold text-gold">{pct1(h.intensity)}</p>
        </div>
      )}
    </div>
  )
}

export default function ForwardPurchases({ capex, commitments, lang }: { capex: CapexData; commitments: CommitmentsData; lang: Lang }) {
  const t = T[lang]
  const money = lang === 'zh' ? bnZh : bn
  const short = lang === 'zh' ? bnShortZh : bnShort
  const [open, setOpen] = useState<string | null>(null)
  const last = capex.latest
  const s = commitments.summary
  if (!last && !s?.companies?.length) return null

  return (
    <section className="mt-16" aria-labelledby="forward-purchases">
      <FadeIn>
        <div className="section-divider">
          <span id="forward-purchases" className="section-label">
            {t.label}
          </span>
        </div>
        <p className="mb-6 max-w-3xl text-sm leading-relaxed text-white/50">{t.intro}</p>
      </FadeIn>

      {last && (
        <FadeIn delay={0.05}>
          <div className="rounded-2xl border border-white/5 bg-surface-card p-5 md:p-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4">
              <p className="font-mono text-5xl font-bold text-gold">{pct1(last.intensity)}</p>
              <div>
                <p className="text-sm text-white/70">{t.intensity}</p>
                {capex.yearAgo && <p className="text-xs text-white/45">{t.yearAgo(pct1(capex.yearAgo.intensity))}</p>}
              </div>
            </div>
            <p className="mt-3 text-xs text-white/45">{t.intensityNote(money(last.capexTtmBn))}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(last.members).map(([ticker, m]) => (
                <span key={ticker} className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/60">
                  <span className="font-mono text-white/85">{ticker}</span> {short(m.capexTtmBn)} · {pct1(m.capexTtmBn / m.revenueTtmBn)}
                </span>
              ))}
            </div>
            {capex.series && capex.series.length > 1 && (
              <div className="mt-6">
                <p className="mb-2 text-xs text-white/45">{t.chartTitle}</p>
                <IntensityChart series={capex.series} lang={lang} />
              </div>
            )}
          </div>
        </FadeIn>
      )}

      {s && s.companies?.length > 0 && (
        <FadeIn delay={0.05}>
          <div className="mt-5 rounded-2xl border border-white/5 bg-surface-card p-5 md:p-8">
            <p className="text-sm font-semibold text-white">{t.committedTitle}</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-white/40">{t.committedIntro}</p>
            <p className="mt-4 text-lg font-semibold text-gold">{t.total(money(s.totalBn))}</p>
            {s.change !== null && s.compared.length > 0 && <p className="text-xs text-white/50">{t.change(signed(s.change), s.compared.join(', '))}</p>}
            <ul className="mt-5 divide-y divide-white/5">
              {s.companies.map((c) => {
                const leases = c.totals.leases_not_commenced
                const buys = c.totals.purchase_commitments
                const isOpen = open === c.ticker
                return (
                  <li key={c.ticker} className="py-3">
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:justify-between">
                      <p className="text-sm text-white">
                        {c.name}{' '}
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.7rem] text-white/40 underline decoration-white/20 underline-offset-2 hover:text-gold">
                          {c.form} · {c.reportDate}
                        </a>
                      </p>
                      {leases === undefined && buys === undefined ? (
                        <p className="text-xs text-white/50">{t.none}</p>
                      ) : (
                        <dl className="grid grid-cols-2 gap-x-6 text-xs sm:flex sm:gap-x-6">
                          {[
                            [t.leases, leases, c.yearAgo?.totals.leases_not_commenced],
                            [t.purchases, buys, c.yearAgo?.totals.purchase_commitments],
                          ].map(([label, now, then]) => (
                            <div key={label as string} className="sm:text-right">
                              <dt className="text-white/45">{label}</dt>
                              <dd className="font-mono text-white/85">
                                {now === undefined ? '—' : short(now as number)}
                                {typeof now === 'number' && typeof then === 'number' && then > 0 && (
                                  <span className="ml-1.5 text-white/40">{signed(now / then - 1)}</span>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    {c.items.length > 0 && (
                      <button type="button" onClick={() => setOpen(isOpen ? null : c.ticker)} aria-expanded={isOpen} className="mt-1.5 text-[0.7rem] text-gold/80 hover:text-gold">
                        {t.from} {isOpen ? '−' : '+'}
                      </button>
                    )}
                    {isOpen && (
                      <ul className="mt-2 space-y-2">
                        {c.items.map((it, i) => (
                          <li key={i} className="rounded-lg border border-white/5 bg-black/30 p-3 text-xs leading-relaxed text-white/60">
                            <span className="mb-1 block font-mono text-[0.7rem] text-white/40">
                              {it.kind === 'leases_not_commenced' ? t.leases : t.purchases} · {it.amountText} · {it.asOf}
                            </span>
                            “{it.quote}”
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[0.7rem] text-white/35">{t.checked(s.checked.kept, s.checked.dropped, s.checked.filings)}</p>
          </div>
        </FadeIn>
      )}
    </section>
  )
}
