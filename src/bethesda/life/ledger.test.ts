import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { birth, checkpointLife } from "./continuity.js";
import { GENESIS, YARD_LIFE } from "./individuality.js";
import {
  anchorLine,
  judgeAnchors,
  LEDGER_SCHEMA,
  nextAnchor,
  parseLedger,
  type Anchor,
} from "./ledger.js";
import { LifeStore } from "./store.js";
import type { BackupStatus } from "./watch.js";

const ID = "b".repeat(64);
const ARCHIVE = "bethesda-life-20261030T104950Z-62bd12502c17.tar.gz";
const SEEN = "2026-10-30T11:07:41.120Z";

function backup(
  o: { checkpoint?: number; digest?: string | null; individual?: string } = {},
) {
  const digest = o.digest === undefined ? "a".repeat(64) : o.digest;
  return {
    schema: "bethesda-life-backup/v1",
    attempt: {
      utc: "2026-10-30T10:49:50Z",
      result: "kept",
      detail: null,
      offsite: "uploaded",
    },
    kept: {
      utc: "2026-10-30T10:49:50Z",
      archive: ARCHIVE,
      sha256: "d".repeat(64),
      bytes: 23_034_812,
      individual: o.individual ?? ID,
      checkpoint: o.checkpoint ?? 1113,
      tick: 3_320_228,
      release: "c".repeat(40),
      digest,
      committed: digest === null ? null : "2026-10-30T10:48:43.922Z",
    },
    offsite: { utc: "2026-10-30T10:50:44Z", archive: ARCHIVE },
  } as BackupStatus;
}

const next = (b: BackupStatus | null, ledger: Anchor[] = []) =>
  nextAnchor({ backup: b, individual: ID, ledger, seenUtc: SEEN });

describe("the ledger's next anchor", () => {
  it("anchors the newest verified checkpoint, once", () => {
    const anchor = next(backup())!;
    expect(anchor).toEqual({
      schema: LEDGER_SCHEMA,
      seenUtc: SEEN,
      individual: ID,
      checkpoint: 1113,
      tick: 3_320_228,
      digest: "a".repeat(64),
      committedUtc: "2026-10-30T10:48:43.922Z",
      archive: ARCHIVE,
      sha256: "d".repeat(64),
    });
    expect(next(backup(), [anchor])).toBeNull();
    expect(
      next(backup({ checkpoint: 1185, digest: "e".repeat(64) }), [anchor]),
    ).toMatchObject({
      checkpoint: 1185,
    });
  });

  it("anchors nothing without a record, a digest, or the deployed individual", () => {
    expect(next(null)).toBeNull();
    expect(next({ ...backup(), kept: null })).toBeNull();
    expect(next(backup({ digest: null }))).toBeNull();
    expect(next(backup({ individual: "e".repeat(64) }))).toBeNull();
  });

  it("still records a checkpoint at or below the last anchor: the conflict is for verify to find", () => {
    const anchor = next(backup())!;
    expect(next(backup({ digest: "f".repeat(64) }), [anchor])).toMatchObject({
      checkpoint: 1113,
      digest: "f".repeat(64),
    });
    expect(
      next(backup({ checkpoint: 1000, digest: "f".repeat(64) }), [anchor]),
    ).not.toBeNull();
  });
});

describe("the ledger file", () => {
  it("round-trips its lines, in a fixed key order", () => {
    const a = next(backup())!;
    const b = next(backup({ checkpoint: 1185, digest: "e".repeat(64) }), [a])!;
    const text = anchorLine(a) + anchorLine(b);
    expect(parseLedger(text)).toEqual([a, b]);
    expect(anchorLine({ ...a })).toBe(anchorLine(JSON.parse(anchorLine(a)) as Anchor));
    expect(parseLedger("")).toEqual([]);
  });

  it("refuses a line it cannot vouch for, naming it", () => {
    const line = anchorLine(next(backup())!);
    expect(() => parseLedger(line + "{}\n")).toThrow(/line 2/);
    expect(() => parseLedger(line.replace('"tick"', '"x":1,"tick"'))).toThrow(
      /unexpected x/,
    );
    expect(() => parseLedger(line.replace("a".repeat(64), "a".repeat(63)))).toThrow(
      /digest/,
    );
    expect(() => parseLedger(line.replace("ledger/v1", "ledger/v2"))).toThrow(/schema/);
  });
});

describe("judging anchors against a store", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "ledger-")), "fly");
  afterAll(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

  it("confirms what the chain holds, graphs compacted or not, contradicts the rest and cannot judge past its head", () => {
    const life = YARD_LIFE.build(structuredClone(GENESIS));
    const b = birth(YARD_LIFE.id, GENESIS, "0123456789abcdef0123456789abcdef");
    let c = checkpointLife(YARD_LIFE, life, {
      genesis: GENESIS,
      birth: b,
      previous: null,
    });
    const store = LifeStore.create(dir, YARD_LIFE, c, { keepGraphs: 2 });
    const digests = [c.digest];
    for (let k = 0; k < 4; k++) {
      life.step(50);
      c = checkpointLife(YARD_LIFE, life, { genesis: GENESIS, birth: b, previous: c });
      store.commit(c);
      digests.push(c.digest);
    }
    store.release();

    const opened = LifeStore.open(dir, YARD_LIFE);
    expect(opened.checkpointAt(1).graph).toBeNull();
    const head = opened.headRecord().checkpoint;
    const chain = {
      individual: head.birth.individual,
      head: head.sequence,
      digestAt: (s: number) => opened.checkpointAt(s).digest,
    };
    const at = (checkpoint: number, digest: string, individual = chain.individual) => ({
      ...next(backup())!,
      individual,
      checkpoint,
      digest,
    });
    const verdicts = judgeAnchors(
      [
        at(1, digests[1]!),
        at(4, digests[4]!),
        at(3, digests[2]!),
        at(5, "3".repeat(64)),
        at(1, digests[1]!, ID),
      ],
      chain,
    ).map((j) => j.verdict);
    expect(verdicts).toEqual([
      "confirmed",
      "confirmed",
      "contradicted",
      "ahead",
      "contradicted",
    ]);
  }, 60_000);
});
