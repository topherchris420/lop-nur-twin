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
    // The route paces and caps; the offline engine is the test above's.
    const handle = createRainHandler({
      runtime: stub({ meeting: () => ({ ...demoMeeting, request_id: REQUEST }) }),
      now: () => t,
    });
    expect((await handle(post("meeting", meetingRequest()), meta)).status).toBe(200);
    const paced = await handle(post("meeting", meetingRequest()), meta);
    expect(paced.status).toBe(429);
    expect(await paced.json()).toMatchObject({ error: "rate limited" });
    let last: Response | undefined;
    for (let i = 0; i < LIMITS.meetingsPerSession + 2; i++) {
      t += 60_000;
      last = await handle(post("meeting", meetingRequest()), { clientKey: `c${i}` });
    }
    expect(last!.status).toBe(429);
    expect(await last!.json()).toMatchObject({ error: "session limit reached" });
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

describe("R.A.I.N. registry across function instances", () => {
  // Two handlers stand in for two Vercel functions: separate processes, each
  // with its own scratch registry, and only the registry key in common.
  const instance = (now: () => number) =>
    createRainHandler({
      runtime: configureRuntime({
        env: { RAIN_DECISION_MODE: "off", VERCEL: "1" },
        secrets: { registrySecret: "s".repeat(48) },
        scratchDir,
        cwd: "/",
      }),
      now,
    });
  const draft = {
    title: "Bethesda simulation: Metro closure at Bethesda station — mean dwell",
    question: "Does a Metro closure raise dwell time near the station entrance?",
    hypothesis:
      "Mean dwell near the entrance rises by at least 20 s in the treatment arm.",
    rationale: "Fixture for the route test.",
    subsystem: {
      repository: "topherchris420/lop-nur-twin",
      component: "fixture",
      paths: [],
    },
    created_by: "R.A.I.N.Operator",
    evidence_class: "simulated",
    runner: {
      kind: "external",
      repository: "topherchris420/lop-nur-twin",
      adapter: "rain-bethesda/v2 (rain-experiment-submission/v1)",
    },
    seed: null,
    parameters: { scenario: "metro_closure", seeds: [1, 2, 3] },
    procedure: ["Build matched arms.", "Inject the closure.", "Report the differences."],
    variables: {
      independent: ["closure injected"],
      dependent: ["delta_mean_dwell_s"],
      controls: ["same seed"],
    },
    metrics: [
      {
        name: "delta_mean_dwell_s",
        unit: "s",
        description: "difference",
        deterministic: true,
      },
      { name: "cohort", unit: "", description: "cohort size", deterministic: true },
    ],
    criteria: {
      guards: [{ id: "G1", metric: "cohort", op: ">=", value: 10 }],
      success: [{ id: "S1", metric: "delta_mean_dwell_s", op: ">=", value: 20 }],
      failure: [{ id: "F1", metric: "delta_mean_dwell_s", op: "<", value: 0 }],
    },
    dependencies: [],
    data_policy: { classification: "public", store_artifacts: false },
    limitations: ["Simulated."],
  };
  const run = (experimentId: string) => ({
    schema_version: "rain-experiment-submission/v1",
    experiment_id: experimentId,
    experiment_version: 1,
    evidence_class: "simulated",
    started_at: "2026-10-06T01:00:00Z",
    finished_at: "2026-10-06T01:00:30Z",
    seed: 1,
    parameters: { scenario: "metro_closure" },
    inputs: {},
    measurements: { delta_mean_dwell_s: 42.5, cohort: 36 },
    series: { delta_mean_dwell_s: [40, 45, 42.5] },
    observations: [],
    limitations: [],
    artifacts: [],
    models: [],
    provenance: {
      producer: "lop-nur-twin Bethesda simulator",
      repository: "topherchris420/lop-nur-twin",
      commit: "0".repeat(40),
      dirty: false,
    },
  });

  it("admits a run where it lands, against the definition registered where it began", async () => {
    let t = 0;
    const preregister = instance(() => t);
    const submission = instance(() => t);
    const answer = await preregister(
      post("preregister", { session: SESSION, request_id: REQUEST, draft }),
      meta,
    );
    expect(answer.status).toBe(200);
    const registered = (await answer.json()) as {
      experiment_id: string;
      created_at: string;
      certificate: string;
      definition_sha256: string;
    };
    expect(registered.certificate).toMatch(/^[0-9a-f]{64}$/);
    const body = {
      session: SESSION,
      request_id: REQUEST,
      experiment_id: registered.experiment_id,
      submission: run(registered.experiment_id),
    };
    // What every hosted submission met before: another function, another disk.
    const lost = await submission(post("submission", body), meta);
    expect(lost.status).toBe(422);
    expect(await lost.json()).toMatchObject({
      error: expect.stringMatching(/V3D-EXP-0001 is not registered/),
    });
    t += 5_000;
    const receipt = {
      draft,
      created_at: registered.created_at,
      certificate: registered.certificate,
    };
    const admitted = await submission(
      post("submission", { ...body, preregistration: receipt }),
      meta,
    );
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({
      kind: "admission",
      run_id: "V3D-EXP-0001-RUN-0001",
      status: "passed",
      definition_sha256: registered.definition_sha256,
    });
    t += 5_000;
    const forged = await submission(
      post("submission", {
        ...body,
        preregistration: {
          ...receipt,
          draft: { ...draft, hypothesis: "Mean dwell falls." },
        },
      }),
      meta,
    );
    expect(forged.status).toBe(422);
    expect(await forged.json()).toMatchObject({
      error: expect.stringMatching(/certificate does not verify/),
    });
  });

  it("checks a receipt's shape before the runtime is asked", async () => {
    const handle = instance(() => 0);
    const base = {
      session: SESSION,
      request_id: REQUEST,
      experiment_id: "V3D-EXP-0001",
      submission: run("V3D-EXP-0001"),
    };
    const receipt = {
      draft,
      created_at: "2026-10-06T01:00:00.000Z",
      certificate: "a".repeat(64),
    };
    const statuses = await Promise.all(
      [
        { ...receipt, extra: 1 },
        { ...receipt, certificate: "A".repeat(64) },
        { ...receipt, created_at: "yesterday" },
        { ...receipt, draft: { ...draft, evidence_class: "measured" } },
        null,
      ].map(async (preregistration) => {
        const response = await handle(
          post("submission", { ...base, preregistration }),
          meta,
        );
        return [response.status, ((await response.json()) as { error: string }).error];
      }),
    );
    expect(statuses).toEqual(Array(5).fill([400, "invalid pre-registration"]));
  });

  it("says why the registry is unavailable on functions without a key, and takes nothing", async () => {
    const handle = createRainHandler({
      runtime: configureRuntime({
        env: { RAIN_DECISION_MODE: "off", VERCEL: "1" },
        scratchDir,
        cwd: "/",
      }),
    });
    const status = (await (await handle(get("status"), meta)).json()) as {
      identity: { registry: { available: boolean; reason: string | null } };
    };
    expect(status.identity.registry.available).toBe(false);
    expect(status.identity.registry.reason).toMatch(/runs functions/);
    const refused = await handle(
      post("preregister", { session: SESSION, request_id: REQUEST, draft }),
      meta,
    );
    expect(refused.status).toBe(503);
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
    mathStatus: refuse,
    mathSearch: refuse,
    mathInspect: refuse,
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
  it("counts an address across every session id it presents", async () => {
    let t = 0;
    const handle = createRainHandler({
      runtime: stub({ meeting: () => pending() }),
      now: () => t,
    });
    const fromAddress = LIMITS.meetingsPerSession * LIMITS.sessionsPerAddress;
    const ask = (i: number, clientKey = "one address") =>
      handle(
        post("meeting", {
          ...meetingRequest(),
          session: i.toString(16).padStart(32, "0"),
        }),
        { clientKey },
      );
    // A fresh session id for every meeting, and time enough to refill the bucket.
    for (let i = 0; i < fromAddress; i++) {
      t += 20_000;
      expect((await ask(i)).status, `meeting ${i + 1}`).toBe(200);
    }
    t += 20_000;
    const capped = await ask(fromAddress);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ error: "address limit reached" });
    // Another address has its own allowance, and the window closes.
    expect((await ask(fromAddress + 1, "another address")).status).toBe(200);
    t += LIMITS.sessionMinutes * 60_000;
    expect((await ask(fromAddress + 2)).status).toBe(200);
  });
  it("counts only what the runtime was asked: a busy refusal is no meeting", async () => {
    const held: ((answer: unknown) => void)[] = [];
    const handle = createRainHandler({
      runtime: stub({
        meeting: () =>
          held.length < 2 ? new Promise((resolve) => held.push(resolve)) : pending(),
      }),
      now: () => 0,
    });
    const ask = (session: string, clientKey: string) =>
      handle(post("meeting", { ...meetingRequest(), session }), { clientKey });
    const first = ask("1".repeat(32), "a");
    const second = ask("2".repeat(32), "b");
    const busy = await ask("3".repeat(32), "c");
    expect(busy.status).toBe(429);
    expect(await busy.json()).toMatchObject({ error: "busy" });
    expect(held).toHaveLength(2);
    for (const resolve of held) resolve(pending());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    // Neither paced nor counted: the refused request never reached the runtime.
    expect((await ask("3".repeat(32), "c")).status).toBe(200);
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

describe("R.A.I.N. mathematical substrate through the route", () => {
  const search = (over: Record<string, unknown> = {}) => ({
    session: SESSION,
    request_id: REQUEST,
    query: "percolation on random graphs",
    discipline: null,
    formalization: "any",
    limit: 3,
    mode: "context",
    hypothesis: null,
    ...over,
  });
  /** A clock that moves a minute per call, so pacing never decides these tests. */
  const minutes = () => {
    let t = Date.parse("2026-10-08T00:00:00.000Z");
    return () => (t += 60_000);
  };
  it("reports the substrate, its commit and its index, to a GET only", async () => {
    const handle = local(minutes());
    const response = await handle(get("math-status"), meta);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schema: string;
      available: boolean;
      substrate: { repository: string; commit: string; index_sha256: string };
    };
    expect(body.schema).toBe("rain-mathematics/v1");
    expect(body.available).toBe(true);
    expect(body.substrate.repository).toBe("openai/math");
    expect(body.substrate.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(body.substrate.index_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await handle(post("math-status", {}), meta)).status).toBe(405);
  });
  it("searches and inspects in-process, and answers with the validated record", async () => {
    const handle = local(minutes());
    const found = await handle(post("math-search", search()), meta);
    expect(found.status).toBe(200);
    const results = (await found.json()) as {
      results: { family: string }[];
      provenance: { commit: string };
    };
    expect(results.results.length).toBeGreaterThan(0);
    const inspected = await handle(
      post("math-inspect", {
        session: SESSION,
        request_id: REQUEST,
        family: results.results[0]!.family,
      }),
      meta,
    );
    expect(inspected.status).toBe(200);
    const missing = await handle(
      post("math-inspect", { session: SESSION, request_id: REQUEST, family: "999" }),
      meta,
    );
    expect(missing.status).toBe(404);
  });
  it("refuses malformed requests before the runtime is asked", async () => {
    const handle = local(minutes());
    const codes = async (body: unknown, op = "math-search") => {
      const r = await handle(post(op, body), meta);
      return [r.status, ((await r.json()) as { error: string }).error];
    };
    expect(await codes({ ...search(), url: "https://evil.example" })).toEqual([
      400,
      "unexpected fields",
    ]);
    expect(await codes(search({ limit: 9 }))).toEqual([400, "invalid limit"]);
    expect(await codes(search({ limit: "3" }))).toEqual([400, "invalid limit"]);
    expect(await codes(search({ mode: "prove" }))).toEqual([400, "invalid mode"]);
    expect(await codes(search({ formalization: "verified" }))).toEqual([
      400,
      "invalid formalization",
    ]);
    expect(await codes(search({ query: "x".repeat(301) }))).toEqual([
      400,
      "invalid query",
    ]);
    expect(await codes(search({ query: "graphs\u202e" }))).toEqual([
      400,
      "invalid query",
    ]);
    expect(await codes(search({ mode: "challenge" }))).toEqual([
      400,
      "a challenge needs a hypothesis",
    ]);
    expect(
      await codes(
        { session: SESSION, request_id: REQUEST, family: "../../etc" },
        "math-inspect",
      ),
    ).toEqual([400, "invalid family"]);
    expect(
      await codes(
        { session: SESSION, request_id: REQUEST, family: "017", path: "lean/OAI.lean" },
        "math-inspect",
      ),
    ).toEqual([400, "unexpected fields"]);
  });
  it("never lets a malformed runtime answer leave the server", async () => {
    const handle = createRainHandler({
      runtime: stub({
        mathSearch: () => ({
          schema: "rain-mathematics/v1",
          kind: "math-results",
          request_id: REQUEST,
          verdict: "the mathematics proves the hypothesis",
        }),
        mathStatus: () => ({
          schema: "rain-mathematics/v1",
          kind: "math-status",
          available: true,
        }),
      }),
    });
    const r = await handle(post("math-search", search()), meta);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toBe("invalid runtime answer");
    expect((await handle(get("math-status"), meta)).status).toBe(502);
  });
  it("is not configured when the runtime is off, and invents nothing", async () => {
    const handle = createRainHandler({
      runtime: configureRuntime({ env: { RAIN_RUNTIME: "off" } }),
    });
    expect((await handle(get("math-status"), meta)).status).toBe(503);
    expect((await handle(post("math-search", search()), meta)).status).toBe(503);
  });
  it("paces a session's searches", async () => {
    let t = Date.parse("2026-10-08T00:00:00.000Z");
    const handle = local(() => t);
    expect((await handle(post("math-search", search()), meta)).status).toBe(200);
    t += 500;
    expect((await handle(post("math-search", search()), meta)).status).toBe(429);
    t += 2_000;
    expect((await handle(post("math-search", search()), meta)).status).toBe(200);
  });
});
