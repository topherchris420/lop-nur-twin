import { mkdtempSync, rmSync } from "node:fs";
import type * as Fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Registry } from "./registry.js";

/**
 * How the registry numbers a run when creating its directory fails. The real
 * filesystem cannot be made to refuse on cue on every platform, so the run
 * directory's `mkdirSync` fails as told and everything else is the real one.
 */
const fault = vi.hoisted(() => ({ codes: [] as string[], calls: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const mkdirSync = ((...args: Parameters<typeof fs.mkdirSync>) => {
    if (/RUN-\d{4}$/.test(String(args[0]))) {
      fault.calls += 1;
      const code = fault.codes.shift();
      if (code) throw Object.assign(new Error(`${code}: simulated`), { code });
    }
    return fs.mkdirSync(...args);
  }) as typeof fs.mkdirSync;
  return { ...fs, mkdirSync };
});

const scratch: string[] = [];
afterEach(() => {
  fault.codes = [];
  fault.calls = 0;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function registered(): { reg: Registry; id: string } {
  const dir = mkdtempSync(join(tmpdir(), "rain-registry-test-"));
  scratch.push(dir);
  const reg = new Registry(join(dir, "experiments"));
  const definition = reg.create({
    title: "Run numbering probe",
    question: "Does a run get a directory of its own?",
    hypothesis: "Every run gets the next free number.",
    rationale: "Test fixture.",
    subsystem: { repository: "R.A.I.N._project", component: "probe", paths: [] },
    created_by: "R.A.I.N.Operator",
    evidence_class: "measured",
    runner: { kind: "builtin", name: "fake" },
    seed: 11,
    parameters: {},
    procedure: ["Run the fake probe."],
    variables: { independent: [], dependent: ["accuracy"], controls: [] },
    metrics: [
      { name: "accuracy", unit: "ratio", description: "fraction correct", deterministic: true },
    ],
    criteria: {
      guards: [],
      success: [{ id: "S1", metric: "accuracy", op: ">=", value: 0.9 }],
      failure: [{ id: "F1", metric: "accuracy", op: "<", value: 0.7 }],
    },
    dependencies: [],
    data_policy: { classification: "public", store_artifacts: false },
    limitations: ["Fixture data."],
  });
  return { reg, id: String(definition.experiment_id) };
}

describe("run directories", () => {
  it("steps past a number another writer took first", () => {
    const { reg, id } = registered();
    fault.codes = ["EEXIST"];
    expect(reg.beginRun(id).runId).toBe(`${id}-RUN-0002`);
    expect(fault.calls).toBe(2);
  });

  it("rethrows any other failure instead of trying the next number forever", () => {
    for (const code of ["ENOSPC", "EACCES", "ENOENT"]) {
      const { reg, id } = registered();
      fault.calls = 0;
      fault.codes = [code];
      expect(() => reg.beginRun(id)).toThrow(expect.objectContaining({ code }));
      expect(fault.calls).toBe(1);
    }
  });
});
