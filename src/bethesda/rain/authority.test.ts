import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import proposal from "./fixtures/demo-proposal.json" with { type: "json" };
import { CitySimulation, PROFILES } from "../simulation";
import { approve, begin, expireIfStale, openCase, type Origin } from "./cases";
import { authorize, verifyAuthorization } from "./authorization";
import { Lifecycle } from "./lifecycle";
import { RunRefused, runExperiment } from "./runner";
import { validateExperiment } from "./experiments";
import { LIMITS } from "./contracts";
import { proposalFrom } from "./session";
import { unsafeText } from "./validation";

const origin: Origin = { rain: null, rainSource: "unavailable", model: null };
const quick = () => ({
  ...structuredClone(proposal),
  seeds: [101],
  warmup_ticks: 100,
  observation_window_ticks: 300,
});
const live = () => {
  const sim = new CitySimulation({
    ...PROFILES[0]!,
    pedestrians: 40,
    vehicles: 8,
    buses: 2,
  });
  for (let i = 0; i < 20; i++) sim.step();
  return sim;
};

describe("a proposal alone cannot mutate Bethesda", () => {
  it("validating, opening and approving a case leaves the live city untouched", () => {
    const sim = live();
    const before = {
      hash: sim.stateHash(),
      commands: sim.commands.length,
      tick: sim.tick,
    };
    const c = openCase(quick(), { id: "c1", now: new Date(), origin });
    approve(c, {
      operator: "R.A.I.N.Operator",
      typedPrefix: c.validated!.definitionSha256.slice(0, 8),
      reviewed: true,
      now: new Date(),
    });
    expect(c.lifecycle.state).toBe("AUTHORIZED");
    expect({
      hash: sim.stateHash(),
      commands: sim.commands.length,
      tick: sim.tick,
    }).toEqual(before);
  });
  it("a rejected proposal ends REJECTED, with a record, and nothing runs", () => {
    const c = openCase(
      { ...quick(), scenario: "earthquake" },
      { id: "c2", now: new Date(), origin },
    );
    expect(c.lifecycle.state).toBe("REJECTED");
    expect(c.record?.outcome.state).toBe("REJECTED");
    expect(c.record?.run).toBeNull();
    expect(begin(c, new Date())).not.toEqual([]);
  });
});

describe("failed validation and missing approval block execution", () => {
  const v = validateExperiment(quick());
  if (!v.ok) throw new Error("fixture must validate");
  const { definition, definitionSha256, experimentId } = v.value;
  const good = authorize({
    experimentId,
    definitionSha256,
    operator: "R.A.I.N.Operator",
    typedPrefix: definitionSha256.slice(0, 8),
    reviewed: true,
    now: new Date(),
  });
  if (!good.ok) throw new Error("authorization must succeed");
  const run =
    (d = definition, sha = definitionSha256, auth: unknown = good.value) =>
    () =>
      runExperiment(d, sha, experimentId, auth as never).next();
  it("refuses without an authorization record", () => {
    expect(run(definition, definitionSha256, null)).toThrow(RunRefused);
  });
  it("refuses an authorization for another definition", () => {
    const other = { ...good.value, definition_sha256: "0".repeat(64) };
    expect(run(definition, definitionSha256, other)).toThrow(RunRefused);
  });
  it("refuses an edited definition, even with its old approval", () => {
    const edited = structuredClone(definition);
    edited.seeds = [999];
    expect(run(edited)).toThrow(RunRefused);
  });
  it("refuses a tampered authorization record", () => {
    expect(
      run(definition, definitionSha256, { ...good.value, operator: "Someone" }),
    ).toThrow(RunRefused);
    expect(
      run(definition, definitionSha256, { ...good.value, identity_verified: true }),
    ).toThrow(RunRefused);
  });
  it("refuses an approval that does not repeat the digest, or skips the review", () => {
    const base = {
      experimentId,
      definitionSha256,
      operator: "R.A.I.N.Operator",
      typedPrefix: definitionSha256.slice(0, 8),
      reviewed: true,
      now: new Date(),
    };
    expect(authorize({ ...base, typedPrefix: "00000000" }).ok).toBe(false);
    expect(authorize({ ...base, reviewed: false }).ok).toBe(false);
    expect(authorize({ ...base, operator: "Jane Doe <jane@example.com>" }).ok).toBe(
      false,
    );
    expect(verifyAuthorization(good.value, experimentId, definitionSha256)).toEqual([]);
  });
  it("the lifecycle never skips approval", () => {
    expect(() => new Lifecycle().to("PROPOSED", "").to("RUNNING", "")).toThrow();
    expect(() =>
      new Lifecycle().to("PROPOSED", "").to("VALIDATED", "").to("AUTHORIZED", ""),
    ).toThrow();
    expect(
      () =>
        new Lifecycle([
          { state: "PROPOSED", at: "t", detail: "" },
          { state: "COMPLETED", at: "t", detail: "" },
        ]),
    ).toThrow();
    const c = openCase(quick(), { id: "c3", now: new Date(), origin });
    expect(begin(c, new Date())).toEqual(["only an authorized case can run"]);
    expect(c.lifecycle.state).toBe("AWAITING_HUMAN_APPROVAL");
  });
});

describe("stale R.A.I.N. proposals fail closed", () => {
  it("expires an unapproved R.A.I.N. proposal after its time to live", () => {
    const p = proposalFrom("X1", {
      question: "q",
      meetingId: null,
      origin: "rain",
      decision: { decision_id: "f01bc094-730a-47b7", envelope_hash: "e".repeat(64) },
    });
    const opened = new Date("2026-10-03T00:00:00Z");
    const c = openCase(p, { id: "c4", now: opened, origin });
    expect(c.lifecycle.state).toBe("AWAITING_HUMAN_APPROVAL");
    const later = new Date(opened.getTime() + LIMITS.proposalTtlMs + 1);
    expect(
      approve(c, {
        operator: "R.A.I.N.Operator",
        typedPrefix: c.validated!.definitionSha256.slice(0, 8),
        reviewed: true,
        now: later,
      }).ok,
    ).toBe(false);
    expect(c.lifecycle.state).toBe("REJECTED");
    expect(expireIfStale(c, later)).toBe(false);
  });
});

/**
 * The lab holds the live city read-only. Experiments build their own
 * simulators (runner.ts, replay.ts); nothing else in the lab may call a
 * mutating method on any simulator, and the observation and replay modules
 * may not reach a renderer, a network client or the DEMO recording.
 */
describe("authority, by construction", () => {
  const dir = new URL(".", import.meta.url).pathname;
  const files = readdirSync(dir).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"),
  );
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  it("no lab module mutates a simulator except the runner and replay, on their own instances", () => {
    const mutating =
      /\.(inject|accept|humanAction|movePlayer|setFocus|step)\(|\.paused\s*=/;
    const offenders = files
      .filter((f) => !["runner.ts", "replay.ts"].includes(f))
      .filter((f) => mutating.test(read(f)));
    expect(offenders).toEqual([]);
    for (const f of ["runner.ts", "replay.ts"])
      expect(read(f)).toMatch(/new CitySimulation\(|CitySimulation\.execute\(/);
  });
  it("observations, tools, presence, replay and the resonance import no renderer, client, network or recording", () => {
    for (const f of [
      "observations.ts",
      "replay.ts",
      "runner.ts",
      "experiments.ts",
      "tools.ts",
      "presence.ts",
      "resonance.ts",
      "chladni.ts",
    ]) {
      const text = read(f);
      expect(text, f).not.toMatch(
        /from "three"|@react-three|from "react"|\.\/client|\.\/demo|fetch\(/,
      );
    }
  });
  it("the R.A.I.N. client cannot reach the DEMO recording", () => {
    expect(read("client.ts")).not.toMatch(/demo|fixtures/);
  });
  it("the lab imports the runtime's pure contracts only, never its server side or its corpus", () => {
    for (const f of files.filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))) {
      const imports = [...read(f).matchAll(/from\s+"([^"]*\/rain\/[^"]*)"/g)].map(
        (m) => m[1]!,
      );
      for (const spec of imports)
        expect(spec, `${f} imports ${spec}`).toMatch(
          /\/rain\/(protocol|experiments\/evaluate|judgment\/routing|judgment\/(contracts|calibration|sensitive)|meeting\/perspectives|sha256|text|corpus)(\.js)?$/,
        );
    }
  });
  it("text from R.A.I.N. is never rendered as HTML or followed as a link", () => {
    for (const f of files.filter((f) => f.endsWith(".tsx")))
      expect(read(f), f).not.toMatch(/dangerouslySetInnerHTML|<a\s|href=|window\.open/);
  });
  it("no source in the lab contains the invisible characters its validators ban", () => {
    const all = [
      ...readdirSync(dir).filter((f) => /\.(ts|tsx|json)$/.test(f)),
      ...readdirSync(join(dir, "fixtures")).map((f) => join("fixtures", f)),
    ];
    expect(all.filter((f) => unsafeText(read(f)))).toEqual([]);
    for (const [where, pattern] of [
      ["../../../server/rain/", /\.ts$/],
      ["../../../api/rain/", /\.ts$/],
      ["../../../src/rain/", /\.ts$/],
      ["../../../src/rain/meeting/", /\.ts$/],
      ["../../../src/rain/judgment/", /\.ts$/],
      ["../../../src/rain/experiments/", /\.ts$/],
    ] as const) {
      const folder = new URL(where, import.meta.url).pathname;
      expect(
        readdirSync(folder)
          .filter((f) => pattern.test(f))
          .filter((f) => unsafeText(readFileSync(join(folder, f), "utf8"))),
        where,
      ).toEqual([]);
    }
  });
  it("runs never touch fetch", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const v = validateExperiment(quick());
    if (!v.ok) throw new Error("fixture must validate");
    const auth = authorize({
      experimentId: v.value.experimentId,
      definitionSha256: v.value.definitionSha256,
      operator: "R.A.I.N.Operator",
      typedPrefix: v.value.definitionSha256.slice(0, 8),
      reviewed: true,
      now: new Date(),
    });
    if (!auth.ok) throw new Error("authorization must succeed");
    const steps = runExperiment(
      v.value.definition,
      v.value.definitionSha256,
      v.value.experimentId,
      auth.value,
    );
    while (!steps.next().done);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
