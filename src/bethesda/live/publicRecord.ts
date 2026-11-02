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
  /** Why it failed, when the reason is not a `difference` or a stop. */
  reason: string | null;
  /** Null when a failure came before any chain could be read. */
  from: ChainPoint | null;
  to: ChainPoint | null;
  head: ChainPoint | null;
  reproduced: number;
  ticks: number;
  /** Whether this release's seals had to come out the same (life/replay.ts says why not). */
  seals: { required: boolean; reproduced: number } | null;
  machine: { platform: string; arch: string; node: string } | null;
  difference: { sequence: number; field: string } | null;
  stopped: string | null;
  run: string;
}

export interface PublicRecord {
  /** Lines of the ledger for this individual. */
  anchors: number;
  newest: Anchor | null;
  /** The highest checkpoint the ledger has seen, even if the chain was rewound since. */
  highest: number | null;
  /** The newest line that went backwards: the ledger openly recording a rewind. */
  lastRewind: { from: number; to: number; seenUtc: string } | null;
  /** The newest replay, whichever way it went. */
  replay: ReplayLine | null;
  /**
   * The unbroken stretch ending at the newest replay in which every run passed
   * and each began where the last ended. `from` is where it started, taken as
   * given: every checkpoint after it, up to `to`, was reproduced by a machine other
   * than the fly's, seal for seal if `sealed`. Null when the newest replay did not pass.
   */
  covered: {
    from: number;
    to: number;
    ticks: number;
    runs: number;
    sealed: boolean;
  } | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

const isPoint = (v: unknown): v is ChainPoint => {
  const p = v as ChainPoint | null;
  return (
    typeof p === "object" &&
    p !== null &&
    Number.isSafeInteger(p.sequence) &&
    Number.isSafeInteger(p.tick) &&
    typeof p.digest === "string" &&
    HEX64.test(p.digest)
  );
};

const optional = (v: unknown, is: (x: unknown) => boolean) =>
  v === undefined || v === null || is(v);

const isMachine = (v: unknown) => {
  const m = v as ReplayLine["machine"];
  return (
    typeof m?.platform === "string" &&
    typeof m.arch === "string" &&
    typeof m.node === "string"
  );
};

/** A line of `replays.jsonl` for this individual, or null if it is anything else. */
function parseReplay(line: string, individual: string): ReplayLine | null {
  let v: Partial<ReplayLine> & { individual?: unknown };
  try {
    v = JSON.parse(line) as typeof v;
  } catch {
    return null;
  }
  const text = (x: unknown) => typeof x === "string";
  const difference = (x: unknown) => {
    const d = x as ReplayLine["difference"];
    return Number.isSafeInteger(d?.sequence) && typeof d?.field === "string";
  };
  const seals = (x: unknown) => {
    const s = x as ReplayLine["seals"];
    return typeof s?.required === "boolean" && Number.isSafeInteger(s.reproduced);
  };
  if (
    v.individual !== individual ||
    typeof v.passed !== "boolean" ||
    typeof v.seenUtc !== "string" ||
    Number.isNaN(Date.parse(v.seenUtc)) ||
    !optional(v.from, isPoint) ||
    !optional(v.to, isPoint) ||
    !optional(v.head, isPoint) ||
    !optional(v.machine, isMachine) ||
    !optional(v.reason, text) ||
    !optional(v.stopped, text) ||
    !optional(v.difference, difference) ||
    !optional(v.seals, seals) ||
    !Number.isSafeInteger(v.reproduced ?? 0) ||
    !Number.isSafeInteger(v.ticks ?? 0) ||
    typeof v.run !== "string" ||
    !v.run.startsWith(`https://github.com/${REPOSITORY}/actions/runs/`)
  )
    return null;
  const parsed: ReplayLine = {
    seenUtc: v.seenUtc,
    passed: v.passed,
    reason: v.reason ?? null,
    from: v.from ?? null,
    to: v.to ?? null,
    head: v.head ?? null,
    reproduced: v.reproduced ?? 0,
    ticks: v.ticks ?? 0,
    seals: v.seals ?? null,
    machine: v.machine ?? null,
    difference: v.difference ?? null,
    stopped: v.stopped ?? null,
    run: v.run,
  };
  // A pass must add up: it reached the head and reproduced everything between. Otherwise it is no pass.
  if (parsed.passed) {
    const { from, to, head, seals: s } = parsed;
    if (
      !from ||
      !to ||
      !head ||
      !s ||
      !parsed.machine ||
      parsed.reason ||
      parsed.difference ||
      parsed.stopped ||
      to.digest !== head.digest ||
      to.sequence !== head.sequence ||
      to.sequence <= from.sequence ||
      parsed.reproduced !== to.sequence - from.sequence ||
      parsed.ticks !== to.tick - from.tick ||
      (s.required && s.reproduced !== parsed.reproduced)
    )
      return null;
  }
  return parsed;
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
      from: replay.from!.sequence,
      to: replay.to!.sequence,
      ticks: replay.ticks,
      runs: 1,
      sealed: replay.seals!.required,
    };
    for (let i = lines.length - 2; i >= 0; i--) {
      const r = lines[i]!;
      if (!r.passed || r.to!.digest !== lines[i + 1]!.from!.digest) break;
      covered.from = r.from!.sequence;
      covered.ticks += r.ticks;
      covered.runs += 1;
      covered.sealed &&= r.seals!.required;
    }
  }
  let lastRewind: PublicRecord["lastRewind"] = null;
  anchors.forEach((a, i) => {
    const before = anchors[i - 1];
    if (before && a.checkpoint < before.checkpoint)
      lastRewind = { from: before.checkpoint, to: a.checkpoint, seenUtc: a.seenUtc };
  });
  return {
    anchors: anchors.length,
    newest: anchors.at(-1) ?? null,
    highest: anchors.length ? Math.max(...anchors.map((a) => a.checkpoint)) : null,
    lastRewind,
    replay,
    covered,
  };
}

/** How the live chain stands against what was seen in public, for this page to say. */
export function standing(
  record: PublicRecord,
  live: { sequence: number },
): "behind-ledger" | "consistent" | "no-anchors" {
  if (record.highest === null) return "no-anchors";
  return live.sequence < record.highest ? "behind-ledger" : "consistent";
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
