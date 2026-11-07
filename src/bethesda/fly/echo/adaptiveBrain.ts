/**
 * An opt-in research controller for a future ECHO continuation.
 *
 * The original ECHO adapter and its checkpoint schema are unchanged. This
 * wrapper keeps the existing ECHO mind and body controller intact, then learns
 * how reliably its own walking commands produce forward movement, separately
 * for low-reserve and normal-reserve contexts. Repeated failure can reduce the
 * next walking command, but never invent a new motor mode or bypass the body's
 * command gate. Reflexes still belong to the original ECHO controller.
 *
 * No claim of behavioural improvement is made without a held-out experiment.
 * Do not use this with an original's checkpoint without a separately audited,
 * reversible, exact-projection continuation.
 */
import { EchoAdapter, type EchoOptions } from "./adapter.js";
import type { SelfMotionSample } from "../selfMotion.js";
import type {
  AdapterDescriptor,
  AdapterStreams,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../neural.js";

export const ADAPTIVE_BRAIN_VERSION = "echo-embodied-plasticity/v1" as const;
const MAX_TRIALS = 48;
const MAX_COUNT = 1024;
const MIN_TRIALS = 8;
const FAILURE_THRESHOLD = 0.4;
const CAUTIOUS_SCALE = 0.7;

export type EnergyContext = "low" | "normal";
export interface WalkingEvidence {
  context: EnergyContext;
  effective: boolean;
  touched: boolean;
  measuredForwardM: number;
  expectedForwardM: number;
}
interface Counts {
  succeeded: number;
  failed: number;
}
interface Pending {
  context: EnergyContext;
  speedCmS: number;
}
export interface AdaptiveBrainState {
  schema: typeof ADAPTIVE_BRAIN_VERSION;
  contexts: Record<EnergyContext, Counts>;
  pending: Pending | null;
  recent: WalkingEvidence[];
  adaptations: number;
  samples: number;
}

function freshState(): AdaptiveBrainState {
  return {
    schema: ADAPTIVE_BRAIN_VERSION,
    contexts: {
      low: { succeeded: 0, failed: 0 },
      normal: { succeeded: 0, failed: 0 },
    },
    pending: null,
    recent: [],
    adaptations: 0,
    samples: 0,
  };
}

/** A bounded, deterministic, serializable memory of action consequences. */
export class EmbodiedPlasticity {
  readonly state: AdaptiveBrainState;

  constructor(previous?: AdaptiveBrainState) {
    if (previous && previous.schema !== ADAPTIVE_BRAIN_VERSION)
      throw new Error("unknown embodied-plasticity brain version");
    this.state = previous ? structuredClone(previous) : freshState();
  }

  /** Only the previous *executed* command may receive credit for a sample. */
  observe(sample: SelfMotionSample | null | undefined): void {
    const previous = this.state.pending;
    this.state.pending = null;
    if (
      !previous ||
      !sample ||
      !Number.isFinite(sample.dt) ||
      sample.dt <= 0 ||
      !Number.isFinite(sample.forward)
    )
      return;
    const expectedForwardM = (previous.speedCmS / 100) * sample.dt;
    const effective =
      !sample.touched && sample.forward >= FAILURE_THRESHOLD * expectedForwardM;
    const counts = this.state.contexts[previous.context];
    if (effective) counts.succeeded++;
    else counts.failed++;
    if (counts.succeeded + counts.failed >= MAX_COUNT) {
      // Preserve the estimate without allowing counters to grow forever.
      counts.succeeded = Math.floor(counts.succeeded / 2);
      counts.failed = Math.floor(counts.failed / 2);
    }
    this.state.samples++;
    this.state.recent.push({
      context: previous.context,
      effective,
      touched: sample.touched,
      measuredForwardM: sample.forward,
      expectedForwardM,
    });
    if (this.state.recent.length > MAX_TRIALS)
      this.state.recent.splice(0, this.state.recent.length - MAX_TRIALS);
  }

  /** A reflex or interrupted period invalidates the outstanding trial. */
  interrupted(): void {
    this.state.pending = null;
  }

  /**
   * In shadow mode, the actual command is untouched while memory still learns.
   * In active research mode, repeated low progress cautiously reduces only
   * walking speed. The body's existing validator remains authoritative.
   */
  advise(
    command: MotorCommand,
    reserve: number,
    edge: boolean,
    active: boolean,
  ): MotorCommand {
    this.state.pending = null;
    if (
      command.mode !== "walk" ||
      edge ||
      !Number.isFinite(command.walkSpeed) ||
      (command.walkSpeed ?? 0) <= 0
    )
      return command;
    const context: EnergyContext = reserve < 0.35 ? "low" : "normal";
    const counts = this.state.contexts[context];
    const n = counts.succeeded + counts.failed;
    const posteriorFailure = (counts.failed + 1) / (n + 2);
    const cautious = n >= MIN_TRIALS && posteriorFailure > 0.5;
    const revised =
      active && cautious
        ? {
            ...command,
            walkSpeed: command.walkSpeed! * CAUTIOUS_SCALE,
            reason: command.reason + "; learned cautious gait",
          }
        : command;
    if (active && cautious) this.state.adaptations++;
    this.state.pending = { context, speedCmS: revised.walkSpeed! };
    return revised;
  }
}

/**
 * A real executable alternative to the unchanged ECHO adapter, not a drop-in
 * replacement for a live individual's older graph and sealed history.
 */
export class AdaptiveEchoBrain implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor = {
    id: ADAPTIVE_BRAIN_VERSION,
    label: "ECHO + embodied action-outcome memory (research)",
    fidelity:
      "The existing ECHO v3 self-model, plus bounded contextual Bayesian feedback from self-motion and touch. It can scale walking speed after repeated ineffective steps. No full connectome, new neurons, or biological learning mechanism is claimed.",
    simulatesNeurons: false,
    regions: [],
    selfMotion: true,
  };
  readonly inner: EchoAdapter;
  readonly plasticity: EmbodiedPlasticity;
  readonly active: boolean;

  constructor(
    rng: () => number,
    streams: AdapterStreams,
    options: Pick<EchoOptions, "seed" | "onEvent"> & { active?: boolean } = {},
  ) {
    this.inner = new EchoAdapter(rng, streams, {
      variant: "full",
      seed: options.seed,
      onEvent: options.onEvent,
    });
    this.descriptor.regions = this.inner.descriptor.regions;
    this.active = options.active ?? false;
    this.plasticity = new EmbodiedPlasticity();
  }

  static factory(
    options: Pick<EchoOptions, "seed" | "onEvent"> & { active?: boolean } = {},
  ) {
    return (rng: () => number, streams: AdapterStreams) =>
      new AdaptiveEchoBrain(rng, streams, options);
  }

  get state() {
    return {
      version: ADAPTIVE_BRAIN_VERSION,
      echo: this.inner.state,
      plasticity: this.plasticity.state,
      active: this.active,
    };
  }

  start(body: BodySnapshot): void {
    this.inner.start(body);
  }

  decide(input: DecisionInput): MotorCommand {
    this.plasticity.observe(input.self);
    const command = this.inner.decide(input);
    return this.plasticity.advise(
      command,
      input.body.reserve,
      input.body.edge,
      this.active,
    );
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const command = this.inner.interrupt(input);
    if (command) this.plasticity.interrupted();
    return command;
  }
}
