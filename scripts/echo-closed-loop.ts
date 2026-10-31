/**
 * ECHO closed loop: research subjects whose escape and feeding are decided by
 * the connectome model (fly-neural/fly_neural/closedloop.py) behind a safety
 * layer, compared with ECHO deciding alone (fly-neural/experiments/closed-loop-v783.json).
 *
 *   node scripts/run-ts.mjs scripts/echo-closed-loop.ts --scenario looms --seed 9100101 --arm neural-selected
 *
 * Each run creates its subject from a seed in a research world, as
 * echo-neural-shadow.ts does, and reuses that script's production guard,
 * worlds and sensable observation. Nothing here reads a store, checkpoint,
 * backup or the deployed fly, and no readout goes anywhere but the research
 * subject created here.
 *
 * The safety layer (`ClosedLoopTap`):
 * - checks every readout: an answer to the request sent (the server's id),
 *   for the sample asked about, well formed, finite and non-negative;
 * - when a readout is missing, late, malformed or failed, or the neural layer
 *   proposes a command the body's gate would refuse, ECHO decides that sample
 *   (a fallback), and the fallback is logged with its reason;
 * - bounds fallbacks: past `maxFallbackFraction` of the samples (after
 *   `minSamples`), or on the server's fatal answer, the run stops and is
 *   reported as aborted, never quietly continued as ECHO;
 * - lets escape outrank feeding, and commands only a perched body (ECHO
 *   walks, flies and lands as before);
 * - gives each request a timeout, and the server a wall-time, memory and
 *   stop-file budget.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { arenaWorld, type ArenaSpec } from "../src/bethesda/fly/arena.js";
import { EchoAdapter, echoDescriptor } from "../src/bethesda/fly/echo/adapter.js";
import { ECHO_VERSION } from "../src/bethesda/fly/echo/params.js";
import { DigitalFly, FLY_VERSION } from "../src/bethesda/fly/fly.js";
import {
  PERCHED,
  validateCommand,
  type AdapterDescriptor,
  type AdapterStreams,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "../src/bethesda/fly/neural.js";
import { wrapAngle, type V3 } from "../src/bethesda/fly/units.js";
import type { FoodPatch } from "../src/bethesda/fly/world.js";
import {
  guard,
  researchWorld,
  sensable,
  SHADOW_SCHEMA,
  type Readouts,
  type SensableObservation,
} from "./echo-neural-shadow.js";

export const CLOSED_LOOP_SCHEMA = "fly-neural-closed-loop-run/v1" as const;
export const ARMS = ["baseline", "neural-merged", "neural-selected"] as const;
export type Arm = (typeof ARMS)[number];
export const SCENARIOS = ["looms", "passes", "food"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface Limits {
  maxFallbackFraction: number;
  minSamples: number;
  timeoutMs: number;
  startTimeoutMs: number;
  maxLog: number;
  serverMaxWallS: number;
  serverMaxRssMb: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxFallbackFraction: 0.05,
  minSamples: 200,
  timeoutMs: 20_000,
  startTimeoutMs: 600_000,
  maxLog: 200,
  serverMaxWallS: 5400,
  serverMaxRssMb: 2000,
};

/** Seconds of no looming before a new looming episode begins (as the threat scoring's quiet time). */
const QUIET_S = 0.5;

/** The research worlds: echo-neural-shadow.ts's, and objects that move past or away from the fly, never at it. */
export function closedLoopWorld(s: Scenario): ReturnType<typeof researchWorld> {
  if (s !== "passes") return researchWorld(s);
  const spec: ArenaSpec = {
    size: [6, 3, 6],
    ambient: 0.7,
    looms: [
      // A lateral pass 0.6 m away, an object receding from near the fly, a fast pass
      // 0.9 m away and a slow recession: each harmless, each visible and changing size.
      {
        start: 2,
        period: 12,
        count: 8,
        from: [-2.5, 0.4, 0.6],
        to: [2.5, 0.4, 0.6],
        speedMS: 2.5,
        radiusM: 0.08,
      },
      {
        start: 5,
        period: 12,
        count: 8,
        from: [0.2, 0.2, 0.15],
        to: [2.5, 0.6, 2.5],
        speedMS: 1.0,
        radiusM: 0.04,
      },
      {
        start: 8,
        period: 12,
        count: 8,
        from: [0.8, 0.5, -2.5],
        to: [0.8, 0.5, 2.5],
        speedMS: 4.0,
        radiusM: 0.12,
      },
      {
        start: 11,
        period: 12,
        count: 8,
        from: [-0.2, 0.15, -0.2],
        to: [-2.5, 0.3, -2.5],
        speedMS: 0.5,
        radiusM: 0.03,
      },
    ],
  };
  return {
    world: arenaWorld(spec, "research-passes"),
    start: { p: [0, 0.01, 0], yaw: 0 },
    config: { takeoffHz: 0, walkStartHz: 0.05, groomHz: 0 },
  };
}

type Check =
  { ok: true; readouts: Readouts } | { ok: false; reason: string; fatal: boolean };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readoutOk(v: unknown): boolean {
  if (!isObject(v) || typeof v.predicted !== "boolean") return false;
  return [v.mean_rate_hz, v.spikes].every(
    (x) => typeof x === "number" && Number.isFinite(x) && x >= 0,
  );
}

/** Accepts a server answer only if it answers the sample at `t` with well-formed readouts. */
export function checkAnswer(a: unknown, t: number): Check {
  if (!isObject(a)) return { ok: false, reason: "malformed answer", fatal: false };
  if (typeof a.error === "string")
    return {
      ok: false,
      reason: a.timeout ? "timeout" : `server: ${a.error.slice(0, 120)}`,
      fatal: a.fatal === true,
    };
  if (a.t !== t) return { ok: false, reason: "stale answer", fatal: false };
  const r = a.readouts;
  if (!isObject(r) || !readoutOk(r.feed) || !readoutOk(r.escape))
    return { ok: false, reason: "malformed readouts", fatal: false };
  return { ok: true, readouts: r as unknown as Readouts };
}

const isReflex = (c: MotorCommand, from: "decide" | "interrupt") =>
  c.mode === "escape" || from === "interrupt" || c.reason.startsWith("looming ");

/**
 * ECHO with escape and feeding decided by the model's readouts, behind the
 * safety layer. In `baseline` it passes every command through unchanged and
 * draws nothing from the fly's random streams.
 */
export class ClosedLoopTap implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: EchoAdapter;
  readonly arm: Arm;
  readonly limits: Limits;
  /** The world's food lookup, used only to vet a proposed command exactly as the body's gate will. */
  readonly gateFood: (p: V3) => FoodPatch | null;
  last: SensableObservation | null = null;
  private check: Check = { ok: false, reason: "no readout yet", fatal: false };
  samples = 0;
  fallbacks = 0;
  readonly byReason: Record<string, number> = {};
  readonly log: { t: number; reason: string }[] = [];
  readonly issued = { escape: 0, feed: 0, suppressedEscape: 0, suppressedFeed: 0 };
  issuedNow: "escape" | "feed" | null = null;

  constructor(
    inner: EchoAdapter,
    arm: Arm,
    limits: Limits,
    gateFood: (p: V3) => FoodPatch | null = () => null,
  ) {
    this.inner = inner;
    this.arm = arm;
    this.limits = limits;
    this.gateFood = gateFood;
    this.descriptor =
      arm === "baseline"
        ? inner.descriptor
        : {
            ...echoDescriptor(inner.variant),
            id: `${inner.descriptor.id} with fly-neural escape and feeding (${arm}, closed loop)`,
            label: "ECHO with connectome-model escape and feeding (research subject)",
            fidelity: `${inner.descriptor.fidelity} In this research mode, escape and feeding follow a leaky integrate-and-fire model on the FlyWire connectome (fly-neural/), with ECHO deciding any sample whose readout is unavailable.`,
            simulatesNeurons: true,
          };
  }

  start(body: Parameters<NonNullable<FlyNeuralAdapter["start"]>>[0]) {
    this.inner.start?.(body);
  }

  /** The readout for the coming step, or why there is none. */
  offer(answer: unknown, t: number): Check {
    this.check = checkAnswer(answer, t);
    return this.check;
  }

  /** No readout this step (the first, before any observation). */
  none(reason: string) {
    this.check = { ok: false, reason, fatal: false };
  }

  get fallbackFraction(): number {
    return this.samples ? this.fallbacks / this.samples : 0;
  }

  private fallback(t: number, reason: string) {
    this.fallbacks++;
    this.byReason[reason] = (this.byReason[reason] ?? 0) + 1;
    if (this.log.length < this.limits.maxLog) this.log.push({ t, reason });
  }

  private vetted(
    input: DecisionInput,
    proposed: MotorCommand,
    echo: MotorCommand | null,
  ): MotorCommand | null {
    const body = input.body;
    const v = validateCommand(proposed, body, input.params, {
      sites: input.sites,
      surface: () => null,
      food: this.gateFood,
    });
    if (v.ok) return v.command;
    this.fallback(body.t, `neural command refused: ${v.reason}`);
    return echo;
  }

  private gate(
    input: DecisionInput,
    c: MotorCommand | null,
    from: "decide" | "interrupt",
  ): MotorCommand | null {
    if (this.arm === "baseline") return c;
    const body = input.body;
    this.samples++;
    if (!this.check.ok) {
      this.fallback(body.t, this.check.reason);
      return c;
    }
    const r = this.check.readouts;
    if (!PERCHED.has(body.mode)) return c;
    if (r.escape.predicted) {
      const bearing = input.frame.looming?.bearing ?? 0;
      const cmd = this.vetted(
        input,
        {
          mode: "escape",
          heading: wrapAngle(body.yaw + bearing + Math.PI),
          prepare: input.params.shortModePrepMs / 1000,
          reason: `fly-neural: giant fiber fired (${r.escape.spikes} spikes) → short-mode escape`,
        },
        c,
      );
      if (cmd?.mode === "escape") {
        this.issued.escape++;
        this.issuedNow = "escape";
      }
      return cmd;
    }
    if (c && isReflex(c, from) && c.mode === "escape") {
      this.issued.suppressedEscape++;
      return from === "interrupt"
        ? null
        : this.vetted(
            input,
            { mode: "rest", reason: "fly-neural: the giant fiber did not fire" },
            c,
          );
    }
    if (c?.mode === "feed" && !r.feed.predicted) {
      this.issued.suppressedFeed++;
      return this.vetted(
        input,
        { mode: "rest", reason: "fly-neural: MN9 below its threshold" },
        c,
      );
    }
    const wantsFeed =
      r.feed.predicted &&
      body.onFood !== null &&
      body.mode !== "feed" &&
      c?.mode !== "takeoff";
    if (from === "decide" && wantsFeed) {
      const cmd =
        c?.mode === "feed"
          ? c
          : this.vetted(
              input,
              { mode: "feed", reason: `fly-neural: MN9 at ${r.feed.mean_rate_hz} Hz` },
              c,
            );
      if (cmd?.mode === "feed") {
        this.issued.feed++;
        this.issuedNow = "feed";
      }
      return cmd;
    }
    return c;
  }

  decide(input: DecisionInput): MotorCommand {
    const c = this.inner.decide(input);
    this.last = sensable(input);
    return this.gate(input, c, "decide") ?? c;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const c = this.inner.interrupt ? this.inner.interrupt(input) : null;
    this.last = sensable(input);
    return this.gate(input, c, "interrupt");
  }

  static factory(
    arm: Arm,
    seed: number,
    limits: Limits,
    out: ClosedLoopTap[],
    gateFood?: (p: V3) => FoodPatch | null,
  ) {
    return (rng: () => number, streams: AdapterStreams) => {
      const tap = new ClosedLoopTap(
        new EchoAdapter(rng, streams, { variant: "full", seed }),
        arm,
        limits,
        gateFood,
      );
      out.push(tap);
      return tap;
    };
  }
}

export type Neural = (t: number, obs: SensableObservation) => Promise<unknown>;

export interface ClosedLoopSummary {
  schema: typeof CLOSED_LOOP_SCHEMA;
  subject: string;
  scenario: Scenario;
  seed: number;
  arm: Arm;
  [k: string]: unknown;
  outcome: { aborted: boolean; reason: string | null; simulatedS: number };
  counts: Record<string, number>;
  neural: Record<string, number>;
  fallbacks: {
    count: number;
    samples: number;
    fraction: number;
    byReason: Record<string, number>;
    log: { t: number; reason: string }[];
  };
}

/** Runs one research subject for `seconds`. The scoring reads the sensable stream and the body's mode, never the controller's input beyond them. */
export async function runClosedLoop(o: {
  scenario: Scenario;
  seed: number;
  arm: Arm;
  seconds: number;
  stepS?: number;
  limits?: Limits;
  neural?: Neural;
}): Promise<ClosedLoopSummary> {
  const stepS = o.stepS ?? 0.01;
  const limits = o.limits ?? DEFAULT_LIMITS;
  if (o.arm !== "baseline" && !o.neural)
    throw new Error(`${o.arm} needs the model's readouts`);
  const taps: ClosedLoopTap[] = [];
  const { world, start, config } = closedLoopWorld(o.scenario);
  const fly = new DigitalFly({
    seed: o.seed,
    world,
    start,
    config,
    adapter: ClosedLoopTap.factory(o.arm, o.seed, limits, taps, (p) => world.foodAt(p)),
  });
  const tap = taps[0]!;
  const score = {
    escapesDuringLoom: 0,
    escapesSpurious: 0,
    loomEpisodes: 0,
    escapableEpisodes: 0,
    episodesEscaped: 0,
  };
  const neural = { executed_escape: 0, executed_feed: 0 };
  let quiet = Infinity;
  let episode: { escapable: boolean; escaped: boolean } | null = null;
  let aborted: string | null = null;
  let k = 0;
  const steps = Math.round(o.seconds / stepS);
  for (; k < steps; k++) {
    if (o.neural) {
      if (tap.last) {
        const t = fly.state.t;
        const check = tap.offer(await o.neural(t, tap.last), t);
        if (!check.ok && check.fatal) {
          aborted = `server stopped: ${check.reason}`;
          break;
        }
      } else tap.none("no observation yet");
    }
    const before = { escapes: fly.state.counts.escapes, meals: fly.state.counts.meals };
    const perched = PERCHED.has(fly.state.mode);
    tap.issuedNow = null;
    fly.advance(stepS);
    const escaped = fly.state.counts.escapes > before.escapes;
    if (tap.issuedNow === "escape" && escaped) neural.executed_escape++;
    if (tap.issuedNow === "feed" && fly.state.counts.meals > before.meals)
      neural.executed_feed++;
    const loom = tap.last?.looming ?? null;
    if (loom) {
      if (!episode && quiet >= QUIET_S) {
        episode = { escapable: perched, escaped: false };
        score.loomEpisodes++;
        if (perched) score.escapableEpisodes++;
      }
      quiet = 0;
    } else {
      quiet += stepS;
      if (quiet >= QUIET_S) episode = null;
    }
    if (escaped) {
      if (loom && loom.expansionDegS > 0) score.escapesDuringLoom++;
      else score.escapesSpurious++;
      if (episode && episode.escapable && !episode.escaped) {
        episode.escaped = true;
        score.episodesEscaped++;
      }
    }
    if (
      o.arm !== "baseline" &&
      tap.samples >= limits.minSamples &&
      tap.fallbackFraction > limits.maxFallbackFraction
    ) {
      aborted = `fallbacks over ${limits.maxFallbackFraction} of samples`;
      k++;
      break;
    }
  }
  return {
    schema: CLOSED_LOOP_SCHEMA,
    subject: `research-${o.scenario}-${o.seed}`,
    scenario: o.scenario,
    seed: o.seed,
    arm: o.arm,
    world: world.id,
    flyVersion: FLY_VERSION,
    echoVersion: ECHO_VERSION,
    controller: tap.descriptor.id,
    seconds: o.seconds,
    stepS,
    limits,
    outcome: {
      aborted: aborted !== null,
      reason: aborted,
      simulatedS: +(k * stepS).toFixed(3),
    },
    counts: { ...fly.state.counts, ...score },
    neural: {
      issued_escape: tap.issued.escape,
      executed_escape: neural.executed_escape,
      issued_feed: tap.issued.feed,
      executed_feed: neural.executed_feed,
      suppressed_escape: tap.issued.suppressedEscape,
      suppressed_feed: tap.issued.suppressedFeed,
    },
    fallbacks: {
      count: tap.fallbacks,
      samples: tap.samples,
      fraction: tap.fallbackFraction,
      byReason: tap.byReason,
      log: tap.log,
    },
    note: "A research subject created for this run. Not the deployed fly, not a copy or continuation of it.",
  };
}

/** `python -m fly_neural closedloop serve`, answering by request id, with a timeout per request. */
export async function closedLoopServer(
  python: string,
  header: Record<string, unknown>,
  limits: Limits,
) {
  const child = spawn(python, ["-m", "fly_neural", "closedloop", "serve"], {
    cwd: resolve(
      dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "..",
      "fly-neural",
    ),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, (a: unknown) => void>();
  let dead: string | null = null;
  let unmatched = 0;
  let onReady: ((a: unknown) => void) | null = null;
  const ready = new Promise<unknown>((res) => (onReady = res));
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("exit", (code) => {
    dead = `server exited (${code})`;
    onReady?.({ error: dead });
    for (const res of pending.values()) res({ error: dead, fatal: true });
    pending.clear();
  });
  createInterface({ input: child.stdout }).on("line", (l) => {
    let a: unknown;
    try {
      a = JSON.parse(l);
    } catch {
      unmatched++;
      return;
    }
    if (onReady) {
      const r = onReady;
      onReady = null;
      r(a);
      return;
    }
    const id = isObject(a) ? a.id : undefined;
    const res = typeof id === "number" ? pending.get(id) : undefined;
    if (res) {
      pending.delete(id as number);
      res(a);
    } else unmatched++;
  });
  child.stdin.write(JSON.stringify(header) + "\n");
  const first = await Promise.race([
    ready,
    new Promise((res) =>
      setTimeout(
        () => res({ error: "server did not start" }),
        limits.startTimeoutMs,
      ).unref(),
    ),
  ]);
  if (!isObject(first) || first.ready !== true) {
    child.kill();
    throw new Error(
      `fly-neural closedloop serve did not start: ${JSON.stringify(first)}`,
    );
  }
  let nextId = 1;
  return {
    ready: first,
    get unmatched() {
      return unmatched;
    },
    ask: (t: number, obs: SensableObservation): Promise<unknown> => {
      if (dead) return Promise.resolve({ error: dead, fatal: true });
      const id = nextId++;
      return new Promise((res) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          res({ id, t, error: `no answer in ${limits.timeoutMs} ms`, timeout: true });
        }, limits.timeoutMs);
        pending.set(id, (a) => {
          clearTimeout(timer);
          res(a);
        });
        child.stdin.write(JSON.stringify({ id, t, obs, window_ms: 10 }) + "\n");
      });
    },
    close: () => {
      if (!dead) {
        child.stdin.write(JSON.stringify({ bye: true }) + "\n");
        child.stdin.end();
      }
    },
  };
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

/** The limits a pre-registered config fixes, and the config's digest. */
export function readConfig(path: string): { limits: Limits; sha256: string } {
  const text = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  const cfg = JSON.parse(text) as { schema?: string; limits?: Record<string, number> };
  if (cfg.schema !== "fly-neural-closed-loop/v1")
    throw new Error(`${path} is not a fly-neural-closed-loop/v1 config`);
  const l = cfg.limits ?? {};
  const limits: Limits = {
    maxFallbackFraction: l.max_fallback_fraction ?? DEFAULT_LIMITS.maxFallbackFraction,
    minSamples: l.min_samples ?? DEFAULT_LIMITS.minSamples,
    timeoutMs: l.timeout_ms ?? DEFAULT_LIMITS.timeoutMs,
    startTimeoutMs: l.start_timeout_ms ?? DEFAULT_LIMITS.startTimeoutMs,
    maxLog: l.max_log ?? DEFAULT_LIMITS.maxLog,
    serverMaxWallS: l.server_max_wall_s ?? DEFAULT_LIMITS.serverMaxWallS,
    serverMaxRssMb: l.server_max_rss_mb ?? DEFAULT_LIMITS.serverMaxRssMb,
  };
  return { limits, sha256: createHash("sha256").update(text).digest("hex") };
}

async function main() {
  const scenario = arg("scenario") as Scenario;
  const arm = arg("arm", "baseline") as Arm;
  if (!SCENARIOS.includes(scenario))
    throw new Error(`--scenario must be one of ${SCENARIOS.join(", ")}`);
  if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
  for (const forbidden of ["store", "checkpoint", "backup", "life", "individual"])
    if (process.argv.includes(`--${forbidden}`))
      throw new Error(`--${forbidden}: the closed loop never reads an existing organism`);
  const seed = Number(arg("seed"));
  const seconds = Number(arg("seconds", "30"));
  const { limits, sha256 } = readConfig(
    arg("config", "fly-neural/experiments/closed-loop-v783.json"),
  );
  const out = arg("summary", `.fly-neural/closed-loop/${scenario}-${seed}-${arm}.json`);
  guard(out);
  const stopFile = resolve(dirname(resolve(out)), "STOP");
  let server: Awaited<ReturnType<typeof closedLoopServer>> | null = null;
  if (arm !== "baseline")
    server = await closedLoopServer(
      arg("python", process.env.FLY_NEURAL_PYTHON ?? "python"),
      {
        schema: SHADOW_SCHEMA,
        mode: "neural-experimental",
        subject: `research-${scenario}-${seed}`,
        seed,
        arm,
        budget: {
          max_wall_s: limits.serverMaxWallS,
          max_rss_mb: limits.serverMaxRssMb,
          stop_file: stopFile,
        },
      },
      limits,
    );
  const t0 = Date.now();
  try {
    const run = await runClosedLoop({
      scenario,
      seed,
      arm,
      seconds,
      limits,
      ...(server ? { neural: server.ask } : {}),
    });
    const summary = {
      ...run,
      config_sha256: sha256,
      escape_readout: server ? server.ready.escape_readout : null,
      server: server ? { unmatched_answers: server.unmatched } : null,
      wall_s: (Date.now() - t0) / 1000,
    };
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(summary, null, 1) + "\n");
    console.log(
      `${out}: ${run.outcome.aborted ? `aborted (${run.outcome.reason})` : "completed"}, escapes ${run.counts.escapes}, meals ${run.counts.meals}, fallbacks ${run.fallbacks.count}/${run.fallbacks.samples}`,
    );
  } finally {
    server?.close();
  }
}

// Run directly, or as `node scripts/run-ts.mjs scripts/echo-closed-loop.ts`, which puts it at argv[2].
const invoked = process.argv.slice(1, 3).some((a) => /echo-closed-loop\.ts$/.test(a));
if (invoked) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
