/**
 * The generated report: every benchmark's definition, from benchmarks.ts, beside
 * its verdict for every release and split that has records, then the numbers
 * behind each verdict. Rendered from `analysis.ts` and `originals.ts` only, so
 * it says nothing the records do not.
 */
import {
  type ADAPTATION_SUITE,
  BENCHMARKS,
  COMPARISON,
  type Estimate,
  type Verdict,
} from "./benchmarks.js";
import type { compare, ReleaseResult } from "./analysis.js";
import type { EchoMeasures, EvaMeasures } from "./originals.js";

export interface OriginalsResult {
  eva: EvaMeasures;
  echo: EchoMeasures;
  verdicts: Record<string, Verdict>;
  /** Where the inputs came from: the observation sessions and the ledger branch's commit. */
  provenance: string[];
}

export interface Report {
  suite: typeof ADAPTATION_SUITE;
  releases: ReleaseResult[];
  comparison: (ReturnType<typeof compare> & { split: string }) | null;
  originals: OriginalsResult | null;
  /** Where the records were made: commit and platform, from the records. */
  made: string[];
}

const n4 = (x: number | null) => (x === null || Number.isNaN(x) ? "—" : String(x));
const est = (e: Estimate | null) =>
  !e || e.mean === null
    ? "—"
    : e.ci95
      ? `${n4(e.mean)} [${n4(e.ci95[0])}, ${n4(e.ci95[1])}]`
      : n4(e.mean);
const VERDICT: Record<Verdict, string> = {
  pass: "**pass**",
  fail: "**fail**",
  untestable: "untestable",
  "not applicable": "n/a",
};
const sign = (s: { up: number; down: number; p: number | null }) =>
  `higher in ${s.up}, lower in ${s.down}; exact sign test p = ${s.p ?? "—"}`;

function verdictTable(r: Report): string {
  const cols = r.releases.map((x) => `${x.release} (${x.split}, n = ${x.n})`);
  const head = `| Id | Subject | Question | ${cols.join(" | ")}${r.originals ? " | Originals" : ""} |`;
  const rule = `| --- | --- | --- | ${cols.map(() => "---").join(" | ")}${r.originals ? " | ---" : ""} |`;
  const rows = BENCHMARKS.map((b) => {
    const research = b.subject === "research ECHO flies";
    const cells = r.releases.map((x) => (research ? VERDICT[x.verdicts[b.id]!] : ""));
    const orig = r.originals
      ? research
        ? ""
        : VERDICT[r.originals.verdicts[b.id] ?? "untestable"]
      : null;
    return `| ${b.id} | ${b.subject} | ${b.question} | ${cells.join(" | ")}${orig === null ? "" : ` | ${orig}`} |`;
  });
  return [head, rule, ...rows].join("\n");
}

function releaseSection(x: ReleaseResult): string {
  const m = x.measures,
    d = x.description;
  const lines = [
    `### ${x.release}, ${x.split} split (${x.n} individuals)`,
    "",
    "| Benchmark | Measure | Result | Verdict |",
    "| --- | --- | --- | --- |",
    `| B1 | preference for the fed site, own mind less erased | ${est(m.b1)} | ${VERDICT[x.verdicts.B1!]} |`,
    `| B2 | meals per life, memory less lesion | ${est(m.b2)} | ${VERDICT[x.verdicts.B2!]} |`,
    `| M1 | stale food places remembered at an epoch's end | ${est(m.m1)} | ${VERDICT[x.verdicts.M1!]} |`,
    `| C1 | individuals unchanged by a restart | ${m.c1.identical} of ${m.c1.n} | ${VERDICT[x.verdicts.C1!]} |`,
    `| C2 | individuals whose update kept everything | ${m.c2 ? `${m.c2.kept} of ${m.c2.n}` : "—"} | ${VERDICT[x.verdicts.C2!]} |`,
    `| C3 | later meals, updated less not updated | ${est(m.c3)} | ${VERDICT[x.verdicts.C3!]} |`,
    `| C4 | twins that were someone else | ${m.c4.someoneElse} of ${m.c4.n} | ${VERDICT[x.verdicts.C4!]} |`,
    "",
    `B1: ${sign(d.b1Sign)}. B2: ${sign(d.b2Sign)}.`,
    "",
    "| Study B, per individual | with memory | with the lesion |",
    "| --- | --- | --- |",
    `| meals per life | ${est(d.memory.mealsPerLife)} | ${est(d.lesion.mealsPerLife)} |`,
    `| epochs without a meal (of 8) | ${est(d.memory.epochsWithoutMeal)} | ${est(d.lesion.epochsWithoutMeal)} |`,
    `| arrivals at the site the food just left, per move | ${est(d.memory.staleArrivalsPerMove)} | ${est(d.lesion.staleArrivalsPerMove)} |`,
    `| stale food places remembered at an epoch's end | ${est(d.memory.staleRemembered)} | ${est(d.lesion.staleRemembered)} |`,
    "",
    `| By epoch, mean over individuals | ${d.memory.mealsByEpoch.map((_, i) => i + 1).join(" | ")} |`,
    `| --- | ${d.memory.mealsByEpoch.map(() => "---").join(" | ")} |`,
    `| meals, memory | ${d.memory.mealsByEpoch.join(" | ")} |`,
    `| meals, lesion | ${d.lesion.mealsByEpoch.join(" | ")} |`,
    `| stale places remembered, memory | ${d.memory.staleByEpoch.join(" | ")} |`,
    "",
    `Study A: ${est(d.trainingMeals)} meals in training; preference for the fed site, own mind ${est(d.preference.self)}, erased ${est(d.preference.erased)}, after a restart ${est(d.preference.restored)}.`,
  ];
  return lines.join("\n");
}

function originalsSection(o: OriginalsResult): string {
  const e = o.eva,
    c = o.echo,
    ed = e.description,
    cd = c.description;
  const pair = <T>(p: [T, T] | null | undefined) =>
    p ? `${String(p[0])} → ${String(p[1])}` : "—";
  return [
    "## The originals",
    "",
    ...o.provenance.map((p) => `- ${p}`),
    "",
    "### Eva",
    "",
    `- E1 **${o.verdicts.E1}**: ${e.states} states on ${e.dates.join(", ")} (${e.refused} refused); life ids ${e.lifeIds.join(", ")}; births ${e.bornAts.join(", ")}; clock contract broken on ${e.clockBreaks} states; ticks fell ${e.ticksFell} times.`,
    "- E2 and E3 **untestable** from here: her controller is not in this repository, nothing may be done to her, and her witness reports no version, restart or checkpoint.",
    ed
      ? `- Listed, not judged (first → last): trials ${pair(ed.trials)}; journeys ${pair(ed.journeys)}; moments ${pair(ed.moments)}; prediction error ${pair(ed.predictionError)}; surprises ${pair(ed.surprises)}; flight samples ${pair(ed.flySamples)}; estimated walking speed ${pair(ed.walkSpeed)}; her clock ran ${ed.clockRate === null ? "—" : ed.clockRate.toFixed(5)} s per server second between them.`
      : "- No state to describe.",
    "",
    "### ECHO, the original",
    "",
    `- O1 **${o.verdicts.O1}**: ${c.states} observations on ${c.dates.join(", ")} (${c.refused} refused or without an observation); individuals ${c.individuals.join(", ")}; lease epoch ${pair(c.epochs)}; engine versions ${c.versions && c.versions[0] === c.versions[1] ? "unchanged" : pair(c.versions)}; clock contract broken on ${c.clockBreaks}. Ledger: ${c.ledger.lines} lines, individuals ${c.ledger.individuals.join(", ")}, ${c.ledger.notRising} not rising, from checkpoint ${c.ledger.first?.checkpoint ?? "—"} (${c.ledger.first?.seenUtc ?? "—"}) to ${c.ledger.last?.checkpoint ?? "—"} (${c.ledger.last?.seenUtc ?? "—"}).`,
    `- O2 **${o.verdicts.O2}**: ${c.replays.lines} replay verdicts, ${c.replays.sealed} from a release whose seals must reproduce, ${c.replays.sealedPassed} of them passed.`,
    ...c.replays.sealedVerdicts.map(
      (v) =>
        `  - ${v.seenUtc}: from checkpoint ${v.from ?? "—"}, ${v.passed ? "passed" : `failed: ${v.differs ?? "no reason recorded"}`}`,
    ),
    "- O3 **untestable** on the original: no experiment may be run on it. The research flies stand in for its configuration.",
    cd
      ? `- Listed, not judged (first → last): meals ${pair(cd.meals)}; escapes ${pair(cd.escapes)}; its clock ran ${cd.clockRate === null ? "—" : cd.clockRate.toFixed(5)} simulated s per UTC s between them (below 1 when it paused for checkpoints and restarts, which are gaps, not catch-up).`
      : "- No observation to describe.",
  ].join("\n");
}

export function renderReadme(r: Report, commit: string): string {
  const defs = BENCHMARKS.map(
    (b) =>
      `- **${b.id}** (${b.family}, ${b.subject}). ${b.question} _Measure:_ ${b.measure} _Passes:_ ${b.passes}`,
  );
  return [
    "# ECHO and Eva: adaptation across updates and restarts",
    "",
    `Generated by \`node scripts/run-ts.mjs scripts/echo-adaptation-evaluate.ts report\` from ${commit}; \`report --check\` reproduces it byte for byte from the records in this folder. Never edit this folder by hand. The design, the splits and what this can and cannot show are in [docs/ECHO_ADAPTATION_CONTINUITY.md](../../ECHO_ADAPTATION_CONTINUITY.md).`,
    "",
    `${r.suite}. Research flies are seeded subjects in the deployed ECHO configuration, never the original; intervals are 95% bootstrap intervals over individuals and say nothing about a population of flies. ${r.made.join(" ")}`,
    "",
    "## Verdicts",
    "",
    verdictTable(r),
    "",
    ...(r.comparison
      ? [
          "## The improvement against the baseline",
          "",
          `${COMPARISON.split} split, paired by individual. Meals per life with memory, improved less baseline: ${est(r.comparison.primary)}; ${sign(r.comparison.sign)}. Shown only if the lower bound is above 0, and only if ${COMPARISON.guards.join(", ")} pass on the improved release.`,
          "",
        ]
      : []),
    "## Research flies",
    "",
    ...r.releases.flatMap((x) => [releaseSection(x), ""]),
    ...(r.originals ? [originalsSection(r.originals), ""] : []),
    "## The benchmarks, as fixed",
    "",
    ...defs,
    "",
  ].join("\n");
}
