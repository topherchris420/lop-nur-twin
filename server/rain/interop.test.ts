import { afterEach, describe, expect, it } from "vitest";
import {
  statSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInteropHandler, MAX_QUEUE } from "./interop";
import { checkRecord } from "../../src/rain/interop/contract";

const FIXTURES = join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "interop",
  "agent-interop-v1",
  "fixtures",
);
const READ = "read-token-for-tests";
const PROPOSE = "propose-token-for-tests";
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })),
);

function setup(
  tokens: { read?: string; propose?: string } = { read: READ, propose: PROPOSE },
) {
  const root = mkdtempSync(join(tmpdir(), "rain-interop-"));
  dirs.push(root);
  const evidenceDir = join(root, "evidence");
  const queueDir = join(root, "queue");
  mkdirSync(evidenceDir);
  copyFileSync(
    join(FIXTURES, "rain-interop-evidence.json"),
    join(evidenceDir, "evidence-E-fixture.json"),
  );
  const handle = createInteropHandler({
    readToken: tokens.read,
    proposeToken: tokens.propose,
    evidenceDir,
    queueDir,
    labCommit: () => "0123456789abcdef0123456789abcdef01234567",
  });
  const call = (
    path: string,
    init: { method?: string; token?: string; body?: string; peer?: string } = {},
  ) =>
    handle(
      new Request(`http://127.0.0.1:4173${path}`, {
        method: init.method ?? "GET",
        headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
        body: init.body,
      }),
      { clientKey: init.peer ?? "127.0.0.1" },
    );
  return { call, evidenceDir, queueDir };
}

const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("agent-interop/v1 routes", () => {
  it("are off without a token, and refuse other machines and bad tokens", async () => {
    const off = setup({});
    expect((await off.call("/api/rain/interop/v1/status", { token: READ })).status).toBe(
      404,
    );
    const { call } = setup();
    expect(
      (await call("/api/rain/interop/v1/status", { token: READ, peer: "192.168.1.5" }))
        .status,
    ).toBe(403);
    expect((await call("/api/rain/interop/v1/status")).status).toBe(401);
    expect(
      (await call("/api/rain/interop/v1/status", { token: "wrong-token-123" })).status,
    ).toBe(401);
    const error = await body(
      await call("/api/rain/interop/v1/status", { token: "wrong-token-123" }),
    );
    expect(checkRecord("rain-interop-error/v1", error)).toEqual([]);
  });

  it("serve status and sealed evidence to the read scope only", async () => {
    const { call, evidenceDir } = setup();
    const status = await body(await call("/api/rain/interop/v1/status", { token: READ }));
    expect(checkRecord("rain-interop-status/v1", status)).toEqual([]);
    expect((status.episodes as unknown[]).length).toBe(1);
    const evidence = await body(
      await call("/api/rain/interop/v1/evidence?episode=E-fixture", { token: READ }),
    );
    expect(checkRecord("rain-interop-evidence/v1", evidence)).toEqual([]);
    expect(
      (await call("/api/rain/interop/v1/evidence?episode=../etc", { token: READ }))
        .status,
    ).toBe(400);
    expect(
      (await call("/api/rain/interop/v1/evidence?episode=E-missing", { token: READ }))
        .status,
    ).toBe(404);
    expect((await call("/api/rain/interop/v1/status", { token: PROPOSE })).status).toBe(
      403,
    );
    // A record that no longer matches its digest is never served.
    const tampered = { ...evidence, outcome: "supported" };
    writeFileSync(join(evidenceDir, "evidence-E-fixture.json"), JSON.stringify(tampered));
    const after = await body(await call("/api/rain/interop/v1/status", { token: READ }));
    expect(after.episodes).toEqual([]);
  });

  it("queue a valid proposal for the operator and authorize nothing", async () => {
    const { call, queueDir } = setup();
    const proposal = readFileSync(join(FIXTURES, "rain-interop-proposal.json"), "utf8");
    expect(
      (
        await call("/api/rain/interop/v1/proposals", {
          method: "POST",
          token: READ,
          body: proposal,
        })
      ).status,
    ).toBe(403);
    const receipt = await body(
      await call("/api/rain/interop/v1/proposals", {
        method: "POST",
        token: PROPOSE,
        body: proposal,
      }),
    );
    expect(checkRecord("rain-interop-receipt/v1", receipt)).toEqual([]);
    expect(receipt.authorizes_execution).toBe(false);
    expect(receipt.status).toBe("queued_for_operator_review");
    expect(readdirSync(queueDir)).toHaveLength(1);
    if (process.platform !== "win32")
      expect(statSync(join(queueDir, readdirSync(queueDir)[0]!)).mode & 0o777).toBe(
        0o600,
      );
    const again = await body(
      await call("/api/rain/interop/v1/proposals", {
        method: "POST",
        token: PROPOSE,
        body: proposal,
      }),
    );
    expect(again.status).toBe("duplicate");
    const forged = JSON.parse(proposal);
    forged.hypothesis = "changed after sealing";
    expect(
      (
        await call("/api/rain/interop/v1/proposals", {
          method: "POST",
          token: PROPOSE,
          body: JSON.stringify(forged),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/rain/interop/v1/proposals", {
          method: "POST",
          token: PROPOSE,
          body: "x".repeat(17000),
        })
      ).status,
    ).toBe(413);
    expect(
      (await call("/api/rain/interop/v1/proposals", { token: PROPOSE })).status,
    ).toBe(405);
  });

  it("stop accepting when the review queue is full", async () => {
    const { call, queueDir } = setup();
    mkdirSync(queueDir, { recursive: true });
    for (let i = 0; i < MAX_QUEUE; i++)
      writeFileSync(join(queueDir, `${i.toString(16).padStart(64, "0")}.json`), "{}");
    const proposal = readFileSync(join(FIXTURES, "rain-interop-proposal.json"), "utf8");
    expect(
      (
        await call("/api/rain/interop/v1/proposals", {
          method: "POST",
          token: PROPOSE,
          body: proposal,
        })
      ).status,
    ).toBe(429);
    expect(existsSync(join(queueDir, "x.json"))).toBe(false);
  });
});

describe("the committed collaboration evidence", () => {
  it("passes the shared schema and is what the read scope serves", async () => {
    const evidenceDir = join(
      import.meta.dirname,
      "..",
      "..",
      "docs",
      "benchmarks",
      "rain-collaboration",
    );
    const handle = createInteropHandler({
      readToken: READ,
      evidenceDir,
      queueDir: join(tmpdir(), "rain-interop-unused"),
      labCommit: () => null,
    });
    const call = (path: string) =>
      handle(
        new Request(`http://127.0.0.1:4173${path}`, {
          headers: { authorization: `Bearer ${READ}` },
        }),
        { clientKey: "127.0.0.1" },
      );
    const status = await body(await call("/api/rain/interop/v1/status"));
    const episodes = status.episodes as Array<{
      episode_id: string;
      evidence_sha256: string;
    }>;
    expect(episodes.map((e) => e.episode_id)).toEqual(["E-assumption-v1"]);
    const evidence = await body(
      await call("/api/rain/interop/v1/evidence?episode=E-assumption-v1"),
    );
    expect(checkRecord("rain-interop-evidence/v1", evidence)).toEqual([]);
    expect(evidence.sha256).toBe(episodes[0]!.evidence_sha256);
    expect((evidence.provenance as { evidence_class: string }).evidence_class).toBe(
      "simulated",
    );
  });
});
