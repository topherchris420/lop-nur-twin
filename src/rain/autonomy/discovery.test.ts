import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureRuntime } from "../runtime.js";
import {
  buildDiscoveryCharter,
  authorizeCharter,
  charterSha256,
} from "../../bethesda/rain/standing.js";
import {
  DEFAULT_ENVELOPE,
  DISCOVERY_QUESTION,
} from "../../bethesda/rain/discoveryProtocol.js";
import { seal } from "../../bethesda/rain/record.js";
import { verifyRecordSync } from "../../bethesda/rain/replay.js";
import { runDiscovery, discoveryHistory } from "./discovery.js";
import { DiscoveryFixtureModel } from "./discoveryFixtures.js";
import { ResearchStore } from "./store.js";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rain-discovery-"));
  Object.assign(globalThis, {
    __LAB_REVISION__: { commit: "b".repeat(40), dirty: true, source: "git" },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete (globalThis as { __LAB_REVISION__?: unknown }).__LAB_REVISION__;
});
async function input() {
  const store = new ResearchStore(root),
    model = new DiscoveryFixtureModel();
  const charter = buildDiscoveryCharter({
    model: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    ceilings: {
      iterations: 2,
      experiments: 2,
      runtime_ms: 240000,
      failed_proposals: 2,
      model_calls: 8,
      model_tokens: null,
    },
    validHours: 1,
    envelope: DEFAULT_ENVELOPE,
  });
  const a = authorizeCharter({
    charter,
    operator: "Test.Operator",
    reviewed: true,
    typedPrefix: charterSha256(charter).slice(0, 8),
    now: new Date(),
  });
  if (!a.ok) throw new Error("auth");
  const rt = await configureRuntime({
    env: { RAIN_REGISTRY_DIR: store.registryDir() },
    cwd: process.cwd(),
  });
  if (rt.mode !== "local") throw new Error("runtime");
  return {
    charter,
    authorization: a.value,
    budgets: charter.ceilings,
    model,
    store,
    runtime: rt.runtime,
    question: DISCOVERY_QUESTION,
    operator: "Test.Operator",
  };
}
describe("bounded native discovery sessions", () => {
  it("executes and replays two novel studies; second design cites and responds to the actual first result", async () => {
    const i = await input();
    const result = await runDiscovery(i);
    expect(result.ending).toBe("Completed bounded session");
    expect(result.executed).toBe(2);
    expect(result.history).toHaveLength(2);
    const [first, second] = result.history;
    expect(second!.parent).toBe(first!.design_id);
    expect(second!.evidence_ids).toEqual([first!.run_id]);
    expect(second!.registry_run_id).toMatch(/^V3D-EXP/);
    expect(second!.critique).not.toBeNull();
    for (const r of i.store.records()) expect(verifyRecordSync(r.record).ok).toBe(true);
    const { record_sha256: _digest, ...tampered } = structuredClone(
      i.store.records()[0]!.record!,
    );
    tampered.run!.measurements.primary_delta_mean = 12345;
    expect(verifyRecordSync(seal(tampered)).ok).toBe(false);
    const entries = i.store.discoveryEntries();
    expect(entries.findIndex((e) => e.kind === "preregistration")).toBeLessThan(
      entries.findIndex((e) => e.kind === "result"),
    );
    expect(discoveryHistory(entries)).toEqual(result.history);
    expect(i.store.lock()).toBeNull();
    expect(readFileSync(join(root, result.report), "utf8")).toContain(
      "scripted-discovery-test-double",
    );
    const protocols = entries.filter((e) => e.kind === "protocol");
    expect(JSON.stringify(protocols[1]!.payload)).toContain(
      `Previous measured paired mean delta was ${first!.measurements.primary_delta_mean}`,
    );
  }, 240000);
  it("stops during execution, seals a failed record, releases the lock and never resumes on store reload", async () => {
    const i = await input();
    const abort = new AbortController();
    const result = await runDiscovery({
      ...i,
      signal: abort.signal,
      onUpdate: (v) => {
        if (v.stage === "EXECUTE") abort.abort(new Error("test emergency stop"));
      },
    });
    expect(result.ending).toContain("test emergency stop");
    expect(result.history).toHaveLength(0);
    expect(i.store.records()[0]!.record!.outcome.state).toBe("FAILED");
    expect(i.store.lock()).toBeNull();
    expect(discoveryHistory(new ResearchStore(root).discoveryEntries())).toEqual([]);
  }, 60000);
  it("pause finishes one cycle then stops without automatically starting the next", async () => {
    const i = await input();
    const control = { pauseRequested: false };
    const result = await runDiscovery({
      ...i,
      control,
      onUpdate: (v) => {
        if (v.stage === "EXECUTE") control.pauseRequested = true;
      },
    });
    expect(result.executed).toBe(1);
    expect(result.ending).toContain("Paused");
  }, 120000);
  it("fails closed when the model is unavailable or the charter was modified", async () => {
    const i = await input();
    i.model.listModels = async () => [];
    expect((await runDiscovery(i)).executed).toBe(0);
    expect(i.store.records()).toEqual([]);
    const j = await input();
    j.charter.family!.pedestrians = [60, 360];
    expect((await runDiscovery(j)).ending).toContain("different charter");
  });
  it("refuses concurrent sessions and detects an altered lineage entry", async () => {
    const i = await input();
    const release = i.store.acquireLock("test-owner");
    await expect(runDiscovery(i)).rejects.toThrow("locked");
    expect(() => i.store.recoverLock(i.store.lock()!.sha256)).toThrow("still running");
    release();
    i.store.appendDiscovery("test", "test", { value: 1 });
    const name = readdirSync(join(root, "discovery"))[0]!;
    const path = join(root, "discovery", name);
    const e = JSON.parse(readFileSync(path, "utf8"));
    e.payload.value = 2;
    writeFileSync(path, JSON.stringify(e));
    expect(() => i.store.discoveryEntries()).toThrow("integrity");
  });
});
