/**
 * Claims 20, 22 and 23: the research compound eye's looming batteries, the
 * homeostasis study and the reduced feeding circuit.
 *
 * Records: docs/benchmarks/fly-vision/looming-v{1,2}-heldout.json,
 * docs/benchmarks/homeostasis/homeostasis-v1-heldout.json and
 * docs/benchmarks/fly-neural/adaptive/feeding-reduced-v783-heldout.json, each
 * written once from a clean commit with its criteria evaluated in the record.
 */
import type { Binding } from "../check.js";
import { REGISTER } from "../documents.js";
import { at, keys, list, num, readJson, str } from "../records.js";
import { fixed, says, signed } from "../statement.js";

const looming = (v: 1 | 2) =>
  readJson(`docs/benchmarks/fly-vision/looming-v${v}-heldout.json`);
const homeostasis = () =>
  readJson("docs/benchmarks/homeostasis/homeostasis-v1-heldout.json");
const feeding = () =>
  readJson("docs/benchmarks/fly-neural/adaptive/feeding-reduced-v783-heldout.json");

/** `estimate [lo, hi]` of a criterion's difference, each to `d` decimals. */
function difference(record: unknown, criterion: string, d: number) {
  const diff = at(record, ["criteria", criterion, "difference"]);
  return { estimate: num(diff, "estimate"), lo: num(diff, "lo"), hi: num(diff, "hi"), d };
}
const passed = (record: unknown, criterion: string) =>
  at(record, ["criteria", criterion, "pass"]) === true;
function expect(record: unknown, criterion: string, outcome: boolean): void {
  if (passed(record, criterion) !== outcome)
    throw new Error(`${criterion} ${outcome ? "no longer passes" : "now passes"}`);
}
/** Escapes of `trials` for one detector and one kind of stimulus. */
function escapes(v: 1 | 2, detector: string, kind: string): [number, number] {
  const cell = at(looming(v), ["by_kind", detector, kind]);
  return [num(cell, "escapes"), num(cell, "trials")];
}
const f1 = (v: 1 | 2, detector: string) => num(looming(v), ["live", detector, "f1"]);

export const genesis: Binding[] = [
  {
    id: "20.trials",
    doc: REGISTER,
    section: "20",
    statement: () => {
      const trials = [
        num(looming(1), "live.eye-lplc2.trials"),
        num(looming(2), "live.eye-lplc2.trials"),
      ];
      if (trials[0] !== trials[1]) throw new Error("the two batteries differ in size");
      return says`${trials[0]!} trials each, live escapes through the body's gate`;
    },
  },
  {
    id: "20.primary",
    doc: REGISTER,
    section: "20",
    statement: () => {
      expect(looming(1), "V1", false);
      expect(looming(2), "V1", false);
      const [a, b] = [difference(looming(1), "V1", 3), difference(looming(2), "V1", 3)];
      return says`live F1 ${fixed(f1(1, "eye-lplc2"), 3)} against ${fixed(f1(1, "deployed"), 3)} (${fixed(a.estimate, 3)} [${fixed(a.lo, 3)}, ${fixed(a.hi, 3)}]), then ${fixed(f1(2, "eye-lplc2"), 3)} against ${fixed(f1(2, "deployed"), 3)} (${signed(b.estimate, 3)} [${fixed(b.lo, 3)}, ${fixed(b.hi, 3)}])`;
    },
  },
  {
    id: "20.near-miss",
    doc: REGISTER,
    section: "20",
    statement: () => {
      const eye = [
        escapes(1, "eye-lplc2", "near_miss"),
        escapes(2, "eye-lplc2", "near_miss"),
      ];
      if (eye.some(([escaped]) => escaped !== 0))
        throw new Error("the eye escaped from a near miss");
      const [d1, d2] = [
        escapes(1, "deployed", "near_miss"),
        escapes(2, "deployed", "near_miss"),
      ];
      return says`no near miss escaped from (${eye[0]![0]}/${eye[0]![1]} against ${d1[0]}/${d1[1]} and ${d2[0]}/${d2[1]})`;
    },
  },
  {
    id: "20.ablations",
    doc: REGISTER,
    section: "20",
    statement: () => {
      const costs = ([1, 2] as const).flatMap((v) =>
        ["V4", "V5"].map((c) => {
          expect(looming(v), c, true);
          const diff = difference(looming(v), c, 2);
          if (diff.lo <= 0) throw new Error(`${c}'s interval in v${v} reaches 0`);
          return diff.estimate;
        }),
      );
      return says`each cost ${fixed(Math.min(...costs), 2)}–${fixed(Math.max(...costs), 2)} F1 with intervals above 0`;
    },
  },
  {
    id: "20.lead",
    doc: REGISTER,
    section: "20",
    statement: () =>
      says`a ${fixed(num(looming(2), "live.eye-lplc2.medianLeadS") * 1000, 0)} ms median lead against ${fixed(num(looming(2), "live.deployed.medianLeadS") * 1000, 0)} ms in v2`,
  },
  {
    id: "20.tau",
    doc: REGISTER,
    section: "20",
    statement: () =>
      says`A τ rule on the deployed senses scored ${fixed(num(looming(1), "offline.tau-heuristic.f1"), 3)} and ${fixed(num(looming(2), "offline.tau-heuristic.f1"), 3)}`,
  },
  {
    id: "22.design",
    doc: REGISTER,
    section: "22",
    statement: () => {
      const results = list(homeostasis(), "results");
      const yards = new Set(results.map((r) => num(r, "environment"))).size;
      const flies = new Set(results.map((r) => num(r, "seed"))).size;
      const arms = keys(homeostasis(), "survival").length;
      if (yards * flies * arms !== num(homeostasis(), "trials"))
        throw new Error("the design is no longer a full cross");
      return says`${yards} held-out yards × ${flies} flies × ${arms} arms`;
    },
  },
  {
    id: "22.primary",
    doc: REGISTER,
    section: "22",
    statement: () => {
      expect(homeostasis(), "H1", false);
      const h1 = difference(homeostasis(), "H1", 2);
      return says`**The primary criterion failed:** ${signed(h1.estimate, 2)} [${fixed(h1.lo, 2)}, ${signed(h1.hi, 2)}]`;
    },
  },
  {
    id: "22.passed",
    doc: REGISTER,
    section: "22",
    statement: () => {
      for (const c of ["H2", "H3", "H6"]) expect(homeostasis(), c, true);
      for (const c of ["H4", "H5"]) expect(homeostasis(), c, false);
      const [h2, h3] = [
        difference(homeostasis(), "H2", 2),
        difference(homeostasis(), "H3", 2),
      ];
      return says`Passed: H2 (full − heat only, ${signed(h2.estimate, 2)} [${signed(h2.lo, 2)}, ${signed(h2.hi, 2)}]), H3 (full − displaced humidity, ${signed(h3.estimate, 2)} [${signed(h3.lo, 2)}, ${signed(h3.hi, 2)}]) and H6 (median hydrated share ${fixed(num(homeostasis(), "criteria.H6.median_hydrated_share_full"), 2)}). Failed: H4 (survival) and H5 (heat)`;
    },
  },
  {
    id: "22.alive",
    doc: REGISTER,
    section: "22",
    statement: () => {
      const alive = (arm: string) => num(homeostasis(), ["causes", arm, "alive"]);
      const flies = (arm: string) =>
        list(homeostasis(), "results").filter((r) => str(r, "arm") === arm).length;
      // Thirst alone is the arm with the heat feedback removed.
      return says`thirst alone kept ${alive("no-heat")} of ${flies("no-heat")} flies alive against ${alive("no-feedback")} of ${flies("no-feedback")} with none`;
    },
  },
  {
    id: "22.summary",
    doc: REGISTER,
    section: "summary",
    statement: () =>
      says`Primary failed; ${num(homeostasis(), "passed")} of ${num(homeostasis(), "of")}`,
  },
  {
    id: "23.outcome",
    doc: REGISTER,
    section: "23",
    statement: () => {
      const all = keys(feeding(), "criteria");
      const held = all.filter((c) => at(feeding(), ["criteria", c, "passed"]) === true);
      return says`**Passed, ${held.length} of ${all.length}.**`;
    },
  },
  {
    id: "23.exact",
    doc: REGISTER,
    section: "23",
    statement: () => {
      const m = /^(\d+)\/(\d+) trials exact$/.exec(str(feeding(), "criteria.R2.value"));
      if (!m) throw new Error("R2 no longer reports its exact trials as a count");
      return says`${Number(m[1])} of ${Number(m[2])} trials exact on every kept neuron`;
    },
  },
  {
    id: "23.trials",
    doc: REGISTER,
    section: "23",
    statement: () => {
      const m = /^(\d+)\/(\d+) trials exact$/.exec(str(feeding(), "criteria.R2.value"));
      if (!m) throw new Error("R2 no longer reports its exact trials as a count");
      return says`with new seeds, ${Number(m[2])} trials, run once from the clean commit \`${str(feeding(), "code.commit").slice(0, 7)}\``;
    },
  },
  {
    id: "23.summary",
    doc: REGISTER,
    section: "summary",
    statement: () => {
      const all = keys(feeding(), "criteria");
      const held = all.filter((c) => at(feeding(), ["criteria", c, "passed"]) === true);
      return says`Passed (${held.length} of ${all.length})`;
    },
  },
];
