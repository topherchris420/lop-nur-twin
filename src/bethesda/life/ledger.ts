/**
 * The deployed life's public ledger: what the watcher saw of its history, and
 * when. Every checkpoint names its parent's digest, so one digest fixes the
 * whole chain back to birth; but the chain lives only on the life's machine,
 * which could rewrite it unseen. Each new checkpoint that a backup verifies
 * (its digest is in the backup's record, `/v1/backup`) is appended here as an
 * anchor, by `.github/workflows/bethesda-life-watch.yml`, to the
 * `live-fly-ledger` branch, where GitHub records when it arrived. Any archive
 * can then be checked against every anchor (`judgeAnchors`, run by
 * `scripts/bethesda-life-ledger.ts verify`): history it contradicts was
 * rewritten, or lost to a restore from an older backup.
 *
 * Append-only: a line is never edited, removed or reordered, and the branch
 * is never force-pushed. An anchor says only that the machine claimed this
 * checkpoint by `seenUtc`; GitHub, not the machine, is the witness to that.
 * Pure, so the tests hand it any record and ledger.
 */
import { ARCHIVE, HEX64, int, object, str, utc, type BackupStatus } from "./watch.js";

export const LEDGER_SCHEMA = "bethesda-life-ledger/v1" as const;
export const LEDGER_FILE = "ledger.jsonl";

/** One line of the ledger. */
export interface Anchor {
  schema: typeof LEDGER_SCHEMA;
  /** When the watcher read it (GitHub's runner clock). */
  seenUtc: string;
  individual: string;
  checkpoint: number;
  tick: number;
  digest: string;
  /** When the life committed it, by its own machine's clock. */
  committedUtc: string;
  /** The archive that holds it, and that archive's SHA-256. */
  archive: string;
  sha256: string;
}

const KEYS = [
  "schema",
  "seenUtc",
  "individual",
  "checkpoint",
  "tick",
  "digest",
  "committedUtc",
  "archive",
  "sha256",
] as const;

/** One anchor, validated; throws on anything else. */
export function parseAnchor(value: unknown, path = "anchor"): Anchor {
  const a = object(value, path, KEYS);
  if (a.schema !== LEDGER_SCHEMA) throw new Error(`${path}.schema: not ${LEDGER_SCHEMA}`);
  return {
    schema: LEDGER_SCHEMA,
    seenUtc: utc(a.seenUtc, `${path}.seenUtc`),
    individual: str(a.individual, `${path}.individual`, 64, HEX64),
    checkpoint: int(a.checkpoint, `${path}.checkpoint`),
    tick: int(a.tick, `${path}.tick`),
    digest: str(a.digest, `${path}.digest`, 64, HEX64),
    committedUtc: utc(a.committedUtc, `${path}.committedUtc`),
    archive: str(a.archive, `${path}.archive`, 80, ARCHIVE),
    sha256: str(a.sha256, `${path}.sha256`, 64, HEX64),
  };
}

/** The ledger file: one anchor per line. Throws, naming the line, on any break. */
export function parseLedger(text: string): Anchor[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line, i) => {
    try {
      return parseAnchor(JSON.parse(line), `line ${i + 1}`);
    } catch (e) {
      throw new Error(`${LEDGER_FILE} line ${i + 1}: ${(e as Error).message}`);
    }
  });
}

/** An anchor as the line the ledger keeps (keys in a fixed order). */
export const anchorLine = (a: Anchor): string =>
  JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, a[k]]))) + "\n";

/**
 * What the watcher appends after reading the backup's record: the newest
 * verified checkpoint, unless it is already the ledger's last anchor, the
 * record holds none (no archive yet, or written before backup.sh read
 * digests), or it is another individual's (the watcher alerts on that).
 * A checkpoint at or below the last anchor's is still appended: the ledger
 * records what the machine claimed, and `judgeAnchors` finds the conflict.
 */
export function nextAnchor(o: {
  backup: BackupStatus | null;
  individual: string;
  ledger: readonly Anchor[];
  seenUtc: string;
}): Anchor | null {
  const k = o.backup?.kept;
  if (!k?.digest || !k.committed || k.individual !== o.individual) return null;
  const last = o.ledger.at(-1);
  if (last && last.checkpoint === k.checkpoint && last.digest === k.digest) return null;
  return {
    schema: LEDGER_SCHEMA,
    seenUtc: o.seenUtc,
    individual: k.individual,
    checkpoint: k.checkpoint,
    tick: k.tick,
    digest: k.digest,
    committedUtc: k.committed,
    archive: k.archive,
    sha256: k.sha256,
  };
}

/**
 * - **confirmed**: the store holds this checkpoint with this digest.
 * - **contradicted**: the store holds another checkpoint at that place, or is
 *   another individual: history differs from what the machine claimed then.
 * - **ahead**: the store ends before it (an older archive), so it can neither
 *   confirm nor contradict it.
 */
export type Verdict = "confirmed" | "contradicted" | "ahead";

/** Each anchor judged against a store whose chain has been verified. */
export function judgeAnchors(
  anchors: readonly Anchor[],
  chain: { individual: string; head: number; digestAt(sequence: number): string },
): { anchor: Anchor; verdict: Verdict }[] {
  return anchors.map((anchor) => ({
    anchor,
    verdict:
      anchor.individual !== chain.individual
        ? "contradicted"
        : anchor.checkpoint > chain.head
          ? "ahead"
          : chain.digestAt(anchor.checkpoint) === anchor.digest
            ? "confirmed"
            : "contradicted",
  }));
}

/** The ledger branch's README, written when it is missing. */
export const LEDGER_README = `# The live fly's ledger

Each line of \`${LEDGER_FILE}\` is a checkpoint of the deployed Bethesda
individual that a backup verified, appended by the repository's
"Live fly watch" workflow when it first saw it. Every checkpoint names its
parent's digest, so each line fixes the individual's whole history up to
that checkpoint. GitHub's record of when each line arrived is the witness;
the machine's own clocks are not.

This branch is append-only: nothing is edited, removed or force-pushed.
It holds no code, and \`vercel.json\` stops deployments of it.

To check an archive against every line, from the main branch:

\`\`\`sh
tar -xzf bethesda-life-<UTC>-<commit>.tar.gz -C /tmp/check
node scripts/run-ts.mjs scripts/bethesda-life-ledger.ts verify \\
  --store /tmp/check/store --ledger ${LEDGER_FILE}
\`\`\`

See docs/BETHESDA_CONTINUOUS_LIFE.md ("The ledger") on the main branch.
`;

/** Stops Vercel deploying the ledger branch: it holds no site. */
export const LEDGER_VERCEL = '{ "git": { "deploymentEnabled": false } }\n';
