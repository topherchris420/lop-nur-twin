/**
 * The threat battery of fly-neural/experiments/threat-v783.json, shown to a
 * held research subject: a new fly built from a seed, kept perched (a
 * tethered preparation), whose senses and ECHO's own escape decisions are
 * recorded each 10 ms for fly-neural/fly_neural/threat.py.
 *
 *   python -m fly_neural threat battery --split dev     # in fly-neural/: writes .fly-neural/threat/battery-dev.json
 *   node scripts/run-ts.mjs scripts/echo-threat-battery.ts --split dev --seed 7100101
 *
 * ECHO decides as it always does, and every command it gives is recorded by
 * the shadow's tap (scripts/echo-neural-shadow.ts) before this script holds
 * the body: an escape, takeoff or walk becomes rest, so the stimulus stream
 * is the same for every readout scored on it. ECHO's habituation acts on
 * executed escapes, so it does not act here (the config says so).
 *
 * It reads one file, the battery, and only from .fly-neural/threat/; it reads
 * no store, checkpoint, backup or individual, and refuses the production host
 * like the shadow recorder.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { arenaWorld, type LoomSpec } from "../src/bethesda/fly/arena.js";
import { EchoAdapter } from "../src/bethesda/fly/echo/adapter.js";
import { ECHO_VERSION } from "../src/bethesda/fly/echo/params.js";
import { DigitalFly, FLY_VERSION } from "../src/bethesda/fly/fly.js";
import type {
  AdapterDescriptor,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../src/bethesda/fly/neural.js";
import { SHADOW_SCHEMA, ShadowTap, guard } from "./echo-neural-shadow.js";

export const BATTERY_DIR = ".fly-neural/threat";
const MOVES = new Set(["escape", "takeoff", "walk", "flight", "land"]);

export interface Battery {
  schema: string;
  split: string;
  sha256: string;
  duration_s: number;
  sample_s: number;
  fly: { position: [number, number, number]; yaw: number };
  looms: (LoomSpec & { stimulus: number })[];
}

/** Reads a battery, only from BATTERY_DIR. */
export function readBattery(path: string, root = process.cwd()): Battery {
  const rel = relative(resolve(root, BATTERY_DIR), resolve(root, path));
  if (rel.startsWith("..") || resolve(rel) === rel)
    throw new Error(`a battery is read only from ${BATTERY_DIR}/`);
  const b = JSON.parse(readFileSync(resolve(root, path), "utf8")) as Battery;
  if (b.schema !== "fly-neural-threat-battery/v1")
    throw new Error(`${path} is not a threat battery`);
  return b;
}

/** Holds the body perched: whatever ECHO commands is recorded by the tap first. */
export class HeldTap implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly tap: ShadowTap;
  held = 0;
  constructor(tap: ShadowTap) {
    this.tap = tap;
    this.descriptor = {
      ...tap.descriptor,
      id: `${tap.descriptor.id}, held perched`,
      label: "ECHO, held perched (research subject)",
    };
  }
  start(body: Parameters<NonNullable<FlyNeuralAdapter["start"]>>[0]) {
    this.tap.start(body);
  }
  private hold(c: MotorCommand): MotorCommand {
    if (!MOVES.has(c.mode)) return c;
    this.held++;
    return { mode: "rest", reason: `held: ${c.reason.slice(0, 120)}` };
  }
  decide(input: DecisionInput): MotorCommand {
    return this.hold(this.tap.decide(input));
  }
  interrupt(input: DecisionInput): MotorCommand | null {
    const c = this.tap.interrupt(input);
    return c ? this.hold(c) : null;
  }
}

export function runBattery(b: Battery, seed: number) {
  const looms: LoomSpec[] = b.looms.map((l) => ({
    start: l.start,
    period: l.period,
    count: l.count,
    from: l.from,
    to: l.to,
    speedMS: l.speedMS,
    radiusM: l.radiusM,
  }));
  const world = arenaWorld({ size: [8, 4, 8], ambient: 0.7, looms }, "research-threats");
  const held: HeldTap[] = [];
  const fly = new DigitalFly({
    seed,
    world,
    start: { p: b.fly.position, yaw: b.fly.yaw },
    config: { takeoffHz: 0, walkStartHz: 0, groomHz: 0 },
    adapter: (rng, streams) => {
      const h = new HeldTap(
        new ShadowTap(
          new EchoAdapter(rng, streams, { variant: "full", seed }),
          "baseline",
          400_000,
        ),
      );
      held.push(h);
      return h;
    },
  });
  const h = held[0]!;
  const step = b.sample_s;
  for (let k = 0; k < Math.round(b.duration_s / step); k++) fly.advance(step);
  const header = {
    schema: SHADOW_SCHEMA,
    mode: "baseline",
    subject: `research-threats-${b.split}-${seed}`,
    scenario: "threats",
    seed,
    held: true,
    battery_sha256: b.sha256,
    world: world.id,
    flyVersion: FLY_VERSION,
    echoVersion: ECHO_VERSION,
    controller: h.descriptor.id,
    seconds: b.duration_s,
    stepS: step,
    sample_period_s: step,
    records: h.tap.records.length,
    recordsDropped: h.tap.dropped,
    commandsHeld: h.held,
    counts: fly.state.counts,
    note: "A research subject created for this run and held perched. Not the deployed fly, not a copy or continuation of it.",
  };
  return { header, records: h.tap.records };
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback === undefined) throw new Error(`--${name} is required`);
  return fallback;
}

if (process.argv.slice(1, 3).some((a) => /echo-threat-battery\.ts$/.test(a))) {
  try {
    for (const forbidden of ["store", "checkpoint", "backup", "life", "individual"])
      if (process.argv.includes(`--${forbidden}`))
        throw new Error(`--${forbidden}: the battery never reads an existing organism`);
    const split = arg("split");
    const out = arg("out", `${BATTERY_DIR}/recording-${split}.jsonl`);
    guard(out);
    const b = readBattery(arg("battery", `${BATTERY_DIR}/battery-${split}.json`));
    const run = runBattery(b, Number(arg("seed")));
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(
      out,
      [JSON.stringify(run.header), ...run.records.map((r) => JSON.stringify(r))].join(
        "\n",
      ) + "\n",
    );
    console.log(
      `${out}: ${run.records.length} records, ${run.header.commandsHeld} commands held, counts ${JSON.stringify(run.header.counts)}`,
    );
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
