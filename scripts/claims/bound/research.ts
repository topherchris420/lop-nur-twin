/**
 * Claims 8, 9, 13, 15, 19 and 23, and the README's connectome figures.
 *
 * Records: the individuality report (docs/benchmarks/fly-individuality/), the
 * calibration report and its sealed held-out set (docs/benchmarks/fly-calibration/),
 * and the connectome backend's import and reproduction results
 * (docs/benchmarks/fly-neural/). Claim 19 is about this repository's own
 * model, so its counts come from the modules the twin itself is built from.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_LEDGER } from "../../../src/lib/evidence.js";
import { STRUCTURES } from "../../../src/lib/layout.js";
import { PUBLIC_SOURCES } from "../../../src/lib/siteData.js";
import type { Binding } from "../check.js";
import { REGISTER, README } from "../documents.js";
import { at, list, num, readJson } from "../records.js";
import { fixed, grouped, percent, says, signed, whole } from "../statement.js";

const individuality = () => readJson("docs/benchmarks/fly-individuality/report.json");
const calibration = () => readJson("docs/benchmarks/fly-calibration/report.json");
const holdout = () => readJson("docs/benchmarks/fly-calibration/holdout-2026-11.json");
const NEURAL = "docs/benchmarks/fly-neural";
const reproduction = (split: "dev" | "heldout") =>
  readJson(`${NEURAL}/shiu2024-v783-${split}.json`);
const connectome = () =>
  at(readJson(`${NEURAL}/import-fafb-v783-shiu.json`), "structure_revalidated");

/** `mean [low, high]` of one of the individuality report's intervals. */
function interval(record: unknown, path: string, d: number): [string, string, string] {
  const i = at(record, path);
  return [
    fixed(num(i, "mean"), d),
    fixed(num(i, "ci95[0]"), d),
    fixed(num(i, "ci95[1]"), d),
  ];
}

/** How many held-out observations a controller met within the flies' spread, of those with an interval. */
function withinSpread(controller: string): [number, number] {
  const tally = at(calibration(), ["tally", controller, "held-out"]) as Record<
    string,
    number
  >;
  const within = tally["within-spread"] ?? 0;
  return [within, within + (tally["outside"] ?? 0) + (tally["inside"] ?? 0)];
}

/** Criteria passed and stated, the same on the dev and the held-out seeds. */
function criteria(): [number, number] {
  const [dev, held] = (["dev", "heldout"] as const).map((split) => {
    const all = list(reproduction(split), "criteria");
    return [all.filter((c) => at(c, "passed") === true).length, all.length] as const;
  });
  if (dev![0] !== held![0] || dev![1] !== held![1])
    throw new Error("the two seed sets no longer pass the same number of criteria");
  return [held![0], held![1]];
}

const MODEL = "src/lib/layout.ts, src/lib/evidence.ts and src/lib/siteData.ts";

const mushroomBody = () => readJson("docs/benchmarks/fly-mushroom-body/report.json");
const ecologyAlone = () => readJson("docs/benchmarks/ecology/alone-30d.json");
const ECOLOGY_TESTS = "src/bethesda/ecology/ecology.test.ts";
const RULE_TESTS = "scripts/test-evidence-validation.ts";

/**
 * How often `pattern` occurs in one of this repository's own source files. A
 * count of tests or rules is a fact about the code, not a record: the file is
 * read directly, so the binding names it as its `model` and carries no
 * evidence digest that every unrelated edit to the file would move.
 */
function sourceCount(path: string, pattern: RegExp): number {
  const found =
    readFileSync(join(process.cwd(), path), "utf8").match(pattern)?.length ?? 0;
  if (found === 0) throw new Error(`${path} has nothing matching ${String(pattern)}`);
  return found;
}
/** A bound as the register prints it: `0.88`, but `1` for a whole number. */
const bound = (x: number) => (Number.isInteger(x) ? whole(x) : fixed(x, 2));

export const research: Binding[] = [
  {
    id: "8.preference",
    doc: REGISTER,
    section: "8",
    statement: () => {
      const self = interval(individuality(), "a.arms.self.preference", 2);
      const erased = interval(individuality(), "a.arms.erased.preference", 2);
      if (num(individuality(), "a.arms.genesis.preference.mean") !== 0)
        throw new Error("the never-lived copy now shows a preference");
      return says`Preference for the fed site ${self[0]} [${self[1]}, ${self[2]}], against ${erased[0]} [${erased[1]}, ${erased[2]}] erased and 0 for the copy`;
    },
  },
  {
    id: "8.continuity",
    doc: REGISTER,
    section: "8",
    statement: () => {
      const c = at(individuality(), "a.continuity");
      if (num(c, "storedIsSelf") !== num(c, "replayIsSelf"))
        throw new Error("stored and replayed minds no longer agree");
      return says`byte-identical in ${num(c, "storedIsSelf")} of ${num(individuality(), "a.individuals")}`;
    },
  },
  {
    id: "8.no-site",
    doc: REGISTER,
    section: "8",
    statement: () =>
      says`in ${percent(num(individuality(), "a.arms.self.firstNone"))}% of probes the fly reached no site in ${num(individuality(), "probeS")} s`,
  },
  {
    id: "9.meals",
    doc: REGISTER,
    section: "9",
    statement: () => {
      const i = at(individuality(), "b.fullMinusAmnesic.mealsPerLife");
      if (num(i, "mean") >= 0) throw new Error("memory no longer costs meals");
      return says`Memory-bearing flies ate ${fixed(-num(i, "mean"), 1)} fewer meals per life [${fixed(num(i, "ci95[0]"), 2)}, ${fixed(num(i, "ci95[1]"), 2)}] (Study B)`;
    },
  },
  {
    id: "readme.04.memory",
    doc: README,
    section: "04",
    statement: () =>
      says`| Memory with continuously moving food | Negative: ${fixed(-num(individuality(), "b.fullMinusAmnesic.mealsPerLife.mean"), 1)} fewer meals per life |`,
  },
  {
    id: "10.returns",
    doc: REGISTER,
    section: "10",
    statement: () => {
      const circuit = at(mushroomBody(), [
        "c1",
        "contrasts",
        "threeMinusOneMeal",
        "mushroom-body",
      ]);
      const bookkeeping = at(mushroomBody(), [
        "c1",
        "contrasts",
        "threeMinusOneMeal",
        "reduced-order",
      ]);
      return says`Three meals instead of one added ${signed(num(circuit, "returns.mean"), 2)} [${bound(num(circuit, "returns.ci95[0]"))}, ${bound(num(circuit, "returns.ci95[1]"))}] return flights with the circuit (more in ${num(circuit, "sign.up")} of ${num(circuit, "returns.n")}) and ${fixed(num(bookkeeping, "returns.mean"), 2)} with the bookkeeping`;
    },
  },
  {
    id: "10.lesion",
    doc: REGISTER,
    section: "10",
    statement: () => {
      const lesion = at(mushroomBody(), [
        "c1",
        "contrasts",
        "blockedMinusMushroomBody",
        "1",
        "returns",
      ]);
      return says`The lesion kept flies returning (${fixed(num(lesion, "mean"), 2)} [${fixed(num(lesion, "ci95[0]"), 2)}, ${fixed(num(lesion, "ci95[1]"), 2)}] more)`;
    },
  },
  {
    id: "21.tests",
    doc: REGISTER,
    section: "21",
    model: ECOLOGY_TESTS,
    statement: () =>
      says`${sourceCount(ECOLOGY_TESTS, /^ {2}it\(/gm)} tests (\`src/bethesda/ecology/ecology.test.ts\`)`,
  },
  {
    id: "21.reference",
    doc: REGISTER,
    section: "21",
    statement: () =>
      says`a ${list(ecologyAlone(), "days").length}-day fly-less reference`,
  },
  {
    id: "21.books",
    doc: REGISTER,
    section: "21",
    statement: () =>
      says`books close to rounding over ${list(ecologyAlone(), "days").length} days`,
  },
  {
    id: "19.rules",
    doc: REGISTER,
    section: "19",
    model: RULE_TESTS,
    statement: () =>
      says`asserts each of the ${sourceCount(RULE_TESTS, /^ {4}name: /gm)} rules still fires`,
  },
  {
    id: "19.summary",
    doc: REGISTER,
    section: "summary",
    model: RULE_TESTS,
    statement: () =>
      says`| ${sourceCount(RULE_TESTS, /^ {4}name: /gm)} rules, each tested |`,
  },
  {
    id: "13.set",
    doc: REGISTER,
    section: "13",
    statement: () =>
      says`The 2026-11 held-out set: ${list(holdout(), "observations").length} observations from nine papers`,
  },
  {
    id: "13.within-spread",
    doc: REGISTER,
    section: "13",
    statement: () => {
      const [within, of] = withinSpread("circuit-informed/v2");
      return says`within the flies' spread on ${within} of ${of} observations with an interval`;
    },
  },
  {
    id: "13.ablated",
    doc: REGISTER,
    section: "13",
    statement: () => {
      const [within, of] = withinSpread("circuit-informed/v2-defence");
      return says`Both gains come from one paper and one mechanism; without it, ${within} of ${of}`;
    },
  },
  {
    id: "15.criteria",
    doc: REGISTER,
    section: "15",
    statement: () => {
      const [passed, of] = criteria();
      return says`${passed} of ${of} criteria pass on both seed sets`;
    },
  },
  {
    id: "15.summary",
    doc: REGISTER,
    section: "summary",
    statement: () => {
      const [passed, of] = criteria();
      return says`| ${passed} of ${of} criteria |`;
    },
  },
  {
    id: "readme.04.connectome",
    doc: README,
    section: "04",
    statement: () => {
      const [passed, of] = criteria();
      return says`| FlyWire FAFB v783 reproduction | ${passed} / ${of} registered criteria met |`;
    },
  },
  {
    id: "readme.05.connectome",
    doc: README,
    section: "05",
    statement: () =>
      says`contains **${grouped(num(connectome(), "neurons"))} neurons** and **${grouped(num(connectome(), "synapses"))} synapses**`,
  },
  {
    id: "23.neurons",
    doc: REGISTER,
    section: "23",
    statement: () => says`496 of ${grouped(num(connectome(), "neurons"))}, reproduce`,
  },
  {
    id: "19.structures",
    doc: REGISTER,
    section: "19",
    model: MODEL,
    statement: () => says`Each of the ${STRUCTURES.length} structures and the pavements`,
  },
  {
    id: "19.ledger",
    doc: REGISTER,
    section: "19",
    model: MODEL,
    statement: () =>
      says`derives the ledger (${EVIDENCE_LEDGER.length} records, ${PUBLIC_SOURCES.length} sources)`,
  },
];
