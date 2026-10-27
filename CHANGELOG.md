# What's new in Photo Vault

Each version's notes are shown on its release page and in the app (Guide → What's new). The release script refuses to publish a version that has no section here.

## 0.16.2 (2026-10-27)

- Fixed: installed copies could not check for updates at all, because the update module failed to load. Copies that seemed stuck on an older version were affected. From this version on, Settings → Updates → Check now works, and the release process checks it before publishing.

## 0.16.1 (2026-10-27)

- **Updates need no token.** Photo Vault is now open source (MIT licence) and its releases are public, so installed copies find new versions on their own. A token saved in Settings → Updates is still used, but no longer needed.
- Fixed: two catalogue snapshots taken in the same instant could overwrite each other.

## 0.16.0 (2026-10-23)

- **If something goes wrong, the app recovers.** A page that fails shows "Something went wrong" with a way back instead of a blank window, and the rest of the app keeps working. Crashes are written to the library's log, and background work (smart search, descriptions, people) restarts on its own.
- **Your edits live outside the app too.** Dates, places, favourites, descriptions, tags, albums and people are written next to each photo in a small `.xmp` file that other photo programs (digiKam, Lightroom, darktable) can read, and the whole catalogue is saved as one file in `metadata/catalogue.json`. Backups carry both. The first start writes them for every photo, which takes a few minutes on a large library.
- **Recovery is proven.** Every change is now tested by deleting a library and opening its backup drive in a fresh install. That found and fixed two problems: thumbnails did not come back in a recovered library, and a library opened from its backup drive said it was protected by itself.
- **A guide in the app.** The ? button next to Settings explains importing, backups, hiding and the Bin, moving to a new computer and the AI features, with What's new for each version.
- **Works without a mouse.** Arrow keys move through photos, Enter opens one, Space selects. Dialogs and the viewer keep the keyboard inside them and return you where you were. Every photo and button has a name for screen readers such as Narrator. Fixed on the way: opening a photo with Enter closed it again at once.
- **Easier to read.** Grey text is darker in light theme and every text colour meets the 4.5:1 contrast standard in both themes. Buttons no longer turn dark on dark when hovered in dark theme.
- **People, Memories and Albums tidied up.** They line up with Photos; People is split into Named and Not named yet; a person's page says Rename, Merge and Hide in words; trip cards no longer cut off their photo counts.

## 0.15.1 (2026-10-23)

- **Filter counts match the page you are on.** Counts in the Filters panel now count only what that page shows (Photos without screenshots and hidden items, one album, one person…), so "2026: 620" no longer sits over a Photos view showing 4.

## 0.15.0 (2026-10-23)

- **See the AI work in progress.** While smart search, descriptions or people are working through your photos, a card in the sidebar shows how far along they are. Click it to open their settings.
- **The viewer closes back into its photo.** Closing a photo shrinks it back into its place in the grid.

## 0.14.0 (2026-10-23)

- **All filters in one place.** A Filters button on every grid opens one panel with every filter, each with its count.
- **Filmstrip in the viewer.** A strip of the neighbouring photos under the open one; photos open from their tile.
- **Older pages restyled** in the new look, and the selection bar reads well in the dark theme.

## 0.13.0 (2026-10-23)

- **A new look.** New logo and app icon, calmer colours, new fonts (included, so nothing is downloaded), and a sidebar in three groups.
- **Videos** have their own page.
- **Tidy up** gathers everything worth reviewing together (chat-app media, screenshots, duplicates, similar shots, hidden items), biggest first.
- **One search box (Ctrl K)** finds people, places, things and albums.
- **A date rail** beside the timeline jumps to any year.
- **Undo** after favouriting, hiding or moving to the Bin.
- **Safety** opens from a card in the sidebar that says whether your photos have a backup.

## 0.12.0 (2026-10-22)

- **Screenshots stay out of Photos.** Screenshots and screen recordings have their own page and are no longer mixed into the Photos timeline. You can turn them back on there.

## 0.11.1 (2026-10-22)

- Fixed: a photo looked blurry when opened a second time.
- Fixed: the scrollbar ran under the window buttons.

## 0.11.0 (2026-10-10)

- **Offline mode.** One switch in Settings blocks every internet connection the app could make.
- **AI models from a folder.** Save the downloaded models to a USB stick and load them on a computer that is never online.
- **Villages** in place names, and town names on the offline map.

## 0.10.0 (2026-10-09)

- **Backup drives you can rotate.** Name your backup drives; each is brought up to date when plugged in. Keep one away from home and swap them now and then.
- **Monthly checks** of the library and of connected backup drives, without you having to remember.
- **Undoable catalogue restore** in one click.
- **Automatic updates** from the private repository (needs a read-only token in Settings).
- **Import from a phone or camera** over USB, copying only what is new. RAW photos, and edited versions shown as one photo with the original behind it.
- **Town names** everywhere, offline.
- **Portuguese** (Settings → Language).
- **Dogs and cats** in People.
- **Automatic descriptions** of each photo, written on this computer and searchable.
- **Share an album as a web page**, and **print** photo books, prints and contact sheets as PDFs.

## Earlier versions

- **0.9:** photo editing (crop, rotate, light, colour; the original is never changed), naming faces in the viewer, Memories (On this day, Trips, Big days), slideshows, tags, captions, hand-set locations, smart albums and sharing resized copies.
- **0.8:** People: photos grouped by face, on this computer, opt-in.
- **0.7:** backup drives, catalogue snapshots, watched folders, Live Photos, HEIC, similar photos, the map and smart search.
