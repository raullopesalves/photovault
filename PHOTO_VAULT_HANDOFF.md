# Photo Vault — Project Handoff

## 1. Project Overview

Photo Vault is a local-first personal photo management application.

The core problem:

Cloud photo services such as Google Photos and iCloud eventually fill their storage quotas. Users then export/download their photos, move them onto local drives, and delete them from cloud storage.

This results in:

- Google Takeout ZIP archives
- iCloud exports
- duplicated photos across multiple exports
- folders scattered across HDDs/SSDs
- unreliable filesystem creation dates
- metadata stored separately in JSON sidecars
- uncertainty about whether a photo has already been safely archived
- no pleasant way to browse the resulting archive

Photo Vault should turn these exports into a permanent, organized, searchable photo library while keeping the actual media files under the user's control.

The application should NOT create a proprietary photo-storage format.

Original media should remain ordinary files that can be accessed without Photo Vault.

---

# 2. Product Philosophy

The priorities are:

1. User owns the files.
2. Local-first.
3. Originals are never modified unnecessarily.
4. Destructive operations require explicit confirmation.
5. Duplicate detection should be explainable.
6. Metadata should be preserved.
7. Imports should be repeatable/idempotent.
8. The application should scale to tens or hundreds of thousands of assets.
9. Photo Vault should still leave the user's archive understandable if the application disappears.
10. Cloud integrations can come later.

The initial application is a desktop application, not a cloud SaaS.

---

# 3. Initial User Workflow

Example:

The user downloads:

```text
takeout-001.zip
takeout-002.zip
takeout-003.zip
iCloud Photos.zip
```

They drag these files/folders into Photo Vault.

Photo Vault:

1. identifies the source/export type;
2. scans the archives;
3. finds media files;
4. finds associated metadata files;
5. extracts relevant metadata;
6. calculates hashes;
7. compares files against the existing library;
8. identifies exact duplicates;
9. proposes an import;
10. copies/moves new originals into the managed library;
11. stores metadata/provenance in its database;
12. generates thumbnails;
13. shows the resulting photos in a chronological library.

Example import summary:

```text
Google Photos Export

17,842 files scanned

14,203 new photos
   427 new videos
 2,814 exact duplicates
   398 metadata/sidecar files

Potential duplicate storage avoided: 18.7 GB

[Review]
[Import new items]
```

---

# 4. MVP

The first usable version should focus on:

## Library

- Browse photos/videos chronologically
- Year/month/day grouping
- Responsive thumbnail grid
- Open asset in detail/lightbox view
- Basic video playback
- Favorites
- basic albums/collections
- Recently imported

## Import

Support initially:

- normal folders
- ZIP archives
- Google Takeout / Google Photos exports
- generic iCloud photo exports

Import must NOT assume filesystem creation time represents capture time.

Extract metadata where available from:

- EXIF
- XMP
- embedded media metadata
- Google Takeout JSON sidecars
- filenames as a last-resort heuristic

Metadata precedence should be deliberate and documented.

## Exact Duplicate Detection

Calculate SHA-256 for every imported media file.

Same SHA-256 means byte-for-byte identical.

Filename must NOT determine identity.

Example:

```text
Google/IMG_4927.HEIC
iCloud/IMG_4927.HEIC
Old HDD/holiday_picture.heic
```

If all have the same SHA-256, Photo Vault should represent them as one logical asset while retaining provenance information for every source.

Never silently delete duplicate source files during MVP.

Instead:

```text
Exact duplicate detected

Already archived:
IMG_4927.HEIC

New source:
Google Photos Takeout

Files are byte-for-byte identical.

[Skip duplicate]
[Keep another physical copy]
```

Skipping should be the recommended behavior during imports.

## Provenance

One logical asset can have multiple source records.

Example:

```text
Asset
ID: 82374
SHA256: ...
Canonical path: /Photos/2024/07/IMG_4927.HEIC

Sources:
Google Photos
iCloud
External HDD
```

Do not lose provenance when deduplicating.

---

# 5. Near-Duplicate Detection

This is NOT required for the first milestone but the architecture should support it.

Examples:

- HEIC original
- JPEG export
- resized WhatsApp copy
- edited version
- compressed copy
- cropped version

SHA-256 will correctly consider these different files.

Future detection can use:

- perceptual hashing (pHash/dHash)
- image embeddings
- dimensions
- capture timestamps
- EXIF
- filename hints

The UI should clearly distinguish:

### Exact duplicate

Cryptographic hash identical.

Very high certainty.

### Probable duplicate

Different bytes but likely the same underlying image.

Requires user review.

### Similar photo

Visually similar but potentially a different photograph.

Never automatically delete.

Examples include bursts and multiple shots of the same scene.

---

# 6. Safety

Photo Vault is dealing with potentially irreplaceable personal files.

Safety is more important than convenience.

Rules:

- Never overwrite originals silently.
- Never delete source files during import.
- Never automatically delete cloud photos.
- Never modify original media unless explicitly requested.
- Destructive actions require confirmation.
- Database deletion should not necessarily imply filesystem deletion.
- Prefer recoverable trash operations where possible.
- Log imports and destructive operations.
- Hash verification should be available.

Eventually Photo Vault may provide a "Safe to delete from cloud" workflow, but it should only do so after verifying that the original exists in the local archive.

Example:

```text
Google Photos Cleanup

18,426 assets archived
18,426 originals verified

Local archive: verified
Backup: not configured

Photo Vault recommends creating another backup before deleting cloud originals.
```

---

# 7. Suggested Architecture

Claude Code should inspect the environment and choose sensible implementation details, but the preferred direction is:

## Desktop

Electron OR Tauri.

Tauri is attractive because of its smaller footprint, but implementation simplicity matters more than ideological preference.

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS

Use a component system only if it materially speeds development.

## Backend / Desktop Core

Choose whichever integrates cleanly with the selected desktop framework.

Potential approaches:

### Tauri
Rust core + React frontend.

### Electron
Node.js/TypeScript backend + React frontend.

For an MVP, Electron + TypeScript may reduce complexity.

Document the decision.

## Database

SQLite.

The database contains:

- assets
- physical files
- provenance
- metadata
- albums
- album membership
- imports
- duplicate relationships
- thumbnails
- future face/AI indexes

It should NOT contain original image binaries.

---

# 8. Suggested Data Model

Do not treat this as immutable. Improve it where necessary.

## assets

Logical media item.

Fields could include:

```text
id
sha256
media_type
mime_type
capture_time
width
height
duration
favorite
latitude
longitude
camera_make
camera_model
created_at
updated_at
```

## files

Physical representations.

```text
id
asset_id
path
filename
size_bytes
sha256
storage_location_id
exists
created_at
```

This distinction will become important when one logical asset exists on multiple disks.

## provenance

```text
id
asset_id
source_type
source_name
original_path
original_filename
import_id
metadata_json
created_at
```

source_type examples:

```text
GOOGLE_TAKEOUT
ICLOUD_EXPORT
LOCAL_FOLDER
ZIP
UNKNOWN
```

## imports

```text
id
source_type
source_path
started_at
completed_at
status
files_scanned
assets_created
duplicates_found
bytes_imported
```

## albums

```text
id
name
description
created_at
updated_at
```

## album_assets

```text
album_id
asset_id
sort_order
```

## storage_locations

Future-proof the system for multiple drives.

```text
id
name
root_path
type
available
```

Example:

```text
Main Photo HDD
E:\PhotoVault
LOCAL_DISK
```

---

# 9. Managed Library Layout

Do not use filenames as the database identity.

A reasonable managed layout could be:

```text
PhotoVault/
├── originals/
│   ├── 2019/
│   ├── 2020/
│   ├── 2021/
│   └── 2026/
├── thumbnails/
├── database/
└── temp/
```

Potential filename collision strategy:

Preserve original filename when possible.

If collision occurs, append a deterministic suffix derived from the hash.

Example:

```text
IMG_4821.HEIC
IMG_4821_a73f81c2.HEIC
```

Never overwrite because filenames collide.

---

# 10. Import Pipeline

Design import as an explicit pipeline rather than one giant function.

Suggested stages:

```text
Source
 ↓
Source detection
 ↓
Archive enumeration/extraction
 ↓
Media discovery
 ↓
Sidecar matching
 ↓
Metadata extraction
 ↓
Hash calculation
 ↓
Existing-library lookup
 ↓
Import classification
 ↓
User review
 ↓
File ingestion
 ↓
Database commit
 ↓
Thumbnail generation
 ↓
Index update
```

Each stage should have clear inputs/outputs and error handling.

Imports should be resumable eventually.

---

# 11. Metadata

Metadata preservation is important.

Possible sources:

1. embedded EXIF/XMP
2. Google Takeout JSON sidecars
3. embedded video metadata
4. filesystem metadata
5. filename heuristics

The importer should normalize metadata into Photo Vault's schema while preserving the raw source metadata where reasonable.

Do not throw away unknown Google metadata merely because the MVP does not currently display it.

Capture date is particularly important.

The app should distinguish:

```text
capture_time
filesystem_created_time
filesystem_modified_time
import_time
```

These are NOT interchangeable.

---

# 12. Google Takeout

Google Takeout deserves a dedicated importer.

It should detect structures such as:

```text
Takeout/
└── Google Photos/
    ├── 2024/
    ├── Summer Holiday/
    └── ...
```

Media may have associated JSON metadata.

The importer should attempt robust sidecar matching rather than assuming every JSON filename follows exactly one convention.

Albums should eventually be reconstructable from Takeout structure/metadata.

Do not create duplicate logical assets simply because Google placed the same media in multiple album folders.

---

# 13. iCloud

Initially support generic exported iCloud media.

The architecture should allow a dedicated iCloud importer later.

Handle:

- HEIC
- JPEG
- PNG
- MOV
- MP4

Live Photos should eventually be modeled as related assets/components rather than accidentally treating the photo and associated video as unrelated duplicates.

This can be postponed if necessary for MVP.

---

# 14. Thumbnails

Never render the entire original file for every grid item.

Generate cached thumbnails.

Suggested variants:

```text
small
medium
preview
```

Generation should happen asynchronously and should not block the entire import.

The library should remain responsive with 50,000+ assets.

Use virtualization for large grids.

---

# 15. Search

MVP:

- filename
- date
- year
- media type
- favorite
- camera
- import source

Future:

- location
- people
- OCR
- semantic image search
- natural-language search

Examples:

```text
football in Switzerland
snowboarding
sunsets
pictures of me at the beach
```

Potential future implementation:

- CLIP-like image embeddings
- vector index
- face embeddings/clustering

AI functionality should preferably be local-first.

---

# 16. Map

Future feature.

For assets containing GPS:

- map view
- clusters
- browse photos by location

Do not make map functionality a blocker for MVP.

---

# 17. People / Face Recognition

Future feature.

Pipeline:

```text
face detection
→ embedding
→ clustering
→ user labels cluster
→ person identity
```

Face recognition data should remain local by default.

---

# 18. Storage Management

Long-term, Photo Vault should abstract storage locations.

Example:

```text
Photo Vault

PC SSD
126 GB

Main Photo HDD
2.8 TB

Backup HDD
2.8 TB

Google Photos
14 GB
```

The user should see one unified logical library regardless of where files physically reside.

Do not implement full storage abstraction immediately if it delays MVP, but avoid architectural decisions that make it impossible.

---

# 19. Backup Awareness

Photo Vault itself is NOT a backup unless multiple copies exist.

Eventually allow the user to configure:

```text
Main archive
Backup archive
```

Then verify copies using hashes.

Potential status:

```text
Asset protection

Local archive      ✓
Backup HDD         ✓
Cloud              ✓

3 verified copies
```

This could eventually support a 3-2-1 backup workflow.

---

# 20. UX Direction

The interface should feel like a modern photo application rather than an admin dashboard.

Think:

- large imagery
- minimal chrome
- dark/light themes
- smooth timeline
- fast grid
- generous spacing
- clear import feedback

Main navigation could be:

```text
Photos
Albums
People
Map
Imports
Duplicates
Storage
Settings
```

For MVP, People and Map can be disabled/marked future.

Photos should be the default view.

---

# 21. Dashboard / Import Experience

When nothing has been imported:

```text
Your photos, permanently yours.

Create a library or import an existing collection.

[Import photos]

Supports folders, ZIP archives and Google Takeout.
```

Import should be drag-and-drop friendly.

During scan:

```text
Scanning Google Photos…

8,482 / 17,842 files

Finding metadata…
Checking duplicates…
```

Then review before committing.

---

# 22. Duplicate Center

Create a dedicated section eventually:

```text
Duplicates

Exact duplicates        1,527
Probable duplicates       381
Similar photos          2,104
```

Exact duplicates should show why Photo Vault believes they are identical.

Example:

```text
BYTE-FOR-BYTE IDENTICAL

SHA-256
7f83b165...

Google Photos
IMG_4821.HEIC
4.82 MB

iCloud
IMG_4821.HEIC
4.82 MB
```

Explainability is preferable to simply displaying "AI says duplicate."

---

# 23. Performance

Assume libraries of at least:

```text
100,000 assets
```

Avoid designs requiring:

- loading all assets into memory
- rendering every thumbnail simultaneously
- rehashing the entire library on every startup
- rescanning every drive constantly

Hash once and persist results.

Use database indexes.

Paginate/query incrementally.

Virtualize photo grids.

---

# 24. Testing Priorities

Tests are especially important around:

- duplicate detection
- filename collisions
- metadata parsing
- sidecar matching
- interrupted imports
- corrupted images
- corrupted ZIP archives
- repeated imports
- missing storage devices
- files disappearing after import
- same filename/different content
- different filename/same content

Critical invariant:

Running the same import twice must NOT create duplicate logical assets.

---

# 25. Initial Milestones

## Milestone 0 — Foundation

- repository structure
- desktop application launches
- React UI
- SQLite initialized
- settings/library path
- basic navigation

## Milestone 1 — Local Library

- import normal folder
- discover supported images
- SHA-256 hashing
- EXIF metadata
- store records
- generate thumbnails
- chronological grid
- photo detail view

At this point the application should already be usable.

## Milestone 2 — Exact Deduplication

- compare hashes against DB
- recognize same asset across imports
- preserve provenance
- duplicate review UI
- repeated imports are idempotent

## Milestone 3 — ZIP + Google Takeout

- ZIP handling
- Takeout detection
- sidecar matching
- metadata reconstruction
- import preview
- Google provenance

## Milestone 4 — Library UX

- albums
- favorites
- filters
- basic search
- import history
- duplicate center

## Milestone 5 — iCloud Improvements

- robust iCloud import
- HEIC handling
- Live Photo relationships
- video improvements

## Milestone 6 — Smart Library

- perceptual duplicate detection
- similarity review
- semantic search
- optional face clustering
- map

Do NOT jump to Milestone 6 before the underlying archive is trustworthy.

---

# 26. Immediate Development Goal

The first development session should produce a working vertical slice:

```text
Select folder
      ↓
scan photos
      ↓
SHA-256
      ↓
EXIF
      ↓
SQLite
      ↓
thumbnails
      ↓
photo grid
      ↓
click photo
      ↓
detail view
```

Then prove deduplication:

Import the same directory again.

Expected:

```text
0 new assets
X exact duplicates
```

Then copy one image, rename it, and import it.

Expected:

```text
0 new assets
1 exact duplicate
```

This validates the fundamental architecture.

---

# 27. Development Rules for Claude Code

1. Read this entire document before changing code.
2. Inspect the repository before choosing architecture.
3. Do not overengineer hypothetical future features.
4. Preserve extension points for future functionality.
5. Prioritize a working vertical slice.
6. Keep modules small and understandable.
7. Use strict TypeScript where applicable.
8. Avoid `any` unless justified.
9. Add migrations rather than manually mutating DB schemas.
10. Treat filesystem operations as potentially destructive.
11. Never implement automatic deletion without explicit requirements.
12. Validate paths and archive contents.
13. Prevent ZIP path traversal.
14. Do not trust file extensions alone.
15. Keep original files untouched.
16. Add useful structured logging.
17. Write tests for import/deduplication logic.
18. Keep this document updated when significant architectural decisions change.

---

# 28. Current Product Definition

Photo Vault is NOT:

> another folder-based image viewer.

It is:

> a local-first archival system that turns fragmented Google Photos, iCloud and filesystem exports into one trustworthy, deduplicated, searchable personal photo library while leaving the user in permanent control of the original files.

The key differentiators are:

- export-aware importing
- metadata reconstruction
- cryptographic deduplication
- provenance tracking
- archive verification
- storage independence
- eventual intelligent search
- no proprietary lock-in

The most important thing to get right first is not AI.

It is trust.

The user must be able to give Photo Vault irreplaceable personal photographs and understand exactly what the application has done with them.
---

# 29. Implementation Status (updated 2026-10-23, version 0.15.1)

Milestones 0–5 are implemented, and most of Milestone 6:
- **Import and safety:** resumable imports, library verification, catalogue snapshots and mirror backups.
- **Library:** similar photos, a map, smart search on the device, watched folders, export and rotation.
- **Platform:** a Windows installer that updates itself from the private GitHub repository; CI builds for macOS and Linux.

See `DECISIONS.md` (D1–D88) for reasoning and `readme.md` for commands.

## Architecture as built

- **Desktop:** Electron 44 + React 19 + TypeScript + Vite (electron-vite) + Tailwind 4.
- **Database:** SQLite through Node's built-in `node:sqlite`. Append-only migrations live in `src/core/db/migrations.ts` (v1 initial schema, v2 archives/Takeout/verification, v3 albums, v4 origin/kind/hidden, v5 origin confidence, v6–7 visual fingerprints, v8 dating, v9 bin, v10 backups, v11 Live Photos, v12: sharpness, rotation, watched folders, FTS5 search, smart-search vectors, map index; v13–15 people; v16 edits; v17 tags, smart albums, manual locations; v18 backup drive names; v19 place names; v20 edited versions; v21 automatic descriptions).
- **Worker threads:** `src/main/worker.ts` runs whole-library computations (probable-duplicate grouping) and on-device AI (smart search, faces) on its own read-only connection, so the main process stays responsive. Automatic descriptions use a second instance of the same worker.
- **Distribution:** electron-builder: NSIS installer (self-updating via electron-updater, D76) + portable exe for Windows, unsigned. CI (`.github/workflows/ci.yml`) tests on Windows and packages macOS/Linux.
- **Core:** `src/core` has no Electron dependency and contains all archive logic. The main process handles IPC, the protocol and the window. The renderer is sandboxed and uses a typed preload API.
- **Media in the UI:** served through `pv-media://{thumb|preview|original}/<assetId>`. The renderer never handles filesystem paths.
- **ZIP reading:** yauzl, entries streamed and never extracted to disk paths.

## Schema changes vs §8

- `assets` adds `capture_offset_minutes`, `capture_time_source`, `sort_time`, `sort_day`, `sort_time_source`, `orientation`, `altitude`, `lens_model`, `original_filename`, `thumb_status`, `first_import_id`, `metadata_json` and `description`.
- `files` stores `relative_path` + `storage_location_id` (managed library `root_path = NULL`, so the library can move), plus `verified_at`, `verify_status` and `missing_since`.
- `provenance` is unique on `(asset_id, source_path)` and tracks `first_import_id`, `last_import_id` and `times_seen`. It also stores `container_path` (ZIP), `sidecar_path`, `sidecar_json` (verbatim Takeout JSON) and `album`.
- `imports` adds `sources_json`, `archives_found`, `sidecars_matched` and `hashes_reused`.
- New table `import_items`: one row per media file per import, with source location (`source_root`, `container_path`, `entry_name`), `source_fingerprint`, classification, outcome, file metadata and sidecar data. This is the explainable import log, and the basis for hash reuse and resume.
- New tables `asset_thumbnails` and `verifications`.
- `albums` (kind `user`|`takeout`, `source_key`, cover) and `album_assets`. Takeout albums are rebuilt from `provenance.album`.

## Working now

- Library create/open; folder and ZIP imports (picker or drag-and-drop, several sources at once, ZIPs inside folders).
- Google Takeout: detection, sidecar matching across ZIP volumes, Takeout dates/GPS/descriptions/favourites with documented precedence (D23), album folders recorded, the same photo in album and year folders kept as one asset.
- SHA-256 exact duplicates within an import, against the library and across renamed copies or archives, with full provenance.
- Re-imports skip re-hashing unchanged files; interrupted imports can be resumed; Storage → Verify library re-hashes every original and reports missing/changed files; missing originals are restored by re-importing their source.
- Albums (user albums + recreated Google Photos albums; rename, describe, cover, delete without touching files), Favourites view, multi-select with an action bar, search and filters (type, favourite, year, camera, source) on every grid.
- Windows installer and portable executable (`npm run dist`).
- **Probable duplicates** (Duplicates → Probable): visually identical copies with different bytes (re-saved, resized, WhatsApp-compressed) grouped by perceptual fingerprints, with a suggested copy to keep, "hide the others" and "not duplicates". Burst shots are excluded (future "Similar photos" tier).
- Remaining-time estimates for analysing, copying and verification.
- Every item is labelled with an **origin** (camera, WhatsApp, Telegram, Signal, Messenger, Snapchat, Instagram, TikTok, Facebook, X, screenshot, screen recording, download, shared) and a **kind** (photo, video, GIF-like loop, animated image, sticker), each with human-readable evidence. A **Cleanup** page groups likely clutter for bulk review and **Hide from Photos** (an archive flag; nothing is deleted). Screenshots and screen recordings have their own **Screenshots** view and stay out of the Photos timeline unless turned back on there.
- Undated items in a "No date" section; dates inferred from matching copies and Android media-id file names (labelled estimated, with evidence); manual "Set date" for selections.
- Bin (move/restore; permanent delete via the OS recycle bin, remembered so re-imports skip it), a Hidden page, and bulk selection (shift-click ranges, select a month, Ctrl+A).
- Viewer zoom/pan (wheel, pinch, double-click, keys); multi-select filters with removable badges; favourite from the grid on hover.
- Month-grouped virtualised timeline, lightbox with an info panel (date and its source, description, camera, location, archive path, SHA-256, every source including ZIP and album), favourites, Imports history with per-file reasons, Duplicates centre, Storage, Settings, light and dark themes.

### Added in 0.7

- **Protection:** catalogue snapshots (before upgrades and deletes, daily, after imports); mirror backups to a second drive that are openable libraries, verified, incremental and never overwriting; protection status in Storage.
- **Importing:**
  - Later imports fill in missing dates, places and descriptions on items already in the library.
  - XMP sidecars and iCloud exports (`Photo Details.csv`: dates, favourites, hidden) are read.
  - Live Photos become one item.
  - HEIC is decoded without the Windows codec (libheif/WASM).
- **Watched folders:** new photos in chosen folders are imported automatically.
- **Library:**
  - Similar photos (bursts) with the sharpest shot suggested.
  - "Recently added" order, grouped by import day.
  - Non-destructive rotation.
  - Export of selections and albums: original files, never overwriting, dated.
  - Map: offline country outlines, optional OpenStreetMap, clustering, photos by place.
- **Search:** full-text search via FTS5 trigrams (accent-insensitive, includes folders and albums); **smart search** with CLIP on the device, opt-in, model downloaded once, results best match first.
- **Scale:** a 100k-item performance test (`npm run test:perf`).

### Added in 0.15

- **0.15.1:** filter counts count within the page they sit on (Photos without screenshots and hidden items, one album, one person…), so "2026: 620" no longer stands over a Photos view showing 4.
- **Working on your photos:** a sidebar card with a bar for smart search, descriptions and people while they run; it opens their Settings sections. The viewer closes back into its tile; the smoke test runs in CI (D93).

### Added in 0.14

- **Filters chip** with every filter in one panel, a **filmstrip** and open-from-tile animation in the viewer, Mount cards and status colours on the older pages, and a selection bar that inverts in dark theme (D92).

### Added in 0.13

- **Mount identity:** new logo and app icon, mat-grey and brass palette, Schibsted Grotesk and Fragment Mono bundled, and a grouped sidebar with a safety card and a Videos view (D90).
- **Tidy up hub, one search box (Ctrl K) with people, places, things and albums, a date rail, selection as a brass mount with Undo, and Safety led by the backup state** (D91).

### Added in 0.12

- **Screenshots** have their own view and stay out of the Photos timeline unless turned back on there (D89).

### Added in 0.11

- **Offline mode:** one switch that blocks every internet connection (D87). Models can be loaded from / saved to a folder (D88).
- **Villages** in place names (162k places) and **town names on the offline map** (D86).

### Added in 0.10

- **Protection:** name backup drives and rotate them (each is brought up to date when plugged in); monthly automatic checks of the library and connected drives; one-click catalogue restore (undoable).
- **Updates:** installed copies update themselves from the private repository's Releases (read-only token in Settings).
- **Import:** straight from a phone or camera over USB (Windows), only new files; RAW photos via their embedded preview; iPhone/Takeout edited versions shown as one item with the original behind it.
- **Places:** offline town names (GeoNames) in search, the map, the viewer and trip names.
- **Interface in Portuguese** (Settings → Language).
- **Pets:** Dogs and Cats groups in People (needs smart search).
- **Automatic descriptions:** an on-device model describes each photo; searchable (opt-in, English).
- **Sharing:** an album as a self-contained web page (zip it or upload it to share a link).
- **Print:** A4 PDF photo books, one-per-page prints and contact sheets.

### Added in 0.9

- **Viewer:** stays on the photo you opened (no flicker during background work); right-click menu (copy picture, copy file, open a copy in another app, save a copy, share, edit…).
- **Editing:** non-destructive crop, rotate, flip, light, contrast, colour, warmth and filters; revert any time; save an edited copy.
- **Videos:** HEVC/other undecodable videos get thumbnails via a bundled ffmpeg, and play through a converted copy when Windows can't decode them.
- **People:**
  - Undo any merge.
  - A Faces tab per person (move or remove single faces).
  - Face boxes in the viewer: name a face, or draw a box around a face the scan missed.
  - Videos are scanned too.
- **Memories:** On this day, Trips (named by country, offline) and Big days, plus a slideshow on every grid.
- **Organising:**
  - Tags and captions.
  - Hand-set locations on a map.
  - Smart albums (saved searches).
  - Share (resized copies without location, ready to send).
- **Speed:** person, album and tag filters are fast at any size (41 s → 5 ms on a real library).

### Added in 0.8

- **People:** photos are grouped by the faces in them, on the device, using freely licensed OpenCV models (D60–D62). It is opt-in. You can name, merge and hide people, and correct a group with "Not this person"; corrections are kept. Names are searchable, and all face data can be deleted at any time.

## Not yet

- **Code signing:** skipped by the owner for now (needs a paid certificate); SmartScreen warns on first run.
- **Cloud backup:** the owner chose rotating drives instead (D74).
- **Shared family library:** needs a server or a cloud account; sharing is one-way (web page, D84).
- **Individual pets** (which dog is which) and **people recognition beyond the free OpenCV models** (owner's choice to keep the free model).
- **Other:** real RAW development (only the embedded preview is used); AAE edits are not re-applied (the phone's own edited JPEG is used); Mac/Linux builds are packaged by CI but untested on those systems; a "keep another physical copy" option for duplicates.
