/**
 * Renders docs/benchmarks/first-contact/README.md from the results the
 * evaluation script wrote. Every number comes from a result file; nothing
 * here is typed by hand.
 */
import type { EncounterResult } from "./encounterStudy.js";
import type { Interval } from "./stats.js";
import { GROUPS, type RecognitionResult } from "./recognition.js";

export interface RunStamp {
  /** The commit the result ran from, or "a working tree" (not a result). */
  ranFrom: string;
  platform: string;
}

const fmt = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined ? "—" : x.toFixed(d);
const ci = (x: Interval | null, d = 3) =>
  x ? `${fmt(x.estimate, d)} [${fmt(x.low, d)}, ${fmt(x.high, d)}]` : "—";

function encounterSection(e: EncounterResult & RunStamp): string {
  const row = (name: string, c: EncounterResult["conditions"]["live"]) =>
    `| ${name} | ${c.subjects} | ${fmt(c.escapes.mean, 2)} | ${ci(c.escapes.any)} | ${fmt(c.sawOther.mean, 1)} | ${fmt(c.sawOther.share, 2)} | ${fmt(c.escapesNear, 2)} | ${fmt(c.nearS, 2)} | ${fmt(c.closestMM, 1)} |`;
  return [
    `## Stage 2: controlled encounters (\`${e.protocol.id}\`)`,
    "",
    `Protocol SHA-256 \`${e.protocol.sha256}\`; ran from ${e.ranFrom} on ${e.platform}. Result digest \`${e.digest}\`.`,
    "",
    `${e.synchronizedSessions} of ${e.sessions.length} sessions stayed synchronized throughout; ${e.bridgeClosedEarly} bridges closed before their session ended. At contact the two subjects' own clocks read ${fmt(e.clocks.atContact[0], 2)} s and ${fmt(e.clocks.atContact[1], 2)} s (offset ${fmt(e.clocks.offsetS, 2)} s); the encounter clock kept them on one timeline.`,
    "",
    "| Condition | Subjects | Escapes (mean) | Escaped at least once, 95% CI | Decisions that saw the other (mean) | Sessions that saw it | Escapes while it was within 3 cm (mean) | Time within 3 cm (s) | Closest approach (mm, mean) |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    row("live A (bridged both ways)", e.conditions.live),
    row("live B (its partner)", e.partner),
    row("yoked C (B's recording)", e.conditions.yoked),
    row("solitary D (bridge closed)", e.conditions.solitary),
    "",
    "| Hypothesis | Difference | Escaped at least once, difference 95% CI | Mean escapes, difference 95% CI | Verdict |",
    "| --- | --- | --- | --- | --- |",
    ...e.contrasts.map(
      (c) =>
        `| ${c.id} | ${c.difference} | ${ci(c.anyEscape)} | ${ci(c.meanEscapes)} | ${c.verdict} |`,
    ),
    "",
  ].join("\n");
}

function recognitionSection(x: RecognitionResult & RunStamp): string {
  const lines = [
    `## Stage 3: repeated encounters, ${x.phase} seeds (\`${x.protocol.id}\`)`,
    "",
    `Protocol SHA-256 \`${x.protocol.sha256}\`; ran from ${x.ranFrom} on ${x.platform}. Result digest \`${x.digest}\`.`,
    "",
    "Partners (stretches of steady flight cut by the protocol's criteria; a partner with fewer than the series needs is not used): " +
      x.partners
        .map(
          (p) =>
            `\`${p.id}\` ${p.stretches} (mean pass speed ${fmt(p.meanPassSpeedMS, 2)} m/s)`,
        )
        .join(", ") +
      ".",
    "",
  ];
  for (const a of x.arms) {
    lines.push(`### Arm: ${a.arm}`, "");
    if (a.approximations.length)
      lines.push(`Approximations: ${a.approximations.join("; ")}.`, "");
    lines.push(
      "| Group | Assigned | Tested | Skipped | Escaped | P(escape), 95% CI | Saw the partner | Responsiveness at test (mean) | Test pass speed (m/s) | Self-model episodes added (mean) |",
      "| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |",
      ...GROUPS.map((g) => {
        const s = a.groups[g];
        return `| ${g} | ${s.assigned} | ${s.tested} | ${s.skipped} | ${s.escaped} | ${ci(s.escape)} | ${fmt(s.seenShare, 2)} | ${fmt(s.responsivenessAtTest, 3)} | ${fmt(s.testPassSpeedMS, 3)} | ${fmt(s.selfModelEpisodesAdded, 2)} |`;
      }),
      "",
      `Habituation series (all groups but naive): ${a.habituationCurve.map((c) => `${c.index}: ${c.escaped}/${c.tested}`).join(", ")}.`,
      "",
      `Manipulation check: ${a.manipulation.passed ? "passed" : "failed"} (share of tests in which the partner was seen: ${a.manipulation.detail}). Stretch balance, familiar − stranger pass speed: ${ci(a.balance.familiarMinusStrangerMS, 4)} m/s, ${a.balance.passed ? "within" : "outside"} the criterion.`,
      "",
      "| Hypothesis | Difference | Estimate, 95% Newcombe CI | Fisher exact p | Verdict | Within ±margin |",
      "| --- | --- | --- | ---: | --- | --- |",
      ...a.contrasts.map(
        (c) =>
          `| ${c.id} | ${c.difference} | ${ci(c.estimate)} | ${fmt(c.fisherP, 4)} | ${c.verdict} | ${c.withinMargin ? "yes" : "no"} |`,
      ),
      "",
    );
  }
  return lines.join("\n");
}

export function renderFirstContactReadme(results: {
  encounter: (EncounterResult & RunStamp) | null;
  recognition: (RecognitionResult & RunStamp)[];
}): string {
  const parts = [
    "# First contact: results",
    "",
    "Generated by `node scripts/run-ts.mjs scripts/first-contact-evaluate.ts`; never edit this folder by hand. Methods, limits and what these results do and do not show: [docs/FIRST_CONTACT.md](../../FIRST_CONTACT.md).",
    "",
    "Every subject here is a **research subject**: a new fly built from a seed in an arena of its own. None is Eva or ECHO, a copy of either, or a continuation of either. These are seeded studies with protocols frozen before their runs (their SHA-256 is printed with each), not registered R.A.I.N. experiments. A result that ran from a working tree is not a result.",
    "",
    "Licence: these results are derived from this repository's own simulation code and carry its licence (Apache-2.0). The fly's body measurements come from FlyBody (see NOTICE).",
    "",
  ];
  if (results.encounter) parts.push(encounterSection(results.encounter));
  for (const x of results.recognition) parts.push(recognitionSection(x));
  if (!results.encounter && !results.recognition.length)
    parts.push("No results yet.", "");
  return parts.join("\n");
}
