/**
 * From archived records to verdicts. Pure arithmetic on the records, so the
 * report reproduces on any machine from the same files, while the flies
 * themselves reproduce only on the platform that lived them.
 *
 * Intervals are `individualityReport.summary`'s: 95% percentile bootstrap over
 * individuals, its stream fixed per measure, so identical numbers always print
 * identical intervals. The individual is the unit throughout.
 */
import { signTest, summary } from "../life/individualityReport.js";
import {
  BREAK_AFTER_EPOCHS,
  judgeResearch,
  type Estimate,
  type ResearchMeasures,
  type Verdict,
} from "./benchmarks.js";
import type { EpochRow, IndividualRecord } from "./study.js";

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const meals = (rows: readonly EpochRow[]) => sum(rows.map((e) => e.meals));

/** The comparisons each benchmark makes, per individual. */
export const perIndividual = {
  b1: (r: IndividualRecord) =>
    mean(r.a.probes.self.map((p) => p.preference)) -
    mean(r.a.probes.erased.map((p) => p.preference)),
  b2: (r: IndividualRecord) => meals(r.b.memory) - meals(r.b.lesion),
  m1: (r: IndividualRecord) => mean(r.b.memory.map((e) => e.staleRemembered)),
  c1: (r: IndividualRecord) =>
    r.b.restart.identical &&
    r.a.restoredMindSame &&
    JSON.stringify(r.a.probes.restored) === JSON.stringify(r.a.probes.self),
  c4: (r: IndividualRecord) =>
    r.b.twin.newId && r.b.twin.recordsParent && r.b.twin.cannotContinue,
};

function byK(records: readonly IndividualRecord[]): Map<number, IndividualRecord> {
  return new Map(records.map((r) => [r.k, r]));
}

/** Records of one split and release, checked to be complete and consistent. */
export function checkRecords(records: readonly IndividualRecord[], n: number): string[] {
  const errors: string[] = [];
  const ks = records.map((r) => r.k).sort((a, b) => a - b);
  if (ks.length !== n || ks.some((k, i) => k !== i))
    errors.push(`expected individuals 0–${n - 1}, got ${ks.join(",")}`);
  for (const f of ["suite", "split", "release"] as const)
    if (new Set(records.map((r) => r[f])).size > 1) errors.push(`mixed ${f}`);
  return errors;
}

/** The measures a release's verdicts are judged on; `base` is the release it updates, if any. */
export function researchMeasures(
  records: readonly IndividualRecord[],
  base: readonly IndividualRecord[] | null,
): ResearchMeasures {
  const s = (f: (r: IndividualRecord) => number, salt: string): Estimate =>
    summary(records.map(f), salt);
  const updated = records.filter((r) => r.b.updated);
  const baseByK = base ? byK(base) : null;
  return {
    b1: s(perIndividual.b1, "B1"),
    b2: s(perIndividual.b2, "B2"),
    m1: s(perIndividual.m1, "M1"),
    c1: { identical: records.filter(perIndividual.c1).length, n: records.length },
    c2: updated.length
      ? { kept: updated.filter((r) => r.b.updated!.kept).length, n: records.length }
      : null,
    c3:
      updated.length && baseByK
        ? summary(
            records.map((r) =>
              r.b.updated?.kept
                ? meals(r.b.updated.laterEpochs) -
                  meals(baseByK.get(r.k)!.b.memory.slice(BREAK_AFTER_EPOCHS))
                : NaN,
            ),
            "C3",
          )
        : null,
    c4: { someoneElse: records.filter(perIndividual.c4).length, n: records.length },
  };
}

/** What the benchmarks do not judge but a reader needs, per release. */
export function describe(records: readonly IndividualRecord[]) {
  const arm = (pick: (r: IndividualRecord) => EpochRow[], salt: string) => ({
    mealsPerLife: summary(
      records.map((r) => meals(pick(r))),
      `meals|${salt}`,
    ),
    epochsWithoutMeal: summary(
      records.map((r) => pick(r).filter((e) => e.meals === 0).length),
      `empty|${salt}`,
    ),
    staleArrivalsPerMove: summary(
      records.map((r) =>
        mean(
          pick(r)
            .slice(1)
            .map((e) => e.staleArrivals),
        ),
      ),
      `staleArrivals|${salt}`,
    ),
    staleRemembered: summary(
      records.map((r) => mean(pick(r).map((e) => e.staleRemembered))),
      `staleRemembered|${salt}`,
    ),
    /** Mean over individuals of each epoch's meals, first to last. */
    mealsByEpoch: pick(records[0]!).map((_, i) =>
      Number(mean(records.map((r) => pick(r)[i]!.meals)).toPrecision(4)),
    ),
    staleByEpoch: pick(records[0]!).map((_, i) =>
      Number(mean(records.map((r) => pick(r)[i]!.staleRemembered)).toPrecision(4)),
    ),
  });
  const pref = (which: "self" | "erased" | "restored") =>
    summary(
      records.map((r) => mean(r.a.probes[which].map((p) => p.preference))),
      `preference|${which}`,
    );
  return {
    memory: arm((r) => r.b.memory, "memory"),
    lesion: arm((r) => r.b.lesion, "lesion"),
    preference: {
      self: pref("self"),
      erased: pref("erased"),
      restored: pref("restored"),
    },
    b2Sign: signTest(records.map(perIndividual.b2)),
    b1Sign: signTest(records.map(perIndividual.b1)),
    trainingMeals: summary(
      records.map((r) => r.a.meals),
      "trainingMeals",
    ),
  };
}

/** The improvement against the baseline on the same individuals: `COMPARISON`'s primary measure. */
export function compare(
  improved: readonly IndividualRecord[],
  baseline: readonly IndividualRecord[],
) {
  const b = byK(baseline);
  const diffs = improved.map((r) => meals(r.b.memory) - meals(b.get(r.k)!.b.memory));
  return { primary: summary(diffs, "primary"), sign: signTest(diffs) };
}

export interface ReleaseResult {
  split: string;
  release: string;
  n: number;
  measures: ResearchMeasures;
  verdicts: Record<string, Verdict>;
  description: ReturnType<typeof describe>;
}

export function releaseResult(
  records: readonly IndividualRecord[],
  base: readonly IndividualRecord[] | null,
): ReleaseResult {
  const measures = researchMeasures(records, base);
  return {
    split: records[0]!.split,
    release: records[0]!.release,
    n: records.length,
    measures,
    verdicts: judgeResearch(measures),
    description: describe(records),
  };
}
