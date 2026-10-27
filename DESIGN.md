---
name: Photo Vault
description: A calm, conventional photos app for a permanent library on your own drives.
colors:
  mat: "#f8f9fa"
  shelf: "#f1f3f4"
  card: "#ffffff"
  line: "#dadce0"
  line-strong: "#80868b"
  ink: "#1f1f1f"
  ink-muted: "#5f6368"
  ink-faint: "#686c71"
  on-ink: "#ffffff"
  brass: "#1a5fd6"
  brass-hover: "#1a56c7"
  brass-ink: "#1a56c7"
  brass-soft: "#e8f0fe"
  on-accent: "#ffffff"
  safe: "#137333"
  safe-soft: "#e6f4ea"
  risk: "#c5221f"
  risk-soft: "#fce8e6"
  warn: "#a35200"
  warn-soft: "#fef3d9"
  mat-dark: "#131314"
  shelf-dark: "#1b1c1e"
  card-dark: "#232427"
  line-dark: "#34363a"
  line-strong-dark: "#7c8086"
  ink-dark: "#e8eaed"
  ink-muted-dark: "#a8acb2"
  ink-faint-dark: "#979ba1"
  on-ink-dark: "#131314"
  brass-dark: "#a8c7fa"
  brass-hover-dark: "#c2d7fb"
  brass-ink-dark: "#a8c7fa"
  brass-soft-dark: "#1c2b45"
  on-accent-dark: "#0b1d3a"
  safe-dark: "#81c995"
  safe-soft-dark: "#193323"
  risk-dark: "#f28b82"
  risk-soft-dark: "#3d1e1c"
  warn-dark: "#fdd663"
  warn-soft-dark: "#3a2d0a"
  control-fill-dark: "#2d2e31"
typography:
  display:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 700
    lineHeight: "48px"
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: "32px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 650
    lineHeight: "24px"
    letterSpacing: "-0.01em"
  wordmark:
    fontFamily: "'Segoe UI Variable Display', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  dialog-title:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  control:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
  body:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.625
  caption:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: "18px"
  label:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: "14px"
    letterSpacing: "0.07em"
  count:
    fontFamily: "'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    fontFeature: "'tnum'"
  mono:
    fontFamily: "'Cascadia Mono', Consolas, ui-monospace, monospace"
    fontSize: "11.5px"
    fontWeight: 400
rounded:
  tile: "2px"
  tile-selected: "6px"
  control: "8px"
  feature: "12px"
  card: "14px"
  dialog: "16px"
  pill: "9999px"
spacing:
  grid-gap: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  card: "20px"
  dialog: "24px"
  gutter: "28px"
  gutter-document: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.brass-hover}"
  button-primary-dark:
    backgroundColor: "{colors.brass-dark}"
    textColor: "{colors.on-accent-dark}"
  button-primary-hero:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.feature}"
    padding: "0 24px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-secondary-dark:
    backgroundColor: "{colors.control-fill-dark}"
    textColor: "{colors.ink-dark}"
  button-ghost:
    textColor: "{colors.ink-muted}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-danger:
    backgroundColor: "{colors.risk}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  nav-item:
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  nav-item-active:
    backgroundColor: "{colors.brass-soft}"
    textColor: "{colors.brass-ink}"
  segment-selected:
    backgroundColor: "{colors.brass-soft}"
    textColor: "{colors.brass-ink}"
    rounded: "{rounded.control}"
    height: "40px"
  filter-chip:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  filter-chip-active:
    backgroundColor: "{colors.brass-soft}"
    textColor: "{colors.brass-ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "32px"
  filter-badge:
    backgroundColor: "{colors.brass-soft}"
    textColor: "{colors.brass-ink}"
    rounded: "{rounded.pill}"
    padding: "0 4px 0 12px"
    height: "28px"
  input:
    backgroundColor: "{colors.shelf}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  dialog:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.dialog}"
    width: "420px"
  photo-tile:
    backgroundColor: "{colors.shelf}"
    rounded: "{rounded.tile}"
  photo-tile-selected:
    backgroundColor: "{colors.brass-soft}"
    rounded: "{rounded.tile-selected}"
  selection-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.card}"
    padding: "6px 6px 6px 8px"
---

# Design System: Photo Vault

## Overview

**Creative North Star: "The Category Standard, Played Straight"**

Photo Vault looks like it belongs beside Google Photos, Apple Photos, Windows Photos and Lightroom, and is held to their craft. The visitor should recognise a photos app they already know how to use: a neutral grey sidebar, a near-white ground, photos laid edge to edge like a contact sheet, and one blue accent that only ever says "this is selected", "you are here" or "this is the thing to do". Nothing is themed. The photos are the colour; the interface stays out of their way.

The system is built from Windows 11's own materials: Segoe UI Variable for every word, cool neutral greys with no tint, white cards on a pale ground in light and lifted charcoal cards on near-black in dark. Density is desktop-comfortable (34 px navigation rows, 32 to 36 px controls, 13 to 13.5 px text) because sessions are long: importing, tidying, browsing years of photos. Status colour is reserved for the one question the product exists to answer, whether the photos are safe: green for protected, amber for needs attention, red for damage.

The earlier "Mount" look (mat-grey ground, brass accent, photo-mount logo) is retired. Its token names survive in code (`brass`, `mat`, `shelf`), but they now carry the blue accent and the neutral greys; read the name as a role, never as a colour.

**Key Characteristics:**
- Neutral cool greys, white cards, one confident blue accent; dark theme flips the accent to light blue with dark text.
- System type only: Segoe UI Variable Display for titles, Segoe UI Variable Text for everything else, tabular figures for counts.
- Photos edge to edge (2 px gaps, 2 px corners); chrome recedes, the library leads.
- Flat surfaces separated by tone and hairlines; shadows only on things that float.
- Every text pair meets WCAG 2.1 AA in both themes, enforced in CI.

## Colors

A neutral, untinted grey world with a single blue voice and three status colours that speak only about safety.

### Primary
- **Vault Blue** (`brass`): the solid accent fill. The view's one primary action and the sidebar's Import button carry it, with white text (`on-accent`). Also the progress bars, the active-month tick on the date rail, and the selected tile's check disk. Hover darkens it (`brass-hover`).
- **Vault Blue, dark theme** (`brass-dark`): in dark the fill becomes a light blue with deep navy text (`on-accent-dark`); hover lightens (`brass-hover-dark`). The always-dark surfaces (viewer, editor, slideshow) use this light blue for focus in both themes.
- **Accent Ink** (`brass-ink`, `brass-ink-dark`): the accent as text and icon colour: the current page's label, the selected segment's label, links, and every focus ring.
- **Soft Accent Ground** (`brass-soft`, `brass-soft-dark`): the pale blue (dark: deep navy) behind the current navigation item, a selected segment, a selected tile, filter badges and accent icon wells.

### Neutral
- **Page Ground** (`mat`): the near-white ground of every page and the sticky page header (at 85% with a strong backdrop blur). Dark: `mat-dark`, near-black.
- **Sidebar Grey** (`shelf`): the sidebar, photo tiles before they load, the search field at rest, text inputs and neutral control fills. Dark: `shelf-dark`.
- **Card White** (`card`): cards, popovers and the open search panel. In dark, cards (`card-dark`) sit lighter than the ground, so depth reads by tone.
- **Hairline** (`line`): 1 px borders on cards, popovers and the sidebar edge; at 60% it is the neutral hover wash for navigation rows. **Strong Hairline** (`line-strong`): hovered card borders and unticked checkboxes.
- **Ink** (`ink`): primary text. **Muted Ink** (`ink-muted`): subtitles, counts, icons at rest, group labels. **Faint Ink** (`ink-faint`): the quietest text, tuned to hold 4.5:1 on the sidebar and the ground.
- **On Ink** (`on-ink`): text on inverted surfaces, such as the selection bar and the date-rail tooltip, which use `ink` as their ground.
- **Dark Control Fill** (`control-fill-dark`): neutral button and segment fill in dark (light uses `shelf`).

### Status
- **Safe** (`safe` on `safe-soft`): protected, verified intact, offline-ready.
- **Needs Attention** (`warn` on `warn-soft`): items without a backup copy, a stopped check. Amber.
- **Damage** (`risk` on `risk-soft`): missing or changed originals, permanent deletion. The destructive button is `risk` with white text.

Tailwind's `stone`, `accent`, `red`, `emerald` and `amber` scales are remapped in `@theme` to these same greys, blues and status hues, so older views written with raw scale utilities land in the same world. New work uses the semantic tokens.

### Named Rules
**The One Fill Rule.** A view shows one solid blue fill: its primary action. The sidebar's Import button is the standing exception. Secondary actions are neutral (grey fill or ghost), never a second blue fill.

**The Soft Selection Rule.** Being chosen is shown with the soft accent: the current page, a selected segment, a selected tile, an active filter badge. Solid blue is for doing, soft blue is for being.

**The Amber Means Attention Rule.** Amber appears only when the user's photos need something (a missing backup, a missing file). It is never decoration, brand, hover or highlight.

**The No Tint Rule.** Greys are cool and neutral (Google-grey family). No warm stone, no green-black, no brass.

## Typography

**Display Font:** Segoe UI Variable Display (with Segoe UI Variable, Segoe UI, system-ui)
**Body Font:** Segoe UI Variable Text (with Segoe UI Variable, Segoe UI, system-ui)
**Mono Font:** Cascadia Mono (with Consolas, ui-monospace)

**Character:** Windows 11's own voice, nothing bundled. The Display optical size gives titles a tighter, heavier presence; the Text size keeps dense lists legible at 12 to 14 px. The pairing is the operating system's, which is the point: the app should feel native.

### Hierarchy
- **Display** (700, 44 px, 48 px line, -0.025em): the Welcome screen's one sentence. Nowhere else.
- **Headline** (700, 26 px, 32 px line, -0.015em): page titles (Photos, People, Safety, Settings), in the same position on every page so moving between pages does not shift the title.
- **Title** (650, 19 px, 24 px line, -0.01em): month headers in the timeline, section titles on browsing pages, the safety statement.
- **Wordmark** (Display, 700, 17 px, -0.02em): "Photo Vault" beside the mark in the sidebar.
- **Dialog title** (Text, 600, 17 px): the title of a modal.
- **Control** (500, 13.5 px): navigation rows (650 when current), buttons, segments.
- **Body** (400, 13 px, relaxed 1.625): explanatory text in cards and dialogs; card titles step up to 14 px at 500. Keep paragraphs under about 42rem (max-w-2xl).
- **Caption** (400, 12.5 px, 18 px line): page subtitles and filter chips, in muted ink.
- **Label** (650, 11 px, 14 px line, 0.07em, uppercase): navigation group names in the sidebar ("Collections", "Look after") and section names in the Filters panel only.
- **Count** (tabular figures): every number that sits beside a label or updates live: item counts, progress, sizes.
- **Mono** (Cascadia Mono, 11 to 11.5 px): SHA-256 hashes, file paths, inline code in the Guide, error text.

### Named Rules
**The Native Voice Rule.** Only system faces. No web fonts are bundled or loaded; the app works offline and looks like Windows.

**The Tabular Count Rule.** Numbers that can change or line up use tabular figures, so counts do not jitter as they update.

**The Mono Means Machine Rule.** Monospace is for things a machine produced (hashes, paths, code, errors), never for labels, numbers or decoration.

## Layout

A desktop window with a fixed 232 px sidebar on the left and a single scrolling content column. The sidebar holds the mark and wordmark, three navigation groups, and, at the foot, background work, the safety card and the Import / Guide / Settings row. Its top 28 px is a window drag strip.

Browsing pages (Photos, People, Albums, Tidy up) run full width with a 28 px gutter, under a sticky header on the page ground at 85% with a strong blur. Headers reserve 160 px on the right because Windows draws the minimise / maximise / close buttons over the top-right corner (the overlay is 44 px tall; full-height scrollbars start below it). Document pages (Settings, Safety) center a column of at most 896 px (max-w-4xl) with a 32 px gutter and a taller header.

The timeline is a virtualised contact sheet: square tiles at the user's chosen size, 2 px apart, grouped under 60 px month header rows, with a date rail on the right edge for jumping. Selection opens a floating bar centered at the bottom of the content area.

Spacing runs on a 4 px base: 8 and 12 px inside controls, 16 px between cards, 20 px card padding, 24 px dialog padding, 18 px between sidebar groups. The window is the breakpoint: there is no mobile layout.

## Elevation & Depth

Flat by default. Depth is tonal: ground (`mat`) under sidebar (`shelf`) under card (`card`), with 1 px hairlines where surfaces meet. In dark the order holds by lightening, so cards read above the ground without shadow.

Shadows belong only to things that float above the page: popovers and menus, the search panel when open, dialogs, the selection bar and toasts. Hero calls to action on empty states carry a faint small shadow. Dialogs in dark add a 10% white ring, because shadows vanish on near-black.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 6px 20px rgba(32,33,36,0.12)`): filter panel, search panel, menus anchored to a control.
- **Floating** (Tailwind `shadow-2xl`, tinted near-black at 20 to 30%): dialogs and the selection bar.
- **Lift** (Tailwind `shadow-sm`): the large primary button on an empty state.

### Named Rules
**The Float Only Rule.** A surface casts a shadow only if it floats over content. Cards in the page flow are flat with a hairline.

## Shapes

Gentle, consistent corners that scale with the object. Photo tiles are almost square-cornered (2 px), so the grid reads as prints laid edge to edge; a selected tile pulls in (to 86%) and rounds to 6 px, showing the soft accent around it. Controls, inputs, chips and navigation rows are 8 px. Feature wells and hero buttons are 12 px. Cards, popovers and the selection bar are 14 px. Dialogs are 16 px. Selection checks, the favourite button and filter badges are fully round.

The mark is a circle: a six-blade camera aperture whose opening is a keyhole (photography and safekeeping in one shape). The blades run through six colours (blue, green, yellow, orange, pink, violet), the one place the identity is multicoloured, as the category's icons are; the interface itself keeps one blue. At 48 px and up the app uses the full icon (shaded swirled blades, light from above, a contact shadow); at 32 px and below a separate simplified drawing (flat blades, a wider centre, a bold keyhole) keeps it crisp in the taskbar and title bar. `Mark` shows these same files: the small drawing in the sidebar (24 px), the full icon on Welcome (72 px).

## Components

### Buttons
Quiet and familiar: Windows-sized, never shouty.
- **Shape:** gently rounded (8 px), 36 px tall; compact 32 px in toolbars; hero 44 px with 12 px corners on empty states and Welcome.
- **Primary:** Vault Blue fill, white text (dark: light blue, navy text), 16 px side padding, 13 to 13.5 px at 500. One per view.
- **Hover / Focus:** hover darkens the fill (dark: lightens); press scales to 97 to 98%. Focus is a 2 px accent-ink outline offset 2 px.
- **Secondary:** neutral grey fill (`shelf`; dark `control-fill-dark`), ink text, hover one step darker.
- **Ghost:** no fill, muted ink, grey wash on hover. Cancel in dialogs.
- **Danger:** red fill, white text, only for permanent deletion; Cancel takes focus first.

### Chips
- **Style:** filter chips are 32 px, 8 px corners, a translucent grey fill and 12.5 px text with a 14 px icon.
- **Active:** a chip that is on (a sort other than date taken, Favourites, Videos, or Filters with picks) takes the soft accent with semibold accent-ink text, like every other selection; never the solid fill.
- **Badges:** active filters appear underneath as removable pills in the soft accent (28 px, fully round, accent-ink text, an x button).

### Cards / Containers
- **Corner Style:** 14 px.
- **Background:** `card` on the page ground; in the sidebar the safety and import-progress cards sit on `shelf`.
- **Shadow Strategy:** none; see Elevation.
- **Border:** 1 px `line`, `line-strong` on hover when the card is a button; the current card takes a blue border.
- **Internal Padding:** 20 px on pages, 12 px in the sidebar. Icon wells (40 to 48 px, 8 to 12 px corners) carry a soft status or accent ground.

### Inputs / Fields
- **Style:** 40 px, 8 px corners, `shelf` fill, no border, 14 px text.
- **Focus:** a 2 px blue ring. The search field rests on `shelf` with a transparent border, and on focus turns `card` with an accent-ink border; open, it gains the popover shadow and its panel drops 4 px into place.
- **Choice lists:** checkboxes are 16 px squares, `line-strong` border at rest, solid blue with a white tick when on.

### Navigation
- **Sidebar rows:** 34 px, 8 px corners, 17 px outline icons (stroke 1.75) in muted ink, labels at 13.5 px / 500. Hover is a 60% hairline wash.
- **Current page:** soft accent ground, accent-ink icon and label at 650, `aria-current="page"`. Pages opened from another (Duplicates from Tidy up) keep their parent highlighted.
- **Groups:** separated by 18 px, named with the small uppercase label.

### Segmented choices
Theme and language in Settings: equal-width 40 px segments, 8 px gap. Unselected segments are neutral grey; the selected one takes the soft accent ground with accent-ink text at 600.

### Photo Tile (signature)
A square on `shelf` with 2 px corners. Thumbnails "develop" in: they arrive blurred (9 px) and 6% enlarged, then sharpen over 420 ms; reduced motion keeps only a short fade. On hover a top gradient appears with a round select check (22 px, white outline); while anything is selected the checks stay visible. Selected: the tile ground turns soft accent, the image insets to 86% with 6 px corners, and the check becomes a solid blue disk with a ground-coloured ring. Video duration, LIVE and hidden markers are small translucent black badges with a backdrop blur.

### Selection Bar (signature)
A floating capsule at the bottom center: the inverted ink ground (`ink` at 95%: dark in light theme, light grey in dark), on-ink text, 14 px corners, floating shadow. It reads "N selected" in tabular figures, then ghost actions (Favourite, Add to album, Share, Hide, Bin, More) at 36 px. Its menus open upward on the same inverted ground.

### Dialog
420 px wide, 16 px corners, 24 px padding, over a 30% near-black scrim (50% black in dark) with a 4 px backdrop blur; it rises 8 px into place. Dialog title, a short muted explanation, then right-aligned actions: ghost Cancel, then the one primary (or danger).

### Always-dark surfaces
The viewer, editor and slideshow are dark in both themes and carry the `dark-surface` class, which switches focus outlines to the light blue so they stay visible.

## Do's and Don'ts

### Do:
- **Do** use the semantic tokens (`mat`, `shelf`, `card`, `line`, `ink`, `brass`, `brass-ink`, `brass-soft`, `safe`, `warn`, `risk`) in new work; they switch with the theme.
- **Do** give each view exactly one solid blue fill, its primary action; make everything else neutral.
- **Do** show selection and the current place with the soft accent ground and accent-ink text.
- **Do** keep amber for "needs attention" and say plainly whether photos have a second copy.
- **Do** set titles and the wordmark in Segoe UI Variable Display (17, 19, 26 or 44 px) and everything else in Segoe UI Variable Text.
- **Do** use tabular figures for every count, size and progress number.
- **Do** add `dark-surface` to any surface that stays dark in both themes.
- **Do** run `npm run test:a11y` (axe-core, both themes) before shipping a colour or text change; every text pair must hold WCAG 2.1 AA.
- **Do** use the `Mark` component for the logo; it picks the full icon at 48 px and up and the small drawing below.

### Don't:
- **Don't** bring back the Mount look: no mat-and-brass palette, no brass or gold, no photo-mount frame logo.
- **Don't** read `brass` as a colour; it is the blue accent's historical name. Never add anything brass- or gold-coloured.
- **Don't** put a second solid blue button in a view, or use solid blue to show a selected state.
- **Don't** use amber, green or red as decoration, brand colour or hover.
- **Don't** tint the greys warm or green; no hardcoded Tailwind default stone values.
- **Don't** bundle or load web fonts, and don't use monospace outside hashes, paths, code and errors.
- **Don't** round photo tiles beyond 2 px or pad the grid; photos sit edge to edge.
- **Don't** give in-flow cards a shadow.
- **Don't** redraw the mark at small sizes from the large icon; 32 px and below use the separate small drawing.
