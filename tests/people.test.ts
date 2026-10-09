import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Library } from '@core/library/library'
import { FACE_DIM, similarityTransform } from '@core/ai/faces'
import { clusterFaces, pairKey, suggestSamePerson, type ClusterFace } from '@core/ai/people'
import { deletePermanently, moveToBin } from '@core/library/bin'
import {
  applyClusterResult,
  clearFaceData,
  listPeople,
  loadClusterContext,
  loadClusterFaces,
  mergePeople,
  moveFaces,
  personFaces,
  personMerges,
  recordFaceScan,
  undoMerge,
  removeFromPerson,
  renamePerson
} from '@core/repo/people'
import { assetDetail, assetIdsInRange } from '@core/repo/queries'
import { makeJpeg, openLibrary, runImport, sandbox, type Sandbox } from './helpers'

let seed = 7
const rnd = (): number => {
  seed = (seed + 0x6d2b79f5) | 0
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const unit = (v: Float32Array): Float32Array => {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
const identity = (): Float32Array => unit(Float32Array.from({ length: FACE_DIM }, gauss))
/** A face of `id`: the identity vector plus noise (same-person similarity ≈ 0.7). */
const faceOf = (id: Float32Array): Float32Array => unit(id.map((x) => x + gauss() * 0.07))

describe('grouping faces into people', () => {
  it('finds each person, never puts two faces of one photo together, and respects the user', () => {
    const [ana, bruno, carla] = [identity(), identity(), identity()]
    let fid = 1
    const faces: ClusterFace[] = []
    const add = (vec: Float32Array, assetId: number, extra: Partial<ClusterFace> = {}): number => {
      faces.push({ id: fid, assetId, personId: null, quality: 0.9, rejected: [], vec, ...extra })
      return fid++
    }
    for (let i = 0; i < 6; i++) add(faceOf(ana), 100 + i)
    for (let i = 0; i < 5; i++) add(faceOf(bruno), 200 + i)
    for (let i = 0; i < 2; i++) add(faceOf(carla), 300 + i) // too few photos to become a person
    const weakAna = add(faceOf(ana), 150, { quality: 0.2 })
    const r = clusterFaces(faces)
    expect(r.newPeople).toHaveLength(2)
    const anaGroup = r.newPeople.find((g) => g.includes(1)) as number[]
    expect(anaGroup).toHaveLength(7) // 6 good faces + the weak one joining
    expect(anaGroup).toContain(weakAna)
    expect(r.newPeople.flat()).not.toContain(12) // Carla stays unassigned

    // Existing person + "not this person" + same-photo rule.
    const existing: ClusterFace[] = faces.slice(0, 6).map((f) => ({ ...f, personId: 1 }))
    const newcomer = { id: 99, assetId: 500, personId: null, quality: 0.9, rejected: [], vec: faceOf(ana) }
    const rejecter = { id: 98, assetId: 501, personId: null, quality: 0.9, rejected: [1], vec: faceOf(ana) }
    const samePhoto = { id: 97, assetId: 100, personId: null, quality: 0.9, rejected: [], vec: faceOf(ana) }
    const r2 = clusterFaces([...existing, newcomer, rejecter, samePhoto])
    expect(r2.assign).toEqual([{ faceId: 99, personId: 1 }])
  })

  it('merges one person split across groups, unless the user said otherwise or the names differ', () => {
    const [ana, bruno] = [identity(), identity()]
    let fid = 1
    const faces: ClusterFace[] = []
    // Ana was found twice (persons 1 and 2, e.g. in different scan batches); Bruno is person 3.
    for (let i = 0; i < 5; i++) faces.push({ id: fid++, assetId: 100 + i, personId: 1, quality: 0.9, rejected: [], vec: faceOf(ana) })
    for (let i = 0; i < 4; i++) faces.push({ id: fid++, assetId: 200 + i, personId: 2, quality: 0.9, rejected: [], vec: faceOf(ana) })
    for (let i = 0; i < 4; i++) faces.push({ id: fid++, assetId: 300 + i, personId: 3, quality: 0.9, rejected: [], vec: faceOf(bruno) })
    expect(clusterFaces(faces).merges).toEqual([{ target: 1, source: 2 }])
    expect(clusterFaces(faces, {}, { notSame: new Set([pairKey(1, 2)]) }).merges).toEqual([])
    expect(clusterFaces(faces, {}, { names: new Map([[1, 'Ana'], [2, 'Joana']]) }).merges).toEqual([])
    // Named second person wins the merge.
    expect(clusterFaces(faces, {}, { names: new Map([[2, 'Ana']]) }).merges).toEqual([{ target: 2, source: 1 }])

    // A newly found group of Ana joins person 1 instead of becoming a new person.
    const fresh = [0, 1, 2].map((i) => ({ id: 500 + i, assetId: 600 + i, personId: null, quality: 0.9, rejected: [], vec: faceOf(ana) }))
    const r = clusterFaces([...faces.slice(0, 5), ...fresh])
    expect(r.newPeople).toEqual([])
    expect(r.assign.map((x) => x.personId)).toEqual([1, 1, 1])

    // Look-alikes (between "ask" and "merge") are suggested, not merged.
    const cousin = unit(ana.map((x, k) => x + (bruno[k] as number) * 0.85))
    const alike: ClusterFace[] = [
      ...faces.slice(0, 5),
      ...[0, 1, 2].map((i) => ({ id: 900 + i, assetId: 950 + i, personId: 1, quality: 0.9, rejected: [], vec: faceOf(ana) })), // 8 faces: worth asking about
      ...[0, 1, 2, 3].map((i) => ({ id: 700 + i, assetId: 800 + i, personId: 4, quality: 0.9, rejected: [], vec: faceOf(cousin) }))
    ]
    expect(clusterFaces(alike).merges).toEqual([])
    const sims = suggestSamePerson(alike, {}, 10)
    expect(sims.map((s) => [s.a, s.b])).toEqual([[1, 4]])
  })

  it('computes the landmark alignment exactly for a known transform', () => {
    const src = [10, 10, 30, 10, 20, 20, 12, 30, 28, 30]
    // dst = 2 × src rotated by 90° + (5, 7)
    const dst = src.flatMap((_, i) => (i % 2 ? [] : [5 - 2 * (src[i + 1] as number), 7 + 2 * (src[i] as number)]))
    const [a, b, tx, c, d, ty] = similarityTransform(src, dst)
    expect([a, b, tx, c, d, ty].map((x) => Math.round(x * 1000) / 1000)).toEqual([0, -2, 5, 2, 0, 7])
  })
})

describe('people in the library', () => {
  let sb: Sandbox
  let lib: Library
  beforeEach(() => {
    sb = sandbox()
    lib = openLibrary(sb.libraryRoot)
  })
  afterEach(() => {
    lib.close()
    sb.cleanup()
  })

  it('creates, names, merges and corrects people; names are searchable; deletion forgets faces', async () => {
    for (let i = 0; i < 8; i++) await makeJpeg(join(sb.source, `p${i}.jpg`), { color: `#${(i * 30 + 16).toString(16)}2040` })
    await runImport(lib, sb.source)
    const ids = assetIdsInRange(lib, undefined, 0, 20).sort((a, b) => a - b)
    const [ana, bruno] = [identity(), identity()]
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, score: 0.95, quality: 0.9 }
    ids.forEach((id, i) => recordFaceScan(lib, id, [{ ...box, vec: faceOf(i < 5 ? ana : bruno) }], 1))

    const created = applyClusterResult(lib, clusterFaces(loadClusterFaces(lib.db)))
    expect(created.created).toBe(2)
    let people = listPeople(lib)
    expect(people.map((p) => p.photos)).toEqual([5, 3])
    const [pa, pb] = people as [(typeof people)[0], (typeof people)[0]]

    expect(renamePerson(lib, pa.id, 'Ana Sousa').conflict).toBeNull()
    expect(renamePerson(lib, pb.id, 'ana sousa').conflict?.id).toBe(pa.id) // name taken: nothing changes
    expect(assetIdsInRange(lib, { text: 'sousa' }, 0, 20)).toHaveLength(5)
    expect(assetDetail(lib, ids[0] as number)!.people).toEqual([{ id: pa.id, name: 'Ana Sousa' }])

    // "Not this person" sticks across regrouping.
    expect(removeFromPerson(lib, pa.id, [ids[0] as number])).toBe(1)
    applyClusterResult(lib, clusterFaces(loadClusterFaces(lib.db)))
    expect(listPeople(lib).find((p) => p.id === pa.id)!.photos).toBe(4)
    expect(assetIdsInRange(lib, { personId: pa.id }, 0, 20)).not.toContain(ids[0])

    mergePeople(lib, pb.id, [pa.id]) // the target takes the source's name when it has none
    people = listPeople(lib)
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ id: pb.id, name: 'Ana Sousa', photos: 7 })

    // Undo the merge: Bruno comes back with his faces, and grouping never merges them again.
    const [merge] = personMerges(lib, pb.id)
    expect(merge).toMatchObject({ faces: 4, automatic: false, name: 'Ana Sousa' })
    const restored = undoMerge(lib, merge!.id)
    expect(listPeople(lib).map((p) => [p.id, p.photos]).sort()).toEqual([[pa.id, 4], [pb.id, 3]].sort())
    expect(restored).toBe(pa.id)
    applyClusterResult(lib, clusterFaces(loadClusterFaces(lib.db), {}, loadClusterContext(lib.db)))
    expect(listPeople(lib)).toHaveLength(2)
    expect(() => undoMerge(lib, merge!.id)).toThrow(/already undone/)

    // Move single faces: one of Ana's to a new person, then back.
    const face = personFaces(lib, pa.id)[0]!
    const newbie = moveFaces(lib, [face.id], { newName: 'Rita' })!
    expect(listPeople(lib).find((p) => p.id === newbie)).toMatchObject({ name: 'Rita', photos: 1 })
    moveFaces(lib, [face.id], { personId: pa.id })
    expect(listPeople(lib).some((p) => p.id === newbie)).toBe(false) // emptied person disappears
    mergePeople(lib, pb.id, [pa.id])

    moveToBin(lib, [ids[1] as number])
    expect(listPeople(lib)[0]!.photos).toBe(6)
    await deletePermanently(lib, [ids[1] as number])
    expect(lib.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM faces WHERE asset_id = ?', [ids[1]])!.n).toBe(0)

    clearFaceData(lib)
    expect(listPeople(lib)).toEqual([])
    expect(assetIdsInRange(lib, { text: 'sousa' }, 0, 20)).toEqual([])
  })
})
