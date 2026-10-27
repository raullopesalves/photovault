---
version: 1
slug: "src-renderer-src-app-tsx"
primary_target: "src/renderer/src/App.tsx"
related_targets: ["src/renderer/src/styles.css","build/icon.svg","src/renderer/src/components/Mark.tsx"]
---

# Photo Vault identity (app shell, icon, logo)

Scope: the whole desktop app's identity: app icon (installer, taskbar, desktop, Start menu, window), in-app logo and wordmark, colour tokens and type across every page. Mode: Operate. Audience: people moving their photos off Google Photos or iCloud onto their own drives; strangers who find it on GitHub. Constraints: name "Photo Vault" kept; WCAG AA contrast in both themes (CI audit); works offline; Windows 11 first.

## Direction contract

THESIS: The category standard, played straight: Photo Vault looks like it belongs next to Google Photos, Apple Photos, Windows Photos and Lightroom, at their craft. It refuses the costume of a themed world (the old mat-and-brass "Mount") and any novelty that makes a safety tool look like a toy.

OWN-WORLD: Neutral cool greys with no tint, white cards, one confident blue accent (fills with white text in light, a light blue with dark text in dark), amber reserved for "needs attention", green for safe, red for damage. Windows 11's own type (Segoe UI Variable, Display for titles), numbers in tabular figures, no monospace except for hashes and paths. The mark: a six-blade camera aperture in six colours whose opening is a keyhole (chosen by the owner from five options).

STORY: A visitor sees a photos app they already know how to use, and a calm, trustworthy one: the colour tells them only what is selected and whether their photos are safe.

FIRST VIEWPORT: Unchanged shell: sidebar (neutral grey) with the round mark and "Photo Vault" wordmark top left, navigation, the safety card and Import at the foot; the photo grid on a near-white ground; selection and the active page in blue.

FORM: canon (category standard), chosen by the owner over the dealt directions. seed:60ecdd372f0bb0eb

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
