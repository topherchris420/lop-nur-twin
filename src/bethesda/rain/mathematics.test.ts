import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
import { CitySimulation, PROFILES } from "../simulation";
import { createRainHandler } from "../../../server/rain/handler";
import { configureRuntime, type RainRuntime } from "../../rain/runtime";
import { Refused } from "../../rain/errors";
import { assembleDefinition } from "../../rain/experiments/registry";
import { sha256Json } from "../../rain/experiments/schema";
import { bundledIndex } from "../../rain/mathematics/bundled";
import { fixtureIndex } from "../../rain/mathematics/fixture";
import { MathematicalSubstrate } from "../../rain/mathematics/substrate";
import type { MathematicalBasisEntry } from "../../rain/mathematics/contracts";
import { approve, begin, complete, openCase, type Origin } from "./cases";
import { authorize, verifyAuthorization } from "./authorization";
import { protocolOf, validateExperiment } from "./experiments";
import {
  basisEntryFrom,
  hostReading,
  NOT_ESTABLISHED,
  readable,
  type BasisChoice,
} from "./mathematics";
import {
  validateMathRecord,
  validateMathResults,
  validateMathStatus,
  type MathRecord,
} from "./mathValidation";
import { recordDigestOK, seal, type ExperimentRecord } from "./record";
import { verifyRecordSync } from "./replay";
import { runToCompletion } from "./runner";
import { CATEGORIES, evidenceItems } from "./session";
import { rainDefinitionDraft, rainSubmission } from "./submission";
import { LabStore } from "./store";
import { resonanceView, snapshotOf, type ResonanceSnapshot } from "./resonance";

const REQ = "a".repeat(32);
const pinned = MathematicalSubstrate.load(bundledIndex());
/** An inspected record exactly as the browser receives it: the substrate's answer, validated. */
function inspected(substrate: MathematicalSubstrate, family: string): MathRecord {
  const checked = validateMathRecord(
    JSON.parse(JSON.stringify(substrate.inspectMathematicalResult({ family }, REQ))),
    { requestId: REQ, family },
  );
  if (!checked.ok) throw new Error(checked.errors.join("; "));
  return checked.value;
}
function cite(record: MathRecord, choice: Partial<BasisChoice>): MathematicalBasisEntry {
  const e = basisEntryFrom(record, {
    manuscriptPath: null,
    reasoningSummary: false,
    relation: "insufficient_context",
    assumptions: [],
    rationale: "",
    assessedBy: "person",
    ...choice,
  });
  if (!e.ok) throw new Error(e.errors.join("; "));
  return e.value;
}
/** Family 017 framed as a definition by a person, and 223 as the host rule reads it. */
const definition = cite(inspected(pinned, "017"), {
  relation: "provides_definition",
  assumptions: ["Distances the simulator reports are finite decimals."],
  rationale: "It fixes what a sharp exponent of approximation means.",
});
const hostRead = (() => {
  const r = inspected(pinned, "223");
  const h = hostReading(r.family);
  return cite(r, {
    relation: h.relation,
    rationale: h.why.slice(0, 600),
    assessedBy: "host-rule",
  });
})();
const quick = (basis: MathematicalBasisEntry[] = []) => ({
  ...structuredClone(proposal),
  seeds: [101],
  warmup_ticks: 100,
  observation_window_ticks: 300,
  mathematical_basis: structuredClone(basis),
});
const origin: Origin = { rain: null, rainSource: "unavailable", model: null };
function runCase(raw: unknown, id: string): ExperimentRecord {
  const c = openCase(raw, { id, now: new Date(), origin });
  const v = c.validated;
  if (!v) throw new Error("must validate: " + c.checks.map((k) => k.detail).join("; "));
  approve(c, {
    operator: "R.A.I.N.Operator",
    typedPrefix: v.definitionSha256.slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  begin(c, new Date());
  return complete(
    c,
    runToCompletion(v.definition, v.definitionSha256, v.experimentId, c.authorization),
    {
      started: new Date(),
      finished: new Date(),
    },
  );
}

describe("a proposal that cites mathematics", () => {
  it("validates, and the definition a person authorizes carries the basis exactly", () => {
    const v = validateExperiment(quick([definition, hostRead]));
    if (!v.ok) throw new Error(v.errors.join("; "));
    expect(v.value.definition.mathematical_basis).toEqual([definition, hostRead]);
    const check = v.value.checks.find((k) => k.id === "mathematics")!;
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(
      /Context for the hypothesis, not evidence for the outcome/,
    );
    const p = protocolOf(v.value.definition);
    expect(p.mathematics).toHaveLength(2);
    expect(p.mathematics[0]).toMatch(
      /LEAN FORMALIZATION PRESENT · NOT CHECKED HERE · provides a definition \(assessed by a person\)/,
    );
    expect(p.notEstablished).toEqual([...NOT_ESTABLISHED]);
    expect(v.value.definition.limitations.at(-1)).toMatch(
      /does not establish the simulator outcome/,
    );
  });
  it("is refused when its basis breaks a rule, naming the rule", () => {
    const unstated = { ...definition, assumptions: [] };
    const v = validateExperiment(quick([unstated]));
    expect(v.ok).toBe(false);
    expect(v.checks[0]!.detail).toMatch(/must state the assumptions/);
    const promoted = { ...hostRead, relation: "supports_hypothesis" as const };
    expect(validateExperiment(quick([promoted])).ok).toBe(false);
  });
  it("names the substrate revision in its digest: another commit is another definition, and voids the authorization", () => {
    const a = validateExperiment(quick([definition]));
    const b = validateExperiment(quick([{ ...definition, commit: "f".repeat(40) }]));
    const none = validateExperiment(quick());
    if (!a.ok || !b.ok || !none.ok) throw new Error("must validate");
    expect(new Set([a, b, none].map((x) => x.value.definitionSha256)).size).toBe(3);
    const auth = authorize({
      experimentId: a.value.experimentId,
      definitionSha256: a.value.definitionSha256,
      operator: "R.A.I.N.Operator",
      typedPrefix: a.value.definitionSha256.slice(0, 8),
      reviewed: true,
      now: new Date(),
    });
    if (!auth.ok) throw new Error("must authorize");
    expect(
      verifyAuthorization(auth.value, a.value.experimentId, a.value.definitionSha256),
    ).toEqual([]);
    expect(
      verifyAuthorization(auth.value, b.value.experimentId, b.value.definitionSha256)
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("the basis through pre-registration", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const runtime = async () => {
    const c = await configureRuntime({
      env: {},
      cwd: "/",
      scratchDir: () => {
        const d = mkdtempSync(join(tmpdir(), "rain-math-test-"));
        dirs.push(d);
        return d;
      },
    });
    if (c.mode !== "local") throw new Error("runtime must start");
    return c.runtime as RainRuntime;
  };
  const draftFor = (basis: MathematicalBasisEntry[]) => {
    const v = validateExperiment(quick(basis));
    if (!v.ok) throw new Error(v.errors.join("; "));
    return rainDefinitionDraft(
      v.value.definition,
      v.value.experimentId,
      v.value.definitionSha256,
      "R.A.I.N.Operator",
    );
  };
  it("survives pre-registration: the registry's definition holds the basis, under its digest", async () => {
    const rt = await runtime();
    const draft = draftFor([definition, hostRead]);
    expect(draft.parameters.mathematical_basis).toEqual([definition, hostRead]);
    expect(draft.rationale).toMatch(/as context, not as evidence/);
    const answer = rt.preregister(draft, REQ);
    const registered = assembleDefinition(draft, answer.experiment_id, answer.created_at);
    expect(sha256Json(registered)).toBe(answer.definition_sha256);
    expect(
      (registered.parameters as { mathematical_basis: unknown }).mathematical_basis,
    ).toEqual([definition, hostRead]);
  });
  it("is refused by the runtime when the basis does not match its substrate", async () => {
    const rt = await runtime();
    const refusedWith = (draft: ReturnType<typeof draftFor>) => {
      try {
        rt.preregister(draft, REQ);
      } catch (e) {
        return e instanceof Refused ? `${e.status} ${e.code}` : String(e);
      }
      return "registered";
    };
    // A basis read at another commit: the substrate revision may not change silently.
    expect(refusedWith(draftFor([{ ...definition, commit: "f".repeat(40) }]))).toMatch(
      /^422 the mathematical basis does not match the substrate/,
    );
    // An unformalized result labelled formalized.
    const claimed = {
      ...hostRead,
      status: "formalized" as const,
      formalization_path: "lean/docs/223.md",
    };
    const draft = draftFor([]);
    draft.parameters.mathematical_basis = [claimed];
    expect(refusedWith(draft)).toMatch(/holds this result as manuscript, not formalized/);
    // Something that is not a basis entry at all.
    const smuggled = draftFor([]);
    (smuggled.parameters as Record<string, unknown>).mathematical_basis = [
      { ...definition, run: "rm -rf /" },
    ];
    expect(refusedWith(smuggled)).toMatch(/^422 the mathematical basis is malformed/);
  });
});

describe("the basis in the sealed record", () => {
  const withBasis = runCase(quick([definition, hostRead]), "math-basis");
  const without = runCase(quick(), "math-none");
  const supported = runCase(
    quick([{ ...definition, relation: "supports_hypothesis" }]),
    "math-supports",
  );
  it("survives sealing, and replay verifies it with every arm", () => {
    expect(withBasis.definition?.mathematical_basis).toEqual([definition, hostRead]);
    expect(withBasis.proposal?.mathematical_basis).toEqual([definition, hostRead]);
    expect(recordDigestOK(withBasis)).toBe(true);
    const v = verifyRecordSync(withBasis);
    expect(v.ok).toBe(true);
    expect(v.checks.find((k) => k.id === "proposal")?.ok).toBe(true);
  });
  it("fails replay when the basis is changed after authorization, even re-sealed", () => {
    const { record_sha256: _d, ...body } = structuredClone(withBasis);
    body.definition!.mathematical_basis[0]!.relation = "supports_hypothesis";
    const edited = verifyRecordSync(seal(body));
    expect(edited.ok).toBe(false);
    expect(edited.checks.find((k) => k.id === "definition")?.ok).toBe(false);
    const { record_sha256: _e, ...again } = structuredClone(withBasis);
    again.proposal!.mathematical_basis = [];
    const swapped = verifyRecordSync(seal(again));
    expect(swapped.ok).toBe(false);
    expect(swapped.checks.find((k) => k.id === "proposal")?.ok).toBe(false);
  });
  it("decides nothing: the outcome is the simulator's, with or without mathematics", () => {
    for (const r of [withBasis, supported]) {
      expect(r.run?.measurements).toEqual(without.run?.measurements);
      expect(r.run?.evaluation).toEqual(without.run?.evaluation);
      expect(r.outcome.verdict).toBe(without.outcome.verdict);
      expect(r.run?.arms.map((a) => a.final_hash)).toEqual(
        without.run?.arms.map((a) => a.final_hash),
      );
    }
  });
  it("never enters the evidence library", () => {
    const items = evidenceItems(null, [withBasis, supported]);
    expect(new Set(items.map((i) => i.category))).toEqual(
      new Set(items.map((i) => i.category).filter((c) => c in CATEGORIES)),
    );
    const text = JSON.stringify(items.map((i) => [i.title, i.body]));
    for (const e of [definition, hostRead]) {
      expect(text).not.toContain(e.title);
      expect(text).not.toContain(e.result_family + " ");
    }
    expect(items.filter((i) => i.category === "SOURCE")).toEqual([]);
    const hypothesis = items.find((i) => i.category === "HYPOTHESIS")!;
    expect(hypothesis.provenance).toMatch(/as context, not evidence/);
  });
  it("travels to the registry in the submission's parameters, without a status or a verdict", () => {
    const r = runCase(quick([definition]), "math-submission");
    // A submission names the producing commit; this test build has none to name.
    const s = rainSubmission(
      { ...r, provenance: { ...r.provenance, lop_nur_twin_commit: "c".repeat(40) } },
      { experimentId: "V3D-EXP-0001", experimentVersion: 1 },
    );
    if (!s.ok) throw new Error(s.errors.join("; "));
    expect(
      (s.value.parameters as { mathematical_basis: unknown }).mathematical_basis,
    ).toEqual([definition]);
    expect("status" in s.value || "verdict" in s.value).toBe(false);
  });
});

describe("the host's reading", () => {
  it("gives a result with no counterpart in the simulator only 'related, not applicable'", () => {
    expect(hostReading({ discipline: { id: 1, name: "Number theory" } }).relation).toBe(
      "related_but_not_applicable",
    );
    expect(hostReading({ discipline: null }).relation).toBe("related_but_not_applicable");
    const p = hostReading({
      discipline: { id: 15, name: "Probability and statistical mechanics" },
    });
    expect(p.relation).toBe("insufficient_context");
    expect(p.counterpart).toMatch(/seeded random choices/);
  });
  it("builds an entry only from a validated answer, and never from an unverified result", () => {
    const fixtureSubstrate = MathematicalSubstrate.load(fixtureIndex());
    const unverified = inspected(fixtureSubstrate, "998");
    const r = basisEntryFrom(unverified, {
      manuscriptPath: null,
      reasoningSummary: false,
      relation: "insufficient_context",
      assumptions: [],
      rationale: "",
      assessedBy: "person",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/not admissible/);
    const summary = cite(inspected(pinned, "017"), {
      reasoningSummary: true,
      relation: "suggests_hypothesis",
      assumptions: ["The summary's strategy is a method, not a result."],
      rationale: "A route to the bound, to read before testing.",
    });
    expect(summary.status).toBe("reasoning-summary");
    expect(summary.formalization_path).toBeNull();
    const alternate = cite(inspected(pinned, "003"), {
      manuscriptPath: "preprints/The-Quasi-Riemann-Hypothesis-October-5-2026/paper2.pdf",
    });
    expect(alternate.status).toBe("manuscript");
    expect(alternate.formalization_path).toBeNull();
  });
  it("simplifies markup for reading, and only for reading", () => {
    expect(readable("every <i>ε</i> &gt; 0 and $`p/q`$, ℤ<sub><i>p</i></sub>")).toBe(
      "every ε > 0 and $p/q$, ℤ_p",
    );
  });
});

describe("malformed substrate answers are refused", () => {
  const search = JSON.parse(
    JSON.stringify(
      pinned.searchMathematics(
        {
          query: "percolation threshold",
          discipline: null,
          formalization: "any",
          limit: 3,
          mode: "context",
          hypothesis: null,
        },
        REQ,
      ),
    ),
  );
  const record = JSON.parse(
    JSON.stringify(pinned.inspectMathematicalResult({ family: "003" }, REQ)),
  );
  const expectSearch = {
    requestId: REQ,
    query: "percolation threshold",
    mode: "context" as const,
  };
  it("accepts the substrate's own answers", () => {
    expect(validateMathResults(search, expectSearch).ok).toBe(true);
    expect(validateMathRecord(record, { requestId: REQ, family: "003" }).ok).toBe(true);
    expect(validateMathStatus(JSON.parse(JSON.stringify(pinned.status()))).ok).toBe(true);
  });
  it("refuses extra fields, other requests, invented statuses and paths that leave the repository", () => {
    const bad = (
      mutate: (v: Record<string, unknown>) => void,
      which: "search" | "record",
    ) => {
      const v = structuredClone(which === "search" ? search : record);
      mutate(v);
      return which === "search"
        ? validateMathResults(v, expectSearch).ok
        : validateMathRecord(v, { requestId: REQ, family: "003" }).ok;
    };
    expect(bad((v) => (v.verdict = "proved"), "search")).toBe(false);
    expect(bad((v) => (v.request_id = "b".repeat(32)), "search")).toBe(false);
    expect(bad((v) => (v.query = "something else"), "search")).toBe(false);
    expect(
      bad(
        (v) =>
          ((v.results as { relation?: string }[])[0]!.relation = "supports_hypothesis"),
        "search",
      ),
    ).toBe(false);
    expect(
      bad((v) => ((v.findings as { id: string }[])[0]!.id = "proven"), "search"),
    ).toBe(false);
    expect(
      bad(
        (v) => ((v.results as { group: string | null }[])[0]!.group = "counterexamples"),
        "search",
      ),
    ).toBe(false);
    expect(
      bad((v) => ((v.provenance as { commit: string }).commit = "main"), "search"),
    ).toBe(false);
    type Rec = {
      family: { manuscripts: { status: string; path: string }[]; status: string };
    };
    // The alternate proof is outside the Lean scope page: it may not be called formalized.
    expect(
      bad((v) => ((v as Rec).family.manuscripts[1]!.status = "formalized"), "record"),
    ).toBe(false);
    expect(
      bad(
        (v) => ((v as Rec).family.manuscripts[0]!.path = "https://evil.example/x.pdf"),
        "record",
      ),
    ).toBe(false);
    expect(
      bad(
        (v) =>
          ((v as Rec).family.manuscripts[0]!.path = "preprints/../../etc/passwd.pdf"),
        "record",
      ),
    ).toBe(false);
    expect(bad((v) => ((v as Rec).family.status = "reasoning-summary"), "record")).toBe(
      false,
    );
    expect(validateMathRecord(record, { requestId: REQ, family: "017" }).ok).toBe(false);
  });
});

describe("the lab, end to end through the route", () => {
  const ORIGIN = "https://lab.example.test";
  const dirs: string[] = [];
  const stores: LabStore[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose();
  });
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  /** The real route and runtime, behind the browser's own client. Each call is a minute later. */
  function live(runtime = true) {
    let t = Date.parse("2026-10-08T00:00:00.000Z");
    const handle = createRainHandler({
      runtime: runtime
        ? configureRuntime({
            env: {},
            cwd: "/",
            scratchDir: () => {
              const d = mkdtempSync(join(tmpdir(), "rain-math-route-"));
              dirs.push(d);
              return d;
            },
          })
        : configureRuntime({ env: { RAIN_RUNTIME: "off" } }),
      now: () => (t += 60_000),
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      handle(
        new Request(`${ORIGIN}${String(url)}`, {
          method: init?.method ?? "GET",
          headers: { ...(init?.headers as Record<string, string>), Origin: ORIGIN },
          body: init?.body,
        }),
        { clientKey: "test" },
      ),
    );
    const sim = new CitySimulation({
      ...PROFILES[0]!,
      pedestrians: 20,
      vehicles: 4,
      buses: 1,
    });
    const s = new LabStore(sim, fetchImpl);
    stores.push(s);
    return { s, fetchImpl };
  }
  it("searches, inspects, cites and proposes, with the basis in the case a person authorizes", async () => {
    const { s } = live();
    await s.checkRuntime();
    expect(s.mode()).toBe("LIVE");
    expect(s.mathAvailable()).toBe(true);
    expect(s.mathematics.status?.substrate?.repository).toBe("openai/math");
    await s.searchMathematics("percolation on random graphs", {
      discipline: null,
      formalization: "any",
      limit: 3,
    });
    expect(s.mathematics.context?.answer.results.length).toBeGreaterThan(0);
    expect(resonanceView(snapshotOf(s)).state).toMatch(/^math-(context|formalized)$/);
    const family = s.mathematics.context!.answer.results[0]!.family;
    expect(
      s.attachMathematics(family, {
        manuscriptPath: null,
        reasoningSummary: false,
        relation: "insufficient_context",
        assumptions: [],
        rationale: "",
        assessedBy: "person",
      }),
    ).toEqual(["inspect the result before citing it"]);
    await s.inspectMathematics(family);
    expect(
      s.attachMathematics(family, {
        manuscriptPath: null,
        reasoningSummary: false,
        relation: "suggests_hypothesis",
        assumptions: [
          "Pedestrians choosing among sidewalks at a junction behave like an open edge.",
        ],
        rationale: "A threshold would mark where a closure stops dispersing a crowd.",
        assessedBy: "person",
      }),
    ).toEqual([]);
    expect(resonanceView(snapshotOf(s)).state).toBe("hypothesis-formed");
    s.proposeOption("X1", "Does closing the Metro disperse the people at its entrance?");
    const c = s.cases[0]!;
    expect(c.lifecycle.state).toBe("AWAITING_HUMAN_APPROVAL");
    expect(c.validated?.definition.mathematical_basis).toEqual(s.mathematics.basis);
    expect(c.validated?.definition.mathematical_basis[0]?.commit).toBe(
      s.mathematics.status?.substrate?.commit,
    );
    // Mathematics never authorizes: the case waits for a person, whatever it cites.
    expect(resonanceView(snapshotOf(s)).state).toBe("awaiting-human");
    s.approve(c.id, {
      operator: "R.A.I.N.Operator",
      typedPrefix: c.validated!.definitionSha256.slice(0, 8),
      reviewed: true,
    });
    expect(resonanceView(snapshotOf(s)).state).toBe("ready-for-experiment");
  });
  it("challenges a hypothesis and shows what it found as a challenge", async () => {
    const { s } = live();
    await s.checkRuntime();
    await s.searchMathematics(
      "crowd dispersal",
      { discipline: null, formalization: "any", limit: 5 },
      "Closing the Metro makes pedestrians disperse like a random walk, so their mean distance grows with time.",
    );
    const answer = s.mathematics.challenge!.answer;
    expect(answer.mode).toBe("challenge");
    expect(answer.results.every((r) => r.group !== null)).toBe(true);
    expect(answer.findings.some((f) => f.id === "challenge_material")).toBe(true);
    expect(resonanceView(snapshotOf(s)).state).toBe("math-conflict");
  });
  it("asks nothing and says why when the runtime is OFFLINE", async () => {
    const { s, fetchImpl } = live(false);
    await s.checkRuntime();
    const calls = fetchImpl.mock.calls.length;
    await s.searchMathematics("random walks", {
      discipline: null,
      formalization: "any",
      limit: 3,
    });
    expect(fetchImpl.mock.calls.length).toBe(calls);
    expect(s.mathematics.note).toMatch(/unavailable/);
    expect(s.mathematics.context).toBeNull();
  });
  it("shows a missing result as NOT FOUND, and keeps nothing in its place", async () => {
    const { s } = live();
    await s.checkRuntime();
    const r = await s.client.mathInspect("999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure).toBe("NOT FOUND");
    await s.inspectMathematics("999");
    expect(s.mathematics.inspected).toEqual([]);
  });
});

describe("the resonance follows the mathematics as process, never as truth", () => {
  const base: ResonanceSnapshot = {
    live: true,
    asking: false,
    progress: null,
    meeting: null,
    run: null,
    awaiting: null,
    ready: null,
    result: null,
    mathematics: { searching: null, framing: null, basis: null },
  };
  const at = "2026-10-08T10:00:00.000Z";
  const framing = (
    over: Partial<NonNullable<ResonanceSnapshot["mathematics"]["framing"]>> = {},
  ) => ({
    mode: "context" as const,
    families: ["213", "214"],
    formalized: 0,
    challenging: 0,
    at,
    ...over,
  });
  const math = (m: Partial<ResonanceSnapshot["mathematics"]>) => ({
    ...base,
    mathematics: { ...base.mathematics, ...m },
  });
  it("names each state for what is happening", () => {
    expect(resonanceView(math({ searching: "context" })).state).toBe("math-search");
    expect(resonanceView(math({ framing: framing() })).state).toBe("math-context");
    expect(resonanceView(math({ framing: framing({ formalized: 1 }) })).state).toBe(
      "math-formalized",
    );
    expect(
      resonanceView(math({ framing: framing({ mode: "challenge", challenging: 2 }) }))
        .state,
    ).toBe("math-conflict");
    expect(
      resonanceView(
        math({ basis: { families: ["017"], connecting: 1, challenging: 0, at } }),
      ).state,
    ).toBe("hypothesis-formed");
    expect(
      resonanceView(
        math({ basis: { families: ["195"], connecting: 1, challenging: 1, at } }),
      ).state,
    ).toBe("math-conflict");
    expect(resonanceView(math({ framing: framing({ families: [] }) })).state).toBe(
      "idle",
    );
    expect(
      resonanceView({
        ...base,
        ready: { experimentId: "BX-000000000000", definition: "d".repeat(64) },
      }).state,
    ).toBe("ready-for-experiment");
  });
  it("says in words that a figure is not a verdict", () => {
    for (const v of [
      resonanceView(math({ framing: framing({ formalized: 2 }) })),
      resonanceView(
        math({ basis: { families: ["017"], connecting: 1, challenging: 0, at } }),
      ),
    ]) {
      expect(v.because).toMatch(/never that it is relevant, applicable or true/);
      expect(v.plate.pigment).not.toBe("verdigris");
    }
    expect(resonanceView(math({ framing: framing({ formalized: 1 }) })).because).toMatch(
      /never the simulator's behaviour/,
    );
  });
  it("keeps the order: a run and a waiting person come before any mathematics", () => {
    const running = {
      ...math({ searching: "challenge", framing: framing() }),
      run: {
        experimentId: "BX-000000000000",
        definition: "d".repeat(64),
        arm: 0,
        arms: 2,
        done: 0.5,
      },
    };
    expect(resonanceView(running).state).toBe("experiment");
    const waiting = {
      ...math({ basis: { families: ["017"], connecting: 1, challenging: 0, at } }),
      awaiting: { experimentId: "BX-000000000000", definition: "d".repeat(64) },
      ready: { experimentId: "BX-111111111111", definition: "e".repeat(64) },
    };
    expect(resonanceView(waiting).state).toBe("awaiting-human");
    const later = "2026-10-08T11:00:00.000Z";
    expect(
      resonanceView({
        ...math({ framing: framing({ at: later }) }),
        result: {
          experimentId: "BX-0",
          definition: "d".repeat(64),
          state: "COMPLETED",
          verdict: "supported",
          at,
        },
      }).state,
    ).toBe("math-context");
    expect(
      resonanceView({
        ...math({ framing: framing() }),
        result: {
          experimentId: "BX-0",
          definition: "d".repeat(64),
          state: "COMPLETED",
          verdict: "supported",
          at: later,
        },
      }).state,
    ).toBe("result-supported");
  });
  it("is deterministic and reads without writing", () => {
    const s = math({
      framing: framing({ formalized: 1 }),
      basis: {
        families: ["017"],
        connecting: 1,
        challenging: 0,
        at: "2026-10-08T09:00:00.000Z",
      },
    });
    const frozen = structuredClone(s);
    expect(resonanceView(s)).toEqual(resonanceView(structuredClone(s)));
    expect(s).toEqual(frozen);
  });
});
