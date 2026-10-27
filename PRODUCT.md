# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop app built with Electron (React + Vite + Tailwind). Windows is the supported platform for 1.0; macOS and Linux builds compile in CI and are untested.

## Users

People who have outgrown a cloud photo service (Google Photos, iCloud) and are moving their photos onto their own drives: they hold Google Takeout ZIPs, iCloud exports, phone backups and scattered folders, often with duplicates and unreliable dates, and want one permanent library they control. Since 2026-10-27 the app is public and open source, so the audience includes strangers who find it on GitHub and install it, not only the maintainer and family.

## Product Purpose

Turn messy photo exports into a permanent, organised, searchable library of ordinary files on the user's own drive, and keep it safe: exact-duplicate detection by SHA-256, every source a photo came from remembered, dates and places recovered from export metadata, verified backups to other drives, and a pleasant timeline to browse it all. Success is a user who can delete the cloud copy without worry, because they know every photo is here, intact and backed up.

## Positioning

Local-first and format-free: originals stay byte-for-byte as ordinary files in a folder the user chooses, everything added in the app is also written in open formats (XMP sidecars, a JSON catalogue), and the library is readable without the app. All AI (smart search, descriptions, faces) runs on the device; nothing is uploaded. Safety is proven, not assumed: verified backups, catalogue snapshots and a recovery drill run on every change.

## Operating Context

A Windows desktop with one or more large drives; libraries of tens of thousands of photos and videos; imports from Takeout ZIPs, folders and phones over USB; backup drives plugged in now and then and rotated off-site. Used over long sessions (importing, tidying, browsing years of photos), in light and dark themes, in English or Portuguese.

## Capabilities and Constraints

- Import from folders, ZIP archives (Google Takeout) and phones; duplicates and sources recorded; nothing in the sources is changed.
- Timeline, Memories (on this day, trips, big days), People (on-device faces), Places (offline map), Albums and smart albums, Favourites, Screenshots, Videos, Tidy up (chat-app clutter, duplicates, similar shots), Bin.
- Safety: backup drives, monthly integrity checks, catalogue snapshots, XMP and JSON export.
- Installer and auto-updates from the public GitHub releases; not code-signed (SmartScreen warns on first run).
- Interface in English and Portuguese; keyboard and screen reader support; WCAG 2.1 AA contrast in both themes (checked in CI).
- The name "Photo Vault" also lives in the repository `raullopesalves/photovault`, the library marker `photovault-library.json` and the XMP namespace URL, which must not change for existing libraries.

## Brand Commitments

- Name: "Photo Vault", kept (decided 2026-10-27).
- Standing preference (2026-10-27): the category standard, played straight. Photo Vault should sit alongside Google Photos, Apple Photos, Windows Photos and Adobe Lightroom, and match their craft: conventional photos-app look and controls, no novelty world. The earlier "Mount" look (mat grey, brass accent, photo-mount logo) is replaced.

## Evidence on Hand

- The app itself, its user guide (`docs/USER_GUIDE.md`), changelog and library format document.
- No testimonials, users, download counts or press. Do not invent any.
- Open source under the MIT licence.

## Product Principles

1. The photos are the user's: ordinary files, open formats, readable without the app.
2. Safety first: say plainly whether photos have a second copy, and never delete or change anything without the user's decision.
3. Private by design: everything, including AI, happens on the user's own computer.
4. Calm over clever: long sessions with years of memories deserve a quiet, trustworthy tool.

## Accessibility & Inclusion

WCAG 2.1 AA in both themes, full keyboard use and screen reader names (audited in CI with axe-core); English and Portuguese.
