/**
 * Claims 5 to 7: Project ECHO's registered runs and its evaluation report.
 *
 * Records: each registered run's `registry-run.json` under
 * docs/benchmarks/fly-behavior/ (the registry's own measurements, criteria
 * and verdict), and docs/benchmarks/fly-echo/report.json (24 seeds per cell).
 */
import type { Binding } from "../check.js";
import { REGISTER, README } from "../documents.js";
import { list, num, only, readJson, str } from "../records.js";
import { fixed, says, signed } from "../statement.js";

const RUNS = {
  "ECHO-01": "FLY-3dedfd1e08238befa3a2cd09",
  "ECHO-02": "FLY-ea1f81b92313cd532b36b4a8",
  "ECHO-03": "FLY-aff10dec2ec287b28e76c74e",
  "ECHO-04": "FLY-14084ba1f010fb490c4e0d55",
  "ECHO-05": "FLY-bdfb8327413f5007cc987738",
} as const;
type Protocol = keyof typeof RUNS;

const run = (p: Protocol) =>
  readJson(`docs/benchmarks/fly-behavior/${RUNS[p]}/registry-run.json`);
/** One of the registry's measurements. */
const m = (p: Protocol, name: string) => num(run(p), ["measurements", name]);
/** The minimum effect its first success criterion was registered with. */
const minimum = (p: Protocol) =>
  num(
    only(
      list(run(p), "evaluation.success"),
      (c) => str(c, "metric") === "mean_paired_delta",
      "minimum-effect criterion",
    ),
    "value",
  );
const verdict = (p: Protocol) => str(run(p), "hypothesis_verdict");
/** The registry's status and verdict, as the register words an unsupported run. */
function inconclusive(p: Protocol): void {
  if (str(run(p), "status") !== "inconclusive")
    throw new Error(`${p} is no longer inconclusive in the registry`);
}

const REPORT = "docs/benchmarks/fly-echo/report.json";
type Mean = { mean: number; low: number; high: number };
function cell(schedule: string, arm: string, metric: string): Mean {
  const found = only(
    list(readJson(REPORT), "cells"),
    (c) =>
      str(c, "schedule") === schedule &&
      str(c, "cell") === "held-out" &&
      str(c, "arm") === arm,
    `held-out ${schedule} cell for ${arm}`,
  );
  return {
    mean: num(found, ["summary", metric, "mean"]),
    low: num(found, ["summary", metric, "ci95", 0]),
    high: num(found, ["summary", metric, "ci95", 1]),
  };
}
function comparison(schedule: string, treatment: string, metric: string) {
  const found = only(
    list(readJson(REPORT), "comparisons"),
    (c) =>
      str(c, "schedule") === schedule &&
      str(c, "cell") === "held-out" &&
      str(c, "treatment") === treatment &&
      str(c, "metric") === metric,
    `held-out ${schedule} comparison of ${metric} for ${treatment}`,
  );
  return {
    n: num(found, "n"),
    mean: num(found, "mean_difference"),
    low: num(found, "ci95[0]"),
    high: num(found, "ci95[1]"),
    increase: num(found, "increase"),
    decrease: num(found, "decrease"),
  };
}
const calibrationError = (cellName: string) =>
  num(readJson(REPORT), [
    "attribution",
    `${cellName}/full`,
    "reliability",
    "expected_calibration_error",
  ]);

const interval = (x: Mean, d: number) =>
  [fixed(x.mean, d), fixed(x.low, d), fixed(x.high, d)] as const;

export const echo: Binding[] = [
  {
    id: "5.registered",
    doc: REGISTER,
    section: "5",
    statement: () =>
      says`Path error ${fixed(m("ECHO-01", "control_mean"), 3)} with it, ${fixed(m("ECHO-01", "treatment_mean"), 3)} without (${signed(m("ECHO-01", "mean_paired_delta"), 3)}; ${m("ECHO-01", "seeds_expected_direction")} of ${m("ECHO-01", "seeds")} seeds; p = ${fixed(m("ECHO-01", "sign_test_p_expected"), 3)}): **${verdict("ECHO-01")}**`,
  },
  {
    id: "5.report",
    doc: REGISTER,
    section: "5",
    statement: () => {
      const full = interval(cell("impairment", "full", "impaired_path_error"), 3);
      const bare = interval(cell("impairment", "reactive", "impaired_path_error"), 3);
      const c = comparison("impairment", "reactive", "impaired_path_error");
      return says`Evaluation report: ${full[0]} [${full[1]}, ${full[2]}] against ${bare[0]} [${bare[1]}, ${bare[2]}], ${c.increase} of ${c.n} seeds`;
    },
  },
  {
    id: "6.registered",
    doc: REGISTER,
    section: "6",
    statement: () =>
      says`${fixed(m("ECHO-02", "control_mean"), 3)} correct against ${fixed(m("ECHO-02", "treatment_mean"), 3)} (${fixed(m("ECHO-02", "mean_paired_delta"), 3)}; ${m("ECHO-02", "seeds_expected_direction")} of ${m("ECHO-02", "untied_pairs")} untied seeds; p = ${fixed(m("ECHO-02", "sign_test_p_expected"), 3)}), beyond the pilot-sized minimum effect: **${verdict("ECHO-02")}**`,
  },
  {
    id: "6.report",
    doc: REGISTER,
    section: "6",
    statement: () => {
      const full = interval(cell("attribution", "full", "attribution_accuracy"), 2);
      const others = (["motion_gated", "naive_self", "no_uncertainty"] as const).map(
        (arm) => fixed(cell("attribution", arm, "attribution_accuracy").mean, 2),
      );
      return says`Report: ${full[0]} [${full[1]}, ${full[2]}] against ${others[0]!}, ${others[1]!} and ${others[2]!}`;
    },
  },
  {
    id: "6.calibration",
    doc: REGISTER,
    section: "6",
    statement: () =>
      says`expected calibration error ${fixed(calibrationError("held-out"), 2)} against ${fixed(calibrationError("development"), 3)} on development data`,
  },
  {
    id: "7.echo-03",
    doc: REGISTER,
    section: "7",
    statement: () => {
      inconclusive("ECHO-03");
      return says`a reset memory concluded ${fixed(m("ECHO-03", "mean_paired_delta"), 2)} s later (below a ${minimum("ECHO-03")} s minimum)`;
    },
  },
  {
    id: "7.echo-04",
    doc: REGISTER,
    section: "7",
    statement: () => {
      inconclusive("ECHO-04");
      if (m("ECHO-04", "mean_paired_delta") >= 0)
        throw new Error("ECHO-04 no longer concluded sooner");
      return says`without the workspace the busy fly concluded ${fixed(-m("ECHO-04", "mean_paired_delta"), 2)} s _sooner_ (p = ${fixed(m("ECHO-04", "sign_test_p_expected"), 2)}; ${minimum("ECHO-04")} s minimum)`;
    },
  },
  {
    id: "7.echo-05",
    doc: REGISTER,
    section: "7",
    statement: () => {
      inconclusive("ECHO-05");
      return says`without the second look the Brier score rose ${fixed(m("ECHO-05", "control_mean"), 3)} → ${fixed(m("ECHO-05", "treatment_mean"), 3)} (p = ${fixed(m("ECHO-05", "sign_test_p_expected"), 3)}; ${fixed(minimum("ECHO-05"), 1)} minimum)`;
    },
  },
  {
    id: "7.report",
    doc: REGISTER,
    section: "7",
    statement: () => {
      const brier = comparison("attribution", "no_metacognition", "attribution_brier");
      const busy = comparison("busy", "no_workspace", "busy_attribution_latency_s");
      return says`(Brier ${signed(brier.mean, 3)} [${fixed(brier.low, 3)}, ${fixed(brier.high, 3)}]) and a ${fixed(busy.mean, 2)} s [${fixed(busy.low, 2)}, ${fixed(busy.high, 2)}] workspace effect`;
    },
  },
  {
    id: "readme.04.echo-01",
    doc: README,
    section: "04",
    statement: () =>
      says`| Self-model under concealed impairment, ECHO-01 | Path error ${fixed(m("ECHO-01", "control_mean"), 3)} vs ${fixed(m("ECHO-01", "treatment_mean"), 3)} in registered conditions |`,
  },
  {
    id: "readme.04.echo-02",
    doc: README,
    section: "04",
    statement: () =>
      says`| Hidden-change attribution, ECHO-02 | ${fixed(m("ECHO-02", "control_mean"), 3)} vs ${fixed(m("ECHO-02", "treatment_mean"), 3)}; overconfidence remains |`,
  },
  {
    id: "readme.04.echo-03-05",
    doc: README,
    section: "04",
    statement: () => {
      const statuses = (["ECHO-03", "ECHO-04", "ECHO-05"] as const).map((p) =>
        str(run(p), "status"),
      );
      if (new Set(statuses).size !== 1)
        throw new Error("ECHO-03 to ECHO-05 no longer share a status");
      const status = statuses[0]!;
      return says`| ECHO-03 through ECHO-05 | ${status[0]!.toUpperCase() + status.slice(1)} |`;
    },
  },
];
