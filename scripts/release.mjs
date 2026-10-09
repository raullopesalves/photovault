// Publishes a release to the private GitHub repository so installed copies update themselves:
//   1. bump "version" in package.json and commit;  2. node scripts/release.mjs
// Uses the GitHub CLI's login for the upload token (gh auth token).
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const gh = process.platform === 'win32' ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe') : 'gh'
const token = execFileSync(gh, ['auth', 'token'], { encoding: 'utf8' }).trim()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const env = { ...process.env, GH_TOKEN: token }
delete env.ELECTRON_RUN_AS_NODE
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
console.log(`Releasing ${version}…`)
// GitHub only publishes a release for an existing tag: tag the current commit (once) and push it.
const tag = `v${version}`
if (!execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim()) execFileSync('git', ['tag', tag])
execFileSync('git', ['push', 'origin', tag], { stdio: 'inherit' })
run('node', ['scripts/electron-vite.mjs', 'build'])
// The local electron-builder, not npx (which needs a working global npm).
run('node', [join('node_modules', 'electron-builder', 'cli.js'), '--win', 'nsis', '--publish', 'always'])
// electron-builder has reported success with an upload missing: check, and upload what is not there.
const wanted = [`PhotoVault-Setup-${version}.exe`, `PhotoVault-Setup-${version}.exe.blockmap`, 'latest.yml']
const have = execFileSync(gh, ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'], { encoding: 'utf8' }).split(/\r?\n/)
const missing = wanted.filter((f) => !have.includes(f))
if (missing.length) {
  console.log(`Uploading ${missing.join(', ')}…`)
  execFileSync(gh, ['release', 'upload', tag, ...missing.map((f) => join('dist', f)), '--clobber'], { stdio: 'inherit' })
}
console.log(`Published v${version}. Installed copies pick it up within 6 hours (or Settings → Updates → Check now).`)
