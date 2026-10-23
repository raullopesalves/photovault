import type { ReactNode } from 'react'

/** A block of the small Markdown subset the guide and the changelog use: headings, paragraphs and lists. */
export type MdBlock =
  | { type: 'h'; level: number; text: string; id: string }
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Blocks are separated by blank lines; a list is consecutive "- " or "1. " lines. */
export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = []
  for (const chunk of md.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    const h = /^(#{1,4})\s+(.*)$/.exec(lines[0] as string)
    if (h) {
      const text = (h[2] as string).trim()
      blocks.push({ type: 'h', level: (h[1] as string).length, text, id: slug(text) })
      if (lines.length > 1) blocks.push(...parseMarkdown(lines.slice(1).join('\n')))
    } else if (lines.every((l) => /^\s*(-|\d+\.)\s/.test(l))) {
      blocks.push({ type: /^\s*-/.test(lines[0] as string) ? 'ul' : 'ol', items: lines.map((l) => l.replace(/^\s*(-|\d+\.)\s+/, '')) })
    } else {
      blocks.push({ type: 'p', text: lines.join(' ') })
    }
  }
  return blocks
}

/** **bold** and `code`; everything else is plain text. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-[650] text-ink">{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-line/60 px-1 font-mono text-[0.92em]">{part.slice(1, -1)}</code>
    ) : (
      part
    )
  )
}

export function Markdown(props: { blocks: MdBlock[] }) {
  return (
    <div className="max-w-[680px] text-[14px] leading-[22px] text-ink">
      {props.blocks.map((b, i) => {
        if (b.type === 'h') {
          const cls =
            b.level <= 2
              ? 'mb-2 mt-10 scroll-mt-28 font-[family-name:var(--font-display)] text-[21px] font-[650] leading-7 tracking-[-0.01em] first:mt-0'
              : 'mb-1.5 mt-6 scroll-mt-28 text-[15px] font-[650] leading-6'
          return b.level <= 2 ? <h2 key={i} id={b.id} className={cls}>{inline(b.text)}</h2> : <h3 key={i} id={b.id} className={cls}>{inline(b.text)}</h3>
        }
        if (b.type === 'p') return <p key={i} className="mb-3 text-ink-muted">{inline(b.text)}</p>
        const List = b.type === 'ul' ? 'ul' : 'ol'
        return (
          <List key={i} className={`mb-3 space-y-1.5 pl-5 text-ink-muted ${b.type === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-ink-muted`}>
            {b.items.map((item, j) => <li key={j} className="pl-1">{inline(item)}</li>)}
          </List>
        )
      })}
    </div>
  )
}
