// Holds cutover step 3's --check (check.log) against step 2's backup check
// (backup.log): the deployed individual and its genesis, the backup's head
// and tick, the graph kept byte for byte, both checks run, nothing committed.
//   node compare-step3.mjs backup.log check.log
import { readFileSync } from "node:fs";

const INDIVIDUAL = "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921";
const GENESIS = "e42d5e2cad81af6689136ae78f1ba366a420a850620f3710e499913f9ac50d4a";

const fail = (why) => {
  console.log(`step 3: FAIL  ${why}`);
  process.exit(1);
};
const [backupLog, checkLog] = process.argv.slice(2).map((f) => readFileSync(f, "utf8"));
const head = backupLog.match(/^individual ([0-9a-f]{64}), checkpoint (\d+), tick (\d+)\r?$/m);
if (!head) fail("no checked head in the backup log");
const line = checkLog.split(/\r?\n/).find((l) => l.startsWith('{"mode":"--check"'));
if (!line) fail("no --check result in the check log");

const [, individual, checkpoint, tick] = head;
const r = JSON.parse(line);
const expect = [
  ["the deployed individual, in both checks", individual === INDIVIDUAL && r.individual === INDIVIDUAL],
  ["its genesis", r.genesisDigest === GENESIS],
  [
    `the backup's head, checkpoint ${checkpoint}`,
    r.previousSequence === Number(checkpoint) && r.sequence === Number(checkpoint) + 1,
  ],
  [`the head's tick, ${tick}`, r.tick === Number(tick)],
  [
    "preservedGraphDigest equal to sourceGraphDigest",
    /^[0-9a-f]{64}$/.test(r.sourceGraphDigest) && r.preservedGraphDigest === r.sourceGraphDigest,
  ],
  ["the same-engine check, 600 ticks", r.sameEngineTicks === 600],
  ["the restore check, 611 ticks", r.recoveryTicks === 611],
  [
    "ECHO v3, continued as the organism",
    r.versions?.echo === "echo-self-model/v3" && r.versions?.organism === "bethesda-echo-organism/v1",
  ],
  ["nothing committed", r.mode === "--check" && r.committedUtc === null],
];
for (const [what, ok] of expect) console.log(`step 3: ${ok ? "pass" : "FAIL"}  ${what}`);
process.exit(expect.every(([, ok]) => ok) ? 0 : 1);
