// What a release page says: the version's section of CHANGELOG.md ("## 0.15.1 (2026-10-23)" up to the next "## ").
// Used by scripts/release.mjs, and by tests/changelog.test.ts so CI fails when the version has no notes yet.

/** The notes for `version`, or null when CHANGELOG.md has no section for it. */
export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`).test(l))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
  return body || null
}

/** Every version with a section, newest first as written. */
export function changelogVersions(changelog) {
  return [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1])
}
