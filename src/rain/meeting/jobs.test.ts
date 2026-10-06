import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Refused } from "../errors.js";
import { ModelMeetings } from "./jobs.js";

/** Model meetings as jobs: one at a time, bound to their request, stoppable, archived. */
const PAPER = "papers/closure.md";
const PAPER_TEXT =
  "# Closures\n\nCrowds near a closed entrance wait before they disperse.\n";
const documents = [{ path: PAPER, text: PAPER_TEXT }];
const GROUNDED = `The closure paper notes that "Crowds near a closed entrance wait before they disperse." That is measurable, so what would falsify it?`;
const revision = {
  repository: "topherchris420/lop-nur-twin",
  commit: "1".repeat(40),
  dirty: false,
};

type Body = { messages: { content: string }[] };
function fetchFor(answer: (turn: number) => Promise<string> | string): typeof fetch {
  let turn = 0;
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Body;
    const last = body.messages.at(-1)!.content;
    const content = last === "test" ? "ok" : await answer(++turn);
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
      {
        status: 200,
      },
    );
  };
}
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function meetings(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  const archiveDir = mkdtempSync(join(tmpdir(), "rain-jobs-test-"));
  scratch.push(archiveDir);
  let clock = 0;
  const jobs = new ModelMeetings({
    settings: {
      baseUrl: "http://127.0.0.1:1/v1",
      model: "stand-in-model",
      maxTurns: 4,
      wrapUpTurns: 2,
      recursiveIntellect: false,
      timeoutMs: 1000,
      maxRetries: 1,
    },
    timeoutMinutes: 5,
    documents,
    revision: () => revision,
    archiveDir,
    hooks: { fetchImpl, sleep: async () => {} },
    monotonic: () => (clock += 100),
    randomHex: (bytes) => "ab".repeat(bytes),
    ...extra,
  });
  return { jobs, archiveDir };
}
const settle = async (poll: () => boolean) => {
  for (let i = 0; i < 400 && !poll(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe("model meeting jobs", () => {
  it("answers with a pending job, then the record, each bound to the request", async () => {
    const { jobs, archiveDir } = meetings(fetchFor(() => GROUNDED));
    const pending = jobs.start("Why do crowds wait?", "r".repeat(32));
    expect(pending).toMatchObject({
      kind: "meeting-pending",
      job_id: "ab".repeat(16),
      question: "Why do crowds wait?",
      model: "stand-in-model",
      turns_planned: 4,
      request_id: "r".repeat(32),
    });
    expect(jobs.running).toBe(true);
    expect(() => jobs.status(pending.job_id, "x".repeat(32))).toThrow(Refused);
    expect(() => jobs.status("nope", "r".repeat(32))).toThrow(/no such meeting/);
    await settle(
      () => jobs.status(pending.job_id, "r".repeat(32)).kind !== "meeting-pending",
    );
    const record = jobs.status(pending.job_id, "r".repeat(32));
    expect(record.kind).toBe("meeting");
    if (record.kind !== "meeting") throw new Error("unreachable");
    expect(record.generation).toBe("model");
    expect(record.model).toBe("stand-in-model");
    expect(record.request_id).toBe("r".repeat(32));
    expect(record.rain).toEqual(revision);
    expect(record.turns.filter((t) => t.generation === "model")).toHaveLength(4);
    expect(jobs.running).toBe(false);
    const archived = readdirSync(archiveDir);
    expect(archived).toHaveLength(1);
    expect(archived[0]!.startsWith("session_")).toBe(true);
    const artifact = JSON.parse(readFileSync(join(archiveDir, archived[0]!), "utf8")) as {
      schema_version: string;
    };
    expect(artifact.schema_version).toBe("rain-session-artifact/v1");
  });

  it("refuses a second meeting while one runs, and stops one at the lab's request", async () => {
    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve(GROUNDED);
    });
    const { jobs, archiveDir } = meetings(
      fetchFor((turn) => (turn === 1 ? gate : GROUNDED)),
    );
    const pending = jobs.start("q", "r".repeat(32));
    expect(() => jobs.start("another", "s".repeat(32))).toThrow(
      /already holding a meeting/,
    );
    const stopped = jobs.cancel(pending.job_id, "r".repeat(32));
    expect(stopped).toMatchObject({
      kind: "meeting-failed",
      job_id: pending.job_id,
      reason: "stopped at the lab's request",
    });
    expect(() => jobs.cancel(pending.job_id, "x".repeat(32))).toThrow(/no such meeting/);
    expect(jobs.running).toBe(false);
    release();
    await settle(() => existsSync(archiveDir) && readdirSync(archiveDir).length > 0);
    expect(jobs.status(pending.job_id, "r".repeat(32)).kind).toBe("meeting-failed");
    const next = jobs.start("after", "t".repeat(32));
    expect(next.kind).toBe("meeting-pending");
    await settle(
      () => jobs.status(next.job_id, "t".repeat(32)).kind !== "meeting-pending",
    );
    expect(jobs.status(next.job_id, "t".repeat(32)).kind).toBe("meeting");
  });

  it("reports a meeting the server cannot hold as failed, with the reason", async () => {
    const { jobs } = meetings(async () => {
      throw new Error("refused");
    });
    const pending = jobs.start("q", "r".repeat(32));
    await settle(
      () => jobs.status(pending.job_id, "r".repeat(32)).kind !== "meeting-pending",
    );
    const failed = jobs.status(pending.job_id, "r".repeat(32));
    expect(failed.kind).toBe("meeting-failed");
    if (failed.kind === "meeting-failed")
      expect(failed.reason).toContain("did not answer");
  });
});
