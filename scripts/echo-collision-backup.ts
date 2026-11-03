/**
 * Which archive the collision rehearsal downloads, from a saved /v1/backup record.
 * The record is untrusted and its values reach a URL and a shell, so it goes through
 * the same parser the replay's plan uses, and only what matched is printed.
 *
 *   node scripts/run-ts.mjs scripts/echo-collision-backup.ts FILE INDIVIDUAL
 */
import { readFileSync } from "node:fs";
import { ARCHIVE, HEX64, parseBackupStatus } from "../src/bethesda/life/watch.js";

const at = process.argv.findIndex((a) => a.endsWith("echo-collision-backup.ts"));
const [file, individual] = process.argv.slice(at + 1);
if (!file || !individual) throw new Error("needs FILE INDIVIDUAL");
const { kept: backup } = parseBackupStatus(
  JSON.parse(readFileSync(file, "utf8")) as unknown,
);
if (!backup) throw new Error("no backup has been recorded");
if (backup.individual !== individual)
  throw new Error("the backup belongs to another individual");
if (!ARCHIVE.test(backup.archive) || !HEX64.test(backup.sha256))
  throw new Error("the backup record does not match its patterns");
process.stdout.write(`${backup.archive} ${backup.sha256}\n`);
