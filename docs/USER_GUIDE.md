# Photo Vault guide

Photo Vault keeps your photos and videos as ordinary files in a folder you choose, on your own computer. Nothing is uploaded anywhere. This guide covers what you need to know to keep them safe.

## Your library

The **library** is one folder that holds everything: the photos and videos (in `originals`, by year and month), the catalogue with your albums, people and dates, and copies of that catalogue. Put it on a drive with plenty of space. Photos are copied in, never moved, and the files are never changed.

You can open the folder in Windows Explorer at any time and find every photo there. Next to each photo is a small `.xmp` file with its date, place, tags, albums and people, which other photo programs can read.

## Importing photos

Click **Import** at the bottom of the sidebar and choose where the photos are:

- **Folder…** for photos on a disk, a memory card or a copy of a phone backup.
- **ZIP archives…** for Google Takeout or any other ZIP. Select all the parts at once.
- **Phone or camera…** for a phone or camera connected by USB. Only new photos are copied.

Photo Vault first looks at everything **without copying anything**. It then shows what it found: how many items are new, how many you already have, and how many repeat within the import. Click **Import** to copy the new ones. The folders and ZIP files you import from are never changed or deleted.

A photo you already have is recognised by its contents, whatever its name, so importing the same things twice is safe: nothing is copied twice. Google Takeout's dates, places, descriptions, favourites and albums are read too.

To import new photos automatically, add a **watched folder** in **Import → Past imports**.

## Backups

Your library is the only copy of your photos until you add a backup. If the drive it is on fails, is stolen or is lost in a fire, everything in it is gone. The card at the bottom of the sidebar shows whether your photos have a backup: **No backup yet**, **Protected**, or how many items are still without one.

### Setting up a backup drive

1. Plug in an external drive. It should be a different drive from the one the library is on.
2. Click the safety card at the bottom of the sidebar. The **Safety** page opens.
3. Click **Add backup location** and choose the external drive, or a folder on it. If the drive already has other files on it, Photo Vault makes a folder called **Photo Vault Backup** and uses that.
4. The first backup starts straight away. Every photo is copied and then read back to check that the copy is perfect. A large library takes a few hours, and you can keep using the app while it runs.
5. When it finishes, the card in the sidebar says **Protected**.

Click the drive's name to give it a name, such as "Drive at home". Leave **Back up automatically after imports** on.

### Keeping it up to date

Plug the drive in every so often. It is brought up to date as soon as it is connected, and it receives only what is new. Nothing is ever deleted from a backup automatically, not even photos you delete from the library.

Once a month Photo Vault re-reads every photo in the library and on any connected backup drive, and compares each one with the fingerprint taken when it was imported. A damaged or missing copy on a backup drive is copied again.

### A second drive away from home

A drive that sits next to the computer can be lost along with it. With two drives, keep one somewhere else (at work, or with family) and swap them every month or so. Add each one with **Add backup location**; each is brought up to date when it is plugged in.

### If the library is lost

A backup drive is a complete library. Install Photo Vault on any computer, choose **Open an existing library** (or **Settings → Library → Open another library…**) and pick the backup folder. Your photos, albums, people, dates and favourites are all there. Thumbnails are made again on their own. Then add a new backup drive, because the drive you opened is now your library.

### Catalogue snapshots

Your albums, people, dates and labels live in the catalogue. Photo Vault saves a copy of it every day, after every import, before permanent deletes and before updates. If something goes wrong, for example an album is deleted by mistake, go to **Safety → Catalogue snapshots** and click **Restore** next to an earlier snapshot. Your current catalogue is saved first, so a restore can be undone too. Photo files are not touched.

## Hiding, the Bin and deleting

- **Hide** (**Hide from Photos**) takes items out of the Photos timeline only. They stay in your library, albums and search, and they stay in your backups. Use it for clutter you want to keep but not see: memes, receipts, chat stickers. Hidden items are listed under **Tidy up → Hidden**, where you can show them again.
- **Bin** takes items out of every view. They wait in the Bin, still on disk and still backed up, until you restore them or delete them. Nothing is deleted automatically.
- **Delete permanently** (from the Bin) removes the files from the library. By default they go to the Windows Recycle Bin, so you can still get them back until you empty it. Copies already on a backup drive are kept. If you import the same files again later, they are skipped.

Hiding, moving to the Bin and favourites can be undone for a few seconds with **Undo** in the bar at the bottom.

## Tidy up and "Probably received or saved"

**Tidy up** groups things you may want to hide or delete: photos from WhatsApp and other chat apps, screenshots, downloads, stickers, duplicates and series of near-identical shots.

Every photo is labelled with where it most likely came from, based on clues in the file. **Probably received or saved** means the file has no camera information and no recording date, which almost always means it came from someone else, through a chat app or social network, or was saved from the web. Photo Vault cannot be certain, so these are grouped by size clue (**Probably WhatsApp**, **Probably social media**) for you to look through, and nothing is hidden or deleted unless you choose to.

**Probable duplicates** are the same photo saved more than once with different bytes (resized or compressed). **Similar photos** are series of shots taken one after another. In both, the best copy is suggested and you decide what to do with the rest.

## Moving to a new computer

1. Close Photo Vault on the old computer.
2. Copy the whole library folder to the new computer, or to a drive you take with you. Copy the folder itself, not just `originals`. The catalogue in `database` holds your albums, people and dates.
3. Install Photo Vault on the new computer, choose **Open an existing library** and pick the copied folder.
4. On the **Safety** page, check your backup drives. If a drive now has a different letter, remove it and add it again with **Add backup location**. It is recognised, and only what is new is copied.
5. On the new computer, add the update token again in **Settings → Updates**, and turn on smart search and descriptions again if you used them. They download their models again, or load them from a folder saved with **Settings → AI models → Save a copy to a folder…**.

Opening a backup drive (see "If the library is lost") also works, if the old computer is not available.

## Smart search, descriptions and people

These features are off until you turn them on in **Settings**. They run entirely on this computer: your photos are never uploaded. Each one downloads its model once, then works through your photos in the background. Search already works on photos that are done.

- **Smart search** finds photos by what they show, like "beach at sunset", "dog" or "receipt". Type in the search box (Ctrl K) and choose **Photos that look like…**. It also finds dogs and cats for People.
- **Automatic descriptions** write a short sentence about each photo, such as "A dog sitting in a field". It is shown in the photo's details and the search box finds it. It takes about 2 seconds per photo, newest first, so a large library takes many hours. Descriptions are in English.
- **People** groups photos by the faces in them. Name a person once, and search finds their photos.

While they work, a card in the sidebar shows how far along they are. **Offline mode** in Settings blocks every internet connection, as a guarantee. Features whose models are already downloaded keep working.

## Using the keyboard

Everything in Photo Vault works without a mouse. Each photo and control has a name that screen readers such as Windows Narrator read out.

- **Tab** moves between controls. The first press offers **Skip to content**, past the sidebar.
- **Ctrl K** opens the search box.
- In a grid of photos, the **arrow keys** move between photos, **Page Up** and **Page Down** move a screenful, **Home** and **End** go to the start or end of the row, and **Ctrl Home** and **Ctrl End** to the first or last photo.
- **Enter** opens a photo, **Space** selects it, **Shift** with the arrow keys selects several, **Ctrl A** selects everything in the view, and **Esc** clears the selection.
- In the viewer: **left** and **right arrows** for the previous and next photo, **+**, **-** and **0** to zoom, **I** for details, **R** to rotate, **E** to edit, **F** to show faces, **Ctrl C** to copy the picture, and **Esc** to close. Closing returns you to the photo in the grid.
- In menus, the **arrow keys** move between items. **Esc** closes a menu or dialog and returns you to the button that opened it.

## Updates

Installed copies update themselves. A new version downloads in the background and installs when you quit, or click **Restart and update** in **Settings → Updates**. What changed in each version is under **What's new** in this guide.
