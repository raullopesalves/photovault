// Publishes a release to the private GitHub repository so installed copies update themselves:
//   1. bump "version" in package.json and commit;  2. node scripts/release.mjs
// Builds the installer, then creates the release and uploads it with the GitHub CLI (already logged in).
// electron-builder's own publishing uploads files in parallel and each tries to create the release, so one
// fails ("already_exists") and leaves the release without its installer or latest.yml.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const gh = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe') : 'gh'
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log(`Releasing ${version}…`)
run('node', ['scripts/electron-vite.mjs', 'build'])
// The local electron-builder, not npx (which needs a working global npm).
run('node', [join('node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--publish', 'never'])

const files = [`PhotoVault-Setup-${version}.exe`, `PhotoVault-Setup-${version}.exe.blockmap`, 'latest.yml'].map((f) => join('dist', f))
for (const f of files) if (!existsSync(f)) throw new Error(`${f} was not built`)

// GitHub only publishes a release for an existing tag: tag the current commit (once) and push it.
if (!execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim()) execFileSync('git', ['tag', tag])
execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })

const exists = spawnSync(gh, ['release', 'view', tag], { stdio: 'ignore' }).status === 0
if (exists) run(gh, ['release', 'upload', tag, ...files, '--clobber'])
else run(gh, ['release', 'create', tag, ...files, '--title', `Photo Vault ${version}`, '--notes', `Photo Vault ${version}`])

const have = execFileSync(gh, ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' }).split(/\r?\n/)
const missing = files.map((f) => f.split(/[\\/]/).pop()).filter((f) => !have.includes(f))
if (missing.length) throw new Error(`Missing from the release: ${missing.join(', ')}`)
console.log(`Published ${tag}. Installed copies pick it up within 6 hours (or Settings → Updates → Check now).`)
