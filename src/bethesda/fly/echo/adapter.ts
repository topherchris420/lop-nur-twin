/**
 * The ECHO controller: the reduced-order controller with a self-model between
 * its intentions and the body (selfModel.ts).
 *
 * It is a `FlyNeuralAdapter` like any other, so every command it gives passes
 * the fly's own gate. The reduced-order controller still decides what the fly
 * does, with its own random stream and everything it read before; the
 * self-model reads only `SelfModelView` (view.ts) and the self-motion sense,
 * and changes how hard the fly drives its legs and wings to do what it
 * intends, when it slows down out of doubt, and when it stops or starts to
 * find something out. The giant-fiber reflex passes through untouched.
 *
 * `variant` picks the self-model or one of its ablations (selfModel.ts).
 * `reactive` has no self-model at all and reads no self-motion sense, so it
 * runs exactly as the reduced-order controller does (echo.test.ts compares
 * them step by step).
 */
import { REDUCED_ORDER_DESCRIPTOR, ReducedOrderController } from "../controller.js";
import { FLY_VERSION } from "../fly.js";
import type {
  AdapterDescriptor,
  AdapterStreams,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../neural.js";
import {
  echoCheckpoint,
  parseEchoCheckpoint,
  type EchoCheckpoint,
} from "./checkpoint.js";
import { ECHO_VERSION } from "./params.js";
import {
  initialEchoState,
  SelfModel,
  VARIANT_LABELS,
  type EchoEvent,
  type EchoState,
  type EchoVariant,
} from "./selfModel.js";
import { selfModelView } from "./view.js";

export function echoDescriptor(variant: EchoVariant): AdapterDescriptor {
  return {
    id: `${ECHO_VERSION}/${variant} over ${REDUCED_ORDER_DESCRIPTOR.id}`,
    label:
      variant === "full"
        ? "ECHO self-model (experimental)"
        : `ECHO self-model, ${VARIANT_LABELS[variant]}`,
    fidelity:
      "The reduced-order behavioural controller with a computational self-model between its intentions and the body: a forward model of its own self-motion, Bayesian estimation of its own movement gains and of outside drift, change detection and model comparison, episodic memory. No neurons, synapses or connectome are simulated, and nothing here is a claim about awareness.",
    simulatesNeurons: false,
    // The controller underneath is the reduced-order one, and these are its functions' regions.
    // The self-model adds no anatomical claim.
    regions: REDUCED_ORDER_DESCRIPTOR.regions,
    selfMotion: variant !== "reactive",
  };
}

/** One decision as the researcher sees it: what was intended and what was commanded. */
export interface EchoDecision {
  t: number;
  intention: MotorCommand;
  command: MotorCommand;
}

export interface EchoOptions {
  variant?: EchoVariant;
  /** The fly's seed, for the episodic records. */
  seed?: number | null;
  /** Instrumentation for an experimenter: called with what the self-model noticed and concluded. Never read back. */
  onEvent?: (e: EchoEvent) => void;
  /** Instrumentation: called with each decision's intention and command. Never read back. */
  onDecision?: (d: EchoDecision) => void;
}

export interface EchoAdapterState {
  variant: EchoVariant;
  controller: ReducedOrderController["state"];
  self: EchoState | null;
  /** Every time the self-model was replaced (restored from a checkpoint, or reset), at the last decision before. */
  replaced: { t: number; how: "restored" | "reset"; digest: string | null }[];
}

export class EchoAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly variant: EchoVariant;
  readonly inner: ReducedOrderController;
  readonly model: SelfModel | null;
  private readonly replaced: EchoAdapterState["replaced"] = [];
  private readonly onDecision: EchoOptions["onDecision"];
  private readonly seedOf: number | null;
  private now = 0;

  constructor(rng: () => number, streams: AdapterStreams, options: EchoOptions = {}) {
    this.variant = options.variant ?? "full";
    this.descriptor = echoDescriptor(this.variant);
    this.inner = new ReducedOrderController(rng, streams.navigation);
    this.seedOf = options.seed ?? null;
    this.model =
      this.variant === "reactive"
        ? null
        : new SelfModel(
            initialEchoState(this.variant, this.seedOf, FLY_VERSION),
            options.onEvent ?? null,
          );
    this.onDecision = options.onDecision;
  }

  /** Builds the adapter as a `DigitalFlyOptions.adapter`. */
  static factory(options: EchoOptions = {}) {
    return (rng: () => number, streams: AdapterStreams) =>
      new EchoAdapter(rng, streams, options);
  }

  /** Everything that decides what it does next: the controller's state and the self-model's. Part of the fly's state hash. */
  get state(): EchoAdapterState {
    return {
      variant: this.variant,
      controller: this.inner.state,
      self: this.model?.state ?? null,
      replaced: this.replaced,
    };
  }

  start(body: BodySnapshot): void {
    this.inner.start(body);
  }

  decide(input: DecisionInput): MotorCommand {
    this.now = input.body.t;
    const view = selfModelView(input);
    this.model?.observe(view);
    const intention = this.inner.decide(input);
    if (!this.model) {
      this.onDecision?.({ t: view.t, intention, command: intention });
      return intention;
    }
    const { intention: intent, command } = this.model.act(intention, view);
    this.onDecision?.({ t: view.t, intention: intent, command });
    return command;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const reflex = this.inner.interrupt(input);
    if (reflex) this.model?.interrupted();
    return reflex;
  }

  /** An experimental checkpoint of the self-model (checkpoint.ts); null without one. */
  checkpoint(): EchoCheckpoint | null {
    return this.model ? echoCheckpoint(this.model.state) : null;
  }

  /**
   * Replace the self-model with a checkpoint's, after checking it. The
   * replacement is recorded in the adapter's state, so it is never silent.
   */
  restore(text: string): string[] {
    if (!this.model) return ["a reactive controller has no self-model to restore"];
    const parsed = parseEchoCheckpoint(text, { fly: FLY_VERSION, variant: this.variant });
    if (!parsed.ok) return parsed.errors;
    this.model.state = structuredClone(parsed.checkpoint.state);
    this.replaced.push({
      t: this.now,
      how: "restored",
      digest: parsed.checkpoint.digest,
    });
    return [];
  }

  /** Replace the self-model with an innate one: its beliefs, history and memory gone, and recorded as such. */
  reset(): void {
    if (!this.model) return;
    this.model.state = initialEchoState(
      this.model.state.variant,
      this.seedOf,
      FLY_VERSION,
    );
    this.replaced.push({ t: this.now, how: "reset", digest: null });
  }
}
