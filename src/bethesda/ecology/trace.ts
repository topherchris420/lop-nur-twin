/**
 * A read-only causal trace of a research fly's life in the ecology (R.A.I.N.
 * Genesis Stage F): what the world was, what the fly sensed, what its learning
 * circuit held, what it decided, what its body did and what that changed.
 *
 * It only reads. It calls nothing that steps, draws, decides or writes, and a
 * test steps a traced life beside an untraced one and compares both the fly's
 * and the ecosystem's state hashes. Every field carries a provenance class
 * (`PROVENANCE`): measured in the simulation, a model's internal variable, or
 * unavailable. The decision text is the controller's own logged reason, a
 * string its code writes; it is not a thought, and nothing here describes
 * experience.
 */
import type { MushroomBodyTrial } from "../fly/mushroomBody/circuit.js";
import type { Interaction } from "./ecosystem.js";
import type { EcologicalLife } from "./life.js";

export const TRACE_SCHEMA = "ecology-trace/v1";

/** What each group of fields is. */
export const PROVENANCE = {
  world:
    "measured in the simulation: the ecosystem's state at the sample (weather, which the fly mostly cannot sense)",
  senses:
    "measured in the simulation: the fly's sensory frame (delayed 30 ms) and, for humidity, what its antennae meet",
  body: "measured in the simulation: the body's state",
  physiology:
    "model: the mortal body's homeostasis variables (absent for the deployed configuration)",
  learning:
    "model: the mushroom body's rate units and plastic KC→MBON weights, and the navigator's remembered places",
  decision:
    "measured in the simulation: the last command the gate accepted, with the controller's logged reason (text its code writes, not a thought)",
  policies:
    "measured in the simulation: how many times each homeostatic policy overrode the controller",
  effects:
    "measured in the simulation: interactions the fly's body had with the world (sugar taken, yeast left, water drunk)",
  unavailable:
    "not modelled: the fly's internal neural activity outside the mushroom body's rate units (no spiking network runs in this fly), its motivation as such, and anything about experience",
} as const;

export interface TraceSample {
  t_s: number;
  world: {
    hour: number;
    light: number;
    temp_c: number;
    humidity: number;
    wind_ms: number;
    rain_mm_h: number;
  };
  senses: {
    odour: number;
    light: number;
    humidity_at_antennae: number;
    airflow_ms: number;
    looming_drive: number;
  };
  body: { mode: string; x: number; y: number; z: number; reserve: number; fed_j: number };
  physiology: { water: number; temp_c: number; alive: boolean } | null;
  learning: {
    trials: number;
    fruitless: number;
    mean_w_plus: number;
    mean_w_minus: number;
    remembered_places: number;
    last_trial: Pick<
      MushroomBodyTrial,
      "reinforcement" | "before" | "after" | "mPlus" | "mMinus" | "dPlus" | "dMinus"
    > | null;
  };
  decision: { mode: string; reason: string } | null;
  policies: Record<string, number> | null;
  effects: Interaction[];
}

const r4 = (x: number) => Number(x.toPrecision(4));
const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Reads a sample from a life. Never changes it. */
export class Tracer {
  readonly life: EcologicalLife;
  readonly samples: TraceSample[] = [];
  private seenInteractions = 0;
  constructor(life: EcologicalLife) {
    if (!life.fly) throw new Error("a trace follows a fly");
    this.life = life;
  }

  sample(): TraceSample {
    const life = this.life;
    const fly = life.fly!;
    const s = fly.state;
    const w = life.eco.weather;
    const frame = fly.lastFrame;
    const org = life.organism!;
    const mb = org.circuit.state;
    const h = life.homeostasis?.state ?? null;
    const last = mb.last;
    const newEffects = life.eco.interactions
      .slice(this.seenInteractions)
      .map((i) => ({ ...i }));
    this.seenInteractions = life.eco.interactions.length;
    const sample: TraceSample = {
      t_s: life.t,
      world: {
        hour: r4(w.hour),
        light: r4(w.light),
        temp_c: r4(w.tempC),
        humidity: r4(w.humidity),
        wind_ms: r4(Math.hypot(w.wind[0], w.wind[2])),
        rain_mm_h: r4(w.rainMmH),
      },
      senses: {
        odour: r4(frame?.odour ?? 0),
        light: r4(frame?.light ?? 0),
        humidity_at_antennae: r4(life.world.humidityAt(s.p)),
        airflow_ms: r4(frame?.airflow ?? 0),
        looming_drive: r4(frame?.looming?.drive ?? 0),
      },
      body: {
        mode: s.mode,
        x: r4(s.p[0]),
        y: r4(s.p[1]),
        z: r4(s.p[2]),
        reserve: r4(s.reserve / fly.params.reserveJ),
        fed_j: r4(s.counts.fedJ),
      },
      physiology: h ? { water: r4(h.water), temp_c: r4(h.tempC), alive: h.alive } : null,
      learning: {
        trials: mb.trials,
        fruitless: mb.fruitless,
        mean_w_plus: r4(mean(mb.wPlus)),
        mean_w_minus: r4(mean(mb.wMinus)),
        remembered_places: org.inner.state.nav.places.length,
        last_trial: last
          ? {
              reinforcement: r4(last.reinforcement),
              before: r4(last.before),
              after: r4(last.after),
              mPlus: r4(last.mPlus),
              mMinus: r4(last.mMinus),
              dPlus: r4(last.dPlus),
              dMinus: r4(last.dMinus),
            }
          : null,
      },
      decision: fly.lastCommand
        ? { mode: fly.lastCommand.mode, reason: fly.lastCommand.reason }
        : null,
      policies: life.policies ? { ...life.policies.state.overrides } : null,
      effects: newEffects,
    };
    this.samples.push(sample);
    return sample;
  }
}
