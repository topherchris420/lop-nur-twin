/**
 * ECHO Neural Shadow: a research fly, created for the run, whose sensable
 * inputs and ECHO's actions are recorded for the connectome model in
 * `fly-neural/` (fly_neural/shadow.py).
 *
 *   node scripts/run-ts.mjs scripts/echo-neural-shadow.ts --scenario looms --seed 101 --mode baseline
 *
 * The subject is always new: a `DigitalFly` with an `EchoAdapter`, built here
 * from a seed in a research world (an arena with looming stimuli, a yard with
 * fruit, a windy arena). Nothing here reads a store, a checkpoint, a backup
 * or the deployed individual; there is no option to, and the script refuses
 * to run on a host that has the production organism's directories, or to
 * write under them.
 *
 * Modes (fly_neural/shadow.py):
 * - `baseline` and `neural-shadow`: ECHO controls the research fly and
 *   nothing else runs; the second is a recording made to be replayed into
 *   the model offline. The tap passes every command through unchanged and
 *   draws nothing from the fly's random streams, so the fly does exactly what
 *   it does untapped (scripts/echo-neural-shadow.test.ts).
 * - `neural-experimental`: a research subject whose feeding and escape are
 *   decided by the model's readouts (MN9, the giant fiber), served by
 *   `python -m fly_neural serve` over stdin/stdout one sample behind, while
 *   ECHO keeps the rest of its behaviour. Its commands still pass the fly's
 *   own gate.
 *
 * Each record keeps the sensable part of the decision input (looming size,
 * expansion and bearing; airflow; food odour; whether the tarsi touch food),
 * what ECHO commanded, and the body's mode for scoring. The looming object's
 * id, kind and distance, ECHO's giant-fiber proxy, the fly's position and
 * heading, landing sites and landmarks are never written.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { arenaWorld, loomAt, type ArenaSpec } from "../src/bethesda/fly/arena.js";
import { EchoAdapter, echoDescriptor } from "../src/bethesda/fly/echo/adapter.js";
import { ECHO_VERSION } from "../src/bethesda/fly/echo/params.js";
import { DigitalFly, FLY_VERSION } from "../src/bethesda/fly/fly.js";
import {
  PERCHED,
  type AdapterDescriptor,
  type AdapterStreams,
  type DecisionInput,
  type FlyNeuralAdapter,
  type MotorCommand,
} from "../src/bethesda/fly/neural.js";
import { wrapAngle, type V3 } from "../src/bethesda/fly/units.js";
import {
  PrimitiveWorld,
  type Mover,
  type PrimitiveWorldSpec,
} from "../src/bethesda/fly/world.js";

export const SHADOW_SCHEMA = "fly-neural-shadow/v1" as const;
export const MODES = ["baseline", "neural-shadow", "neural-experimental"] as const;
export type ShadowMode = (typeof MODES)[number];
export const SCENARIOS = ["looms", "food", "wind"] as const;
export type Scenario = (typeof SCENARIOS)[number];

/** The deployed organism's directories and host (deploy/bethesda-life/). Never read, never written. */
export const PRODUCTION_PATHS = [
  "/var/lib/bethesda-life",
  "/opt/bethesda-life",
  "/var/backups/bethesda-life",
] as const;

/** Refuses a production host and a production output path. */
export function guard(out: string, exists: (p: string) => boolean = existsSync): void {
  for (const p of PRODUCTION_PATHS)
    if (exists(p))
      throw new Error(
        `refusing to run: ${p} exists, so this is the production host; the shadow runs only off it`,
      );
  const abs = resolve(out).replaceAll("\\", "/");
  for (const p of PRODUCTION_PATHS)
    if (abs.startsWith(p) || abs.includes(p))
      throw new Error(`refusing to write under ${p}`);
}

/** The sensable part of a decision input: what fly_neural/sensory.py accepts, nothing else. */
export interface SensableObservation {
  looming: { sizeDeg: number; expansionDegS: number; bearing: number } | null;
  airflow: number;
  airflowFrom: number | null;
  odour: number;
  onFood: boolean;
}

export function sensable(input: DecisionInput): SensableObservation {
  const f = input.frame;
  return {
    looming: f.looming
      ? {
          sizeDeg: f.looming.sizeDeg,
          expansionDegS: f.looming.expansionDegS,
          bearing: f.looming.bearing,
        }
      : null,
    airflow: f.airflow,
    airflowFrom: f.airflowFrom,
    odour: f.odour,
    onFood: input.body.onFood !== null,
  };
}

/** Whether a command is the controller's giant-fiber reflex (controller.ts `reflex`). */
const isReflex = (c: MotorCommand, from: "decide" | "interrupt") =>
  c.mode === "escape" || from === "interrupt" || c.reason.startsWith("looming ");

export interface ShadowRecord {
  t: number;
  from: "decide" | "interrupt";
  obs: SensableObservation;
  echo: { mode: string; escape: boolean; feeding: boolean; reason: string } | null;
  outcome: { mode: string; sub: string };
  neural?: Readouts | null;
}

export interface Readouts {
  feed: { predicted: boolean; mean_rate_hz: number; spikes: number };
  escape: { predicted: boolean; mean_rate_hz: number; spikes: number };
}

/**
 * Passes ECHO's commands through and records each input it was given. In
 * `neural-experimental` it instead lets the latest readouts decide feeding
 * and escape.
 */
export class ShadowTap implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly records: ShadowRecord[] = [];
  readonly inner: EchoAdapter;
  readonly mode: ShadowMode;
  readonly maxRecords: number;
  latest: Readouts | null = null;
  last: SensableObservation | null = null;
  dropped = 0;
  constructor(inner: EchoAdapter, mode: ShadowMode, maxRecords: number) {
    this.inner = inner;
    this.mode = mode;
    this.maxRecords = maxRecords;
    this.descriptor =
      mode === "neural-experimental"
        ? {
            ...echoDescriptor(inner.variant),
            id: `${inner.descriptor.id} gated by fly-neural readouts`,
            label: "ECHO with connectome-model feeding and escape (research subject)",
            fidelity: `${inner.descriptor.fidelity} In this research mode, feeding and escape follow the readouts of a leaky integrate-and-fire model on the FlyWire connectome (fly-neural/), not ECHO's own rules.`,
            simulatesNeurons: true,
          }
        : inner.descriptor;
  }

  start(body: Parameters<NonNullable<FlyNeuralAdapter["start"]>>[0]) {
    this.inner.start?.(body);
  }

  private record(
    input: DecisionInput,
    from: "decide" | "interrupt",
    c: MotorCommand | null,
  ) {
    const obs = sensable(input);
    this.last = obs;
    if (this.records.length >= this.maxRecords) {
      this.dropped++;
      return;
    }
    this.records.push({
      t: input.body.t,
      from,
      obs,
      echo: c
        ? {
            mode: c.mode,
            escape: isReflex(c, from),
            feeding: c.mode === "feed",
            reason: c.reason.slice(0, 200),
          }
        : null,
      outcome: { mode: input.body.mode, sub: input.body.sub },
      ...(this.mode === "neural-experimental" ? { neural: this.latest } : {}),
    });
  }

  private gate(input: DecisionInput, c: MotorCommand | null): MotorCommand | null {
    if (this.mode !== "neural-experimental") return c;
    const body = input.body;
    const r = this.latest;
    if (r?.escape.predicted && PERCHED.has(body.mode)) {
      const bearing = input.frame.looming?.bearing ?? 0;
      return {
        mode: "escape",
        heading: wrapAngle(body.yaw + bearing + Math.PI),
        prepare: input.params.shortModePrepMs / 1000,
        reason: `fly-neural: giant fiber fired (${r.escape.spikes} spikes) → short-mode escape`,
      };
    }
    if (c && isReflex(c, "decide") && PERCHED.has(body.mode))
      return c.mode === "escape"
        ? { mode: "rest", reason: "fly-neural: the giant fiber did not fire" }
        : c;
    if (c?.mode === "feed" && !r?.feed.predicted)
      return { mode: "rest", reason: "fly-neural: MN9 below its threshold" };
    if (
      c &&
      body.onFood &&
      r?.feed.predicted &&
      PERCHED.has(body.mode) &&
      c.mode !== "feed" &&
      c.mode !== "takeoff"
    )
      return { mode: "feed", reason: `fly-neural: MN9 at ${r.feed.mean_rate_hz} Hz` };
    return c;
  }

  decide(input: DecisionInput): MotorCommand {
    const c = this.inner.decide(input);
    this.record(input, "decide", c);
    return this.gate(input, c) ?? c;
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const c = this.inner.interrupt ? this.inner.interrupt(input) : null;
    // Every sample is recorded (interrupts with no command too): they are the model's input stream.
    this.record(input, "interrupt", c);
    if (this.mode !== "neural-experimental") return c;
    if (this.latest?.escape.predicted && PERCHED.has(input.body.mode))
      return this.gate(input, null);
    return c && c.mode === "escape" ? null : c;
  }

  static factory(mode: ShadowMode, seed: number, maxRecords: number, out: ShadowTap[]) {
    return (rng: () => number, streams: AdapterStreams) => {
      const tap = new ShadowTap(
        new EchoAdapter(rng, streams, { variant: "full", seed }),
        mode,
        maxRecords,
      );
      out.push(tap);
      return tap;
    };
  }
}

/** The research worlds: none is the city, the garden or the deployed fly's world. */
export function researchWorld(s: Scenario): {
  world: PrimitiveWorld;
  start: { p: V3; yaw: number };
  config: Record<string, number>;
} {
  const still = { takeoffHz: 0, walkStartHz: 0.05, groomHz: 0 };
  if (s === "looms") {
    const spec: ArenaSpec = {
      size: [6, 3, 6],
      ambient: 0.7,
      // Objects approaching the fly from either side, at different sizes and speeds,
      // each repeated: some loom hard enough for ECHO's reflex, some do not.
      looms: [
        {
          start: 2,
          period: 12,
          count: 8,
          from: [2.5, 0.4, 0.5],
          to: [0.02, 0.05, 0.01],
          speedMS: 2.5,
          radiusM: 0.08,
        },
        {
          start: 5,
          period: 12,
          count: 8,
          from: [-0.5, 0.4, 2.5],
          to: [0.01, 0.05, 0.02],
          speedMS: 1.0,
          radiusM: 0.04,
        },
        {
          start: 8,
          period: 12,
          count: 8,
          from: [0.3, 0.6, -2.5],
          to: [0.0, 0.05, -0.03],
          speedMS: 4.0,
          radiusM: 0.12,
        },
        {
          start: 11,
          period: 12,
          count: 8,
          from: [-2.5, 0.3, -0.3],
          to: [-0.02, 0.05, 0.0],
          speedMS: 0.5,
          radiusM: 0.03,
        },
      ],
    };
    return {
      world: arenaWorld(spec, "research-looms"),
      start: { p: [0, 0.01, 0], yaw: 0 },
      config: still,
    };
  }
  if (s === "wind") {
    const world = Object.assign(
      arenaWorld({ size: [6, 3, 6], ambient: 0.7 }, "research-wind"),
      {
        wind: (_p: V3, t: number): V3 => {
          // Bouts of wind, 0 to 1.2 m/s, from changing directions.
          const on = Math.sin(t / 4) > 0 ? 1 : 0;
          const a = t / 9;
          const s = on * 0.6 * (1 + Math.sin(t / 2.3));
          return [s * Math.cos(a), 0, s * Math.sin(a)];
        },
      },
    );
    return { world, start: { p: [0, 0.01, 0], yaw: 0 }, config: still };
  }
  const spec: PrimitiveWorldSpec = {
    id: "research-food",
    home: {
      center: [0, 0, 0],
      radius: 5,
      ceiling: 4,
      bounds: { min: { x: -5, z: -5 }, max: { x: 5, z: 5 } },
    },
    inputs: { supported: ["food"], proxies: [], unsupported: [] },
    ground: () => 0,
    groundMax: 0,
    ambient: 1,
    food: [
      { id: "fruit", kind: "fruit", center: [0, 0, 0], surface: "ground", radius: 0.3 },
    ],
  };
  const world = new PrimitiveWorld(spec);
  return {
    world,
    start: { p: [0.1, 0.01, 0], yaw: 0 },
    // Hungry, so it feeds; it walks off and back on the fruit.
    config: {
      takeoffHz: 0,
      groomHz: 0,
      walkStartHz: 0.3,
      walkStopHz: 0.3,
      startReserve: 0.3,
    },
  };
}

export interface ShadowRun {
  header: Record<string, unknown>;
  records: ShadowRecord[];
}

/** Runs one research subject for `seconds`, in steps of `stepS`. `neural` answers the model's readouts in experimental mode. */
export async function runShadow(o: {
  scenario: Scenario;
  seed: number;
  mode: ShadowMode;
  seconds: number;
  stepS?: number;
  maxRecords?: number;
  neural?: (t: number, obs: SensableObservation) => Promise<Readouts>;
}): Promise<ShadowRun> {
  const stepS = o.stepS ?? 0.01;
  const taps: ShadowTap[] = [];
  const { world, start, config } = researchWorld(o.scenario);
  const fly = new DigitalFly({
    seed: o.seed,
    world,
    start,
    config,
    adapter: ShadowTap.factory(o.mode, o.seed, o.maxRecords ?? 200_000, taps),
  });
  const tap = taps[0]!;
  if (o.mode === "neural-experimental" && !o.neural)
    throw new Error("neural-experimental needs the model's readouts");
  for (let k = 0; k < Math.round(o.seconds / stepS); k++) {
    if (o.neural && tap.last) tap.latest = await o.neural(fly.state.t, tap.last);
    fly.advance(stepS);
  }
  const header = {
    schema: SHADOW_SCHEMA,
    mode: o.mode,
    subject: `research-${o.scenario}-${o.seed}`,
    scenario: o.scenario,
    seed: o.seed,
    world: world.id,
    flyVersion: FLY_VERSION,
    echoVersion: ECHO_VERSION,
    controller: tap.descriptor.id,
    seconds: o.seconds,
    stepS,
    sample_period_s: 0.01,
    records: tap.records.length,
    recordsDropped: tap.dropped,
    counts: fly.state.counts,
    note: "A research subject created for this run. Not the deployed fly, not a copy or continuation of it.",
  };
  return { header, records: tap.records };
}

/** `python -m fly_neural serve` as a readout function. */
export async function neuralServer(python: string, header: Record<string, unknown>) {
  const child: ChildProcessWithoutNullStreams = spawn(
    python,
    ["-m", "fly_neural", "serve"],
    {
      cwd: resolve(
        dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
        "..",
        "fly-neural",
      ),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (d) => process.stderr.write(d));
  const lines: Interface = createInterface({ input: child.stdout });
  const queue: ((s: string) => void)[] = [];
  lines.on("line", (l) => queue.shift()?.(l));
  const next = () => new Promise<string>((res) => queue.push(res));
  child.stdin.write(JSON.stringify(header) + "\n");
  const ready = JSON.parse(await next());
  if (!ready.ready)
    throw new Error(`fly-neural serve did not start: ${JSON.stringify(ready)}`);
  return {
    ready,
    ask: async (t: number, obs: SensableObservation): Promise<Readouts> => {
      child.stdin.write(JSON.stringify({ t, obs, window_ms: 10 }) + "\n");
      return JSON.parse(await next()).readouts as Readouts;
    },
    close: () => {
      child.stdin.write(JSON.stringify({ bye: true }) + "\n");
      child.stdin.end();
    },
  };
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

async function main() {
  const scenario = arg("scenario") as Scenario;
  const mode = arg("mode", "baseline") as ShadowMode;
  if (!SCENARIOS.includes(scenario))
    throw new Error(`--scenario must be one of ${SCENARIOS.join(", ")}`);
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
  for (const forbidden of ["store", "checkpoint", "backup", "life", "individual"])
    if (process.argv.includes(`--${forbidden}`))
      throw new Error(`--${forbidden}: the shadow never reads an existing organism`);
  const seed = Number(arg("seed"));
  const seconds = Number(arg("seconds", "60"));
  const out = arg("out", `.fly-neural/shadow/${scenario}-${seed}-${mode}.jsonl`);
  guard(out);
  let server: Awaited<ReturnType<typeof neuralServer>> | null = null;
  const pre = {
    schema: SHADOW_SCHEMA,
    mode,
    subject: `research-${scenario}-${seed}`,
    seed,
  };
  if (mode === "neural-experimental")
    server = await neuralServer(
      arg("python", process.env.FLY_NEURAL_PYTHON ?? "python"),
      pre,
    );
  try {
    const run = await runShadow({
      scenario,
      seed,
      mode,
      seconds,
      ...(server ? { neural: server.ask } : {}),
    });
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(
      out,
      [JSON.stringify(run.header), ...run.records.map((r) => JSON.stringify(r))].join(
        "\n",
      ) + "\n",
    );
    console.log(
      `${out}: ${run.records.length} records, counts ${JSON.stringify(run.header.counts)}`,
    );
  } finally {
    server?.close();
  }
}

// Run directly, or as `node scripts/run-ts.mjs scripts/echo-neural-shadow.ts`, which puts it at argv[2].
const invoked = process.argv.slice(1, 3).some((a) => /echo-neural-shadow\.ts$/.test(a));
if (invoked) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

// Re-exported for tests: what a research world's movers look like.
export type { Mover };
export { loomAt };
