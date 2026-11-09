/**
 * A versioned adapter from an existing archive to the bench: the 2026-11-07
 * embodied-plasticity study's records (`echo-plasticity-study/v1`,
 * docs/benchmarks/echo-plasticity/). Its schema is left exactly as it is; the
 * bench reads it through this adapter and never rewrites it.
 *
 * Two uses:
 *
 * - reproduction: re-run the archived runs with today's code (the study's own
 *   `execute`) and compare each record byte for byte, then recompute the
 *   study's primary interval with the study's own `bootstrap`;
 * - re-reading: apply the bench's decision rules (minimum meaningful effect,
 *   Bonferroni) to the archived records, labelled as such. That is a different
 *   rule applied to old evidence, not a new experiment, and it never replaces
 *   the study's own verdict.
 */
import { canonicalJson } from "../../rain/sha256.js";
import { bootstrap, type Interval as StudyInterval } from "../plasticity/analysis.js";
import type { Arm, RunRecord as StudyRecord } from "../plasticity/study.js";
import type { ControllerId } from "./controllers.js";
import { METRIC_DIRECTION, type Protocol } from "./protocol.js";
import { decide, pairedInterval, type Decision, type Interval } from "./statistics.js";

export const LEGACY_ADAPTER = "eimb-legacy/echo-plasticity-study-v1" as const;

/** The study's arms as bench controllers. */
export const ARM_CONTROLLER: Readonly<Record<Arm, ControllerId>> = {
  original: "organism",
  active: "plasticity-active",
  shadow: "plasticity-shadow",
  "fixed-slow": "fixed-slow",
};

export const studyKey = (r: Pick<StudyRecord, "condition" | "seed" | "arm">): string =>
  `${r.condition}|${String(r.seed).padStart(8, "0")}|${r.arm}`;

export interface ReproductionSummary {
  schema: "eimb-reproduction/v1";
  adapter: typeof LEGACY_ADAPTER;
  source: string;
  sourceCommit: string;
  condition: string;
  runs: number;
  identical: number;
  differing: string[];
  /** The study's own primary contrast (active − original, meals), recomputed with its own bootstrap from the reproduced records, beside the archived one. */
  primary: { archived: StudyInterval; reproduced: StudyInterval; same: boolean };
  /** The bench's rules applied to the reproduced records: labelled, never a replacement for the study's verdict. */
  benchReading: {
    metric: "meals" | "fedJ";
    contrast: [ControllerId, ControllerId];
    interval: Interval;
    mme: number;
    decision: Decision;
  }[];
}

export function reproductionSummary(
  archived: readonly StudyRecord[],
  reproduced: readonly StudyRecord[],
  archivedPrimary: StudyInterval,
  protocol: Protocol,
  meta: { source: string; sourceCommit: string; condition: string },
): ReproductionSummary {
  const byKey = new Map(archived.map((r) => [studyKey(r), r]));
  const differing: string[] = [];
  let identical = 0;
  for (const r of reproduced) {
    const a = byKey.get(studyKey(r));
    if (a && canonicalJson(a) === canonicalJson(r)) identical++;
    else differing.push(studyKey(r));
  }
  const pairs = (metric: "meals" | "fedJ", arm: Arm): number[] => {
    const out: number[] = [];
    const seeds = [...new Set(reproduced.map((r) => r.seed))].sort((x, y) => x - y);
    for (const seed of seeds) {
      const x = reproduced.find(
        (r) => r.seed === seed && r.arm === arm && r.condition === meta.condition,
      );
      const o = reproduced.find(
        (r) => r.seed === seed && r.arm === "original" && r.condition === meta.condition,
      );
      if (x && o) out.push(x[metric] - o[metric]);
    }
    return out;
  };
  const reproducedPrimary = bootstrap(pairs("meals", "active"), "meals");
  const benchReading: ReproductionSummary["benchReading"] = [];
  const conf = protocol.endpoints.confirmatory;
  for (const metric of ["meals", "fedJ"] as const) {
    const e = conf.find((x) => x.metric === metric);
    if (!e) continue;
    const direction = METRIC_DIRECTION[metric] === "lower" ? "lower" : "higher";
    const interval = pairedInterval(pairs(metric, "active"), {
      resamples: protocol.analysis.resamples,
      seed: protocol.analysis.seed,
      label: `legacy:${meta.condition}:${metric}`,
      level: 1 - protocol.analysis.alpha / conf.length,
      direction,
    });
    benchReading.push({
      metric,
      contrast: ["plasticity-active", "organism"],
      interval,
      mme: e.mme,
      decision: decide(interval, direction, e.mme),
    });
  }
  return {
    schema: "eimb-reproduction/v1",
    adapter: LEGACY_ADAPTER,
    source: meta.source,
    sourceCommit: meta.sourceCommit,
    condition: meta.condition,
    runs: reproduced.length,
    identical,
    differing,
    primary: {
      archived: archivedPrimary,
      reproduced: reproducedPrimary,
      same: canonicalJson(archivedPrimary) === canonicalJson(reproducedPrimary),
    },
    benchReading,
  };
}
