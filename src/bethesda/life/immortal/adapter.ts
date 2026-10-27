/** Explicit composition: one existing motor controller, its published MB circuit,
 * and ECHO v3's existing self-model. No parallel controller or privileged new sense. */
import {
  MushroomBodyController,
  MUSHROOM_BODY_DESCRIPTOR,
} from "../../fly/mushroomBody/controller.js";
import {
  ReducedOrderController,
  REDUCED_ORDER_DESCRIPTOR,
} from "../../fly/controller.js";
import { SelfModel, initialEchoState, type EchoEvent } from "../../fly/echo/selfModel.js";
import { selfModelView } from "../../fly/echo/view.js";
import { FLY_VERSION } from "../../fly/fly.js";
import {
  PERCHED,
  type AdapterDescriptor,
  type AdapterStreams,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "../../fly/neural.js";
import { Physiology } from "./physiology.js";
import type { Episode } from "../../fly/echo/memory.js";

export const IMMORTAL_ADAPTER_VERSION = "echo-immortal-adapter/v1";
export interface ResearchFlags {
  immortality: boolean;
  associativeLearning: boolean;
  predictiveSelfModel: boolean;
}
export const RESEARCH_FLAGS: Readonly<ResearchFlags> = Object.freeze({
  immortality: false,
  associativeLearning: false,
  predictiveSelfModel: false,
});

export class ImmortalAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: MushroomBodyController | ReducedOrderController;
  readonly model: SelfModel | null;
  readonly physiology: Physiology;
  readonly modelEvents: (EchoEvent & { episode?: Episode })[] = [];
  decisions = 0;
  constructor(
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
    flags: ResearchFlags,
  ) {
    this.physiology = new Physiology(flags.immortality);
    this.inner = flags.associativeLearning
      ? new MushroomBodyController(rng, { seed }, streams)
      : new ReducedOrderController(rng, streams.navigation);
    this.model = flags.predictiveSelfModel
      ? new SelfModel(initialEchoState("full", seed, FLY_VERSION), (e) => {
          if (this.modelEvents.length >= 32)
            throw new Error("self-model archive backpressure");
          const episode =
            e.kind === "concluded" ? this.model?.state.episodes.at(-1) : undefined;
          this.modelEvents.push(
            structuredClone({ ...e, ...(episode ? { episode } : {}) }),
          );
        })
      : null;
    const base = flags.associativeLearning
      ? MUSHROOM_BODY_DESCRIPTOR
      : REDUCED_ORDER_DESCRIPTOR;
    this.descriptor = {
      ...base,
      id: IMMORTAL_ADAPTER_VERSION,
      label: "ECHO immortal research composition",
      selfMotion: flags.predictiveSelfModel,
      fidelity:
        "Experimental composition of the existing motor controller, optional mushroom-body rate units and ECHO predictive self-model. Recoverable tissue proxies; artificial maintenance. No complete nervous system, cellular reconstruction or consciousness claim.",
    };
  }
  get state() {
    return {
      inner: this.inner.state,
      self: this.model?.state ?? null,
      physiology: this.physiology.state,
      decisions: this.decisions,
    };
  }
  start(body: BodySnapshot): void {
    this.inner.start(body);
  }
  decide(input: DecisionInput): MotorCommand {
    this.decisions++;
    const view = selfModelView(input);
    this.model?.observe(view);
    let intention = this.inner.decide(input);
    const p = this.physiology.state;
    // Escape reflexes retain priority. Never request an illegal airborne-to-rest transition.
    if (
      this.physiology.immortal &&
      (p.protective || p.sleeping) &&
      PERCHED.has(input.body.mode) &&
      intention.mode !== "escape" &&
      intention.mode !== "feed"
    ) {
      // Suppress active probes while protection owns the motor output. Do not
      // leave a forward prediction for a command that the body never receives.
      this.model?.interrupted();
      return {
        mode: "rest",
        reason: p.protective ? "protective maintenance" : "sleep-pressure recovery",
      };
    }
    if (
      this.physiology.immortal &&
      intention.mode === "walk" &&
      intention.walkSpeed !== undefined
    )
      intention = {
        ...intention,
        walkSpeed: intention.walkSpeed * (1 - 0.7 * p.fatigue),
      };
    return this.model?.act(intention, view).command ?? intention;
  }
  interrupt(input: DecisionInput): MotorCommand | null {
    const command = this.inner.interrupt(input);
    if (command) this.model?.interrupted();
    return command;
  }
}
