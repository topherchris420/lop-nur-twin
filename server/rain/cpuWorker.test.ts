import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", upstream: "", versions: "{}", calls: 0 }));
vi.mock("node:child_process", () => ({
  execFileSync: (file: string, args: string[]) => {
    if (file === "git") {
      if (args.includes("--show-toplevel")) return state.upstream;
      if (args.includes("get-url"))
        return "https://github.com/topherchris420/quantum-noise-profiler.git";
      if (args.includes("HEAD")) return "a".repeat(40);
      return "";
    }
    return state.versions;
  },
  execFile: () => {
    state.calls++;
    throw new Error("A rejected capability must not execute");
  },
}));
import { createCpuExecutor } from "./cpuWorker.js";
import type { CpuDesign } from "../../src/rain/research/intelligence.js";

beforeEach(() => {
  state.calls = 0;
  state.versions = '{"python":"fixture","numpy":"2.4.6","scipy":"1.17.1"}';
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "rain-cpu-capability-"));
  const upstream = join(root, "upstream");
  state.upstream = upstream;
  for (const dir of [
    "scripts/research-validation",
    "src/rain/research",
    "server/rain",
    "upstream/src/qnp",
  ])
    mkdirSync(join(root, dir), { recursive: true });
  for (const file of [
    "scripts/research-validation/worker.py",
    "scripts/research-validation/validation.py",
    "scripts/research-validation/requirements.txt",
    "src/rain/research/intelligence.ts",
    "src/rain/research/intelligenceCampaign.ts",
    "server/rain/cpuWorker.ts",
    "upstream/pyproject.toml",
    "upstream/LICENSE",
    "upstream/src/qnp/__init__.py",
    "python.exe",
  ])
    writeFileSync(join(root, file), "fixture source");
  const executor = createCpuExecutor({
    repositoryRoot: root,
    python: join(root, "python.exe"),
    repositories: { "quantum-noise-profiler": upstream },
  });
  const design: CpuDesign = {
    id: "null",
    adapter: "qnp-stable",
    parameters: {},
    predictions: { a: 0.5, b: 0.5 },
    cost_units: 1,
    minimum_rate: 0.75,
    hypothesis: "A fixture",
    falsification: "A counterexample",
  };
  return { root, executor, design };
}
it("rejects replaced interpreter bytes after approval without starting the worker", async () => {
  const f = fixture();
  writeFileSync(join(f.root, "python.exe"), "replacement");
  await expect(f.executor.run(f.design, [1], 1000)).rejects.toThrow(/interpreter/);
  expect(state.calls).toBe(0);
});
it("rejects changed dependency versions, worker and upstream code before execution", async () => {
  const f = fixture();
  state.versions = '{"numpy":"different"}';
  await expect(f.executor.run(f.design, [1], 1000)).rejects.toThrow(/dependency/);
  state.versions = '{"python":"fixture","numpy":"2.4.6","scipy":"1.17.1"}';
  writeFileSync(join(f.root, "upstream/src/qnp/__init__.py"), "new source");
  await expect(f.executor.run(f.design, [1], 1000)).rejects.toThrow(/source/);
  expect(state.calls).toBe(0);
});
it("rejects unsupported timeout and a pre-cancelled worker", async () => {
  const f = fixture();
  await expect(f.executor.run(f.design, [1], Infinity)).rejects.toThrow(/timeout/);
  await expect(f.executor.run(f.design, [1], 1000, AbortSignal.abort())).rejects.toThrow(
    /cancelled/,
  );
  expect(state.calls).toBe(0);
});
