/**
 * The looming battery for the research eye: stimuli generated from a frozen
 * protocol, each shown to new research flies built from seeds, perched at
 * the centre of the battery arena in the deployed configuration
 * (`OrganismAdapter`, ECHO v3 with the organism's additions).
 *
 * Three runs per trial (stimulus × fly seed), each its own fresh fly:
 *
 * - **held**: the eye observes and the deployed controller decides as
 *   always, but a tap records every command first and then holds the body
 *   perched (an escape becomes rest), so every readout is scored on the same
 *   image stream. The deployed controller's own first escape command is the
 *   `deployed` arm's decision.
 * - **deployed, live**: the deployed configuration, unwrapped, free to
 *   escape. Its first escape must be the held run's (a check).
 * - **eye, live**: the deployed configuration seeing looming through the eye
 *   (`EyeAdapter` in drive mode at the gain chosen on development data).
 *
 * A seeded study on research subjects, not a registered R.A.I.N. experiment.
 */
import { mulberry32 } from "../../lib/noise.js";
import { DigitalFly } from "../fly/fly.js";
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../fly/neural.js";
import type { V3 } from "../fly/units.js";
import { OrganismAdapter } from "../life/organism.js";
import { EyeAdapter, type EyeRecord } from "./adapter.js";
import { LATTICE, LOOMING_UNITS } from "./lattice.js";
import { MotionVision, shuffledWiring, type MotionOutput } from "./motion.js";
import { VISION_VERSIONS, type VisionVersion } from "./params.js";
import {
  batteryArena,
  groundTruth,
  segments,
  StimulusWorld,
  type GroundTruth,
  type Segment,
  type StimulusKind,
  type StimulusSpec,
} from "./stimuli.js";

export const PROTOCOL_SCHEMA = "vision-looming-protocol/v1";

/** A ranged parameter [lo, hi] (uniform), or a list to choose from. */
export type Range = [number, number] | { choices: number[] };

export interface Cell {
  kind: StimulusKind;
  n: number;
  radius: Range;
  contrast: Range;
  azimuth_deg: Range;
  elevation_deg: Range;
  ambient: Range;
  speed?: Range;
  speed2?: Range;
  distance?: Range;
  duration_s?: Range;
  /** approach_stop: where its surface stops (m). */
  stop_surface?: Range;
  hold_s?: Range;
  /** near_miss, lateral, zigzag, stationary: closest surface (m) → miss or distance. */
  miss_surface?: Range;
  /** glancing: the centre's miss as a share of its radius. */
  miss_frac?: Range;
  half_length?: Range;
}

export interface Split {
  generator_seed: number;
  fly_seeds: number[];
  cells: Cell[];
}

export interface Protocol {
  schema: string;
  id: string;
  vision_version: VisionVersion;
  fly: { position: V3; yaw: number };
  timeline: { lead_in_s: number; tail_s: number; sample_s: number };
  splits: Record<string, Split>;
  [k: string]: unknown;
}

export interface Stimulus extends StimulusSpec {
  index: number;
  ambient: number;
  texture_seed: number;
}

const draw = (r: Range, rng: () => number): number => {
  if (Array.isArray(r)) return r[0] + (r[1] - r[0]) * rng();
  return r.choices[Math.floor(rng() * r.choices.length)]!;
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The split's stimuli, drawn in cell order from its generator seed. */
export function generate(split: Split): Stimulus[] {
  const rng = mulberry32(split.generator_seed >>> 0);
  const out: Stimulus[] = [];
  for (const cell of split.cells) {
    for (let k = 0; k < cell.n; k++) {
      const radius = r3(draw(cell.radius, rng));
      const s: Stimulus = {
        index: out.length,
        kind: cell.kind,
        radius,
        contrast: r3(draw(cell.contrast, rng)),
        azimuth_deg: r3(draw(cell.azimuth_deg, rng)),
        elevation_deg: r3(draw(cell.elevation_deg, rng)),
        ambient: r3(draw(cell.ambient, rng)),
        texture_seed: Math.floor(rng() * 0x7fffffff),
      };
      if (cell.speed) s.speed = r3(draw(cell.speed, rng));
      if (cell.speed2) s.speed2 = r3(draw(cell.speed2, rng));
      if (cell.distance) s.distance = r3(draw(cell.distance, rng));
      if (cell.duration_s) s.duration_s = r3(draw(cell.duration_s, rng));
      if (cell.stop_surface) s.stop_surface = r3(draw(cell.stop_surface, rng));
      if (cell.hold_s) s.hold_s = r3(draw(cell.hold_s, rng));
      if (cell.half_length) s.half_length = r3(draw(cell.half_length, rng));
      if (cell.miss_surface) {
        const surf = draw(cell.miss_surface, rng);
        if (cell.kind === "stationary") s.distance = r3(radius + surf);
        else s.miss = r3(radius + surf);
      }
      if (cell.miss_frac) s.miss = r3(radius * draw(cell.miss_frac, rng));
      out.push(s);
    }
  }
  return out;
}

export interface Trial {
  stimulus: Stimulus;
  segments: Segment[];
  truth: GroundTruth;
  world: StimulusWorld;
  /** When the run ends (s). */
  end: number;
}

export function trial(protocol: Protocol, s: Stimulus): Trial {
  const p = protocol.fly.position;
  const segs = segments(s, p, protocol.fly.yaw, protocol.timeline.lead_in_s);
  const truth = groundTruth(s, segs, p);
  const world = new StimulusWorld(
    batteryArena(s.ambient),
    { spec: s, segments: segs, truth },
    s.texture_seed,
  );
  const end = (truth.threat ? truth.tCollision! : truth.tOff) + protocol.timeline.tail_s;
  return { stimulus: s, segments: segs, truth, world, end };
}

const MOVES = new Set(["escape", "takeoff", "walk", "flight", "land"]);

/** Records every command the wrapped decision maker gives; when holding, keeps the body perched. */
export class Tap implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  readonly hold: boolean;
  /** The first escape command's time (s), or null. */
  firstEscape: number | null = null;
  escapes = 0;
  held = 0;
  constructor(inner: FlyNeuralAdapter, hold: boolean) {
    this.inner = inner;
    this.hold = hold;
    this.descriptor = hold
      ? { ...inner.descriptor, id: `${inner.descriptor.id}, held perched` }
      : inner.descriptor;
  }
  start(body: BodySnapshot): void {
    this.inner.start?.(body);
  }
  private seen(c: MotorCommand, t: number): MotorCommand {
    if (c.mode === "escape") {
      this.escapes++;
      if (this.firstEscape === null) this.firstEscape = t;
    }
    if (!this.hold || !MOVES.has(c.mode)) return c;
    this.held++;
    return { mode: "rest", reason: `held: ${c.reason.slice(0, 120)}` };
  }
  decide(input: DecisionInput): MotorCommand {
    return this.seen(this.inner.decide(input), input.body.t);
  }
  interrupt(input: DecisionInput): MotorCommand | null {
    const c = this.inner.interrupt?.(input) ?? null;
    return c ? this.seen(c, input.body.t) : null;
  }
}

/** One decision time series per readout, from a held run: value at each call, for the frame it decides on. */
export interface HeldSeries {
  /** Call times (s). */
  t: number[];
  geometricDrive: number[];
  sizeDeg: number[];
  /** Angular expansion over size (1/s): the inverse of the visual time to contact τ. */
  inverseTau: number[];
  lplc2: number[];
  expansion: number[];
  shuffled: number[];
  /** The deployed controller's own first escape command (s), or null. */
  deployedEscape: number | null;
  /** Wall-clock seconds the run took. */
  wallS: number;
  /** Simulated seconds. */
  simS: number;
}

const flyConfig = { takeoffHz: 0, walkStartHz: 0, groomHz: 0 };

/** The subject id of a research fly in this battery. */
export const subjectId = (split: string, s: Stimulus, seed: number) =>
  `research-vision-${split}-${s.index}-${seed}`;

/** The held run: everything every readout needs, from one fly whose body is kept perched. */
export function heldRun(
  protocol: Protocol,
  split: string,
  tr: Trial,
  seed: number,
  now: () => number,
): HeldSeries {
  const t0 = now();
  const s = tr.stimulus;
  const subject = subjectId(split, s, seed);
  const eyeSeed = (Math.imul(seed, 0x9e3779b1) ^ s.index) >>> 0;
  const records: EyeRecord[] = [];
  // The shuffled control sees the same images through its own wiring.
  const shuffled = new MotionVision(LATTICE, LOOMING_UNITS, {
    shuffle: shuffledWiring(LATTICE, mulberry32((eyeSeed ^ 0x51ab1e) >>> 0)),
    adaptation: VISION_VERSIONS[protocol.vision_version],
  });
  const shuffledOut = new Map<number, MotionOutput>();
  let tap: Tap | null = null;
  let eye: EyeAdapter | null = null;
  const fly = new DigitalFly({
    seed,
    world: tr.world,
    start: { p: protocol.fly.position, yaw: protocol.fly.yaw },
    config: flyConfig,
    adapter: (rng, streams) => {
      eye = new EyeAdapter(new OrganismAdapter(rng, streams, seed), {
        subject,
        seed: eyeSeed,
        scene: tr.world,
        mode: "observe",
        readout: "lplc2",
        gain: 1,
        version: protocol.vision_version,
        record: (r) => records.push(r),
        image: (img, t) => shuffledOut.set(round6(t), shuffled.step(img, t)),
      });
      tap = new Tap(eye, true);
      return tap;
    },
  });
  const step = protocol.timeline.sample_s;
  while (fly.state.t < tr.end - 1e-9) fly.advance(step);
  const byT = new Map<number, MotionOutput>();
  for (const r of records) byT.set(round6(r.t), r.out);
  const out: HeldSeries = {
    t: [],
    geometricDrive: [],
    sizeDeg: [],
    inverseTau: [],
    lplc2: [],
    expansion: [],
    shuffled: [],
    deployedEscape: (tap as Tap | null)?.firstEscape ?? null,
    wallS: 0,
    simS: fly.state.t,
  };
  if (!eye) throw new Error("the eye was not built");
  for (const r of records) {
    const ft = round6(r.frameT);
    const o = byT.get(ft),
      sh = shuffledOut.get(ft),
      l = r.geometric;
    out.t.push(r.t);
    out.geometricDrive.push(r.geometricDrive);
    out.sizeDeg.push(l ? l.sizeDeg : 0);
    out.inverseTau.push(
      l && l.expansionDegS > 0 && l.sizeDeg > 0 ? l.expansionDegS / l.sizeDeg : 0,
    );
    out.lplc2.push(o ? o.lplc2 : 0);
    out.expansion.push(o ? o.expansion : 0);
    out.shuffled.push(sh ? sh.lplc2 : 0);
  }
  out.wallS = now() - t0;
  return out;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface LiveRun {
  firstEscape: number | null;
  escapes: number;
  /** For the eye: how many samples it replaced the frame's looming in, and reported one. */
  replaced: number;
  reported: number;
  wallS: number;
  simS: number;
}

/** A live run: the deployed configuration (eye null) or it seeing through the eye at `gain`. */
export function liveRun(
  protocol: Protocol,
  split: string,
  tr: Trial,
  seed: number,
  eyeGain: number | null,
  now: () => number,
): LiveRun {
  const t0 = now();
  const s = tr.stimulus;
  const eyeSeed = (Math.imul(seed, 0x9e3779b1) ^ s.index) >>> 0;
  let tap: Tap | null = null;
  let eye: EyeAdapter | null = null;
  const fly = new DigitalFly({
    seed,
    world: tr.world,
    start: { p: protocol.fly.position, yaw: protocol.fly.yaw },
    config: flyConfig,
    adapter: (rng, streams) => {
      const organism = new OrganismAdapter(rng, streams, seed);
      if (eyeGain === null) tap = new Tap(organism, false);
      else {
        eye = new EyeAdapter(organism, {
          subject: subjectId(split, s, seed),
          seed: eyeSeed,
          scene: tr.world,
          mode: "drive",
          readout: "lplc2",
          gain: eyeGain,
          version: protocol.vision_version,
        });
        tap = new Tap(eye, false);
      }
      return tap;
    },
  });
  const step = protocol.timeline.sample_s;
  // A live run ends at the first escape: what follows is a flying fly, not this battery's question.
  while (fly.state.t < tr.end - 1e-9) {
    fly.advance(step);
    if ((tap as Tap | null)?.firstEscape !== null) break;
  }
  const T = tap as Tap | null;
  const E = eye as EyeAdapter | null;
  return {
    firstEscape: T?.firstEscape ?? null,
    escapes: T?.escapes ?? 0,
    replaced: E?.replaced ?? 0,
    reported: E?.reported ?? 0,
    wallS: now() - t0,
    simS: fly.state.t,
  };
}
