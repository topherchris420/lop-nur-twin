/**
 * Every binding: the sentences of the claims register, the README and the
 * studies' own pages that are rebuilt from committed records.
 *
 * To bind a sentence, quote its words in a `says` template and compute each
 * number from the record that holds it (see `bound/collision.ts`). To change
 * a number in a document, change it here by changing what the records say:
 * there is no place to type the new value.
 */
import type { Binding } from "./check.js";
import { collision } from "./bound/collision.js";
import { coverage } from "./bound/coverage.js";
import { echo } from "./bound/echo.js";
import { genesis } from "./bound/genesis.js";
import { metrology } from "./bound/metrology.js";
import { research } from "./bound/research.js";

const RECORDS: readonly Binding[] = [
  ...collision,
  ...echo,
  ...metrology,
  ...genesis,
  ...research,
];

export const BINDINGS: readonly Binding[] = [...RECORDS, ...coverage(RECORDS)];

/**
 * Register entries no binding reaches, and why not. An entry is either bound
 * or explained here; `claims.test.ts` fails on one that is neither, and on an
 * explanation left behind once its entry is bound.
 *
 * Two kinds of reason: the evidence is not in this tree, so nothing here could
 * read it; or nobody has written the binding yet, and the reason names the
 * record to start from.
 */
export const NOT_RECOMPUTED: Readonly<Record<string, string>> = {
  "1": "Its record, `replays.jsonl`, is on the `live-fly-ledger` branch, which this tree does not contain; a check here could not read it without the network.",
  "2": "Its evidence is the deployed individual's own checkpoint chain, which is not in this repository, and the era table that describes it.",
  "4": "The exit's tick and checkpoint are quoted from the deployed individual's checkpoint 2,563, which no file here holds. The figure drawn from the recorded positions is held to them by `scripts/echo-exit-figure.test.ts`.",
  "10": "Not bound yet. Its record is `docs/benchmarks/fly-mushroom-body/report.json`.",
  "11": "Not bound yet. Its records are in `docs/benchmarks/echo-acquired/2026-11-02/`.",
  "12": "Not bound yet. Its records are in `docs/benchmarks/echo-ranging/2026-11-03/`.",
  "14": "Not bound yet. Its records are the traces in `docs/benchmarks/fly-physics/`.",
  "16": "Not bound yet. Its six results are spread over `docs/benchmarks/fly-neural/` and its `adaptive/` and `banc/` folders.",
  "17": "Not bound yet. Its records are `docs/benchmarks/first-contact/encounter.json` and `recognition-held-out.json`.",
  "18": "Not bound yet. Its records are in `docs/rea-research/evaluations/gemma-live/` and `docs/benchmarks/noeterra-civilization/`.",
  "21": "Not bound yet. Its records are in `docs/benchmarks/ecology/`; the entry's three quantities count tests and days.",
};
