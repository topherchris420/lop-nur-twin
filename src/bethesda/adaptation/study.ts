/**
 * One research individual, lived through every arm the benchmarks need, on one
 * release. Studies A and B's protocols (`individuality.ts`) unchanged: the same
 * yard, sites, events, probe and lesion; only the fly is the deployed ECHO
 * configuration instead of the reduced-order controller alone.
 *
 * - **A** (B1, C1): fed at one site for a drawn spell; its mind probed in the
 *   empty yard from four headings, as its own, erased, and after a checkpoint
 *   went to text and back.
 * - **B** (B2, M1, C1–C4): food moved eight times. Lived with memory and with
 *   the lesion every tick; checkpointed after epoch 4, and from there restored
 *   and lived on (a restart), twinned (a copy), and, for a release that is an
 *   update, continued onto it (`update.ts`).
 *
 * Deterministic: the same split, individual and release give the same record,
 * byte for byte, on the same platform.
 */
import { sha256 } from "../../rain/sha256.js";
import {
  birth,
  checkpointLife,
  restoreLife,
  twinCheckpoint,
  type Birth,
  type LifeCheckpoint,
  type LifeEvent,
  type LifeKind,
} from "../life/continuity.js";
import {
  AT_SITE_M,
  eraseMemory,
  PROBE_RESERVE,
  PROBE_S,
  PROBE_YAWS,
  relocationLife,
  SITE_NAMES,
  SITES,
  TICK_S,
  trainingLife,
  type Epoch,
  type SiteName,
} from "../life/individuality.js";
import { indexGraph, restoreGraph, snapshotGraph } from "../life/snapshot.js";
import {
  ADAPTATION_SUITE,
  BREAK_AFTER_EPOCHS,
  EPOCHS,
  type Split,
} from "./benchmarks.js";
import {
  applyFood,
  BASELINE_KIND,
  ResearchLife,
  type FlyGenesis,
  type Release,
} from "./yard.js";

const r4 = (x: number) => Number(x.toPrecision(4));
const OPPOSITE: Record<SiteName, SiteName> = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
};

export const genesisOf = (split: Split): FlyGenesis => ({
  seed: split.genesisSeed,
  startReserve: 0.5,
  yaw: 0,
});

// ------------------------------------------------------------------ minds

type Mind = ReturnType<typeof snapshotGraph>;

/** The fly's controller, with its memory, circuit, self-model, physiology and streams. */
export function mindOf(life: ResearchLife, g: FlyGenesis): Mind {
  const fresh = new ResearchLife(g, life.release);
  return snapshotGraph(life.fly.adapter, indexGraph(fresh.fly.adapter));
}

export interface ProbeRow {
  yaw: number;
  /** Preference for the fed site over the opposite one, in [−1, 1]. */
  preference: number;
  first: SiteName | null;
  /** The probe fly's state hash at the end, shortened: equal means the same probe. */
  digest: string;
}

/** Study A's probe: a fresh fly at the centre, hungry, with no food, carrying `mind`. */
export function probe(
  mind: Mind,
  yaw: number,
  g: FlyGenesis,
  release: Release,
  trained: SiteName,
): ProbeRow {
  const life = new ResearchLife({ ...g, startReserve: PROBE_RESERVE, yaw }, release);
  restoreGraph(structuredClone(mind), life.fly.adapter);
  const near: Record<SiteName, number> = { east: 0, north: 0, west: 0, south: 0 };
  let first: SiteName | null = null;
  for (let k = 0; k < Math.round(PROBE_S / TICK_S); k++) {
    life.step(1);
    const p = life.fly.state.p;
    for (const s of SITE_NAMES)
      if (Math.hypot(p[0] - SITES[s][0], p[2] - SITES[s][1]) < AT_SITE_M) {
        near[s] += TICK_S;
        first ??= s;
      }
  }
  const a = near[trained],
    b = near[OPPOSITE[trained]];
  return {
    yaw: r4(yaw),
    preference: a + b > 0 ? r4((a - b) / (a + b)) : 0,
    first,
    digest: sha256(life.fly.stateHash()).slice(0, 16),
  };
}

// ----------------------------------------------------------------- epochs

export interface EpochRow {
  site: SiteName;
  /** Seconds from the food's arrival to the first meal at it, or null. */
  latency: number | null;
  meals: number;
  /** Arrivals at the previous epoch's site after the food left it. */
  staleArrivals: number;
  /** Food places remembered at the epoch's end, and how many were where food no longer was. */
  remembered: number;
  staleRemembered: number;
}

/** Live `epochs` from index `from` on, applying `journal`'s events as their ticks come. */
export function liveEpochs(
  life: ResearchLife,
  epochs: readonly Epoch[],
  journal: readonly LifeEvent[],
  from: number,
  o: { amnesic?: boolean; onEpochEnd?: (k: number) => void } = {},
): EpochRow[] {
  const out: EpochRow[] = [];
  let ev = journal.findIndex((e) => e.tick >= life.tick);
  if (ev < 0) ev = journal.length;
  for (let k = from; k < epochs.length; k++) {
    const ep = epochs[k]!;
    const prev = k > 0 ? epochs[k - 1]!.site : null;
    let latency: number | null = null,
      staleArrivals = 0,
      wasAtPrev = true;
    const meals0 = life.fly.state.counts.meals;
    while (life.tick < ep.to) {
      while (ev < journal.length && journal[ev]!.tick === life.tick)
        applyFood(life, journal[ev++]!);
      life.step(1);
      if (o.amnesic) eraseMemory(life.nav);
      const s = life.fly.state;
      const at = (site: SiteName) =>
        Math.hypot(s.p[0] - SITES[site][0], s.p[2] - SITES[site][1]) < AT_SITE_M;
      if (latency === null && s.mode === "feed" && at(ep.site))
        latency = Math.round((life.tick - ep.from) * TICK_S * 10) / 10;
      if (prev) {
        const here = at(prev);
        if (here && !wasAtPrev) staleArrivals++;
        wasAtPrev = here;
      }
    }
    const places = life.nav.places;
    const [fx, fz] = life.world.food?.at ?? [NaN, NaN];
    out.push({
      site: ep.site,
      latency,
      meals: life.fly.state.counts.meals - meals0,
      staleArrivals,
      remembered: places.length,
      staleRemembered: places.filter(
        (p) => Math.hypot(p.at[0] - fx, p.at[1] - fz) > AT_SITE_M,
      ).length,
    });
    o.onEpochEnd?.(k);
  }
  return out;
}

/** Through text and back, as a checkpoint leaves one process and reaches another. */
const throughText = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ----------------------------------------------------------------- record

export interface UpdatedArm {
  /** The continuation was accepted, kept the individual, birth, genesis and tick, and its projection is the parent's digest. */
  kept: boolean;
  /** Why not, when it was not. */
  refused: string | null;
  laterEpochs: EpochRow[];
}

export interface IndividualRecord {
  suite: typeof ADAPTATION_SUITE;
  split: Split["name"];
  release: string;
  versions: Record<string, string>;
  k: number;
  individual: string;
  a: {
    site: SiteName;
    meals: number;
    remembered: number;
    probes: { self: ProbeRow[]; erased: ProbeRow[]; restored: ProbeRow[] };
    /** The mind after a checkpoint went to text and back is the same bytes. */
    restoredMindSame: boolean;
  };
  b: {
    memory: EpochRow[];
    lesion: EpochRow[];
    /** The memory life's state hash at the end, shortened. */
    finalHash: string;
    restart: { identical: boolean; laterEpochs: EpochRow[]; finalHash: string };
    twin: { newId: boolean; recordsParent: boolean; cannotContinue: boolean };
    /** Present when the release is an update of the baseline. */
    updated: UpdatedArm | null;
  };
}

/** Continue a baseline checkpoint onto another release; supplied by `update.ts` for an update. */
export type Continue = (
  source: LifeCheckpoint<FlyGenesis>,
) => { life: ResearchLife } | { refused: string };

export interface RunOptions {
  split: Split;
  k: number;
  release: Release;
  kind: LifeKind<FlyGenesis, ResearchLife>;
  /** For an update: how a baseline life at the break is moved onto `release`. */
  continueFrom?: Continue;
}

export function runIndividual(o: RunOptions): IndividualRecord {
  const { split, k, release, kind } = o;
  const g = genesisOf(split);
  const b0: Birth = birth(kind.id, g, split.nonces[k]!);

  // --- A: fed at one site; the mind probed as its own, erased, and restored.
  const site: SiteName = k % 2 ? "west" : "east";
  const training = trainingLife(site, split.training[k]!);
  const lifeA = kind.build(structuredClone(g));
  const bornA = checkpointLife(kind, lifeA, { genesis: g, birth: b0, previous: null });
  for (const e of training.journal) {
    lifeA.step(e.tick - lifeA.tick);
    applyFood(lifeA, e);
  }
  lifeA.step(training.end - lifeA.tick);
  const restoredA = restoreLife(
    kind,
    throughText(
      checkpointLife(kind, lifeA, {
        genesis: g,
        birth: b0,
        previous: bornA,
        events: training.journal,
      }),
    ),
  );
  const self = mindOf(lifeA, g);
  const erasedLife = kind.build(structuredClone(g));
  restoreGraph(structuredClone(self), erasedLife.fly.adapter);
  eraseMemory(erasedLife.nav);
  const minds = {
    self,
    erased: mindOf(erasedLife, g),
    restored: mindOf(restoredA, g),
  };
  const probes = {
    self: PROBE_YAWS.map((y) => probe(minds.self, y, g, release, site)),
    erased: PROBE_YAWS.map((y) => probe(minds.erased, y, g, release, site)),
    restored: PROBE_YAWS.map((y) => probe(minds.restored, y, g, release, site)),
  };

  // --- B: food that keeps moving.
  const reloc = relocationLife(EPOCHS, split.relocation[k]!);
  const lifeB = kind.build(structuredClone(g));
  const bornB = checkpointLife(kind, lifeB, { genesis: g, birth: b0, previous: null });
  let atBreak: LifeCheckpoint<FlyGenesis> | null = null;
  const memory = liveEpochs(lifeB, reloc.epochs, reloc.journal, 0, {
    onEpochEnd: (e) => {
      if (e !== BREAK_AFTER_EPOCHS - 1) return;
      atBreak = checkpointLife(kind, lifeB, {
        genesis: g,
        birth: b0,
        previous: bornB,
        events: reloc.journal.filter((x) => x.tick < lifeB.tick),
      });
    },
  });
  const finalHash = sha256(kind.hash(lifeB)).slice(0, 16);
  const lesion = liveEpochs(
    kind.build(structuredClone(g)),
    reloc.epochs,
    reloc.journal,
    0,
    { amnesic: true },
  );
  const cp = atBreak as LifeCheckpoint<FlyGenesis> | null;
  if (!cp) throw new Error("no checkpoint at the break");

  // A restart: the checkpoint through text, restored (verified), lived on.
  const restarted = restoreLife(kind, throughText(cp));
  const later = liveEpochs(restarted, reloc.epochs, reloc.journal, BREAK_AFTER_EPOCHS);
  const restartHash = sha256(kind.hash(restarted)).slice(0, 16);

  // A copy: someone new, with its parentage, who cannot continue the original.
  const twin = twinCheckpoint(cp, sha256(`twin|${split.nonces[k]!}`).slice(0, 32));
  let cannotContinue = false;
  try {
    checkpointLife(kind, restoreLife(kind, twin), {
      genesis: g,
      birth: twin.birth,
      previous: cp,
    });
  } catch {
    cannotContinue = true;
  }

  // An update: the baseline's life at the break, continued onto this release.
  let updated: UpdatedArm | null = null;
  if (o.continueFrom) {
    const base = baselineAtBreak(split, k);
    const moved = o.continueFrom(base);
    updated =
      "refused" in moved
        ? { kept: false, refused: moved.refused, laterEpochs: [] }
        : {
            kept: true,
            refused: null,
            laterEpochs: liveEpochs(
              moved.life,
              reloc.epochs,
              reloc.journal,
              BREAK_AFTER_EPOCHS,
            ),
          };
  }

  return {
    suite: ADAPTATION_SUITE,
    split: split.name,
    release: release.name,
    versions: { ...kind.versions },
    k,
    individual: b0.individual,
    a: {
      site,
      meals: lifeA.fly.state.counts.meals,
      remembered: lifeA.nav.places.length,
      probes,
      restoredMindSame:
        sha256(JSON.stringify(minds.restored)) === sha256(JSON.stringify(minds.self)),
    },
    b: {
      memory,
      lesion,
      finalHash,
      restart: {
        identical:
          restartHash === finalHash &&
          JSON.stringify(later) === JSON.stringify(memory.slice(BREAK_AFTER_EPOCHS)),
        laterEpochs: later,
        finalHash: restartHash,
      },
      twin: {
        newId: twin.birth.individual !== cp.birth.individual,
        recordsParent:
          twin.birth.twinOf?.individual === cp.birth.individual &&
          twin.birth.twinOf.digest === cp.digest,
        cannotContinue,
      },
      updated,
    },
  };
}

/** The baseline individual's checkpoint after epoch 4 of its relocation life: what an update starts from. */
export function baselineAtBreak(split: Split, k: number): LifeCheckpoint<FlyGenesis> {
  const g = genesisOf(split);
  const kind = BASELINE_KIND;
  const b0 = birth(kind.id, g, split.nonces[k]!);
  const reloc = relocationLife(EPOCHS, split.relocation[k]!);
  const life = kind.build(structuredClone(g));
  const born = checkpointLife(kind, life, { genesis: g, birth: b0, previous: null });
  const last = reloc.epochs[BREAK_AFTER_EPOCHS - 1]!;
  liveEpochs(life, reloc.epochs.slice(0, BREAK_AFTER_EPOCHS), reloc.journal, 0);
  if (life.tick !== last.to) throw new Error("the baseline did not reach the break");
  return checkpointLife(kind, life, {
    genesis: g,
    birth: b0,
    previous: born,
    events: reloc.journal.filter((x) => x.tick < life.tick),
  });
}
