import { describe, expect, it } from "vitest";
import {
  approve,
  admitStanding,
  begin,
  complete,
  openCase,
  refuseByPolicy,
} from "./cases";
import type { Origin } from "./cases";
import { RunRefused, runExperiment, runToCompletion } from "./runner";
import { verifyRecordSync } from "./replay";
import { recordDigestOK, seal, type ExperimentRecord } from "./record";
import { rainSubmission } from "./submission";
import { validateExperiment } from "./experiments";
import {
  PANELS,
  SEED_PANELS,
  admit,
  authorizeCharter,
  autonomousProposal,
  budgetsWithin,
  buildCharter,
  charterSha256,
  designSha256,
  verifyCharterAuthorization,
  verifyStanding,
  type AdmissionRequest,
  type Ceilings,
  type Charter,
  type StandingAuthority,
} from "./standing";
import { submissionErrors } from "../../rain/experiments/schema";

const ceilings: Ceilings = {
  iterations: 4,
  experiments: 3,
  runtime_ms: 600_000,
  failed_proposals: 3,
  model_calls: 20,
  model_tokens: null,
};
const charter: Charter = buildCharter({
  ceilings,
  model: {
    provider: "ollama",
    model: "fixture-model",
    endpoint: "http://127.0.0.1:11434",
  },
  validHours: 24,
});
const sha = charterSha256(charter);
const T0 = new Date("2026-10-08T12:00:00Z");
const authorization = (() => {
  const a = authorizeCharter({
    charter,
    operator: "R.A.I.N.Operator",
    typedPrefix: sha.slice(0, 8),
    reviewed: true,
    now: T0,
  });
  if (!a.ok) throw new Error(a.errors.join("; "));
  return a.value;
})();
const origin: Origin = {
  rain: null,
  rainSource: "unavailable",
  model: "fixture-model",
  provider: "ollama",
};
const decision = { decision_id: "RS-test-d1", decision_sha256: "d".repeat(64) };
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** Open the case the host writes for a design and ask the policy about it. */
function ask(designId: string, overrides: Partial<AdmissionRequest> = {}) {
  const proposal = autonomousProposal(designId, {
    decision_id: decision.decision_id,
    envelope_hash: decision.decision_sha256,
  });
  const c = openCase(proposal, { id: designId, now: at(1), origin });
  const budgets = budgetsWithin(ceilings, {});
  if (!budgets.ok) throw new Error("budgets");
  const verdict = admit({
    charter,
    authorization,
    sessionId: "RS-test",
    iteration: 1,
    decision,
    designId,
    validated: c.validated,
    measured: new Map(),
    experimentsThisSession: 0,
    budgets: budgets.value,
    runtimeLeftMs: 60_000,
    now: at(1),
    ...overrides,
  });
  return { c, verdict };
}
const failed = (rules: { id: string; ok: boolean }[]) =>
  rules.filter((r) => !r.ok).map((r) => r.id);

describe("the charter a person reviews", () => {
  it("lists every host option in both directions on both seed panels, each by what would run", () => {
    expect(charter.designs).toHaveLength(11 * 2 * 2);
    const ids = new Set(charter.designs.map((d) => d.design_id));
    expect(ids.size).toBe(charter.designs.length);
    expect(new Set(charter.designs.map((d) => d.design_sha256)).size).toBe(
      charter.designs.length,
    );
    for (const d of charter.designs) {
      expect(d.seeds).toEqual([...SEED_PANELS[d.panel]]);
      expect(d.simulated_ticks).toBe(3 * 2 * 1500);
    }
    expect(PANELS).toEqual(["primary", "replication"]);
    // The replication panel shares no seed with the primary one.
    expect(
      SEED_PANELS.primary.some((s) => SEED_PANELS.replication.includes(s as never)),
    ).toBe(false);
  });
  it("is deterministic: the same build writes the same charter", () => {
    expect(
      charterSha256(
        buildCharter({ ceilings, model: { ...charter.model }, validHours: 24 }),
      ),
    ).toBe(sha);
  });
  it("names a design by what runs, never by what it is called", () => {
    const a = validateExperiment(
      autonomousProposal("X2-increase-primary", {
        decision_id: "aaaa",
        envelope_hash: "a".repeat(64),
      }),
    );
    const b = validateExperiment(
      autonomousProposal("X2-increase-primary", {
        decision_id: "bbbb",
        envelope_hash: "b".repeat(64),
      }),
    );
    if (!a.ok || !b.ok) throw new Error("must validate");
    expect(a.value.definitionSha256).not.toBe(b.value.definitionSha256);
    expect(designSha256(a.value.definition)).toBe(designSha256(b.value.definition));
    const edited = structuredClone(a.value.definition);
    edited.seeds = [101, 202, 304];
    expect(designSha256(edited)).not.toBe(designSha256(a.value.definition));
  });
  it("changes digest when its model, ceilings or validity change, so a person must authorize it again", () => {
    for (const other of [
      buildCharter({
        ceilings,
        model: { ...charter.model, model: "other" },
        validHours: 24,
      }),
      buildCharter({
        ceilings: { ...ceilings, experiments: 4 },
        model: charter.model,
        validHours: 24,
      }),
      buildCharter({ ceilings, model: charter.model, validHours: 48 }),
    ])
      expect(verifyCharterAuthorization(authorization, other)).toContain(
        "authorization is for a different charter",
      );
  });
});

describe("authorizing a charter takes the lab's ritual", () => {
  const base = {
    charter,
    operator: "R.A.I.N.Operator",
    typedPrefix: sha.slice(0, 8),
    reviewed: true,
    now: T0,
  };
  it("refuses a wrong prefix, a skipped review or a name for a role", () => {
    expect(authorizeCharter({ ...base, typedPrefix: "00000000" }).ok).toBe(false);
    expect(authorizeCharter({ ...base, reviewed: false }).ok).toBe(false);
    expect(
      authorizeCharter({ ...base, operator: "Jane Doe <jane@example.com>" }).ok,
    ).toBe(false);
  });
  it("is a local attestation that expires with the charter's validity", () => {
    expect(verifyCharterAuthorization(authorization, charter)).toEqual([]);
    expect(authorization.identity_verified).toBe(false);
    expect(
      Date.parse(authorization.expires_at) - Date.parse(authorization.authorized_at),
    ).toBe(24 * 3_600_000);
  });
  it("refuses a tampered record", () => {
    for (const edit of [
      { operator: "Someone" },
      { identity_verified: true },
      { expires_at: "2027-01-01T00:00:00.000Z" },
      { extra: 1 },
    ])
      expect(
        verifyCharterAuthorization({ ...authorization, ...edit }, charter).length,
      ).toBeGreaterThan(0);
  });
  it("a session may lower the ceilings, never raise them", () => {
    expect(budgetsWithin(ceilings, { iterations: 2 }).ok).toBe(true);
    const over = budgetsWithin(ceilings, { iterations: 5 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors[0]).toMatch(/exceeds the charter's ceiling of 4/);
  });
});

describe("the autonomy policy", () => {
  it("admits a listed, validated, unmeasured design within budget, reporting every rule", () => {
    const { verdict } = ask("X1-increase-primary");
    expect(verdict.ok).toBe(true);
    expect(verdict.rules.map((r) => r.id)).toEqual([
      "charter-authorized",
      "design-listed",
      "validated",
      "design-digest",
      "host-written",
      "fresh-seeds",
      "experiment-budget",
      "runtime-budget",
    ]);
  });
  it("refuses without an authorization, after it expires, or before the session's budgets allow", () => {
    expect(
      failed(ask("X1-increase-primary", { authorization: null }).verdict.rules),
    ).toEqual(["charter-authorized"]);
    expect(
      failed(ask("X1-increase-primary", { now: at(24 * 60 + 1) }).verdict.rules),
    ).toEqual(["charter-authorized"]);
    expect(
      failed(ask("X1-increase-primary", { experimentsThisSession: 3 }).verdict.rules),
    ).toEqual(["experiment-budget"]);
    expect(
      failed(ask("X1-increase-primary", { runtimeLeftMs: 0 }).verdict.rules),
    ).toEqual(["runtime-budget"]);
  });
  it("refuses a design the charter does not list", () => {
    const { verdict } = ask("X1-increase-primary", { designId: "X12-increase-primary" });
    expect(failed(verdict.rules)).toContain("design-listed");
  });
  it("refuses to measure seeds twice: the same design, or the other direction on the same panel", () => {
    const measured = new Map([["X1:primary", "X1-increase-primary"]]);
    const again = ask("X1-increase-primary", { measured }).verdict;
    expect(failed(again.rules)).toEqual(["fresh-seeds"]);
    expect(again.rules.find((r) => r.id === "fresh-seeds")!.detail).toMatch(
      /already run/,
    );
    const flipped = ask("X1-decrease-primary", { measured }).verdict;
    expect(failed(flipped.rules)).toEqual(["fresh-seeds"]);
    expect(flipped.rules.find((r) => r.id === "fresh-seeds")!.detail).toMatch(
      /seeds it has not seen/,
    );
    expect(ask("X1-decrease-replication", { measured }).verdict.ok).toBe(true);
  });
  it("refuses a proposal whose words are not the host's: a model never writes a definition", () => {
    const proposal = autonomousProposal("X1-increase-primary", {
      decision_id: decision.decision_id,
      envelope_hash: decision.decision_sha256,
    })!;
    const c = openCase(
      {
        ...proposal,
        hypothesis: "The model is certain closing the Metro empties the street.",
      },
      { id: "model-words", now: at(1), origin },
    );
    const budgets = budgetsWithin(ceilings, {});
    if (!budgets.ok) throw new Error("budgets");
    const verdict = admit({
      charter,
      authorization,
      sessionId: "RS-test",
      iteration: 1,
      decision,
      designId: "X1-increase-primary",
      validated: c.validated,
      measured: new Map(),
      experimentsThisSession: 0,
      budgets: budgets.value,
      runtimeLeftMs: 60_000,
      now: at(1),
    });
    expect(failed(verdict.rules)).toEqual(["host-written"]);
  });
  it("records a refusal as a REJECTED case, which never runs", () => {
    const { c, verdict } = ask("X1-increase-primary", { authorization: null });
    expect(verdict.ok).toBe(false);
    expect(refuseByPolicy(c, ["charter-authorized"], at(2))).toBe(true);
    expect(c.record?.outcome.state).toBe("REJECTED");
    expect(c.record?.lifecycle.at(-1)?.detail).toMatch(/refused by the autonomy policy/);
    expect(begin(c, at(2))).not.toEqual([]);
  });
});

describe("a run under a standing authority", () => {
  const { c, verdict } = ask("X1-increase-primary");
  if (!verdict.ok) throw new Error("must admit");
  const standing = verdict.standing;
  const v = c.validated!;
  it("goes through the lifecycle, saying the approval was the charter's", () => {
    expect(admitStanding(c, standing, at(2))).toEqual({ ok: true });
    expect(c.lifecycle.history.map((t) => t.state)).toEqual([
      "PROPOSED",
      "VALIDATED",
      "AWAITING_HUMAN_APPROVAL",
      "AUTHORIZED",
    ]);
    expect(c.lifecycle.history.at(-1)!.detail).toMatch(/not reviewed on its own/);
  });
  it("is refused for any other definition, a doctored bundle, or after the charter expires", () => {
    const other = validateExperiment(
      autonomousProposal("X1-increase-replication", {
        decision_id: decision.decision_id,
        envelope_hash: decision.decision_sha256,
      }),
    );
    if (!other.ok) throw new Error("must validate");
    expect(() =>
      runExperiment(
        other.value.definition,
        other.value.definitionSha256,
        other.value.experimentId,
        standing,
      ).next(),
    ).toThrow(RunRefused);
    const doctored: StandingAuthority = structuredClone(standing);
    doctored.charter.designs.find((d) => d.design_id === "X1-increase-primary")!.seeds = [
      1,
    ];
    expect(
      verifyStanding(doctored, v.experimentId, v.definition, v.definitionSha256),
    ).toContain("authorization is for a different charter");
    const reruled: StandingAuthority = structuredClone(standing);
    reruled.admission.rules[0]!.ok = false;
    expect(
      verifyStanding(reruled, v.experimentId, v.definition, v.definitionSha256).length,
    ).toBeGreaterThan(0);
    expect(
      verifyStanding(standing, v.experimentId, v.definition, v.definitionSha256, {
        now: at(24 * 60 + 5),
      }),
    ).toContain(`the charter's authorization expired at ${authorization.expires_at}`);
  });
  it("runs, seals a v3 record carrying it, and replays without a clock, after expiry too", () => {
    expect(begin(c, at(3))).toEqual([]);
    const result = runToCompletion(
      v.definition,
      v.definitionSha256,
      v.experimentId,
      standing,
    );
    const record = complete(c, result, { started: at(3), finished: at(4) });
    expect(record.schema).toBe("bethesda-rain-experiment-record/v3");
    expect(record.authorization).toBeNull();
    expect(record.standing?.admission.design_id).toBe("X1-increase-primary");
    expect(record.provenance).toMatchObject({
      provider: "ollama",
      model: "fixture-model",
    });
    // The DEMO's design, on the DEMO's seeds: the simulator says the cohort comes closer.
    expect(record.outcome.verdict).toBe("not_supported");
    const verified = verifyRecordSync(record);
    expect(verified.checks.filter((x) => !x.ok)).toEqual([]);
    expect(verified.checks.find((x) => x.id === "authorization")!.detail).toMatch(
      /standing authority/,
    );

    const both = seal({
      ...withoutDigest(record),
      authorization: personAuthorization(record),
    });
    expect(verifyRecordSync(both).checks.find((x) => x.id === "authorization")!.ok).toBe(
      false,
    );
    const resealed = structuredClone(record);
    resealed.standing!.admission.design_id = "X1-decrease-primary";
    const forged = seal(withoutDigest(resealed));
    expect(recordDigestOK(forged)).toBe(true);
    expect(verifyRecordSync(forged).ok).toBe(false);

    // Reported to the registry, the submission is one its contract accepts, and
    // the model's reading travels apart from the measurements.
    const revision = globalThis as { __LAB_REVISION__?: unknown };
    revision.__LAB_REVISION__ = { commit: "a".repeat(40), dirty: false, source: "git" };
    try {
      const again = ask("X1-increase-primary");
      if (!again.verdict.ok) throw new Error("must admit");
      expect(admitStanding(again.c, again.verdict.standing, at(5)).ok).toBe(true);
      expect(begin(again.c, at(5))).toEqual([]);
      const committed = complete(again.c, result, { started: at(5), finished: at(6) });
      const submission = rainSubmission(
        committed,
        { experimentId: "V3D-EXP-0001", experimentVersion: 1 },
        {
          models: [
            { role: "researcher", name: "fixture-model", provider: "ollama", calls: 2 },
          ],
          modelInterpretation: {
            model: "fixture-model (ollama)",
            text: "Reading: contradicts.",
          },
        },
      );
      if (!submission.ok) throw new Error(submission.errors.join("; "));
      expect(submissionErrors(submission.value)).toEqual([]);
      expect(submission.value).not.toHaveProperty("status");
      expect((submission.value.inputs as Record<string, unknown>).authorization).toMatch(
        /standing authority/,
      );
    } finally {
      delete revision.__LAB_REVISION__;
    }
  }, 120_000);
  it("cannot be admitted twice, or after a person declined the case", () => {
    expect(admitStanding(c, standing, at(7)).ok).toBe(false);
    const fresh = openCase(
      autonomousProposal("X1-increase-primary", {
        decision_id: decision.decision_id,
        envelope_hash: decision.decision_sha256,
      }),
      { id: "declined", now: at(1), origin },
    );
    approve(fresh, {
      operator: "R.A.I.N.Operator",
      typedPrefix: "00000000",
      reviewed: true,
      now: at(1),
    });
    expect(fresh.lifecycle.state).toBe("AWAITING_HUMAN_APPROVAL");
  });
});

function withoutDigest(r: ExperimentRecord) {
  const { record_sha256: _digest, ...body } = r;
  return body;
}
function personAuthorization(r: ExperimentRecord): ExperimentRecord["authorization"] {
  return {
    schema: "bethesda-experiment-authorization/v1",
    experiment_id: r.experiment_id!,
    definition_sha256: r.definition_sha256!,
    operator: "R.A.I.N.Operator",
    attestation: "local-operator",
    identity_verified: false,
    scope: "bethesda-simulation",
    confirmed_prefix: r.definition_sha256!.slice(0, 8),
    authorized_at: T0.toISOString(),
    authorization_sha256: "0".repeat(64),
  };
}
