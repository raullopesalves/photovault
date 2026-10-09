import { FACE_DIM } from './faces'

/**
 * Grouping faces into people (SFace vectors, cosine similarity).
 *
 * Similarity between a face and a group is the AVERAGE similarity to the group's faces (average linkage:
 * dot(face, Σ group) / n). Unlike comparing with a normalised mean face, this does not get looser as a
 * group grows, so look-alikes do not snowball into one person. Two faces on the same photo are never the
 * same person.
 *
 * Stable and incremental, so the user's work is never undone:
 *   1. faces already in a person stay there (only the user moves them);
 *   2. each new face joins the closest existing person if it is close enough — unless the user said
 *      "not this person" for that face, or that person is already on the same photo;
 *   3. the remaining good faces are clustered among themselves (best faces first, then merging groups
 *      that are close on average); groups with faces on enough photos become new (unnamed) people;
 *   4. weak faces (small, blurry) only join a person; they never start one.
 */
export const PEOPLE = {
  /** A new face joins an existing person at this average similarity. */
  joinPerson: 0.5,
  /** A face joins a forming group at this average similarity. */
  joinCluster: 0.5,
  /** Forming groups merge at this average similarity between their faces. */
  mergeClusters: 0.45,
  /** A new person needs faces on at least this many different photos. */
  minPhotos: 3,
  /** Only faces at least this good (sharp, large, confident) can start or shape a new person. */
  minQuality: 0.5,
  /**
   * Two people merge automatically at this average similarity between their faces — as alike as the faces
   * of one person usually are (0.52–0.65 on a real library). Measured: every pair ≥ 0.5 was one person.
   */
  mergePeople: 0.5,
  /** Below that, down to here, people are suggested for review ("Same person?"); most are, some are look-alikes. */
  suggestMin: 0.42,
  /** Only ask about pairs where one of the two has at least this many faces (merging small groups matters little). */
  suggestMinFaces: 8
} as const

export interface ClusterContext {
  /** Pairs of person ids the user said are different people ("a:b", a < b). */
  notSame?: Set<string>
  /** Person names; two differently named people never merge automatically. */
  names?: Map<number, string | null>
}

export const pairKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`

export interface ClusterFace {
  id: number
  assetId: number
  personId: number | null
  quality: number
  rejected: number[]
  vec: Float32Array
}

export interface ClusterResult {
  /** New faces that join existing people. */
  assign: Array<{ faceId: number; personId: number }>
  /** New people to create: their face ids. */
  newPeople: number[][]
  /** Existing people to merge, applied in order: every face of `source` moves to `target`. */
  merges: Array<{ target: number; source: number }>
}

interface Group {
  sum: Float32Array
  n: number
  assets: Set<number>
  faces: number[]
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let k = 0; k < FACE_DIM; k++) s += (a[k] as number) * (b[k] as number)
  return s
}

function add(g: Group, f: ClusterFace): void {
  for (let k = 0; k < FACE_DIM; k++) g.sum[k] = (g.sum[k] as number) + (f.vec[k] as number)
  g.n++
  g.assets.add(f.assetId)
  g.faces.push(f.id)
}

const newGroup = (): Group => ({ sum: new Float32Array(FACE_DIM), n: 0, assets: new Set(), faces: [] })

/** Average similarity of a face to a group's faces. */
const affinity = (f: ClusterFace, g: Group): number => dot(f.vec, g.sum) / g.n

function personGroups(faces: ClusterFace[]): Map<number, Group> {
  const people = new Map<number, Group>()
  for (const f of faces) {
    if (f.personId === null) continue
    let g = people.get(f.personId)
    if (!g) people.set(f.personId, (g = newGroup()))
    add(g, f)
  }
  return people
}

const shareAPhoto = (a: Group, b: Group): boolean => {
  const [small, big] = a.assets.size < b.assets.size ? [a, b] : [b, a]
  for (const id of small.assets) if (big.assets.has(id)) return true
  return false
}

/** Average similarity between the faces of two groups. */
const groupSim = (a: Group, b: Group): number => dot(a.sum, b.sum) / (a.n * b.n)

/** Pairs of people at least `min` alike (average linkage), most alike first. */
function peoplePairs(people: Map<number, Group>, min: number, ctx: ClusterContext): Array<{ a: number; b: number; sim: number }> {
  const ids = [...people.keys()]
  const out: Array<{ a: number; b: number; sim: number }> = []
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as number
      const b = ids[j] as number
      if (ctx.notSame?.has(pairKey(a, b))) continue
      const ga = people.get(a) as Group
      const gb = people.get(b) as Group
      const sim = groupSim(ga, gb)
      if (sim >= min && !shareAPhoto(ga, gb)) out.push({ a, b, sim })
    }
  }
  return out.sort((x, y) => y.sim - x.sim)
}

const differentNames = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() !== b.trim().toLowerCase()

/**
 * Merges existing people that are as alike as one person's own faces (in place). Greedy, most alike first,
 * re-checking the merged groups each time so A~B and B~C never drag a dissimilar A and C together.
 */
function mergeExistingPeople(people: Map<number, Group>, min: number, ctx: ClusterContext): ClusterResult['merges'] {
  const merges: ClusterResult['merges'] = []
  const root = new Map<number, number>()
  const find = (id: number): number => {
    while (root.has(id)) id = root.get(id) as number
    return id
  }
  const members = new Map<number, number[]>([...people.keys()].map((id) => [id, [id]]))
  const name = (id: number): string | null => (members.get(id) ?? []).map((m) => ctx.names?.get(m) ?? null).find((x) => x) ?? null
  for (const pair of peoplePairs(people, min, ctx)) {
    const ra = find(pair.a)
    const rb = find(pair.b)
    if (ra === rb) continue
    const ga = people.get(ra) as Group
    const gb = people.get(rb) as Group
    if (differentNames(name(ra), name(rb)) || shareAPhoto(ga, gb) || groupSim(ga, gb) < min) continue
    const ma = members.get(ra) ?? []
    const mb = members.get(rb) ?? []
    if (ma.some((x) => mb.some((y) => ctx.notSame?.has(pairKey(x, y))))) continue
    // Keep the named person, else the one with more faces.
    const [target, source] = (name(rb) && !name(ra)) || (!!name(rb) === !!name(ra) && gb.n > ga.n) ? [rb, ra] : [ra, rb]
    const gt = people.get(target) as Group
    const gs = people.get(source) as Group
    for (let k = 0; k < FACE_DIM; k++) gt.sum[k] = (gt.sum[k] as number) + (gs.sum[k] as number)
    gt.n += gs.n
    for (const id of gs.assets) gt.assets.add(id)
    gt.faces.push(...gs.faces)
    people.delete(source)
    root.set(source, target)
    members.set(target, [...(members.get(target) ?? []), ...(members.get(source) ?? [])])
    merges.push({ target, source })
  }
  return merges
}

/** "Same person?" candidates for the user: people alike enough to ask about, but not enough to merge. */
export function suggestSamePerson(faces: ClusterFace[], ctx: ClusterContext = {}, limit = 50): Array<{ a: number; b: number; sim: number }> {
  const people = personGroups(faces)
  return peoplePairs(people, PEOPLE.suggestMin, ctx)
    .filter(
      (p) =>
        p.sim < PEOPLE.mergePeople &&
        Math.max((people.get(p.a) as Group).n, (people.get(p.b) as Group).n) >= PEOPLE.suggestMinFaces &&
        !differentNames(ctx.names?.get(p.a), ctx.names?.get(p.b))
    )
    .slice(0, limit)
}

export function clusterFaces(faces: ClusterFace[], params: Partial<Record<keyof typeof PEOPLE, number>> = {}, ctx: ClusterContext = {}): ClusterResult {
  const P = { ...PEOPLE, ...params }

  // 1. Existing people — merging those that are clearly one person (e.g. found in different scan batches).
  const people = personGroups(faces)
  const merges = mergeExistingPeople(people, P.mergePeople, ctx)

  // 2. New faces → closest existing person.
  const assign: ClusterResult['assign'] = []
  const rest: ClusterFace[] = []
  for (const f of faces) {
    if (f.personId !== null) continue
    let best: number | null = null
    let bestSim: number = P.joinPerson
    for (const [id, g] of people) {
      if (g.assets.has(f.assetId) || f.rejected.includes(id)) continue
      const s = affinity(f, g)
      if (s >= bestSim) {
        bestSim = s
        best = id
      }
    }
    if (best !== null) assign.push({ faceId: f.id, personId: best })
    else rest.push(f)
  }

  // 3. Cluster the good remaining faces, best first.
  const good = rest.filter((f) => f.quality >= P.minQuality).sort((a, b) => b.quality - a.quality)
  const weak = rest.filter((f) => f.quality < P.minQuality)
  const groups: Group[] = []
  for (const f of good) {
    let best: Group | null = null
    let bestSim: number = P.joinCluster
    for (const g of groups) {
      if (g.assets.has(f.assetId)) continue
      const s = affinity(f, g)
      if (s >= bestSim) {
        bestSim = s
        best = g
      }
    }
    if (!best) groups.push((best = newGroup()))
    add(best, f)
  }

  // Merge groups that are close on average (largest first) — one person split by age, light or angle.
  // One pass, O(groups²): each group absorbs the later (smaller) groups that are close to it.
  const live = groups.filter((g) => g.n > 1).sort((a, b) => b.n - a.n)
  for (let x = 0; x < live.length; x++) {
    const a = live[x] as Group
    for (let y = x + 1; y < live.length; ) {
      const b = live[y] as Group
      if (![...b.assets].some((id) => a.assets.has(id)) && dot(a.sum, b.sum) / (a.n * b.n) >= P.mergeClusters) {
        for (let k = 0; k < FACE_DIM; k++) a.sum[k] = (a.sum[k] as number) + (b.sum[k] as number)
        a.n += b.n
        for (const id of b.assets) a.assets.add(id)
        a.faces.push(...b.faces)
        live.splice(y, 1)
      } else y++
    }
  }

  const born = live.filter((g) => g.assets.size >= P.minPhotos)
  // 4. Weak faces may join a new person when they clearly match it.
  for (const f of weak) {
    let best: Group | null = null
    let bestSim: number = P.joinPerson
    for (const g of born) {
      if (g.assets.has(f.assetId)) continue
      const s = affinity(f, g)
      if (s >= bestSim) {
        bestSim = s
        best = g
      }
    }
    if (best) add(best, f)
  }

  // 5. A new group that matches an existing person joins them instead of becoming a new person.
  const newPeople: number[][] = []
  for (const g of born) {
    let best: number | null = null
    let bestSim: number = P.mergePeople
    for (const [id, pg] of people) {
      if (shareAPhoto(g, pg)) continue
      const sim = groupSim(g, pg)
      if (sim >= bestSim) {
        bestSim = sim
        best = id
      }
    }
    if (best !== null) for (const faceId of g.faces) assign.push({ faceId, personId: best })
    else newPeople.push(g.faces)
  }
  return { assign, newPeople, merges }
}
