// Publishes a release to the private GitHub repository so installed copies update themselves:
//   1. bump "version" in package.json, add its section to CHANGELOG.md and commit;  2. node scripts/release.mjs
// The release page shows that CHANGELOG.md section. `node scripts/release.mjs --notes-only [version…]` rewrites the
// notes of releases that already exist (every version in CHANGELOG.md when none is given) without building anything.
// Builds the installer, then creates the release and uploads it with the GitHub CLI (already logged in).
// electron-builder's own publishing uploads files in parallel and each tries to create the release, so one
// fails ("already_exists") and leaves the release without its installer or latest.yml.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { changelogVersions, releaseNotes } from './release-notes.mjs'

const gh = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe') : 'gh'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
/** Writes a version's notes to a file for `gh --notes-file` (passing them inline breaks on Windows quoting). */
const notesFile = (v) => {
  const notes = releaseNotes(changelog, v)
  if (!notes) throw new Error(`CHANGELOG.md has no "## ${v}" section: write what changed first.`)
  mkdirSync('dist', { recursive: true })
  const file = join('dist', `release-notes-${v}.md`)
  writeFileSync(file, `${notes}\n`)
  return file
}

if (process.argv.includes('--notes-only')) {
  const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  for (const v of asked.length ? asked : changelogVersions(changelog)) {
    if (spawnSync(gh, ['release', 'view', `v${v}`], { stdio: 'ignore' }).status !== 0) {
      console.log(`v${v}: no release, skipped`)
      continue
    }
    run(gh, ['release', 'edit', `v${v}`, '--title', `Photo Vault ${v}`, '--notes-file', notesFile(v)])
    console.log(`v${v}: notes updated`)
  }
  process.exit(0)
}
const notes = notesFile(version) // before the slow build, so a missing section fails fast

console.log(`Releasing ${version}…`)
run('node', ['scripts/electron-vite.mjs', 'build'])
// The local electron-builder, not npx (which needs a working global npm).
run('node', [join('node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--publish', 'never'])

const files = [`PhotoVault-Setup-${version}.exe`, `PhotoVault-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join('dist', f))
for (const f of files) if (!existsSync(f)) throw new Error(`${f} was not built`)
// The installed app must be able to update itself: check the packaged build's updater before publishing.
run('node', ['scripts/check-packaged-updater.mjs'])

// GitHub only publishes a release for an existing tag: tag the current commit (once) and push it.
if (!execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim()) execFileSync('git', ['tag', tag])
execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })

const exists = spawnSync(gh, ['release', 'view', tag], { stdio: 'ignore' }).status === 0
if (exists) {
  run(gh, ['release', 'upload', tag, ...files, '--clobber'])
  run(gh, ['release', 'edit', tag, '--notes-file', notes])
} else run(gh, ['release', 'create', tag, ...files, '--title', `Photo Vault ${version}`, '--notes-file', notes])

const have = execFileSync(gh, ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' }).split(/\r?\n/)
const missing = files.map((f) => f.split(/[\\/]/).pop()).filter((f) => !have.includes(f))
if (missing.length) throw new Error(`Missing from the release: ${missing.join(', ')}`)
console.log(`Published ${tag}. Installed copies pick it up within 6 hours (or Settings → Updates → Check now).`)
