import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_ENVELOPE } from "../../bethesda/rain/discoveryProtocol.js";
import { partnership } from "../../bethesda/rain/inceptionProtocol.js";
import { ResearchStore } from "../autonomy/store.js";
import {
  ROOT_LAB,
  WORLD_CAPABILITIES,
  worldErrors,
  approveWorld,
  descendantLabs,
  type ResearchWorld,
} from "./worlds.js";
import { sha256Json } from "../sha256.js";
const spec = (id = "child-a"): ResearchWorld => ({
  schema: "rain-world/v1",
  id,
  parent: ROOT_LAB,
  generation: 1,
  objective: "Compare collective response in the native simulator",
  simulator: "bethesda-native/v1",
  assumptions: ["Illustrative behavioral rules"],
  hypotheses: ["Fire changes watching"],
  evaluation: ["Paired watching difference"],
  inheritance: [],
  agents: partnership(),
  envelope: structuredClone(DEFAULT_ENVELOPE),
  budget: {
    experiments: 2,
    model_calls: 40,
    runtime_ms: 240000,
    storage_bytes: 33554432,
  },
  lifetime_ms: 3600000,
  tools: [...WORLD_CAPABILITIES["bethesda-native/v1"].tools],
  termination: ["Expiry, budget or operator stop"],
});
describe("deterministic descendant boundaries", () => {
  it("refuses depth, unknown tools, malformed output, fabricated references and cycles", () => {
    const now = new Date();
    expect(worldErrors(spec(), [], [], now)).toEqual([]);
    for (const change of [
      { generation: 3 },
      { tools: ["shell"] },
      { simulator: "generated-code" },
      { parent: "child-a" },
      { code: "run arbitrary text" },
      { lifetime_ms: Infinity },
      { inheritance: [{ id: "fake", sha256: "a".repeat(64), status: "simulated" }] },
    ])
      expect(worldErrors({ ...spec(), ...change }, [], [], now).length).toBeGreaterThan(
        0,
      );
  });
  it("serializes approval, binds exact bytes, caps active siblings and checks parent expiry", () => {
    const root = mkdtempSync(join(tmpdir(), "rain-world-"));
    try {
      const store = new ResearchStore(root),
        now = new Date();
      const approve = (w: ResearchWorld) =>
        approveWorld(store, w, [], {
          operator: "Test.Operator",
          typedPrefix: sha256Json(w).slice(0, 8),
          reviewed: true,
          now,
        });
      approve(spec());
      approve(spec("child-b"));
      expect(() => approve(spec("child-c"))).toThrow("two active children");
      const labs = descendantLabs(store);
      expect(
        worldErrors(
          { ...spec("grandchild"), parent: "child-a", generation: 2, lifetime_ms: 60000 },
          labs,
          [],
          now,
        ),
      ).toEqual([]);
      expect(
        worldErrors(
          { ...spec("grandchild"), parent: "child-a", generation: 2 },
          labs,
          [],
          new Date(now.getTime() + 3600001),
        ),
      ).toContain("Parent is unavailable or expired");
      const unlock = store.acquireLock("test");
      expect(() => approve(spec("child-d"))).toThrow("locked");
      unlock();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("stops storage growth and refuses namespace traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "rain-quota-"));
    try {
      const store = new ResearchStore(root, 512);
      expect(() => store.appendDiscovery("test", "oversize", "x".repeat(1000))).toThrow(
        "storage ceiling",
      );
      expect(() => store.descendant("../escape", 1024)).toThrow("Invalid descendant");
      expect(store.discoveryEntries()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
