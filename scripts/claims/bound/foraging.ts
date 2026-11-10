/**
 * Claims 11 and 12: the acquired search preference and the ranging study.
 *
 * Records: the reports in docs/benchmarks/echo-acquired/2026-11-02/ (the
 * sealed test and the city's second day) and
 * docs/benchmarks/echo-ranging/2026-11-03/report-guarded-fresh.json.
 */
import type { Binding } from "../check.js";
import { REGISTER } from "../documents.js";
import { at, list, num, readJson } from "../records.js";
import { fixed, says, signed } from "../statement.js";

const ACQUIRED = "docs/benchmarks/echo-acquired/2026-11-02";
const sealed = () => readJson(`${ACQUIRED}/report-heldout.json`);
const city = () => readJson(`${ACQUIRED}/report-city-day2.json`);
const ranging = () =>
  readJson("docs/benchmarks/echo-ranging/2026-11-03/report-guarded-fresh.json");

/** A report's `{ mean, low, high }`. */
function interval(record: unknown, path: string) {
  const i = at(record, path);
  return { mean: num(i, "mean"), low: num(i, "low"), high: num(i, "high") };
}

export const foraging: Binding[] = [
  {
    id: "11.transfers",
    doc: REGISTER,
    section: "11",
    statement: () => {
      const learned = interval(sealed(), "preference");
      const control = interval(sealed(), "control.shift");
      return says`Transfers, **on the sealed test** (${list(sealed(), "seeds").length} seeds): ${signed(learned.mean, 2)} [${fixed(learned.low, 2)}, ${fixed(learned.high, 2)}] against ${fixed(control.mean, 2)} [${fixed(control.low, 2)}, ${fixed(control.high, 2)}]`;
    },
  },
  {
    id: "11.pays",
    doc: REGISTER,
    section: "11",
    statement: () => {
      const first = interval(sealed(), "usefulMatched");
      const stay = interval(sealed(), "stayNetMatched");
      return says`first meal ${fixed(first.mean, 0)} s [${fixed(first.low, 0)}, ${fixed(first.high, 0)}]; an 8 h stay ${signed(stay.mean, 2)} J [${fixed(stay.low, 2)}, ${fixed(stay.high, 2)}]`;
    },
  },
  {
    id: "11.city",
    doc: REGISTER,
    section: "11",
    statement: () => {
      const meals = interval(city(), "meals.gain");
      return says`In the city, in development: ${fixed(meals.mean, 1)} meals [${fixed(meals.low, 1)}, ${signed(meals.high, 1)}]`;
    },
  },
  {
    id: "12.learner",
    doc: REGISTER,
    section: "12",
    statement: () => {
      const lost = interval(ranging(), "learnerVsRoam.meals.gain");
      if (lost.high >= 0)
        throw new Error("the learner no longer loses to the wide search");
      return says`The learner lost to simply always searching widely: ${fixed(lost.mean, 1)} meals [${fixed(lost.low, 1)}, ${fixed(lost.high, 1)}]`;
    },
  },
  {
    id: "12.wide",
    doc: REGISTER,
    section: "12",
    statement: () => {
      const paid = interval(ranging(), "roamVsOrganism.meals.gain");
      return says`The wider search itself paid (${signed(paid.mean, 1)} meals [${fixed(paid.low, 1)}, ${fixed(paid.high, 1)}] over the default)`;
    },
  },
];
