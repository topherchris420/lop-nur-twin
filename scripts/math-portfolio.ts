/** Inspect mathematical research candidates across the Vers3Dynamics portfolio.
 * No inference about applicability and no authority over experiments.
 */
import { bundledIndex } from "../src/rain/mathematics/bundled.ts";
import { MathematicalSubstrate } from "../src/rain/mathematics/substrate.ts";
import { scoutPortfolio } from "../src/rain/mathematics/portfolio.ts";

const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith("math-portfolio.ts")) + 1);
const value = (option: string) => {
  const i = args.indexOf(option);
  return i < 0 ? null : (args[i + 1] ?? null);
};
if (args.some((arg) => !["--project", "--json"].includes(arg) && arg !== value("--project"))) {
  console.error("Usage: npm run rain:math:portfolio -- [--project repository] [--json]");
  process.exit(2);
}
try {
  const substrate = MathematicalSubstrate.load(bundledIndex());
  const report = scoutPortfolio(substrate, value("--project"));
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("R.A.I.N. mathematical research scouting (candidate references only)");
    console.log("Source: " + report.provenance.repository + " @ " + report.provenance.commit);
    console.log("Index: " + report.provenance.index_sha256);
    for (const p of report.projects) {
      console.log("\n" + p.repository + "\n  Question: " + p.question);
      console.log("  Test: " + p.next_test);
      if (!p.candidates.length) console.log("  No lexical matches: do not infer a mathematical basis.");
      for (const c of p.candidates) {
        console.log("  • " + c.family + " " + c.title + " [" + c.catalogue_status + "]");
        console.log("    Shared terms: " + c.matched_terms.join(", "));
        console.log("    Catalogue: " + c.source_url);
      }
      console.log("  Scope: " + p.scope);
    }
    console.log("\nA shared word does not establish applicability; Lean is not checked by this command.");
  }
} catch (err) {
  console.error("math-portfolio: " + String(err instanceof Error ? err.message : err));
  process.exitCode = 2;
}
