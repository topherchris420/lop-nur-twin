#!/usr/bin/env node
/**
 * The deployed Bethesda life's public ledger (src/bethesda/life/ledger.ts):
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts append --url https://HOST \
 *        --individual HEX --dir LEDGER_CHECKOUT
 *   node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts verify --store STORE \
 *        --ledger ledger.jsonl
 *
 * append reads HOST's /v1/backup and appends the newest verified checkpoint to
 * LEDGER_CHECKOUT/ledger.jsonl unless it is already the last line, writing the
 * branch's README and vercel.json when they are missing. It prints one JSON
 * line, { appended, anchor?, reason? }, and exits 0 whenever it could decide;
 * .github/workflows/bethesda-life-watch.yml commits and pushes what it wrote.
 *
 * verify opens STORE (an unpacked archive: it checks the whole chain first,
 * and changes nothing) and judges every anchor against it. It prints each
 * anchor that is not confirmed and a summary, and exits 1 if any is
 * contradicted.
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  anchorLine,
  judgeAnchors,
  LEDGER_FILE,
  LEDGER_README,
  LEDGER_VERCEL,
  nextAnchor,
  parseLedger,
} from "../src/bethesda/life/ledger.js";
import { parseBackupStatus, type BackupStatus } from "../src/bethesda/life/watch.js";

const TIMEOUT_MS = 20_000;

function options(args: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const [flag, value] = [args[i], args[i + 1]];
    if (!flag?.startsWith("--") || !value) throw new Error(`incomplete option ${flag}`);
    o[flag.slice(2)] = value;
  }
  return o;
}

const say = (o: object): void => {
  process.stdout.write(JSON.stringify(o) + "\n");
};

async function append(o: Record<string, string>): Promise<void> {
  const url = o.url?.replace(/\/+$/, "");
  if (!url || !/^https?:\/\/[^/\s]+$/.test(url))
    throw new Error("--url needs the observer's origin, such as https://HOST");
  if (!o.individual || !/^[0-9a-f]{64}$/.test(o.individual))
    throw new Error("--individual needs the deployed individual's id (64 hex digits)");
  if (!o.dir) throw new Error("--dir needs the ledger branch's checkout");
  const file = join(o.dir, LEDGER_FILE);
  // A ledger that does not parse stops here, before anything is added to it.
  const ledger = existsSync(file) ? parseLedger(readFileSync(file, "utf8")) : [];

  let backup: BackupStatus | null;
  try {
    const res = await fetch(`${url}/v1/backup`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json", "User-Agent": "bethesda-life-ledger" },
    });
    if (res.status === 404) backup = null;
    else if (!res.ok)
      return say({ appended: false, reason: `/v1/backup answered HTTP ${res.status}` });
    else backup = parseBackupStatus(await res.json());
  } catch (e) {
    // The watcher reports an unreadable record; the ledger just waits for the next run.
    return say({ appended: false, reason: (e as Error).message });
  }

  const anchor = nextAnchor({
    backup,
    individual: o.individual,
    ledger,
    seenUtc: new Date().toISOString(),
  });
  if (!anchor)
    return say({
      appended: false,
      reason: backup?.kept?.digest
        ? "the newest verified checkpoint is already the last anchor"
        : "the backup record carries no verified checkpoint's digest yet",
    });
  for (const [name, text] of [
    ["README.md", LEDGER_README],
    ["vercel.json", LEDGER_VERCEL],
  ] as const)
    if (!existsSync(join(o.dir, name))) writeFileSync(join(o.dir, name), text);
  appendFileSync(file, anchorLine(anchor));
  say({ appended: true, anchor });
}

async function verify(o: Record<string, string>): Promise<void> {
  if (!o.store || !o.ledger) throw new Error("verify needs --store and --ledger");
  const anchors = parseLedger(readFileSync(o.ledger, "utf8"));
  // Only verify needs the life itself (and so the installed dependencies).
  const { LifeStore } = await import("../src/bethesda/life/store.js");
  const { bethesdaStoreKind } = await import("../src/bethesda/life/bethesdaStore.js");
  const store = LifeStore.open(o.store, bethesdaStoreKind(o.store));
  const head = store.headRecord().checkpoint;
  const judged = judgeAnchors(anchors, {
    individual: head.birth.individual,
    head: head.sequence,
    digestAt: (sequence) => store.checkpointAt(sequence).digest,
  });
  const count = { confirmed: 0, contradicted: 0, ahead: 0 };
  for (const { anchor, verdict } of judged) {
    count[verdict]++;
    if (verdict !== "confirmed") say({ verdict, ...anchor });
  }
  say({
    store: { individual: head.birth.individual, head: head.sequence },
    anchors: count,
  });
  if (count.contradicted) process.exitCode = 1;
}

const self = process.argv.findIndex((a) => a.endsWith("bethesda-life-ledger.ts"));
const [mode, ...rest] = process.argv.slice(self + 1);
if (mode === "append") await append(options(rest));
else if (mode === "verify") await verify(options(rest));
else throw new Error("usage: bethesda-life-ledger.ts append|verify --option value ...");
