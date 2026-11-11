/**
 * Holds the claims register and the README to the committed records.
 *
 *   node scripts/run-ts.mjs scripts/claim-bindings.ts           check every binding and print coverage
 *   node scripts/run-ts.mjs scripts/claim-bindings.ts --write   also write docs/claims/
 *   node scripts/run-ts.mjs scripts/claim-bindings.ts --check   exit 1 unless docs/claims/ is what it would write
 *
 * See scripts/claims/check.ts for what a binding is and docs/claims/README.md
 * for what is bound.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { BINDINGS, NOT_RECOMPUTED } from "./claims/bindings.js";
import { check, reportJson } from "./claims/check.js";
import { PROFILES } from "./claims/documents.js";
import { renderReport, REPORT_JSON, REPORT_MD } from "./claims/report.js";

const args = new Set(process.argv.slice(2));
const report = check(BINDINGS, PROFILES);

const failed = report.results.filter((r) => !r.ok);
for (const d of report.documents) {
  console.log(`${d.name}: ${d.recomputed} of ${d.quantities} quantities recomputed`);
  for (const s of d.sections)
    if (s.quantities > 0)
      console.log(
        `  ${s.key.padStart(7)}  ${String(s.recomputed).padStart(3)} / ${String(s.quantities).padEnd(3)}  ${s.title.slice(0, 70)}`,
      );
}
console.log(
  `${report.results.length - failed.length} of ${report.results.length} bindings hold`,
);
for (const r of failed) console.error(`FAILED ${r.id}: ${r.problem}`);
if (failed.length > 0) process.exit(1);

const files: [string, string][] = [
  [REPORT_MD, renderReport(report, NOT_RECOMPUTED)],
  [REPORT_JSON, reportJson(report)],
];
if (args.has("--write"))
  for (const [path, text] of files) {
    mkdirSync(dirname(join(process.cwd(), path)), { recursive: true });
    writeFileSync(join(process.cwd(), path), text);
    console.log(`wrote ${path}`);
  }
if (args.has("--check")) {
  const stale = files.filter(
    ([path, text]) =>
      !existsSync(join(process.cwd(), path)) ||
      readFileSync(join(process.cwd(), path), "utf8") !== text,
  );
  for (const [path] of stale)
    console.error(
      `${path} is not what the bindings give; run with --write and commit it`,
    );
  if (stale.length > 0) process.exit(1);
  console.log("docs/claims/ follows from the bindings");
}
