/**
 * The seal of the 2026-11 held-out set: a digest of every registered
 * observation (its value, spread, words and source) and of every paradigm's
 * description, written once by `scripts/fly-calibration.ts --seal` to
 * `docs/benchmarks/fly-calibration/holdout-2026-11.json` and never rewritten.
 * A test holds `holdout.ts` to it, so a registered value, quote or paradigm
 * cannot change after the seal without the change showing.
 *
 * The seal also records sha256 digests of circuit-informed/v2's own sources
 * as they were when the set was sealed, so the report can say whether the v2
 * it scores is the sealed one.
 */
import { createHash } from "node:crypto";
import { HOLDOUT_EXCLUDED, HOLDOUT_OBSERVATIONS, HOLDOUT_PARADIGMS } from "./holdout.js";

/** JSON with every object's keys sorted, so a digest does not depend on key order. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x !== null && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** A source file's digest, with line endings normalized (a Windows checkout writes CRLF). */
export const sourceDigest = (text: string) => sha256(text.replace(/\r\n/g, "\n"));

/**
 * The metrics and acceptance rules, declared in the seal before any held-out
 * result exists (docs/FLY_PRIORITIES.md, priority 4). The README's held-out
 * summary computes exactly these.
 */
export const HOLDOUT_ACCEPTANCE = [
  "Primary metric: per controller, the number of held-out observations with a published interval on which its estimate is inside the published 95% interval or within the flies' spread (the comparison's own verdicts, compare.ts), out of those observations.",
  "circuit-informed/v2 is said to generalize better than circuit-informed/v1 on this set only if its primary count is higher than v1's; equal or lower counts are reported as no improvement.",
  "Secondary metric, for held-out observations with no published interval: the median over them of the absolute relative error |simulated − published| / |published|; an observation a controller does not produce counts as an error of 1 in that median.",
  "No claim is made for v2 from development, fit or design rows. An ablation is described by the held-out verdicts that change when its mechanism is off, not as a test of a controller built without it.",
  "Every held-out row is reported, including those v2 does not produce and those on which it does worse than v1.",
] as const;

/** circuit-informed/v2's own sources, whose digests the seal records. */
export const V2_SOURCES = [
  "src/bethesda/fly/circuits/v2/controller.ts",
  "src/bethesda/fly/circuits/v2/params.ts",
  "src/bethesda/fly/calibration/fitV2.ts",
] as const;

export function sealEntries() {
  return {
    observations: HOLDOUT_OBSERVATIONS.map((o) => ({
      id: o.id,
      paradigm: o.paradigm,
      value: o.value,
      unit: o.unit,
      spread: o.spread,
      n: o.n,
      sha256: sha256(canonical(o)),
    })),
    paradigms: Object.fromEntries(
      Object.entries(HOLDOUT_PARADIGMS).map(([id, p]) => [id, sha256(canonical(p))]),
    ),
    excluded: HOLDOUT_EXCLUDED.map((x) => ({ ...x })),
  };
}
