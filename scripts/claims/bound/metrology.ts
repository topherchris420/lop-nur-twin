/**
 * Claims 24 and 25: embodied plasticity, in its own study and on the
 * intelligence metrology bench.
 *
 * Records: the two studies' held-out `summary.json` files
 * (docs/benchmarks/echo-plasticity/, docs/benchmarks/eva-plasticity/), and the
 * bench's dev and held-out summaries, its verification and its reproduction of
 * the first study (docs/benchmarks/echo-metrology/).
 */
import type { Binding } from "../check.js";
import { REGISTER, README } from "../documents.js";
import { keys, list, num, only, readJson, str } from "../records.js";
import { fixed, says, signed } from "../statement.js";

const BENCH = "docs/benchmarks/echo-metrology";
const heldOut = () => readJson(`${BENCH}/plasticity-locomotor-v1/heldout/summary.json`);
const dev = () => readJson(`${BENCH}/plasticity-locomotor-v1/dev/summary.json`);
const verification = () =>
  readJson(`${BENCH}/plasticity-locomotor-v1/heldout/verification.json`);
const reproduction = () => readJson(`${BENCH}/reproduction-288b3a8/summary.json`);
const echoStudy = () => readJson("docs/benchmarks/echo-plasticity/heldout/summary.json");
const evaStudy = () => readJson("docs/benchmarks/eva-plasticity/heldout/summary.json");

/** A verdict as the register words it: `NO_DEMONSTRATED_IMPROVEMENT` is "no demonstrated improvement". */
const worded = (verdict: string) => verdict.toLowerCase().replaceAll("_", " ");
/** A confidence level as a percentage: 0.975 is `97.5`. */
const level = (interval: unknown) =>
  fixed(num(interval, "level") * 100, 1).replace(/\.0$/, "");
/** The two counts of a check's "160 of 160 …" detail. */
function counts(detail: string): [number, number] {
  const m = /^(\d+) of (\d+) /.exec(detail);
  if (!m) throw new Error(`"${detail}" does not open with a count`);
  return [Number(m[1]), Number(m[2])];
}
const confirmatory = (id: string) =>
  only(
    list(heldOut(), "confirmatory"),
    (c) => str(c, "id") === id,
    `confirmatory endpoint ${id}`,
  );
const validity = (id: string) => {
  const found = only(
    list(heldOut(), "validity.checks"),
    (c) => str(c, "id") === id,
    `check ${id}`,
  );
  if (at(found, "passed") !== true) throw new Error(`validity check ${id} did not pass`);
  return counts(str(found, "detail"));
};
function at(value: unknown, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

export const metrology: Binding[] = [
  {
    id: "24.designs",
    doc: REGISTER,
    section: "24",
    statement: () => {
      const conditions = keys(echoStudy(), "means").filter((c) => c !== "restart");
      return says`ECHO: ${num(echoStudy(), "seeds")} seeds × ${keys(echoStudy(), ["means", conditions[0]!]).length} arms (original, shadow, active, fixed-slow ablation) × ${conditions.length} conditions plus a restart`;
    },
  },
  {
    id: "24.designs-eva",
    doc: REGISTER,
    section: "24",
    statement: () => {
      const conditions = keys(evaStudy(), "means").filter((c) => c !== "restart");
      return says`Eva: ${num(evaStudy(), "seeds")} seeds × ${keys(evaStudy(), ["means", conditions[0]!]).length} arms (original, shadow, active, no-learning ablation) × ${conditions.length} conditions plus a restart`;
    },
  },
  {
    id: "24.shadow",
    doc: REGISTER,
    section: "24",
    statement: () =>
      says`Shadow identical to the original: ECHO ${num(echoStudy(), "shadow.identical")} of ${num(echoStudy(), "shadow.runs")}, Eva ${num(evaStudy(), "shadow.identical")} of ${num(evaStudy(), "shadow.runs")}`,
  },
  {
    id: "24.restart",
    doc: REGISTER,
    section: "24",
    statement: () => {
      if (num(echoStudy(), "restart.learningKept") !== num(echoStudy(), "restart.runs"))
        throw new Error("learning was not kept in every ECHO restart");
      return says`Restart exact: ECHO ${num(echoStudy(), "restart.identical")} of ${num(echoStudy(), "restart.runs")} (learning kept in all)`;
    },
  },
  {
    id: "24.restart-eva",
    doc: REGISTER,
    section: "24",
    statement: () =>
      says`${num(evaStudy(), "restart.identical")} of ${num(evaStudy(), "restart.runs")} overall`,
  },
  {
    id: "24.primary",
    doc: REGISTER,
    section: "24",
    statement: () => {
      const i = at(at(at(echoStudy(), "primary"), "contrast"), "interval");
      return says`Primary, ECHO (weak legs, meals): **${str(echoStudy(), "primary.verdict")}**, ${signed(num(i, "mean"), 2)} (95% CI ${fixed(num(i, "low"), 2)} to ${fixed(num(i, "high"), 2)})`;
    },
  },
  {
    id: "24.primary-eva",
    doc: REGISTER,
    section: "24",
    statement: () => {
      const mean = num(evaStudy(), "primary.contrast.interval.mean");
      if (mean !== 0) throw new Error("Eva's primary contrast is no longer exactly zero");
      return says`Primary, Eva (weak wings, journeys): **no difference established**, exactly ${mean}`;
    },
  },
  {
    id: "25.design",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const conditions = list(
        readJson(`${BENCH}/plasticity-locomotor-v1/heldout/protocol.json`),
        "conditions",
      );
      const novel = conditions.filter((c) => at(c, "novelToCandidate") === true).length;
      return says`${conditions.length} conditions (${conditions.length - novel} the candidate had met, ${novel} it had not)`;
    },
  },
  {
    id: "25.minimum-effects",
    doc: REGISTER,
    section: "25",
    statement: () =>
      says`Minimum meaningful effects of ${fixed(num(confirmatory("C1-energy"), "mme"), 3)} J of energy and ${num(confirmatory("C2-meals"), "mme")} meal`,
  },
  {
    id: "25.sizes",
    doc: REGISTER,
    section: "25",
    statement: () =>
      says`Dev: ${list(dev(), "design.seeds").length} seeds, ${num(dev(), "design.recordsPresent")} runs. Held-out: ${list(heldOut(), "design.seeds").length} seeds derived from the protocol digest, ${num(heldOut(), "design.recordsPresent")} runs`,
  },
  {
    id: "25.verdict",
    doc: REGISTER,
    section: "25",
    statement: () => says`Held-out: **${worded(str(heldOut(), "verdict.overall"))}**`,
  },
  {
    id: "25.energy",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const c = confirmatory("C1-energy");
      const i = at(c, "interval");
      return says`Energy, weak legs: ${fixed(num(i, "mean"), 3)} J (${level(i)}% ${fixed(num(i, "low"), 3)} to ${fixed(num(i, "high"), 3)}), ${worded(str(c, "verdict"))}`;
    },
  },
  {
    id: "25.meals",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const c = confirmatory("C2-meals");
      const i = at(c, "interval");
      return says`Meals: ${fixed(num(i, "mean"), 2)} (${level(i)}% ${fixed(num(i, "low"), 2)} to ${fixed(num(i, "high"), 2)}), ${worded(str(c, "verdict"))}`;
    },
  },
  {
    id: "25.regression",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const c = only(
        list(heldOut(), "boundary"),
        (b) => str(b, "id") === "boundary:weak-legs-severe:plasticity-active-organism",
        "boundary contrast under severe weak legs",
      );
      if (str(c, "verdict") !== "REGRESSION")
        throw new Error("it is no longer a regression");
      const i = at(c, "interval");
      if (Math.abs(num(i, "mean")) >= num(c, "mme"))
        throw new Error("it is no longer smaller than δ");
      return says`A corrected regression under severe weak legs: ${fixed(num(i, "mean"), 3)} J (${level(i)}% ${fixed(num(i, "low"), 3)} to ${fixed(num(i, "high"), 3)}), smaller than δ`;
    },
  },
  {
    id: "25.validity",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const [same, of] = validity("identical-to-baseline");
      if (at(at(heldOut(), "validity"), "valid") !== true)
        throw new Error("a validity check failed");
      const [replayed, sampled] = counts(str(verification(), "replay.detail"));
      if (str(verification(), "replay.status") !== "matched")
        throw new Error("the replay did not match");
      return says`Shadow and disabled were identical to the baseline in ${same} of ${of} runs. All validity checks passed, and ${replayed} of ${sampled} replayed runs were byte-identical`;
    },
  },
  {
    id: "25.reproduction",
    doc: REGISTER,
    section: "25",
    statement: () => {
      if (at(at(reproduction(), "primary"), "same") !== true)
        throw new Error("the reproduced primary result differs from the archived one");
      return says`Claim 24's held-out runs reproduced byte for byte (${num(reproduction(), "identical")} of ${num(reproduction(), "runs")}), with the same primary result`;
    },
  },
  {
    id: "25.impairment-cost",
    doc: REGISTER,
    section: "25",
    statement: () => {
      const cost = only(
        list(heldOut(), "impairmentCost"),
        (c) => str(c, "condition") === "weak-legs",
        "cost of weak legs to the baseline",
      );
      const i = at(cost, "interval");
      if (-num(i, "mean") >= num(confirmatory("C1-energy"), "mme"))
        throw new Error("weak legs now cost the baseline at least δ");
      // A cost is the loss: the interval's signs and ends swap.
      return says`Weak legs cost the baseline only ${fixed(-num(i, "mean"), 3)} J (${level(i)}% ${fixed(-num(i, "high"), 3)} to ${fixed(-num(i, "low"), 3)}), below δ`;
    },
  },
  {
    id: "readme.04.metrology",
    doc: README,
    section: "04",
    statement: () => {
      const overall = worded(str(heldOut(), "verdict.overall"));
      return says`| Embodied plasticity under weak legs, metrology bench | ${overall[0]!.toUpperCase() + overall.slice(1)} on ${list(heldOut(), "design.seeds").length} held-out subjects;`;
    },
  },
  {
    id: "readme.04.metrology-prose",
    doc: README,
    section: "04",
    statement: () =>
      says`then asked it again on ${list(heldOut(), "design.seeds").length} new research subjects in nine conditions: ${worded(str(heldOut(), "verdict.overall"))}`,
  },
];
