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

/**
 * The standard schedule of fly-neural/experiments/plasticity-v2-v783.json,
 * written out here because this script reads no file; plasticity-v2 refuses an
 * ECHO result whose schedule differs from its own. A test phase records each
 * cue's prediction without a trial; a plastic phase runs one trial per token,
 * "+" rewarded with the meal reward, the rest with none.
 */
export const V2_SCHEDULE = [
  { name: "pre", plastic: false, repeat: 2, block: ["A", "B", "Asim"] },
  { name: "acq", plastic: true, repeat: 8, block: ["A+", "B"] },
  { name: "test1", plastic: false, repeat: 2, block: ["A", "B", "Asim"] },
  { name: "distract", plastic: true, repeat: 4, block: ["C"] },
  { name: "test2", plastic: false, repeat: 2, block: ["A", "B", "Asim"] },
  { name: "ext", plastic: true, repeat: 6, block: ["A"] },
  { name: "test3", plastic: false, repeat: 2, block: ["A", "B", "Asim"] },
  { name: "rev", plastic: true, repeat: 8, block: ["B+", "A"] },
  { name: "test4", plastic: false, repeat: 2, block: ["A", "B", "Asim"] },
] as const;

export interface EchoMbV2Subject {
  seed: number;
  /** Each test phase's prediction m+ − m− per cue (the model is deterministic, so a repeat adds nothing). */
  tests: Record<string, Record<string, number>>;
  /** On the model's own scale (meal reward 1), as differences: the predictions start near 0, so ratios would not mean anything. */
  indices: Record<string, number>;
}

export function runEchoMbV2(seed: number, block = false): EchoMbV2Subject {
  const P = resolveMushroomBodyParams();
  const mb = new MushroomBody(P, seed, block);
  const tests: Record<string, Record<string, number>> = {};
  for (const ph of V2_SCHEDULE)
    for (let k = 0; k < ph.repeat; k++)
      for (const tok of ph.block) {
        const cue = `odour ${tok.replace("+", "")}`;
        if (!ph.plastic) {
          (tests[ph.name] ??= {})[tok] = mb.predict(cue);
          continue;
        }
        const rewarded = tok.endsWith("+");
        mb.trial(
          cue,
          rewarded ? P.mealReward : 0,
          rewarded ? "meal" : "fruitless return",
        );
      }
  const d = (ph: string, o: string) => tests[ph]![o]! - tests.pre![o]!;
  return {
    seed,
    tests,
    indices: {
      li_acq: d("test1", "A") - d("test1", "B"),
      li_ret: d("test2", "A") - d("test2", "B"),
      recovery: tests.test3!.A! - tests.test1!.A!,
      li_rev: d("test4", "A") - d("test4", "B"),
      generalization: d("test1", "Asim"),
    },
  };
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
  const result =
    arg("schedule", "v1") === "v2"
      ? {
          schema: "fly-neural-echo-mb/v2",
          model:
            "src/bethesda/fly/mushroomBody/circuit.ts (Bennett, Philippides & Nowotny 2021 MV model, rate units)",
          schedule: V2_SCHEDULE,
          note: "Cues are names, coded onto Kenyon cells at random by the model; Asim shares no cells with A by construction, unlike the connectome's similar odour. 'fruitless return' is the model's unrewarded trial (r = 0). Predictions rise with reward here; the connectome's MBON readout falls.",
          arms: {
            "as-is": seeds.map((s) => runEchoMbV2(s)),
            "omission-blocked": seeds.map((s) => runEchoMbV2(s, true)),
          },
        }
      : {
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
