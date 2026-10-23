import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ModalPanel } from '../components/Modal'
import { ArrowLeft, ArrowRightLeft, Check, Eye, Undo2, UserPlus, UserX, EyeOff, HelpCircle, LoaderCircle, Merge, Pencil, ShieldCheck, UserRound, Users, X } from 'lucide-react'
import type { AssetQuery, PeopleStatus, PeopleSuggestion, Person, PersonMerge, PetGroup } from '@shared/types'
import { AssetGrid } from '../components/AssetGrid'
import { ConfirmDialog, PromptDialog } from '../components/Dialog'
import { FilterBar } from '../components/FilterBar'
import { api, bytes, mediaUrl, n, plural } from '../lib/format'
import { PageHeader } from './Placeholder'
import { NoMatches } from './PhotosView'
import { locale, t } from '../lib/i18n'

const faceUrl = (faceId: number): string => `pv-media://face/${faceId}`

export function Face(props: { person: Person; size: number }) {
  return props.person.coverFaceId ? (
    <img
      src={faceUrl(props.person.coverFaceId)}
      alt=""
      className="shrink-0 rounded-full bg-stone-200 object-cover dark:bg-stone-800"
      style={{ width: props.size, height: props.size }}
    />
  ) : (
    <div className="grid shrink-0 place-items-center rounded-full bg-stone-200 text-stone-400 dark:bg-stone-800" style={{ width: props.size, height: props.size }}>
      <UserRound className="size-1/2" />
    </div>
  )
}

export function PeopleView(props: { version: number; openPersonId?: number | null }) {
  const [personId, setPersonId] = useState<number | null>(props.openPersonId ?? null)
  useEffect(() => {
    if (props.openPersonId) setPersonId(props.openPersonId)
  }, [props.openPersonId])
  const [pet, setPet] = useState<PetGroup | null>(null)
  if (personId !== null) return <PersonPage id={personId} version={props.version} onBack={() => setPersonId(null)} onOpen={setPersonId} />
  if (pet) return <PetPage group={pet} version={props.version} onBack={() => setPet(null)} />
  return <PeopleList version={props.version} onOpen={setPersonId} onOpenPet={setPet} />
}

function usePeopleStatus(): PeopleStatus | null {
  const [s, setS] = useState<PeopleStatus | null>(null)
  useEffect(() => {
    void api.peopleStatus().then(setS)
    return api.onPeopleStatus(setS)
  }, [])
  return s
}

function statusLine(s: PeopleStatus): string | null {
  if (s.phase === 'downloading' && s.download) return t('Downloading the face models… {v0} of {v1}', { v0: bytes(s.download.loaded), v1: bytes(s.download.total) })
  if (s.phase === 'scanning') return t('Looking for faces… {scanned} of {total} photos ({v2}%) — people appear as they are found', { scanned: n(s.scanned), total: n(s.total), v2: s.total ? Math.floor((s.scanned / s.total) * 100) : 0 })
  if (s.phase === 'grouping') return t('Grouping faces into people…')
  if (s.phase === 'error') return t('Something went wrong: {error}', { error: s.error })
  return null
}

function PeopleList(props: { version: number; onOpen: (id: number) => void; onOpenPet: (g: PetGroup) => void }) {
  const status = usePeopleStatus()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [suggestions, setSuggestions] = useState<PeopleSuggestion[]>([])
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    void api.people().then(setPeople)
  }, [props.version, status?.people, status?.phase])

  useEffect(() => {
    if (!reviewing) void api.peopleSuggestions().then(setSuggestions)
  }, [props.version, status?.people, status?.phase === 'ready', reviewing])

  if (!status) return <div className="h-full" />
  if (!status.enabled) return <TurnOn version={props.version} onOpenPet={props.onOpenPet} />

  const visible = (people ?? []).filter((p) => !p.hidden)
  const hidden = (people ?? []).filter((p) => p.hidden)
  const line = statusLine(status)

  return (
    <div className="scroll-page h-full overflow-y-auto">
      <PageHeader title={t('People')} subtitle={t('Photos grouped by the faces in them. Name someone to find them by name in search; merge duplicates; fix mistakes from a person\'s page.')} />
      <div className="mx-auto max-w-5xl px-8 pb-12">
        {line && (
          <div className={`mb-6 flex items-center gap-2 rounded-[14px] border border-line bg-card px-4 py-3 text-[13px] ${status.phase === 'error' ? 'text-red-600 dark:text-red-400' : ''}`}>
            {status.phase !== 'error' && <LoaderCircle className="size-3.5 shrink-0 animate-spin" />}
            {line}
            {status.phase === 'error' && (
              <button onClick={() => void api.setPeopleEnabled(true)} className="ml-auto rounded-lg px-3 py-1 font-medium hover:bg-stone-100 dark:hover:bg-stone-800">{t('Try again')}</button>
            )}
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="mb-6 flex items-center gap-4 rounded-[14px] border border-line bg-card px-4 py-3">
            <div className="flex -space-x-3">
              <Face person={suggestions[0]!.a} size={40} />
              <Face person={suggestions[0]!.b} size={40} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{t('Same person?')}</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {plural(suggestions.length, 'pair')}{' '}{t('of people look alike. Confirming joins their photos; your answers are remembered.')}</div>
            </div>
            <button
              onClick={() => setReviewing(true)}
              className="h-9 shrink-0 rounded-lg bg-stone-900 px-4 text-[13px] font-medium text-white hover:bg-stone-800 dark:bg-white dark:text-stone-900"
            >{t('Review')}</button>
          </div>
        )}
        {people && visible.length === 0 && status.phase === 'ready' && (
          <div className="rounded-2xl border border-dashed border-stone-300 py-14 text-center text-[13.5px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{t('No people found yet. A person appears once their face is on at least 3 photos.')}</div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
          {visible.map((p) => (
            <PersonCard key={p.id} person={p} onOpen={() => props.onOpen(p.id)} />
          ))}
        </div>
        <Pets version={props.version} onOpen={props.onOpenPet} />
        {hidden.length > 0 && (
          <div className="mt-10">
            <button onClick={() => setShowHidden((v) => !v)} className="mb-4 text-[13px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
              {showHidden ? t('Hide') : t('Show')}{' '}{t('hidden people (')}{hidden.length})
            </button>
            {showHidden && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6 opacity-70">
                {hidden.map((p) => (
                  <PersonCard key={p.id} person={p} onOpen={() => props.onOpen(p.id)} />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-5 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          <ShieldCheck className="size-4" />{t('Faces are found and compared on this computer only.')}{' '}{n(status.faces)}{' '}{t('faces on')}{' '}{n(status.scanned)}{' '}{t('photos.')}<button onClick={() => void api.setPeopleEnabled(false)} className="ml-auto rounded-lg px-2.5 py-1 font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800">{t('Pause')}</button>
          <button onClick={() => setClearing(true)} className="rounded-lg px-2.5 py-1 font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">{t('Turn off and delete face data')}</button>
        </div>
      </div>
      {reviewing && <SamePersonReview suggestions={suggestions} onClose={() => setReviewing(false)} />}
      {clearing && (
        <ConfirmDialog
          title={t('Delete all face data?')}
          body={t('The faces found, the people and their names are forgotten. Your photos are not touched. You can turn People on again later; faces will be looked for again from scratch.')}
          confirm={t('Delete face data')}
          destructive
          onClose={() => setClearing(false)}
          onConfirm={async () => {
            setClearing(false)
            await api.clearPeople()
          }}
        />
      )}
    </div>
  )
}

/** Google-Photos-style "Same or different person?" questions, one pair at a time. */
function SamePersonReview(props: { suggestions: PeopleSuggestion[]; onClose: () => void }) {
  // One question per pair of people, even if a refreshed list repeats one.
  const [queue, setQueue] = useState(() => {
    const seen = new Set<string>()
    return props.suggestions.filter((s) => {
      const key = [s.a.id, s.b.id].sort((x, y) => x - y).join(':')
      return !seen.has(key) && !!seen.add(key)
    })
  })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  // A merged person no longer exists: drop questions about them (the next round of suggestions will ask again).
  const [gone, setGone] = useState<Set<number>>(new Set())
  const current = queue.find((s) => !gone.has(s.a.id) && !gone.has(s.b.id))

  useEffect(() => {
    if (!current) props.onClose()
  }, [current])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
      else if (busy || !current) return
      else if (e.key.toLowerCase() === 's') void answer(true)
      else if (e.key.toLowerCase() === 'd') void answer(false)
      else if (e.key.toLowerCase() === 'n') void answer(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!current) return null

  const answer = async (same: boolean | null): Promise<void> => {
    setBusy(true)
    try {
      if (same === true) {
        const keepA = (!!current.a.name && !current.b.name) || (!!current.a.name === !!current.b.name && current.a.photos >= current.b.photos)
        const [target, source] = keepA ? [current.a, current.b] : [current.b, current.a]
        await api.mergePeople(target.id, [source.id])
        setGone((g) => new Set([...g, source.id, target.id]))
      } else if (same === false) {
        await api.markDifferentPeople(current.a.id, current.b.id)
      }
      setQueue((q) => q.filter((s) => s !== current))
      setDone((d) => d + 1)
    } finally {
      setBusy(false)
    }
  }

  const side = (p: Person, faces: number[]): ReactNode => (
    <div className="flex flex-1 flex-col items-center gap-3">
      <Face person={p} size={120} />
      <div className="text-center">
        <div className="text-[14px] font-medium">{p.name ?? <span className="text-stone-400">{t('Unnamed')}</span>}</div>
        <div className="text-xs text-stone-500">{plural(p.photos, 'photo')}</div>
      </div>
      <div className="flex gap-1.5">
        {faces.map((id) => (
          <img key={id} src={faceUrl(id)} alt="" className="size-14 rounded-lg bg-stone-200 object-cover dark:bg-stone-800" />
        ))}
      </div>
    </div>
  )

  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 backdrop-blur-sm animate-fade-in" onClick={props.onClose}>
      <ModalPanel className="w-[640px] rounded-2xl bg-white p-6 shadow-2xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()} aria-label={t('Same or different person?')}>
        <div className="mb-6 flex items-center">
          <div className="flex-1">
            <div className="text-[17px] font-semibold">{t('Same or different person?')}</div>
            <div className="text-xs text-stone-500 dark:text-stone-400">
              {done}{' '}{t('answered ·')}{' '}{queue.filter((s) => !gone.has(s.a.id) && !gone.has(s.b.id)).length}{' '}{t('to go')}</div>
          </div>
          <button onClick={props.onClose} className="grid size-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label={t('Close')}>
            <X className="size-4" />
          </button>
        </div>
        <div className="flex items-start gap-6">
          {side(current.a, current.aFaces)}
          <div className="mt-12 text-stone-300 dark:text-stone-600">
            <HelpCircle className="size-6" />
          </div>
          {side(current.b, current.bFaces)}
        </div>
        <div className="mt-8 flex justify-center gap-2">
          <button
            disabled={busy}
            onClick={() => void answer(false)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-stone-100 px-5 text-[13.5px] font-medium hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-800 dark:hover:bg-stone-700"
          >
            <X className="size-4" />{' '}{t('Different people')}{' '}<kbd className="ml-1 text-[11px] opacity-50">D</kbd>
          </button>
          <button
            disabled={busy}
            onClick={() => void answer(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-stone-900 px-5 text-[13.5px] font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-white dark:text-stone-900"
          >
            <Check className="size-4" />{' '}{t('Same person')}{' '}<kbd className="ml-1 text-[11px] opacity-50">S</kbd>
          </button>
          <button disabled={busy} onClick={() => void answer(null)} className="h-10 rounded-xl px-4 text-[13px] font-medium text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800">{t('Not sure')}</button>
        </div>
      </ModalPanel>
    </div>
  )
}

const PET_NAMES: Record<PetGroup['kind'], string> = { dog: t('Dogs'), cat: t('Cats') }

/** Dogs and cats, found by smart search (zero-shot). Only shown when there are some. */
function Pets(props: { version: number; onOpen: (g: PetGroup) => void }) {
  const [groups, setGroups] = useState<PetGroup[]>([])
  const [smartOn, setSmartOn] = useState(true)
  useEffect(() => {
    void api.smartSearchStatus().then((s) => setSmartOn(!!s?.enabled))
    void api.pets().then(setGroups, () => setGroups([]))
  }, [props.version])
  if (!smartOn) return <p className="mt-10 text-xs text-stone-500 dark:text-stone-400">{t('Pets: turn on smart search in Settings and your dogs and cats get their own groups here.')}</p>
  if (groups.length === 0) return null
  return (
    <div className="mt-10">
      <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{t('Pets')}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
        {groups.map((g) => (
          <button key={g.kind} onClick={() => props.onOpen(g)} className="group flex flex-col items-center gap-2 text-center">
            <div className="rounded-full ring-accent-500 ring-offset-2 ring-offset-stone-50 transition group-hover:ring-2 dark:ring-offset-stone-950">
              <img src={mediaUrl('thumb', g.ids[0] as number)} alt="" className="size-28 rounded-full bg-stone-200 object-cover dark:bg-stone-800" />
            </div>
            <div className="w-full truncate text-[13.5px] font-medium">{PET_NAMES[g.kind]}</div>
            <div className="-mt-1.5 text-xs text-stone-500 dark:text-stone-400">{plural(g.ids.length, 'photo')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function PetPage(props: { group: PetGroup; version: number; onBack: () => void }) {
  const [query, setQuery] = useState<AssetQuery>({})
  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <button onClick={props.onBack} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">
          <ArrowLeft className="size-4" />
          {t('All people')}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AssetGrid
          version={props.version}
          query={{ ...query, ids: props.group.ids, hidden: 'exclude' }}
          title={<span>{PET_NAMES[props.group.kind]}</span>}
          toolbar={<FilterBar query={query} onChange={setQuery} version={props.version} base={{ ids: props.group.ids, hidden: 'exclude' }} />}
          empty={<NoMatches />}
        />
      </div>
    </div>
  )
}

function PersonCard(props: { person: Person; onOpen: () => void }) {
  const p = props.person
  return (
    <button onClick={props.onOpen} className="group flex flex-col items-center gap-2 text-center">
      <div className="rounded-full ring-accent-500 ring-offset-2 ring-offset-stone-50 transition group-hover:ring-2 dark:ring-offset-stone-950">
        <Face person={p} size={112} />
      </div>
      <div className="w-full truncate text-[13.5px] font-medium">{p.name ?? <span className="text-stone-400">{t('Add a name')}</span>}</div>
      <div className="-mt-1.5 text-xs text-stone-500 dark:text-stone-400">{plural(p.photos, 'photo')}</div>
    </button>
  )
}

function TurnOn(props: { version: number; onOpenPet: (g: PetGroup) => void }) {
  const status = usePeopleStatus()
  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[520px] text-center">
        <div className="mx-auto mb-6 grid size-20 place-items-center rounded-3xl bg-stone-200/70 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <Users className="size-9" strokeWidth={1.4} />
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">{t('People')}</h1>
        <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-stone-600 dark:text-stone-400">{t('Group your photos by the people in them, like Google Photos — but entirely on this computer. Nothing is uploaded, and face data can be deleted at any time.')}</p>
        <ul className="mx-auto mt-5 max-w-sm space-y-1.5 text-left text-[13px] text-stone-500 dark:text-stone-400">
          <li>{t('• Downloads two small open models once (about 39 MB).')}</li>
          <li>{t('• Then looks at every photo in the background (about 10 per second).')}</li>
          <li>{t('• You name people, merge look-alike groups and fix mistakes; your corrections are kept.')}</li>
        </ul>
        <button
          onClick={() => void api.setPeopleEnabled(true)}
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-stone-900 px-6 text-[14px] font-medium text-white shadow-sm transition hover:bg-stone-800 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
        >
          <Users className="size-4" />{' '}{t('Find people in my photos')}</button>
        {status?.phase === 'error' && <div className="mt-4 text-[13px] text-red-600 dark:text-red-400">{status.error}</div>}
        <div className="text-left">
          <Pets version={props.version} onOpen={props.onOpenPet} />
        </div>
      </div>
    </div>
  )
}

function PersonPage(props: { id: number; version: number; onBack: () => void; onOpen: (id: number) => void }) {
  const [person, setPerson] = useState<Person | null>(null)
  const [query, setQuery] = useState<AssetQuery>({})
  const [naming, setNaming] = useState(false)
  const [merging, setMerging] = useState(false)
  const [conflict, setConflict] = useState<{ other: Person; name: string } | null>(null)
  const [tab, setTab] = useState<'photos' | 'faces'>('photos')
  const [merges, setMerges] = useState<PersonMerge[]>([])
  const [showMerges, setShowMerges] = useState(false)

  useEffect(() => {
    void api.person(props.id).then((p) => (p ? setPerson(p) : props.onBack()))
    void api.personMerges(props.id).then(setMerges)
  }, [props.id, props.version])

  if (!person) return <div className="h-full" />
  const iconBtn =
    'grid size-8 place-items-center rounded-lg text-stone-500 transition hover:bg-stone-200/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'

  const tabs = (
    <div className="inline-flex rounded-lg bg-stone-200/60 p-0.5 text-[12.5px] font-medium dark:bg-stone-800/80">
      {(['photos', 'faces'] as const).map((tb) => (
        <button
          key={tb}
          onClick={() => setTab(tb)}
          className={`rounded-md px-3 py-1 transition ${tab === tb ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'}`}
        >
          {tb === 'photos' ? t('Photos') : t('Faces')}
        </button>
      ))}
    </div>
  )

  const title = (
          <span className="flex items-center gap-3">
            <button onClick={props.onBack} className={`no-drag ${iconBtn}`} aria-label={t('All people')}>
              <ArrowLeft className="size-4" />
            </button>
            <Face person={person} size={40} />
            <button onClick={() => setNaming(true)} className="no-drag hover:text-accent-600">
              {person.name ?? <span className="text-stone-400">{t('Add a name')}</span>}
            </button>
          </span>
  )
  const actions = (
          <>
            {merges.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowMerges((s) => !s)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800"
                  title={t('People merged into this one — undo any of them')}
                >
                  <Undo2 className="size-3.5" />{' '}{t('Merges (')}{merges.length})
                </button>
                {showMerges && (
                  <MergesMenu
                    merges={merges}
                    onClose={() => setShowMerges(false)}
                    onUndo={async (m) => {
                      setShowMerges(false)
                      await api.undoMerge(m.id)
                      void api.personMerges(props.id).then(setMerges)
                    }}
                  />
                )}
              </div>
            )}
            <button onClick={() => setNaming(true)} className={iconBtn} aria-label={t('Rename')} title={t('Name this person')}>
              <Pencil className="size-4" />
            </button>
            <button onClick={() => setMerging(true)} className={iconBtn} aria-label={t('Merge')} title={t('Same person as someone else? Merge')}>
              <Merge className="size-4" />
            </button>
            <button
              onClick={async () => {
                await api.setPersonHidden(person.id, !person.hidden)
                setPerson({ ...person, hidden: !person.hidden })
              }}
              className={iconBtn}
              aria-label={person.hidden ? t('Show person') : t('Hide person')}
              title={person.hidden ? t('Show this person in People again') : t('Hide this person from People (photos stay)')}
            >
              {person.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
          </>
  )

  return (
    <>
      {tab === 'photos' ? (
        <AssetGrid
          version={props.version}
          query={{ ...query, personId: props.id, hidden: 'exclude' }}
          personId={props.id}
          title={title}
          actions={actions}
          toolbar={
            <div className="space-y-2.5">
              {tabs}
              <FilterBar query={query} onChange={setQuery} version={props.version} base={{ personId: props.id, hidden: 'exclude' }} />
            </div>
          }
          empty={<NoMatches onClear={() => setQuery({})} />}
        />
      ) : (
        <FacesPanel person={person} version={props.version} title={title} actions={actions} tabs={tabs} onOpen={props.onOpen} />
      )}
      {naming && (
        <PromptDialog
          title={person.name ? t('Rename') : t('Who is this?')}
          label={t('Name')}
          initial={person.name ?? ''}
          placeholder={t('Name')}
          confirm={t('Save')}
          onClose={() => setNaming(false)}
          onSubmit={async (value) => {
            setNaming(false)
            const r = await api.renamePerson(person.id, value)
            if (r.conflict) setConflict({ other: r.conflict, name: value })
            else setPerson({ ...person, name: value.trim() || null })
          }}
        />
      )}
      {conflict && (
        <ConfirmDialog
          title={t('Is this also {name}?', { name: conflict.other.name })}
          body={t('“{name}” already exists with {photos}. Merge these photos into {v2}?', { name: conflict.other.name, photos: plural(conflict.other.photos, 'photo'), v2: conflict.other.name })}
          confirm={t('Merge')}
          onClose={() => setConflict(null)}
          onConfirm={async () => {
            const target = conflict.other.id
            setConflict(null)
            await api.mergePeople(target, [person.id])
            props.onOpen(target)
          }}
        />
      )}
      {merging && (
        <MergePicker
          exclude={person.id}
          onClose={() => setMerging(false)}
          onPick={async (other) => {
            setMerging(false)
            // Keep the named one (or the bigger one) as the target.
            const keepOther = (!!other.name && !person.name) || (!!other.name === !!person.name && other.photos > person.photos)
            const target = keepOther ? other.id : person.id
            await api.mergePeople(target, [keepOther ? person.id : other.id])
            props.onOpen(target)
            if (target === person.id) void api.person(person.id).then((p) => p && setPerson(p))
          }}
        />
      )}
    </>
  )
}

function MergesMenu(props: { merges: PersonMerge[]; onUndo: (m: PersonMerge) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={props.onClose} />
      <div className="absolute right-0 top-10 z-40 w-80 rounded-xl bg-white p-2 shadow-2xl ring-1 ring-stone-900/5 dark:bg-stone-900 dark:ring-white/10">
        <div className="px-2 pb-2 pt-1 text-xs text-stone-500 dark:text-stone-400">{t('Merged into this person. Undo splits those faces off again (and they won\'t be merged back).')}</div>
        {props.merges.map((m) => (
          <div key={m.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-800/60">
            <div className="flex -space-x-2">
              {m.sampleFaceIds.slice(0, 3).map((id) => (
                <img key={id} src={faceUrl(id)} alt="" className="size-8 rounded-full object-cover ring-2 ring-white dark:ring-stone-900" />
              ))}
            </div>
            <div className="min-w-0 flex-1 text-[12.5px]">
              <div className="truncate font-medium">{m.name ?? t('Unnamed person')}</div>
              <div className="text-[11px] text-stone-500">
                {plural(m.faces, 'face')} · {m.automatic ? t('automatic') : t('by you')} · {new Date(m.mergedAt).toLocaleDateString(locale())}
              </div>
            </div>
            <button onClick={() => props.onUndo(m)} className="rounded-md px-2 py-1 text-[12px] font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-500/10">{t('Undo')}</button>
          </div>
        ))}
      </div>
    </>
  )
}

/** Every face of a person: select faces to remove them or move them to someone else. */
function FacesPanel(props: { person: Person; version: number; title: ReactNode; actions: ReactNode; tabs: ReactNode; onOpen: (id: number) => void }) {
  const [faces, setFaces] = useState<Array<{ id: number; assetId: number }> | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [moving, setMoving] = useState(false)
  const [naming, setNaming] = useState(false)
  const last = useRef<number | null>(null)

  useEffect(() => {
    void api.personFaces(props.person.id).then((f) => {
      setFaces(f)
      setSelected((s) => new Set([...s].filter((id) => f.some((x) => x.id === id))))
    })
  }, [props.person.id, props.version])

  const toggle = (id: number, shift: boolean): void => {
    setSelected((s) => {
      const next = new Set(s)
      if (shift && last.current !== null && faces) {
        const a = faces.findIndex((f) => f.id === last.current)
        const b = faces.findIndex((f) => f.id === id)
        for (const f of faces.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(f.id)
      } else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    last.current = id
  }
  const ids = [...selected]
  const name = props.person.name ?? t('this person')

  return (
    <div className="scroll-page relative h-full overflow-y-auto">
      <header className="drag sticky top-0 z-10 bg-stone-50/80 px-7 pb-3 pr-40 pt-5 backdrop-blur-xl dark:bg-stone-950/75">
        <div className="flex min-h-[40px] items-end justify-between gap-4">
          <h1 className="truncate font-[family-name:var(--font-display)] text-[26px] font-bold leading-8 tracking-[-0.015em]">{props.title}</h1>
          <div className="no-drag flex shrink-0 items-center gap-2">
            {faces && <span className="text-xs tabular-nums text-stone-500">{plural(faces.length, 'face')}</span>}
            {props.actions}
          </div>
        </div>
        <div className="no-drag mt-3 flex items-center gap-3">
          {props.tabs}
          <span className="text-xs text-stone-500 dark:text-stone-400">{t('Click faces that aren\'t')}{' '}{name}{' '}{t('(Shift-click for a range), then remove or move them.')}</span>
        </div>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 px-7 pb-28 pt-2">
        {faces?.map((f) => {
          const on = selected.has(f.id)
          return (
            <button
              key={f.id}
              onClick={(e) => toggle(f.id, e.shiftKey)}
              className={`relative aspect-square overflow-hidden rounded-xl bg-stone-200 transition dark:bg-stone-800 ${on ? 'ring-[3px] ring-accent-500' : 'hover:opacity-90'}`}
            >
              <img src={faceUrl(f.id)} alt="" loading="lazy" className={`size-full object-cover transition ${on ? 'scale-90 rounded-lg' : ''}`} />
              {on && (
                <span className="absolute left-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent-500 text-on-accent">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              )}
            </button>
          )
        })}
      </div>
      {ids.length > 0 && (
        <div className="no-drag fixed bottom-6 left-[calc(50%+114px)] z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-stone-900/95 py-1.5 pl-2 pr-1.5 shadow-2xl animate-rise-in dark:bg-stone-800/95">
          <button onClick={() => setSelected(new Set())} className="grid size-8 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white" aria-label={t('Clear selection')}>
            <X className="size-4" />
          </button>
          <span className="px-2 text-[13px] font-semibold text-white">{plural(ids.length, 'face')}</span>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <button
            onClick={async () => {
              await api.moveFaces(ids, null)
              setSelected(new Set())
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/90 hover:bg-white/15"
          >
            <UserX className="size-4" />{' '}{t('Not')}{' '}{name}
          </button>
          <button onClick={() => setMoving(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/90 hover:bg-white/15">
            <ArrowRightLeft className="size-4" />{' '}{t('Move to…')}</button>
        </div>
      )}
      {moving && (
        <MergePicker
          exclude={props.person.id}
          title={t('Move faces to…')}
          subtitle={t('Pick who they are, or start a new person.')}
          allowNew
          onClose={() => setMoving(false)}
          onNew={() => {
            setMoving(false)
            setNaming(true)
          }}
          onPick={async (p) => {
            setMoving(false)
            await api.moveFaces(ids, { personId: p.id })
            setSelected(new Set())
          }}
        />
      )}
      {naming && (
        <PromptDialog
          title={t('New person')}
          label={t('Name (optional)')}
          placeholder={t('Name')}
          confirm={t('Create')}
          onClose={() => setNaming(false)}
          onSubmit={async (value) => {
            setNaming(false)
            await api.moveFaces(ids, { newName: value || null })
            setSelected(new Set())
          }}
        />
      )}
    </div>
  )
}

function MergePicker(props: {
  exclude: number
  onPick: (p: Person) => void
  onClose: () => void
  title?: string
  subtitle?: string
  allowNew?: boolean
  onNew?: () => void
}) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    void api.people().then(setPeople)
  }, [])
  const shown = useMemo(
    () => (people ?? []).filter((p) => p.id !== props.exclude && (!filter || (p.name ?? '').toLowerCase().includes(filter.toLowerCase()))),
    [people, filter, props.exclude]
  )
  return (
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 backdrop-blur-sm animate-fade-in" onClick={props.onClose}>
      <ModalPanel className="flex max-h-[75vh] w-[560px] flex-col rounded-2xl bg-white shadow-2xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()} aria-label={props.title ?? t('Merge with…')}>
        <div className="flex items-center gap-3 border-b border-stone-100 px-5 py-4 dark:border-stone-800">
          <div className="flex-1">
            <div className="text-[15px] font-semibold">{props.title ?? t('Merge with…')}</div>
            <div className="text-xs text-stone-500 dark:text-stone-400">{props.subtitle ?? t('Pick the same person. Their photos become one person.')}</div>
          </div>
          <button onClick={props.onClose} className="grid size-8 place-items-center rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800" aria-label={t('Close')}>
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 pt-3">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('Filter by name')}
            className="h-9 w-full rounded-lg bg-stone-100 px-3 text-[13px] outline-none ring-accent-500 focus:ring-2 dark:bg-stone-800"
          />
        </div>
        <div className="scroll-thin grid grid-cols-4 gap-4 overflow-y-auto p-5">
          {props.allowNew && (
            <button onClick={props.onNew} className="group flex flex-col items-center gap-1.5 text-center">
              <div className="grid size-[84px] place-items-center rounded-full border-2 border-dashed border-stone-300 text-stone-400 transition group-hover:border-accent-500 group-hover:text-accent-500 dark:border-stone-700">
                <UserPlus className="size-7" />
              </div>
              <div className="w-full truncate text-[12.5px] font-medium">{t('New person')}</div>
            </button>
          )}
          {shown.map((p) => (
            <button key={p.id} onClick={() => props.onPick(p)} className="group flex flex-col items-center gap-1.5 text-center">
              <div className="rounded-full ring-accent-500 transition group-hover:ring-2">
                <Face person={p} size={84} />
              </div>
              <div className="w-full truncate text-[12.5px] font-medium">{p.name ?? <span className="text-stone-400">{t('Unnamed')}</span>}</div>
              <div className="-mt-1 text-[11px] text-stone-500">{plural(p.photos, 'photo')}</div>
            </button>
          ))}
          {people && shown.length === 0 && <div className="col-span-4 py-6 text-center text-[13px] text-stone-500">{t('Nobody else matches.')}</div>}
        </div>
      </ModalPanel>
    </div>
  )
}

