# Photo Vault 1.0

What has to be true before Photo Vault is called 1.0. The features are in place (0.15.1); 1.0 is about trust: the app never leaves you stuck, your work is not locked inside it, and recovery is proven, not assumed.

Tick an item only when its **Done when** holds. Items marked **(you)** need the owner; everything else is build work.

## Decisions first

These change the scope below, so they come first.

- [x] **Platforms.** Windows only for 1.0. The Mac and Linux builds keep compiling in CI and stay "untested" in the readme. *(Decided 2026-10-23.)*
- [x] **Code signing.** Later: not needed for the owner's own use; decide before inviting anyone else to install it (without a certificate Windows warns "unknown publisher"). *(Decided 2026-10-23.)*
- [x] **Metadata format.** XMP sidecar files next to each original, plus one JSON export of the whole catalogue (see Must-have 2). *(Decided 2026-10-23.)*

## Must-have

### 1. Crash recovery

Today nothing catches an unexpected error: a bug in a page leaves a blank window until the app is restarted, and a crashed background process leaves no trace.

- [x] A "Something went wrong" screen with Reload instead of a blank window, for any page.
- [x] Main-process errors and crashed windows or workers are written to the log with what was happening.
- [x] Background work (imports, backups, checks, smart search, descriptions, people) resumes after a crash or restart without losing progress.

**Done when** a deliberately thrown error in a page, in the main process and in a worker each produce a log entry and a recoverable app, checked by a test. *Done 2026-10-23: the smoke test crashes all three and checks the log and the recovery (D95).*

### 2. Your data outside the app

Originals are plain files. Albums, dates and places set by hand, people's names, tags, favourites, hidden flags and descriptions live only in the catalogue database.

- [x] Write that metadata as XMP sidecars next to the originals and as one JSON export of the catalogue, and keep both current as it changes.
- [x] Backups carry it too, so a backup drive alone is a complete, app-independent archive.
- [x] A short document describing the library folder layout and the metadata files: [docs/LIBRARY_FORMAT.md](docs/LIBRARY_FORMAT.md).

**Done when** a library copied to another computer can be read by another photo program with its dates, places, albums and people intact, checked on a sample with digiKam or exiftool. *Built 2026-10-23 (D96): the sidecars are read back by an independent XMP reader (exifr) in the unit tests, and the smoke test checks every original gets one. Still to do: open a copy of the real library in digiKam or exiftool once (you).*

### 3. Recovery drill

Backups and catalogue snapshots are well tested in code (`tests/backup.test.ts`, `tests/protection.test.ts`). The full story has never been run end to end.

- [x] The smoke test loses the library, opens the backup drive in a fresh install, and finds every photo, album and date there.
- [x] The same for restoring a catalogue snapshot from the Safety page.

**Done when** both run in CI on every push. *Built 2026-10-23 (D97); the drill found and fixed two real problems: thumbnails never came back in a recovered library, and a recovered library claimed to be protected by itself.*

### 4. Release notes and help

- [x] Each release lists what changed, from the handoff's "Added in" notes, instead of just the version number: [CHANGELOG.md](CHANGELOG.md), shown on each release page and in the app.
- [x] A short user guide (in the app or the repository): importing, backups and backup drives, what "probably received" means, hiding versus the Bin, moving to a new PC, and what smart search and descriptions do: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) (and in Portuguese), shown in the app under Guide.

**Done when** someone who has never seen the app can set up a backup from the guide alone. *Built 2026-10-23 (D98). Its backup steps were written against the app's own buttons and messages, and the smoke test follows the same steps. Still to do: have someone who has never used the app try it (you).*

### 5. A real library is protected (you)

- [ ] A backup drive is added in Safety and its first copy has finished.
- [ ] Smart search and descriptions have finished their first pass.

**Done when** the sidebar says "Protected" instead of "No backup yet".

## Should-have

- [x] **Keyboard and screen reader pass.** The whole app is usable without a mouse, and Windows Narrator reads the main views sensibly. *Done 2026-10-23 (D99): `npm run test:a11y` checks every page with axe-core and the grid, viewer, dialogs and menus by keyboard, in CI. Still to do: listen to the main views with Narrator once (you); the audit checks names and roles, not how they sound.*
- [x] **People, Memories and Albums design pass.** They have the new colours and fonts but not the layout care given to Photos and Tidy up. *Done 2026-10-23 (D101), checked against a real library in both themes.*
- [x] **Accessibility of colour.** Every status (safe, attention, damaged) also has an icon and a word, and every text colour meets 4.5:1 in both themes (the design system already specifies this; it needs checking in the app). *Done 2026-10-23 (D100): the audit fails on any contrast problem, in both themes, in CI.*

## Not in 1.0

From the handoff notes, by the owner's earlier choice:

- Shared family library (sharing stays one-way, as a web page).
- Real RAW development (the camera's embedded preview is used).
- Re-applying iPhone `.AAE` edits (the phone's own edited copy is used).
- Telling individual pets apart.
- Cloud backup (rotating drives instead, D74).

## Order

1. Decisions.
2. Crash recovery (small, protects everything else).
3. Your data outside the app (the largest piece).
4. Recovery drill.
5. Release notes and help.
6. Should-haves, as time allows.
7. Release 1.0 once the must-haves are done and a real library is protected.
