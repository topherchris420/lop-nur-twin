/**
 * Individuality: can a digital fly come to behave as itself, in a way that
 * another fly built identically cannot reproduce just by being started?
 *
 * Every fly here has the same genesis: the same seed, the same body, the
 * same controller, placed at the same spot in the same yard. What differs is
 * what happens to it: when and where food appears, drawn for each fly and
 * applied as recorded life events (`continuity.ts`). The fly's controller
 * (the reduced-order one, unchanged) remembers where it fed
 * (`navigation.ts`); nothing here gives it anything it does not already have.
 *
 * The yard: 16 m square, open sky (the sun holds the fly's compass), four
 * feeding sites 5.5 m out at the compass points, each with a 2 m pole beside
 * it the fly can recognize from the centre. Food is one patch at a time.
 *
 * The probe. Behaviour after a life is read in one standard situation: no
 * food anywhere, the fly at the yard's centre at one of four headings, half
 * fed, for 300 s. Only the mind (the controller's state: its memory and its
 * random streams) is carried into it, as a fly picked up and set down is
 * carried; the body is placed fresh. So everything that differs between two
 * probes of the same start is in the mind, and the arms say which part:
 *
 * - `self`     the fly's own mind at the end of its life;
 * - `stored`   the same mind after the whole life was checkpointed to disk
 *              (`store.ts`), read back and restored (continuity);
 * - `replay`   the mind of another fly from the same genesis that lived the
 *              same recorded events (the history re-lived from its record);
 * - `erased`   the fly's own mind with its remembered places, visited cells,
 *              failed sites and goals removed; its random streams, path
 *              integration and everything else kept (a lesion);
 * - `genesis`  the mind of an identical fly that has not lived at all.
 *
 * Model choices, all of them, and named so: the yard, the sites, the probe,
 * the radii, the durations and the draws are this study's design, not
 * measurements of flies. Nothing here is a neural simulation.
 */
import { mulberry32 } from "../../lib/noise";
import { DigitalFly, FLY_VERSION } from "../fly/fly";
import { type ReducedOrderController } from "../fly/controller";
import type { NavigationState } from "../fly/navigation";
import {
  PrimitiveWorld,
  type FlyWorld,
  type FoodPatch,
  type Hit,
  type LandingSite,
  type Landmark,
  type LightSample,
  type Mover,
  type Perch,
  type PrimitiveWorldSpec,
} from "../fly/world";
import type { V3 } from "../fly/units";
import { canonicalJson, sha256 } from "../../rain/sha256";
import type { LifeEvent, LifeKind } from "./continuity";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot";

export const INDIVIDUALITY_VERSION = "fly-individuality/v1" as const;

/** One life tick (s): the city's tick, so a yard life steps as the city's fly does. */
export const TICK_S = 0.1;
export const SITE_NAMES = ["east", "north", "west", "south"] as const;
export type SiteName = (typeof SITE_NAMES)[number];
/** Feeding sites, 5.5 m out at the compass points (x, z; north is −z). */
export const SITES: Readonly<Record<SiteName, readonly [number, number]>> = {
  east: [5.5, 0],
  north: [0, -5.5],
  west: [-5.5, 0],
  south: [0, 5.5],
};
/** Each site's pole stands 0.7 m further out and 0.6 m to one side: 6.2–6.3 m from the centre. */
const POLE_OUT = 0.7,
  POLE_SIDE = 0.6;
/** A fly within this horizontal distance of a site is at it (m). */
export const AT_SITE_M = 1.5;
/** A food patch's radius (m). */
const PATCH_M = 0.25;
const HALF = 8;
/** The ground: a module-level function, so every yard shares it. */
const FLAT = (): number => 0;

export function yardSpec(
  food: { at: readonly [number, number] } | null,
): PrimitiveWorldSpec {
  return {
    id: "individuality-yard",
    home: {
      center: [0, 0, 0],
      radius: HALF,
      ceiling: 6,
      bounds: { min: { x: -HALF, z: -HALF }, max: { x: HALF, z: HALF } },
    },
    inputs: { supported: ["food", "sun", "poles"], proxies: [], unsupported: [] },
    ground: FLAT,
    groundMax: 0,
    ambient: 1,
    // The sun 45° up toward −z: the compass holds everywhere in the yard.
    sun: { toward: [0, Math.SQRT1_2, -Math.SQRT1_2], level: 1, shade: 0.35 },
    cylinders: SITE_NAMES.map((name) => {
      const [x, z] = SITES[name];
      const ux = Math.sign(x),
        uz = Math.sign(z);
      return {
        kind: "pole" as const,
        id: `pole-${name}`,
        x: x + ux * POLE_OUT + uz * POLE_SIDE,
        z: z + uz * POLE_OUT - ux * POLE_SIDE,
        r: 0.05,
        y0: 0,
        y1: 2,
      };
    }),
    food: food
      ? [
          {
            id: "fruit",
            kind: "fruit",
            center: [food.at[0], 0, food.at[1]],
            surface: "ground",
            radius: PATCH_M,
          },
        ]
      : [],
  };
}

/** Food now: which site and exactly where, or none. */
export interface FoodNow {
  site: SiteName;
  at: [number, number];
}

/** The yard as the fly lives in it: its geometry fixed, its food placed by events. */
export class FoodYard implements FlyWorld {
  readonly id: string;
  readonly home: FlyWorld["home"];
  readonly inputs: FlyWorld["inputs"];
  food: FoodNow | null = null;
  private now: PrimitiveWorld;
  constructor() {
    this.now = new PrimitiveWorld(yardSpec(null));
    this.id = this.now.id;
    this.home = this.now.home;
    this.inputs = this.now.inputs;
  }
  place(food: FoodNow | null): void {
    this.food = food ? { site: food.site, at: [food.at[0], food.at[1]] } : null;
    this.now = new PrimitiveWorld(yardSpec(this.food));
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.now.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.now.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.now.solid(p);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.now.movers(near, radius, out, t);
  }
  light(p: V3): LightSample {
    return this.now.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.now.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.now.foodAt(p);
  }
  odour(p: V3): number {
    return this.now.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.now.landmarks(near, radius, out);
  }
}

/** What every fly in this study is built from. */
export interface YardGenesis {
  seed: number;
  /** Share of a full reserve it is placed with. */
  startReserve: number;
  /** Heading it is placed at (rad), at the yard's centre. */
  yaw: number;
}
/** Every individual's genesis: one fly, hungry, at the centre facing east. */
export const GENESIS: YardGenesis = { seed: 0x1d1e5, startReserve: 0.5, yaw: 0 };

export class YardLife {
  readonly world: FoodYard;
  readonly fly: DigitalFly;
  tick = 0;
  constructor(g: YardGenesis) {
    this.world = new FoodYard();
    this.fly = new DigitalFly({
      seed: g.seed,
      world: this.world,
      start: { p: [0, 0.0011, 0], yaw: g.yaw },
      config: { startReserve: g.startReserve },
    });
  }
  step(ticks: number): void {
    for (let k = 0; k < ticks; k++) {
      this.fly.advance(TICK_S);
      this.tick++;
    }
  }
  get mind(): ReducedOrderController {
    return this.fly.adapter as ReducedOrderController;
  }
}

export const YARD_LIFE: LifeKind<YardGenesis, YardLife> = {
  id: "fly-yard-life",
  versions: { fly: FLY_VERSION, individuality: INDIVIDUALITY_VERSION },
  build: (g) => new YardLife(g),
  step: (life, ticks) => life.step(ticks),
  tick: (life) => life.tick,
  hash: (life) => `${life.fly.stateHash()}|${canonicalJson(life.world.food)}`,
  apply: (life, e) => {
    if (e.kind !== "food")
      throw new Error(`a yard life takes food events, not ${e.kind}`);
    const d = e.data as { site: SiteName | null; at?: [number, number] };
    life.world.place(d.site ? { site: d.site, at: d.at! } : null);
  },
  classes: [PrimitiveWorld],
};

/** Live `journal` (events in tick order) from the life's tick to `until`. */
export function live(life: YardLife, journal: readonly LifeEvent[], until: number): void {
  for (const e of journal) {
    if (e.tick < life.tick) continue;
    if (e.tick > until) break;
    life.step(e.tick - life.tick);
    YARD_LIFE.apply!(life, e);
  }
  life.step(until - life.tick);
}

// --- Lives ------------------------------------------------------------------

/** A draw in [lo, hi). */
const between = (u: () => number, lo: number, hi: number) => lo + u() * (hi - lo);

function foodEvent(tick: number, site: SiteName | null, u: () => number): LifeEvent {
  if (!site) return { tick, kind: "food", data: { site: null } };
  const [x, z] = SITES[site];
  // Within 0.3 m of the site's mark, so no two lives place it exactly alike.
  const r = 0.3 * Math.sqrt(u()),
    a = u() * 2 * Math.PI;
  const at: [number, number] = [
    Math.round((x + r * Math.cos(a)) * 1e4) / 1e4,
    Math.round((z + r * Math.sin(a)) * 1e4) / 1e4,
  ];
  return { tick, kind: "food", data: { site, at } };
}

/**
 * Study A's life: nothing for 0–60 s, then food at `site` for 600–1200 s.
 * `draw` is this life's experience stream (the host's entropy in a living
 * fly; a declared seed in the report).
 */
export function trainingLife(
  site: SiteName,
  draw: number,
): { journal: LifeEvent[]; end: number } {
  const u = mulberry32(draw);
  const onset = Math.round(between(u, 0, 60) / TICK_S);
  const end = onset + Math.round(between(u, 600, 1200) / TICK_S);
  return { journal: [foodEvent(onset, site, u)], end };
}

export interface Epoch {
  site: SiteName;
  /** First tick with food at this site. */
  from: number;
  to: number;
}

/**
 * Study B's life: food moves `epochs` times among the four sites (never to
 * the site it was just at), each stay 600–900 s.
 */
export function relocationLife(
  epochs: number,
  draw: number,
): { journal: LifeEvent[]; epochs: Epoch[]; end: number } {
  const u = mulberry32(draw);
  const journal: LifeEvent[] = [];
  const out: Epoch[] = [];
  let tick = 0,
    last: SiteName | null = null;
  for (let k = 0; k < epochs; k++) {
    const choices = SITE_NAMES.filter((s) => s !== last);
    const site = choices[Math.floor(u() * choices.length)]!;
    const length = Math.round(between(u, 600, 900) / TICK_S);
    journal.push(foodEvent(tick, site, u));
    out.push({ site, from: tick, to: tick + length });
    tick += length;
    last = site;
  }
  return { journal, epochs: out, end: tick };
}

// --- Minds ------------------------------------------------------------------

/** The lesion: remembered places, visited cells, failed sites, blocked headings and goals removed. */
export function eraseMemory(nav: NavigationState): void {
  nav.places = [];
  nav.visited = [];
  nav.failed = [];
  nav.blocked = [];
  nav.goal = null;
  nav.search = null;
}

/** The mind of `life` (its controller, with its streams and memory), as a graph snapshot. */
export function mindOf(life: YardLife) {
  return snapshotGraph(life.mind, indexGraph(new YardLife(GENESIS).mind));
}

/** sha256 of a mind, to say whether two minds are the same bytes. */
export const mindDigest = (life: YardLife) => sha256(JSON.stringify(mindOf(life)));

// --- The probe --------------------------------------------------------------

export const PROBE_S = 300;
export const PROBE_YAWS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] as const;
/** The reserve every probe starts with: half full, so hungry. */
export const PROBE_RESERVE = 0.5;

export interface ProbeResult {
  /** Seconds within `AT_SITE_M` of each site. */
  near: Record<SiteName, number>;
  /** The first site the fly came within `AT_SITE_M` of, and when (s), or null. */
  first: { site: SiteName; t: number } | null;
  /** Positions (x, z) each second, for trajectory comparisons. */
  track: [number, number][];
  /** sha256 of the probe fly's state hash at the end: equal means the same probe. */
  digest: string;
}

/**
 * Probe a mind: a fly placed fresh at the centre at heading `yaw`, with no
 * food, carrying `mind` (or its own innate mind when null), for `PROBE_S`.
 */
export function probe(
  mind: ReturnType<typeof mindOf> | null,
  yaw: number,
  seconds = PROBE_S,
): ProbeResult {
  const life = new YardLife({ ...GENESIS, startReserve: PROBE_RESERVE, yaw });
  if (mind) restoreGraph(structuredClone(mind), life.mind);
  // A carried mind keeps its own estimate of where it is: nothing tells it it was moved.
  // Seeing a pole it remembers puts it right, as recognizing a place does (navigation.ts).
  const near: Record<SiteName, number> = { east: 0, north: 0, west: 0, south: 0 };
  let first: ProbeResult["first"] = null;
  const track: [number, number][] = [];
  const ticks = Math.round(seconds / TICK_S);
  for (let k = 0; k < ticks; k++) {
    life.step(1);
    const p = life.fly.state.p;
    for (const s of SITE_NAMES) {
      const [x, z] = SITES[s];
      if (Math.hypot(p[0] - x, p[2] - z) < AT_SITE_M) {
        near[s] += TICK_S;
        if (!first) first = { site: s, t: life.tick * TICK_S };
      }
    }
    if (life.tick % 10 === 0) track.push([p[0], p[2]]);
  }
  for (const s of SITE_NAMES) near[s] = Math.round(near[s] * 10) / 10;
  return { near, first, track, digest: sha256(life.fly.stateHash()) };
}

/** Preference for `a` over `b` in a probe, in [−1, 1]; 0 when the fly went to neither. */
export function preference(r: ProbeResult, a: SiteName, b: SiteName): number {
  const ta = r.near[a],
    tb = r.near[b];
  return ta + tb > 0 ? (ta - tb) / (ta + tb) : 0;
}

/** Mean horizontal distance between two probe tracks (m). */
export function trackDistance(a: ProbeResult, b: ProbeResult): number {
  let d = 0;
  for (let i = 0; i < a.track.length; i++)
    d += Math.hypot(a.track[i]![0] - b.track[i]![0], a.track[i]![1] - b.track[i]![1]);
  return d / a.track.length;
}

// --- Study B: a life in which food keeps moving -------------------------------

export interface EpochResult {
  site: SiteName;
  /** Seconds from the food's arrival here to the fly's first meal here, or null if none. */
  latency: number | null;
  meals: number;
  /** Seconds feeding during the epoch. */
  feedS: number;
  /** Arrivals at the previous epoch's site after the food left it (perseveration). */
  staleArrivals: number;
  /** Food places the fly remembered at the epoch's end, and how many were where food no longer was. */
  remembered: number;
  staleRemembered: number;
}

/**
 * Live a relocation life, measuring each epoch. `amnesic` erases the fly's
 * memory after every tick (the lesion applied throughout).
 */
export function relocationRun(
  epochs: readonly Epoch[],
  journal: readonly LifeEvent[],
  amnesic: boolean,
  onEpochEnd?: (life: YardLife, k: number) => void,
): EpochResult[] {
  const life = new YardLife(GENESIS);
  const out: EpochResult[] = [];
  let ev = 0;
  for (const [k, ep] of epochs.entries()) {
    const prev = k > 0 ? epochs[k - 1]!.site : null;
    let latency: number | null = null,
      staleArrivals = 0,
      wasAtPrev = true;
    const meals0 = life.fly.state.counts.meals,
      feed0 = life.fly.state.counts.feedS;
    while (life.tick < ep.to) {
      while (ev < journal.length && journal[ev]!.tick === life.tick)
        YARD_LIFE.apply!(life, journal[ev++]!);
      life.step(1);
      if (amnesic) eraseMemory(life.mind.state.nav);
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
    const places = life.mind.state.nav.places;
    const [fx, fz] = life.world.food?.at ?? [NaN, NaN];
    out.push({
      site: ep.site,
      latency,
      meals: life.fly.state.counts.meals - meals0,
      feedS: Math.round((life.fly.state.counts.feedS - feed0) * 10) / 10,
      staleArrivals,
      remembered: places.length,
      staleRemembered: places.filter(
        (p) => Math.hypot(p.at[0] - fx, p.at[1] - fz) > AT_SITE_M,
      ).length,
    });
    onEpochEnd?.(life, k);
  }
  return out;
}
