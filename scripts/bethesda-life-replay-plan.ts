#!/usr/bin/env node
/**
 * The replay workflow's first step (src/bethesda/life/replayPlan.ts says why it is
 * not shell). It prints the plan's lines for `$GITHUB_OUTPUT` on stdout, and its
 * reason on stderr; a refusal also writes the failed verdict to --verdict.
 *
 *   node scripts/run-ts.mjs scripts/bethesda-life-replay-plan.ts --url https://HOST \
 *        --individual HEX --replays replays.jsonl --max 300 --verdict verdict.json
 *
 * An unreachable VM is not a finding (the watcher reports that): it exits 0 with
 * the action `wait`, as it does when there is nothing new to judge.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import {
  planOutputs,
  planReplay,
  type ReplayPlan,
} from "../src/bethesda/life/replayPlan.js";

const o: Record<string, string> = {};
const args = process.argv.slice(
  process.argv.findIndex((a) => a.endsWith("bethesda-life-replay-plan.ts")) + 1,
);
for (let i = 0; i < args.length; i += 2) o[args[i]!.slice(2)] = args[i + 1]!;
for (const need of ["url", "individual", "replays", "max", "verdict"])
  if (!o[need]) throw new Error(`--${need} is required`);

async function plan(): Promise<ReplayPlan> {
  let backup: unknown;
  try {
    const res = await fetch(`${o.url}/v1/backup`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json", "User-Agent": "bethesda-life-replay" },
    });
    if (res.status === 404) backup = null;
    else if (!res.ok)
      return { action: "wait", why: `/v1/backup answered HTTP ${res.status}` };
    else {
      const text = await res.text();
      try {
        backup = JSON.parse(text);
      } catch {
        return { action: "refuse", why: "/v1/backup is not JSON" };
      }
    }
  } catch (e) {
    return { action: "wait", why: `/v1/backup: ${(e as Error).message}` };
  }
  return planReplay({
    backup,
    individual: o.individual!,
    replays: existsSync(o.replays!) ? readFileSync(o.replays!, "utf8") : "",
    maxCheckpoints: Number(o.max),
  });
}

const chosen = await plan();
if (chosen.action !== "replay") {
  // Text from the machine, on its way to a public record and an issue.
  const why = chosen.why.replace(/[@<>`\r\n]/g, "").slice(0, 300);
  process.stderr.write(`${why}\n`);
  if (chosen.action === "refuse")
    writeFileSync(
      o.verdict!,
      JSON.stringify({
        schema: "bethesda-life-replay/v1",
        passed: false,
        reason: why,
        individual: o.individual,
        versions: null,
        machine: null,
        from: null,
        to: null,
        head: null,
        reproduced: 0,
        ticks: 0,
        seals: null,
        graphs: 0,
        ledger: null,
        difference: null,
        stopped: null,
      }) + "\n",
    );
}
process.stdout.write(planOutputs(chosen).join("\n") + "\n");
