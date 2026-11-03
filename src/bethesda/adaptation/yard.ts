/**
 * Research ECHO flies in Study B's yard: the deployed configuration
 * (`OrganismAdapter`), stepped as the organism's own life steps it
 * (physiology first, then the fly), with food placed only by recorded life
 * events. Each is born from a seed for this suite: none is the deployed
 * individual, a copy of it or a continuation of it, and nothing here opens a
 * store.
 *
 * A release is the code a fly runs on. A life is checkpointed and restored as
 * any life is (`continuity.ts`); moving a fly from one release to another is a
 * recorded continuation, never a rebuild (see `update.ts`).
 */
import { DigitalFly } from "../fly/fly.js";
import type { AdapterStreams } from "../fly/neural.js";
import type { NavigationState } from "../fly/navigation.js";
import { PrimitiveWorld } from "../fly/world.js";
import { DT } from "../simulation.js";
import { canonicalJson } from "../../rain/sha256.js";
import type { LifeEvent, LifeKind } from "../life/continuity.js";
import {
  FoodYard,
  INDIVIDUALITY_VERSION,
  TICK_S,
  type SiteName,
} from "../life/individuality.js";
import { ORGANISM_LIFE, OrganismAdapter } from "../life/organism.js";
import { ADAPTATION_SUITE } from "./benchmarks.js";

/** What every research fly is built from. Identical for every release: a release is not a birth. */
export interface FlyGenesis {
  seed: number;
  /** Share of a full reserve it is placed with. */
  startReserve: number;
  /** Heading at the yard's centre (rad). */
  yaw: number;
}

/** A release: the code a fly runs on, as the adapter it builds. */
export interface Release {
  name: string;
  /** Versions this release adds to the life's, beyond the organism's. */
  versions: Readonly<Record<string, string>>;
  adapter(rng: () => number, streams: AdapterStreams, seed: number): OrganismAdapter;
}

/** The deployed configuration, unchanged: the release every other is measured against. */
export const BASELINE: Release = {
  name: "baseline",
  versions: {},
  adapter: (rng, streams, seed) => new OrganismAdapter(rng, streams, seed),
};

/** The organism's own engine versions, without the city's: the yard replaces the city. */
const ORGANISM_VERSIONS = Object.fromEntries(
  ["fly", "echo", "organism", "mushroomBody", "olfaction", "physiology"].map((k) => {
    const v = ORGANISM_LIFE.versions[k];
    if (!v) throw new Error(`the organism has no ${k} version`);
    return [k, v];
  }),
);

/** Each life's release, kept beside it: a release is code, not state. */
const RELEASE_OF = new WeakMap<ResearchLife, Release>();

export class ResearchLife {
  readonly world: FoodYard;
  readonly fly: DigitalFly;
  tick = 0;
  constructor(g: FlyGenesis, release: Release) {
    RELEASE_OF.set(this, release);
    this.world = new FoodYard();
    this.fly = new DigitalFly({
      seed: g.seed,
      world: this.world,
      start: { p: [0, 0.0011, 0], yaw: g.yaw },
      config: { startReserve: g.startReserve },
      adapter: (rng, streams) => release.adapter(rng, streams, g.seed),
    });
  }
  get release(): Release {
    return RELEASE_OF.get(this)!;
  }
  get organism(): OrganismAdapter {
    return this.fly.adapter as OrganismAdapter;
  }
  /** Where the fly believes it is, and the places it remembers. */
  get nav(): NavigationState {
    return this.organism.inner.state.nav;
  }
  /** As `OrganismLife` steps the city's fly: maintenance into the reserve, then the body spends. */
  step(ticks: number): void {
    const a = this.organism,
      fly = this.fly;
    for (let i = 0; i < ticks; i++) {
      const capacity = fly.params.reserveJ;
      const supplied = a.physiology.advance(DT, {
        mode: fly.state.mode,
        reserve: Math.min(fly.state.reserve, capacity),
        capacity,
      });
      if (supplied > 0)
        fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      fly.advance(TICK_S);
      this.tick++;
    }
  }
}

/** Apply a recorded food event (`individuality.ts`'s form) to a research life. */
export function applyFood(life: ResearchLife, e: LifeEvent): void {
  if (e.kind !== "food")
    throw new Error(`a research yard takes food events, not ${e.kind}`);
  const d = e.data as { site: SiteName | null; at?: [number, number] };
  life.world.place(d.site ? { site: d.site, at: d.at! } : null);
}

/** The life kind of a release: the same id for every release, so one individual can move between them. */
export function researchKind(release: Release): LifeKind<FlyGenesis, ResearchLife> {
  return {
    id: "echo-adaptation-research-life",
    versions: {
      ...ORGANISM_VERSIONS,
      yard: INDIVIDUALITY_VERSION,
      suite: ADAPTATION_SUITE,
      ...release.versions,
    },
    build: (g) => new ResearchLife(g, release),
    step: (life, ticks) => life.step(ticks),
    tick: (life) => life.tick,
    hash: (life) => `${life.fly.stateHash()}|${canonicalJson(life.world.food)}`,
    apply: applyFood,
    classes: [PrimitiveWorld],
  };
}

export const BASELINE_KIND = researchKind(BASELINE);
