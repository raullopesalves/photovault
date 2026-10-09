// Runs electron-vite with ELECTRON_RUN_AS_NODE removed. VS Code (and other Electron-based
// editors) export ELECTRON_RUN_AS_NODE=1 to their terminals, which makes Electron start as
// plain Node and the app crash on launch.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
