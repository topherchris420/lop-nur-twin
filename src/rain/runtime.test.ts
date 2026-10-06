import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import source from "./data/source.json" with { type: "json" };
import { Refused } from "./errors.js";
import { MODEL_ENGINE, OFFLINE_ENGINE, RAIN_BETHESDA_SCHEMA } from "./protocol.js";
import {
  DRAFT_FIELDS,
  LAB_REPOSITORY,
  RUNTIME,
  RainRuntime,
  type RuntimeOptions,
  configureRuntime,
} from "./runtime.js";

/**
 * The in-process research runtime, as `/api/rain/*` sees it: configured from
 * an environment, refusing what it cannot serve by the setting's name, and
 * answering `rain-bethesda/v2` on every route.
 */
const ROOT = join(__dirname, "..", "..");
const REQUEST = "f".repeat(32);
const scratch: string[] = [];
const dir = (prefix: string) => {
  const path = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(path);
  return path;
};
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
});
const options = (
  env: Record<string, string | undefined>,
  extra: Partial<RuntimeOptions> = {},
): RuntimeOptions => ({
  env: { RAIN_DECISION_MODE: "off", ...env },
  cwd: ROOT,
  scratchDir: () => dir("rain-runtime-test-"),
  resolveHost: async (host) => (host === "api.example" ? ["93.184.216.34"] : []),
  ...extra,
});

const draft = () => ({
  title: "Bethesda simulation: Metro closure at Bethesda station — mean dwell",
  question: "Does a Metro closure raise dwell time near the station entrance?",
  hypothesis: "Mean dwell near the entrance rises by at least 20 s in the treatment arm.",
  rationale: "Fixture for the runtime test.",
  subsystem: {
    repository: LAB_REPOSITORY,
    component: "Bethesda city simulation (fixture)",
    paths: [],
  },
  created_by: "R.A.I.N.Operator",
  evidence_class: "simulated",
  runner: {
    kind: "external",
    repository: LAB_REPOSITORY,
    adapter: "rain-bethesda/v2 (rain-experiment-submission/v1)",
  },
  seed: null,
  parameters: { scenario: "metro_closure", seeds: [1, 2, 3] },
  procedure: [
    "Build matched arms.",
    "Inject the closure into the treatment arm.",
    "Report the differences.",
  ],
  variables: {
    independent: ["closure injected"],
    dependent: ["delta_mean_dwell_s"],
    controls: ["same seed"],
  },
  metrics: [
    {
      name: "delta_mean_dwell_s",
      unit: "s",
      description: "treatment minus control mean dwell",
      deterministic: true,
    },
    {
      name: "cohort",
      unit: "",
      description: "pedestrians in the cohort",
      deterministic: true,
    },
  ],
  criteria: {
    guards: [{ id: "G1", metric: "cohort", op: ">=", value: 10 }],
    success: [{ id: "S1", metric: "delta_mean_dwell_s", op: ">=", value: 20 }],
    failure: [{ id: "F1", metric: "delta_mean_dwell_s", op: "<", value: 0 }],
  },
  dependencies: [],
  data_policy: { classification: "public", store_artifacts: false },
  limitations: ["Simulated."],
});
const submission = (
  experimentId: string,
  measurements: Record<string, number> = { delta_mean_dwell_s: 42.5, cohort: 36 },
) => ({
  schema_version: "rain-experiment-submission/v1",
  experiment_id: experimentId,
  experiment_version: 1,
  evidence_class: "simulated",
  started_at: "2026-10-06T01:00:00Z",
  finished_at: "2026-10-06T01:00:30Z",
  seed: 1,
  parameters: { scenario: "metro_closure" },
  inputs: {},
  measurements,
  series: { delta_mean_dwell_s: [40, 45, 42.5] },
  observations: [],
  limitations: [],
  artifacts: [],
  models: [],
  provenance: {
    producer: "lop-nur-twin Bethesda simulator",
    repository: LAB_REPOSITORY,
    commit: "0".repeat(40),
    dirty: false,
  },
});
const demo = JSON.parse(
  readFileSync(
    join(ROOT, "src", "bethesda", "rain", "fixtures", "demo-meeting.json"),
    "utf8",
  ),
) as { question: string; meeting_id: string };

describe("runtime configuration", () => {
  it("is off when told, and misconfigured by the setting's name otherwise", async () => {
    expect(await configureRuntime(options({ RAIN_RUNTIME: "off" }))).toEqual({
      mode: "off",
    });
    const cases: [Record<string, string>, RegExp][] = [
      [{ RAIN_RUNTIME: "maybe" }, /^RAIN_RUNTIME must be local or off$/],
      [{ RAIN_DECISION_MODE: "laya" }, /Laya worker/],
      [{ RAIN_DECISION_MODE: "cascade" }, /Laya worker/],
      [
        { RAIN_MEETING_ENGINE: "typewriter" },
        /RAIN_MEETING_ENGINE must be offline or model/,
      ],
      [
        { RAIN_MEETING_ENGINE: "model", VERCEL: "1", RAIN_LLM_MODEL: "qwen2.5:7b" },
        /one long-lived server process/,
      ],
      [{ RAIN_MEETING_ENGINE: "model" }, /RAIN_LLM_MODEL must name/],
      [
        { RAIN_MEETING_ENGINE: "model", RAIN_LLM_MODEL: "http://x/m" },
        /RAIN_LLM_MODEL must name/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_LLM_BASE_URL: "ftp://x",
        },
        /http\(s\) URL/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_LLM_BASE_URL: "http://u:p@127.0.0.1/v1",
        },
        /without credentials/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_MEETING_PRIVACY: "open",
        },
        /RAIN_MEETING_PRIVACY must be local or hybrid/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_LLM_BASE_URL: "https://api.example/v1",
        },
        /not loopback or private-network/,
      ],
      [
        { RAIN_MEETING_ENGINE: "model", RAIN_LLM_MODEL: "qwen2.5:cloud" },
        /':cloud' models run on a hosted service/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_MEETING_TURNS: "99",
        },
        /RAIN_MEETING_TURNS must be an integer from 1 to 30/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_MEETING_TIMEOUT_MIN: "1",
        },
        /RAIN_MEETING_TIMEOUT_MIN must be an integer from 5 to 60/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_LM_TIMEOUT: "10",
        },
        /RAIN_LM_TIMEOUT must be an integer from 30 to 3600/,
      ],
      [
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "qwen2.5:7b",
          RAIN_MEETING_RECURSION: "sometimes",
        },
        /RAIN_MEETING_RECURSION must be true or false/,
      ],
      [
        { RAIN_DECISION_MODE: "jev", RAIN_DECISION_REMOTE_ALLOWED: "please" },
        /RAIN_DECISION_REMOTE_ALLOWED must be true or false/,
      ],
      [
        { RAIN_REGISTRY_DIR: "registry", VERCEL: "1" },
        /RAIN_REGISTRY_DIR needs one disk every request reaches/,
      ],
    ];
    for (const [env, reason] of cases) {
      const configured = await configureRuntime(options(env));
      expect(configured.mode, JSON.stringify(env)).toBe("misconfigured");
      if (configured.mode === "misconfigured")
        expect(configured.reason, JSON.stringify(env)).toMatch(reason);
    }
  });

  it("refuses a short registry secret without repeating it", async () => {
    const configured = await configureRuntime(
      options({}, { secrets: { registrySecret: "shortsecret" } }),
    );
    expect(configured).toEqual({
      mode: "misconfigured",
      reason: "the registry secret must be at least 32 characters",
    });
  });

  it("builds a local runtime with nothing configured", async () => {
    const configured = await configureRuntime(options({}));
    expect(configured.mode).toBe("local");
  });
});

describe("local runtime", () => {
  it("states its identity: this repository, the bundled corpus, the offline engine, no decisions", async () => {
    const runtime = await RainRuntime.create(options({}));
    const identity = runtime.identity();
    expect(identity.schema).toBe(RAIN_BETHESDA_SCHEMA);
    expect(identity.kind).toBe("identity");
    expect(identity.runtime).toEqual(RUNTIME);
    expect(identity.rain.repository).toBe(LAB_REPOSITORY);
    expect(identity.rain.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof identity.rain.dirty).toBe("boolean");
    expect(identity.corpus).toEqual({
      files: source.corpus.files,
      sha256: source.corpus.fingerprintSha256,
    });
    expect(identity.meeting_engine).toBe(OFFLINE_ENGINE);
    expect(identity.meeting_generation).toBe("scripted");
    expect(identity.model).toBeNull();
    expect(identity.bounded_decision).toBe("off");
    expect(identity.remote_decisions).toBe(false);
    expect(identity.registry).toEqual({ available: true, scratch: true, reason: null });
    expect(runtime.meetingRunning).toBe(false);
  });

  it("reports the CI commit when the platform states one", async () => {
    const runtime = await RainRuntime.create(
      options({ VERCEL_GIT_COMMIT_SHA: "e".repeat(40) }),
    );
    expect(runtime.identity().rain).toEqual({
      repository: LAB_REPOSITORY,
      commit: "e".repeat(40),
      dirty: null,
    });
  });

  it("holds the offline meeting in-process: the DEMO question is the DEMO meeting", async () => {
    const runtime = await RainRuntime.create(options({}));
    const record = runtime.meeting(demo.question, REQUEST);
    expect(record.kind).toBe("meeting");
    if (record.kind !== "meeting") throw new Error("unreachable");
    expect(record.meeting_id).toBe(demo.meeting_id);
    expect(record.request_id).toBe(REQUEST);
    expect(record.engine).toBe(OFFLINE_ENGINE);
    expect(record.generation).toBe("scripted");
    expect(record.rain.repository).toBe(LAB_REPOSITORY);
    expect(() => runtime.meetingStatus("job", REQUEST)).toThrow(
      /holds no model meetings/,
    );
    expect(() => runtime.meetingCancel("job", REQUEST)).toThrow(Refused);
  });

  it("answers a proposal with R.A.I.N.'s decision, DISABLED while routing is off", async () => {
    const runtime = await RainRuntime.create(options({}));
    const answer = await runtime.proposal(
      "Does a closure change dwell time?",
      [
        { id: "metro_closure_dwell", description: "Close the Metro; measure dwell." },
        { id: "festival_density", description: "Hold a festival; measure density." },
      ],
      REQUEST,
    );
    expect(answer.kind).toBe("proposal-choice");
    expect(answer.request_id).toBe(REQUEST);
    expect(answer.decision).toMatchObject({
      schema_version: "rain-bounded-decision/v1",
      destination: "rain",
      selected: null,
      reason: "DISABLED",
      attempts: [],
    });
    expect(answer.decision.envelope_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pre-registers the lab's draft and admits a run against it", async () => {
    const runtime = await RainRuntime.create(options({}));
    const registered = runtime.preregister(draft(), REQUEST);
    expect(registered).toMatchObject({
      kind: "preregistration",
      request_id: REQUEST,
      experiment_id: "V3D-EXP-0001",
      experiment_version: 1,
      registry: "scratch",
    });
    expect(registered.definition_sha256).toMatch(/^[0-9a-f]{64}$/);
    const admitted = runtime.submission(
      "V3D-EXP-0001",
      submission("V3D-EXP-0001"),
      REQUEST,
    );
    expect(admitted).toMatchObject({
      kind: "admission",
      request_id: REQUEST,
      run_id: "V3D-EXP-0001-RUN-0001",
      status: "passed",
      hypothesis_verdict: "supported",
      definition_sha256: registered.definition_sha256,
      interpretation: { model: null },
    });
    expect((admitted.evaluation as { rule: string }).rule).toBe("rain-criteria/v1");
    expect(admitted.interpretation.deterministic).toContain("Simulated data");
    const failed = runtime.submission(
      "V3D-EXP-0001",
      { ...submission("V3D-EXP-0001", { delta_mean_dwell_s: -3, cohort: 36 }), seed: 2 },
      REQUEST,
    );
    expect([failed.status, failed.hypothesis_verdict]).toEqual([
      "failed",
      "not_supported",
    ]);
    expect(() =>
      runtime.submission("V3D-EXP-0001", submission("V3D-EXP-0001"), REQUEST),
    ).toThrow(
      /R\.A\.I\.N\. refused the submission: This submission is already recorded as V3D-EXP-0001-RUN-0001/,
    );
    expect(() =>
      runtime.submission("V3D-EXP-0002", submission("V3D-EXP-0002"), REQUEST),
    ).toThrow(/not registered/);
    expect(runtime.preregister(draft(), REQUEST).experiment_id).toBe("V3D-EXP-0002");
  });

  it("admits a run on another instance that shares the key, against the certified definition", async () => {
    const secrets = { registrySecret: "k".repeat(40) };
    const a = await RainRuntime.create(options({ VERCEL: "1" }, { secrets }));
    const b = await RainRuntime.create(options({ VERCEL: "1" }, { secrets }));
    expect(b.identity().registry).toEqual({
      available: true,
      scratch: true,
      reason: null,
    });
    const registered = a.preregister(draft(), REQUEST);
    expect(registered.certificate).toMatch(/^[0-9a-f]{64}$/);
    const receipt = {
      draft: draft(),
      created_at: registered.created_at,
      certificate: registered.certificate,
    };
    // b never saw the pre-registration, and numbers an experiment of its own
    // V3D-EXP-0001 too: the run must be judged against a's, not b's.
    expect(() =>
      b.submission("V3D-EXP-0001", submission("V3D-EXP-0001"), REQUEST),
    ).toThrow(/not registered/);
    b.preregister(
      { ...draft(), hypothesis: "Mean dwell falls near the entrance." },
      REQUEST,
    );
    const admitted = b.submission(
      "V3D-EXP-0001",
      submission("V3D-EXP-0001"),
      REQUEST,
      receipt,
    );
    expect(admitted).toMatchObject({
      run_id: "V3D-EXP-0001-RUN-0001",
      status: "passed",
      hypothesis_verdict: "supported",
      definition_sha256: registered.definition_sha256,
    });
    expect(() =>
      b.submission("V3D-EXP-0001", submission("V3D-EXP-0001"), REQUEST, receipt),
    ).toThrow(/already recorded as V3D-EXP-0001-RUN-0001/);
    // The instance that registered it admits it the ordinary way, receipt or not.
    expect(
      a.submission("V3D-EXP-0001", submission("V3D-EXP-0001"), REQUEST, receipt),
    ).toMatchObject({ run_id: "V3D-EXP-0001-RUN-0001", status: "passed" });
  });

  it("refuses a pre-registration its certificate does not vouch for", async () => {
    const secrets = { registrySecret: "k".repeat(40) };
    const a = await RainRuntime.create(options({}, { secrets }));
    const b = await RainRuntime.create(options({}, { secrets }));
    const other = await RainRuntime.create(
      options({}, { secrets: { registrySecret: "o".repeat(40) } }),
    );
    const registered = a.preregister(draft(), REQUEST);
    const receipt = {
      draft: draft(),
      created_at: registered.created_at,
      certificate: registered.certificate,
    };
    const refusal = (runtime: RainRuntime, r: typeof receipt) => {
      try {
        runtime.submission("V3D-EXP-0001", submission("V3D-EXP-0001"), REQUEST, r);
      } catch (error) {
        return error as Refused;
      }
      throw new Error("accepted");
    };
    const forged = { status: 422, code: expect.stringMatching(/does not verify/) };
    // Another deployment's key; the criteria changed after registration; a
    // backdated registration; an invented or malformed certificate.
    expect(refusal(other, receipt)).toMatchObject(forged);
    expect(
      refusal(b, { ...receipt, draft: { ...draft(), hypothesis: "Mean dwell falls." } }),
    ).toMatchObject(forged);
    expect(
      refusal(b, { ...receipt, created_at: "2020-01-01T00:00:00.000Z" }),
    ).toMatchObject(forged);
    expect(refusal(b, { ...receipt, certificate: "0".repeat(64) })).toMatchObject(forged);
    expect(refusal(b, { ...receipt, certificate: "not hex" })).toMatchObject(forged);
    // A configured registry is the record: it admits only what it holds.
    const configured = await RainRuntime.create(
      options({ RAIN_REGISTRY_DIR: dir("rain-registry-test-") }, { secrets }),
    );
    expect(refusal(configured, receipt)).toMatchObject({
      status: 422,
      code: "V3D-EXP-0001 is not in this registry with that definition",
    });
  });

  it("takes no pre-registration on a function deployment without a registry key", async () => {
    const runtime = await RainRuntime.create(options({ VERCEL: "1" }));
    expect(runtime.identity().registry).toMatchObject({
      available: false,
      scratch: true,
      reason: expect.stringMatching(/runs functions/),
    });
    expect(() => runtime.preregister(draft(), REQUEST)).toThrow(Refused);
    try {
      runtime.preregister(draft(), REQUEST);
    } catch (error) {
      expect(error).toMatchObject({
        status: 503,
        code: expect.stringMatching(/^the registry is not available: /),
      });
    }
  });

  it("refuses drafts that are not the lab's, before the registry sees them", async () => {
    const runtime = await RainRuntime.create(options({}));
    const refusal = (value: unknown) => {
      try {
        runtime.preregister(value, REQUEST);
      } catch (error) {
        return error as Refused;
      }
      throw new Error("accepted");
    };
    expect(refusal(null)).toMatchObject({
      status: 400,
      code: "draft must carry exactly the create --from fields",
    });
    expect(refusal({ ...draft(), extra: 1 })).toMatchObject({ status: 400 });
    expect(
      refusal({ ...draft(), runner: { kind: "builtin", name: "fake" } }),
    ).toMatchObject({
      status: 400,
      code: "only external, simulated experiments are registered here",
    });
    expect(refusal({ ...draft(), evidence_class: "measured" })).toMatchObject({
      status: 400,
    });
    const invalid = refusal({
      ...draft(),
      criteria: { guards: [], success: [], failure: [] },
    });
    expect(invalid.status).toBe(422);
    expect(invalid.code).toMatch(/^R\.A\.I\.N\. refused the definition: /);
    expect(Object.keys(draft()).sort()).toEqual([...DRAFT_FIELDS].sort());
  });

  it("uses a configured registry directory when given one", async () => {
    const registryDir = dir("rain-registry-test-");
    const runtime = await RainRuntime.create(options({ RAIN_REGISTRY_DIR: registryDir }));
    expect(runtime.identity().registry).toEqual({
      available: true,
      scratch: false,
      reason: null,
    });
    expect(runtime.preregister(draft(), REQUEST).registry).toBe("configured");
    expect(
      readFileSync(join(registryDir, "V3D-EXP-0001", "experiment.json"), "utf8"),
    ).toContain("V3D-EXP-0001");
  });

  it("holds model meetings as jobs when the model engine is configured", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const last = body.messages.at(-1)!.content;
      const content =
        last === "test"
          ? "ok"
          : "I would rather see the dwell-time measurement than the slogan about it. What would change our minds if the numbers came back flat?";
      return new Response(
        JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
        { status: 200 },
      );
    };
    const runtime = await RainRuntime.create(
      options(
        {
          RAIN_MEETING_ENGINE: "model",
          RAIN_LLM_MODEL: "stand-in-model",
          RAIN_LLM_BASE_URL: "http://127.0.0.1:1/v1",
          RAIN_MEETING_TURNS: "4",
          RAIN_MEETING_TIMEOUT_MIN: "5",
          RAIN_MEETING_RECURSION: "false",
        },
        { fetchImpl, sleep: async () => {} },
      ),
    );
    const identity = runtime.identity();
    expect([
      identity.meeting_engine,
      identity.meeting_generation,
      identity.model,
    ]).toEqual([MODEL_ENGINE, "model", "stand-in-model"]);
    const pending = runtime.meeting("Why do crowds wait?", REQUEST);
    expect(pending.kind).toBe("meeting-pending");
    if (pending.kind !== "meeting-pending") throw new Error("unreachable");
    expect(runtime.meetingRunning).toBe(true);
    for (
      let i = 0;
      i < 400 &&
      runtime.meetingStatus(pending.job_id, REQUEST).kind === "meeting-pending";
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    const record = runtime.meetingStatus(pending.job_id, REQUEST);
    expect(record.kind).toBe("meeting");
    if (record.kind !== "meeting") throw new Error("unreachable");
    expect(record.generation).toBe("model");
    expect(record.model).toBe("stand-in-model");
    expect(record.engine).toBe(MODEL_ENGINE);
    expect(record.turns.filter((t) => t.generation === "model")).toHaveLength(4);
    expect(record.verdict).toBeNull();
    expect(runtime.meetingRunning).toBe(false);
  });
});
