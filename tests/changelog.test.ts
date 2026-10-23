import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JavaScript module shared with scripts/release.mjs
import { changelogVersions, releaseNotes } from '../scripts/release-notes.mjs'

const root = join(__dirname, '..')
const read = (f: string): string => readFileSync(join(root, f), 'utf8')
const changelog = read('CHANGELOG.md')

describe('release notes', () => {
  it('has notes for the version in package.json, so the release script can publish it', () => {
    const { version } = JSON.parse(read('package.json')) as { version: string }
    expect(releaseNotes(changelog, version)).toMatch(/\S/)
  })

  it('takes one version’s section, not the next one', () => {
    const md = '# What\'s new\n\nIntro.\n\n## 1.0.1 (2026-11-01)\n\n- Fixed a thing.\n\n## 1.0.0 (2026-10-30)\n\n- First.\n'
    expect(releaseNotes(md, '1.0.1')).toBe('- Fixed a thing.')
    expect(releaseNotes(md, '1.0.0')).toBe('- First.')
    expect(releaseNotes(md, '1.0')).toBeNull()
    expect(changelogVersions(md)).toEqual(['1.0.1', '1.0.0'])
  })

  it('lists versions newest first, each once', () => {
    const versions = changelogVersions(changelog) as string[]
    const key = (v: string): number => v.split('.').reduce((n, p) => n * 1000 + Number(p), 0)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => key(b) - key(a))).toEqual(versions)
  })
})

describe('user guide', () => {
  const headings = (md: string): string[] => md.split(/\r?\n/).filter((l) => /^#{1,3} /.test(l)).map((l) => l.replace(/ .*/, ''))

  it('has the same sections in English and Portuguese', () => {
    expect(headings(read('docs/USER_GUIDE.pt.md'))).toEqual(headings(read('docs/USER_GUIDE.md')))
  })

  it('covers what the 1.0 plan asks for', () => {
    const guide = read('docs/USER_GUIDE.md')
    for (const topic of ['## Importing', '### Setting up a backup drive', 'Probably received or saved', '## Hiding, the Bin and deleting', '## Moving to a new computer', 'Smart search', 'Automatic descriptions'])
      expect(guide).toContain(topic)
  })
})
