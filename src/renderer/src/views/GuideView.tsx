import { useMemo, useState } from 'react'
import guideEn from '../../../../docs/USER_GUIDE.md?raw'
import guidePt from '../../../../docs/USER_GUIDE.pt.md?raw'
import changelog from '../../../../CHANGELOG.md?raw'
import { Markdown, parseMarkdown } from '../components/Markdown'
import { ViewHeader } from './CleanupView'
import { language, t } from '../lib/i18n'

export type GuideTab = 'guide' | 'new'

/**
 * The user guide (docs/USER_GUIDE.md, or its Portuguese twin) and the changelog, bundled with the app so they work
 * offline and always match the installed version. The files' own title is the page header, so it is left out.
 */
export function GuideView(props: { initialTab?: GuideTab }) {
  const [tab, setTab] = useState<GuideTab>(props.initialTab ?? 'guide')
  const blocks = useMemo(() => {
    const md = tab === 'guide' ? (language() === 'pt' ? guidePt : guideEn) : changelog.slice(changelog.indexOf('\n## ') + 1)
    return parseMarkdown(md).filter((b) => !(b.type === 'h' && b.level === 1))
  }, [tab])
  const sections = blocks.filter((b) => b.type === 'h' && b.level === 2)

  return (
    <div className="scroll-page h-full overflow-y-auto">
      <ViewHeader
        title={t('Guide')}
        subtitle={tab === 'guide' ? t('How Photo Vault keeps your photos, and how to keep them safe.') : t('What changed in each version.')}
      />
      <div className="px-6 pb-16 pt-2">
        <div role="tablist" className="mb-8 inline-flex rounded-lg bg-line/60 p-0.5">
          {(
            [
              ['guide', t('Guide')],
              ['new', t('What’s new')]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-8 rounded-md px-4 text-[13px] font-medium transition-colors ${tab === id ? 'bg-card text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-12">
          <Markdown blocks={blocks} />
          {tab === 'guide' && sections.length > 2 && (
            <nav aria-label={t('Contents')} className="sticky top-28 hidden w-52 shrink-0 xl:block">
              <div className="mb-2 text-[11px] font-[650] uppercase tracking-[0.07em] text-ink-muted">{t('Contents')}</div>
              {sections.map((s) =>
                s.type === 'h' ? (
                  <button
                    key={s.id}
                    onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
                    className="block w-full truncate rounded-md px-2 py-1 text-left text-[13px] text-ink-muted hover:bg-line/60 hover:text-ink"
                  >
                    {s.text.replace(/\*\*/g, '')}
                  </button>
                ) : null
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}
