/**
 * The circuit-informed controller: the reduced-order controller with two of
 * its proxies replaced, one at a time, by circuit models, so each change can
 * be compared with the controller it replaced.
 *
 * - Looming escape: the giant-fiber model and the GF-independent wing-raise
 *   pathway (`giantFiber.ts`) decide when the standing fly takes off and in
 *   which mode, and a GF spike can bring a long-mode takeoff forward. The
 *   reduced-order controller never sees a looming object while the fly
 *   stands, so its giant-fiber proxy never fires; in the air its evasive
 *   saccade is unchanged.
 * - Grooming: a dusted fly's grooming comes from the dust model
 *   (`grooming.ts`); a clean fly's spontaneous grooming stays the reduced-
 *   order controller's.
 *
 * Everything else (resting, walking, flight, landing) is the reduced-order
 * controller's, given what it would have got: the circuits apply their
 * published sensory delays themselves, so the fly runs with no sensing
 * latency of its own (`CIRCUIT_FLY_CONFIG`) and the reduced-order controller
 * is handed each sample `innerLatencyMs` late, as the fly's default latency
 * would hand it. Every command still passes the fly's gate.
 *
 * Nothing here simulates a neuron, a synapse or a network: the circuits are
 * published functions of the stimulus and of dust, with thresholds.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { ReducedOrderController } from "../controller.js";
import {
  PERCHED,
  type AdapterDescriptor,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "../neural.js";
import { PARAMS, type ControllerConfig, type ResolvedParams } from "../params.js";
import type { SenseFrame } from "../senses.js";
import { wrapAngle } from "../units.js";
import { EscapeCircuit, type EscapeSignal } from "./giantFiber.js";
import { GroomingCircuit, type GroomModule } from "./grooming.js";
import {
  resolveCircuitParams,
  type CircuitConfig,
  type ResolvedCircuitParams,
} from "./params.js";

export const CIRCUIT_DESCRIPTOR: AdapterDescriptor = {
  id: "circuit-informed/v1",
  label: "Circuit-informed controller",
  fidelity:
    "The reduced-order controller with its looming-escape and dust-grooming proxies replaced by published circuit models: the giant fiber's membrane potential as Ache et al. 2019 fitted it (LC4 and LPLC2 inputs, two inhibitions) racing a GF-independent wing-raise pathway (von Reyn et al. 2014; Fotowat et al. 2009), and Zhang, Guo & Simpson 2020's dust-driven winner-take-all grooming. Functions of the stimulus with thresholds: no neuron, synapse or network is simulated.",
  simulatesNeurons: false,
  regions: [
    {
      module: "looming escape (giant-fiber model, GF-independent pathway)",
      vfb: [
        "FBbt_00111763",
        "FBbt_00003874",
        "FBbt_00004020",
        "VFB_00102109",
        "VFB_00102110",
      ],
      relation: "functional association (published)",
      note: "LPLC2 (angular size) and LC4 (angular velocity) are the model's two excitatory inputs to the giant fiber: they make 99.4% of its direct optic-lobe synapses (55 LC4 and 108 LPLC2 neurons, 2,442 and 1,366 synapses, in Ache et al. 2019's EM reconstruction); VFB's FlyWire counts are in the reference. The membrane potential is Ache et al.'s fitted function, not a simulation of these neurons.",
    },
    {
      module: "grooming (dust-driven winner-take-all)",
      vfb: ["FBbt_00004052"],
      relation: "functional association (published)",
      note: "Mechanosensory bristles across the body report dust; grooming movements compete and the strongest input wins (Seeds et al. 2014; Zhang, Guo & Simpson 2020). The model's dust and activities stand for that sensory drive; no neuron is simulated.",
    },
  ],
};

/** What the fly runs with under this controller: its circuits apply their own sensory delays. */
export const CIRCUIT_FLY_CONFIG: ControllerConfig = { visualLatencyMs: 0 };

export interface CircuitOptions {
  /** The fly's seed: the circuits draw from streams of their own derived from it. */
  seed: number;
  config?: CircuitConfig;
  /** Dust the fly carries when placed: "all-over" as in the dusting experiments, or per body part. */
  dust?: "all-over" | Partial<Record<GroomModule, number>>;
  /** How late the reduced-order controller is handed each sample (ms); its default latency. */
  innerLatencyMs?: number;
  /** Silence the giant fiber: it never spikes, so every looming takeoff is the other pathway's. */
  silenceGiantFiber?: boolean;
}

export class CircuitController implements FlyNeuralAdapter {
  readonly descriptor = CIRCUIT_DESCRIPTOR;
  readonly inner: ReducedOrderController;
  readonly escape: EscapeCircuit;
  readonly grooming: GroomingCircuit;
  readonly circuitParams: ResolvedCircuitParams;
  /** Whether the grooming under way is the dust model's (else it is the reduced-order controller's). */
  private grooms = false;
  private frames: SenseFrame[] = [];
  private latency: number;

  constructor(rng: () => number, o: CircuitOptions) {
    this.circuitParams = resolveCircuitParams(o.config);
    this.inner = new ReducedOrderController(rng);
    this.escape = new EscapeCircuit(
      this.circuitParams,
      mulberry32((o.seed ^ 0x6a09e667) >>> 0),
      o.silenceGiantFiber === true,
    );
    this.grooming = new GroomingCircuit(
      this.circuitParams,
      mulberry32((o.seed ^ 0xbb67ae85) >>> 0),
      o.dust === "all-over"
        ? GroomingCircuit.allOver(this.circuitParams)
        : (o.dust ?? {}),
    );
    this.latency = (o.innerLatencyMs ?? PARAMS.visualLatencyMs.value) / 1000;
  }

  /** Everything that decides the future, for the fly's state hash. */
  get state() {
    return {
      inner: this.inner.state,
      escape: this.escape.state,
      grooming: this.grooming.state,
      grooms: this.grooms,
      frames: this.frames.map((f) => f.t),
    };
  }

  start(body: BodySnapshot): void {
    this.inner.start(body);
  }

  /** Keep the samples the reduced-order controller will be handed late. */
  private remember(frame: SenseFrame): void {
    const f = this.frames;
    if (!f.length || frame.t > f[f.length - 1]!.t) f.push(frame);
    while (f.length > 1 && f[1]!.t <= frame.t - this.latency + 1e-9) f.shift();
  }

  /** The reduced-order controller's input: the late sample, and no looming object while the fly stands. */
  private forInner(input: DecisionInput): DecisionInput {
    const late = this.frames[0] ?? input.frame;
    const airborne = input.body.mode === "flight" || input.body.mode === "land";
    const frame =
      !airborne && late.looming ? Object.freeze({ ...late, looming: null }) : late;
    return {
      body: input.body,
      frame,
      sites: input.sites,
      params: input.params,
      dt: input.dt,
    };
  }

  private escapeCommand(
    body: BodySnapshot,
    P: ResolvedParams,
    signal: EscapeSignal,
  ): MotorCommand | null {
    const E = this.escape.state,
      C = this.circuitParams;
    if (PERCHED.has(body.mode) && (signal.spike || signal.wingRaise)) {
      this.grooming.interruptBout();
      this.grooms = false;
      const heading = wrapAngle(body.yaw + (signal.bearing ?? 0) + Math.PI);
      return signal.spike
        ? {
            mode: "escape",
            heading,
            prepare: C.gfToJumpMs / 1000,
            wings: false,
            reason: `giant-fiber spike: modelled potential ${E.v.toFixed(2)} mV ≥ this trial's threshold ${E.threshold.toFixed(2)} mV → short-mode escape away from it`,
          }
        : {
            mode: "escape",
            heading,
            prepare: P.longModeSequenceMs / 1000,
            wings: true,
            reason: `GF-independent pathway: the looming object reached this trial's ${E.wingRaiseDeg.toFixed(0)}° → long-mode wing raise, away from it`,
          };
    }
    if ((body.mode === "escape" || body.mode === "takeoff") && signal.spike)
      return {
        mode: body.mode,
        prepare: C.gfToJumpMs / 1000,
        reason: `giant-fiber spike during the takeoff (${E.v.toFixed(2)} mV): jump now`,
      };
    return null;
  }

  private groomCommand(body: BodySnapshot): MotorCommand | null {
    const G = this.grooming;
    if (!G.dusty || !PERCHED.has(body.mode)) {
      if (!PERCHED.has(body.mode)) G.interruptBout();
      this.grooms = false;
      return null;
    }
    // A bout of the reduced-order controller's own spontaneous grooming runs on.
    if (body.mode === "groom" && !this.grooms) return null;
    const routine = G.decide(body.t);
    const drive = G.state.drive.toFixed(0);
    if (!routine) {
      if (body.mode === "groom" && this.grooms) {
        this.grooms = false;
        return {
          mode: "rest",
          reason: `grooming drive ${drive} at or below ${this.circuitParams.groomDriveDust}: a pause`,
        };
      }
      return null;
    }
    if (body.mode === "walk") return { mode: "rest", reason: "dust: stops to groom" };
    this.grooms = true;
    const bout = G.state.bout!;
    return {
      mode: "groom",
      groom: routine,
      reason: `dust: the ${bout.module} wins (activity ${drive}); a ${(bout.until - body.t).toFixed(2)} s bout`,
    };
  }

  decide(input: DecisionInput): MotorCommand {
    this.remember(input.frame);
    const body = input.body;
    const signal = this.escape.sample(input.frame, body.responsiveness);
    return (
      this.escapeCommand(body, input.params, signal) ??
      this.groomCommand(body) ??
      this.inner.decide(this.forInner(input))
    );
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    this.remember(input.frame);
    // Most samples see nothing looming; the body (costly to freeze) is read only when one does.
    if (!input.frame.looming) {
      this.escape.sample(input.frame, 1);
      return null;
    }
    const body = input.body;
    const signal = this.escape.sample(input.frame, body.responsiveness);
    const reflex = this.escapeCommand(body, input.params, signal);
    if (reflex) return reflex;
    return body.mode === "flight" || body.mode === "land"
      ? (this.inner.interrupt(this.forInner(input)) ?? null)
      : null;
  }
}

/** The adapter factory for a fly with seed `seed`. */
export const circuitAdapter =
  (o: CircuitOptions) =>
  (rng: () => number): CircuitController =>
    new CircuitController(rng, o);
