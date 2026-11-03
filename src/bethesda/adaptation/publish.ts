/**
 * The published results folder, read back into a report: the records of every
 * split and release, and the originals' snapshots. Shared by the script that
 * writes the report and the test that checks it still follows from the files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkRecords, compare, releaseResult } from "./analysis.js";
import { ADAPTATION_SUITE, COMPARISON, INDIVIDUALS } from "./benchmarks.js";
import {
  judgeOriginals,
  measureEcho,
  measureEva,
  type RecordedResponse,
} from "./originals.js";
import { RELEASES } from "./releases.js";
import type { Report } from "./report.js";
import type { IndividualRecord } from "./study.js";

export const RESULTS_DIR = "docs/benchmarks/echo-adaptation";

/** A record as the script writes it: what it ran on, beside what it found. */
export type MadeRecord = IndividualRecord & {
  made: { commit: string; node: string; platform: string; arch: string };
};

export const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

/** The report the folder's files say, and nothing else. */
export function buildReport(dir: string): Report {
  const records = join(dir, "records"),
    originals = join(dir, "originals");
  const sets = existsSync(records)
    ? readdirSync(records)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => readJsonl<MadeRecord>(join(records, f)))
    : [];
  const find = (split: string, release: string) =>
    sets.find((s) => s[0]?.split === split && s[0]?.release === release) ?? null;
  // Development before held-out; within a split, the baseline before its updates.
  const order = (s: MadeRecord[]) =>
    `${s[0]!.split === "dev" ? 0 : 1}${s[0]!.release === "baseline" ? 0 : 1}${s[0]!.release}`;
  sets.sort((a, b) => order(a).localeCompare(order(b)));
  const releases = sets.map((s) => {
    const errors = checkRecords(s, INDIVIDUALS);
    if (errors.length) throw new Error(errors.join("; "));
    const from = RELEASES[s[0]!.release]?.updates?.from;
    return releaseResult(s, from ? find(s[0]!.split, from) : null);
  });
  const improved = sets.find(
    (s) => s[0]!.split === COMPARISON.split && s[0]!.release !== "baseline",
  );
  const base = improved ? find(COMPARISON.split, "baseline") : null;
  let originalsResult: Report["originals"] = null;
  if (existsSync(join(originals, "responses.jsonl"))) {
    const input = {
      responses: readJsonl<RecordedResponse>(join(originals, "responses.jsonl")),
      ledger: readFileSync(join(originals, "ledger.jsonl"), "utf8"),
      replays: readFileSync(join(originals, "replays.jsonl"), "utf8"),
    };
    const eva = measureEva(input),
      echo = measureEcho(input);
    originalsResult = {
      eva,
      echo,
      verdicts: judgeOriginals(eva, echo),
      provenance: Object.values(
        JSON.parse(readFileSync(join(originals, "provenance.json"), "utf8")) as Record<
          string,
          string
        >,
      ),
    };
  }
  const made = [
    ...new Set(
      sets.map((s) => {
        const m = s[0]!.made;
        const at =
          m.commit === "a working tree"
            ? "a working tree (not a result)"
            : `\`${m.commit.slice(0, 12)}\``;
        return `The ${s[0]!.split} ${s[0]!.release} flies ran on ${at}, ${m.platform} ${m.arch}, Node ${m.node}.`;
      }),
    ),
  ];
  return {
    suite: ADAPTATION_SUITE,
    releases,
    comparison:
      improved && base ? { ...compare(improved, base), split: COMPARISON.split } : null,
    originals: originalsResult,
    made,
  };
}

/** The commit a published README says it was written from. */
export function publishedCommit(dir: string): string {
  const path = join(dir, "README.md");
  return existsSync(path)
    ? (/from (`[0-9a-f]{7,40}`|a working tree)/.exec(readFileSync(path, "utf8"))?.[1] ??
        "")
    : "";
}
