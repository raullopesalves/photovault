import type { PeopleSuggestion, Person, PersonMerge } from '@shared/types'
import { pairKey, suggestSamePerson, type ClusterContext, type ClusterFace, type ClusterResult } from '../ai/people'
import type { DetectedFace } from '../ai/faces'
import type { Database } from '../db/database'
import type { Library } from '../library/library'

/** People with at least one photo outside the Bin, most photographed first (named people first). */
export function listPeople(library: Library): Person[] {
  return library.db
    .all<{ id: number; name: string | null; hidden: number; photos: number; cover: number | null }>(
      `SELECT p.id, p.name, p.hidden, COUNT(DISTINCT f.asset_id) AS photos,
              (SELECT f2.id FROM faces f2 JOIN assets a2 ON a2.id = f2.asset_id
                WHERE f2.person_id = p.id AND a2.trashed_at IS NULL ORDER BY f2.quality DESC LIMIT 1) AS cover
         FROM persons p
         JOIN faces f ON f.person_id = p.id
         JOIN assets a ON a.id = f.asset_id AND a.trashed_at IS NULL
        GROUP BY p.id
        ORDER BY p.name IS NULL, photos DESC, p.id`
    )
    .map((r) => ({ id: r.id, name: r.name, hidden: r.hidden === 1, photos: r.photos, coverFaceId: r.cover }))
}

export function getPerson(library: Library, id: number): Person | null {
  return listPeople(library).find((p) => p.id === id) ?? null
}

/** People on one photo (for the viewer). */
export function peopleOfAsset(library: Library, assetId: number): Array<{ id: number; name: string | null }> {
  return library.db.all<{ id: number; name: string | null }>(
    'SELECT DISTINCT p.id, p.name FROM faces f JOIN persons p ON p.id = f.person_id WHERE f.asset_id = ? ORDER BY p.name IS NULL, p.name',
    [assetId]
  )
}

/** Renames a person. If another person already has that name, nothing changes and that person is returned. */
export function renamePerson(library: Library, id: number, name: string | null): { conflict: Person | null } {
  const clean = name?.trim().slice(0, 100) || null
  if (clean) {
    const other = library.db.get<{ id: number }>('SELECT id FROM persons WHERE id <> ? AND lower(name) = lower(?)', [id, clean])
    if (other) return { conflict: getPerson(library, other.id) }
  }
  library.db.run('UPDATE persons SET name = ?, updated_at = ? WHERE id = ?', [clean, new Date().toISOString(), id])
  return { conflict: null }
}

/**
 * Moves every face of `sourceId` into `targetId` and removes the source person, recording the merge so it can be
 * undone. The target keeps its name, or takes the source's. Call inside a transaction.
 */
function mergeInto(db: Database, targetId: number, sourceId: number, by: 'auto' | 'user', now: string): boolean {
  if (targetId === sourceId) return false
  const src = db.get<{ name: string | null; hidden: number }>('SELECT name, hidden FROM persons WHERE id = ?', [sourceId])
  if (!src || !db.get('SELECT 1 AS x FROM persons WHERE id = ?', [targetId])) return false
  const faceIds = db.all<{ id: number }>('SELECT id FROM faces WHERE person_id = ?', [sourceId]).map((r) => r.id)
  db.run(
    `INSERT INTO person_merges (target_id, source_id, source_name, source_hidden, face_ids, merged_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [targetId, sourceId, src.name, src.hidden, JSON.stringify(faceIds), by, now]
  )
  // Earlier merges into the source now belong to the target (so they stay undoable from there).
  db.run('UPDATE person_merges SET target_id = ? WHERE target_id = ? AND undone_at IS NULL', [targetId, sourceId])
  db.run(`UPDATE faces SET person_id = ?${by === 'user' ? ", assigned_by = 'user'" : ''} WHERE person_id = ?`, [targetId, sourceId])
  // "Different people" answers about the source now apply to the target.
  db.run(
    `INSERT OR IGNORE INTO person_not_same (person_a, person_b, created_at)
     SELECT MIN(?, other), MAX(?, other), ? FROM (
       SELECT person_b AS other FROM person_not_same WHERE person_a = ? UNION SELECT person_a FROM person_not_same WHERE person_b = ?)
      WHERE other <> ?`,
    [targetId, targetId, now, sourceId, sourceId, targetId]
  )
  db.run('DELETE FROM persons WHERE id = ?', [sourceId])
  db.run('UPDATE persons SET name = COALESCE(name, ?), updated_at = ? WHERE id = ?', [src.name, now, targetId])
  return true
}

/** Merges people into `targetId` (the user's "Merge" / "Same person"). */
export function mergePeople(library: Library, targetId: number, sourceIds: number[]): void {
  const db = library.db
  const sources = sourceIds.filter((s) => s !== targetId)
  if (sources.length === 0) return
  const now = new Date().toISOString()
  db.tx(() => {
    if (!db.get('SELECT 1 AS x FROM persons WHERE id = ?', [targetId])) throw new Error('Person not found')
    for (const s of sources) mergeInto(db, targetId, s, 'user', now)
  })
  library.logger.info('people.merged', { targetId, sources })
}

/** Merges into this person that can still be undone, newest first. */
export function personMerges(library: Library, personId: number): PersonMerge[] {
  return library.db
    .all<{ id: number; source_name: string | null; face_ids: string; merged_by: string; created_at: string }>(
      'SELECT id, source_name, face_ids, merged_by, created_at FROM person_merges WHERE target_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 30',
      [personId]
    )
    .map((m) => {
      const ids = JSON.parse(m.face_ids) as number[]
      const still = library.db.all<{ id: number }>(
        'SELECT id FROM faces WHERE person_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY quality DESC',
        [personId, m.face_ids]
      )
      return {
        id: m.id,
        name: m.source_name,
        faces: still.length,
        totalFaces: ids.length,
        sampleFaceIds: still.slice(0, 4).map((r) => r.id),
        automatic: m.merged_by === 'auto',
        mergedAt: m.created_at
      }
    })
    .filter((m) => m.faces > 0)
}

/**
 * Undoes a merge: the merged person comes back with the faces that were moved (those still with the target),
 * and the two are remembered as different people so grouping never merges them again. Returns the person id.
 */
export function undoMerge(library: Library, mergeId: number): number {
  const db = library.db
  const now = new Date().toISOString()
  let restored = 0
  db.tx(() => {
    const m = db.get<{ target_id: number; source_id: number; source_name: string | null; source_hidden: number; face_ids: string }>(
      'SELECT target_id, source_id, source_name, source_hidden, face_ids FROM person_merges WHERE id = ? AND undone_at IS NULL',
      [mergeId]
    )
    if (!m) throw new Error('This merge was already undone.')
    const free = !db.get('SELECT 1 AS x FROM persons WHERE id = ?', [m.source_id])
    restored = Number(
      db.run(`INSERT INTO persons (${free ? 'id, ' : ''}name, hidden, created_at, updated_at) VALUES (${free ? '?, ' : ''}?, ?, ?, ?)`, [
        ...(free ? [m.source_id] : []),
        m.source_name,
        m.source_hidden,
        now,
        now
      ]).lastInsertRowid
    )
    db.run(
      "UPDATE faces SET person_id = ?, assigned_by = 'user' WHERE person_id = ? AND id IN (SELECT value FROM json_each(?))",
      [restored, m.target_id, m.face_ids]
    )
    // If the target only had a name because of this merge, give it back.
    const target = db.get<{ name: string | null }>('SELECT name FROM persons WHERE id = ?', [m.target_id])
    if (m.source_name && target?.name === m.source_name) {
      const hadOwnName = db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM person_merges WHERE target_id = ? AND id < ? AND source_name IS NOT NULL", [m.target_id, mergeId]
      )
      if (hadOwnName && hadOwnName.n === 0) db.run('UPDATE persons SET name = NULL WHERE id = ?', [m.target_id])
    }
    db.run('INSERT OR IGNORE INTO person_not_same (person_a, person_b, created_at) VALUES (?, ?, ?)', [
      Math.min(restored, m.target_id),
      Math.max(restored, m.target_id),
      now
    ])
    db.run('UPDATE person_merges SET undone_at = ? WHERE id = ?', [now, mergeId])
  })
  library.logger.info('people.merge_undone', { mergeId, person: restored })
  return restored
}

/** Faces of one person, best first (for the Faces view). */
export function personFaces(library: Library, personId: number): Array<{ id: number; assetId: number }> {
  return library.db
    .all<{ id: number; asset_id: number }>(
      `SELECT f.id, f.asset_id FROM faces f JOIN assets a ON a.id = f.asset_id
        WHERE f.person_id = ? AND a.trashed_at IS NULL ORDER BY f.quality DESC, f.id`,
      [personId]
    )
    .map((r) => ({ id: r.id, assetId: r.asset_id }))
}

/**
 * Moves faces to another person, to a new person (`targetId` null, optional name), or out of every person
 * (`targetId` undefined). The person they leave is remembered as rejected, so grouping never puts them back.
 * Returns the person they now belong to (null when removed).
 */
export function moveFaces(library: Library, faceIds: number[], target: { personId: number } | { newName: string | null } | null): number | null {
  const db = library.db
  const now = new Date().toISOString()
  let dest: number | null = null
  db.tx(() => {
    if (target && 'personId' in target) dest = target.personId
    else if (target) {
      dest = Number(
        db.run('INSERT INTO persons (name, hidden, created_at, updated_at) VALUES (?, 0, ?, ?)', [target.newName?.trim() || null, now, now]).lastInsertRowid
      )
    }
    for (const f of db.all<{ id: number; person_id: number | null; rejected_json: string | null }>(
      'SELECT id, person_id, rejected_json FROM faces WHERE id IN (SELECT value FROM json_each(?))',
      [JSON.stringify(faceIds)]
    )) {
      const rejected = new Set<number>(f.rejected_json ? (JSON.parse(f.rejected_json) as number[]) : [])
      if (f.person_id !== null && f.person_id !== dest) rejected.add(f.person_id)
      if (dest !== null) rejected.delete(dest)
      db.run("UPDATE faces SET person_id = ?, assigned_by = 'user', rejected_json = ? WHERE id = ?", [dest, JSON.stringify([...rejected]), f.id])
    }
    db.run('DELETE FROM persons WHERE NOT EXISTS (SELECT 1 FROM faces f WHERE f.person_id = persons.id)')
  })
  return dest
}

export function setPersonHidden(library: Library, id: number, hidden: boolean): void {
  library.db.run('UPDATE persons SET hidden = ?, updated_at = ? WHERE id = ?', [hidden ? 1 : 0, new Date().toISOString(), id])
}

/** "Not this person": the faces of `personId` on these photos leave the person and never rejoin it automatically. */
export function removeFromPerson(library: Library, personId: number, assetIds: number[]): number {
  const db = library.db
  let n = 0
  db.tx(() => {
    const faces = db.all<{ id: number; rejected_json: string | null }>(
      'SELECT id, rejected_json FROM faces WHERE person_id = ? AND asset_id IN (SELECT value FROM json_each(?))',
      [personId, JSON.stringify(assetIds)]
    )
    for (const f of faces) {
      const rejected = new Set<number>(f.rejected_json ? (JSON.parse(f.rejected_json) as number[]) : [])
      rejected.add(personId)
      n += db.run("UPDATE faces SET person_id = NULL, assigned_by = 'user', rejected_json = ? WHERE id = ?", [JSON.stringify([...rejected]), f.id]).changes
    }
  })
  return n
}

/** Records one photo's scan: its faces (if any) and that it was looked at. Returns the new face ids. */
export function recordFaceScan(library: Library, assetId: number, faces: Array<Omit<DetectedFace, 'crop'>>, version: number): number[] {
  const db = library.db
  const now = new Date().toISOString()
  const ids: number[] = []
  db.tx(() => {
    if (!db.get('SELECT 1 AS x FROM assets WHERE id = ?', [assetId])) return // deleted meanwhile
    db.run('DELETE FROM faces WHERE asset_id = ?', [assetId])
    for (const f of faces) {
      ids.push(
        Number(
          db.run('INSERT INTO faces (asset_id, x, y, w, h, score, quality, vec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
            assetId,
            f.x,
            f.y,
            f.w,
            f.h,
            f.score,
            f.quality,
            new Uint8Array(f.vec.buffer, f.vec.byteOffset, f.vec.byteLength),
            now
          ]).lastInsertRowid
        )
      )
    }
    db.run(
      `INSERT INTO face_scans (asset_id, faces, version, scanned_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (asset_id) DO UPDATE SET faces = excluded.faces, version = excluded.version, scanned_at = excluded.scanned_at`,
      [assetId, faces.length, version, now]
    )
  })
  return ids
}

/** Faces for grouping (read-only; runs in the worker). Faces of binned photos are left out. */
export function loadClusterFaces(db: Database): ClusterFace[] {
  return db
    .all<{ id: number; asset_id: number; person_id: number | null; quality: number; rejected_json: string | null; vec: Uint8Array }>(
      `SELECT f.id, f.asset_id, f.person_id, f.quality, f.rejected_json, f.vec
         FROM faces f JOIN assets a ON a.id = f.asset_id WHERE a.trashed_at IS NULL AND f.quality > 0`
    )
    .map((r) => ({
      id: r.id,
      assetId: r.asset_id,
      personId: r.person_id,
      quality: r.quality,
      rejected: r.rejected_json ? (JSON.parse(r.rejected_json) as number[]) : [],
      vec: new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength))
    }))
}

/** What grouping must respect: the user's "different people" answers and the names. */
export function loadClusterContext(db: Database): ClusterContext {
  return {
    notSame: new Set(db.all<{ person_a: number; person_b: number }>('SELECT person_a, person_b FROM person_not_same').map((r) => pairKey(r.person_a, r.person_b))),
    names: new Map(db.all<{ id: number; name: string | null }>('SELECT id, name FROM persons').map((r) => [r.id, r.name]))
  }
}

/** "Same person?" questions for the user, most likely first (hidden people are not asked about). */
export function peopleSuggestions(library: Library, limit = 30): PeopleSuggestion[] {
  const people = new Map(listPeople(library).map((p) => [p.id, p]))
  const samples = (personId: number): number[] =>
    library.db
      .all<{ id: number }>(
        `SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id
          WHERE f.person_id = ? AND a.trashed_at IS NULL ORDER BY f.quality DESC LIMIT 4`,
        [personId]
      )
      .map((r) => r.id)
  return suggestSamePerson(loadClusterFaces(library.db), loadClusterContext(library.db), limit * 3)
    .map((s) => ({ a: people.get(s.a), b: people.get(s.b), similarity: s.sim }))
    .filter((s): s is { a: Person; b: Person; similarity: number } => !!s.a && !!s.b && !s.a.hidden && !s.b.hidden)
    .slice(0, limit)
    .map((s) => ({ ...s, aFaces: samples(s.a.id), bFaces: samples(s.b.id) }))
}

/** "Different people": remembered, so they are never merged or suggested again. */
export function markDifferentPeople(library: Library, a: number, b: number): void {
  library.db.run('INSERT OR IGNORE INTO person_not_same (person_a, person_b, created_at) VALUES (?, ?, ?)', [
    Math.min(a, b),
    Math.max(a, b),
    new Date().toISOString()
  ])
}

/** Applies a grouping result. Only faces that are still unassigned are touched (the user may have acted meanwhile). */
export function applyClusterResult(library: Library, r: ClusterResult): { assigned: number; created: number; merged: number } {
  const db = library.db
  const now = new Date().toISOString()
  let assigned = 0
  let created = 0
  let merged = 0
  db.tx(() => {
    for (const m of r.merges ?? []) if (mergeInto(db, m.target, m.source, 'auto', now)) merged++
    for (const a of r.assign) {
      assigned += db.run("UPDATE faces SET person_id = ?, assigned_by = 'auto' WHERE id = ? AND person_id IS NULL", [a.personId, a.faceId]).changes
    }
    for (const faceIds of r.newPeople) {
      const id = Number(db.run('INSERT INTO persons (name, hidden, created_at, updated_at) VALUES (NULL, 0, ?, ?)', [now, now]).lastInsertRowid)
      const n = db.run(
        "UPDATE faces SET person_id = ?, assigned_by = 'auto' WHERE person_id IS NULL AND id IN (SELECT value FROM json_each(?))",
        [id, JSON.stringify(faceIds)]
      ).changes
      if (n === 0) db.run('DELETE FROM persons WHERE id = ?', [id])
      else {
        created++
        assigned += n
      }
    }
    // People left without faces (all removed by the user or deleted) disappear.
    db.run('DELETE FROM persons WHERE NOT EXISTS (SELECT 1 FROM faces f WHERE f.person_id = persons.id)')
  })
  return { assigned, created, merged }
}

/** Forgets all face data of the library (People turned off and cleared). Photos are untouched. */
export function clearFaceData(library: Library): void {
  const db = library.db
  db.tx(() => {
    db.run('DELETE FROM faces')
    db.run('DELETE FROM person_not_same')
    db.run('DELETE FROM persons')
    db.run('DELETE FROM face_scans')
  })
  library.logger.info('people.cleared', {})
}
