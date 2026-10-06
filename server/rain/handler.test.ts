import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createRainHandler } from "./handler";
import { LIMITS } from "../../src/bethesda/rain/contracts";
import demoMeeting from "../../src/bethesda/rain/fixtures/demo-meeting.json" with { type: "json" };
import {
  configureRuntime,
  type RuntimeApi,
  type RuntimeConfiguration,
} from "../../src/rain/runtime";

const ORIGIN = "https://lab.example.test";
const SESSION = "c".repeat(32);
const REQUEST = "a".repeat(32);
const QUESTION = demoMeeting.question;
const scratch: string[] = [];
const scratchDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "rain-handler-test-"));
  scratch.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/rain/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path: string) =>
  new Request(`${ORIGIN}/api/rain/${path}`, { headers: { Origin: ORIGIN } });
const meta = { clientKey: "test" };
const meetingRequest = (question = QUESTION) => ({
  session: SESSION,
  request_id: REQUEST,
  question,
});
/** The real runtime, offline engine, scratch registry, no decision engine, no git. */
const local = (now?: () => number) =>
  createRainHandler({
    runtime: configureRuntime({
      env: { RAIN_DECISION_MODE: "off" },
      scratchDir,
      cwd: "/",
    }),
    now,
  });

describe("R.A.I.N. route configuration", () => {
  it("is OFFLINE with the runtime switched off and never substitutes content", async () => {
    const handle = createRainHandler({
      runtime: configureRuntime({ env: { RAIN_RUNTIME: "off" } }),
    });
    const status = await (await handle(get("status"), meta)).json();
    expect(status).toMatchObject({
      configured: false,
      reachable: null,
      identity: null,
      failure: null,
    });
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "not configured" });
  });
  it("reports a misconfigured runtime by the setting's name, never its value", async () => {
    const handle = createRainHandler({
      runtime: configureRuntime({
        env: {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "http://evil.example/model",
        },
        scratchDir,
      }),
    });
    const text = await (await handle(get("status"), meta)).text();
    expect(JSON.parse(text)).toMatchObject({ configured: false });
    expect(JSON.parse(text).failure).toMatch(/^misconfigured: RAIN_LLM_MODEL/);
    expect(text).not.toContain("evil.example");
  });
  it("answers LIVE with the runtime's validated identity and caches it", async () => {
    const handle = local();
    const first = (await (await handle(get("status"), meta)).json()) as {
      identity: {
        runtime: { name: string };
        corpus: { files: number };
        meeting_generation: string;
      };
    };
    expect(first).toMatchObject({ configured: true, reachable: true, failure: null });
    expect(first.identity.runtime.name).toBe("lop-nur-twin-rain");
    expect(first.identity.corpus.files).toBe(17);
    expect(first.identity.meeting_generation).toBe("scripted");
  });
});

describe("R.A.I.N. route boundary", () => {
  it("holds an offline meeting in-process and returns the validated record", async () => {
    const handle = local();
    const response = await handle(
      post("meeting", meetingRequest(`  ${QUESTION}  `)),
      meta,
    );
    expect(response.status).toBe(200);
    const record = (await response.json()) as {
      question: string;
      meeting_id: string;
      generation: string;
    };
    expect(record.question).toBe(QUESTION);
    expect(record.generation).toBe("scripted");
    // The same question over the same corpus is the DEMO's meeting, exactly.
    expect(record.meeting_id).toBe(demoMeeting.meeting_id);
  });
  it("refuses malformed, oversized, cross-site and unknown requests before the runtime is asked", async () => {
    const handle = local();
    const statuses = await Promise.all([
      handle(post("meeting", { ...meetingRequest(), extra: 1 }), meta),
      handle(post("meeting", { ...meetingRequest(), session: "nope" }), meta),
      handle(post("meeting", { ...meetingRequest(), question: "x".repeat(501) }), meta),
      handle(post("meeting", { ...meetingRequest(), question: "a\u202eb" }), meta),
      handle(post("meeting", "x".repeat(LIMITS.meetingRequest + 10)), meta),
      handle(post("meeting", meetingRequest(), { Origin: "https://evil.example" }), meta),
      handle(post("shell", meetingRequest()), meta),
      handle(post("../jev/decision", meetingRequest()), meta),
    ]).then((rs) => rs.map((r) => r.status));
    expect(statuses).toEqual([400, 400, 400, 400, 413, 403, 404, 404]);
  });
  it("paces sessions and caps meetings per session", async () => {
    let t = 0;
    const handle = local(() => t);
    expect((await handle(post("meeting", meetingRequest()), meta)).status).toBe(200);
    expect((await handle(post("meeting", meetingRequest()), meta)).status).toBe(429);
    let last = 0;
    for (let i = 0; i < LIMITS.meetingsPerSession + 2; i++) {
      t += 60_000;
      last = (await handle(post("meeting", meetingRequest()), { clientKey: `c${i}` }))
        .status;
    }
    expect(last).toBe(429);
  });
  it("answers a proposal with R.A.I.N.'s decision: DISABLED when routing is off", async () => {
    const handle = local();
    const options = [
      { id: "X1", description: "Metro closure at the Bethesda Metro" },
      { id: "ESCALATE_TO_HUMAN", description: "None of these tests the question." },
    ];
    const response = await handle(
      post("proposal", {
        session: SESSION,
        request_id: REQUEST,
        question: QUESTION,
        options,
      }),
      meta,
    );
    expect(response.status).toBe(200);
    const choice = (await response.json()) as {
      decision: { destination: string; selected: null; reason: string };
    };
    expect(choice.decision).toMatchObject({
      destination: "rain",
      selected: null,
      reason: "DISABLED",
    });
  });
  it("refuses a submission that brings its own verdict", async () => {
    const handle = local();
    const submission = {
      schema_version: "rain-experiment-submission/v1",
      experiment_id: "V3D-EXP-0005",
      evidence_class: "simulated",
      status: "passed",
    };
    const response = await handle(
      post("submission", {
        session: SESSION,
        request_id: REQUEST,
        experiment_id: "V3D-EXP-0005",
        submission,
      }),
      meta,
    );
    expect(response.status).toBe(400);
  });
  it("passes a registry refusal on as a bounded reason", async () => {
    const handle = local();
    const draft = Object.fromEntries(
      [
        "title",
        "question",
        "hypothesis",
        "rationale",
        "subsystem",
        "created_by",
        "evidence_class",
        "runner",
        "seed",
        "parameters",
        "procedure",
        "variables",
        "metrics",
        "criteria",
        "dependencies",
        "data_policy",
        "limitations",
      ].map((k) => [
        k,
        k === "evidence_class"
          ? "simulated"
          : k === "runner"
            ? { kind: "external" }
            : "x",
      ]),
    );
    const response = await handle(
      post("preregister", { session: SESSION, request_id: REQUEST, draft }),
      meta,
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /^R\.A\.I\.N\. refused the definition/,
    );
  });
});

/** A runtime standing in for one that holds model meetings, answering what the test says. */
function stub(answers: Partial<RuntimeApi>): RuntimeConfiguration {
  const refuse = () => {
    throw new Error("unexpected call");
  };
  const runtime: RuntimeApi = {
    identity: refuse,
    meeting: refuse,
    meetingStatus: refuse,
    meetingCancel: refuse,
    proposal: refuse,
    preregister: refuse,
    submission: refuse,
    ...answers,
  };
  return { mode: "local", runtime };
}

describe("R.A.I.N. model meetings through the route", () => {
  const JOB = "9".repeat(32);
  const pending = (extra: Record<string, unknown> = {}) => ({
    schema: "rain-bethesda/v2",
    kind: "meeting-pending",
    request_id: REQUEST,
    job_id: JOB,
    question: QUESTION,
    model: "qwen2.5:7b",
    started_at: "2026-10-03T03:43:59.086Z",
    elapsed_s: 4,
    turns_started: 1,
    turns_planned: 25,
    ...extra,
  });
  const modelMeeting = () => {
    const m = structuredClone(demoMeeting) as Record<string, unknown> & {
      turns: Record<string, unknown>[];
    };
    m.request_id = REQUEST;
    m.generation = "model";
    m.model = "qwen2.5:7b";
    m.engine = "rain.meeting.model.holdMeeting";
    m.grounding = m.matched_terms = m.missing_terms = m.verdict = null;
    m.turns.forEach((t) => (t.generation = "model"));
    m.source_artifact = {
      schema: "rain-session-artifact/v1",
      session_id: "3298be35",
      status: "completed",
      sha256: "d".repeat(64),
    };
    return m;
  };
  const status = (extra: Record<string, unknown> = {}) => ({
    session: SESSION,
    request_id: REQUEST,
    job_id: JOB,
    question: QUESTION,
    ...extra,
  });
  it("answers a meeting request with its job, then the meeting, each bound to the request", async () => {
    const calls: unknown[] = [];
    const handle = createRainHandler({
      runtime: stub({
        meeting: (question, requestId) => {
          calls.push(["meeting", question, requestId]);
          return pending();
        },
        meetingStatus: (jobId, requestId) => {
          calls.push(["status", jobId, requestId]);
          return modelMeeting();
        },
      }),
    });
    const started = await handle(post("meeting", meetingRequest()), meta);
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ kind: "meeting-pending", job_id: JOB });
    const done = await handle(post("meeting-status", status()), meta);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ kind: "meeting", generation: "model" });
    // The runtime hears the request and the job, nothing the browser added.
    expect(calls).toEqual([
      ["meeting", QUESTION, REQUEST],
      ["status", JOB, REQUEST],
    ]);
  });
  it.each<[string, unknown]>([
    [
      "a failure in answer to a new request",
      {
        schema: "rain-bethesda/v2",
        kind: "meeting-failed",
        request_id: REQUEST,
        job_id: JOB,
        reason: "x",
      },
    ],
    ["a pending job for another request", pending({ request_id: "b".repeat(32) })],
    ["a pending job for another question", pending({ question: "Is it raining?" })],
  ])("refuses %s", async (_what, answer) => {
    const handle = createRainHandler({
      runtime: stub({ meeting: () => answer }),
    });
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "invalid runtime answer" });
  });
  it.each<[string, unknown]>([
    ["a pending answer for another job", pending({ job_id: "8".repeat(32) })],
    ["a meeting for another question", { ...modelMeeting(), question: "Is it raining?" }],
    [
      "a meeting with an invented verdict",
      {
        ...modelMeeting(),
        verdict: { agreed: "", contested: "", next_move: "", read_next: [] },
        generation: "scripted",
        model: null,
      },
    ],
  ])("refuses, on a status check, %s", async (_what, answer) => {
    const handle = createRainHandler({
      runtime: stub({ meetingStatus: () => answer }),
    });
    expect((await handle(post("meeting-status", status()), meta)).status).toBe(502);
  });
  it("keeps status checks closed and paced", async () => {
    let t = 1_000_000;
    const handle = createRainHandler({
      runtime: stub({ meetingStatus: () => pending() }),
      now: () => t,
    });
    for (const bad of [
      status({ extra: 1 }),
      status({ job_id: "../../etc" }),
      { session: SESSION, request_id: REQUEST, job_id: JOB },
      status({ question: "a\u202eb" }),
    ])
      expect((await handle(post("meeting-status", bad), meta)).status).toBe(400);
    expect((await handle(post("meeting-status", status()), meta)).status).toBe(200);
    expect((await handle(post("meeting-status", status()), meta)).status).toBe(429);
    t += 2_500;
    expect((await handle(post("meeting-status", status()), meta)).status).toBe(200);
  });
  it("forwards a stop and accepts only that job's failure", async () => {
    const stopped = {
      schema: "rain-bethesda/v2",
      kind: "meeting-failed",
      request_id: REQUEST,
      job_id: JOB,
      reason: "stopped at the lab's request",
    };
    const calls: unknown[] = [];
    const handle = createRainHandler({
      runtime: stub({
        meetingCancel: (jobId, requestId) => {
          calls.push([jobId, requestId]);
          return stopped;
        },
      }),
    });
    const cancel = { session: SESSION, request_id: REQUEST, job_id: JOB };
    const response = await handle(post("meeting-cancel", cancel), meta);
    expect(response.status).toBe(200);
    expect(calls).toEqual([[JOB, REQUEST]]);
    const other = createRainHandler({
      runtime: stub({
        meetingCancel: () => ({ ...stopped, job_id: "8".repeat(32) }),
      }),
    });
    expect((await other(post("meeting-cancel", cancel), meta)).status).toBe(502);
  });
  it("gives up on a runtime call that never answers, and never leaks an exception", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const hung = createRainHandler({
        runtime: stub({ proposal: () => new Promise(() => {}) }),
      });
      const options = [
        { id: "X1", description: "a" },
        { id: "ESCALATE_TO_HUMAN", description: "b" },
      ];
      const answer = hung(
        post("proposal", {
          session: SESSION,
          request_id: REQUEST,
          question: QUESTION,
          options,
        }),
        meta,
      );
      await vi.advanceTimersByTimeAsync(25_001);
      expect((await answer).status).toBe(504);
    } finally {
      vi.useRealTimers();
    }
    const throwing = createRainHandler({
      runtime: stub({
        meeting: () => {
          throw new Error("secret detail /home/user/key");
        },
      }),
    });
    const response = await throwing(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret detail");
  });
});
