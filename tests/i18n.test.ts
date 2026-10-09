import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PT } from '../src/renderer/src/lib/i18n-pt'

// Names that read the same in Portuguese.
const SAME = new Set(['Facebook', 'Instagram', 'Messenger', 'MP', 'photovault', 'SHA-256', 'Signal', 'Snapchat', 'Telegram', 'TikTok', 'WhatsApp', 'X / Twitter'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(f) && !f.startsWith('i18n') ? [p] : []
  })
}

/** Every t('…') key and plural() noun in the renderer. */
function interfaceKeys(): Set<string> {
  const keys = new Set<string>()
  for (const file of sourceFiles(join(__dirname, '../src/renderer/src'))) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const lit = (n: ts.Node | undefined): string | null => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null)
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const [a0, a1, a2] = n.arguments
        if (n.expression.text === 't' && lit(a0) !== null) keys.add(lit(a0) as string)
        if (n.expression.text === 'plural' && lit(a1)) {
          keys.add(lit(a1) as string)
          keys.add(lit(a2) ?? `${lit(a1)}s`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return keys
}

describe('Portuguese interface', () => {
  const keys = interfaceKeys()

  it('translates every interface text', () => {
    expect([...keys].filter((k) => !(k in PT) && !SAME.has(k))).toEqual([])
  })

  it('keeps the same {placeholders} in each translation', () => {
    const names = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    expect(Object.entries(PT).filter(([en, pt]) => names(en) !== names(pt))).toEqual([])
  })

  it('has no translations for text that no longer exists', () => {
    expect(Object.keys(PT).filter((k) => !keys.has(k))).toEqual([])
  })
})
