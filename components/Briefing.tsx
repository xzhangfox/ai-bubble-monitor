'use client'

import FadeIn from './FadeIn'

// Today's reading in a few sentences, written by an LLM from the day's numbers
// and published only if every number in it is one of them (ml/briefing.py).

export interface BriefingData {
  asOf: string | null
  en?: string | null
  zh?: string | null
  model?: string
}

const T = {
  en: { label: 'Today in brief', note: 'Written by an LLM from today’s numbers; every number in it is checked against the data before it’s published.' },
  zh: { label: '今日简报', note: '由 LLM 根据今天的数据撰写；发布前逐一核对其中每个数字都来自数据。' },
}

export default function Briefing({ briefing, asOf, lang }: { briefing: BriefingData; asOf: string | null; lang: 'en' | 'zh' }) {
  const text = lang === 'zh' ? briefing.zh : briefing.en
  // (only the day it was written for: a stale briefing would contradict the gauge)
  if (!text || !asOf || briefing.asOf !== asOf) return null
  const t = T[lang]
  return (
    <FadeIn delay={0.12}>
      <div className="mt-5 rounded-2xl border border-gold/15 bg-surface-card p-5 md:p-6">
        <p className="section-label mb-3">{t.label}</p>
        <p className="text-sm leading-relaxed text-white/80 md:text-base">{text}</p>
        <p className="mt-3 text-[0.7rem] text-white/35">{t.note}</p>
      </div>
    </FadeIn>
  )
}
