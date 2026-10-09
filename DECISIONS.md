# Photo Vault – Technical Decisions

Short log of significant decisions and why. Newest at the bottom of each section.

## Platform

**D1. Electron + React + TypeScript + Vite (electron-vite) + Tailwind 4.**
The handoff allowed Electron or Tauri. Electron keeps the whole stack in TypeScript (one language for core, UI and tests), has mature image tooling (sharp, exifr) and an OS thumbnailer (`nativeImage.createThumbnailFromPath`) that handles HEIC/RAW/video on Windows and macOS. The archive core (`src/core`) has no Electron imports, so a later move to Tauri or a CLI is still possible.

**D2. SQLite via the built-in `node:sqlite`, not better-sqlite3.**
Electron 44 ships Node 24.21 with SQLite 3.53. Using the built-in module means there is no native module to rebuild per Electron ABI, and the unit tests (system Node 24) run the same engine as the app. A thin wrapper (`src/core/db/database.ts`) adds a statement cache and transactions. If `node:sqlite` ever lacks something, the wrapper is the only place that has to change.

**D3. Thumbnails: sharp (libvips) → embedded EXIF thumbnail → OS thumbnailer.**
Prebuilt sharp cannot decode HEIC (HEVC is patent-encumbered). For HEIC/RAW/video we fall back to the JPEG preview embedded in the file, then to the Windows shell / QuickLook thumbnailer. sharp's file cache is disabled, because on Windows it kept handles open on originals.

## Security boundary

**D4. Renderer is sandboxed:** `contextIsolation`, `sandbox`, no `nodeIntegration`, a strict CSP, and navigation and new windows blocked. The preload exposes a typed `PhotoVaultApi`, and every IPC argument is validated in main.

**D5. Media is served via a custom `pv-media://` protocol keyed by asset id** (`thumb/<id>`, `preview/<id>`, `original/<id>`). The renderer can never ask for an arbitrary path. The protocol supports HTTP Range for video seeking.

## Archive model

**D6. Identity = SHA-256 of the file bytes** (`assets.sha256 UNIQUE`). Filenames and paths are never identity.

**D7. Four separate concepts, five tables:**
- `assets`: the logical item (one per SHA-256).
- `files`: physical copies in a `storage_location`. The managed library stores paths *relative* to the library root, so the folder can move or change drive letter.
- `provenance`: every place the bytes were observed, unique on `(asset_id, source_path)`, with `first/last_import_id` and `times_seen`. Re-importing the same folder updates the existing row instead of piling up duplicates.
- `imports` + `import_items`: the operation log. Each media file seen by each import is recorded with its classification (`new`, `duplicate_library`, `duplicate_batch`, `unsupported`, `error`) and its outcome (`imported`, `linked`, `skipped`, `failed`). This is what makes duplicate reporting explainable.

**D8. Time is four different things.** `capture_time` comes only from metadata or the filename. It is stored as a wall-clock string plus an optional offset, because EXIF usually has no zone. Filesystem created/modified times live on `provenance`/`import_items`. Import time is `assets.created_at`. Timeline order uses `sort_time` (capture time, else the file's modified time) with `sort_time_source` recorded, and the UI says so whenever a date is only estimated. `sort_time` is wall-clock ms encoded as UTC, so a photo's day never shifts with the viewer's time zone.

**D9. Capture-time precedence:** EXIF DateTimeOriginal (+OffsetTimeOriginal, SubSec) → EXIF CreateDate → XMP DateCreated → QuickTime `mvhd` creation time (UTC, shown in local zone) → filename pattern → EXIF ModifyDate. Filesystem times are never treated as capture time.

**D10. Content decides the type.** Candidates are found by extension, then confirmed by magic bytes. A `.jpg` that is really text is reported as "not recognised" and never imported.

## Import pipeline

**D11. Explicit stages:** scan → analyse (stat, sniff, SHA-256, metadata; items persisted in batches of 200) → classify (pure SQL, deterministic: first by relative path is `new`) → **user review** → commit → thumbnails (background). Nothing touches the library before the user confirms.

**D12. Copy, never move. Never overwrite.** Each new file is:
1. copied with `COPYFILE_EXCL` to `library/temp/*.part`;
2. re-hashed and compared with the analysed hash (catches sources that changed after analysis);
3. given the source's mtime;
4. published with `link()`, which fails atomically if the name exists (falls back to exists-check + rename on filesystems without hard links, e.g. exFAT);
5. on a name collision with different bytes, renamed with a deterministic hash suffix: `IMG_4821.jpg` → `IMG_4821_a73f81c2.jpg`.

An untracked byte-identical file already at the destination (e.g. after a crash) is adopted rather than duplicated. Sources are only ever read.

**D13. Managed layout:** `originals/YYYY/MM/<original name>` when the capture time is known, otherwise `originals/undated/`. Folder names use capture time only, never filesystem time.

**D14. Commit is resumable by construction.** Items with an outcome are skipped, and assets are inserted per chunk of 32 inside a transaction. On startup, imports left in `scanning`/`ready`/`importing` become `interrupted`, and stale `temp/*.part` files are cleared. (There is no "resume" button yet.)

**D15. The import runs in the Electron main process** with async I/O and bounded concurrency (4 for analysis, 3 for copying). The renderer stays responsive because it is a separate process. If main-process CPU becomes a problem at scale, `src/core` can move to a `utilityProcess` unchanged.

## UI

**D16. The timeline is grouped by month** (Apple Photos style) rather than by day. Day headers made sparse libraries look like a list. The grid is virtualised (`@tanstack/react-virtual`); assets are fetched in pages of 240 by offset and aligned with month counts from one `GROUP BY` query, so neither the renderer nor IPC ever holds the whole library.

**D17. Square, cropped grid tiles** instead of a justified layout. They are robust with paging and need no dimensions up front. A justified layout can come later.

## Tooling

**D18. `scripts/electron-vite.mjs` strips `ELECTRON_RUN_AS_NODE`** before running electron-vite. VS Code exports that variable to its terminals, and it makes the app crash on launch.

## Milestone 3 – archives, Takeout, resumability, verification

**D19. ZIP archives are read in place with yauzl, never extracted.** Entries are streamed: hashed during analysis, and at commit streamed into `library/temp/*.part`, then verified and published like any file. Nothing is ever written at an entry's own path, so names like `../evil.jpg` cannot cause path traversal. Names are still decoded and validated per entry (`decodeStrings: false` + yauzl's validator), so one unsafe or encrypted entry is reported as an error instead of aborting the archive. An unreadable ZIP becomes one error item and the rest of the import continues. ZIPs inside ZIPs are not opened. Provenance paths look like `…\takeout-001.zip!/Takeout/Google Photos/…/IMG_1.jpg`, with `container_path` recorded separately.

**D20. Metadata for archive entries comes from the same single read that hashes them.** Entries up to 48 MB are buffered whole, so EXIF/XMP extraction sees the complete file. Larger entries keep their first 4 MB, and a streaming `MoovCollector` captures the video's `moov` box wherever it sits in the file.

**D21. An import can have several sources** (`imports.sources_json`): folders and/or ZIP files, including ZIPs found while walking a folder. Takeout downloads arrive as `takeout-001.zip … takeout-NNN.zip`.

**D22. Sidecars are matched per folder path *inside* the export, across all sources.** Takeout routinely puts a photo in volume 2 and its JSON in volume 1. The matcher (`src/core/takeout/match.ts`) handles `.json`, `.supplemental-metadata.json` and any truncation of it, ~51-character name truncation, `(n)` duplicate numbering, `-edited` copies (several locales), sidecars without the media extension, live-photo videos sharing the photo's sidecar, and finally the JSON `title`. It never guesses beyond those rules. Album titles come from each folder's `metadata.json`; year folders have none.

**D23. Metadata precedence when a sidecar exists** (`src/core/media/resolve.ts`):
- capture time: camera EXIF/XMP → Takeout `photoTakenTime` → QuickTime / filename / EXIF ModifyDate;
- location: embedded GPS → Takeout `geoData` (which includes locations added in Google Photos);
- description and favourite come from the sidecar.

The camera's EXIF time wins because it is the original wall-clock record; Takeout's timestamp is a UTC value Google derived. Takeout wins over the weaker hints, which is what matters for screenshots, videos and files whose EXIF was stripped. The sidecar JSON is kept verbatim on `import_items` and `provenance`. File-intrinsic metadata and sidecar data are stored separately and only combined when an asset is created.

**D24. Re-hash shortcut.** Each item records a `source_fingerprint`:
- plain files: `f:size:mtimeMs`;
- ZIP entries: `z:size:crc32:zipSize:zipMtimeMs`.

If the same `source_path` was seen before with the same fingerprint, its SHA-256 and metadata are reused without reading the file. The risk: a file rewritten with identical size and mtime would be misattributed. Mitigations: new files are still re-hashed after copying (D12), so a wrong hash can never put wrong bytes in the library, and library verification (D26) checks the archive itself.

**D25. Resume.** An import interrupted after analysis (app closed while `ready`/`importing`) is marked `interrupted` and can be resumed from Imports. Commit skips items that already have an outcome and re-checks every hash against the library. A file copied just before a crash, but not yet recorded, is adopted rather than duplicated (D12). An import interrupted during scanning/analysis is simply started again; thanks to D24 that is fast. App shutdown aborts work without marking it cancelled.

**D26. Library verification** (`src/core/library/verify.ts`) re-hashes every managed original against its recorded SHA-256 and updates `files.verify_status`, `verified_at` and `missing_since`; each run is logged in `verifications`. It never modifies, repairs or deletes files. If a later import brings the identical bytes of an original marked *missing*, they are copied back to its original path (verified, no overwrite). *Damaged* originals are left untouched for a human decision.

## Milestone 4 – packaging, albums, search

**D27. Distribution with electron-builder** (`electron-builder.yml`, `npm run dist`):
- **Windows targets:** an NSIS installer (per-user: no admin rights, choosable folder, Start-menu and desktop shortcuts) and a portable `.exe`.
- **sharp:** its native libvips binaries are unpacked from the asar archive so they can load.
- **Icon:** `build/icon.ico` is generated by `scripts/make-icon.mjs`, because electron-builder's WebAssembly icon converter fails in some environments.
- **Uninstall** never touches photo libraries (`deleteAppDataOnUninstall: false`).
- **Testing:** the packaged executable is covered by the same end-to-end test (`npm run test:e2e:packaged`).
- **Not done yet:** the builds are **not code-signed**, so Windows SmartScreen warns on first run. Signing needs a paid certificate, which is the user's call. There is no auto-update yet.

**D28. Albums reference assets; they never own files.** `albums` + `album_assets`. Deleting an album or removing a photo from it only changes rows.
- Google Takeout albums are recreated from album folders and keyed by `(kind='takeout', source_key=title)`, so re-imports never duplicate them.
- Takeout memberships are added only for items seen *in that import*, so unrelated imports never undo a user's removals.
- Migration 3 backfills albums from provenance recorded by earlier Takeout imports.

**D29. One filter model for every grid.** `AssetQuery` (text, type, favourite, year, camera, source, album) compiles to a single WHERE clause, used both for month groups and for paging so counts and offsets always agree.
- Text search is a tokenised, LIKE-escaped scan over filename, camera, description, date, provenance filenames/paths and album names. That is fine into the 100k range; SQLite FTS5 is the upgrade path.
- Photos, Favourites, album and Cleanup pages all reuse the same virtualised `AssetGrid`, with multi-select (click a tile's check circle, shift-click for ranges, Esc to clear) and a floating action bar: favourite, add to album or new album, remove from album, use as cover.

## Milestone 4b – time estimates and clutter labelling

**D30. Time estimates come from recent throughput, not the overall average** (`src/core/eta.ts`). A 20-second sliding window with smoothing reacts quickly when speed changes (hash-reused files are instant; large videos are slow) without jittering. No estimate is shown during the first 3 seconds or when the total is unknown (scanning shows elapsed time instead). Analysis estimates by files; copying estimates by bytes, because the size of the new files is known after analysis; verification estimates by bytes too.

**D31. Origin and kind labels are deterministic, local and explainable** (`src/core/media/classify.ts`). Evidence, from strongest to weakest:
1. Google Photos' record of the phone folder a file was backed up from (`googlePhotosOrigin…localFolderName` in Takeout JSON, which is already stored verbatim, so existing libraries need no re-import);
2. the folder a file was found in (`WhatsApp Images`, `Screenshots`, `DCIM/Camera`, …);
3. app naming patterns (`IMG-YYYYMMDD-WA0001`, `Screenshot_…`, `FB_IMG_…`, `PXL_…`, …);
4. app markers inside the file (video udta comment/encoder tags, EXIF Software);
5. camera make/model, or a camera-only filename pattern.

`IMG_1234` is deliberately *not* treated as a camera name, because iCloud exports rename WhatsApp images to it. **Kind** distinguishes `loop` (a video with no sound track and at most 30 s, which is how WhatsApp and Telegram store GIFs), `animated` (multi-frame GIF/WebP), `sticker` (WebP stickers) and plain photo/video. To support this, the video reader now detects track handlers and udta tags, and images record their frame count. A background `ClassifyQueue` labels new imports and re-labels the library whenever the rules change (`CLASSIFY_VERSION`) or an import adds new provenance to an asset. It reads managed originals only when a fact is missing.

**D32. "Hide from Photos" is an archive flag, never a delete.** `assets.hidden` removes an item from the Photos timeline only. It stays in albums, search, Favourites and Cleanup, and can be shown again individually or in bulk ("Hide all WhatsApp" applies to whatever matches the filter at that moment). Deleting clutter from disk is intentionally not offered yet; if it ever is, it must go through a recoverable trash with confirmation (handoff §6).

**D33. "Probably received or saved" is an explicit, lower-confidence origin** (`origin = 'received'`, `origin_confidence = 'probable'`). It is used only when no direct evidence exists and the item carries no capture metadata at all:
- photos: no camera, date taken or editing software (a lone ModifyDate doesn't count);
- videos: no container recording date and no camera tags.

Phone cameras always write these; chat apps, "save image" and re-encoders strip them. A size clue sub-groups the result:
- **whatsapp_size:** 1600 px photos, or 848×480 / 640×352 videos, which are WhatsApp's re-encode sizes;
- **social_size:** 2048 px photos (Facebook, Messenger, X).

The UI always shows these as *probable*, with their evidence, and Cleanup asks you to review before hiding. Measured on a real library (22,125 items from Google Photos web downloads, which carry neither Takeout JSON nor WhatsApp file names), this left 294 items unlabelled, versus 16,000+ without it. Also added: iPhone screenshots (`IMG_####.PNG`, which the camera never produces).

## Probable duplicates

**D34. Probable duplicates use visual fingerprints of the cached thumbnail, never the original** (`src/core/media/phash.ts`, `src/core/repo/nearDuplicates.ts`).
- **What is stored per item** (`asset_hashes`): a 64-bit dHash (gradients), a 64-bit DCT pHash and a 2×2 quadrant colour signature, all from a single 32×32 decode. Computing them is a background job, about 10 ms per item, and blank or flat images are flagged and never matched.
- **What counts as a match:** pHash ≤ 5, dHash ≤ 6, quadrant colours within 40/255, the same aspect ratio within 3% and, for videos, the same length within 1 s. Calibrated on recompressed, resized, PNG, brightened and 3%-cropped copies (≤ 4 / ≤ 3), against burst shots (6–8), 10% crops (10) and other scenes (≥ 18). The colour check exists because the fingerprints are greyscale: two pictures with the same layout in different colours would otherwise match.
- **Bursts are not duplicates:** two camera originals with different EXIF capture times are separate shots, however alike they look; they belong in the future "Similar photos" tier. On a real library, this rule moved 147 groups out of the duplicate list.
- **Groups form around the best copy** (camera data → resolution → file size → date taken), so chains A≈B≈C where A≉C cannot happen.
- **Finding candidates:** a 6-band pHash index with pigeonhole guarantees that no pair within the threshold is missed. Grouping took 0.4 s for 22k items, and the result is cached until fingerprints or dismissals change.
- **Actions:**
  - "Keep selected, hide the others", or "Keep the best of each" across all groups. Both only hide (D32).
  - "Not duplicates" records dismissed pairs (`near_duplicate_dismissals`), which are never suggested again.
- **Measured on a real library** (22k items): 664 groups and 811 extra copies, 3.5 minutes of one-time background fingerprinting.

## Viewer and filters

**D35. Overlays must be `no-drag`.** On Windows, Electron drag regions (`-webkit-app-region: drag`, used for the sidebar and headers so the frameless window can be moved) capture mouse input at the OS level, even under elements drawn on top. Every full-screen overlay (viewer, import sheet, dialogs, previews) therefore sets `no-drag`. The viewer's left arrow sat over the sidebar and silently ignored clicks until this was fixed. Automated tests can't catch this class of bug, because Playwright's CDP input bypasses OS hit-testing.

**D36. Viewer zoom.** The viewer uses a CSS transform on the fitted image (scale 1 = fit, up to 10×):
- **Input:** mouse wheel or trackpad pinch (ctrl+wheel) zooms towards the cursor; double-click toggles between fit and actual pixels (at least 2×); drag pans; `+` / `-` / `0` keys; Escape first resets zoom, then closes.
- **Behaviour:** panning is clamped to the image edges, and moving to another photo resets to fit.

**D37. Filter bar: multi-select.** Each filter (type, year, camera, origin, source) is a checkbox menu. Values within one filter combine with OR, and different filters combine with AND (`AssetQuery.types / years / cameras / origins / sourceTypes`, compiled into a single WHERE clause, so counts and paging stay consistent). Active filters appear as removable badges under the bar, with "Clear all".

## Dating undated items

**D38. Undated items are shown as undated.** Items with no capture date used to be placed by their file modified date. For Google Photos web downloads that is the download day: 15,826 items of a real library sat on the same day. Now they form a **"No date"** section at the end of the timeline (`assets.undated`, a generated column, plus the index `(undated, sort_time, id)`), still sorted among themselves by file date. The Year filter has a "No date" option (`years: [0]`).

**D39. Inferred dates, never overwriting recorded or manual ones** (`src/core/dating/dating.ts`, a whole-library pass run after imports and once fingerprinting is idle, skipped when nothing changed):
1. **From a matching copy** (`capture_time_source = 'duplicate'`): an undated item that is a probable duplicate (D34) of an item with a recorded date takes that date; the camera's own EXIF wins among several donors.
2. **From Android media ids** (`'estimated'`): files named `1000040770.jpg` carry MediaStore ids, which are handed out in save order. An undated id is interpolated between its nearest dated neighbours by id, but only when both exist, are in order, and are ≤ 30 days apart. Anchors that disagree with their neighbourhood by more than 14 days (old photos re-saved later) are ignored. Measured leave-one-out on the owner's dated files: correct to the day for at least 90%. The date means "saved on the phone", which for received media is roughly when it arrived; the evidence says so. Short numeric names (`46777.jpg`) only loosely follow time (25% off by more than 3 months), so they are **not** estimated.
3. **Manual** (`'manual'`): "Set date" on a selection, or in the info panel. Hand-set dates are never touched automatically. Inferred and manual dates can be removed; a date recorded in the file can be overridden but not erased.

Every inferred or manual date stores its reasons (`date_evidence`) and is labelled "estimated" in the info panel. `fallback_sort_time` keeps the original file-date position so estimates can be undone. **On a real library:** 166 dated from copies, 5,171 estimated (731 same day, 2,822 within a week, 1,618 within a month), 10,495 left under "No date". The pass takes 1.5 s.

## Bin, hidden and bulk selection

**D40. Bin before delete; permanent deletion only on explicit request** (`src/core/library/bin.ts`, migration 9). "Move to Bin" sets `assets.trashed_at`. Binned items disappear from every other view (the shared WHERE clause, facets, albums, both duplicate tiers and library counts) and wait in the Bin indefinitely; nothing is ever deleted automatically. **Delete permanently** works only on binned items:
1. the managed original(s) leave the library folder, by default through the OS recycle bin (`shell.trashItem`) as a last safety net, or, if the user opts out, by unlink to free the space now;
2. if removing the file fails, the item stays untouched in the Bin;
3. cached thumbnails are removed and the catalogue rows are deleted;
4. the SHA-256 is remembered in `deleted_assets`, and every deletion is logged.

Re-importing the same bytes is then classified `deleted_before` and skipped (shown in the import summary). Settings can "allow them to be imported again". Source folders and archives are never touched. `import_items` was rebuilt to allow the new classification, with `asset_id ... ON DELETE SET NULL`.

**D41. Hidden has its own page** (a sidebar entry with a count), separate from Cleanup.

**D42. Bulk selection loads what it needs.** Shift-click selects the whole timeline range between the last clicked item and this one, fetching ids for parts not loaded yet (`assetIdsInRange`, same ordering as the grid). Each month heading has a select-all circle, and Ctrl/Cmd+A selects everything in the current view, all filters applied.


## Protection (0.7)

**D43. Catalogue snapshots** (`src/core/library/dbSnapshots.ts`). The catalogue is the one file that cannot be rebuilt from the originals (albums, hidden flags, manual dates, provenance), so it is copied with SQLite's online backup API, which gives a consistent copy while the app runs:
- **When:** before every schema upgrade, once a day, after each import, before every permanent delete, and on demand (Storage).
- **Retention:** the newest 10 automatic copies and the newest 5 upgrade copies are kept, in `database/backups/`.

**D44. Mirror backups to a second location** (`src/core/library/backup.ts`). A backup target is a folder, usually on another drive, that becomes an openable Photo Vault library: originals plus a catalogue snapshot.
- **Copying:** each file goes to a temporary file, is re-hashed, and is only then renamed into place. A file already present with the right hash counts as done, so runs are incremental.
- **Never overwrite:** a different file at the destination path is moved into `.photovault-displaced`, never replaced.
- **Placement:** targets inside the library, or another library's folder, are refused. A non-empty folder gets a "Photo Vault Backup" sub-folder.
- **When it runs:** automatic targets update on open and after imports. "Verify" re-hashes the copies.
- **Status:** Storage shows how many items have a verified second copy, and the sidebar shows a dot while any do not.

**D45. Later imports enrich earlier items, never overwriting better data** (`enrichAsset` in `commit.ts`). When an import finds a copy of an existing item that carries more information, the gaps are filled in: a Google Takeout JSON adds a date, GPS, a description or a favourite to a photo that came without them. Rank order for dates: camera EXIF > Takeout/iCloud/XMP > file name > estimated/borrowed. A manual date is never replaced.

## Importing (0.7)

**D46. XMP sidecars** (`photo.jpg.xmp` / `photo.xmp`, `src/core/sources/sidecars.ts`). XMP sidecars contribute:
- **Date:** used when the file itself has no camera date.
- **Also read:** GPS, rating and description.
- **Provenance:** the raw XMP is kept with the import item.

**D47. iCloud exports.** Apple's `Photo Details.csv` supplies original creation dates (`"Saturday July 13,2019 12:52 PM GMT"`), favourites and hidden flags. Imports containing it are typed `ICLOUD_EXPORT`.

**D48. Live Photos are one item** (migration 11, `src/core/library/livePhotos.ts`). A still (HEIC/JPEG) and a short clip (MOV/MP4, ≤ 4 s) count as one Live Photo when both are true:
- **Same name:** same stem in the same source folder.
- **Same moment:** capture times within 3 s, when both are known.

The clip points at its still (`assets.live_photo_of`) and never appears on its own in the grid, the filters or the counts. The viewer plays it, and Bin, restore and delete apply to both parts.

**D49. HEIC without the Windows codec** (`src/core/media/heic.ts`). When libvips cannot decode a HEIC, thumbnails and previews fall back in this order:
1. the embedded EXIF thumbnail;
2. **libheif compiled to WebAssembly** (`heic-decode`, LGPL-3.0, loaded dynamically and kept unmodified as a separate module);
3. the OS thumbnailer.

Decoding is serialised because the decoder is memory hungry; a 24 MP HEIC takes about 3 s. This was verified in the packaged build with a real iPhone HEIC.

**D50. Watched folders** (`src/core/library/watch.ts`, migration 12):
- **Purpose:** a phone-sync or Downloads folder can be watched, and new media in it is imported automatically through the normal pipeline (copy, verify, deduplicate, provenance).
- **Pre-check:** each check first lists the folder and compares every media file's size and modification time with what earlier imports saw (`import_items.source_fingerprint`). An import starts only if something is new or changed, so quiet checks leave no import records.
- **Triggers:** file-system events (debounced 20 s while a phone is still syncing), every 15 minutes, and on open.
- **Yields to the user:** an import the user is running or reviewing is never interrupted; the check simply tries again later.
- **Labelling:** automatic imports are marked "Automatic" (`imports.trigger = 'watch'`).
- **Safety:** removing a watch never touches the library, and folders that overlap the library are refused.

## Library features (0.7)

**D51. Similar photos ≠ probable duplicates** (`src/core/repo/similar.ts`). Probable duplicates (D34) are copies of one shot. Similar photos are different shots of one moment: bursts and retakes. A series must meet all of these:
- **Dates:** every member has a recorded capture time; members are ≤ 10 s apart and the whole series lasts ≤ 2 min.
- **Looks:** looser fingerprint limits than duplicates (pHash ≤ 12, dHash ≤ 14, colour ≤ 60), with the same aspect ratio.
- **Distinct shots:** no two consecutive members share a timestamp (that would be a copy, not a new shot).

**The suggested shot:**
- **Sharpness:** the suggested shot is the sharpest one. Sharpness is the variance of the Laplacian on a 256 px greyscale render, computed with the fingerprints in a single decode (PHASH_VERSION 4).
- **Close calls:** if the sharpest is not clearly ahead (≤ 5 %), the reason says the shots are about equally sharp.

On a real library this finds 526 series with 745 extra shots. Spot checks of the most borderline groups showed real retakes. "Not similar" reuses the duplicate dismissals.

**D52. Non-destructive rotation** (`assets.rotation`). Rotating stores an angle; the original file is never rewritten. Each rotation:
- **re-renders the thumbnail** immediately and invalidates the cached preview, fingerprint and smart-search vector;
- **switches the viewer** to the rotated preview, since the browser would show the original unrotated;
- **cache-busts the media URL** (`?r=`) so the new thumbnail shows.

Videos are not rotated.

**D53. Export copies originals byte for byte** (`src/core/library/export.ts`). A selection or a whole album is copied to a chosen folder:
- **No overwriting:** existing names get " (2)", and the copy itself uses `COPYFILE_EXCL`.
- **Dates:** each copy's modified time is set to the date taken, so other apps sort it correctly.
- **Live Photos:** the motion clip travels with its still.
- **Rotation:** not applied. An export is the original; that is the point of an archive.

**D54. Recently added and sort order.** The timeline can be ordered by date taken (default) or by import time, grouped by import day ("Added 9 October 2026", index on `assets.created_at`). Smart-search results add a third order, best match first. The timeline buckets, pages and range selection share one `orderBy`, so offsets always agree.

**D55. Map with an offline base map** (`src/core/repo/geo.ts`, `MapView.tsx`):
- **Base map:** Leaflet with Natural Earth country outlines from `world-atlas` (50m, bundled), so the map works offline and sends nothing anywhere.
- **Detailed map (opt-in):** OpenStreetMap tiles; the button says that the visible area is requested from tile.openstreetmap.org. The CSP allows only that host for images.
- **Clustering:** done in SQL with a grid of about ¼ tile per cell at the current zoom, with a cover photo per cluster, so the renderer draws at most a few hundred pins even at 100k items.
- **Photos panel:** clicking a pin lists that place's photos in a side grid (`AssetQuery.bbox`, antimeridian-safe).

## Scale and responsiveness (0.7)

**D56. Full-text search with FTS5 trigrams** (`src/core/repo/search.ts`, migration 12). Search used `LIKE` scans over a few columns and joins. Now one FTS5 row per asset holds every searchable text:
- **Indexed text:** all file names the item was found under, folders, Google album names, camera, description, date, format and the user's album names.
- **Matching:** the trigram tokenizer keeps "contains" semantics ("4801" finds IMG_4801.JPG) and ignores case and accents ("ferias" finds "Férias"); tokens shorter than 3 characters fall back to a scan of the index text.
- **Keeping it current:** triggers mark changed assets in `search_dirty`, and rows are rebuilt lazily before a text query and in the background after open and imports. The triggers avoid `INSERT OR IGNORE`, because the conflict policy of the statement that fires a trigger overrides the trigger's own.
- **Speed:** about 2 ms per query at 100k items, against about 20 ms for a scan.

**D57. A 100k-item performance test** (`npm run test:perf`, `tests/perf.test.ts`) builds a synthetic catalogue shaped like a real library (phone photos, WhatsApp, screenshots, near-copies, GPS) and times every query the UI makes against a budget. Results:
- **Navigation:** timeline 58 ms, deep page 42 ms, recently added 87 ms.
- **Facets and search:** facets 220 ms, search 1–63 ms.
- **Selection and map:** 50k-item range selection 45 ms, world map clusters 219 ms.
- **Whole-library passes:** similar photos 0.4 s, dating 1.9 s, probable duplicates 3.7 s on first run (then cached).

**D58. Heavy work off the main process.** Measured during an import, the main process's event loop stalled at most 24 ms, and 71 ms during thumbnails and fingerprints. Hashing, sharp and file copies already run on Node's thread pool, so imports stay in-process and keep a single SQLite writer. Whole-library computations that would stall the window move to a **worker thread** (`src/main/worker.ts`, a separate entry in the main build) with its own read-only connection:
- **Probable-duplicate grouping:** the worker computes the groups and the main process primes its cache. Both the Duplicates page and the dating pass await this result, falling back to inline computation if the worker fails.
- **Smart search:** model loading, inference and vector scoring.

The dating pass (≈ 0.4 s at a real library's size) still runs inline.

## On-device AI (0.7)

**D59. Smart search with CLIP, on the device, opt-in per library** (`src/core/ai/clip.ts`, `src/main/smartSearch.ts`):
- **Model:** CLIP ViT-B/32, 8-bit quantised ONNX, through transformers.js + onnxruntime-node.
- **Download:** the model (~150 MB) comes from Hugging Face once, into the app's data folder, and only after the user turns the feature on. Photos never leave the computer.
- **Indexing:** thumbnails are embedded in the background on the worker thread, about 15 per second while sharing the CPU with other background work. Vectors (512 × float32) are stored in `asset_embeddings` and dropped when an item is rotated or deleted.
- **Search:** a query is embedded and scored against every vector in the worker; at 100k items that is a few hundred ms. Matches are those clearly above the library's typical score (mean + 3 σ, at most 400) and are shown best first.
- **Quality:** on real photos, "swimming pool", "birthday cake", "car interior at night" and "food on a table" all return the right pictures at the top.
- **Packaging:** only the Windows x64 onnxruntime binaries ship; onnxruntime-web is already bundled inside transformers.js and is excluded.

**D60. People (face grouping) with freely licensed models** (0.8; `src/core/ai/faces.ts`, `src/core/ai/people.ts`, `src/main/people.ts`, migration 13). The strongest open recognisers (InsightFace/ArcFace) are licensed for non-commercial research only. OpenCV Zoo's models avoid the question:
- **Detection:** YuNet (MIT) finds faces and 5 landmarks.
- **Recognition:** SFace (Apache-2.0) turns a landmark-aligned 112×112 face into 128 numbers.
- **Download:** the two models (39 MB) are fetched once, after the user turns People on, and checked against pinned SHA-256 hashes.
- **Processing:** pre- and post-processing reimplement OpenCV's FaceDetectorYN / FaceRecognizerSF: letterboxed BGR input, anchor-free decoding, NMS, and a least-squares similarity transform onto the ArcFace landmark template.
- **What is kept:** faces are detected on a working image of at most 1600 px. Faces under 36 px are skipped as unrecognisable. Each face stores a normalised box, a quality score, its vector and a 160 px crop (`thumbnails/faces/`, regenerable).
- **Speed:** about 14 photos per second in the worker thread, so 20k real photos take about 25 minutes, in the background.

**D61. How faces become people.** Tuned visually on 1,431 real photos (447 faces):
- **Average similarity:** a face joins a group by its average similarity to the group's faces (average linkage, threshold 0.5), not by similarity to a mean face. The mean-face variant let large groups absorb look-alikes.
- **Same photo, different people:** two faces on the same photo never join the same person.
- **Weak faces only follow:** small or blurry faces (quality < 0.5) can join a person but never start one.
- **Threshold for a new person:** a group needs faces on at least 3 photos.
- **Splits are recoverable:** stricter thresholds trade a few split people (fixed with **Merge**) for far fewer mixed ones, which are more annoying to fix.

**D62. The user's corrections always win.** Grouping is incremental:
- **No automatic moves:** once a face belongs to a person, only the user moves it. New faces join the closest person or form new people.
- **"Not this person"** (on a person's page) removes those faces and records the rejection, so grouping never puts them back.
- **Merge:** the named (or larger) person is kept.
- **Name conflicts:** naming someone with a name already in use offers to merge them.
- **Hidden people:** they leave the People page; their photos stay.
- **Search and viewer:** names are searchable (FTS triggers on faces and persons), and the viewer lists the people in each photo.
- **Turning it off:** "Turn off and delete face data" forgets every face, person and crop; photos are never touched.
- **Rotation and deletion:** rotating a photo re-scans it, and deleting one removes its faces.

The People page shows people in order of photo count, with unnamed ones as "Add a name", the way Google Photos does.

**D63. Split people are merged, and the uncertain ones are asked about** (0.8.1, migration 14). On a real library, People showed the same person as several groups.
- **Cause:** the scan regroups every 400 photos. Once a group became a person, it never merged with another person, so someone found in different batches (or with and without glasses) stayed split.
- **Automatic merging:** grouping now merges existing people whose faces are, on average, as alike as one person's own faces (≥ 0.5; within one person the average is 0.52–0.65). It works greedily, most alike first, re-checking the merged groups so that chains cannot pull dissimilar people together. People who share a photo, carry different names, or were marked "different" are never merged. New groups that match an existing person join that person.
- **Effect:** on 9,074 faces in a real library, 29 split people merged (7 of them with 20+ faces), with no mistakes among the pairs inspected.
- **"Same or different person?":** pairs between 0.42 and 0.5, where at least one has 8+ faces, are offered for review: two face circles with sample faces, answered with Same / Different / Not sure (keys S / D / N). There are about 250 on a real library, shown 30 at a time.
- **Remembered answers:** "Different" is stored (`person_not_same`) and carried over when people are merged.
- **Why not automatic below 0.5:** in 0.45–0.5 most pairs are the same person, but some are look-alikes, and a wrong automatic merge is worse than a question.
- **Existing libraries:** they are regrouped once on update (`people_grouping` version).
- **The model's limit:** SFace is a lightweight recogniser. Glasses, sunglasses, age and lighting shift its fingerprints, so some splitting is inherent; the review is the remedy.

## Viewer, video and editing (0.9)

**D64. The viewer is pinned to the photo you opened.**
- **The bug:** the viewer re-fetched the photo on every library-change event, clearing it and fading it in again each time. While People, smart search or fingerprinting ran in the background, those events came several times a second, so the photo flickered. A background re-ordering of the timeline (dates being estimated) could also swap in a different photo at the same index.
- **The fix:** the viewer holds the id of the photo on screen and changes it only when the user navigates. Library changes refresh the details quietly, and the picture element is never replaced. Measured on a real library with People scanning: one stable state across 8 s.

**D65. Right-click menu in the viewer.**
- **Clipboard:**
  - *Copy picture* (Ctrl+C) puts a PNG of the photo as shown (rotation and edits applied, HEIC included) on the clipboard.
  - *Copy file* uses the Windows file-drop format, so pasting in Explorer or a chat inserts a copy.
  - *Copy file path* copies the path as text.
- **Opening and saving:**
  - *Open in another app* opens a temporary copy, so an external editor can never change the archived original.
  - *Show in Explorer*.
  - *Save a copy* (the original) and *Save edited copy* (a JPEG).
- **Also available:** Share, Edit, Rotate, favourite, album, date, hide, info and Bin.
- **Electron 44:** it replaced the old clipboard calls with an asynchronous `ClipboardItem` API. Raw Windows formats go through `electron application/osclipboard;format="FileNameW"`.

**D66. HEVC and other undecodable videos** (`src/core/media/ffmpeg.ts`, `src/main/videos.ts`). A real library's 138 videos without thumbnails were HEVC/H.265 (71 of them 4K).
- **Bundled ffmpeg:** a bundled ffmpeg (`ffmpeg-static`) now grabs a thumbnail frame. The binary is a separate GPL program run as a process and is unpacked from the asar.
- **Retry:** failed thumbnails are retried once when generation improves (`thumb_retry`).
- **Playback:** the viewer tries the original first. On a decode error, or if no picture size is reported, it asks for a playable H.264 copy. That copy is made once (≤ 1920 px, progress shown), cached in `thumbnails/videos/<sha>.mp4`, and served as `pv-media://playable/<id>`.
- **On the development PC:** Chromium plays HEVC natively through hardware decoding, so the fallback matters for other machines and older formats. The e2e test checks it with an MPEG-4 Part 2 clip.

**D67. Non-destructive photo editing** (`src/core/media/edits.ts`, `Editor.tsx`, migration 16).
- **Tools:** crop with aspect presets, rotate, flip, light, contrast, colour, warmth, and six filters.
- **Storage:** edits are instructions in `assets.edits` (JSON). Crop is stored as fractions of the rotated picture, so it applies at any resolution. `edit_rev` changes cached-image URLs.
- **Rendering:** the editor's previews come from the main process using the same code as the saved result, so what you see is what you get. Thumbnails and previews are re-rendered on save.
- **The original:** never changed. "Revert to original" clears the instructions.
- **Exports:** exports stay originals. "Save edited copy" and Share produce a JPEG with the edits.

## People (0.9)

**D68. Undoable merges and face-level corrections** (migration 15).
- **Recorded merges:** every merge, automatic or by the user, is recorded with the faces it moved (`person_merges`). Undo restores the person and those faces and marks the pair "different", so grouping never merges them again. Merges into a person that is itself merged later follow along.
- **Faces tab:** a person's page lists every face. Selecting faces (Shift for a range) lets you choose *Not this person* or *Move to…* (an existing or new person).

**D69. Tagging faces in the viewer.** The Faces button (F) shows boxes and names, mapped through crop and flip edits. Clicking a box lets you name it (existing or new person), clear the name, or mark it "Not a face".
- **Missed faces:** "Add a face" lets the user draw a box. The detector searches only that area with a lower bar (0.5): if it finds a face, the face gets a fingerprint and can be grouped. Otherwise it is stored as a plain box (quality 0, excluded from grouping) that the user names.
- **Videos are scanned too:** People looks at one frame from the middle of each video.

**D70. Face crops are named by content, not by database id.**
- **The hazard:** crops used to be `thumbnails/faces/<faceId>.webp`. A copy or restore of the catalogue reuses ids for other faces and would show or overwrite wrong crops; the snapshot testing in this project could do exactly that.
- **The fix:** crops are now `faces/<sha256 of photo>-<box>.webp`. Missing ones are cut from the original on demand (four at a time) and cached. Old id-named files are removed once.

**D71. Person filter speed.** `EXISTS (SELECT … faces WHERE asset_id = a.id AND person_id = ?)` led SQLite to re-read a person's faces for every photo: 41 s for the top person in a real library.
- **Rewrite:** the person, album and tag filters are now `a.id IN (SELECT asset_id …)`, taking 5 ms.
- **Statistics:** `PRAGMA optimize` runs on every open, so the planner has statistics.

## Library (0.9)

**D72. Memories** (`src/core/repo/memories.ts`). Memories are computed on demand from the user's own photos: camera or unknown origin, recorded dates only, not hidden.
- **On this day:** the same date in earlier years, ±1 day when the day is thin.
- **Trips:** consecutive days (gaps ≤ 2) where most located photos are more than 100 km from home. Home is the most-photographed 0.25° cell. A trip needs at least 10 photos, and at least 2 days or 25 photos.
- **Trip names:** "Trip to <country>", from an offline point-in-polygon test against Natural Earth 1:110m.
- **Big days:** at least 25 photos on one day at home.
- **On a real library:** 11 trips, in 0.65 s.
- **Slideshow:** every grid has a Slideshow button. Photos cross-fade with a slow zoom, videos play to the end, Space pauses, arrows step, and the interval is 3/5/8 s.

**D73. Tags, captions, hand-set locations, smart albums and sharing** (migration 17).
- **Tags and captions:**
  - Tags are case-insensitive (`asset_tags`), editable in the info panel or in bulk ("More → Add tags").
  - Captions are the existing `description`, edited in the info panel.
  - Tags, captions and people's names feed the FTS search.
- **Locations:** a map picker (offline outlines, optional OSM tiles, or typed coordinates) sets `latitude/longitude` with `location_source = 'manual'`. Later imports only fill empty GPS, so hand-set places are never overwritten.
- **Smart albums:** "Save as smart album" next to the filter badges stores the query (`smart_albums`; paging, smart-search ids and sort are not saved). The album shows whatever matches now, and appears on the Albums page.
- **Share:** prepares JPEG copies in a new folder that opens in Explorer: small 1280 / large 2048 / full size, edits applied. Location and camera details are always removed; the date taken is kept unless unticked. Videos are copied as they are.
- **Selection bar:** Favourite, Add to album, Share, Hide, Bin, and **More** (Set date, Set location, Add tags, Rotate, Export originals).

## Protection, updates and platforms (0.10)

**D74. Rotating backup drives and automatic checks.** The owner chose rotating drives over a cloud copy (no subscription, nothing leaves the house).
- **Naming:** each backup location can be named ("Drive at home", "Drive at Mum's"). Storage shows per drive whether it is up to date or how many items are not on it yet.
- **Brought up to date on plug-in:** every minute the app checks connected automatic drives; one that is missing items gets them copied straight away.
- **Monthly checks:** once a day the app looks at when the library and each connected drive were last fully verified; anything older than 30 days is verified again in the background.
- **One-click catalogue restore:** Storage lists the catalogue snapshots. Restore first saves the current catalogue as a "before restore" snapshot, so a restore can itself be undone; photo files are never touched.

**D75. CI on GitHub.** Every push runs typecheck and the full test suite on Windows, and builds unsigned macOS and Linux packages (artifacts on the run).
- **Canonical paths:** Windows runners use 8.3 short temp paths (`RUNNER~1`); the library, backup targets, watched folders and the test sandbox now compare `realpathSync.native` forms.
- **onnxruntime-node:** `ONNXRUNTIME_NODE_INSTALL=skip` stops its install script downloading optional CUDA files on Linux (it timed out); the CPU build is in the package.
- Mac and Linux builds package fine but have not been run on those systems. Phone import and the Recycle Bin are Windows-only.

**D76. Auto-update from the private repository** (`src/main/updater.ts`). electron-updater against GitHub Releases of `raullopesalves/photovault`.
- **Token:** a private repository needs a token to read releases. The user pastes a fine-grained, read-only token (this repository, Contents: read) in Settings → Updates; it is checked against the API and stored encrypted with Electron `safeStorage` (DPAPI). Nothing is bundled in the app.
- **Behaviour:** checks 30 s after start and every 6 h, downloads in the background, installs on quit or "Restart and update". Only the installed (NSIS) build updates; the portable exe and dev runs say so.
- **Publishing:** `npm run release` builds and uploads with the GitHub CLI's login. Code signing was skipped by the owner (SmartScreen warns on first run).

## Library (0.10)

**D77. Place names offline** (`src/core/geo/places.ts`, migration 19). GeoNames cities5000 (64k places, CC BY 4.0, 2.6 MB JSON) on a 1° grid; nearest town within 30 km becomes `assets.place` ("Lisbon, Portugal"), filled in the background and reset by a trigger when the location changes. Used by search, the map, the viewer and trip names (the dominant town when ≥ 60 % of the trip, else the country).

**D78. RAW photos** (`src/core/media/raw.ts`). Camera RAW files are kept as originals; thumbnails, previews, edits and shares use the largest JPEG the camera embedded (walked by JPEG markers), oriented by its own or the RAW's EXIF. No RAW development is attempted.

**D79. Edited versions from phones** (`src/core/library/editedVersions.ts`, migration 20). `IMG_E1234` next to `IMG_1234` (iPhone, with its `.AAE`) and `name-edited` next to `name` (Google Takeout) in the same source folder are paired: the original gets `version_of` = the edited one and leaves the grid; the viewer's "Original" toggle shows it; Bin and delete take both. Both stay ordinary files.

**D80. Import straight from a phone** (`src/core/sources/phone.ts`). Phones and cameras over USB are MTP devices, invisible to Node. Windows' Shell (PowerShell `Shell.Application`) lists them and copies their `DCIM` and `Pictures` folders into `PhotoVault phone copies\<device>` next to the library (outside it, since imports never read the library), which is then imported as a folder.
- **Never overwrites:** each file lands in an empty `.incoming` folder and is moved into place; a different file with the same name gets "name (2)".
- **Only new files:** a file already copied (same name, or a "(n)" variant, with the same size) is skipped before copying; the SHA-256 import still decides identity.
- The phone is only read. Moves and deletes of our own temporary copies retry briefly (antivirus scans lock new files).

**D81. Portuguese interface** (`src/renderer/src/lib/i18n.ts`, `i18n-pt.ts`). English text is the key (`t('Photos')`), `{name}` placeholders; a missing entry shows English. European Portuguese. The language is chosen in Settings (first run follows Windows) and applied before the renderer's modules load (changing it reloads the window). Memory titles, dates, country names and file dialogs follow it. A test fails if any interface text lacks a translation, a translation changes the placeholders, or a translation is unused. The strings were wrapped by a TypeScript-AST codemod, then reviewed.

**D82. Pets** (`src/main/smartSearch.ts`). Dogs and Cats appear in People once smart search has looked at the photos. Zero-shot classification over 20 CLIP labels (dog, cat, person, selfie, food, screenshot, meme, cartoon, toy…): a photo counts only when "dog" or "cat" wins with p ≥ 0.6 (softmax at CLIP's logit scale 100), which is far more precise than a single-text threshold. On the owner's first 2,400 indexed photos: 21 dogs and 18 cats. Telling individual pets apart is not attempted (no reliable on-device model).

**D83. Automatic descriptions** (`src/core/ai/caption.ts`, `src/main/captions.ts`, migration 21). Florence-2-base (MIT, ~265 MB quantised, `<CAPTION>` task) describes each photo in one sentence ("A dog sitting in a field with trees in the background."), from its thumbnail. Opt-in; ~2 s per photo, so it runs on a second worker thread to avoid queueing smart search and faces behind it, newest first, and can be paused. Captions are English, shown in the viewer's details and indexed for search. ViT-GPT2 was considered and rejected for quality.

**D84. Sharing as a web page** (`src/main/webGallery.ts`). A shared family library would need a server or a cloud account, so it was not built. Instead an album can be saved as a folder with `index.html`, `photos/` (2048 px JPEGs, edits applied, location and camera data removed) and `thumbs/`; the page has a grid, a full-screen viewer with keys and swipe, and works offline from `file://` (data embedded, captions escaped). Zip it and send it, or upload it anywhere to share a link.

**D85. Print and photo books** (`src/main/photoBook.ts`). A4 PDF from an album or a selection, rendered by Chromium (`printToPDF`) in a hidden window from a temporary HTML page: a photo book (cover, then one landscape or two portrait photos per page with date and caption), one photo per page, or a 20-up contact sheet. Images are prepared at about 200 dpi with edits applied; videos are left out.
