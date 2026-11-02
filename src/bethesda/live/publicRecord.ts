/**
 * What anyone else has on record about the one living fly: the public ledger of
 * its checkpoints (life/ledger.ts) and the verdicts of machines that re-derived
 * them (life/replay.ts), both kept on the repository's `live-fly-ledger` branch.
 *
 * These come from GitHub, not from the fly's machine, which is the point: the
 * VM cannot quietly change what was seen there. A page that cannot reach them
 * says so. It never fills in a verdict, and a replay it does not understand
 * counts as no replay, never as a pass.
 */
import { parseLedger, type Anchor } from "../life/ledger";

const REPOSITORY = "topherchris420/lop-nur-twin";
const BRANCH = "live-fly-ledger";
/** Every CSP copy's `connect-src` allows this origin, for this page. */
const RAW = `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}`;
export const RECORD_URL = `https://github.com/${REPOSITORY}/tree/${BRANCH}`;

export interface ChainPoint {
  sequence: number;
  tick: number;
  digest: string;
}

/** One line of `replays.jsonl`: what the workflow appended after a replay. */
export interface ReplayLine {
  seenUtc: string;
  passed: boolean;
  from: ChainPoint;
  to: ChainPoint;
  head: ChainPoint;
  reproduced: number;
  ticks: number;
  machine: { platform: string; arch: string; node: string };
  difference: { sequence: number; field: string } | null;
  stopped: string | null;
  run: string;
}

export interface PublicRecord {
  /** Lines of the ledger for this individual. */
  anchors: number;
  newest: Anchor | null;
  /** The newest replay, whichever way it went. */
  replay: ReplayLine | null;
  /**
   * The unbroken stretch ending at the newest replay in which every run passed
   * and each began where the last ended: every checkpoint in it was reproduced
   * by a machine other than the fly's. Null when the newest replay did not pass.
   */
  covered: { from: number; to: number; ticks: number; runs: number } | null;
}

const isPoint = (v: unknown): v is ChainPoint => {
  const p = v as ChainPoint | null;
  return (
    typeof p === "object" &&
    p !== null &&
    Number.isSafeInteger(p.sequence) &&
    Number.isSafeInteger(p.tick) &&
    typeof p.digest === "string"
  );
};

/** A line of `replays.jsonl` for this individual, or null if it is anything else. */
function parseReplay(line: string, individual: string): ReplayLine | null {
  let v: Partial<ReplayLine> & { individual?: unknown; machine?: unknown };
  try {
    v = JSON.parse(line) as typeof v;
  } catch {
    return null;
  }
  const machine = v.machine;
  if (
    v.individual !== individual ||
    typeof v.passed !== "boolean" ||
    typeof v.seenUtc !== "string" ||
    Number.isNaN(Date.parse(v.seenUtc)) ||
    !isPoint(v.from) ||
    !isPoint(v.to) ||
    !isPoint(v.head) ||
    !Number.isSafeInteger(v.reproduced) ||
    !Number.isSafeInteger(v.ticks) ||
    typeof machine?.platform !== "string" ||
    typeof machine.arch !== "string" ||
    typeof machine.node !== "string" ||
    typeof v.run !== "string" ||
    !v.run.startsWith(`https://github.com/${REPOSITORY}/actions/runs/`)
  )
    return null;
  // A pass says it reached the head and reproduced everything between: otherwise it is no pass.
  if (v.passed && (v.to.digest !== v.head.digest || v.difference || v.stopped))
    return null;
  return v as ReplayLine;
}

/** Read the two files. `replays` is "" when no replay has been recorded. */
export function readPublicRecord(
  ledger: string,
  replays: string,
  individual: string,
): PublicRecord {
  const anchors = parseLedger(ledger).filter((a) => a.individual === individual);
  const lines = replays
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => parseReplay(line, individual))
    .filter((r): r is ReplayLine => r !== null);
  const replay = lines.at(-1) ?? null;
  let covered: PublicRecord["covered"] = null;
  if (replay?.passed) {
    covered = {
      from: replay.from.sequence,
      to: replay.to.sequence,
      ticks: replay.ticks,
      runs: 1,
    };
    for (let i = lines.length - 2; i >= 0; i--) {
      const r = lines[i]!;
      if (!r.passed || r.to.digest !== lines[i + 1]!.from.digest) break;
      covered.from = r.from.sequence;
      covered.ticks += r.ticks;
      covered.runs += 1;
    }
  }
  return { anchors: anchors.length, newest: anchors.at(-1) ?? null, replay, covered };
}

/** How the live chain stands against what was seen in public, for this page to say. */
export function standing(
  record: PublicRecord,
  live: { sequence: number },
): "behind-ledger" | "consistent" | "no-anchors" {
  if (!record.newest) return "no-anchors";
  return live.sequence < record.newest.checkpoint ? "behind-ledger" : "consistent";
}

/** Fetch the record. Throws when the ledger cannot be read; a missing `replays.jsonl` is no replay yet. */
export async function fetchPublicRecord(
  individual: string,
  signal?: AbortSignal,
): Promise<PublicRecord> {
  const get = (file: string) => fetch(`${RAW}/${file}`, { signal, cache: "no-cache" });
  const [ledger, replays] = await Promise.all([
    get("ledger.jsonl"),
    get("replays.jsonl"),
  ]);
  if (!ledger.ok) throw new Error(`the ledger answered ${ledger.status}`);
  if (!replays.ok && replays.status !== 404)
    throw new Error(`the replays answered ${replays.status}`);
  return readPublicRecord(
    await ledger.text(),
    replays.ok ? await replays.text() : "",
    individual,
  );
}
