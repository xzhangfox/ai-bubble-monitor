'use client'

import { useEffect, useRef } from 'react'
import en from '@/content/documentation.en.json'
import zh from '@/content/documentation.zh.json'
import type { ModelData } from './ModelView'
import type { Lang } from './useLanguage'

interface Section {
  id: string
  title: string
  summary: string
  paragraphs?: string[]
  table?: { columns: string[]; rows: string[][] }
  paragraphsAfter?: string[]
  details?: { title: string; paragraphs: string[] }
  links?: { label: string; url: string }[]
}

// One content source drives the responsive reader and the repository Markdown.
function DocumentationTable({ columns, rows, title }: { columns: string[]; rows: string[][]; title: string }) {
  return (
    <>
      <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-[13px] leading-relaxed">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-white/[0.04] text-gold/90">
            <tr>{columns.map((column) => <th key={column} scope="col" className="px-4 py-3 font-medium">{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/[0.07]">
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => i === 0
                  ? <th key={i} scope="row" className="w-[24%] px-4 py-4 align-top font-medium text-white/90">{cell}</th>
                  : <td key={i} className="px-4 py-4 align-top text-white/65">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden" aria-label={title}>
        {rows.map((row) => (
          <div key={row[0]} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h4 className="text-sm font-medium text-gold/90">{row[0]}</h4>
            <dl className="mt-3 space-y-3 text-[13px] leading-relaxed">
              {row.slice(1).map((cell, i) => (
                <div key={columns[i + 1]}>
                  <dt className="mb-1 text-xs text-white/45">{columns[i + 1]}</dt>
                  <dd className="text-white/75">{cell}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  )
}

function CurrentResults({ model, lang }: { model: ModelData; lang: Lang }) {
  const t = (lang === 'zh' ? zh : en).snapshot
  const models = model.models?.filter((item) => Number.isFinite(item.auc) && Number.isFinite(item.brierSkill)) ?? []
  const metric = (value: number, interval?: (number | null)[]) => {
    const bounds = interval?.length === 2 && interval.every((v) => v !== null && Number.isFinite(v))
      ? ` [${interval.map((v) => v!.toFixed(3)).join(', ')}]`
      : ''
    return `${value.toFixed(3)}${bounds}`
  }

  return (
    <div className="mt-6 rounded-xl border border-gold/20 bg-gold/[0.03] p-4 sm:p-5" data-testid="documentation-results">
      <h4 className="text-base font-medium text-gold">{t.title}</h4>
      {!models.length ? <p className="mt-3 text-sm leading-relaxed text-white/65">{t.empty}</p> : (
        <>
          <p className="mt-2 text-xs text-white/55">{t.asOf}: {model.asOf ?? '—'}</p>
          {model.backtest && (
            <dl className="my-4 grid gap-3 text-xs leading-relaxed sm:grid-cols-2">
              <div><dt className="text-white/45">{t.period}</dt><dd className="mt-1 text-white/80">{model.backtest.start} → {model.backtest.end}</dd></div>
              <div><dt className="text-white/45">{t.episodes}</dt><dd className="mt-1 text-white/80">{model.backtest.episodes}</dd></div>
              <div className="sm:col-span-2"><dt className="text-white/45">{t.baseline}</dt><dd className="mt-1 text-white/80">{(model.backtest.baseRate * 100).toFixed(1)}%</dd><dd className="mt-1 text-white/45">{t.baselineNote}</dd></div>
            </dl>
          )}
          <DocumentationTable
            title={t.title}
            columns={t.columns}
            rows={models.map((item) => [t.modelNames[item.id as keyof typeof t.modelNames] ?? item.name, metric(item.auc, item.aucCi), metric(item.brierSkill, item.brierSkillCi)])}
          />
          <p className="mt-4 text-sm leading-relaxed text-gold/90">{model.headline?.beatsBaseRate ? t.supported : t.unsupported}</p>
        </>
      )}
    </div>
  )
}

export default function Documentation({ lang, model, onClose, onToggleLanguage }: {
  lang: Lang
  model: ModelData
  onClose: () => void
  onToggleLanguage: () => void
}) {
  const t = lang === 'zh' ? zh : en
  const sections: Section[] = t.sections
  const dialogRef = useRef<HTMLDialogElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      if (dialog.open) dialog.close()
      document.body.style.overflow = overflow
      opener?.focus({ preventScroll: true })
    }
  }, [])

  const jumpTo = (id: string) => {
    const body = bodyRef.current
    const section = document.getElementById(`documentation-${id}`)
    if (!body || !section) return
    body.scrollTo({
      top: body.scrollTop + section.getBoundingClientRect().top - body.getBoundingClientRect().top - 24,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  return (
    <dialog
      ref={dialogRef}
      id="documentation-dialog"
      lang={lang === 'zh' ? 'zh-CN' : 'en'}
      aria-labelledby="documentation-title"
      aria-describedby="documentation-subtitle"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex="0"]')].filter((el) => el.getClientRects().length)
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      className="fixed bottom-auto right-auto left-[50dvw] top-[50dvh] m-0 h-[calc(100dvh_-_1rem)] max-h-none w-[calc(100dvw_-_1rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-clip rounded-2xl border border-gold/25 bg-bg p-0 text-white shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm sm:h-[90dvh]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-5 sm:px-8">
          <div className="min-w-0">
            <h2 id="documentation-title" className="text-lg font-semibold text-gold sm:text-2xl">{t.title}</h2>
            <p id="documentation-subtitle" className="mt-2 max-w-2xl text-xs leading-relaxed text-white/55 sm:text-sm">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onToggleLanguage} aria-label={t.language} className="rounded-md border border-gold/30 px-2.5 py-2 text-xs text-gold/90 hover:bg-gold/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{lang === 'zh' ? 'EN' : '中文'}</button>
            <button type="button" autoFocus onClick={onClose} aria-label={t.close} className="rounded-md p-2 text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav aria-label={t.navigation} className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 p-3 lg:w-48 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
            {sections.map((section, i) => (
              <button key={section.id} type="button" onClick={() => jumpTo(section.id)} className="shrink-0 rounded-lg px-3 py-2.5 text-left text-xs leading-relaxed text-white/65 hover:bg-gold/10 hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold lg:shrink">
                <span className="mr-2 font-mono text-gold/55">{String(i + 1).padStart(2, '0')}</span>{section.title}
              </button>
            ))}
          </nav>
          <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-8 sm:py-8" data-testid="documentation-body">
            <div className="space-y-10">
              {sections.map((section, i) => (
                <section key={section.id} id={`documentation-${section.id}`} aria-labelledby={`documentation-heading-${section.id}`} className="scroll-mt-6">
                  <p className="mb-2 text-xs font-mono text-gold/45">{String(i + 1).padStart(2, '0')}</p>
                  <h3 id={`documentation-heading-${section.id}`} className="text-lg font-medium text-white/95">{section.title}</h3>
                  <p className="mb-5 mt-2 text-sm leading-relaxed text-white/50">{section.summary}</p>
                  {section.id === 'evaluation' && section.paragraphs?.map((paragraph) => <p key={paragraph} className="mb-4 text-sm leading-7 text-white/70">{paragraph}</p>)}
                  {section.table && <DocumentationTable {...section.table} title={section.title} />}
                  {section.id !== 'evaluation' && section.paragraphs?.map((paragraph) => <p key={paragraph} className="mt-4 text-sm leading-7 text-white/70">{paragraph}</p>)}
                  {section.details && (
                    <details className="mt-5 rounded-xl border border-white/10 p-4 text-sm">
                      <summary className="cursor-pointer text-gold/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{section.details.title}</summary>
                      {section.details.paragraphs.map((paragraph) => <p key={paragraph} className="mt-4 leading-7 text-white/65">{paragraph}</p>)}
                    </details>
                  )}
                  {section.paragraphsAfter?.map((paragraph) => <p key={paragraph} className="mt-4 text-sm leading-7 text-white/70">{paragraph}</p>)}
                  {section.id === 'evaluation' && <CurrentResults model={model} lang={lang} />}
                  {section.links && <ul className="space-y-3">{section.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm leading-relaxed text-gold/85 underline decoration-gold/25 underline-offset-4 hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{link.label}<span aria-hidden="true" className="ml-1.5">↗</span></a></li>)}</ul>}
                </section>
              ))}
            </div>
          </div>
        </div>
      </div>
    </dialog>
  )
}
