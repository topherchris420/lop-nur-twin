import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ResearchStore } from "./store.js";
import { autonomyConfig } from "./config.js";
import { createScientificControl } from "./scientificControl.js";
import { oscillatorExample } from "../scientific/example.js";
import { createDiscoveryService } from "./discoveryService.js";
import type { LocalModel } from "./models.js";

function testHost(root: string, enabled = true, model?: LocalModel) {
  const parsed = autonomyConfig({
    RAIN_AUTONOMY_DIR: root,
    RAIN_AUTONOMY_ENABLED: String(enabled),
    RAIN_MODEL_PROVIDER: "lmstudio",
    RAIN_MODEL: "qwen-test-double",
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return {
    store: new ResearchStore(root),
    control: createScientificControl(
      new ResearchStore(root),
      parsed.config,
      async () => ({ commit: "a".repeat(40), dirty: false }),
      model,
    ),
  };
}
it("uses the same lock and registry, requires reviewed approval, retains verified results and reconstructs after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "rain-scientific-host-"));
  try {
    const { store, control } = testHost(root);
    const compiled = control.compile(oscillatorExample()),
      digest = compiled.latest!.digest;
    await expect(control.execute(digest)).rejects.toThrow("authorization");
    expect(() => control.authorize(digest, digest.slice(0, 8), false)).toThrow("review");
    const release = store.acquireLock("fixture-other-session");
    expect(() => control.compile(oscillatorExample())).toThrow();
    release();
    control.authorize(digest, digest.slice(0, 8), true);
    const finished = await control.execute(digest);
    expect(finished.records[0]?.replay).toBe(true);
    expect(finished.records[0]?.registry_run_id).toMatch(/V3D-EXP-/);
    expect(store.lock()).toBeNull();
    const restarted = testHost(root).control.view();
    expect(restarted.records).toEqual(finished.records);
    await expect(control.execute(digest)).rejects.toThrow("already has");
    expect(store.discoveryEntries().some((e) => e.kind === "scientific-failed")).toBe(
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("labels the model draft by a retained answer and refuses altered model-authored designs", async () => {
  const root = mkdtempSync(join(tmpdir(), "rain-scientific-model-"));
  try {
    const { provenance: _p, ...draft } = oscillatorExample();
    const model: LocalModel = {
      provider: "lmstudio",
      model: "qwen-test-double",
      endpoint: "http://127.0.0.1:1234",
      listModels: async () => ["qwen-test-double"],
      complete: async () => ({
        text: JSON.stringify(draft),
        reportedModel: "qwen-test-double",
        promptTokens: 100,
        completionTokens: 100,
        latencyMs: 0,
        finishReason: "stop",
      }),
    };
    const { control, store } = testHost(root, true, model),
      view = await control.draft(draft.question);
    expect(view.latest?.design.provenance.generation).toBe("model");
    expect(
      store
        .discoveryEntries()
        .some((e) => e.sha256 === view.latest!.design.provenance.decision_sha256),
    ).toBe(true);
    const edited = structuredClone(view.latest!.design);
    edited.parameters.force_amplitude.value = 2;
    expect(() => control.compile(edited)).toThrow("immutable answer");
    expect(store.lock()).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("explicit enablement blocks execution and lock refusals do not wedge the operator service", async () => {
  const root = mkdtempSync(join(tmpdir(), "rain-scientific-disabled-"));
  try {
    const { control, store } = testHost(root, false),
      plan = control.compile(oscillatorExample()).latest!;
    control.authorize(plan.digest, plan.digest.slice(0, 8), true);
    await expect(control.execute(plan.digest)).rejects.toThrow("enablement");
    const service = createDiscoveryService({ RAIN_AUTONOMY_DIR: root }, process.cwd());
    const release = store.acquireLock("fixture-other-session");
    await expect(service.learningEvaluate("0".repeat(64))).rejects.toThrow();
    release();
    expect(() =>
      service.scientificCompile({
        ...oscillatorExample(),
        question: "A distinct reviewed fixture",
      }),
    ).not.toThrow();
    service.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
