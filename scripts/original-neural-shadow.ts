/**
 * Offline, research-only neural probes of PUBLIC observations of original Eva
 * and ECHO. The live capture is made by scripts/first-contact-observe.ts (GET).
 * This script performs NO network requests and cannot send commands to either.
 *
 * Example:
 *   node scripts/run-ts.mjs scripts/first-contact-observe.ts --seconds 30
 *   node scripts/run-ts.mjs scripts/original-neural-shadow.ts --max-samples 3
 *   FLY_NEURAL_PYTHON=python node scripts/run-ts.mjs scripts/original-neural-shadow.ts --simulate --max-samples 3
 *
 * --simulate requires an independently compiled, licensed BANC v888 research
 * connectome. Every 100 ms stimulus is a fresh, separate neural model; NO neural
 * state is claimed to be the original fly's, or inferred across sample gaps.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseObservation as parseEva } from "../src/garden/core/observation.js";
import { parseWitness } from "../src/bethesda/life/observation.js";
import { ECHO, EVA, refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import {
  echoNeuralProxy,
  evaNeuralProxy,
  type NeuralProxy,
} from "../src/bethesda/firstContact/liveNeural.js";
import { sha256 } from "../src/rain/sha256.js";
import {
  SHADOW_SCHEMA,
  serveArgs,
  type Readouts,
} from "./echo-neural-shadow.js";
import { SyncBrain } from "./fly-neural-sync.js";

type Name = "eva" | "echo";
interface CaptureRow {
  stream: Name;
  status: number | null;
  receivedUtc: string;
  sha256: string | null;
  body: string | null;
}
interface Sample {
  stream: Name;
  individual: string;
  receivedUtc: string;
  ownTimeS: number;
  publicBodySha256: string;
  observedOutcome: string;
  proxy: NeuralProxy;
}
interface Probe extends Sample {
  neural: {
    dataset: "banc-v888";
    mapping: "brain-and-cord/v3";
    modelInputWindowMs: 100;
    independentInitialState: true;
    simulatedNeurons: number;
    readouts: Readouts;
    computeMs: number;
  } | null;
}

function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
function selectSamples(samples: readonly Sample[], max: number): Sample[] {
  if (samples.length <= max) return [...samples];
  if (max === 1) return [samples.at(-1)!];
  return Array.from({ length: max }, (_, i) => samples[Math.round((i * (samples.length - 1)) / (max - 1))]!);
}

function readCapture(input: string): { samples: Sample[]; rejected: number } {
  const text = readFileSync(input, "utf8");
  if (text.length > 25_000_000) throw new Error("capture exceeds 25 MB; use a shorter observation run");
  const raw = text.split("\n").filter((line) => line.trim());
  if (raw.length > 5000) throw new Error("capture has too many lines");
  const out: Sample[] = [];
  const last = new Map<Name, number>();
  let rejected = 0;
  for (const line of raw) {
    try {
      const r = JSON.parse(line) as CaptureRow;
      if (!["eva", "echo"].includes(r.stream) || r.status !== 200 || typeof r.body !== "string" || typeof r.receivedUtc !== "string")
        throw new Error("missing response");
      if (r.sha256 !== sha256(r.body)) throw new Error("response hash mismatch");
      if (!Number.isFinite(Date.parse(r.receivedUtc))) throw new Error("invalid UTC");
      const data = JSON.parse(r.body) as unknown;
      let sample: Sample;
      if (r.stream === "eva") {
        const o = parseEva(data);
        if (o.lifeId !== EVA.id) throw new Error("Eva identity mismatch");
        sample = {
          stream: "eva",
          individual: EVA.id,
          receivedUtc: r.receivedUtc,
          ownTimeS: o.updatedAt - o.bornAt,
          publicBodySha256: r.sha256,
          observedOutcome: o.activity,
          proxy: evaNeuralProxy(o),
        };
      } else {
        const witness = parseWitness(data);
        if (witness.status !== "live" || !witness.observation) throw new Error("stale witness");
        const o = witness.observation;
        if (o.individual !== ECHO.id) throw new Error("ECHO identity mismatch");
        sample = {
          stream: "echo",
          individual: ECHO.id,
          receivedUtc: r.receivedUtc,
          ownTimeS: o.simulatedSeconds,
          publicBodySha256: r.sha256,
          observedOutcome: o.fly.mode,
          proxy: echoNeuralProxy(o),
        };
      }
      if (sample.ownTimeS <= (last.get(sample.stream) ?? -Infinity)) continue;
      last.set(sample.stream, sample.ownTimeS);
      out.push(sample);
    } catch {
      rejected++;
    }
  }
  return { samples: out, rejected };
}

function probe(
  sample: Sample,
  sequence: number,
  python: string,
  repo: string,
): Probe {
  // Never pass an original's ID into the neural backend: it deliberately
  // refuses originals and only simulates a disposable research model.
  const brain = new SyncBrain({
    command: python,
    args: serveArgs("brain-and-cord/v3"),
    cwd: join(repo, "fly-neural"),
    header: {
      schema: SHADOW_SCHEMA,
      mode: "neural-experimental",
      subject: `research-public-proxy-${sample.stream}-${sequence}`,
      mapping: "brain-and-cord/v3",
      seed: 711_000 + sequence,
    },
  });
  try {
    const result = brain.ask<Readouts>(0, sample.proxy.input, 100);
    return {
      ...sample,
      neural: {
        dataset: "banc-v888",
        mapping: "brain-and-cord/v3",
        modelInputWindowMs: 100,
        independentInitialState: true,
        simulatedNeurons: Number(brain.ready.neurons),
        readouts: result.readouts,
        computeMs: result.computeMs,
      },
    };
  } finally {
    brain.close();
  }
}

function main(): void {
  const input = resolve(option("--input", join(".first-contact", "observe", "responses.jsonl")));
  const out = resolve(option("--out", join(".first-contact", "original-neural-shadow")));
  const count = Number(option("--max-samples", "3"));
  if (!Number.isInteger(count) || count < 1 || count > 8)
    throw new Error("--max-samples must be an integer from 1 to 8");
  refuseProductionHost(input, existsSync);
  refuseProductionHost(out, existsSync);
  if (!existsSync(input)) throw new Error(`capture missing: ${input}; run first-contact-observe.ts first`);
  const simulated = process.argv.includes("--simulate");
  const python = option("--python", process.env.FLY_NEURAL_PYTHON ?? "python");
  const { samples, rejected } = readCapture(input);
  const eva = selectSamples(samples.filter((s) => s.stream === "eva"), count);
  const echo = selectSamples(samples.filter((s) => s.stream === "echo"), count);
  if (!eva.length || !echo.length)
    throw new Error("need validated public observations of both original individuals");
  const repo = resolve(".");
  const selected = [...eva, ...echo];
  const results: Probe[] = [];
  for (const [i, sample] of selected.entries()) {
    results.push(simulated ? probe(sample, i, python, repo) : { ...sample, neural: null });
  }
  mkdirSync(out, { recursive: true });
  const report = {
    schema: "originals-public-neural-probe/v1",
    createdUtc: new Date().toISOString(),
    sourceCapture: input,
    originalLivesObserved: ["eva", "echo"],
    access: "offline replay of previously captured GET-only public observations",
    networkRequestsFromThisScript: 0,
    commandsToOriginals: 0,
    productionStateWrites: 0,
    simulation: simulated ? "fresh BANC v888 model per observation" : "not run; sensory coverage only",
    interpretation: "EXPLORATORY. Wind is only an environmental proxy, not a measured antennal input. Every other sensory input is unknown and counterfactually zero-filled. Neural readouts cannot be compared with original decisions as predictions of real perception, learning, or cognition.",
    sampleCount: { eva: eva.length, echo: echo.length },
    rejectedResponses: rejected,
    results,
  };
  const dest = join(out, "report.json");
  writeFileSync(dest, JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${dest}; Eva ${eva.length} samples, ECHO ${echo.length}, BANC model ${simulated ? "run" : "not run"}`);
  if (!simulated) console.log("To run the optional BANC model, provide its licensed compiled dataset and repeat with --simulate.");
}

main();
