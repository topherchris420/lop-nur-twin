import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TEAM } from "../meeting/perspectives";
import { ORIGINALS, refuseOriginal } from "../../bethesda/firstContact/originals";
import { checkRecord } from "../interop/contract";
import { ROSTER, holderOf, rosterErrors, rosterRecord } from "./roster";
import { ClaimLedger, CollabJournal } from "./ledger";
import { displacementPeak, omega0, steadyAmplitude } from "./physics";
import { ExperimentRefused, measure, windowFor } from "./experiment";
import {
  PROTOCOL_SHA256,
  caseSeeds,
  cases,
  confidentError,
  correct,
  generateCase,
  mcnemarOneSided,
  multiAgent,
  runCase,
  wilson,
} from "./evaluation";

const AT = new Date("2026-11-16T12:00:00Z");

describe("roster", () => {
  it("assigns responsibilities to the existing perspectives without changing them", () => {
    expect(rosterErrors()).toEqual([]);
    for (const seat of ROSTER) {
      if (seat.holder === "host") continue;
      expect(TEAM.some((m) => m.name === seat.holder)).toBe(true);
      expect(seat.agent_id).toBe(`rain-${seat.holder.toLowerCase()}`);
    }
    expect(rosterRecord().perspectives).toEqual(
      TEAM.map((m) => ({ name: m.name, role: m.role })),
    );
  });
  it("never lets the proposer criticise, falsify or verify its own claim", () => {
    const proposer = holderOf("hypothesis").holder;
    for (const r of ["criticism", "falsification", "verification"] as const)
      expect(holderOf(r).holder).not.toBe(proposer);
  });
  it("names the R.A.I.N. perspective James distinctly from the James desktop", () => {
    expect(holderOf("hypothesis").agent_id).toBe("rain-james");
    expect(
      ROSTER.every((s) => s.agent_id !== "james-desktop" && s.agent_id !== "coordinator"),
    ).toBe(true);
  });
});

describe("claim ledger", () => {
  it("keeps a claim contested until evidence resolves the challenge", () => {
    const l = new ClaimLedger();
    l.propose({
      claim_id: "C-1",
      statement: "x",
      author: "rain-james",
      generation: "scripted",
    });
    l.cite("C-1", "NR-1", "supports");
    expect(l.standing("C-1")).toBe("supported");
    l.challenge({
      challenge_id: "X-1",
      by: "rain-jasmine",
      target_claim_id: "C-1",
      text: "no",
      generation: "scripted",
    });
    expect(l.standing("C-1")).toBe("contested");
    expect(() => l.resolve("X-1", "upheld", "")).toThrow(/only by a run/);
    l.cite("C-1", "NR-2", "refutes");
    l.resolve("X-1", "upheld", "NR-2");
    expect(l.standing("C-1")).toBe("refuted");
    expect(l.claims.get("C-1")!.evidence.map((e) => e.run_id)).toEqual(["NR-1", "NR-2"]);
  });
  it("revises by superseding, never by deleting", () => {
    const l = new ClaimLedger();
    l.propose({ claim_id: "M-1", statement: "old", author: "host", generation: "host" });
    l.propose({
      claim_id: "M-2",
      statement: "new",
      author: "host",
      generation: "host",
      supersedes: "M-1",
    });
    expect(l.standing("M-1")).toBe("superseded");
    expect(l.claims.get("M-1")!.statement).toBe("old");
    expect(() =>
      l.propose({
        claim_id: "M-3",
        statement: "again",
        author: "host",
        generation: "host",
        supersedes: "M-1",
      }),
    ).toThrow(/already revised/);
  });
});

describe("collaboration journal", () => {
  it("chains agent-event/v1 records and detects tampering", () => {
    const j = new CollabJournal("E-test", () => AT.toISOString());
    j.append("host", "episode.opened", "host", { a: 1 });
    j.append("rain-james", "message.hypothesis", "scripted", {
      text: "peak at w0",
      ratio: 0.995,
    });
    j.append("rain-jasmine", "message.challenge", "scripted", { text: "no" });
    expect(j.verify()).toEqual([]);
    for (const e of j.events) expect(checkRecord("agent-event/v1", e)).toEqual([]);
    j.events[1]!.data = { text: "edited" };
    expect(j.verify().length).toBeGreaterThan(0);
  });
});

describe("physics and the backend bridge", () => {
  it("places the displacement peak below w0, where the closed form is largest", () => {
    const s = { mass: 1, damping: 0.4, stiffness: 4, force: 1 };
    const wr = displacementPeak(s);
    expect(wr).toBeLessThan(omega0(s));
    for (const w of [wr * 0.99, wr * 1.01, omega0(s)])
      expect(steadyAmplitude(s, wr)).toBeGreaterThan(steadyAmplitude(s, w));
  });
  it("runs through the existing compiler, authorization, executor and verifier", () => {
    const s = { mass: 1, damping: 0.4, stiffness: 4, force: 1 };
    const m = measure(s, 2, windowFor(s, 2, 40)!, "test", AT);
    expect(m.replay_verified).toBe(true);
    expect(m.record.authorization.operator).toBe("Scripted.DemoOperator");
    expect(m.reference_error_m).toBeLessThan(1e-6);
    expect(() =>
      measure(
        s,
        2,
        { duration_s: 10, timestep_s: 0.5, sample_every_steps: 1 },
        "unsafe",
        AT,
      ),
    ).toThrow(ExperimentRefused);
  });
});

describe("the preregistered evaluation", () => {
  it("derives held-out seeds from the frozen protocol's digest", () => {
    expect(PROTOCOL_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const held = caseSeeds("held_out");
    expect(held).toHaveLength(48);
    expect(new Set(held).size).toBe(48);
    expect(caseSeeds("development")).toHaveLength(16);
  });
  it("labels every case a research subject and refuses the originals", () => {
    for (const c of cases("development"))
      expect(c.subject_id.startsWith("research-")).toBe(true);
    for (const o of ORIGINALS) expect(() => refuseOriginal(o.id)).toThrow();
  });
  it("reproduces a development case's records and verdicts exactly", () => {
    const c = generateCase("development", 3, caseSeeds("development")[3]!);
    const a = runCase(c, 3),
      b = runCase(c, 3);
    const digests = (r: typeof a) =>
      Object.values(r.arms).flatMap((x) =>
        x.comparisons.flatMap((y) => [y.a.record_sha256, y.b.record_sha256]),
      );
    expect(digests(a)).toEqual(digests(b));
    expect(Object.values(a.arms).map((x) => x.verdict)).toEqual(
      Object.values(b.arms).map((x) => x.verdict),
    );
    for (const arm of Object.values(a.arms)) expect(arm.runs_verified).toBe(arm.runs);
  });
  it("records the multi-seat exchange as a verifiable journal with an independent challenge", () => {
    const c = cases("development").find(
      (x) => x.system.damping / (2 * x.system.mass) < 0.1,
    )!;
    const r = multiAgent(c, AT);
    expect(r.journal_head).toMatch(/^[a-f0-9]{64}$/);
    expect(r.challenges.length).toBeGreaterThan(0);
    expect(r.challenges[0]!.by).toBe("rain-jasmine");
  });
  it("scores verdicts and computes exact statistics", () => {
    expect(correct("inconclusive", "indeterminate")).toBe(true);
    expect(confidentError("supported", "indeterminate")).toBe(true);
    expect(confidentError("inconclusive", "true")).toBe(false);
    expect(mcnemarOneSided(5, 0)).toBeCloseTo(1 / 32, 12);
    expect(mcnemarOneSided(0, 0)).toBe(1);
    const [lo, hi] = wilson(0, 10)!;
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(0.2775, 3);
  });
});

describe("isolation from the persistent organisms", () => {
  const dir = join(import.meta.dirname);
  const sources = readdirSync(dir).filter(
    (n) => n.endsWith(".ts") && !n.endsWith(".test.ts"),
  );
  it("imports nothing from the life, the fly, the garden, deployment or first-contact code but the originals guard", () => {
    for (const name of sources) {
      const text = readFileSync(join(dir, name), "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec, `${name} imports ${spec}`).not.toMatch(
          /bethesda\/(life|fly|augmentation)|\/garden\/|deploy\//,
        );
        if (spec.includes("firstContact"))
          expect(spec).toMatch(/firstContact\/originals\.js$/);
      }
    }
  });
  it("reads no environment, starts no process, fetches nothing and writes no file", () => {
    for (const name of sources) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, name).not.toMatch(
        /process\.env|child_process|fetch\(|writeFile|node:fs/,
      );
    }
  });
});
