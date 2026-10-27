import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, sha256Json } from "../../rain/sha256";
import { EchoAdapter } from "../fly/echo/adapter";
import type { ReducedOrderController } from "../fly/controller";
import {
  birth,
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
} from "./continuity";
import { BETHESDA_LIFE, headlessGenesis, type HeadlessGenesis } from "./headless";
import { ECHO_UPGRADED_LIFE, LEGACY_VERSIONS, upgradeToEcho } from "./echoUpgrade";
import { LifeStore } from "./store";
import { bethesdaStoreKind } from "./bethesdaStore";
import { indexGraph, restoreGraph, snapshotGraph } from "./snapshot";

const genesis = headlessGenesis({
  seed: 393977,
  pedestrians: 4,
  vehicles: 1,
  buses: 0,
  statisticalPopulation: 10,
});
const born = birth(BETHESDA_LIFE.id, genesis, "0123456789abcdef0123456789abcdef");
const at = "2026-10-27T01:00:00.000Z";
type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function reseal(c: Checkpoint): Checkpoint {
  if (c.graph) c.graphDigest = sha256(JSON.stringify(c.graph));
  const { digest: _digest, graph: _graph, ...header } = c;
  c.digest = sha256Json(header);
  return c;
}

/** Synthetic legacy-shaped state for unit tests. Deployment checks also restore
 * the real archived checkpoint with the exact old source engine before migration. */
function fixture(ticks = 20, airborne = false) {
  const life = BETHESDA_LIFE.build(genesis);
  life.advanceTicks(ticks);
  if (airborne) {
    const s = life.cityFly.fly.state;
    s.mode = "flight";
    s.sub = "cruise";
    s.perch = null;
    s.p[1] += 1;
    s.v = [0.4, 0.02, -0.3];
  }
  const c = checkpointLife(BETHESDA_LIFE, life, { genesis, birth: born, previous: null });
  c.versions = { ...LEGACY_VERSIONS, graph: "life-graph/v1" };
  for (const node of c.graph!.nodes) {
    if (node.t !== "o") continue;
    if (node.c === "BethesdaFlyWorld")
      node.e = node.e.filter(([k]) => !["windSeed", "clock0", "storms"].includes(k));
    node.e = node.e.filter(
      ([k]) =>
        ![
          "windFeltMS",
          "windTakeoffMS",
          "maxAirspeedCmS",
          "airflow",
          "airflowFrom",
        ].includes(k),
    );
  }
  // A real legacy snapshot contains no unreachable v8 wind nodes. Re-snapshot
  // this stripped fixture so its node numbering is a genuine graph traversal.
  c.graph = snapshotGraph(
    restoreGraph(c.graph!, BETHESDA_LIFE.build(genesis)),
    indexGraph(BETHESDA_LIFE.build(genesis)),
  );
  return { source: reseal(c), life };
}

describe("recorded ECHO v2 continuation", () => {
  it("keeps the birth, genesis, tick, body, memories and the complete old graph", () => {
    const { source, life: before } = fixture();
    const untouched = JSON.stringify(source);
    const { checkpoint, life } = upgradeToEcho(source, at);
    expect(JSON.stringify(source)).toBe(untouched);
    expect(checkpoint.birth).toEqual(source.birth);
    expect(checkpoint.genesis).toEqual(source.genesis);
    expect(checkpoint.genesisDigest).toBe(source.genesisDigest);
    expect(checkpoint.parent).toBe(source.digest);
    expect(checkpoint.sequence).toBe(source.sequence + 1);
    expect(checkpoint.tick).toBe(source.tick);
    expect(life.city.stateHash()).toBe(before.city.stateHash());
    expect(life.cityFly.fly.state).toEqual(before.cityFly.fly.state);
    expect(life.cityFly.fly.log).toEqual(before.cityFly.fly.log);
    expect(life.cityFly.fly.adapter).toBeInstanceOf(EchoAdapter);
    expect((life.cityFly.fly.adapter as EchoAdapter).inner.state).toEqual(
      (before.cityFly.fly.adapter as ReducedOrderController).state,
    );
    expect(
      checkpoint.events.find((e) => e.kind === "engine-upgrade")!.data
        .preservedGraphDigest,
    ).toBe(source.graphDigest);
    expect(life.status().selfModel?.echoVersion).toBe("echo-self-model/v2");
    expect(life.status().selfModel?.episodes).toBe(0);
    const restored = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    expect(divergence(ECHO_UPGRADED_LIFE, life, restored, [1, 10, 100, 500])).toBeNull();
    const next = checkpointLife(ECHO_UPGRADED_LIFE, life, {
      genesis,
      birth: born,
      previous: checkpoint,
    });
    const again = restoreLife(ECHO_UPGRADED_LIFE, next);
    expect(divergence(ECHO_UPGRADED_LIFE, life, again, [1, 20])).toBeNull();
  }, 60_000);

  it("preserves position and ground velocity when the old fly is airborne", () => {
    const { source, life: before } = fixture(20, true);
    const { life, checkpoint } = upgradeToEcho(source, at);
    expect(life.cityFly.fly.state.p).toEqual(before.cityFly.fly.state.p);
    life.cityFly.fly.velocityOverGround().forEach((v, i) => {
      expect(v).toBeCloseTo(before.cityFly.fly.state.v[i]!, 12);
    });
    const restored = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    expect(divergence(ECHO_UPGRADED_LIFE, life, restored, [1, 10, 100])).toBeNull();
  }, 60_000);

  it("refuses corrupt bytes, the wrong source version and repeated upgrades", () => {
    const { source } = fixture();
    const corrupt = structuredClone(source);
    corrupt.graph!.nodes.push({ t: "fn" });
    expect(() => upgradeToEcho(corrupt, at)).toThrow(/digest/);
    const wrong = structuredClone(source);
    wrong.versions.fly = "digital-fly/6";
    expect(() => upgradeToEcho(reseal(wrong), at)).toThrow("digital-fly/6");
    const upgraded = upgradeToEcho(source, at);
    expect(() => upgradeToEcho(upgraded.checkpoint, at)).toThrow(/upgrade refused/);
    expect(() => restoreLife(BETHESDA_LIFE, source)).toThrow(/digital-fly\/7/);
  }, 60_000);

  it("commits one linked upgrade under the lease and verifies mixed-version history", () => {
    const { source } = fixture(0);
    const dir = mkdtempSync(join(tmpdir(), "echo-upgrade-"));
    dirs.push(dir);
    const legacyKind = { ...BETHESDA_LIFE, versions: LEGACY_VERSIONS };
    LifeStore.create(dir, legacyKind, source).release();
    const store = LifeStore.open(dir, ECHO_UPGRADED_LIFE);
    const { checkpoint } = upgradeToEcho(source, at);
    expect(() => store.commit(checkpoint)).toThrow(/no lease/);
    store.acquire();
    const noEvent = reseal({ ...structuredClone(checkpoint), events: [] });
    expect(() => store.commit(noEvent)).toThrow(/upgrade event/);
    const falseProof = structuredClone(checkpoint);
    falseProof.events.find(
      (e) => e.kind === "engine-upgrade",
    )!.data.preservedGraphDigest = "0".repeat(64);
    expect(() => store.commit(reseal(falseProof))).toThrow(/preservation/);
    store.commit(checkpoint);
    const life = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    life.advanceTicks(10);
    const next = checkpointLife(ECHO_UPGRADED_LIFE, life, {
      genesis,
      birth: born,
      previous: checkpoint,
    });
    store.commit(next);
    expect(() => store.commit(checkpoint)).toThrow(/fork/);
    store.release();
    expect(store.verify()).toEqual({ checkpoints: 3, head: 2, events: 1 });
    expect(bethesdaStoreKind(dir)).toBe(ECHO_UPGRADED_LIFE);
    expect(() => LifeStore.open(dir, BETHESDA_LIFE)).toThrow(/digital-fly\/7/);
    expect(restoreLife(bethesdaStoreKind(dir), store.head()).city.tick).toBe(10);
  }, 60_000);
});
