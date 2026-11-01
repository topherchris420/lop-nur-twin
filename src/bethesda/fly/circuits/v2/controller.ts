/**
 * circuit-informed/v2: v1 (`../controller.ts`) with five mechanisms added,
 * each of which can be switched off for an ablation.
 *
 * 1. `wall`: a walking fly that meets a wall or an edge it cannot pass turns
 *    the shorter way along it and walks on (thigmotaxis). For a while after,
 *    it is reluctant to turn away from the wall (centrophobism).
 * 2. `explore`: a fly placed somewhere new walks more, settling over minutes.
 *    Each walking bout's speed is drawn from a gamma distribution.
 * 3. `saccades`: walking turns are body saccades (Geurten et al. 2014): brief
 *    fast turns between nearly straight segments.
 * 4. `defence`: a perched fly under a lid answers a loom by freezing or
 *    fleeing (Zacarias et al. 2018). Freezing is less likely the faster it was
 *    walking; a fly that does not freeze either takes off or runs. In the open
 *    it keeps v1's escape.
 * 5. `flight`: flight saccade amplitudes are van Breugel & Dickinson 2012's
 *    log-normal, at a fitted spontaneous rate.
 *
 * v2 is a filter over v1. Every decision goes to v1 first (its giant fiber,
 * its grooming circuit and the reduced-order controller under them keep their
 * bookkeeping), with a view in which the reduced-order controller's own walk
 * starts, stops and turns are switched off and an edge is not reported. v2
 * then makes those choices itself. With a mechanism switched off it falls
 * back to the reduced-order controller's rule for it (`fallback` below), so
 * an ablation differs from the whole by that one mechanism, never by the
 * framework.
 *
 * Its own draws come from a stream of its own derived from the fly's seed.
 * Like v1 it simulates no neuron, synapse or network.
 */
import { mulberry32 } from "../../../../lib/noise.js";
import {
  PERCHED,
  type AdapterDescriptor,
  type AdapterStreams,
  type BodySnapshot,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "../../neural.js";
import type { ResolvedParams } from "../../params.js";
import { degToRad, wrapAngle } from "../../units.js";
import {
  CIRCUIT_DESCRIPTOR,
  CircuitController,
  type CircuitOptions,
} from "../controller.js";
import { resolveV2Params, type ResolvedV2Params, type V2Config } from "./params.js";

export const V2_MECHANISMS = [
  "wall",
  "explore",
  "saccades",
  "defence",
  "flight",
] as const;
export type V2Mechanism = (typeof V2_MECHANISMS)[number];

export const V2_DESCRIPTOR: AdapterDescriptor = {
  id: "circuit-informed/v2",
  label: "Circuit-informed controller v2",
  fidelity:
    "v1 (the giant-fiber and dust-grooming circuit models over the reduced-order controller) with five behavioural mechanisms from published studies added: wall following with centrophobism, exploration that decays in a new place, saccadic walking turns (Geurten et al. 2014), freezing or fleeing from looms when enclosed, with freezing less likely at speed (Zacarias et al. 2018), and log-normal flight saccade amplitudes (van Breugel & Dickinson 2012). Functions of what the fly senses, with thresholds and hazards: no neuron, synapse or network is simulated.",
  simulatesNeurons: false,
  regions: [
    ...CIRCUIT_DESCRIPTOR.regions,
    {
      module: "freezing or fleeing (speed-dependent defensive choice)",
      // DNp09 has no term in the pinned VFB reference (data/vfb-reference.json), so none is linked.
      vfb: [],
      relation: "functional association (published)",
      note: "Zacarias et al. 2018 found that a pair of descending neurons, DNp09, is needed for freezing to looms and that activating them drives freezing, more often at low walking speed. The choice here is their behavioural finding; no descending neuron is simulated.",
    },
  ],
};

export interface V2Options extends CircuitOptions {
  v2?: V2Config;
  /** Mechanisms switched off: an ablation. */
  without?: readonly V2Mechanism[];
  /**
   * A lid covers the fly: the paradigm's statement (`Setting.enclosed`), set
   * the way dust is. The simulator renders no view of the lid, so this
   * stands in for what the fly would see overhead.
   */
  enclosed?: boolean;
}

/** Plain state, for the fly's state hash. */
export interface V2State {
  placedAt: number | null;
  /** This walking bout's speed (cm/s). */
  walkTarget: number;
  /** A walking turn under way: its yaw rate until `turnUntil`. */
  turn: number;
  turnUntil: number;
  drift: number;
  /** Which side the wall is on (+1 left, −1 right, 0 none) and until when the fly counts as at it. */
  wallSide: number;
  wallUntil: number;
  /** Time to contact on each side, last seen while walking. */
  ttcLeft: number;
  ttcRight: number;
  /** Recent speeds (cm/s) at decisions, with their times: the defensive choice reads one 0.5 s back. */
  speedT: number[];
  speed: number[];
  /** The loom the current defensive choice was made for, and the choice. */
  loomId: string | null;
  response: "none" | "freeze" | "jump" | "run";
  frozenUntil: number;
  runUntil: number;
  runHeading: number;
  lastOdour: number;
}

const CLAMP = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
/** Walking yaw rates are kept inside the gate's limit (4π rad/s). */
const MAX_WALK_YAW = 12;

/** A standard normal draw (Box–Muller, one of the pair). */
function normal(rng: () => number): number {
  const u = 1 - rng(),
    w = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

/** A gamma draw of this shape (≥ 1) and mean (Marsaglia & Tsang 2000). */
export function gammaDraw(rng: () => number, shape: number, mean: number): number {
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d),
    scale = mean / shape;
  for (let k = 0; k < 1000; k++) {
    let x = 0,
      v = 0;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v)))
      return d * v * scale;
  }
  return mean;
}

export class V2Controller implements FlyNeuralAdapter {
  readonly descriptor = V2_DESCRIPTOR;
  readonly circuit: CircuitController;
  readonly v2: ResolvedV2Params;
  readonly enclosed: boolean;
  private readonly off: ReadonlySet<V2Mechanism>;
  private readonly rng: () => number;
  private readonly S: V2State = {
    placedAt: null,
    walkTarget: 2,
    turn: 0,
    turnUntil: -1e9,
    drift: 0,
    wallSide: 0,
    wallUntil: -1e9,
    ttcLeft: Infinity,
    ttcRight: Infinity,
    speedT: [],
    speed: [],
    loomId: null,
    response: "none",
    frozenUntil: -1e9,
    runUntil: -1e9,
    runHeading: 0,
    lastOdour: 0,
  };
  private viewOf: ResolvedParams | null = null;
  private view: ResolvedParams | null = null;

  constructor(rng: () => number, o: V2Options, streams?: AdapterStreams) {
    this.circuit = new CircuitController(rng, o, streams);
    this.v2 = resolveV2Params(o.v2);
    this.off = new Set(o.without ?? []);
    for (const m of this.off)
      if (!V2_MECHANISMS.includes(m)) throw new Error(`unknown v2 mechanism ${m}`);
    this.enclosed = o.enclosed === true;
    this.rng = mulberry32((o.seed ^ 0x3c6ef372) >>> 0);
  }

  private on(m: V2Mechanism): boolean {
    return !this.off.has(m);
  }

  get state() {
    return { circuit: this.circuit.state, v2: { ...this.S } };
  }

  start(body: BodySnapshot): void {
    this.S.placedAt = body.t;
    this.circuit.start(body);
  }

  private hazard(rate: number, dt: number): boolean {
    return this.rng() < 1 - Math.exp(-rate * dt);
  }

  /** g(t): how much more a fly placed `t` seconds ago starts, and less it stops, walking. */
  private explore(t: number): number {
    if (!this.on("explore")) return 1;
    const since = t - (this.S.placedAt ?? t);
    return 1 + this.v2.exploreGain * Math.exp(-since / this.v2.exploreTauS);
  }

  /** The fly's parameters as v1 is handed them: its own walking choices and spontaneous saccade rate replaced. */
  private innerParams(P: ResolvedParams): ResolvedParams {
    if (this.viewOf !== P) {
      this.viewOf = P;
      this.view = Object.freeze({
        ...P,
        walkStartHz: 0,
        walkStopHz: 0,
        walkTurnHz: 0,
        ...(this.on("flight") ? { spontaneousSaccadeHz: this.v2.flightSaccadeHz } : {}),
      });
    }
    return this.view!;
  }

  private innerInput(input: DecisionInput): DecisionInput {
    const body = input.body.edge ? { ...input.body, edge: false } : input.body;
    return { ...input, body, params: this.innerParams(input.params) };
  }

  /** A walking bout's speed (cm/s). */
  private drawSpeed(P: ResolvedParams): number {
    if (!this.on("explore"))
      // fallback: the reduced-order controller's uniform draw.
      return (
        P.walkSpeedMinCmS + this.rng() * (P.walkSpeedMaxCmS - P.walkSpeedMinCmS) * 0.8
      );
    for (let k = 0; k < 64; k++) {
      const v = gammaDraw(this.rng, this.v2.walkSpeedShape, this.v2.walkSpeedMeanCmS);
      if (v >= P.walkSpeedMinCmS && v <= P.walkSpeedMaxCmS) return v;
    }
    return CLAMP(this.v2.walkSpeedMeanCmS, P.walkSpeedMinCmS, P.walkSpeedMaxCmS);
  }

  /** A flight saccade's amplitude (rad), van Breugel & Dickinson's log-normal, kept within 20–170°. */
  private flightAmplitude(): number {
    const deg =
      this.v2.flightSaccadeMeanDeg *
      Math.exp(Math.log(this.v2.flightSaccadeScale) * normal(this.rng));
    return degToRad(CLAMP(deg, 20, 170));
  }

  private rememberSpeed(body: BodySnapshot): void {
    const S = this.S;
    S.speedT.push(body.t);
    S.speed.push(Math.hypot(body.v[0], body.v[2]) * 100);
    while (S.speedT.length > 1 && S.speedT[0]! < body.t - 2 * this.v2.speedLookbackS) {
      S.speedT.shift();
      S.speed.shift();
    }
  }

  /** The fly's speed (cm/s) `speedLookbackS` before `t`: the earliest kept sample at or after then. */
  private speedBefore(t: number): number {
    const S = this.S,
      at = t - this.v2.speedLookbackS;
    for (let i = 0; i < S.speedT.length; i++)
      if (S.speedT[i]! >= at - 1e-9) return S.speed[i]!;
    return S.speed[S.speed.length - 1] ?? 0;
  }

  /**
   * The defensive choice: made once per loom, at the first sample it reaches
   * `loomDetectDeg`, by a perched fly under a lid that is not already frozen.
   */
  private defend(input: DecisionInput): void {
    if (!this.on("defence") || !this.enclosed) return;
    const loom = input.frame.looming;
    if (!loom || loom.id === this.S.loomId || loom.sizeDeg < this.v2.loomDetectDeg)
      return;
    const body = input.body;
    if (!PERCHED.has(body.mode)) return;
    const S = this.S,
      t = body.t;
    S.loomId = loom.id;
    if (t < S.frozenUntil) {
      S.response = "freeze";
      return;
    }
    const v = this.speedBefore(t);
    const p = this.v2.freezeMax * Math.exp(-v / this.v2.freezeSpeedScaleCmS);
    if (this.rng() < p) {
      S.response = "freeze";
      S.frozenUntil = t - Math.log(1 - this.rng()) * this.v2.freezeMeanS;
    } else if (this.rng() < this.v2.jumpShare) {
      S.response = "jump";
    } else {
      S.response = "run";
      S.runUntil = t + this.v2.runS;
      S.runHeading = wrapAngle(body.yaw + loom.bearing + Math.PI);
    }
  }

  private frozen(t: number): boolean {
    return t < this.S.frozenUntil;
  }
  private running(t: number): boolean {
    return t < this.S.runUntil;
  }

  /** v1's escape is withheld from a fly that is freezing or running. */
  private withheld(body: BodySnapshot, cmd: MotorCommand | null): boolean {
    return (
      cmd !== null &&
      cmd.mode === "escape" &&
      PERCHED.has(body.mode) &&
      (this.frozen(body.t) || this.running(body.t))
    );
  }

  private freezeCommand(body: BodySnapshot): MotorCommand {
    return {
      mode: "rest",
      reason: `freezing under the lid (until ${this.S.frozenUntil.toFixed(1)} s): a loom at ${this.speedBefore(body.t).toFixed(1)} cm/s`,
    };
  }

  decide(input: DecisionInput): MotorCommand {
    const body = input.body;
    if (this.S.placedAt === null) this.S.placedAt = body.t;
    this.rememberSpeed(body);
    this.defend(input);
    let cmd = this.circuit.decide(this.innerInput(input));
    if (PERCHED.has(body.mode) && this.frozen(body.t)) return this.freezeCommand(body);
    if (PERCHED.has(body.mode) && this.running(body.t))
      return this.walking(input, cmd, true);
    if (cmd.mode === "flight" && cmd.saccade !== undefined && this.on("flight")) {
      // An evasive saccade (something looms) keeps v1's amplitude.
      if (!input.frame.looming)
        cmd = { ...cmd, saccade: Math.sign(cmd.saccade || 1) * this.flightAmplitude() };
      return cmd;
    }
    if (body.mode === "rest" && cmd.mode === "rest") return this.maybeWalk(input, cmd);
    if (body.mode === "walk" && cmd.mode === "walk")
      return this.walking(input, cmd, false);
    return cmd;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const c = this.circuit.interrupt(input);
    if (!this.on("defence") || !this.enclosed || !input.frame.looming) return c;
    const body = input.body;
    const before = this.S.loomId;
    this.defend(input);
    if (this.S.loomId !== before && PERCHED.has(body.mode)) {
      if (this.frozen(body.t)) return this.freezeCommand(body);
      if (this.running(body.t)) return this.walking(input, null, true);
    }
    return this.withheld(body, c) ? null : c;
  }

  /** At rest with nothing else to do: start walking at the rate exploration sets. */
  private maybeWalk(input: DecisionInput, cmd: MotorCommand): MotorCommand {
    const { body, frame, params: P, dt } = input;
    const hunger = 1 - body.reserve;
    const drive = 1 + P.starvedActivityGain * hunger;
    const activity = CLAMP(frame.light, P.activityFloor, 1);
    if (!this.hazard(P.walkStartHz * activity * drive * this.explore(body.t), dt))
      return cmd;
    this.S.walkTarget = this.drawSpeed(P);
    this.S.turnUntil = -1e9;
    return {
      mode: "walk",
      walkSpeed: this.S.walkTarget,
      reason: this.on("explore")
        ? `walking bout (${this.S.walkTarget.toFixed(2)} cm/s; exploring ×${this.explore(body.t).toFixed(2)})`
        : "spontaneous walking bout",
    };
  }

  /**
   * A walking decision. `cmd` is v1's walking command (its yaw rate carries
   * the reduced-order controller's tether, phototaxis and local search, its
   * own random turns being switched off), or null when v2 starts a run.
   */
  private walking(
    input: DecisionInput,
    cmd: MotorCommand | null,
    run: boolean,
  ): MotorCommand {
    const { body, frame, params: P, dt } = input;
    const S = this.S,
      V = this.v2,
      t = body.t;
    // What the eyes last saw of the surfaces ahead, before any contact.
    if (!body.edge) {
      S.ttcLeft = frame.ttcLeft;
      S.ttcRight = frame.ttcRight;
    }
    if (!run && this.hazard(P.walkStopHz / this.explore(t), dt))
      return { mode: "rest", reason: "walking bout ends" };
    const base = cmd?.mode === "walk" ? (cmd.yawRate ?? 0) : 0;
    const speed = run ? V.runSpeedCmS : S.walkTarget;
    const atWall = t < S.wallUntil;

    // 1. An edge or a wall in the way.
    if (body.edge) {
      if (this.on("wall")) {
        if (!atWall || S.wallSide === 0)
          S.wallSide =
            S.ttcLeft < S.ttcRight
              ? 1
              : S.ttcRight < S.ttcLeft
                ? -1
                : this.rng() < 0.5
                  ? 1
                  : -1;
        S.wallUntil = t + V.wallHoldS;
        S.turnUntil = -1e9;
        return {
          mode: "walk",
          walkSpeed: speed,
          yawRate: -S.wallSide * V.wallTurnRadS,
          reason: `${S.wallSide > 0 ? "wall on the left" : "wall on the right"}: turns along it`,
        };
      }
      // fallback: the reduced-order controller stops and turns away, either way.
      if (t >= S.turnUntil) {
        S.turn = (this.rng() < 0.5 ? -1 : 1) * 3;
        S.turnUntil = t + 0.4 + this.rng() * 0.4;
      }
      return {
        mode: "walk",
        walkSpeed: 0,
        yawRate: CLAMP(S.turn + base, -6, 6),
        reason: "edge of the surface: stop and turn",
      };
    }

    // 2. A run from a loom: away from it, no spontaneous turns.
    if (run) {
      const err = wrapAngle(S.runHeading - body.yaw);
      return {
        mode: "walk",
        walkSpeed: speed,
        yawRate: CLAMP(6 * err, -MAX_WALK_YAW, MAX_WALK_YAW),
        reason: "runs from the loom",
      };
    }

    // 3. Spontaneous turns: saccades, or the reduced-order controller's turns.
    const hungry = 1 - body.reserve > P.hungerSeek;
    const smell = frame.odour;
    const rising = smell >= S.lastOdour;
    S.lastOdour = smell;
    const scent = hungry && smell >= P.odourDetect ? (rising ? 0.3 : 3) : 1;
    const saccadic = this.on("saccades");
    if (t >= S.turnUntil) {
      S.turn = 0;
      const rate = (saccadic ? V.walkSaccadeHz : P.walkTurnHz) * scent;
      if (this.hazard(rate, dt)) {
        let turn: number, lasts: number;
        if (saccadic) {
          const amp = degToRad(
            gammaDraw(this.rng, V.walkSaccadeShape, V.walkSaccadeMeanDeg),
          );
          const steps = Math.max(1, Math.round(V.walkSaccadeMs / 1000 / dt));
          lasts = steps * dt;
          turn = ((this.rng() < 0.5 ? -1 : 1) * amp) / lasts;
        } else {
          turn = (this.rng() - 0.5) * 4;
          lasts = 0.15 + this.rng() * 0.3;
        }
        // At a wall, a turn toward the open side is often not made.
        const toOpen = S.wallSide !== 0 && Math.sign(turn) === -S.wallSide;
        if (!(this.on("wall") && atWall && toOpen && this.rng() < V.centrophobia)) {
          S.turn = turn;
          S.turnUntil = t + lasts - 1e-9;
        }
      }
    }
    if (saccadic && S.turn === 0) S.drift = V.walkDriftRadS * normal(this.rng);
    else S.drift = 0;
    const yaw = base + S.turn + S.drift;
    return {
      mode: "walk",
      walkSpeed: speed,
      yawRate: CLAMP(yaw, -MAX_WALK_YAW, MAX_WALK_YAW),
      reason:
        S.turn !== 0
          ? saccadic
            ? "walking saccade"
            : "walking turn"
          : atWall
            ? "walking along the wall"
            : (cmd?.reason ?? "walking"),
    };
  }
}

/** The adapter factory for a fly with seed `o.seed`. */
export const v2Adapter =
  (o: V2Options) =>
  (rng: () => number, streams?: AdapterStreams): V2Controller =>
    new V2Controller(rng, o, streams);
