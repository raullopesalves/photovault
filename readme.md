# Photo Vault

A local-first desktop photo archive. Photo Vault imports folders, ZIP archives and Google Takeout exports into a library folder you control, recognises exact duplicates by SHA-256 whatever their file name, remembers every place each photo came from, and lets you browse everything on a fast chronological timeline.

- Product spec / context: [PHOTO_VAULT_HANDOFF.md](PHOTO_VAULT_HANDOFF.md)
- Technical decisions: [DECISIONS.md](DECISIONS.md)

## Requirements

- Node.js 24+
- Windows, macOS or Linux (developed and tested on Windows 11)

## Commands

```bash
npm install
npm run dev        # run the app with hot reload
npm run build      # production bundles into out/
npm start          # run the built app
npm test           # unit/integration tests for the archive core (Vitest)
npm run typecheck  # strict TypeScript for main/preload/core/tests and renderer
npm run test:e2e   # build, then drive the real app end-to-end with Playwright
npm run dist       # Windows installer + portable exe in dist/
npm run test:e2e:packaged  # package, then run the end-to-end test against the packaged exe
npm run test:perf  # opt-in: build a 100k-item synthetic catalogue and time every UI query
```

## Installing

`npm run dist` produces:

- `dist/PhotoVault-Setup-<version>.exe`: per-user installer (no admin rights needed), with Start-menu and desktop shortcuts. Installed copies update themselves.
- `dist/PhotoVault-<version>-Portable.exe`: runs without installing (no automatic updates).

To publish an update: bump `version` in package.json, commit, then `npm run release` (uploads to the private
repository's Releases with the GitHub CLI login). The app needs a read-only token in Settings → Updates to see them.

The builds are not code-signed yet, so Windows SmartScreen shows "Windows protected your PC" on first launch; choose **More info → Run anyway**. Uninstalling never touches your photo library folder.

## Layout

```text
src/
  core/          archive engine – no Electron imports, fully unit-tested
    db/          node:sqlite wrapper + migrations
    media/       format sniffing, SHA-256, EXIF/XMP/QuickTime metadata, filename dates
    library/     library folder layout, safe copy/verify/never-overwrite ingest, library verification
    import/      scan → sidecars → analyse → classify → commit pipeline, ImportService (resume)
    sources/     read-only ZIP access
    takeout/     Google Takeout sidecar parsing and matching
    thumbnails/  thumbnail rendering + background queue
    repo/        read queries for the UI (timeline, pages, detail, duplicates, similar, map, FTS search)
    dating/      inferred and manual dates
    ai/          on-device CLIP embeddings (smart search)
  main/          Electron main: window, IPC handlers, pv-media:// protocol, settings,
                 worker thread (worker.ts) for whole-library computations and AI
  preload/       contextBridge API (the renderer's only access to the system)
  renderer/      React UI (Tailwind)
  shared/        types shared across the IPC boundary
tests/           Vitest suites for the core
scripts/         e2e smoke test, electron-vite launcher
```

## A library on disk

```text
<Library>/
  photovault-library.json   marker (format + id)
  README.txt
  originals/YYYY/MM/…       your photos as ordinary files
  originals/undated/…       no capture date found
  thumbnails/               regenerable cache
  database/photovault.db    SQLite catalogue
  database/backups/         automatic catalogue snapshots
  temp/                     in-flight copies (never published until verified)
  logs/                     JSON-lines logs

Video thumbnails and playable copies of HEVC/old videos use a bundled ffmpeg (a separate GPL program from
`ffmpeg-static`, run as a process). The smart-search model (~150 MB) and the face models (~39 MB), downloaded only if you turn those features on, live in the app's data folder
(`%APPDATA%/Photo Vault/models`), not in the library.
```

Place names (map, trips, search) come from [GeoNames](https://www.geonames.org) "cities5000" (CC BY 4.0), bundled
in `src/core/geo/places.json` and rebuilt with `node scripts/make-places.mjs`.
