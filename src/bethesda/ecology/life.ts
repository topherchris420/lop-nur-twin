/**
 * A research fly living in the ecology, or the ecology with no fly at all.
 *
 * Two clocks: the ecosystem steps once a second, the fly ten times a second
 * (its body 200 times). Whatever the fly does to the world in a second is
 * gathered (the sugar its body took while feeding, from the item under its
 * feet, and, on fruit, the seconds it fed there) and applied as recorded
 * interactions at the end of that second, before the ecosystem lives the
 * next. So the ecosystem is a function of its seed and those records alone:
 * one stepped bare and handed the records reproduces it exactly, and with no
 * fly it steps exactly as it does beside one that never feeds (tests check).
 * The fly sees the item as it was at the start of the second it feeds in.
 *
 * The fly is the deployed configuration (`OrganismAdapter`), stepped as the
 * adaptation suite's research lives step it: its maintenance physiology
 * first, then the body. Every subject is built from a seed and named
 * `research-…`; none is Eva or ECHO.
 */
import { refuseOriginal } from "../firstContact/originals.js";
import { DigitalFly } from "../fly/fly.js";
import { PERCHED } from "../fly/neural.js";
import type { V3 } from "../fly/units.js";
import { OrganismAdapter } from "../life/organism.js";
import { canonicalJson } from "../../rain/sha256.js";
import { indexGraph, restoreGraph, snapshotGraph } from "../life/snapshot.js";
import { Ecosystem, type EcosystemSpec, type Interaction } from "./ecosystem.js";
import { Homeostasis, homeostasisParam } from "./homeostasis.js";
import { P } from "./params.js";
import { FeedingHybridAdapter, type FeedingBrain } from "./connectome/feeding.js";
import { HomeostaticAdapter } from "./policy.js";
import { EcologyWorld, WET_GROUND_MM } from "./world.js";

export const TICK_S = 0.1;

export interface FlyGenesis {
  /** The research subject's id: `research-…`. */
  subject: string;
  seed: number;
  start: [number, number];
  yaw: number;
  startReserve: number;
}

/**
 * The body a research fly lives in. `deployed` is the deployed configuration,
 * whose artificial maintenance keeps it from dying (Stage A). `mortal` replaces
 * that maintenance with environment-driven homeostasis (`homeostasis.ts`): it
 * can desiccate, overheat or starve, and is for disposable research subjects
 * only. A mortal body may carry homeostatic feedback policies (`policy.ts`).
 */
export type BodyOptions =
  | { kind: "deployed" }
  | {
      kind: "mortal";
      thirst: boolean;
      thermal: boolean;
      /** The thirst policy's humidity read at a displaced point (the shuffled-sense control). */
      hygroOffset?: [number, number];
    };

export class EcologicalLife {
  readonly eco: Ecosystem;
  readonly world: EcologyWorld;
  readonly fly: DigitalFly | null;
  readonly subject: string | null;
  tick = 0;
  private fedJ = 0;
  private feedS = 0;
  /** This second's feeding, by item: sugar the body took (mg) and seconds fed. */
  private readonly pending = new Map<string, { mg: number; s: number; fruit: boolean }>();
  /** Energy the maintenance physiology supplied (J): artificial, kept apart from food. */
  maintenanceJ = 0;
  /** A mortal body's homeostasis, or null in the deployed configuration. */
  readonly homeostasis: Homeostasis | null = null;
  readonly policies: HomeostaticAdapter | null = null;
  /** The connectome hybrid's feeding decision, or null when the controller decides (Stage C). */
  readonly feeding: FeedingHybridAdapter | null = null;
  readonly body: BodyOptions;
  /** This second's drinking, by cell (mm). */
  private readonly drinks = new Map<number, number>();
  /** The ecosystem's time when the fly was placed (s). */
  readonly offsetS: number;
  /**
   * `from`: an ecosystem of this spec that has already lived (`spinUp`); the
   * fly is placed in it as it is. Without one the world begins with the fly.
   * `brain`: who decides feeding (`connectome/feeding.ts`); by default the
   * controller, as in the deployed configuration.
   */
  constructor(
    spec: EcosystemSpec,
    fly: FlyGenesis | null,
    body: BodyOptions = { kind: "deployed" },
    from?: Ecosystem,
    brain: FeedingBrain = { kind: "controller" },
  ) {
    if (from && canonicalJson(from.spec) !== canonicalJson(spec))
      throw new Error("a fly is placed in an ecosystem of its own spec");
    this.eco = from ?? new Ecosystem(spec);
    this.offsetS = this.eco.t;
    this.world = new EcologyWorld(this.eco);
    this.world.timeOffsetS = this.offsetS;
    this.body = body;
    if (!fly) {
      this.fly = null;
      this.subject = null;
      return;
    }
    refuseOriginal(fly.subject, "ecology subject");
    if (!fly.subject.startsWith("research-"))
      throw new Error("an ecology subject's id starts with research-");
    this.subject = fly.subject;
    const homeostasis =
      body.kind === "mortal" ? new Homeostasis(this.eco.weather.tempC) : null;
    (this as { homeostasis: Homeostasis | null }).homeostasis = homeostasis;
    this.fly = new DigitalFly({
      seed: fly.seed,
      world: this.world,
      start: { p: [fly.start[0], 0.0011, fly.start[1]], yaw: fly.yaw },
      config: { startReserve: fly.startReserve },
      adapter: (rng, streams) => {
        const controller = this.controllerStack(
          rng,
          streams,
          fly.seed,
          spec,
          body,
          homeostasis,
        );
        if (brain.kind === "controller") return controller;
        const feeding = new FeedingHybridAdapter(controller, brain, fly.seed);
        (this as { feeding: FeedingHybridAdapter | null }).feeding = feeding;
        return feeding;
      },
    });
  }

  /** The deployed controller, with a mortal body's homeostatic policies over it when it has any. */
  private controllerStack(
    rng: ConstructorParameters<typeof OrganismAdapter>[0],
    streams: ConstructorParameters<typeof OrganismAdapter>[1],
    seed: number,
    spec: EcosystemSpec,
    body: BodyOptions,
    homeostasis: Homeostasis | null,
  ): OrganismAdapter | HomeostaticAdapter {
    const organism = new OrganismAdapter(rng, streams, seed);
    if (body.kind !== "mortal" || (!body.thirst && !body.thermal)) return organism;
    const off = body.hygroOffset ?? [0, 0];
    const half = spec.half;
    // A displaced point folded back into the yard, for the shuffled-sense control.
    const fold = (v: number) => {
      const span = 2 * half;
      const u = (((v + half) % span) + span) % span;
      return u - half;
    };
    const policies = new HomeostaticAdapter(organism, homeostasis!, {
      thirst: body.thirst,
      thermal: body.thermal,
      seed,
      hygroAt: (p: V3) =>
        this.world.humidityAt([fold(p[0] + off[0]), p[1], fold(p[2] + off[1])]),
      wetUnderfoot: (p: V3) =>
        p[1] < 0.01 && this.eco.soilWaterAt(p[0], p[2]) >= WET_GROUND_MM,
    });
    (this as { policies: HomeostaticAdapter | null }).policies = policies;
    return policies;
  }

  get organism(): OrganismAdapter | null {
    if (!this.fly) return null;
    let a = this.fly.adapter;
    if (a instanceof FeedingHybridAdapter) a = a.inner;
    return (a instanceof HomeostaticAdapter ? a.inner : a) as OrganismAdapter;
  }

  /** Whether the fly is alive (a deployed body always is). */
  get alive(): boolean {
    return this.homeostasis?.state.alive ?? true;
  }

  /** Simulated time (s). */
  get t(): number {
    return Number((this.tick * TICK_S).toFixed(6));
  }

  step(ticks: number): void {
    for (let k = 0; k < ticks; k++) {
      const t = this.t;
      // The ecosystem lives the second this tick falls in, after the last one's interactions.
      while (this.eco.t <= t + this.offsetS + 1e-9) {
        this.flush();
        this.eco.step();
      }
      const fly = this.fly;
      if (fly && this.alive) {
        const capacity = fly.params.reserveJ;
        if (!this.homeostasis) {
          const a = this.organism!;
          const supplied = a.physiology.advance(TICK_S, {
            mode: fly.state.mode,
            reserve: Math.min(fly.state.reserve, capacity),
            capacity,
          });
          if (supplied > 0) {
            const before = fly.state.reserve;
            fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
            this.maintenanceJ += fly.state.reserve - before;
          }
        }
        fly.advance(TICK_S);
        this.interact(fly);
        if (this.homeostasis) this.live(fly, capacity);
      }
      this.tick++;
    }
  }

  /** What the fly did to the world this tick, applied as recorded interactions. */
  private interact(fly: DigitalFly): void {
    const c = fly.state.counts;
    const dJ = c.fedJ - this.fedJ,
      dS = c.feedS - this.feedS;
    this.fedJ = c.fedJ;
    this.feedS = c.feedS;
    if (!(dJ > 0)) return;
    const s = fly.state;
    // Food lies on the yard's ground (y = 0), under the standing body.
    const item = this.world.foodAt([s.p[0], 0, s.p[2]]);
    // The body fed on what it entered feeding on; if that is gone the intake is unbacked.
    const id = item?.id ?? "nothing";
    const p = this.pending.get(id) ?? { mg: 0, s: 0, fruit: item?.kind === "fruit" };
    const mg = dJ / P("sugarJPerMg");
    p.mg += mg;
    p.s += dS;
    this.pending.set(id, p);
    // Juice: a mortal body gains the water that came with the sugar.
    if (this.homeostasis && item) {
      const it = this.eco.item(item.id);
      const ulPerMg =
        item.kind === "fruit"
          ? homeostasisParam("juiceUlPerMgSugar")
          : it && "waterUl" in it && it.sugarMg > 0
            ? it.waterUl / it.sugarMg
            : 0;
      this.homeostasis.juice(mg * ulPerMg);
    }
  }

  /** A mortal body's tick of homeostasis: temperature, metabolism, water, drinking, death. */
  private live(fly: DigitalFly, capacity: number): void {
    const h = this.homeostasis!;
    const s = fly.state;
    const P_ = fly.params;
    const mode = s.mode;
    const activity =
      mode === "flight" || mode === "land" || mode === "takeoff" || mode === "escape"
        ? 1
        : mode === "walk"
          ? 0.4
          : 0;
    const basePowerW =
      (mode === "flight" || mode === "land"
        ? P_.flightPowerMw
        : mode === "rest" || mode === "feed"
          ? P_.restPowerMw
          : P_.walkPowerMw) / 1000;
    const light = this.world.light(s.p);
    const feet: V3 = [s.p[0], 0, s.p[2]];
    const still = PERCHED.has(mode) && mode !== "walk";
    const onWetGround =
      still && s.p[1] < 0.01 && this.eco.soilWaterAt(feet[0], feet[2]) >= WET_GROUND_MM;
    const r = h.step(TICK_S, {
      t: this.t + TICK_S,
      activity,
      basePowerW,
      sunlit: light.sunlit === true,
      light: light.level,
      airTempC: this.world.airTempAt(s.p),
      humidity: this.world.humidityAt(s.p),
      onWetGround,
      reserveJ: s.reserve,
    });
    s.reserve = Math.min(capacity, Math.max(0, s.reserve - r.energyJ));
    if (r.drankUl > 0) {
      const cell = this.eco.cellAt(feet[0], feet[2]);
      const mm = r.drankUl / (this.eco.odour.spec.h ** 2 * 1e6);
      this.drinks.set(cell, (this.drinks.get(cell) ?? 0) + mm);
    }
  }

  /** Apply the gathered second's interactions, in a fixed order (by item id). */
  private flush(): void {
    if (!this.pending.size && !this.drinks.size) return;
    const who = this.subject!;
    for (const id of [...this.pending.keys()].sort()) {
      const p = this.pending.get(id)!;
      this.eco.consume(id, p.mg, who);
      if (p.fruit) this.eco.inoculate(id, p.s, who);
    }
    this.pending.clear();
    for (const cell of [...this.drinks.keys()].sort((a, b) => a - b))
      this.eco.drink(cell, this.drinks.get(cell)!, who);
    this.drinks.clear();
  }
}

/**
 * An ecosystem stepped bare for `steps` seconds with recorded interactions
 * applied where a life applied them: at the end of the second they fell in.
 */
export function replay(
  spec: EcosystemSpec,
  interactions: readonly Interaction[],
  steps: number,
): Ecosystem {
  const eco = new Ecosystem(spec);
  let k = 0;
  for (let i = 0; i < steps; i++) {
    while (k < interactions.length && interactions[k]!.t === eco.t)
      eco.apply(interactions[k++]!);
    eco.step();
  }
  return eco;
}

/** An ecosystem of `spec` that has lived `seconds` on its own: the world before any fly. */
export function spinUp(spec: EcosystemSpec, seconds: number): Ecosystem {
  const eco = new Ecosystem(spec);
  eco.run(seconds);
  return eco;
}

/**
 * An exact copy of a living ecosystem, by whole-graph snapshot into a fresh
 * one of the same spec (checked: same state hash), so every arm of a study
 * starts in the same world.
 */
export function cloneEcosystem(eco: Ecosystem): Ecosystem {
  const fresh = () => new Ecosystem(eco.spec);
  const snap = JSON.parse(JSON.stringify(snapshotGraph(eco, indexGraph(fresh()))));
  const copy = restoreGraph(snap, fresh());
  if (copy.stateHash() !== eco.stateHash())
    throw new Error("the copy is not the ecosystem");
  return copy;
}
