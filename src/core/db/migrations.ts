import type { Database } from './database'

export interface Migration {
  version: number
  name: string
  sql: string
}

/**
 * Append-only list. Never edit a migration that has shipped; add a new one.
 *
 * Conceptual model:
 *   assets       – logical media item, identified by SHA-256 of its bytes
 *   files        – physical copies of an asset in a storage location
 *   provenance   – every place an asset has been observed (survives dedup)
 *   imports      – one import operation
 *   import_items – every media file seen by an import and what was done with it
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE library_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE storage_locations (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('MANAGED_LIBRARY', 'LOCAL_DISK', 'EXTERNAL_DISK', 'NETWORK', 'CLOUD')),
        -- NULL for the managed library: paths are relative to the library root,
        -- so the library folder can be moved or its drive letter can change.
        root_path  TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE imports (
        id              INTEGER PRIMARY KEY,
        source_type     TEXT NOT NULL,
        source_path     TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('scanning', 'ready', 'importing', 'completed', 'cancelled', 'failed', 'interrupted')),
        started_at      TEXT NOT NULL,
        analyzed_at     TEXT,
        completed_at    TEXT,
        files_scanned   INTEGER NOT NULL DEFAULT 0,
        photos_found    INTEGER NOT NULL DEFAULT 0,
        videos_found    INTEGER NOT NULL DEFAULT 0,
        sidecars_found  INTEGER NOT NULL DEFAULT 0,
        ignored_found   INTEGER NOT NULL DEFAULT 0,
        assets_created  INTEGER NOT NULL DEFAULT 0,
        files_failed    INTEGER NOT NULL DEFAULT 0,
        error           TEXT
      );

      CREATE TABLE assets (
        id                     INTEGER PRIMARY KEY,
        sha256                 TEXT NOT NULL UNIQUE,
        media_type             TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
        mime_type              TEXT NOT NULL,
        size_bytes             INTEGER NOT NULL,
        width                  INTEGER,
        height                 INTEGER,
        duration_ms            INTEGER,
        orientation            INTEGER,
        -- Wall-clock capture time as recorded by the device (YYYY-MM-DDTHH:MM:SS[.sss]).
        -- NULL when no metadata/filename gives a capture time.
        capture_time           TEXT,
        capture_offset_minutes INTEGER,
        capture_time_source    TEXT,
        -- Timeline position: capture time if known, otherwise file modified time.
        -- Wall-clock milliseconds encoded as if UTC, so days never shift with the viewer's time zone.
        sort_time              INTEGER NOT NULL,
        sort_day               TEXT NOT NULL,
        sort_time_source       TEXT NOT NULL,
        latitude               REAL,
        longitude              REAL,
        altitude               REAL,
        camera_make            TEXT,
        camera_model           TEXT,
        lens_model             TEXT,
        original_filename      TEXT NOT NULL,
        favorite               INTEGER NOT NULL DEFAULT 0,
        thumb_status           TEXT NOT NULL DEFAULT 'pending' CHECK (thumb_status IN ('pending', 'ready', 'failed')),
        first_import_id        INTEGER REFERENCES imports(id),
        metadata_json          TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );
      CREATE INDEX idx_assets_timeline ON assets (sort_time DESC, id DESC);
      CREATE INDEX idx_assets_day ON assets (sort_day);
      CREATE INDEX idx_assets_thumb_pending ON assets (thumb_status) WHERE thumb_status = 'pending';

      CREATE TABLE files (
        id                  INTEGER PRIMARY KEY,
        asset_id            INTEGER NOT NULL REFERENCES assets(id),
        storage_location_id INTEGER NOT NULL REFERENCES storage_locations(id),
        relative_path       TEXT NOT NULL,
        size_bytes          INTEGER NOT NULL,
        sha256              TEXT NOT NULL,
        role                TEXT NOT NULL DEFAULT 'original',
        verified_at         TEXT,
        missing_since       TEXT,
        created_at          TEXT NOT NULL,
        UNIQUE (storage_location_id, relative_path)
      );
      CREATE INDEX idx_files_asset ON files (asset_id);
      CREATE INDEX idx_files_sha ON files (sha256);

      CREATE TABLE provenance (
        id                INTEGER PRIMARY KEY,
        asset_id          INTEGER NOT NULL REFERENCES assets(id),
        source_type       TEXT NOT NULL,
        source_root       TEXT NOT NULL,
        source_path       TEXT NOT NULL,
        relative_path     TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        size_bytes        INTEGER NOT NULL,
        fs_created_at     TEXT,
        fs_modified_at    TEXT,
        first_import_id   INTEGER NOT NULL REFERENCES imports(id),
        last_import_id    INTEGER NOT NULL REFERENCES imports(id),
        first_seen_at     TEXT NOT NULL,
        last_seen_at      TEXT NOT NULL,
        times_seen        INTEGER NOT NULL DEFAULT 1,
        metadata_json     TEXT,
        UNIQUE (asset_id, source_path)
      );
      CREATE INDEX idx_provenance_asset ON provenance (asset_id);

      CREATE TABLE import_items (
        id             INTEGER PRIMARY KEY,
        import_id      INTEGER NOT NULL REFERENCES imports(id),
        source_path    TEXT NOT NULL,
        relative_path  TEXT NOT NULL,
        filename       TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL,
        fs_created_at  TEXT,
        fs_modified_at TEXT,
        media_type     TEXT,
        mime_type      TEXT,
        sha256         TEXT,
        classification TEXT NOT NULL CHECK (classification IN ('pending', 'new', 'duplicate_library', 'duplicate_batch', 'unsupported', 'error')),
        outcome        TEXT CHECK (outcome IN ('imported', 'linked', 'skipped', 'failed')),
        asset_id       INTEGER REFERENCES assets(id),
        metadata_json  TEXT,
        error          TEXT,
        UNIQUE (import_id, source_path)
      );
      CREATE INDEX idx_import_items_class ON import_items (import_id, classification);
      CREATE INDEX idx_import_items_sha ON import_items (sha256);

      CREATE TABLE asset_thumbnails (
        asset_id      INTEGER NOT NULL REFERENCES assets(id),
        variant       TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        width         INTEGER NOT NULL,
        height        INTEGER NOT NULL,
        generator     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (asset_id, variant)
      );
    `
  },
  {
    version: 2,
    name: 'archives_takeout_verification',
    sql: `
      -- Every root the user chose for an import (folders and/or ZIP files).
      ALTER TABLE imports ADD COLUMN sources_json TEXT;
      ALTER TABLE imports ADD COLUMN archives_found INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE imports ADD COLUMN sidecars_matched INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE imports ADD COLUMN hashes_reused INTEGER NOT NULL DEFAULT 0;

      -- Where the bytes live: a plain file (container_path NULL) or an entry inside a ZIP.
      ALTER TABLE import_items ADD COLUMN source_root TEXT;
      ALTER TABLE import_items ADD COLUMN source_type TEXT;
      ALTER TABLE import_items ADD COLUMN container_path TEXT;
      ALTER TABLE import_items ADD COLUMN entry_name TEXT;
      -- Cheap identity of the source bytes (size + mtime, or size + CRC + archive stamp).
      -- When it matches an earlier observation of the same path, the earlier SHA-256 is reused.
      ALTER TABLE import_items ADD COLUMN source_fingerprint TEXT;
      ALTER TABLE import_items ADD COLUMN hash_reused INTEGER NOT NULL DEFAULT 0;
      -- Export metadata (e.g. Google Takeout JSON), kept verbatim.
      ALTER TABLE import_items ADD COLUMN sidecar_path TEXT;
      ALTER TABLE import_items ADD COLUMN sidecar_json TEXT;
      ALTER TABLE import_items ADD COLUMN album TEXT;
      CREATE INDEX idx_import_items_source ON import_items (source_path, source_fingerprint);

      ALTER TABLE provenance ADD COLUMN container_path TEXT;
      ALTER TABLE provenance ADD COLUMN sidecar_path TEXT;
      ALTER TABLE provenance ADD COLUMN sidecar_json TEXT;
      ALTER TABLE provenance ADD COLUMN album TEXT;

      ALTER TABLE assets ADD COLUMN description TEXT;

      ALTER TABLE files ADD COLUMN verify_status TEXT CHECK (verify_status IN ('ok', 'missing', 'mismatch'));

      CREATE TABLE verifications (
        id            INTEGER PRIMARY KEY,
        started_at    TEXT NOT NULL,
        completed_at  TEXT,
        status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed', 'interrupted')),
        files_total   INTEGER NOT NULL DEFAULT 0,
        files_checked INTEGER NOT NULL DEFAULT 0,
        ok            INTEGER NOT NULL DEFAULT 0,
        missing       INTEGER NOT NULL DEFAULT 0,
        mismatched    INTEGER NOT NULL DEFAULT 0,
        bytes_checked INTEGER NOT NULL DEFAULT 0,
        error         TEXT
      );
    `
  },
  {
    version: 3,
    name: 'albums',
    sql: `
      -- Albums only reference assets. Deleting an album or removing a photo from it never touches files.
      CREATE TABLE albums (
        id             INTEGER PRIMARY KEY,
        name           TEXT NOT NULL,
        description    TEXT,
        kind           TEXT NOT NULL CHECK (kind IN ('user', 'takeout')),
        -- For imported albums: the identity in the source (Takeout album title), so re-imports don't duplicate it.
        source_key     TEXT,
        cover_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_albums_source ON albums (kind, source_key) WHERE source_key IS NOT NULL;

      CREATE TABLE album_assets (
        album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        asset_id   INTEGER NOT NULL REFERENCES assets(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at   TEXT NOT NULL,
        PRIMARY KEY (album_id, asset_id)
      );
      CREATE INDEX idx_album_assets_asset ON album_assets (asset_id);

      -- Rebuild albums recorded by earlier Takeout imports.
      INSERT INTO albums (name, kind, source_key, created_at, updated_at)
        SELECT album, 'takeout', album, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          FROM provenance WHERE album IS NOT NULL GROUP BY album;
      INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at)
        SELECT al.id, p.asset_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          FROM provenance p JOIN albums al ON al.kind = 'takeout' AND al.source_key = p.album;

      CREATE INDEX idx_assets_favorite ON assets (favorite) WHERE favorite = 1;
      CREATE INDEX idx_provenance_source_type ON provenance (source_type, asset_id);
    `
  },
  {
    version: 4,
    name: 'origin_kind_hidden',
    sql: `
      -- Where an item came from (camera, whatsapp, screenshot, ...) and what it is (photo, video, loop, ...),
      -- each with the human-readable evidence that produced the label. Filled by the classification queue.
      ALTER TABLE assets ADD COLUMN origin TEXT;
      ALTER TABLE assets ADD COLUMN origin_evidence TEXT;
      ALTER TABLE assets ADD COLUMN kind TEXT;
      ALTER TABLE assets ADD COLUMN kind_evidence TEXT;
      ALTER TABLE assets ADD COLUMN has_audio INTEGER;
      ALTER TABLE assets ADD COLUMN frames INTEGER;
      ALTER TABLE assets ADD COLUMN classify_version INTEGER NOT NULL DEFAULT 0;
      -- Hidden from the main timeline (like Google Photos' Archive). Never deletes anything.
      ALTER TABLE assets ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assets ADD COLUMN hidden_at TEXT;

      CREATE INDEX idx_assets_origin ON assets (origin);
      CREATE INDEX idx_assets_kind ON assets (kind);
      CREATE INDEX idx_assets_hidden ON assets (hidden) WHERE hidden = 1;
      CREATE INDEX idx_assets_classify ON assets (classify_version);
    `
  },
  {
    version: 5,
    name: 'origin_confidence',
    sql: `
      -- 'certain' when a rule found direct evidence (folder, file name, app marker, camera data);
      -- 'probable' for inferences such as "no camera data at all → probably received or saved".
      ALTER TABLE assets ADD COLUMN origin_confidence TEXT;
      -- Sub-group for probable origins, e.g. 'whatsapp_size' (1600 px, WhatsApp's resize) or 'social_size' (2048 px).
      ALTER TABLE assets ADD COLUMN origin_hint TEXT;
      CREATE INDEX idx_assets_origin_hint ON assets (origin, origin_hint);
    `
  },
  {
    version: 6,
    name: 'visual_hashes',
    sql: `
      -- Perceptual fingerprints (computed from the cached thumbnail) for probable-duplicate detection.
      CREATE TABLE asset_hashes (
        asset_id   INTEGER PRIMARY KEY REFERENCES assets(id),
        dhash      TEXT,
        phash      TEXT,
        flat       INTEGER NOT NULL DEFAULT 0,
        version    INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      -- Pairs the user said are NOT duplicates; never suggested again.
      CREATE TABLE near_duplicate_dismissals (
        asset_a    INTEGER NOT NULL REFERENCES assets(id),
        asset_b    INTEGER NOT NULL REFERENCES assets(id),
        created_at TEXT NOT NULL,
        PRIMARY KEY (asset_a, asset_b),
        CHECK (asset_a < asset_b)
      );
    `
  },
  {
    version: 7,
    name: 'visual_hash_colour',
    sql: `
      -- Average colour of each image quadrant (2×2 × RGB, 24 hex chars). The fingerprints are greyscale,
      -- so this stops pictures that differ mainly in colour from matching.
      ALTER TABLE asset_hashes ADD COLUMN color TEXT;
    `
  },
  {
    version: 8,
    name: 'dating',
    sql: `
      -- Why an inferred date was chosen (JSON list of human-readable reasons): estimated from neighbouring
      -- files, borrowed from a matching copy, or set manually.
      ALTER TABLE assets ADD COLUMN date_evidence TEXT;
      -- The timeline position used while undated (file modified time), kept so an estimate can be undone.
      ALTER TABLE assets ADD COLUMN fallback_sort_time INTEGER;
      UPDATE assets SET fallback_sort_time = sort_time WHERE capture_time IS NULL;
      -- Items without any capture date go to a "No date" section instead of their file date.
      ALTER TABLE assets ADD COLUMN undated INTEGER GENERATED ALWAYS AS (capture_time IS NULL) VIRTUAL;
      CREATE INDEX idx_assets_timeline_undated ON assets (undated, sort_time DESC, id DESC);
    `
  },
  {
    version: 9,
    name: 'bin',
    sql: `
      -- Bin: moved here by the user, shown nowhere else, permanently deleted only on request.
      ALTER TABLE assets ADD COLUMN trashed_at TEXT;
      CREATE INDEX idx_assets_trashed ON assets (trashed_at) WHERE trashed_at IS NOT NULL;

      -- What the user permanently deleted, by content hash, so re-importing an old export
      -- does not silently bring it back.
      CREATE TABLE deleted_assets (
        sha256            TEXT PRIMARY KEY,
        original_filename TEXT,
        media_type        TEXT,
        size_bytes        INTEGER,
        deleted_at        TEXT NOT NULL
      );

      -- Rebuild import_items: new classification 'deleted_before', and asset_id cleared when an asset is deleted.
      CREATE TABLE import_items_v9 (
        id                 INTEGER PRIMARY KEY,
        import_id          INTEGER NOT NULL REFERENCES imports(id),
        source_path        TEXT NOT NULL,
        relative_path      TEXT NOT NULL,
        filename           TEXT NOT NULL,
        size_bytes         INTEGER NOT NULL,
        fs_created_at      TEXT,
        fs_modified_at     TEXT,
        media_type         TEXT,
        mime_type          TEXT,
        sha256             TEXT,
        classification     TEXT NOT NULL CHECK (classification IN ('pending', 'new', 'duplicate_library', 'duplicate_batch', 'deleted_before', 'unsupported', 'error')),
        outcome            TEXT CHECK (outcome IN ('imported', 'linked', 'skipped', 'failed')),
        asset_id           INTEGER REFERENCES assets(id) ON DELETE SET NULL,
        metadata_json      TEXT,
        error              TEXT,
        source_root        TEXT,
        source_type        TEXT,
        container_path     TEXT,
        entry_name         TEXT,
        source_fingerprint TEXT,
        hash_reused        INTEGER NOT NULL DEFAULT 0,
        sidecar_path       TEXT,
        sidecar_json       TEXT,
        album              TEXT,
        UNIQUE (import_id, source_path)
      );
      INSERT INTO import_items_v9 (id, import_id, source_path, relative_path, filename, size_bytes, fs_created_at, fs_modified_at, media_type,
                                   mime_type, sha256, classification, outcome, asset_id, metadata_json, error, source_root, source_type,
                                   container_path, entry_name, source_fingerprint, hash_reused, sidecar_path, sidecar_json, album)
        SELECT id, import_id, source_path, relative_path, filename, size_bytes, fs_created_at, fs_modified_at, media_type,
               mime_type, sha256, classification, outcome, asset_id, metadata_json, error, source_root, source_type,
               container_path, entry_name, source_fingerprint, hash_reused, sidecar_path, sidecar_json, album
          FROM import_items;
      DROP TABLE import_items;
      ALTER TABLE import_items_v9 RENAME TO import_items;
      CREATE INDEX idx_import_items_class ON import_items (import_id, classification);
      CREATE INDEX idx_import_items_sha ON import_items (sha256);
      CREATE INDEX idx_import_items_source ON import_items (source_path, source_fingerprint);
    `
  },
  {
    version: 10,
    name: 'backups',
    sql: `
      -- Second copies of the library on other drives/folders. A backup target is itself a complete,
      -- openable Photo Vault library (originals + database snapshot + marker).
      CREATE TABLE backup_targets (
        id                INTEGER PRIMARY KEY,
        path              TEXT NOT NULL UNIQUE,
        auto              INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        last_run_at       TEXT,
        last_completed_at TEXT,
        last_verified_at  TEXT,
        last_error        TEXT
      );
      -- One row per original copied to a target, with its verification state.
      CREATE TABLE backup_files (
        target_id     INTEGER NOT NULL REFERENCES backup_targets(id) ON DELETE CASCADE,
        file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        sha256        TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        copied_at     TEXT,
        verified_at   TEXT,
        status        TEXT NOT NULL CHECK (status IN ('ok', 'missing', 'mismatch')),
        PRIMARY KEY (target_id, file_id)
      );
    `
  },
  {
    version: 11,
    name: 'live_photos',
    sql: `
      -- The motion clip of an Apple Live Photo points at its still. Such clips are not shown on their own.
      ALTER TABLE assets ADD COLUMN live_photo_of INTEGER REFERENCES assets(id) ON DELETE SET NULL;
      CREATE INDEX idx_assets_live ON assets (live_photo_of) WHERE live_photo_of IS NOT NULL;
    `
  },
  {
    version: 12,
    name: 'sharpness',
    sql: `
      -- Focus measure per item, used to suggest the sharpest shot among similar photos (bursts).
      ALTER TABLE asset_hashes ADD COLUMN sharpness REAL;
      -- "Recently added" ordering.
      CREATE INDEX idx_assets_created ON assets (created_at);
      -- Non-destructive rotation (degrees clockwise, applied on top of the EXIF orientation to cached renditions).
      ALTER TABLE assets ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0;
      -- Map view: items inside the visible box.
      CREATE INDEX idx_assets_geo ON assets (latitude, longitude) WHERE latitude IS NOT NULL;
      -- Watched folders: imported automatically when new photos appear.
      CREATE TABLE watch_folders (
        id              INTEGER PRIMARY KEY,
        path            TEXT NOT NULL UNIQUE,
        enabled         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL,
        last_checked_at TEXT,
        last_import_id  INTEGER,
        last_imported   INTEGER,
        last_error      TEXT
      );
      -- Who started an import: the user, or a watched folder.
      ALTER TABLE imports ADD COLUMN trigger TEXT NOT NULL DEFAULT 'user';

      -- Full-text search: one row per asset (rowid = asset id); see core/repo/search.ts.
      CREATE VIRTUAL TABLE asset_search USING fts5(text, tokenize = 'trigram remove_diacritics 1');
      -- Assets whose search text must be rebuilt. Triggers keep it up to date; the index catches up lazily.
      CREATE TABLE search_dirty (asset_id INTEGER PRIMARY KEY);
      -- (No INSERT OR IGNORE here: the triggering statement's conflict policy would override it.)
      CREATE TRIGGER trg_search_asset_ins AFTER INSERT ON assets BEGIN INSERT INTO search_dirty SELECT new.id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.id); END;
      CREATE TRIGGER trg_search_asset_upd AFTER UPDATE OF original_filename, camera_make, camera_model, description, sort_day, mime_type ON assets
        BEGIN INSERT INTO search_dirty SELECT new.id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.id); END;
      CREATE TRIGGER trg_search_asset_del AFTER DELETE ON assets
        BEGIN DELETE FROM asset_search WHERE rowid = old.id; DELETE FROM search_dirty WHERE asset_id = old.id; END;
      CREATE TRIGGER trg_search_prov_ins AFTER INSERT ON provenance BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_prov_upd AFTER UPDATE ON provenance BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_album_ins AFTER INSERT ON album_assets BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_album_del AFTER DELETE ON album_assets BEGIN INSERT INTO search_dirty SELECT old.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = old.asset_id); END;
      CREATE TRIGGER trg_search_album_name AFTER UPDATE OF name ON albums
        BEGIN INSERT INTO search_dirty SELECT DISTINCT asset_id FROM album_assets x WHERE album_id = new.id
                AND NOT EXISTS (SELECT 1 FROM search_dirty d WHERE d.asset_id = x.asset_id); END;
      INSERT INTO search_dirty SELECT id FROM assets;

      -- Smart search: on-device CLIP vector (float32) per item; see main/smartSearch.ts.
      CREATE TABLE asset_embeddings (
        asset_id   INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        model      TEXT NOT NULL,
        vec        BLOB NOT NULL,
        created_at TEXT NOT NULL
      );
      -- Per-library preferences (e.g. smart search on/off).
      CREATE TABLE library_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `
  },
  {
    version: 13,
    name: 'people',
    sql: `
      -- People: faces found on the device (core/ai/faces.ts), grouped into persons (core/ai/people.ts).
      CREATE TABLE persons (
        id         INTEGER PRIMARY KEY,
        name       TEXT,
        hidden     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE faces (
        id            INTEGER PRIMARY KEY,
        asset_id      INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        -- Box normalised (0–1) to the oriented, rotated picture.
        x             REAL NOT NULL,
        y             REAL NOT NULL,
        w             REAL NOT NULL,
        h             REAL NOT NULL,
        score         REAL NOT NULL,
        quality       REAL NOT NULL,
        vec           BLOB NOT NULL,
        person_id     INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        -- 'auto' (grouping) or 'user' (the user moved it); user decisions are never undone automatically.
        assigned_by   TEXT,
        -- People this face is NOT (the user's "Not this person"), as a JSON array of person ids.
        rejected_json TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_faces_asset ON faces (asset_id);
      CREATE INDEX idx_faces_person ON faces (person_id);
      -- Every photo looked at (also those without faces), so scans resume and never repeat.
      CREATE TABLE face_scans (
        asset_id   INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        faces      INTEGER NOT NULL,
        version    INTEGER NOT NULL,
        scanned_at TEXT NOT NULL
      );
      -- People's names are searchable: keep the search index current.
      CREATE TRIGGER trg_search_face_ins AFTER INSERT ON faces
        BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_face_upd AFTER UPDATE OF person_id ON faces
        BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_face_del AFTER DELETE ON faces
        BEGIN INSERT INTO search_dirty SELECT old.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = old.asset_id); END;
      CREATE TRIGGER trg_search_person_name AFTER UPDATE OF name ON persons
        BEGIN INSERT INTO search_dirty SELECT DISTINCT asset_id FROM faces f WHERE person_id = new.id
                AND NOT EXISTS (SELECT 1 FROM search_dirty d WHERE d.asset_id = f.asset_id); END;
    `
  },
  {
    version: 14,
    name: 'people_not_same',
    sql: `
      -- "Different people": pairs the user said are not the same person; never merged or suggested again.
      CREATE TABLE person_not_same (
        person_a   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        person_b   INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (person_a, person_b)
      );
    `
  },
  {
    version: 15,
    name: 'person_merges',
    sql: `
      -- Every merge of two people (automatic or by the user), so it can be undone.
      CREATE TABLE person_merges (
        id            INTEGER PRIMARY KEY,
        target_id     INTEGER NOT NULL,
        source_id     INTEGER NOT NULL,
        source_name   TEXT,
        source_hidden INTEGER NOT NULL DEFAULT 0,
        face_ids      TEXT NOT NULL,
        merged_by     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        undone_at     TEXT
      );
      CREATE INDEX idx_person_merges_target ON person_merges (target_id);
    `
  },
  {
    version: 16,
    name: 'edits',
    sql: `
      -- Non-destructive photo edits (JSON: crop, flip, light, contrast, color, warmth, filter); see core/media/edits.ts.
      ALTER TABLE assets ADD COLUMN edits TEXT;
      -- Bumped on every edit, so cached renditions get a new URL.
      ALTER TABLE assets ADD COLUMN edit_rev INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 17,
    name: 'annotations',
    sql: `
      -- The user's own keywords.
      CREATE TABLE asset_tags (
        asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        tag        TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (asset_id, tag)
      );
      CREATE INDEX idx_asset_tags_tag ON asset_tags (tag);
      CREATE TRIGGER trg_search_tag_ins AFTER INSERT ON asset_tags
        BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_tag_del AFTER DELETE ON asset_tags
        BEGIN INSERT INTO search_dirty SELECT old.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = old.asset_id); END;
      -- Smart albums: a saved search (AssetQuery JSON) that fills itself.
      CREATE TABLE smart_albums (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        query_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      -- 'manual' when the user placed the photo on the map (later imports never overwrite it).
      ALTER TABLE assets ADD COLUMN location_source TEXT;
      -- Faces the user marked by hand (no recognisable vector when the detector could not confirm them).
      ALTER TABLE faces ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 18,
    name: 'backup_labels',
    sql: `
      -- A name for each backup location (e.g. "Drive at home", "Drive at work") for rotating drives.
      ALTER TABLE backup_targets ADD COLUMN label TEXT;
    `
  },
  {
    version: 19,
    name: 'places',
    sql: `
      -- Nearest town/city and country for located items ("Lisbon, Portugal"; '' = none nearby), filled in the
      -- background from the offline GeoNames table (core/geo/places.ts). NULL = not looked up yet.
      ALTER TABLE assets ADD COLUMN place TEXT;
      CREATE INDEX idx_assets_place_todo ON assets (id) WHERE place IS NULL AND latitude IS NOT NULL;
      -- A new location means a new place name.
      CREATE TRIGGER trg_place_reset AFTER UPDATE OF latitude, longitude ON assets
        BEGIN UPDATE assets SET place = NULL WHERE id = new.id; END;
      CREATE TRIGGER trg_search_place AFTER UPDATE OF place ON assets
        BEGIN INSERT INTO search_dirty SELECT new.id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.id); END;
    `
  },
  {
    version: 20,
    name: 'edited_versions',
    sql: `
      -- An original that has an edited version beside it (IMG_1234 + IMG_E1234, name + name-edited) points at
      -- the edited one and is not shown separately; see core/library/editedVersions.ts.
      ALTER TABLE assets ADD COLUMN version_of INTEGER REFERENCES assets(id) ON DELETE SET NULL;
      CREATE INDEX idx_assets_version_of ON assets (version_of) WHERE version_of IS NOT NULL;
    `
  },
  {
    version: 21,
    name: 'captions',
    sql: `
      -- Automatic one-sentence descriptions (on-device model, opt-in); searchable. See main/captions.ts.
      CREATE TABLE asset_captions (
        asset_id   INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
        caption    TEXT,
        model      TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TRIGGER trg_search_caption_ins AFTER INSERT ON asset_captions
        BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
      CREATE TRIGGER trg_search_caption_upd AFTER UPDATE ON asset_captions
        BEGIN INSERT INTO search_dirty SELECT new.asset_id WHERE NOT EXISTS (SELECT 1 FROM search_dirty WHERE asset_id = new.asset_id); END;
    `
  }
]

export class SchemaTooNewError extends Error {}

export function runMigrations(db: Database, list: Migration[] = migrations): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const current = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0
  const latest = Math.max(0, ...list.map((m) => m.version))
  if (current > latest) {
    throw new SchemaTooNewError(
      `This library was created by a newer version of Photo Vault (schema ${current}, this build supports ${latest}). ` +
        'Refusing to open it to avoid damaging it.'
    )
  }
  for (const m of [...list].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    db.tx(() => {
      db.exec(m.sql)
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()])
    })
  }
}

export function schemaVersion(db: Database): number {
  return db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0
}
