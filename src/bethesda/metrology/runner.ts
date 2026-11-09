/**
 * The bench's runner: one unit (seed × condition × controller) at a time,
 * deterministic, bounded and honest about failure.
 *
 * - Bounded: a run takes exactly the protocol's ticks, in chunks; between chunks
 *   the wall clock is checked against `limits.maxWallSPerRun`, and a run that
 *   exceeds it stops and is recorded as `timeout` (censored), never retried.
 * - Errors are recorded, never swallowed or replaced: `status: "error"` with the
 *   message, and the analysis counts it against `decision.maxFailedFraction`.
 * - The behavioural record is a pure function of the protocol and the unit; the
 *   `compute` block (wall and CPU time) is the machine's and is never compared
 *   by the verifier or used in a verdict.
 *
 * The clock is injected so this module stays free of Node APIs (scope.test.ts).
 */
import { TICK_S } from "../life/individuality.js";
import { CONTROLLERS, type ControllerId } from "./controllers.js";
import { beliefTargetOf, MetrologyLife, type Block } from "./life.js";
import {
  BEHAVIOUR_METRICS,
  conditionOf,
  protocolDigest,
  type BehaviourMetric,
  type Protocol,
  type Split,
  type Unit,
} from "./protocol.js";

export const RECORD_SCHEMA = "eimb-record/v1" as const;

export interface Clock {
  /** Monotonic wall time, ms. */
  wallMs(): number;
  /** Process CPU time, ms; null where the host cannot say. */
  cpuMs(): number | null;
}

export interface SelfModelReading {
  /** The belief the condition makes wrong (or the leg speed gain when none does). */
  target: string;
  beliefEnd: number | null;
  truthEnd: number;
  errorEnd: number | null;
  /** Seconds from onset until the belief first came within tolerance of the truth; null if never (censored). */
  convergedS: number | null;
  /** Changes the self-model noticed (inquiries opened) before the onset and after it. */
  noticedBeforeOnset: number;
  noticedAfterOnset: number;
  /** Share of forward self-motion readings inside the self-model's predicted central 90% and 50%. */
  calibration90: number | null;
  calibration50: number | null;
  calibrationN: number;
}

export interface PlasticityReading {
  mode: string;
  samples: number;
  discarded: number;
  adaptations: number;
  shadowWouldAdapt: number;
  /** Whether it would have acted before the onset (a false alarm), or in a condition with no perturbation. */
  cautiousBeforeOnset: boolean;
  /** Seconds from onset until it first would act; null if never (censored at the run's end). */
  detectionS: number | null;
  /** Seconds from the end of the impairment until it stopped acting; null if it never stopped (censored). */
  releaseS: number | null;
  failureNormal: number;
  failureLow: number;
  nNormal: number;
  nLow: number;
}

export interface RunRecord {
  schema: typeof RECORD_SCHEMA;
  protocol: string;
  protocolDigest: string;
  split: Split;
  seed: number;
  condition: string;
  controller: ControllerId;
  subject: string;
  status: "complete" | "timeout" | "error";
  error: string | null;
  ticks: number;
  behaviour: Record<BehaviourMetric, number | null>;
  selfModel: SelfModelReading | null;
  plasticity: PlasticityReading | null;
  blocks: Block[];
  environmentDigest: string | null;
  bodyHash: string | null;
  /** The machine's, not the experiment's: never compared, never in a verdict. */
  compute: { wallS: number; cpuS: number | null; ticksPerWallS: number | null };
}

export const subjectOf = (p: Protocol, split: Split, u: Unit): string =>
  `research-eimb-${p.id}-${split}-${u.seed}-${u.condition}-${u.controller}`;

const nullIfNaN = (x: number) => (Number.isFinite(x) ? x : null);

function behaviourOf(life: MetrologyLife): Record<BehaviourMetric, number | null> {
  const s = life.fly.state,
    c = s.counts,
    t = life.tally;
  // Close the placement still open at the end.
  const placements = [
    ...t.placements,
    {
      windowS: (life.tick - t.movedAtTick) * TICK_S,
      latencyS: c.meals > t.mealsAtMove ? t.latencies.at(-1)! * TICK_S : null,
    },
  ].filter((p) => p.windowS > 0);
  const restricted = placements.length
    ? placements.reduce((a, p) => a + Math.min(p.latencyS ?? p.windowS, p.windowS), 0) /
      placements.length
    : null;
  const durationS = life.tick * TICK_S;
  const out: Record<BehaviourMetric, number | null> = {
    meals: c.meals,
    fedJ: c.fedJ,
    lateFedJ: t.fedAtLate === null ? null : c.fedJ - t.fedAtLate,
    spentJ: c.spentJ,
    netJ: c.fedJ - c.spentJ,
    endReserve: s.reserve / life.fly.params.reserveJ,
    collisions: c.collisions,
    walkingBlocks: t.walkingBlocks,
    rejected: c.rejected,
    walkedM: c.walkedM,
    flownM: c.flownM,
    walkingShare: t.walkingTicks / Math.max(1, life.tick),
    restrictedLatencyS: restricted,
    placementsMissed: t.censored + (c.meals > t.mealsAtMove ? 0 : 1),
    meanFoodDistanceM: t.distanceN ? t.distanceSum / t.distanceN : null,
    firstMealAfterOnsetS:
      life.onsetS === null
        ? null
        : (t.firstMealAfterOnsetS ?? Math.max(0, durationS - life.onsetS)),
  };
  for (const k of BEHAVIOUR_METRICS) {
    const v = out[k];
    if (v !== null) out[k] = nullIfNaN(v);
  }
  return out;
}

function selfModelOf(life: MetrologyLife): SelfModelReading | null {
  const m = life.organism.model;
  if (!m) return null;
  const st = m.state;
  const target = beliefTargetOf(life.spec.condition);
  const now = life.tick * TICK_S;
  const beliefEnd = life.belief();
  const truthEnd = life.truthAt(now);
  const atOnset = life.tally.noticedAtOnset;
  const noticed = st.counts.inquiries;
  const n = st.calibration.n;
  return {
    target: target?.name ?? "leg speed gain",
    beliefEnd,
    truthEnd,
    errorEnd: beliefEnd === null ? null : Math.abs(beliefEnd - truthEnd),
    convergedS: life.tally.convergedS,
    noticedBeforeOnset: atOnset ?? noticed,
    noticedAfterOnset: atOnset === null ? 0 : noticed - atOnset,
    calibration90: n ? st.calibration.in90[0]! / n : null,
    calibration50: n ? st.calibration.in50[0]! / n : null,
    calibrationN: n,
  };
}

function plasticityOf(life: MetrologyLife): PlasticityReading | null {
  const p = life.plasticity;
  if (!p) return null;
  const s = p.status();
  return {
    mode: s.mode,
    samples: s.samples,
    discarded: s.discarded,
    adaptations: s.adaptations,
    shadowWouldAdapt: s.shadowWouldAdapt,
    cautiousBeforeOnset: life.tally.cautiousBeforeOnset,
    detectionS: life.tally.detectionS,
    releaseS: life.tally.releaseS,
    failureNormal: s.contexts.normal.failure,
    failureLow: s.contexts.low.failure,
    nNormal: s.contexts.normal.n,
    nLow: s.contexts.low.n,
  };
}

/** Run one unit start to end and record what happened. Never throws for a fly's failure: it records it. */
export function runUnit(p: Protocol, split: Split, u: Unit, clock: Clock): RunRecord {
  const subject = subjectOf(p, split, u);
  const base = {
    schema: RECORD_SCHEMA,
    protocol: p.id,
    protocolDigest: protocolDigest(p),
    split,
    seed: u.seed,
    condition: u.condition,
    controller: u.controller,
    subject,
  };
  if (!CONTROLLERS[u.controller]) throw new Error(`unknown controller ${u.controller}`);
  const total = Math.round(p.durationS / TICK_S);
  const wall0 = clock.wallMs(),
    cpu0 = clock.cpuMs();
  let life: MetrologyLife | null = null;
  let status: RunRecord["status"] = "complete";
  let error: string | null = null;
  try {
    life = new MetrologyLife({
      seed: u.seed,
      condition: conditionOf(p, u.condition),
      controller: u.controller,
      subject,
      durationS: p.durationS,
      blockS: p.blockS,
      sampleEveryTicks: p.sampleEveryTicks,
      lateFromS: p.lateFromS,
    });
    const chunk = 1000;
    while (life.tick < total) {
      life.step(Math.min(chunk, total - life.tick));
      if ((clock.wallMs() - wall0) / 1000 > p.limits.maxWallSPerRun && life.tick < total) {
        status = "timeout";
        error = `stopped at tick ${life.tick} of ${total}: over ${p.limits.maxWallSPerRun} s of wall time`;
        break;
      }
    }
  } catch (e) {
    status = "error";
    error = e instanceof Error ? e.message : String(e);
  }
  const wallS = (clock.wallMs() - wall0) / 1000;
  const cpu1 = clock.cpuMs();
  const compute = {
    wallS,
    cpuS: cpu0 === null || cpu1 === null ? null : (cpu1 - cpu0) / 1000,
    ticksPerWallS: life && wallS > 0 ? life.tick / wallS : null,
  };
  if (!life || status !== "complete")
    return {
      ...base,
      status,
      error,
      ticks: life?.tick ?? 0,
      behaviour: Object.fromEntries(BEHAVIOUR_METRICS.map((k) => [k, null])) as Record<
        BehaviourMetric,
        null
      >,
      selfModel: null,
      plasticity: null,
      blocks: life?.blocks ?? [],
      environmentDigest: life?.environmentDigest() ?? null,
      bodyHash: null,
      compute,
    };
  return {
    ...base,
    status,
    error,
    ticks: life.tick,
    behaviour: behaviourOf(life),
    selfModel: selfModelOf(life),
    plasticity: plasticityOf(life),
    blocks: life.blocks,
    environmentDigest: life.environmentDigest(),
    bodyHash: life.bodyHash(),
    compute,
  };
}

/** A record without its machine-dependent part: what a replay must reproduce byte for byte. */
export function behaviouralPart(r: RunRecord): Omit<RunRecord, "compute"> {
  const { compute: _compute, ...rest } = r;
  void _compute;
  return rest;
}
