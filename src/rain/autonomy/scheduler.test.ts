import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ResearchStore } from "./store";
import { createSessionScheduler } from "./scheduler";
import {
  authorizeCharter,
  buildDiscoveryCharter,
  charterSha256,
} from "../../bethesda/rain/standing";
import { DEFAULT_ENVELOPE } from "../../bethesda/rain/discoveryProtocol";
import { CEILING_DEFAULTS } from "./config";
import { sha256Json } from "../sha256";
import type { SessionPolicy } from "../../bethesda/rain/scheduleProtocol";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "rain-scheduler-"));
  roots.push(root);
  const store = new ResearchStore(root);
  let now = Date.now();
  const charter = buildDiscoveryCharter({
    ceilings: CEILING_DEFAULTS,
    model: {
      provider: "lmstudio",
      model: "scripted-scheduler-test",
      endpoint: "http://127.0.0.1:1234",
    },
    validHours: 24,
    envelope: DEFAULT_ENVELOPE,
  });
  const auth = authorizeCharter({
    charter,
    reviewed: true,
    typedPrefix: charterSha256(charter).slice(0, 8),
    operator: "R.A.I.N.Operator",
    now: new Date(now),
  });
  if (!auth.ok) throw new Error(auth.errors.join(";"));
  const policy: SessionPolicy = {
    schema: "rain-session-policy/v1",
    charter_sha256: charterSha256(charter),
    expires_at: new Date(now + 3600000).toISOString(),
    interval_ms: 10000,
    sessions: 2,
    storage_bytes: 1048576,
  };
  const scheduler = createSessionScheduler(store, () => now);
  return {
    store,
    scheduler,
    charter,
    auth: auth.value,
    policy,
    advance: (ms: number) => {
      now += ms;
    },
    clock: () => now,
  };
}
it("reserves before work, retains completed work on restart, and does not duplicate or silently resume", async () => {
  const s = setup();
  s.scheduler.approve(
    s.policy,
    s.charter,
    s.auth,
    sha256Json(s.policy).slice(0, 8),
    true,
  );
  let runs = 0;
  await s.scheduler.tick(s.charter, s.auth, async () => {
    runs++;
    expect(s.scheduler.state()?.started).toBe(1);
  });
  const restored = createSessionScheduler(new ResearchStore(s.store.root), s.clock);
  s.advance(15000);
  expect(restored.state()?.status).toBe("paused");
  expect(
    await restored.tick(s.charter, s.auth, async () => {
      runs++;
    }),
  ).toBe(false);
  restored.control("armed");
  await restored.tick(s.charter, s.auth, async () => {
    runs++;
  });
  expect(runs).toBe(2);
  expect(restored.state()?.status).toBe("exhausted");
  expect(restored.state()?.reserved.model_calls).toBe(2 * s.charter.ceilings.model_calls);
});
it("denies invalid approval, changed charters, expiry and emergency rearming", async () => {
  const s = setup();
  expect(() => s.scheduler.approve(s.policy, s.charter, s.auth, "bad", true)).toThrow();
  s.scheduler.approve(
    s.policy,
    s.charter,
    s.auth,
    sha256Json(s.policy).slice(0, 8),
    true,
  );
  await expect(
    s.scheduler.tick({ ...s.charter, valid_hours: 2 }, s.auth, async () => undefined),
  ).rejects.toThrow("mismatch");
  s.scheduler.control("stopped");
  s.scheduler.control("paused");
  expect(() => createSessionScheduler(s.store, s.clock).control("armed")).toThrow(
    "Terminal",
  );
  const t = setup();
  t.scheduler.approve(
    t.policy,
    t.charter,
    t.auth,
    sha256Json(t.policy).slice(0, 8),
    true,
  );
  t.advance(3600001);
  expect(
    await t.scheduler.tick(t.charter, t.auth, async () => {
      throw new Error("must not run");
    }),
  ).toBe(false);
});
it("serializes concurrent ticks and counts a failed session against the policy", async () => {
  const s = setup();
  s.scheduler.approve(
    s.policy,
    s.charter,
    s.auth,
    sha256Json(s.policy).slice(0, 8),
    true,
  );
  let release!: () => void;
  const first = s.scheduler.tick(
    s.charter,
    s.auth,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  expect(await s.scheduler.tick(s.charter, s.auth, async () => undefined)).toBe(false);
  release();
  await first;
  s.advance(15000);
  await expect(
    s.scheduler.tick(s.charter, s.auth, async () => {
      throw new Error("interrupted");
    }),
  ).rejects.toThrow("interrupted");
  expect(s.scheduler.state()?.started).toBe(2);
  expect(s.scheduler.state()?.status).toBe("stopped");
});
