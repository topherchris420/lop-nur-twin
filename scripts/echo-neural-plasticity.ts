/**
 * The repository's mushroom-body rate model (src/bethesda/fly/mushroomBody/,
 * Bennett, Philippides & Nowotny 2021) on fly-neural's odour-reward schedule
 * (fly-neural/experiments/plasticity-v783.json): cue A rewarded with the
 * model's meal reward, cue B unrewarded, 10 pairs, and its prediction m+ − m−
 * for each cue before and after. Arms: the schedule as given, and the same
 * schedule with the reward omitted (cue A unrewarded too).
 *
 *   node scripts/run-ts.mjs scripts/echo-neural-plasticity.ts --subjects 8 --seed 3100003 --out .fly-neural/echo-mb-dev.json
 *
 * Each subject is a new circuit built from its own seed; nothing here reads a
 * fly, a store or a checkpoint. The cues are two names, coded onto Kenyon
 * cells by the model's own random assignment.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MushroomBody } from "../src/bethesda/fly/mushroomBody/circuit.js";
import { resolveMushroomBodyParams } from "../src/bethesda/fly/mushroomBody/params.js";

export interface EchoMbSubject {
  seed: number;
  before: { A: number; B: number };
  after: { A: number; B: number };
}

export function runEchoMb(seed: number, pairs: number, rewarded = true): EchoMbSubject {
  const P = resolveMushroomBodyParams();
  const mb = new MushroomBody(P, seed);
  const before = { A: mb.predict("odour A"), B: mb.predict("odour B") };
  for (let k = 0; k < pairs; k++) {
    mb.trial(
      "odour A",
      rewarded ? P.mealReward : 0,
      rewarded ? "meal" : "fruitless return",
    );
    mb.trial("odour B", 0, "fruitless return");
  }
  return { seed, before, after: { A: mb.predict("odour A"), B: mb.predict("odour B") } };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

if (process.argv.slice(1, 3).some((a) => /echo-neural-plasticity\.ts$/.test(a))) {
  const subjects = Number(arg("subjects", "8"));
  const base = Number(arg("seed", "3100003"));
  const pairs = Number(arg("pairs", "10"));
  const out = arg("out", ".fly-neural/echo-mb.json");
  const seeds = Array.from({ length: subjects }, (_, s) => (base + 7919 * s) >>> 0);
  const result = {
    schema: "fly-neural-echo-mb/v1",
    model:
      "src/bethesda/fly/mushroomBody/circuit.ts (Bennett, Philippides & Nowotny 2021 MV model, rate units)",
    pairs,
    note: "A 'fruitless return' trial is the model's unrewarded trial (r = 0); here it only stands for cue B presented without reward.",
    arms: {
      "as-is": seeds.map((s) => runEchoMb(s, pairs)),
      "reward-omitted": seeds.map((s) => runEchoMb(s, pairs, false)),
    },
  };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
  console.log(`${out}: ${subjects} subjects`);
}
