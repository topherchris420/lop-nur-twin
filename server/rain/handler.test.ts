import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRainHandler, resolveBackend } from "./handler";
import { LIMITS } from "../../src/bethesda/rain/contracts";

const ORIGIN = "https://lab.example.test";
const SESSION = "c".repeat(32);
const REQUEST = "a".repeat(32);
const meeting = JSON.parse(
  readFileSync(
    new URL("../../src/bethesda/rain/fixtures/demo-meeting.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const QUESTION = meeting.question as string;
const identity = {
  schema: "rain-bethesda/v2",
  kind: "identity",
  bridge: { name: "rain-bethesda-bridge", version: "1" },
  rain: {
    repository: "topherchris420/james_library",
    commit: "9c8811e343d21b8c143055f9cf549abdefa862f1",
    dirty: false,
  },
  corpus: { files: 17, sha256: "9".repeat(64) },
  meeting_engine: "james_library.launcher.offline_meeting.build_offline_meeting",
  meeting_generation: "scripted",
  model: null,
  bounded_decision: "off",
  remote_decisions: false,
  registry: { available: true, scratch: true },
};
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/rain/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path: string) =>
  new Request(`${ORIGIN}/api/rain/${path}`, { headers: { Origin: ORIGIN } });
const reply = (body: unknown, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const meta = { clientKey: "test" };
const meetingRequest = (question = QUESTION) => ({
  session: SESSION,
  request_id: REQUEST,
  question,
});

describe("R.A.I.N. route configuration", () => {
  it("accepts https or loopback http only, never credentials or queries", () => {
    expect(resolveBackend("https://rain.example.test/base/")).toBe(
      "https://rain.example.test/base",
    );
    expect(resolveBackend("http://127.0.0.1:8790")).toBe("http://127.0.0.1:8790");
    for (const bad of [
      "http://rain.example.test",
      "https://user:pass@rain.example.test",
      "https://rain.example.test/?key=1",
      "ftp://127.0.0.1",
      "javascript:alert(1)",
      "",
      undefined,
    ])
      expect(resolveBackend(bad)).toBeNull();
  });
  it("is OFFLINE without a backend and never substitutes content", async () => {
    const fetchImpl = vi.fn();
    const handle = createRainHandler({
      backendUrl: undefined,
      token: undefined,
      fetchImpl,
    });
    const status = await (await handle(get("status"), meta)).json();
    expect(status).toMatchObject({ configured: false, reachable: null, identity: null });
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "not configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("reports a misconfigured address without echoing it", async () => {
    const handle = createRainHandler({
      backendUrl: "http://internal.example.test:9000",
      token: undefined,
    });
    const text = await (await handle(get("status"), meta)).text();
    expect(JSON.parse(text)).toMatchObject({
      configured: false,
      failure: "misconfigured",
    });
    expect(text).not.toContain("internal.example.test");
  });
});

describe("R.A.I.N. route boundary", () => {
  const live = (fetchImpl: typeof fetch, token?: string) =>
    createRainHandler({ backendUrl: "http://127.0.0.1:8790", token, fetchImpl });
  it("validates identity and caches it", async () => {
    const fetchImpl = vi.fn(async () => reply(identity));
    const handle = live(fetchImpl);
    const first = await (await handle(get("status"), meta)).json();
    expect(first).toMatchObject({ configured: true, reachable: true, failure: null });
    await handle(get("status"), meta);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const bad = live(vi.fn(async () => reply({ ...identity, extra: true })));
    expect(await (await bad(get("status"), meta)).json()).toMatchObject({
      identity: null,
      failure: "invalid identity",
    });
  });
  it("forwards a server-composed meeting request and returns the validated record", async () => {
    let sent: { url: string; body: unknown; auth: string | null } | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent = {
        url: String(url),
        body: JSON.parse(String(init?.body)),
        auth: new Headers(init?.headers).get("authorization"),
      };
      return reply({ ...meeting, request_id: REQUEST });
    });
    const handle = live(fetchImpl, "bridge-secret-token");
    const response = await handle(
      post("meeting", meetingRequest(`  ${QUESTION}  `)),
      meta,
    );
    expect(response.status).toBe(200);
    const record = (await response.json()) as { question: string };
    expect(record.question).toBe(QUESTION);
    expect(sent).toEqual({
      url: "http://127.0.0.1:8790/rain-bethesda/v2/meeting",
      body: {
        schema: "rain-bethesda/v2",
        kind: "meeting-request",
        request_id: REQUEST,
        question: QUESTION,
      },
      auth: "Bearer bridge-secret-token",
    });
  });
  it("never returns the token, even in errors", async () => {
    const handle = live(
      vi.fn(async () => reply("boom", 500)),
      "bridge-secret-token",
    );
    const text = await (await handle(post("meeting", meetingRequest()), meta)).text();
    expect(text).not.toContain("bridge-secret-token");
  });
  it.each([
    [
      "an unknown schema",
      { ...meeting, request_id: REQUEST, schema: "rain-bethesda/v9" },
    ],
    ["an extra field", { ...meeting, request_id: REQUEST, injected: "<script>" }],
    ["a stale request id", { ...meeting, request_id: "b".repeat(32) }],
    [
      "a different question",
      { ...meeting, request_id: REQUEST, question: "Something else?" },
    ],
    [
      "a scripted meeting claiming a model",
      { ...meeting, request_id: REQUEST, model: "gpt-x" },
    ],
    ["not JSON", "{not json"],
  ])("rejects an upstream answer with %s", async (_label, body) => {
    const handle = live(vi.fn(async () => reply(body)));
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(502);
  });
  it("rejects an oversized upstream answer", async () => {
    const huge = {
      ...meeting,
      request_id: REQUEST,
      padding: "x".repeat(LIMITS.meetingResponse),
    };
    const handle = live(vi.fn(async () => reply(huge)));
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "upstream answer too large" });
  });
  it("maps a hung backend to a timeout", async () => {
    const handle = createRainHandler({
      backendUrl: "http://127.0.0.1:8790",
      token: undefined,
      timeoutMs: 1000,
      fetchImpl: (_u: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    });
    const response = await handle(post("meeting", meetingRequest()), meta);
    expect(response.status).toBe(504);
  });
  it("refuses malformed, oversized, cross-site and unknown requests before any upstream call", async () => {
    const fetchImpl = vi.fn(async () => reply(meeting));
    const handle = live(fetchImpl);
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("paces sessions and caps meetings per session", async () => {
    let t = 0;
    const handle = createRainHandler({
      backendUrl: "http://127.0.0.1:8790",
      token: undefined,
      now: () => t,
      fetchImpl: vi.fn(async () => reply({ ...meeting, request_id: REQUEST })),
    });
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
  it("binds a proposal choice to the options offered", async () => {
    const options = [
      { id: "X1", description: "Metro closure at the Bethesda Metro" },
      { id: "ESCALATE_TO_HUMAN", description: "None of these tests the question." },
    ];
    const choice = (selected: string | null) => ({
      schema: "rain-bethesda/v2",
      kind: "proposal-choice",
      request_id: REQUEST,
      decision: {
        schema_version: "rain-bounded-decision/v1",
        decision_id: "f01bc094-730a-47b7-8433-efb129e1270a",
        destination: selected ? "proposal" : "rain",
        selected,
        reason: selected ? null : "DISABLED",
        envelope_hash: "e".repeat(64),
        attempts: [],
        latency_ms: 0.6,
      },
    });
    const body = { session: SESSION, request_id: REQUEST, question: QUESTION, options };
    for (const [selected, status] of [
      [null, 200],
      ["X1", 200],
      ["X9", 502],
    ] as const) {
      const handle = live(vi.fn(async () => reply(choice(selected))));
      expect((await handle(post("proposal", body), meta)).status).toBe(status);
    }
  });
  it("refuses a submission that brings its own verdict", async () => {
    const fetchImpl = vi.fn();
    const handle = live(fetchImpl);
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
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("R.A.I.N. model meetings through the route", () => {
  const JOB = "9".repeat(32);
  const live = (fetchImpl: typeof fetch, now?: () => number) =>
    createRainHandler({
      backendUrl: "http://127.0.0.1:8790",
      token: undefined,
      fetchImpl,
      now,
    });
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
    const m = structuredClone(meeting) as Record<string, unknown> & {
      turns: Record<string, unknown>[];
    };
    m.request_id = REQUEST;
    m.generation = "model";
    m.model = "qwen2.5:7b";
    m.engine = "rain_lab_meeting_chat_version.RainLabOrchestrator.run_meeting";
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
    const sent: { url: string; body: unknown }[] = [];
    const answers = [pending(), modelMeeting()];
    const handle = live(
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return reply(answers.shift());
      }),
    );
    const started = await handle(post("meeting", meetingRequest()), meta);
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ kind: "meeting-pending", job_id: JOB });
    const done = await handle(post("meeting-status", status()), meta);
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ kind: "meeting", generation: "model" });
    // Upstream hears the request and the job, nothing the browser added.
    expect(sent[1]).toEqual({
      url: "http://127.0.0.1:8790/rain-bethesda/v2/meeting-status",
      body: {
        schema: "rain-bethesda/v2",
        kind: "meeting-status-request",
        request_id: REQUEST,
        job_id: JOB,
      },
    });
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
    const handle = live(vi.fn(async () => reply(answer)));
    expect((await handle(post("meeting", meetingRequest()), meta)).status).toBe(502);
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
    const handle = live(vi.fn(async () => reply(answer)));
    expect((await handle(post("meeting-status", status()), meta)).status).toBe(502);
  });
  it("keeps status checks closed and paced", async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn(async () => reply(pending()));
    const handle = live(fetchImpl, () => t);
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
    const sent: unknown[] = [];
    const stopped = {
      schema: "rain-bethesda/v2",
      kind: "meeting-failed",
      request_id: REQUEST,
      job_id: JOB,
      reason: "stopped at the lab's request",
    };
    const handle = live(
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return reply(stopped);
      }),
    );
    const cancel = { session: SESSION, request_id: REQUEST, job_id: JOB };
    const response = await handle(post("meeting-cancel", cancel), meta);
    expect(response.status).toBe(200);
    expect(sent[0]).toEqual({
      schema: "rain-bethesda/v2",
      kind: "meeting-cancel-request",
      request_id: REQUEST,
      job_id: JOB,
    });
    const other = live(vi.fn(async () => reply({ ...stopped, job_id: "8".repeat(32) })));
    expect((await other(post("meeting-cancel", cancel), meta)).status).toBe(502);
  });
  it("gives up on a hung job check or stop before its 10 s function limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const handle = createRainHandler({
        backendUrl: "http://127.0.0.1:8790",
        token: undefined,
        timeoutMs: 55_000,
        fetchImpl: (_u: unknown, init?: RequestInit) =>
          new Promise((_, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      });
      for (const [op, body] of [
        ["meeting-status", status()],
        ["meeting-cancel", { session: SESSION, request_id: REQUEST, job_id: JOB }],
      ] as const) {
        let settled = false;
        const answer = handle(post(op, body), meta).then((r) => {
          settled = true;
          return r;
        });
        await vi.advanceTimersByTimeAsync(7_999);
        expect(settled, op).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect((await answer).status, op).toBe(504);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
