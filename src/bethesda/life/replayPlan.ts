/**
 * What the replay workflow should do next, decided from what it can read: the
 * VM's public `/v1/backup` and the verdicts already on the ledger branch.
 *
 * Nothing the VM says may reach a shell as it stands. A value from `/v1/backup`
 * can end up in a URL, a path, shell arithmetic or `$GITHUB_OUTPUT`, in a job the
 * workflow's secret passes through, so everything here is parsed against the
 * patterns in watch.ts first, and a plan holds only values that matched them.
 * Pure, so the tests hand it any record.
 */
import { ARCHIVE, HEX64, parseBackupStatus } from "./watch.js";

const RELEASE = /^[0-9a-f]{40}$/;

export type ReplayPlan =
  /** Nothing to judge: say why, and stop. */
  | { action: "wait"; why: string }
  /** The VM's record is itself the finding: publish a failed line saying so. */
  | { action: "refuse"; why: string }
  | {
      action: "replay";
      archive: string;
      sha256: string;
      release: string;
      /** The archive of the last replay, to continue from, when it can be. */
      previous: { archive: string; sha256: string } | null;
    };

interface Verdict {
  passed?: unknown;
  individual?: unknown;
  archive?: unknown;
  sha256?: unknown;
  release?: unknown;
  to?: { sequence?: unknown; digest?: unknown } | null;
}

/** `replays.jsonl`, for this individual. A line that cannot be read is not a verdict. */
function verdicts(replays: string, individual: string): Verdict[] {
  const out: Verdict[] = [];
  for (const line of replays.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Verdict;
      if (v.individual === individual) out.push(v);
    } catch {
      continue;
    }
  }
  return out;
}

export function planReplay(o: {
  /** The parsed JSON of `/v1/backup`; null when it answered 404. */
  backup: unknown;
  individual: string;
  replays: string;
  maxCheckpoints: number;
}): ReplayPlan {
  if (o.backup === null) return { action: "wait", why: "no backup has been recorded" };
  let kept;
  try {
    kept = parseBackupStatus(o.backup).kept;
  } catch (e) {
    return { action: "refuse", why: `/v1/backup is malformed: ${(e as Error).message}` };
  }
  if (!kept) return { action: "wait", why: "no archive has been kept yet" };

  const lines = verdicts(o.replays, o.individual);
  if (lines.some((v) => v.archive === kept.archive))
    return { action: "wait", why: `${kept.archive} has been judged already` };
  const last = lines.at(-1);
  if (last?.passed === true && kept.digest && last.to?.digest === kept.digest)
    return {
      action: "wait",
      why: "the newest archive has no checkpoint newer than the last replay",
    };

  // Only a passing line, of the same release, near enough to finish in time, is continued from.
  let previous: { archive: string; sha256: string } | null = null;
  if (
    last?.passed === true &&
    last.release === kept.release &&
    typeof last.archive === "string" &&
    ARCHIVE.test(last.archive) &&
    typeof last.sha256 === "string" &&
    HEX64.test(last.sha256) &&
    typeof last.to?.sequence === "number"
  ) {
    const behind = kept.checkpoint - last.to.sequence;
    if (behind > 0 && behind <= o.maxCheckpoints)
      previous = { archive: last.archive, sha256: last.sha256 };
  }
  // parseBackupStatus has checked it; the release is what reaches git, so say it twice.
  if (!RELEASE.test(kept.release))
    return { action: "refuse", why: "/v1/backup names a malformed release" };
  return {
    action: "replay",
    archive: kept.archive,
    sha256: kept.sha256,
    release: kept.release,
    previous,
  };
}

/** The lines for `$GITHUB_OUTPUT`. Only values that passed the patterns above reach it. */
export function planOutputs(plan: ReplayPlan): string[] {
  if (plan.action !== "replay") return [`action=${plan.action}`];
  return [
    "action=replay",
    `archive=${plan.archive}`,
    `sha256=${plan.sha256}`,
    `release=${plan.release}`,
    `previous=${plan.previous?.archive ?? ""}`,
    `previous_sha256=${plan.previous?.sha256 ?? ""}`,
  ];
}
