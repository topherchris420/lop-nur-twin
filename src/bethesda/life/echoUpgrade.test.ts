import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, sha256Json } from "../../rain/sha256";
import { arenaWorld } from "../fly/arena";
import { EchoAdapter } from "../fly/echo/adapter";
import { DigitalFly } from "../fly/fly";
import { PERTURBATION_SCHEMA } from "../fly/perturbation";
import type { ReducedOrderController } from "../fly/controller";
import {
  birth,
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
} from "./continuity";
import {
  BETHESDA_LIFE,
  headlessGenesis,
  type HeadlessBethesdaLife,
  type HeadlessGenesis,
} from "./headless";
import {
  continueEchoSelfModel,
  ECHO_UPGRADED_LIFE,
  ECHO_V2_VERSIONS,
  LEGACY_VERSIONS,
  upgradeToEcho,
} from "./echoUpgrade";
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

describe("recorded ECHO continuation of the reduced-order fly", () => {
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
    // ECHO starts innate at the upgrade, so on this engine it starts as v3.
    expect(life.status().selfModel?.echoVersion).toBe("echo-self-model/v3");
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

const echoOf = (life: HeadlessBethesdaLife) => life.cityFly.fly.adapter as EchoAdapter;
const V3_COUNTS = ["confirmed", "revised", "doubted", "shielded", "held"];

/** An inquiry an ECHO fly opened into a hidden impairment, to stand in for one open at the upgrade. */
function openInquiry() {
  let echo: EchoAdapter | null = null;
  const fly = new DigitalFly({
    seed: 5,
    world: arenaWorld({ size: [4, 2.5, 4], ambient: 0.6 }),
    start: { p: [0, 0.5, 0], yaw: 0.3 },
    config: { takeoffHz: 0, groomHz: 0, walkStartHz: 1, walkStopHz: 0.1 },
    perturbation: {
      schema: PERTURBATION_SCHEMA,
      episodes: [{ id: "w", cause: "self", from: 2, until: null, speedGain: 0.5 }],
    },
    adapter: EchoAdapter.factory({ variant: "full", seed: 5 }),
  });
  echo = fly.adapter as EchoAdapter;
  for (let k = 0; k < 600 && !echo.model!.state.inquiry; k++) fly.advance(0.05);
  const inquiry = structuredClone(echo.model!.state.inquiry);
  expect(inquiry).not.toBeNull();
  return inquiry!;
}

/**
 * The deployed shape: a legacy fly upgraded to ECHO by the v2 engine. This
 * engine upgrades it to v3, so strip what v3 added and record it as v2.
 */
function v2Fixture(inquiry = false) {
  const { source } = fixture();
  const up = upgradeToEcho(source, at);
  const S = echoOf(up.life).model!.state as unknown as Record<string, unknown> & {
    counts: Record<string, number>;
    inquiry: Record<string, unknown> | null;
  };
  if (inquiry) S.inquiry = { ...openInquiry(), check: undefined };
  for (const key of ["workspace", "attention", "airStep"]) delete S[key];
  for (const key of V3_COUNTS) delete S.counts[key];
  if (S.inquiry) delete S.inquiry.check;
  S.schema = "echo-state/v2";
  S.version = ECHO_V2_VERSIONS.echo;
  const descriptor = echoOf(up.life).descriptor as { id: string };
  descriptor.id = descriptor.id.replace("echo-self-model/v3", ECHO_V2_VERSIONS.echo);
  const v2 = checkpointLife(ECHO_UPGRADED_LIFE, up.life, {
    genesis,
    birth: born,
    previous: source,
    events: up.checkpoint.events,
  });
  v2.versions = { ...ECHO_V2_VERSIONS, graph: "life-graph/v1" };
  return { legacy: source, v2: reseal(v2), before: structuredClone(S) };
}

describe("ECHO v2 to v3: the same self-model, with a workspace, an attention schema and a second look", () => {
  it("keeps the birth, the tick, the body and everything the self-model held", () => {
    const { v2, before } = v2Fixture();
    const untouched = JSON.stringify(v2);
    const { checkpoint, life } = continueEchoSelfModel(v2, at);
    expect(JSON.stringify(v2)).toBe(untouched);
    expect(checkpoint.birth).toEqual(v2.birth);
    expect(checkpoint.genesisDigest).toBe(v2.genesisDigest);
    expect(checkpoint.parent).toBe(v2.digest);
    expect(checkpoint.sequence).toBe(v2.sequence + 1);
    expect(checkpoint.tick).toBe(v2.tick);
    const S = echoOf(life).model!.state;
    // What it held is kept: every v2 field, its value unchanged but the version labels.
    const kept = structuredClone(S) as unknown as Record<string, unknown> & {
      counts: Record<string, number>;
    };
    for (const key of ["workspace", "attention", "airStep"]) delete kept[key];
    for (const key of V3_COUNTS) delete kept.counts[key];
    expect({ ...kept, schema: "", version: "" }).toEqual({
      ...before,
      schema: "",
      version: "",
    });
    expect(S.version).toBe("echo-self-model/v3");
    expect(S.workspace!.holder).toBeNull();
    expect(S.workspace!.ignitions).toBe(0);
    expect(Object.values(S.attention!.rate).every((r) => r === 0)).toBe(true);
    for (const key of V3_COUNTS) expect(S.counts[key as "held"]).toBe(0);
    const event = checkpoint.events.find((e) => e.kind === "self-model-upgrade")!;
    expect(event.data).toMatchObject({
      from: "echo-self-model/v2",
      to: "echo-self-model/v3",
      preservedGraphDigest: v2.graphDigest,
      inquiryOpen: false,
    });
    expect(life.status().selfModel?.echoVersion).toBe("echo-self-model/v3");
    const restored = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    expect(divergence(ECHO_UPGRADED_LIFE, life, restored, [1, 10, 100, 500])).toBeNull();
  }, 60_000);

  it("keeps an inquiry open at the upgrade, without a second look", () => {
    const { v2, before } = v2Fixture(true);
    expect(before.inquiry).not.toBeNull();
    const { checkpoint, life } = continueEchoSelfModel(v2, at);
    const inquiry = echoOf(life).model!.state.inquiry!;
    expect(inquiry.check).toBeNull();
    const { check: _check, ...rest } = inquiry;
    expect(rest).toEqual(before.inquiry);
    expect(
      checkpoint.events.find((e) => e.kind === "self-model-upgrade")!.data.inquiryOpen,
    ).toBe(true);
    const restored = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    expect(divergence(ECHO_UPGRADED_LIFE, life, restored, [1, 10, 100])).toBeNull();
  }, 60_000);

  it("refuses another engine's checkpoint, changed bytes and a repeat", () => {
    const { legacy, v2 } = v2Fixture();
    expect(() => continueEchoSelfModel(legacy, at)).toThrow(/not an ECHO v2/);
    const corrupt = structuredClone(v2);
    corrupt.graph!.nodes.push({ t: "fn" });
    expect(() => continueEchoSelfModel(corrupt, at)).toThrow(/digest/);
    const { checkpoint } = continueEchoSelfModel(v2, at);
    expect(() => continueEchoSelfModel(checkpoint, at)).toThrow(/not an ECHO v2/);
    expect(() => restoreLife(ECHO_UPGRADED_LIFE, v2)).toThrow(/echo-self-model\/v2/);
  }, 60_000);

  it("commits after the engine upgrade under the lease, and verifies the three engines' history", () => {
    const { legacy, v2 } = v2Fixture();
    const dir = mkdtempSync(join(tmpdir(), "echo-v3-"));
    dirs.push(dir);
    LifeStore.create(
      dir,
      { ...BETHESDA_LIFE, versions: LEGACY_VERSIONS },
      legacy,
    ).release();
    // The v2 engine's commit, as the deployed store holds it.
    const v2Store = LifeStore.open(dir, {
      ...ECHO_UPGRADED_LIFE,
      versions: ECHO_V2_VERSIONS,
    });
    v2Store.acquire();
    v2Store.commit(v2);
    v2Store.release();
    const store = LifeStore.open(dir, ECHO_UPGRADED_LIFE);
    expect(() => restoreLife(ECHO_UPGRADED_LIFE, store.head())).toThrow(
      /echo-self-model\/v2/,
    );
    const { checkpoint } = continueEchoSelfModel(store.head(), at);
    store.acquire();
    const noEvent = reseal({ ...structuredClone(checkpoint), events: [] });
    expect(() => store.commit(noEvent)).toThrow(/upgrade event/);
    const falseProof = structuredClone(checkpoint);
    falseProof.events.find(
      (e) => e.kind === "self-model-upgrade",
    )!.data.preservedGraphDigest = "0".repeat(64);
    expect(() => store.commit(reseal(falseProof))).toThrow(/preservation/);
    const asEngine = structuredClone(checkpoint);
    asEngine.events[0]!.kind = "engine-upgrade";
    expect(() => store.commit(reseal(asEngine))).toThrow(/upgrade event/);
    store.commit(checkpoint);
    const life = restoreLife(ECHO_UPGRADED_LIFE, checkpoint);
    life.advanceTicks(10);
    store.commit(
      checkpointLife(ECHO_UPGRADED_LIFE, life, {
        genesis,
        birth: born,
        previous: checkpoint,
      }),
    );
    store.release();
    expect(store.verify()).toEqual({ checkpoints: 4, head: 3, events: 2 });
    expect(bethesdaStoreKind(dir)).toBe(ECHO_UPGRADED_LIFE);
    expect(restoreLife(bethesdaStoreKind(dir), store.head()).city.tick).toBe(
      v2.tick + 10,
    );
  }, 120_000);
});
