/**
 * Acquired search: where meals have come from, used the next time the fly is
 * hungry with nothing to follow.
 *
 * The layer holds no preference. For each kind of situation the fly's senses
 * can tell apart (in the sun or not, close to a surface or not, and so on), it
 * counts the time it has spent hungry and looking there and the meals that
 * came of it, and compares the rates. Every comparison starts at zero and the
 * code names no situation as good or bad. Comparing rates rather than what
 * meals looked like against what is usual keeps a lesson from cancelling
 * itself: a fly that has come to live in shade still eats there at a higher
 * rate than in the sun, though shade has become its usual.
 *
 * So what it does depends only on where it has eaten. A fly fed in the sun and
 * a fly fed in shade run this same code and come to do opposite things, and
 * neither was told to do either (acquired/study.ts tests exactly that). The
 * learning rule, the senses it reads and the controls it may touch are
 * written here; the behaviour is not.
 *
 * What it reads: `SenseFrame` and the body's own reserve, the fly's senses and
 * nothing else. Never a position, a food patch, an object's id or the world.
 * Odour is left out on purpose, so it cannot simply relearn the fly's innate
 * odour following, which keeps priority: the layer acts only with no food
 * odour to follow. It also stands aside for a loom, a return to remembered
 * food, local search, recovery and sleep, and every command still passes the
 * fly's gate.
 *
 * A model choice throughout, not a claim about how flies do this, and nothing
 * here is evidence of awareness.
 */
import { forward, wrapAngle } from "../../fly/units.js";
import type { BodySnapshot, DecisionInput, MotorCommand } from "../../fly/neural.js";
import { mulberry32 } from "../../../lib/noise.js";

export const ACQUIRED_VERSION = "echo-acquired-search/v1";

/** The situations the layer can tell apart: every entry comes from the senses. */
export const SITUATION = [
  "sunlit",
  "sheltered",
  "landmark",
  "breeze",
  "people",
  "raised",
] as const;
export type SituationFeature = (typeof SITUATION)[number];

/** Every number is a model choice, fixed before any held-out run. */
export const ACQUIRED_PARAMS = {
  /** How far back a meal's situation reaches (s). */
  traceS: 30,
  /** A meal this soon after the last is the same patch, not new evidence (s). */
  newMealS: 120,
  /** The counts span about this many meals: old ones fade only as new ones come. */
  memoryMeals: 24,
  /** Before any meal, the overall rate is taken as one meal in this long (s). */
  priorS: 3600,
  /** How many meals' worth each rate leans on the overall rate. */
  priorMeals: 1,
  /** Meals needed before the layer acts at all. */
  minMeals: 3,
  /** Hungry, looking seconds needed both in and out of a situation before it means anything. */
  minSeenS: 600,
  /** Hungry for this long without a meal, the layer's authority has halved (s). */
  patienceS: 1800,
  /** A value this far from zero is an opinion the fly acts on. */
  distinct: 0.15,
  /** How often a hungry perched fly acts on one, per second. */
  actHz: 0.05,
  /** A flight kept going past its bout stops being kept going here (s). */
  keepFlyingS: 60,
  /** A fall in value this large between decisions is leaving good ground... */
  turnBack: 0.2,
  /** ...which turns the fly back this often (so it does cross, in the end)... */
  turnBackShare: 0.85,
  /** ...and no more than once in this long (s). */
  turnBackEveryS: 20,
  /** A turn back waits this long for the fly to finish what it is doing (s). */
  turnOwedS: 3,
} as const;
const P = ACQUIRED_PARAMS;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Which situations the fly is in now, each 0 or 1, from its senses alone. */
export function situation({ frame }: DecisionInput): number[] {
  const kind = frame.below?.kind;
  const nearest = frame.landmarks.reduce((d, l) => Math.min(d, l.distance), Infinity);
  return [
    frame.light >= 0.7 ? 1 : 0,
    frame.clearance < 2 ? 1 : 0,
    nearest < 6 ? 1 : 0,
    frame.airflow >= 0.2 ? 1 : 0,
    frame.visibleMovers > 0 ? 1 : 0,
    kind !== undefined && kind !== "ground" ? 1 : 0,
  ];
}

export interface AcquiredState {
  version: typeof ACQUIRED_VERSION;
  /** Learning on, or held at what it has (a test of what was learned). */
  learning: boolean;
  /** Acting on, or only learning (an arm that learns but may not use it). */
  acting: boolean;
  /** Meals that counted as evidence. */
  meals: number;
  /** Seconds spent hungry and looking, in and out of each situation. */
  timeIn: number[];
  timeOut: number[];
  /** Meals in and out of each situation, by the half minute of looking before them. */
  mealsIn: number[];
  mealsOut: number[];
  trace: number[];
  lastReward: number;
  wasFeeding: boolean;
  /** Decisions the layer changed, by what it did. */
  keptFlying: number;
  movedOn: number;
  turnedBack: number;
  longFlights: number;
  /** The present situation's value, last computed. */
  value: number;
  lastTurnBack: number;
  leftGoodAt: number;
}

/** What the layer may see and do of the controller it shapes. */
export interface ControllerView {
  /** On its way back to remembered food, or searching where it just ate. */
  busy: boolean;
  /** On a long flight to somewhere it has not been. */
  exploring: boolean;
  /** Point the long flight under way at this heading, for as far as it had left. */
  turnLongFlight(yaw: number): void;
  /** Begin a long flight of the controller's own; false if it found no way to go. */
  setOff(body: BodySnapshot): boolean;
}

export class AcquiredSearch {
  readonly rng: () => number;
  readonly state: AcquiredState = {
    version: ACQUIRED_VERSION,
    learning: true,
    acting: true,
    meals: 0,
    timeIn: SITUATION.map(() => 0),
    timeOut: SITUATION.map(() => 0),
    mealsIn: SITUATION.map(() => 0),
    mealsOut: SITUATION.map(() => 0),
    trace: SITUATION.map(() => 0),
    lastReward: -1e9,
    wasFeeding: false,
    keptFlying: 0,
    movedOn: 0,
    turnedBack: 0,
    longFlights: 0,
    value: 0,
    lastTurnBack: -1e9,
    leftGoodAt: -1e9,
  };

  constructor(seed: number) {
    // A stream of its own: it never takes a draw from the fly's others.
    this.rng = mulberry32((seed ^ 0x61637173) >>> 0);
  }

  /** Follow the senses, and learn from a meal that has just begun. */
  observe(input: DecisionInput): void {
    const s = this.state;
    const { body, dt, params } = input;
    const feeding = body.mode === "feed";
    const hungry = 1 - body.reserve > params.hungerSeek;
    if (feeding && !s.wasFeeding && hungry) this.reward(body);
    s.wasFeeding = feeding;
    // Only time spent looking counts: a fly at rest finds nothing wherever it
    // sits, and flies rest more in shade, so counting it would blame the place.
    if (body.mode !== "flight" && body.mode !== "walk") return;
    const x = situation(input);
    const toTrace = 1 - Math.exp(-dt / P.traceS);
    for (let i = 0; i < x.length; i++) {
      s.trace[i]! += (x[i]! - s.trace[i]!) * toTrace;
      if (s.learning && hungry) {
        if (x[i]! > 0.5) s.timeIn[i]! += dt;
        else s.timeOut[i]! += dt;
      }
    }
  }

  private reward(body: BodySnapshot): void {
    const s = this.state;
    const isNew = body.t - s.lastReward >= P.newMealS;
    // Held or not, it knows it has just eaten.
    s.lastReward = body.t;
    if (!isNew || !s.learning) return;
    s.meals++;
    const fade = 1 - 1 / P.memoryMeals;
    for (let i = 0; i < s.trace.length; i++) {
      s.mealsIn[i]! *= fade;
      s.mealsOut[i]! *= fade;
      s.timeIn[i]! *= fade;
      s.timeOut[i]! *= fade;
      if (s.trace[i]! >= 0.5) s.mealsIn[i]!++;
      else s.mealsOut[i]!++;
    }
  }

  /**
   * How many times more meals come per hour in a situation than out of it, as
   * a log. Each rate leans on the fly's overall rate until there is evidence,
   * so a situation it has hardly met scores near zero: unknown, not bad.
   */
  lift(i: number): number {
    const s = this.state;
    // With nothing to compare it to, a situation says nothing.
    if (s.timeIn[i]! < P.minSeenS || s.timeOut[i]! < P.minSeenS) return 0;
    const meals = s.mealsIn[i]! + s.mealsOut[i]!,
      time = s.timeIn[i]! + s.timeOut[i]!;
    const overall = (meals + 1) / (time + P.priorS);
    const lean = P.priorMeals / overall;
    const rateIn = (s.mealsIn[i]! + P.priorMeals) / (s.timeIn[i]! + lean),
      rateOut = (s.mealsOut[i]! + P.priorMeals) / (s.timeOut[i]! + lean);
    return Math.log(rateIn / rateOut);
  }

  lifts(): number[] {
    return SITUATION.map((_, i) => this.lift(i));
  }

  /** How much of its authority the layer has now: nothing until meals have shown something. */
  authority(t: number): number {
    const s = this.state;
    if (!s.acting || s.meals < P.minMeals) return 0;
    // A fly long unfed trusts what it knows less, and falls back on what it
    // always did: a wrong lesson cannot hold it for ever.
    return Math.pow(0.5, Math.max(0, t - s.lastReward) / P.patienceS);
  }

  /** What the lifts say of a situation: above zero, better than the alternative. */
  value(x: readonly number[]): number {
    let v = 0;
    for (let i = 0; i < x.length; i++) v += this.lift(i) * (x[i]! - 0.5);
    return clamp(v, -1, 1);
  }

  /**
   * The controller has intended `command`. Shape it, or leave it. Nothing
   * here runs with food odour to follow, a loom in view, or a purpose of the
   * controller's own, and a fly that is not hungry is left entirely alone.
   */
  shape(
    input: DecisionInput,
    command: MotorCommand,
    controller: ControllerView,
  ): MotorCommand {
    const s = this.state;
    const { body, frame, params } = input;
    const hungry = 1 - body.reserve > params.hungerSeek;
    const authority = this.authority(body.t);
    const before = s.value;
    if (
      authority <= 0 ||
      !hungry ||
      controller.busy ||
      frame.looming !== null ||
      frame.odour >= params.odourDetect ||
      input.sites.some((site) => site.food) ||
      body.onFood !== null ||
      body.edge
    ) {
      s.value = 0;
      return command;
    }
    const here = this.value(situation(input)) * authority;
    s.value = here;
    const hazard = 1 - Math.exp(-P.actHz * input.dt);
    const fwd = forward(body.yaw);
    const cruise = params.cruiseCmS / 100;

    const poor = here < -P.distinct;

    if (body.mode === "flight") {
      // Leaving ground worth searching: usually turn back, as fast as it was
      // going. New ground is what finds food, so nothing here slows the fly or
      // keeps it in the air on good ground.
      if (before > P.distinct && before - here > P.turnBack) s.leftGoodAt = body.t;
      if (
        body.t - s.leftGoodAt < P.turnOwedS &&
        here <= P.distinct &&
        body.t - s.lastTurnBack > P.turnBackEveryS &&
        command.mode === "flight" &&
        !command.saccade &&
        !command.hover &&
        body.sub === "cruise"
      ) {
        s.lastTurnBack = body.t;
        s.leftGoodAt = -1e9;
        if (this.rng() < P.turnBackShare) {
          s.turnedBack++;
          const saccade = (this.rng() < 0.5 ? -1 : 1) * (2.4 + 0.6 * this.rng());
          if (controller.exploring) controller.turnLongFlight(body.yaw + saccade);
          return {
            ...command,
            saccade,
            reason: `turning back: meals come from where it just was (now ${here.toFixed(2)})`,
          };
        }
      }
      // On poor ground the air is the way off it.
      if (poor) {
        if (!controller.exploring && controller.setOff(body)) s.longFlights++;
        const clearAhead =
          Math.min(frame.ttcLeft, frame.ttcRight, frame.ttcFront) > 2 * params.avoidTtcS;
        if (command.mode === "land" && clearAhead && body.flightT < P.keepFlyingS) {
          s.keptFlying++;
          return {
            mode: "flight",
            velocity: [fwd[0] * cruise, 0, fwd[2] * cruise],
            reason: `flying on: meals have not come from places like this (${here.toFixed(2)})`,
          };
        }
      }
      return command;
    }

    // A hungry fly idling where meals do not come from moves on.
    if (
      (body.mode === "walk" || body.mode === "rest") &&
      (command.mode === "rest" || command.mode === "walk") &&
      poor &&
      this.rng() < hazard
    ) {
      s.movedOn++;
      return {
        mode: "takeoff",
        heading: wrapAngle(body.yaw),
        prepare: params.takeoffPrepMs / 1000,
        reason: `moving on: meals have not come from places like this (${here.toFixed(2)})`,
      };
    }
    return command;
  }
}
