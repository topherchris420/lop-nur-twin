/**
 * Eva's embodied plasticity, `deploy/garden/service/eva_plasticity.py`
 * (`eva-embodied-plasticity/v1`), with its sidecar file replaced by an
 * in-memory object holding the same fields.
 *
 * Ported exactly: `fresh`, `bounds`, `choose` (and `_better`), `observe`,
 * `status`, and the mode change a restart under another `EVA_PLASTICITY`
 * records in `mode_history` (`restart`). It never draws from her random
 * stream and never writes into her state.
 *
 * Reading a sidecar file's contents (`check`) is `sidecarMemory`; the refusal
 * to bind a sidecar from another life or one ahead of her tick is in
 * `EvaGarden.restore`, which throws where her extension would refuse.
 *
 * Omitted, because this port has no files: the sidecar's atomic writes and
 * daily rolling copies (`save`, `_atomic`, `snapshots`, `saved_at`), the
 * sidecar path rules and `from_environment`. Wall-clock times Python takes from `time.time()`
 * (`created_at`, `mode_history[].at`) are the simulated time the caller
 * passes. Any exception inside a hook disables the extension, as in Python,
 * and she carries on as her original service would.
 *
 * A toy sensorimotor model of a simulated fly: no claim about real flies,
 * and no claim of experience or consciousness follows from anything it counts.
 */
import { context, type Weather } from "./learning.js";
import { pyDist, pyHypot, pyRound } from "./pyMath.js";
import type { EvaState } from "./garden.js";

export const VERSION = "eva-embodied-plasticity/v1";
export type PlasticityMode = "shadow" | "active";
const MOTIONS = ["fly", "walk"] as const;
type Motion = (typeof MOTIONS)[number];

export const PARAMS = Object.freeze({
  // Steps of evidence each motion needs, in the current condition, before any swap.
  min_evidence: 30,
  // Two-sided 95% normal bounds on the mean progress rate.
  z: 1.96,
  // Above this many steps a motion's estimate is rescaled to half: bounded memory, still moving.
  count_cap: 2000,
  // A step counts only when the command asked for at least this effort (0..1).
  min_effort: 0.5,
  recent: 32,
  mode_history: 64,
});

export interface Stat {
  n: number;
  mean: number;
  m2: number;
}

export interface Override {
  tick: number;
  at: number;
  condition: string;
  from: Motion;
  to: Motion;
}

export interface Evidence {
  tick: number;
  motion: Motion;
  condition: string;
  rate: number;
}

/** The sidecar's fields, minus `snapshots` (its daily file copies). */
export interface PlasticityMemory {
  schema: string;
  life_id: string;
  born_at: number;
  created_tick: number;
  created_at: number;
  last_tick: number | null;
  mode: PlasticityMode;
  mode_history: {
    tick: number;
    at: number;
    from: PlasticityMode | null;
    to: PlasticityMode;
  }[];
  stats: Record<string, Stat>;
  samples: number;
  discarded: number;
  duplicates: number;
  overrides: number;
  would_override: number;
  last_override: Override | null;
  recent: Evidence[];
}

export function fresh(
  lifeId: string,
  bornAt: number,
  tick: number,
  mode: PlasticityMode,
  at: number,
): PlasticityMemory {
  return {
    schema: VERSION,
    life_id: lifeId,
    born_at: bornAt,
    created_tick: tick,
    created_at: at,
    last_tick: null,
    mode,
    mode_history: [{ tick, at, from: null, to: mode }],
    stats: {},
    samples: 0,
    discarded: 0,
    duplicates: 0,
    overrides: 0,
    would_override: 0,
    last_override: null,
    recent: [],
  };
}

/** Mean and its 95% bounds, or null without two steps of evidence. */
export function bounds(stat: Stat | undefined): [number, number, number] | null {
  if (!stat || stat.n < 2) return null;
  const sd = Math.sqrt(Math.max(0.0, stat.m2 / (stat.n - 1)));
  const half = (PARAMS.z * sd) / Math.sqrt(stat.n);
  return [stat.mean, stat.mean - half, stat.mean + half];
}

const finite = (...values: unknown[]) =>
  values.every((v) => typeof v === "number" && Number.isFinite(v));

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * A sidecar file's contents as her extension reads them (`check` in
 * eva_plasticity.py, the same rules and messages), kept as this port's memory:
 * everything but `snapshots`, the bookkeeping of its daily file copies, which
 * never changes what she does. Throws for anything `check` refuses.
 */
export function sidecarMemory(value: unknown): PlasticityMemory {
  const v = value as Record<string, unknown> | null;
  if (typeof v !== "object" || v === null || Array.isArray(v) || v.schema !== VERSION)
    throw new Error("not an eva-embodied-plasticity/v1 sidecar");
  if (typeof v.life_id !== "string" || !v.life_id)
    throw new Error("sidecar has no life ID");
  if (!finite(v.born_at)) throw new Error("sidecar has no birth time");
  if (v.last_tick !== null && v.last_tick !== undefined && !isCount(v.last_tick))
    throw new Error("sidecar tick is not a count");
  if (v.mode !== "shadow" && v.mode !== "active")
    throw new Error("sidecar mode is unknown");
  const stats = v.stats as Record<string, unknown> | null;
  if (typeof stats !== "object" || stats === null || Array.isArray(stats))
    throw new Error("sidecar has no estimates");
  for (const [key, raw] of Object.entries(stats)) {
    const slash = key.indexOf("/");
    const motion = slash < 0 ? key : key.slice(0, slash);
    const condition = slash < 0 ? "" : key.slice(slash + 1);
    if (!(MOTIONS as readonly string[]).includes(motion) || !condition)
      throw new Error(`sidecar estimate '${key}' is not motion/condition`);
    const stat = raw as Record<string, unknown> | null;
    if (typeof stat !== "object" || stat === null || !finite(stat.n, stat.mean, stat.m2))
      throw new Error(`sidecar estimate '${key}' is malformed`);
    const { n, m2 } = stat as unknown as Stat;
    if (n < 0 || n > PARAMS.count_cap || m2 < 0)
      throw new Error(`sidecar estimate '${key}' is out of bounds`);
  }
  for (const name of [
    "samples",
    "discarded",
    "duplicates",
    "overrides",
    "would_override",
  ])
    if (!isCount(v[name])) throw new Error(`sidecar ${name} is not a count`);
  if (!Array.isArray(v.mode_history) || !Array.isArray(v.recent))
    throw new Error("sidecar history is malformed");
  const { snapshots: _files, ...memory } = structuredClone(v);
  return memory as unknown as PlasticityMemory;
}

export interface PlasticityStatus {
  version: string;
  mode: PlasticityMode;
  status: string;
  life_id?: string;
  since_tick?: number;
  last_tick?: number | null;
  samples?: number;
  discarded?: number;
  duplicates?: number;
  overrides?: number;
  would_override?: number;
  last_override?: Override | null;
  estimates?: Record<
    string,
    { n: number; rate: number | null; low: number | null; high: number | null }
  >;
}

/** One life's extension. Every hook is safe to call from her clock: none throws. */
export class EvaPlasticity {
  mode: PlasticityMode;
  state: PlasticityMemory | null = null;
  problem: string | null = null;

  constructor(mode: PlasticityMode) {
    if (mode !== "shadow" && mode !== "active")
      throw new Error(
        `EVA_PLASTICITY must be one of shadow, active, not ${String(mode)}`,
      );
    this.mode = mode;
  }

  /** `bind` for a life with no sidecar yet: fresh memory at her current tick. */
  bind(life: Pick<EvaState, "life_id" | "born_at" | "ticks">, at: number): void {
    try {
      this.state = fresh(life.life_id, life.born_at, life.ticks, this.mode, at);
    } catch (error) {
      this.refuse(`refused: ${String(error)}`);
    }
  }

  /** Keep this memory (one life's sidecar) and bind it, as a restart does. */
  adopt(memory: PlasticityMemory, life: Pick<EvaState, "ticks">, at: number): void {
    const kept = structuredClone(memory);
    if (kept.mode !== this.mode) {
      kept.mode_history.push({ tick: life.ticks, at, from: kept.mode, to: this.mode });
      kept.mode_history.splice(
        0,
        Math.max(0, kept.mode_history.length - PARAMS.mode_history),
      );
      kept.mode = this.mode;
    }
    this.state = kept;
    this.problem = null;
  }

  /** Her motion for this travel step: her own choice unless active mode is confident. */
  choose(life: EvaState, weather: Weather, baseline: string): string {
    if (this.state === null || (baseline !== "fly" && baseline !== "walk"))
      return baseline;
    try {
      const alternative = this.better(life, weather, baseline);
      if (alternative === null) return baseline;
      if (this.mode === "shadow") {
        this.state.would_override += 1;
        return baseline;
      }
      this.state.overrides += 1;
      this.state.last_override = {
        tick: life.ticks,
        at: life.updated_at,
        condition: context(life, weather),
        from: baseline,
        to: alternative,
      };
      return alternative;
    } catch (error) {
      this.refuse(`faulted: ${String(error)}`);
      return baseline;
    }
  }

  /** One executed travel step, as her learner recorded it in learning.last. */
  observe(
    life: EvaState,
    motion: string,
    start: readonly number[],
    target: readonly number[],
    command: readonly number[],
    dt: number,
  ): void {
    if (this.state === null) return;
    try {
      const s = this.state;
      const tick = life.ticks;
      if (s.last_tick !== null && tick <= s.last_tick) {
        s.duplicates += 1;
        return;
      }
      s.last_tick = tick;
      const last = life.learning.last;
      const observed = last?.observed_position;
      const effort = finite(...command) ? pyHypot(command[0]!, command[1]!) : 0.0;
      if (
        !last ||
        last.action !== motion ||
        last.at !== life.updated_at ||
        !Array.isArray(observed) ||
        observed.length !== 2 ||
        !finite(...observed, ...start, ...target, dt) ||
        dt <= 0 ||
        effort < PARAMS.min_effort
      ) {
        s.discarded += 1;
        return;
      }
      const rate = (pyDist(start, target) - pyDist(observed, target)) / (effort * dt);
      const key = `${motion}/${last.condition}`;
      const stat = (s.stats[key] ??= { n: 0.0, mean: 0.0, m2: 0.0 });
      stat.n += 1;
      const delta = rate - stat.mean;
      stat.mean += delta / stat.n;
      stat.m2 += delta * (rate - stat.mean);
      if (stat.n > PARAMS.count_cap) {
        const scale = PARAMS.count_cap / 2 / stat.n;
        stat.n *= scale;
        stat.m2 *= scale;
      }
      s.samples += 1;
      s.recent.push({ tick, motion: motion as Motion, condition: last.condition, rate });
      s.recent.splice(0, Math.max(0, s.recent.length - PARAMS.recent));
    } catch (error) {
      this.refuse(`faulted: ${String(error)}`);
    }
  }

  /** As for /state, minus `saved_at` and `last_daily_copy_at` (no files here). */
  status(): PlasticityStatus {
    const out: PlasticityStatus = {
      version: VERSION,
      mode: this.mode,
      status: this.problem ?? "ok",
    };
    const s = this.state;
    if (s === null) return out;
    const estimates: NonNullable<PlasticityStatus["estimates"]> = {};
    for (const key of Object.keys(s.stats).sort()) {
      const stat = s.stats[key]!;
      const b = bounds(stat);
      estimates[key] = {
        n: pyRound(stat.n, 1),
        rate: b === null ? null : pyRound(b[0], 6),
        low: b === null ? null : pyRound(b[1], 6),
        high: b === null ? null : pyRound(b[2], 6),
      };
    }
    return {
      ...out,
      life_id: s.life_id,
      since_tick: s.created_tick,
      last_tick: s.last_tick,
      samples: s.samples,
      discarded: s.discarded,
      duplicates: s.duplicates,
      overrides: s.overrides,
      would_override: s.would_override,
      last_override: structuredClone(s.last_override),
      estimates,
    };
  }

  /** The other motion, when the evidence says it is clearly better here; else null. */
  private better(life: EvaState, weather: Weather, baseline: Motion): Motion | null {
    const condition = context(life, weather);
    const models = life.learning.models;
    const own = MOTIONS.map((m) => models[`${m}/${condition}`]);
    // Her exploration rule stays hers: never swap while she is (re)testing.
    if (
      own.some((m) => m === undefined || m.samples < 3) ||
      life.learning.trials % 37 === 0
    )
      return null;
    const alternative: Motion = baseline === "fly" ? "walk" : "fly";
    const stats = this.state ? this.state.stats : {};
    const chosen = stats[`${baseline}/${condition}`];
    const other = stats[`${alternative}/${condition}`];
    if (!chosen || !other || Math.min(chosen.n, other.n) < PARAMS.min_evidence)
      return null;
    const a = bounds(chosen);
    const b = bounds(other);
    if (a === null || b === null || b[1] <= a[2]) return null;
    return alternative;
  }

  private refuse(problem: string): void {
    this.problem = problem.slice(0, 300);
    this.state = null;
  }
}
