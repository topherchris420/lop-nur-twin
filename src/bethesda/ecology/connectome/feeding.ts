/**
 * A connectome hybrid (R.A.I.N. Genesis Stage C): a research fly whose
 * decision to feed is made by a circuit cut from the FlyWire v783 whole brain
 * (`lif.ts`), while its controller (the deployed configuration, with any
 * homeostatic policies) does everything else.
 *
 * - **Taste.** While the fly stands on food, Shiu et al.'s sugar GRNs fire as
 *   Poisson inputs at `maxRateHz` × hunger, hunger = 1 − reserve. That starved
 *   flies' sugar neurons respond more strongly is Inagaki et al. 2012's finding
 *   (dopaminergic modulation of the sugar GRNs); the linear form and the
 *   ceiling are this model's. Off food, nothing drives them.
 * - **Decision.** The fly feeds while the MN9 proboscis motor neurons' mean
 *   rate over the trailing `windowMs` is at least `thresholdHz`. With
 *   `thresholdHz` = 10 Hz, that is the connectome backend's own feed readout (mean MN9 rate
 *   ≥ 10 Hz); the trailing window replaces its single 10 ms step, which made
 *   connectome feeding come in short bursts in the closed loop
 *   (docs/ECHO_ADAPTIVE_INTELLIGENCE.md).
 * - **What stands.** An escape always does. On food the readout decides
 *   whether the fly feeds; when it is off and the controller asked to feed,
 *   the fly rests instead. Off food, the controller's command stands.
 *
 * No satiety signal is added: a meal ends when the fed fly's own hunger has
 * turned its sugar neurons down far enough that MN9 falls below threshold.
 *
 * Two comparators share this adapter: the same circuit with its weights
 * shuffled across its synapse pairs (`wiring: "shuffled"`, a control: the
 * same numbers, the wiring lost), and a plain threshold on hunger while on
 * food (`kind: "threshold"`), set to where the intact circuit's readout
 * crosses its threshold, so that whatever the circuit adds beyond that one
 * number shows.
 */
import { mulberry32 } from "../../../lib/noise.js";
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../../fly/neural.js";
import { PERCHED } from "../../fly/neural.js";
import { ReducedCircuit, shuffledWeights, type CircuitFile } from "./lif.js";

export const FEEDING_HYBRID_VERSION = "research-connectome-feeding/1";

export type FeedingBrain =
  | { kind: "controller" }
  | {
      kind: "connectome";
      circuit: CircuitFile;
      wiring: "intact" | "shuffled";
      maxRateHz: number;
      windowMs: number;
      thresholdHz: number;
    }
  | { kind: "threshold"; hungerAt: number };

export interface FeedingState {
  lastT: number;
  rateHz: number;
  readoutHz: number;
  feeding: boolean;
  /** Meals the readout started (its decision turning on while on food). */
  meals: number;
  /** Decisions on food: the readout on, and off. */
  onFoodOn: number;
  onFoodOff: number;
  /** Times the readout replaced the controller's feed command with rest. */
  vetoed: number;
  /** Simulated seconds the circuit ran with its sugar neurons driven. */
  drivenS: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class FeedingHybridAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  readonly brain: Exclude<FeedingBrain, { kind: "controller" }>;
  readonly circuit: ReducedCircuit | null;
  private readonly rng: () => number;
  private readonly s: FeedingState = {
    lastT: 0,
    rateHz: 0,
    readoutHz: 0,
    feeding: false,
    meals: 0,
    onFoodOn: 0,
    onFoodOff: 0,
    vetoed: 0,
    drivenS: 0,
  };
  /** Wall time spent in the circuit (ms): measured, not part of the state. */
  circuitWallMs = 0;

  constructor(
    inner: FlyNeuralAdapter,
    brain: Exclude<FeedingBrain, { kind: "controller" }>,
    seed: number,
  ) {
    this.inner = inner;
    this.brain = brain;
    // Its own random streams, so the controller's draws are those it would make alone.
    this.rng = mulberry32((seed ^ 0x5eed_f00d) >>> 0);
    if (brain.kind === "connectome") {
      const weights =
        brain.wiring === "shuffled"
          ? shuffledWeights(brain.circuit, mulberry32((seed ^ 0x0bad_5eed) >>> 0))
          : undefined;
      this.circuit = new ReducedCircuit(brain.circuit, weights ? { weights } : {});
    } else this.circuit = null;
    const what =
      brain.kind === "connectome"
        ? `${brain.circuit.id} (${brain.circuit.neurons} neurons${brain.wiring === "shuffled" ? ", weights shuffled" : ""})`
        : `a hunger threshold at ${brain.hungerAt}`;
    this.descriptor = {
      ...inner.descriptor,
      id: `${inner.descriptor.id} + ${FEEDING_HYBRID_VERSION} (${what})`,
      label: `${inner.descriptor.label}, feeding decided by ${what}`,
    };
  }

  /** A copy of the state: finite numbers, for the fly's hash and the trace. */
  get state(): FeedingState & {
    circuit: Record<string, unknown> | null;
    inner: unknown;
  } {
    return {
      ...this.s,
      circuit: this.circuit?.hashState() ?? null,
      inner: (this.inner as { state?: unknown }).state ?? null,
    };
  }

  start(body: BodySnapshot): void {
    this.s.lastT = body.t;
    this.inner.start?.(body);
  }

  private onFood(body: BodySnapshot): boolean {
    return body.onFood !== null && PERCHED.has(body.mode);
  }

  /** Bring the circuit up to now, at the rate the last decision set, and read it. */
  private sense(body: BodySnapshot): boolean {
    const s = this.s;
    const dt = Math.max(0, body.t - s.lastT);
    s.lastT = body.t;
    const hunger = clamp01(1 - body.reserve);
    const contact = this.onFood(body);
    if (this.brain.kind === "threshold") {
      s.rateHz = 0;
      return contact && hunger >= this.brain.hungerAt;
    }
    const b = this.brain;
    const t0 = performance.now();
    if (dt > 0) this.circuit!.run(dt * 1000, s.rateHz, this.rng);
    if (s.rateHz > 0) s.drivenS += dt;
    this.circuitWallMs += performance.now() - t0;
    s.rateHz = contact ? b.maxRateHz * hunger : 0;
    s.readoutHz = this.circuit!.readoutRateHz(b.windowMs);
    return contact && s.readoutHz >= b.thresholdHz;
  }

  decide(input: DecisionInput): MotorCommand {
    const body = input.body;
    const on = this.sense(body);
    const own = this.inner.decide(input);
    const s = this.s;
    if (own.mode === "escape") {
      s.feeding = false;
      return own;
    }
    if (!this.onFood(body)) {
      s.feeding = false;
      return own;
    }
    const why =
      this.brain.kind === "connectome"
        ? `MN9 at ${s.readoutHz.toFixed(1)} Hz over ${this.brain.windowMs} ms (threshold ${this.brain.thresholdHz} Hz)`
        : `hunger ${(1 - body.reserve).toFixed(2)} (threshold ${this.brain.hungerAt})`;
    if (on) {
      s.onFoodOn++;
      if (!s.feeding) s.meals++;
      s.feeding = true;
      return { mode: "feed", reason: `${why}: feeding on ${body.onFood}` };
    }
    s.onFoodOff++;
    s.feeding = false;
    if (own.mode === "feed") {
      s.vetoed++;
      return { mode: "rest", reason: `${why}: not feeding` };
    }
    return own;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    return this.inner.interrupt ? this.inner.interrupt(input) : null;
  }
}
