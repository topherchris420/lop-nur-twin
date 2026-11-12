/**
 * Exploratory: Eva-kind and ECHO-kind research subjects living together in
 * Eva's garden (`gardenEncounter.ts`). One pair per worker; each pair is
 * deterministic. Writes each pair's record (with its recorded frames) to
 * `--out` (default: a new folder under the OS temp directory) and prints a summary.
 * Nothing here reaches either original.
 *
 *   node --experimental-transform-types scripts/run-ts.mjs scripts/first-contact-garden.ts --pairs 4 --hours 12
 *
 * (The exhibit's staging uses TypeScript parameter properties, which Node's
 * default type stripping does not accept; hence the flag.)
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import type { GardenEncounterRecord } from "../src/bethesda/firstContact/commons/gardenEncounter.js";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const pairs = Number(value("--pairs") ?? 4);
const first = Number(value("--first") ?? 0);
const hours = Number(value("--hours") ?? 12);
// Without --out, a new private folder (mkdtemp), never a fixed name another user could prepare.
const named = value("--out");
refuseProductionHost(named ?? tmpdir(), existsSync);
const out = named ?? mkdtempSync(join(tmpdir(), "first-contact-garden-"));
if (named !== undefined) mkdirSync(out, { recursive: true });
const t0 = performance.now();
const records = await Promise.all(
  Array.from(
    { length: pairs },
    (_, i) =>
      new Promise<GardenEncounterRecord>((resolve, reject) => {
        const w = new Worker(
          new URL("./first-contact-garden-worker.mjs", import.meta.url),
          {
            workerData: { pair: first + i, hours },
          },
        );
        w.on("message", (m: { record: GardenEncounterRecord }) => resolve(m.record));
        w.on("error", reject);
      }),
  ),
);
for (const r of records) {
  writeFileSync(join(out, `pair-${r.pair}.json`), JSON.stringify(r));
  const near = r.echoOnsets.map(
    (x) =>
      `${(x.t / 60).toFixed(1)}m:${x.mode}:${x.novelty ?? "-"}${x.walkedAway ? ":walked" : ""}${x.alerted ? ":alert" : ""}`,
  );
  console.log(
    `pair ${r.pair}: closest ${r.closestMm.toFixed(1)} mm; contacts ${r.contacts.length}; eva stops ${r.eva.stops}, mismatches ${r.eva.mismatches}, perceived ${r.eva.perceivedSteps} steps, track ${r.eva.track ? `${r.eva.track.samples} samples, external ${r.eva.track.external_motion.toExponential(2)}${r.eva.independent ? " (independent)" : ""}` : "none"}; eva journeys ${r.eva.journeys}; echo meals ${r.echo.meals}, flights ${r.echo.flights}, escapes ${r.echo.escapes}, reserve ${r.echo.reserveAtEnd}\n   onsets: ${near.slice(0, 30).join(" ")}`,
  );
}
console.log(`${((performance.now() - t0) / 60000).toFixed(1)} min; records in ${out}`);
