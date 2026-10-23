import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { CaptionStatus, PeopleStatus, SmartSearchStatus } from '@shared/types'
import { api, n } from '../lib/format'
import { t } from '../lib/i18n'

interface Job {
  key: string
  label: string
  /** "456 of 23,463", or the model download. */
  detail: string
  /** 0–1, or null while it has nothing to measure yet. */
  progress: number | null
}

const mb = (bytes: number): string => n(Math.round(bytes / 1e6))

function downloading(d: { loaded: number; total: number } | null): Pick<Job, 'detail' | 'progress'> {
  return d && d.total > 0
    ? { detail: t('{loaded} of {total} MB', { loaded: mb(d.loaded), total: mb(d.total) }), progress: d.loaded / d.total }
    : { detail: t('Getting ready…'), progress: null }
}

/**
 * What the on-device AI is doing right now, at the foot of the sidebar: one bar per job (smart search, descriptions,
 * people). Shown only while something runs; opens Settings at the AI sections.
 */
export function BackgroundWork(props: { onOpen: () => void }) {
  const [smart, setSmart] = useState<SmartSearchStatus | null>(null)
  const [captions, setCaptions] = useState<CaptionStatus | null>(null)
  const [people, setPeople] = useState<PeopleStatus | null>(null)

  useEffect(() => {
    void api.smartSearchStatus().then(setSmart)
    void api.captionStatus().then(setCaptions)
    void api.peopleStatus().then(setPeople)
    const offs = [api.onSmartSearchStatus(setSmart), api.onCaptionStatus(setCaptions), api.onPeopleStatus(setPeople)]
    return () => offs.forEach((off) => off())
  }, [])

  const jobs: Job[] = []
  if (smart?.enabled) {
    if (smart.phase === 'downloading' || smart.phase === 'loading') jobs.push({ key: 'smart', label: t('Search'), ...downloading(smart.download) })
    else if (smart.phase === 'indexing' && smart.total > 0)
      jobs.push({ key: 'smart', label: t('Search'), detail: t('{done} of {total}', { done: n(smart.indexed), total: n(smart.total) }), progress: smart.indexed / smart.total })
  }
  if (captions?.enabled) {
    if (captions.phase === 'downloading' || captions.phase === 'loading') jobs.push({ key: 'captions', label: t('Descriptions'), ...downloading(captions.download) })
    else if (captions.phase === 'describing' && captions.total > 0)
      jobs.push({
        key: 'captions',
        label: t('Descriptions'),
        detail: t('{done} of {total}', { done: n(captions.described), total: n(captions.total) }),
        progress: captions.described / captions.total
      })
  }
  if (people?.enabled) {
    if (people.phase === 'downloading') jobs.push({ key: 'people', label: t('People'), ...downloading(people.download) })
    else if (people.phase === 'scanning' && people.total > 0)
      jobs.push({ key: 'people', label: t('People'), detail: t('{done} of {total}', { done: n(people.scanned), total: n(people.total) }), progress: people.scanned / people.total })
    else if (people.phase === 'grouping') jobs.push({ key: 'people', label: t('People'), detail: t('Grouping faces…'), progress: null })
  }
  if (jobs.length === 0) return null

  return (
    <button
      onClick={props.onOpen}
      aria-label={t('Working on your photos: {jobs}', { jobs: jobs.map((j) => `${j.label} ${j.detail}`).join(', ') })}
      className="flex w-full flex-col gap-2 rounded-[14px] border border-line bg-card px-3 py-2.5 text-left transition-colors hover:border-line-strong"
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold leading-[18px] text-ink">
        <Sparkles className="size-3.5 animate-pulse text-brass-ink" strokeWidth={2} />
        {t('Working on your photos')}
      </span>
      {jobs.map((j) => (
        <span key={j.key} className="block" title={`${j.label}: ${j.detail}`}>
          <span className="flex items-baseline justify-between gap-2 text-xs leading-4">
            <span className="truncate text-ink">{j.label}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">
              {j.progress !== null && !j.detail.includes('MB') ? `${Math.floor(j.progress * 100)}%` : j.detail}
            </span>
          </span>
          <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-line">
            {j.progress !== null && (
              <span className="block h-full rounded-full bg-brass transition-[width] duration-[var(--dur-base)]" style={{ width: `${Math.max(1, Math.round(j.progress * 100))}%` }} />
            )}
          </span>
        </span>
      ))}
    </button>
  )
}
