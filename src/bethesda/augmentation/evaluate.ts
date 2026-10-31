/**
 * Mode A evidence: does an advisor, observing only what the fly senses,
 * predict when the fly's own controller escapes?
 *
 * For each seed a new research subject perches in an arena where looming
 * stimuli approach from seeded directions, sizes and speeds
 * (`protocols/giant-fiber-v1.json`, frozen before any run). The controller
 * decides everything; the advisor observes (`AugmentedAdapter`, observe
 * mode, so the fly is byte for byte what it would be without it). Escape
 * onsets are matched event by event: a controller onset is a hit when the
 * advisor predicted an onset within `windowS` of it.
 *
 * The held-out phase's totals form the advisor's `AdvisorValidation`, and
 * `canAdvise` decides from them whether it may ever advise. This measures
 * agreement between two models of the same reflex (the controller's
 * giant-fiber proxy and Ache et al. 2019's fitted potential); it is not a
 * measurement of a real fly.
 */
import { mulberry32 } from "../../lib/noise.js";
import { arenaWorld, type ArenaSpec, type LoomSpec } from "../fly/arena.js";
import { ReducedOrderController } from "../fly/controller.js";
import { DigitalFly } from "../fly/fly.js";
import type { AdapterStreams } from "../fly/neural.js";
import { forward, type V3 } from "../fly/units.js";
import { refuseOriginal } from "../firstContact/originals.js";
import { adapterFor, type SubjectController } from "../firstContact/subjects.js";
import { r } from "../firstContact/stats.js";
import { GiantFiberAdvisor } from "./advisors.js";
import {
  ADVICE_CRITERIA,
  AugmentedAdapter,
  canAdvise,
  onsetAgreement,
  type AdvisorValidation,
} from "./layer.js";

export const ADVISOR_STUDY_SCHEMA = "augmentation-advisor-study/v1" as const;

export interface AdvisorStudyProtocol {
  schema: typeof ADVISOR_STUDY_SCHEMA;
  id: string;
  question: string;
  controllers: SubjectController[];
  phases: Record<"development" | "held-out", { seedBase: number; subjects: number }>;
  durationS: number;
  windowS: number;
  looms: {
    count: number;
    firstS: number;
    intervalS: number;
    distanceM: [number, number];
    speedMS: [number, number];
    radiusM: [number, number];
  };
}

/** The seeded loom schedule for one subject (the design's random draws). */
export function loomSchedule(p: AdvisorStudyProtocol, seed: number): LoomSpec[] {
  const rng = mulberry32((seed ^ 0x7f4a7c15) >>> 0);
  const between = ([a, b]: [number, number]) => a + (b - a) * rng();
  return Array.from({ length: p.looms.count }, (_, i) => {
    const az = (rng() * 2 - 1) * Math.PI;
    const d = between(p.looms.distanceM);
    const dir = forward(az);
    const from: V3 = [dir[0] * d, 0.02 + 0.2 * rng(), dir[2] * d];
    return {
      start: p.looms.firstS + i * p.looms.intervalS,
      period: 0,
      count: 1,
      from,
      to: [0, 0.01, 0],
      speedMS: between(p.looms.speedMS),
      radiusM: between(p.looms.radiusM),
    };
  });
}

export interface PhaseResult {
  subjects: number;
  /** Event-level totals over all subjects of each controller. */
  byController: {
    controller: SubjectController;
    hits: number;
    misses: number;
    falseAlarms: number;
    /** Sampled opportunities with no onset from either: the denominator of the false-alarm rate. */
    correctRejections: number;
    hitRate: number | null;
    falseAlarmRate: number | null;
  }[];
}

export function runAdvisorPhase(
  p: AdvisorStudyProtocol,
  phase: "development" | "held-out",
): PhaseResult {
  const ph = p.phases[phase];
  const byController = p.controllers.map((c, ci) => {
    let hits = 0,
      misses = 0,
      falseAlarms = 0,
      correctRejections = 0;
    for (let i = 0; i < ph.subjects; i++) {
      const seed = ph.seedBase + ci * 10_000 + i;
      const subject = `research-augmentation-${phase}-${c}-${i}`;
      refuseOriginal(subject);
      const arena: ArenaSpec = {
        size: [1, 0.6, 1],
        ambient: 1,
        lights: [{ at: [0, 0.6, 0], intensity: 1 }],
        looms: loomSchedule(p, seed),
      };
      const make =
        adapterFor(c, seed) ??
        ((rng: () => number, st: AdapterStreams) =>
          new ReducedOrderController(rng, st.navigation));
      const held: { layer?: AugmentedAdapter } = {};
      const fly = new DigitalFly({
        seed,
        world: arenaWorld(arena, `advisor-arena:${subject}`),
        start: { p: [0, 0.1, 0], yaw: 0 },
        adapter: (rng, st) =>
          (held.layer = new AugmentedAdapter(make(rng, st), new GiantFiberAdvisor(seed), {
            subject,
            // A deterministic study: no wall-clock budget can switch the advisor off.
            budgetMs: Number.POSITIVE_INFINITY,
          })),
      });
      fly.advance(p.durationS);
      const rec = held.layer!.record;
      const a = onsetAgreement(rec.onsets, p.windowS);
      hits += a.hits;
      misses += a.misses;
      falseAlarms += a.falseAlarms;
      correctRejections += rec.escape.correctRejections;
    }
    return {
      controller: c,
      hits,
      misses,
      falseAlarms,
      correctRejections,
      hitRate: hits + misses ? r(hits / (hits + misses)) : null,
      falseAlarmRate:
        falseAlarms + correctRejections
          ? r(falseAlarms / (falseAlarms + correctRejections), 6)
          : null,
    };
  });
  return { subjects: ph.subjects, byController };
}

export interface AdvisorStudyResult {
  schema: typeof ADVISOR_STUDY_SCHEMA;
  protocol: { id: string; sha256: string };
  advisor: string;
  criteria: typeof ADVICE_CRITERIA;
  development: PhaseResult;
  heldOut: PhaseResult;
  /** The held-out validation and the gate's verdict, per controller. */
  gate: {
    controller: SubjectController;
    validation: AdvisorValidation;
    mayAdvise: boolean;
    why: string;
  }[];
  digest: string;
}

export function runAdvisorStudy(
  p: AdvisorStudyProtocol,
  sha256: string,
  digest: (v: unknown) => string,
  source: string,
): AdvisorStudyResult {
  if (p.schema !== ADVISOR_STUDY_SCHEMA) throw new Error("advisor study: schema");
  const development = runAdvisorPhase(p, "development");
  const heldOut = runAdvisorPhase(p, "held-out");
  const gate = heldOut.byController.map((x) => {
    const validation: AdvisorValidation = {
      source,
      heldOut: true,
      hits: x.hits,
      misses: x.misses,
      falseAlarms: x.falseAlarms,
      correctRejections: x.correctRejections,
    };
    const g = canAdvise(validation);
    return { controller: x.controller, validation, mayAdvise: g.ok, why: g.why };
  });
  const body = {
    schema: ADVISOR_STUDY_SCHEMA,
    protocol: { id: p.id, sha256 },
    advisor: new GiantFiberAdvisor(0).id,
    criteria: ADVICE_CRITERIA,
    development,
    heldOut,
    gate,
  };
  return { ...body, digest: digest(body) };
}
