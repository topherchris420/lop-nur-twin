import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import meeting from "./fixtures/demo-meeting.json" with { type: "json" };
import source from "./fixtures/demo-source.json" with { type: "json" };
import { LIMITS } from "./contracts";
import {
  normalizeQuestion,
  parseBounded,
  validateAdmission,
  validateIdentity,
  validateMeeting,
  validatePreregistration,
  validateProposalChoice,
} from "./validation";
import { canonicalJson, sha256, sha256Bytes, sha256Json } from "./sha256";
import { demoMeeting, demoProposal } from "./demo";

const clone = <T>(v: T): T => structuredClone(v);
const expected = { requestId: meeting.request_id, question: meeting.question };

describe("SHA-256 and canonical JSON", () => {
  it("matches node:crypto across lengths, including block boundaries and Unicode", () => {
    for (const text of [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "a".repeat(1000),
      "Montgomery Farm Women’s Co-operative Market — 39° N",
      "🐙".repeat(17),
    ])
      expect(sha256(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    const bytes = new Uint8Array(4099).map((_, i) => (i * 31) % 256);
    expect(sha256Bytes(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
  it("hashes JSON independently of key order and refuses non-finite numbers", () => {
    expect(sha256Json({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      sha256Json({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(() => canonicalJson({ x: NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});

describe("the DEMO recording", () => {
  it("is byte-identical to its manifest's digest and validates like any LIVE answer", () => {
    const bytes = readFileSync(new URL("./fixtures/demo-meeting.json", import.meta.url));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.snapshotSha256);
    expect(source.rain.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(source.rain.dirty).toBe(false);
    const d = demoMeeting();
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.value.generation).toBe("scripted");
    expect(d.value.model).toBeNull();
    expect(d.value.engine).toBe(source.engine);
    expect(d.value.audit.verified).toBe(d.value.audit.checked);
  });
  it("labels its proposal as a fixture that claims no R.A.I.N. decision", () => {
    const p = demoProposal();
    expect(p.ok && p.value.origin).toBe("fixture");
    expect(p.ok && p.value.rain_decision).toBeNull();
  });
});

describe("meeting validation fails closed", () => {
  it("accepts the recorded meeting bound to its request", () => {
    expect(validateMeeting(clone(meeting), expected).ok).toBe(true);
  });
  it.each([
    [
      "an unknown schema",
      (m: Record<string, unknown>) => (m.schema = "rain-bethesda/v2"),
    ],
    ["a missing schema", (m: Record<string, unknown>) => delete m.schema],
    ["an unknown field", (m: Record<string, unknown>) => (m.injected = "<img src=x>")],
    [
      "a stale request id",
      (m: Record<string, unknown>) => (m.request_id = "f".repeat(32)),
    ],
    [
      "a different question",
      (m: Record<string, unknown>) => (m.question = "Is it raining?"),
    ],
    [
      "a scripted meeting naming a model",
      (m: Record<string, unknown>) => (m.model = "gpt-x"),
    ],
    [
      "a model meeting naming none",
      (m: Record<string, unknown>) => (m.generation = "model"),
    ],
    [
      "an unknown speaker",
      (m: Record<string, unknown>) =>
        ((m.turns as { speaker: string }[])[0]!.speaker = "Mallory"),
    ],
    [
      "an audit that disagrees with its quotes",
      (m: Record<string, unknown>) => ((m.audit as { verified: number }).verified = 1),
    ],
    [
      "a path that climbs out of the corpus",
      (m: Record<string, unknown>) =>
        ((m.turns as { quotes: { source: string }[] }[])[0]!.quotes[0]!.source =
          "../../etc/passwd"),
    ],
    [
      "a source that is a URL",
      (m: Record<string, unknown>) =>
        ((m.turns as { quotes: { source: string }[] }[])[0]!.quotes[0]!.source =
          "https://evil.example/paper.md"),
    ],
    [
      "a bidirectional override in prose",
      (m: Record<string, unknown>) =>
        ((m.turns as { lead: string }[])[0]!.lead = "safe\u202etxt.exe"),
    ],
    [
      "a control character in prose",
      (m: Record<string, unknown>) =>
        ((m.turns as { coda: string }[])[0]!.coda = "a\u0007b"),
    ],
    ["no turns", (m: Record<string, unknown>) => (m.turns = [])],
    [
      "turns out of order",
      (m: Record<string, unknown>) => ((m.turns as { index: number }[])[0]!.index = 3),
    ],
    ["not an object", () => undefined],
  ])("rejects %s", (_label, mutate) => {
    const m = clone(meeting) as unknown as Record<string, unknown>;
    const out = mutate(m);
    const r = validateMeeting(
      out === undefined && _label === "not an object" ? [m] : m,
      expected,
    );
    expect(r.ok).toBe(false);
  });
  it("rejects oversized payloads before parsing them", () => {
    const big = JSON.stringify({ ...meeting, pad: "x".repeat(LIMITS.meetingResponse) });
    expect(parseBounded(big, LIMITS.meetingResponse).ok).toBe(false);
    expect(parseBounded("{not json", 100).ok).toBe(false);
  });
  it("normalizes whitespace exactly as the bridge does", () => {
    expect(normalizeQuestion("  a \n\t b  ")).toBe("a b");
  });
});

describe("other R.A.I.N. answers fail closed", () => {
  const identity = {
    schema: "rain-bethesda/v1",
    kind: "identity",
    bridge: { name: "rain-bethesda-bridge", version: "1" },
    rain: {
      repository: "topherchris420/james_library",
      commit: "9".repeat(40),
      dirty: false,
    },
    corpus: { files: 17, sha256: "a".repeat(64) },
    meeting_engine: "james_library.launcher.offline_meeting.build_offline_meeting",
    meeting_generation: "scripted",
    model: null,
    bounded_decision: "off",
    registry: { available: true, scratch: true },
  };
  it("identity: closed, consistent about models, from the right repository", () => {
    expect(validateIdentity(identity).ok).toBe(true);
    expect(validateIdentity({ ...identity, model: "m" }).ok).toBe(false);
    expect(
      validateIdentity({ ...identity, rain: { ...identity.rain, repository: "x/y" } }).ok,
    ).toBe(false);
    expect(validateIdentity({ ...identity, shell: "rm -rf /" }).ok).toBe(false);
  });
  const choice = (selected: string | null, extra: Record<string, unknown> = {}) => ({
    schema: "rain-bethesda/v1",
    kind: "proposal-choice",
    request_id: "a".repeat(32),
    decision: {
      schema_version: "rain-bounded-decision/v1",
      decision_id: "f01bc094-730a-47b7-8433-efb129e1270a",
      destination: selected ? "proposal" : "rain",
      selected,
      reason: selected ? null : "DISABLED",
      envelope_hash: "e".repeat(64),
      attempts: 0,
      latency_ms: 0.6,
      ...extra,
    },
  });
  const bound = { requestId: "a".repeat(32), optionIds: ["X1", "ESCALATE_TO_HUMAN"] };
  it("a bounded choice must be one of the options the host offered", () => {
    expect(validateProposalChoice(choice(null), bound).ok).toBe(true);
    expect(validateProposalChoice(choice("X1"), bound).ok).toBe(true);
    expect(validateProposalChoice(choice("X99"), bound).ok).toBe(false);
    expect(validateProposalChoice(choice("X1", { destination: "rain" }), bound).ok).toBe(
      false,
    );
    expect(validateProposalChoice(choice("X1", { code: "eval()" }), bound).ok).toBe(
      false,
    );
    expect(
      validateProposalChoice(choice("X1"), { ...bound, requestId: "b".repeat(32) }).ok,
    ).toBe(false);
  });
  const admission = (status: string, verdict: string, evaluation: unknown) => ({
    schema: "rain-bethesda/v1",
    kind: "admission",
    request_id: "a".repeat(32),
    run_id: "V3D-EXP-0005-RUN-0001",
    status,
    hypothesis_verdict: verdict,
    evaluation,
    interpretation: { deterministic: "Failure criterion triggered: F1.", model: null },
    definition_sha256: "d".repeat(64),
    recorded_at: "2026-10-02T23:40:00.000Z",
  });
  const evaluation = {
    rule: "rain-criteria/v1",
    guards: [],
    success: [{ id: "S1", metric: "m", op: ">=", value: 1, observed: 0, holds: false }],
    failure: [{ id: "F1", metric: "m", op: "<=", value: 0, observed: 0, holds: true }],
    summary: "Failure criterion triggered: F1. The hypothesis is not supported.",
  };
  const forRun = { requestId: "a".repeat(32), experimentId: "V3D-EXP-0005" };
  it("an admission must be internally consistent and bound to its experiment", () => {
    expect(
      validateAdmission(admission("failed", "not_supported", evaluation), forRun).ok,
    ).toBe(true);
    expect(
      validateAdmission(admission("failed", "supported", evaluation), forRun).ok,
    ).toBe(false);
    expect(
      validateAdmission(admission("error", "not_evaluated", evaluation), forRun).ok,
    ).toBe(false);
    expect(
      validateAdmission(admission("failed", "not_supported", evaluation), {
        ...forRun,
        experimentId: "V3D-EXP-0006",
      }).ok,
    ).toBe(false);
    const withModel = {
      ...admission("failed", "not_supported", evaluation),
      interpretation: { deterministic: "x", model: { text: "trust me" } },
    };
    expect(validateAdmission(withModel, forRun).ok).toBe(false);
  });
  it("a pre-registration must carry a R.A.I.N. experiment id for this request", () => {
    const p = {
      schema: "rain-bethesda/v1",
      kind: "preregistration",
      request_id: "a".repeat(32),
      experiment_id: "V3D-EXP-0005",
      experiment_version: 1,
      definition_sha256: "d".repeat(64),
      created_at: "2026-10-02T23:40:00.000Z",
      registry: "scratch",
    };
    expect(validatePreregistration(p, { requestId: "a".repeat(32) }).ok).toBe(true);
    expect(
      validatePreregistration(
        { ...p, experiment_id: "EXP-1" },
        { requestId: "a".repeat(32) },
      ).ok,
    ).toBe(false);
    expect(validatePreregistration(p, { requestId: "c".repeat(32) }).ok).toBe(false);
  });
});
