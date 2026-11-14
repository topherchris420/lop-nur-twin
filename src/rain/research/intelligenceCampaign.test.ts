import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ResearchStore } from "../autonomy/store.js";
import { campaignSeeds } from "./intelligence.js";
import { cpuTestPlan } from "./intelligence.test.js";
import {
  cpuCampaignReport,
  exportCpuCampaign,
  prepareCpuCampaign,
  runCpuCampaign,
  type CpuExecutor,
} from "./intelligenceCampaign.js";

const producer = { commit: "a".repeat(40), dirty: false, source_sha256: "b".repeat(64) };
function setup(correct = 1, maxBytes?: number) {
  const store = new ResearchStore(mkdtempSync(join(tmpdir(), "rain-cpu-")), maxBytes);
  const calls: number[][] = [];
  const executor: CpuExecutor = {
    binding: { generation: "scripted-test", source: "fixed" },
    async run(_design, seeds) {
      calls.push(seeds);
      return {
        samples: seeds.map(() => correct),
        checks: { independent: true },
        details: {},
        provenance: { generation: "scripted-test" },
      };
    },
  };
  return { store, executor, calls, plan: cpuTestPlan() };
}

describe("bounded CPU campaign integration", () => {
  it("refuses execution without exact reviewed source-bound approval", async () => {
    const s = setup(),
      registered = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    await expect(
      runCpuCampaign(s.store, registered.id, "wrong", s.executor, { reviewed: true }),
    ).rejects.toThrow(/digest/);
    expect(s.calls).toHaveLength(0);
    await expect(
      runCpuCampaign(
        s.store,
        registered.id,
        registered.approval_sha256,
        { ...s.executor, binding: { changed: true } },
        { reviewed: true },
      ),
    ).rejects.toThrow(/binding/);
    expect(s.calls).toHaveLength(0);
  });
  it("preregisters, measures, independently assesses, admits and exports both panels", async () => {
    const s = setup(),
      registered = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    const report = await runCpuCampaign(
      s.store,
      registered.id,
      registered.approval_sha256,
      s.executor,
      { reviewed: true },
    );
    expect(s.calls).toEqual([
      campaignSeeds(s.plan, s.plan.designs[0]!, "screen"),
      campaignSeeds(s.plan, s.plan.designs[0]!, "confirmation"),
    ]);
    expect(new Set(s.calls.flat()).size).toBe(96);
    expect(report.designs[0]!.confirmation!.verdict).toBe("supported");
    expect(report.budget.completed_units).toBe(96);
    expect(cpuCampaignReport(s.store, registered.id)).toEqual(report);
    const exported = exportCpuCampaign(s.store, registered.id);
    expect(s.store.readResearchArtifact(exported.evidence.path)).toContain(
      registered.plan_sha256,
    );
    expect(s.store.readResearchArtifact(exported.observatory.path)).toContain(
      "<!doctype html>",
    );
    await expect(
      runCpuCampaign(s.store, registered.id, registered.approval_sha256, s.executor, {
        reviewed: true,
      }),
    ).rejects.toThrow(/finished/);
  });
  it("keeps a falsification and confirms it on a fresh panel", async () => {
    const s = setup(0),
      registered = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    const report = await runCpuCampaign(
      s.store,
      registered.id,
      registered.approval_sha256,
      s.executor,
      { reviewed: true },
    );
    expect(report.designs[0]!.screen!.verdict).toBe("falsified");
    expect(report.designs[0]!.confirmation!.verdict).toBe("falsified");
  });
  it("reserves before failures, counts failure time, and never equates crashes with falsification", async () => {
    const s = setup();
    s.executor.run = async () => {
      throw new Error("private upstream diagnostic");
    };
    const registered = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    const report = await runCpuCampaign(
      s.store,
      registered.id,
      registered.approval_sha256,
      s.executor,
      { reviewed: true },
    );
    expect(report.status).toBe("incomplete");
    expect(report.designs[0]!.state).toBe("error");
    expect(report.designs[0]!.screen).toBeNull();
    expect(report.budget.reserved_units).toBe(32);
    expect(report.budget.completed_units).toBe(0);
    expect(report.budget.runtime_ms).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain("private upstream diagnostic");
  });
  it("respects a full-panel budget and store byte ceiling before work", async () => {
    const s = setup();
    s.plan.budget_units = 50;
    const r = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    const report = await runCpuCampaign(s.store, r.id, r.approval_sha256, s.executor, {
      reviewed: true,
    });
    expect(report.status).toBe("budget_exhausted");
    expect(s.calls).toHaveLength(0);
    const small = setup(1, 10000);
    expect(() =>
      prepareCpuCampaign(small.store, small.plan, small.executor, producer),
    ).toThrow(/storage ceiling/);
    expect(readdirSync(small.store.root)).not.toContain("registry");
  });
  it("continues only unspent confirmation after an explicit reviewed checkpoint", async () => {
    const s = setup(),
      r = prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    const append = s.store.appendDiscovery.bind(s.store);
    const spy = vi
      .spyOn(s.store, "appendDiscovery")
      .mockImplementation((id, kind, payload) => {
        if (
          kind === "cpu-reserved" &&
          (payload as { phase: string }).phase === "confirmation"
        )
          throw new Error("interruption before reservation");
        return append(id, kind, payload);
      });
    await expect(
      runCpuCampaign(s.store, r.id, r.approval_sha256, s.executor, { reviewed: true }),
    ).rejects.toThrow(/interruption/);
    spy.mockRestore();
    await expect(
      runCpuCampaign(s.store, r.id, r.approval_sha256, s.executor, { reviewed: true }),
    ).rejects.toThrow(/continuation/);
    const report = await runCpuCampaign(s.store, r.id, r.approval_sha256, s.executor, {
      reviewed: true,
      continueReviewed: true,
    });
    expect(report.status).toBe("complete");
    expect(s.calls).toHaveLength(2);
    expect(report.budget.reserved_units).toBe(96);
  });
  it("will not call reused confirmation data a new hypothesis", () => {
    const s = setup();
    prepareCpuCampaign(s.store, s.plan, s.executor, producer);
    expect(() =>
      prepareCpuCampaign(
        s.store,
        { ...s.plan, question: "A revised interpretation" },
        s.executor,
        producer,
      ),
    ).toThrow(/already exposed/);
  });
});
