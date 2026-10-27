/** Research-only lives. The production runner never imports this module or selects this kind. */
import { sha256Json } from "../../../rain/sha256.js";
import { DigitalFly, FLY_VERSION } from "../../fly/fly.js";
import { ECHO_VERSION } from "../../fly/echo/params.js";
import { initialEchoState } from "../../fly/echo/selfModel.js";
import { MushroomBody } from "../../fly/mushroomBody/circuit.js";
import { MushroomBodyController } from "../../fly/mushroomBody/controller.js";
import { PrimitiveWorld } from "../../fly/world.js";
import {
  BETHESDA_LIFE,
  HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "../headless.js";
import { GENESIS, eraseMemory, type FoodNow } from "../individuality.js";
import type { Perturbation } from "../../fly/perturbation.js";
import type { LifeEvent, LifeKind } from "../continuity.js";
import {
  ImmortalAdapter,
  IMMORTAL_ADAPTER_VERSION,
  RESEARCH_FLAGS,
  type ResearchFlags,
} from "./adapter.js";
import { PHYSIOLOGY_VERSION } from "./physiology.js";
import { ChallengeYard, validateChallenge, type Challenge } from "./challenges.js";

export const IMMORTAL_LIFE_VERSION = "echo-immortal-research/v1";
export const HISTORY_LIMIT = 64;
export const OUTBOX_LIMIT = 512;

export interface ImmortalGenesis {
  seed: number;
  home: HeadlessGenesis | null;
  flags: ResearchFlags;
  startReserve: number;
  /** Research only, fixed in genesis; never read by a neural circuit. */
  perturbation?: Perturbation;
}

/** All new functionality is disabled unless explicitly enabled for a research life. */
export const researchGenesis = (seed = GENESIS.seed): ImmortalGenesis => ({
  seed,
  home: null,
  flags: { ...RESEARCH_FLAGS },
  startReserve: 0.5,
});

export class ImmortalLife {
  readonly home: HeadlessBethesdaLife | null;
  readonly yard: ChallengeYard | null;
  readonly fly: DigitalFly;
  tick = 0;
  readonly recent: LifeEvent[] = [];
  /** Records must reach a verified checkpoint before they leave this buffer. */
  outbox: LifeEvent[] = [];
  readonly totals: Record<string, number> = {};
  lastTrial = 0;
  constructor(g: ImmortalGenesis) {
    if (
      !Number.isInteger(g.seed) ||
      g.seed < 0 ||
      g.seed > 0xffffffff ||
      !Number.isFinite(g.startReserve) ||
      g.startReserve < 0 ||
      g.startReserve > 1 ||
      Object.keys(g.flags).sort().join() !== Object.keys(RESEARCH_FLAGS).sort().join() ||
      !Object.values(g.flags).every((v) => typeof v === "boolean")
    )
      throw new Error("invalid immortal research genesis");
    if (g.home) {
      if (g.perturbation)
        throw new Error("sensorimotor schedules are confined to the research yard");
      // This is a separately born research individual. No live checkpoint is read here.
      this.home = new HeadlessBethesdaLife(g.home.config, {
        flyController: g.home.flyController,
        researchAdapter: (rng, streams) =>
          new ImmortalAdapter(rng, streams, g.seed, g.flags),
      });
      this.yard = null;
      this.fly = this.home.cityFly.fly;
    } else {
      this.home = null;
      this.yard = new ChallengeYard();
      this.fly = new DigitalFly({
        seed: g.seed,
        world: this.yard,
        start: { p: [0, 0.002, 0], yaw: 0 },
        config: { startReserve: g.startReserve },
        perturbation: g.perturbation,
        adapter: (rng, streams) => new ImmortalAdapter(rng, streams, g.seed, g.flags),
      });
    }
  }
  get adapter(): ImmortalAdapter {
    if (!(this.fly.adapter instanceof ImmortalAdapter))
      throw new Error("wrong research adapter");
    return this.fly.adapter;
  }
  record(kind: string, data: Record<string, unknown>): void {
    if (this.outbox.length >= OUTBOX_LIMIT)
      throw new Error(
        "experience archive backpressure: checkpoint before advancing; no history discarded",
      );
    const event = { tick: this.tick, kind, data };
    this.outbox.push(event);
    this.recent.push(event);
    if (this.recent.length > HISTORY_LIMIT) this.recent.shift();
    this.totals[kind] = (this.totals[kind] ?? 0) + 1;
  }
  advanceTicks(ticks: number): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 10000)
      throw new Error("advance in bounded batches of 0 to 10000 ticks");
    for (let i = 0; i < ticks; i++) {
      // Leave room for every event this step can emit. Check before changing state.
      if (this.outbox.length > OUTBOX_LIMIT - 36)
        throw new Error("experience archive backpressure: checkpoint required");
      if (!Number.isSafeInteger(this.tick + 1))
        throw new Error("clock precision exhausted; no reset performed");
      const a = this.adapter,
        p = a.physiology.state;
      const before = p.protective;
      const sleeping = p.sleeping;
      // The existing body alone accounts for food intake and normal expenditure.
      // Artificial maintenance is external energy, explicitly metered separately.
      const supplied = a.physiology.advance(0.1, {
        mode: this.fly.state.mode,
        reserve: this.fly.state.reserve,
        capacity: this.fly.params.reserveJ,
      });
      this.fly.state.reserve += supplied;
      if (this.home) this.home.advanceTicks(1);
      else this.fly.advance(0.1);
      this.tick++;
      for (const e of a.modelEvents) this.record(`echo-${e.kind}`, { ...e });
      a.modelEvents.length = 0;
      if (before !== p.protective)
        this.record(p.protective ? "recovery-enter" : "recovery-exit", {
          maintenanceJ: p.maintenanceJ,
        });
      if (sleeping !== p.sleeping)
        this.record(p.sleeping ? "rest-bout" : "rest-complete", {
          sleepPressure: p.sleepPressure,
        });
      if (a.inner instanceof MushroomBodyController) {
        const s = a.inner.circuit.state;
        if (s.trials !== this.lastTrial) {
          const updates = s.trials - this.lastTrial;
          this.lastTrial = s.trials;
          this.record("associative-update", { updates, latestTrial: s.last });
        }
      }
    }
  }
  placeFood(food: FoodNow | null): void {
    if (!this.yard)
      throw new Error("research food interventions are confined to the yard");
    this.yard.place(food);
  }
  /** Read-only instrument state; these quantities are model variables, not observed animal biology. */
  inspect() {
    const a = this.adapter;
    return {
      version: IMMORTAL_LIFE_VERSION,
      tick: this.tick,
      simulatedSeconds: this.tick / 10,
      adapter: a.descriptor.id,
      physiology: { ...a.physiology.state },
      reserveJ: this.fly.state.reserve,
      motorMode: this.fly.state.mode,
      selfModel: a.model
        ? { episodes: a.model.state.episodes.length, belief: [...a.model.state.belief.x] }
        : null,
      neural:
        a.inner instanceof MushroomBodyController
          ? { ...a.inner.circuit.state.last }
          : null,
      recent: structuredClone(this.recent),
      totals: { ...this.totals },
      archivePending: this.outbox.length,
      classification:
        "recorded simulator variables and inferred controller states; not evidence of consciousness",
    };
  }
}

export const IMMORTAL_RESEARCH_LIFE: LifeKind<ImmortalGenesis, ImmortalLife> = {
  id: "echo-immortal-research", // Deliberately cannot open the original individual's store.
  versions: {
    ...BETHESDA_LIFE.versions,
    fly: FLY_VERSION,
    echo: ECHO_VERSION,
    organism: IMMORTAL_LIFE_VERSION,
    adapter: IMMORTAL_ADAPTER_VERSION,
    physiology: PHYSIOLOGY_VERSION,
  },
  build: (g) => new ImmortalLife(g),
  step: (life, ticks) => {
    for (let left = ticks; left > 0; left -= 10000)
      life.advanceTicks(Math.min(10000, left));
  },
  tick: (life) => life.tick,
  hash: (life) =>
    sha256Json({
      fly: life.fly.stateHash(),
      extension: life.adapter.state,
      city: life.home?.city.stateHash() ?? null,
      people: life.home?.cityFly.people.stateHash() ?? null,
      food: life.yard?.food ?? null,
      challenge: life.yard?.challenge ?? null,
      tick: life.tick,
      totals: life.totals,
      recent: life.recent,
      outbox: life.outbox,
    }),
  apply: (life, event) => {
    if (event.tick !== life.tick)
      throw new Error("intervention must occur at its recorded tick");
    if (event.kind === "food") {
      const food = event.data.food as FoodNow | null;
      if (
        food !== null &&
        (!food ||
          !["east", "west", "north", "south"].includes(food.site) ||
          !Array.isArray(food.at) ||
          food.at.length !== 2 ||
          !food.at.every(Number.isFinite))
      )
        throw new Error("invalid food event");
      // Admission first: a full archive must not leave an unrecorded intervention behind.
      if (!life.yard) throw new Error("food events require the research yard");
      life.record(event.kind, structuredClone(event.data));
      life.placeFood(food);
    } else if (event.kind === "challenge") {
      if (!life.yard) throw new Error("challenge events require the research yard");
      const challenge = event.data.challenge as Challenge;
      validateChallenge(challenge);
      life.record(event.kind, structuredClone(event.data));
      life.yard.configure(challenge);
    } else if (event.kind === "memory-lesion") {
      if (!life.yard)
        throw new Error("memory lesions are confined to research-yard controls");
      const a = life.adapter;
      life.record(event.kind, structuredClone(event.data));
      const controller =
        a.inner instanceof MushroomBodyController ? a.inner.inner : a.inner;
      eraseMemory(controller.state.nav);
      if (a.inner instanceof MushroomBodyController) {
        const innate = new MushroomBody(a.inner.params, life.fly.seed);
        Object.assign(a.inner.circuit.state, innate.state);
        life.lastTrial = 0;
      }
      if (a.model)
        Object.assign(
          a.model.state,
          initialEchoState("full", life.fly.seed, FLY_VERSION),
        );
    } else throw new Error(`unsupported research event ${event.kind}`);
  },
  classes: [PrimitiveWorld],
};
