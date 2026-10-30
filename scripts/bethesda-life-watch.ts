#!/usr/bin/env node
/**
 * Looks at the deployed Bethesda life as anyone may, and says whether
 * anything is wrong with it (src/bethesda/life/watch.ts says what is):
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-watch.ts --url https://HOST --individual HEX
 *        [--again-after S]
 *
 * It reads HOST's /v1/now and /v1/backup and, if anything is wrong, looks
 * once more S seconds later (default 60), so that a blip is not an alert.
 * It prints one JSON line, { ok, key, checkedUtc, problems: [{ code, detail }] },
 * where key names the kinds of problem, and exits 0 whenever it could look.
 * .github/workflows/bethesda-life-watch.yml runs it every 15 minutes.
 */
import { parseWitness, type Witness } from "../src/bethesda/life/observation.js";
import {
  assess,
  parseBackupStatus,
  problemKey,
  type BackupStatus,
  type Look,
} from "../src/bethesda/life/watch.js";

const TIMEOUT_MS = 20_000;

function options(args: string[]) {
  let url: string | undefined;
  let individual: string | undefined;
  let againAfterS = 60;
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === "--url" && value) url = value.replace(/\/+$/, "");
    else if (args[i] === "--individual" && value) individual = value;
    else if (args[i] === "--again-after" && value) againAfterS = Number(value);
    else throw new Error(`unknown or incomplete option ${args[i]}`);
    i++;
  }
  if (!url || !/^https?:\/\/[^/\s]+$/.test(url))
    throw new Error("--url needs the observer's origin, such as https://HOST");
  if (!individual || !/^[0-9a-f]{64}$/.test(individual))
    throw new Error("--individual needs the deployed individual's id (64 hex digits)");
  if (!Number.isFinite(againAfterS) || againAfterS < 0 || againAfterS > 300)
    throw new Error("--again-after needs 0 to 300 seconds");
  return { url, individual, againAfterS };
}

/** Why a fetch failed, with the cause Node hides behind "fetch failed". */
function why(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause as { code?: string; message?: string } | undefined;
  return cause ? `${e.message} (${cause.code ?? cause.message})` : e.message;
}

async function get(url: string): Promise<Response> {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", "User-Agent": "bethesda-life-watch" },
  });
}

async function witnessAt(origin: string): Promise<Look<Witness>> {
  try {
    const res = await get(`${origin}/v1/now`);
    if (!res.ok) return { ok: false, error: `/v1/now answered HTTP ${res.status}` };
    return { ok: true, value: parseWitness(await res.json()) };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

async function backupAt(origin: string): Promise<Look<BackupStatus | null>> {
  try {
    const res = await get(`${origin}/v1/backup`);
    if (res.status === 404) return { ok: true, value: null };
    if (!res.ok) return { ok: false, error: `/v1/backup answered HTTP ${res.status}` };
    return { ok: true, value: parseBackupStatus(await res.json()) };
  } catch (e) {
    return { ok: false, error: why(e) };
  }
}

const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-watch.ts"));
const { url, individual, againAfterS } = options(process.argv.slice(self + 1));
const look = async () =>
  assess({
    witness: await witnessAt(url),
    backup: await backupAt(url),
    individual,
    now: Date.now(),
  });

let problems = await look();
if (problems.length) {
  await new Promise((resolve) => setTimeout(resolve, againAfterS * 1000));
  problems = await look();
}
process.stdout.write(
  JSON.stringify({
    ok: problems.length === 0,
    key: problemKey(problems),
    checkedUtc: new Date().toISOString(),
    problems,
  }) + "\n",
);
