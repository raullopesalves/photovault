# The Photo Vault library folder

A Photo Vault library is an ordinary folder. Everything in it is readable without Photo Vault: the photos are plain files, and everything added in the app is written in open formats next to them. This document describes the folder for anyone who needs to use it without the app, or write a tool for it.

## Layout

```text
<library>/
  photovault-library.json   Marks the folder as a library (format, version, id, created).
  README.txt                A short version of this page.
  originals/YYYY/MM/        The photos and videos, byte for byte as imported, by capture year and month.
  originals/undated/        Items with no known capture date.
      IMG_1234.jpg          An original. Never modified by Photo Vault.
      IMG_1234.jpg.xmp      Its metadata sidecar (see below).
  metadata/
      catalogue.json        The whole catalogue as one JSON file (see below).
      README.txt
  database/photovault.db    The catalogue (SQLite). The source of truth while the app runs.
  database/backups/         Catalogue snapshots (daily, before upgrades and permanent deletes).
  thumbnails/               Preview images. Safe to delete; they are regenerated.
  logs/                     One JSON-lines log per day.
```

A backup drive set up in Safety has the same layout (originals, sidecars, `metadata/` and a catalogue snapshot), so it can be opened as a library or read without the app.

**Names.** An original keeps its file name. When two different files share a name in the same month, the second gets part of its SHA-256 fingerprint added (`IMG_1234_a73f81c2.jpg`). Identity is always the SHA-256 of the file's bytes, never its name.

## XMP sidecars

Each original has `<file name>.xmp` beside it (the darktable and digiKam convention, which keeps `IMG_1234.jpg` and `IMG_1234.heic` apart). Photo programs such as digiKam, darktable, Lightroom and exiftool read them. Photo Vault rewrites a sidecar whenever something it records changes; edits made to sidecars elsewhere are not read back.

| What | XMP field | Notes |
|---|---|---|
| Date taken | `exif:DateTimeOriginal`, `photoshop:DateCreated`, `xmp:CreateDate` | Wall-clock time as recorded, with the UTC offset when known (`2019-07-14T19:42:00+01:00`). Includes dates set by hand. |
| Location | `exif:GPSLatitude`, `exif:GPSLongitude` (`DDD,MM.mmmmmmK`), `exif:GPSAltitude` | Includes locations set by hand. |
| Favourite | `xmp:Rating` = 5 | Also `pv:Favourite`. |
| Description | `dc:description` | The one written in Photo Vault. |
| Tags | `dc:subject`; `lr:hierarchicalSubject` as `Tags\|…` | |
| Albums | `lr:hierarchicalSubject` as `Albums\|…`; `pv:Albums` | |
| People | `Iptc4xmpExt:PersonInImage`; `lr:hierarchicalSubject` as `People\|…` | Named people only. |
| All keywords | `digiKam:TagsList` (`Tags/…`, `Albums/…`, `People/…`) | For digiKam's tag tree. |
| Rotation | `tiff:Orientation` | The original's orientation turned by the rotation set in Photo Vault (not for mirrored originals). |

Photo Vault's own facts use the namespace `https://github.com/raullopesalves/photovault/ns/1.0/` (prefix `pv`): `AssetId`, `SHA256`, `OriginalFilename`, `Favourite`, `Hidden` (left out of the Photos timeline), `InBin`, `Rotation` (degrees clockwise), `DateSource` (where the date came from: `exif_original`, `takeout`, `filename`, `manual`, …), `LocationSource`, `Place` (nearest town), `Origin` (`camera`, `whatsapp`, `screenshot`, `received`, …) and `AutoDescription` (the on-device AI description, in English).

## catalogue.json

One JSON document with everything, rewritten shortly after anything changes:

```json
{
  "format": "photo-vault-catalogue",
  "version": 1,
  "exportedAt": "2026-10-23T09:30:00.000Z",
  "exportedBy": "Photo Vault 1.0.0",
  "assets": [
    {
      "id": 1, "sha256": "…", "file": "originals/2019/07/IMG_1234.jpg", "originalFilename": "IMG_1234.jpg",
      "mediaType": "photo", "captureTime": "2019-07-14T19:42:00", "captureOffsetMinutes": 60, "dateSource": "exif_original",
      "latitude": 38.3816, "longitude": -8.7801, "altitude": null, "locationSource": "manual", "place": "Comporta, Portugal",
      "camera": "Apple iPhone 14 Pro", "favorite": true, "hidden": false, "inBin": false,
      "description": "First swim of the summer", "autoDescription": "A beach with people swimming.",
      "rotation": 0, "orientation": 1, "origin": "camera", "kind": "photo",
      "tags": ["beach"], "albums": ["Summer 2019"], "people": ["Avó Maria"],
      "livePhotoOf": null, "versionOf": null, "foundAt": ["D:/Photos/takeout-001.zip!Takeout/…/IMG_1234.jpg"]
    }
  ],
  "albums": [{ "id": 1, "name": "Summer 2019", "description": null, "kind": "user", "createdAt": "…", "assets": [1] }],
  "smartAlbums": [{ "id": 1, "name": "Beach days", "query": { "text": "beach" } }],
  "people": [{ "id": 1, "name": "Avó Maria", "hidden": false, "assets": [1] }]
}
```

- `file` is relative to the library folder; `foundAt` lists every place the item was found during imports.
- `captureTime` is wall-clock time as the camera recorded it; `captureOffsetMinutes` is its UTC offset when known.
- `livePhotoOf` links a Live Photo's motion clip to its still; `versionOf` links an unedited original to the edited version shown in the app.
- Items in the Bin are included with `inBin: true` until they are deleted permanently.

## Reading it without Photo Vault

- **Photos:** open `originals/` in any viewer.
- **Metadata in another program:** point digiKam, darktable or Lightroom at `originals/`; they pick up the sidecars. With exiftool: `exiftool -XMP:all originals/2019/07/IMG_1234.jpg.xmp`.
- **Everything at once:** read `metadata/catalogue.json`, or open `database/photovault.db` with any SQLite tool (the schema is in `src/core/db/migrations.ts`).
