/**
 * One live first-contact session between two research flies whose brains are
 * the whole-brain connectome model (`python -m fly_neural serve`, mapping
 * whole-brain/v2): every one of FlyWire v783's 139,255 neurons is simulated,
 * each fly sees the other only through the bridge and its own eyes (as a
 * looming thing to LPLC2 and LC4, and as a small moving thing to LC11 and
 * LC10a), and the model's descending neurons decide escape, feeding,
 * walking, steering, antennal grooming and landing
 * (scripts/echo-neural-shadow.ts `WHOLE_BRAIN_RULES`). ECHO keeps the rest.
 *
 *   FLY_NEURAL_PYTHON=<python with fly-neural's requirements> \
 *     node scripts/run-ts.mjs scripts/first-contact-whole-brain.ts --seed 1 --pre 3 --contact 20
 *
 * A demonstration, not a registered study: it tests no hypothesis and is
 * reported as one run. Both subjects are new research flies built from seeds;
 * neither is Eva or ECHO, a copy of either, or a continuation of either. It
 * uses the frozen encounter protocol's arena, starts and bridge, with its
 * own (shorter) times, and writes only under .first-contact/whole-brain/
 * (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { runSession, type SessionSpec } from "../src/bethesda/firstContact/session.js";
import type { SubjectSpec } from "../src/bethesda/firstContact/subjects.js";
import {
  SHADOW_SCHEMA,
  ShadowTap,
  WHOLE_BRAIN_RULES,
  type Readouts,
  type SensableObservation,
} from "./echo-neural-shadow.js";
import { SyncBrain } from "./fly-neural-sync.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAPPING = "whole-brain/v2" as const;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

interface EncounterProtocolSlice {
  starts: { A: SubjectSpec["start"]; B: SubjectSpec["start"] };
  arena: SessionSpec["arena"];
  bridge: SessionSpec["bridge"];
}

/** What the brain did over a subject's life: how often each readout fired, and how much of the brain's output was in use. */
function summarize(tap: ShadowTap, computeMs: number) {
  const fired: Record<string, number> = {};
  let samples = 0,
    sawSmall = 0,
    drivenSmall = 0,
    dnMax = 0,
    dnSum = 0,
    dnOf = 0;
  let lastT = -1;
  for (const r of tap.records) {
    if (r.t === lastT) continue; // one sample, seen by decide and interrupt
    lastT = r.t;
    samples++;
    const o = r.obs.smallObject;
    if (o) {
      sawSmall++;
      if (o.speedDegS !== 0 && o.sizeDeg < 30) drivenSmall++;
    }
    const n = r.neural;
    if (!n) continue;
    for (const [k, v] of Object.entries(n))
      if (v && typeof v === "object" && "predicted" in v && v.predicted)
        fired[k] = (fired[k] ?? 0) + 1;
    if (n.descending) {
      dnMax = Math.max(dnMax, n.descending.active);
      dnSum += n.descending.active;
      dnOf = n.descending.of;
    }
  }
  return {
    controller: tap.descriptor.id,
    samples,
    readoutSamplesFired: fired,
    commandsMadeByTheModel: tap.overrides,
    otherFlyOnTheEye: { samples: sawSmall, drivingLC11andLC10a: drivenSmall },
    descendingNeurons: {
      of: dnOf,
      maxActiveIn100ms: dnMax,
      meanActiveIn100ms: samples ? Math.round((dnSum / samples) * 100) / 100 : 0,
    },
    brainComputeS: Math.round(computeMs / 100) / 10,
  };
}

function main() {
  const seed = Number(arg("seed", "1"));
  const pre = Number(arg("pre", "3"));
  const contact = Number(arg("contact", "20"));
  const python = arg("python", process.env.FLY_NEURAL_PYTHON ?? "python");
  if (!(seed >= 0 && pre >= 0 && contact > 0 && contact <= 600))
    throw new Error("--seed ≥ 0, --pre ≥ 0 and 0 < --contact ≤ 600 seconds");
  const out = join(root, ".first-contact", "whole-brain", `session-${seed}.json`);
  refuseProductionHost(out, existsSync);
  const p = JSON.parse(
    readFileSync(
      join(root, "src/bethesda/firstContact/protocols/encounter-v1.json"),
      "utf8",
    ),
  ) as EncounterProtocolSlice;
  const ids = [
    `research-whole-brain-A-${seed}`,
    `research-whole-brain-B-${seed}`,
  ] as const;
  const seeds = [710000 + seed, 720000 + seed] as const;
  const compute = [0, 0];
  const brains = ids.map((id, i) => {
    const b = new SyncBrain({
      command: python,
      cwd: join(root, "fly-neural"),
      header: {
        schema: SHADOW_SCHEMA,
        mode: "neural-experimental",
        subject: id,
        seed: seeds[i],
        mapping: MAPPING,
      },
    });
    console.log(`${id}: brain ready, ${String(b.ready.neurons)} neurons simulated`);
    return b;
  });
  const taps: ShadowTap[] = [];
  const t0 = performance.now();
  try {
    const adapters = brains.map((b, i) =>
      ShadowTap.factory("neural-experimental", seeds[i]!, 500_000, taps, {
        mapping: MAPPING,
        brain: (t: number, obs: SensableObservation) => {
          const r = b.ask<Readouts>(t, obs);
          compute[i] = (compute[i] ?? 0) + r.computeMs;
          return r.readouts;
        },
      }),
    ) as [ReturnType<typeof ShadowTap.factory>, ReturnType<typeof ShadowTap.factory>];
    const spec: SessionSpec = {
      id: `research-whole-brain-session-${seed}`,
      condition: "live",
      subjects: [
        { id: ids[0], seed: seeds[0], controller: "echo", start: p.starts.A },
        { id: ids[1], seed: seeds[1], controller: "echo", start: p.starts.B },
      ],
      preContactS: [pre, pre],
      contactS: contact,
      arena: p.arena,
      ...(p.bridge ? { bridge: p.bridge } : {}),
      authorization: {
        by: "scripts/first-contact-whole-brain.ts, a demonstration run on research subjects",
        purpose: "two whole-brain research flies meeting through the bridge",
        subjects: [ids[0], ids[1]],
        scope: "research-subjects-only",
      },
    };
    const result = runSession(spec, null, adapters);
    const wallS = (performance.now() - t0) / 1000;
    const report = {
      schema: "first-contact-whole-brain-demo/v1",
      note: "A demonstration run, not a registered study. Both subjects are research flies built from seeds; neither is Eva or ECHO, a copy or a continuation of either.",
      mapping: MAPPING,
      rules: WHOLE_BRAIN_RULES,
      neuronsSimulatedPerBrain: brains[0]!.ready.neurons,
      seconds: { preContact: pre, contact },
      wallS: Math.round(wallS),
      session: {
        synchronized: result.synchronized,
        exchanges: result.exchanges,
        bridge: result.bridge,
      },
      subjects: result.subjects.map((o, i) => ({
        outcome: o,
        brain: summarize(taps[i]!, compute[i]!),
      })),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
    console.log(JSON.stringify(report.subjects, null, 1));
    console.log(`wrote ${out} (${Math.round(wallS)} s)`);
  } finally {
    for (const b of brains) b.close();
  }
}

main();
