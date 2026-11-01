import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { streamPosition } from "../../lib/noise";
import { sha256, sha256Json } from "../../rain/sha256";
import { EchoAdapter } from "../fly/echo/adapter";
import { MushroomBody } from "../fly/mushroomBody/circuit";
import { resolveMushroomBodyParams } from "../fly/mushroomBody/params";
import type { Place } from "../fly/navigation";
import { bethesdaStoreKind } from "./bethesdaStore";
import {
  birth,
  checkpointLife,
  divergence,
  restoreLife,
  type LifeCheckpoint,
  type LifeEvent,
} from "./continuity";
import {
  continueEchoSelfModel,
  ECHO_UPGRADED_LIFE,
  ECHO_V2_VERSIONS,
  Graph,
  LEGACY_VERSIONS,
  upgradeToEcho,
} from "./echoUpgrade";
import { OlfactoryNavigation } from "./foraging/olfaction";
import { HABIT_EVENT, HABIT_LIFE } from "./habitOrganism";
import { continueWithHabits } from "./habitContinuation";
import { BETHESDA_LIFE, headlessGenesis, type HeadlessGenesis } from "./headless";
import { Physiology } from "./immortal/physiology";
import { parseObservation } from "./observation";
import {
  ARCHIVE_LIMIT,
  LifelongPlaceValuation,
  ORGANISM_CONTINUATION_SOURCE,
  ORGANISM_EVENT,
  ORGANISM_LIFE,
  OrganismAdapter,
  organismProjection,
  type OrganismLife,
} from "./organism";
import { continueAsOrganism, valuationOf } from "./organismContinuation";
import { indexGraph, restoreGraph, snapshotGraph, type GraphSnapshot } from "./snapshot";
import { LifeStore } from "./store";

const genesis = headlessGenesis({
  seed: 393977,
  pedestrians: 4,
  vehicles: 1,
  buses: 0,
  statisticalPopulation: 10,
});
const born = birth(BETHESDA_LIFE.id, genesis, "0123456789abcdef0123456789abcdef");
const at = "2026-10-27T01:00:00.000Z";
const stopped = "2026-10-27T02:00:00.000Z";
const upgraded = "2026-10-27T02:10:00.000Z";
const V3_COUNTS = ["confirmed", "revised", "doubted", "shielded", "held"];
type Checkpoint = LifeCheckpoint<HeadlessGenesis>;
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `${name}-`));
  dirs.push(dir);
  return dir;
};

function reseal(c: Checkpoint): Checkpoint {
  if (c.graph) c.graphDigest = sha256(JSON.stringify(c.graph));
  const { digest: _digest, graph: _graph, ...header } = c;
  c.digest = sha256Json(header);
  return c;
}

/** A legacy reduced-order checkpoint, shaped as echoUpgrade.test.ts shapes it. */
function legacyFixture(): Checkpoint {
  const life = BETHESDA_LIFE.build(genesis);
  life.advanceTicks(20);
  const c = checkpointLife(BETHESDA_LIFE, life, { genesis, birth: born, previous: null });
  c.versions = { ...LEGACY_VERSIONS, graph: "life-graph/v1" };
  const wind = [
    "windFeltMS",
    "windTakeoffMS",
    "maxAirspeedCmS",
    "airflow",
    "airflowFrom",
  ];
  for (const node of c.graph!.nodes) {
    if (node.t !== "o") continue;
    if (node.c === "BethesdaFlyWorld")
      node.e = node.e.filter(([k]) => !["windSeed", "clock0", "storms"].includes(k));
    node.e = node.e.filter(([k]) => !wind.includes(k));
  }
  c.graph = snapshotGraph(
    restoreGraph(c.graph!, BETHESDA_LIFE.build(genesis)),
    indexGraph(BETHESDA_LIFE.build(genesis)),
  );
  return reseal(c);
}

/** The deployed v2 shape: upgraded to ECHO, with what v3 added stripped (as echoUpgrade.test.ts). */
function v2Of(legacy: Checkpoint): Checkpoint {
  const up = upgradeToEcho(legacy, at);
  const echo = up.life.cityFly.fly.adapter as EchoAdapter;
  const S = echo.model!.state as unknown as Record<string, unknown> & {
    counts: Record<string, number>;
    inquiry: Record<string, unknown> | null;
  };
  for (const key of ["workspace", "attention", "airStep"]) delete S[key];
  for (const key of V3_COUNTS) delete S.counts[key];
  if (S.inquiry) delete S.inquiry.check;
  S.schema = "echo-state/v2";
  S.version = ECHO_V2_VERSIONS.echo;
  const descriptor = echo.descriptor as { id: string };
  descriptor.id = descriptor.id.replace("echo-self-model/v3", ECHO_V2_VERSIONS.echo);
  const v2 = checkpointLife(ECHO_UPGRADED_LIFE, up.life, {
    genesis,
    birth: born,
    previous: legacy,
    events: up.checkpoint.events,
  });
  v2.versions = { ...ECHO_V2_VERSIONS, graph: "life-graph/v1" };
  return reseal(v2);
}

let deployed: {
  legacy: Checkpoint;
  v2: Checkpoint;
  upgrade: Checkpoint;
  v3: Checkpoint;
} | null = null;
/**
 * The deployed individual's shape: a legacy birth, ECHO v2, the recorded v3
 * continuation, then a lived v3 era, long enough (on this machine's numerics)
 * for the fly to remember a food place by its landmark and to keep episodes.
 */
function experienced() {
  if (!deployed) {
    const legacy = legacyFixture();
    const v2 = v2Of(legacy);
    const up = continueEchoSelfModel(v2, at);
    const echo = up.life.cityFly.fly.adapter as EchoAdapter;
    const ready = () =>
      echo.inner.state.nav.places.some((p) => p.landmarks.length > 0) &&
      echo.model!.state.episodes.length > 0;
    for (let i = 0; i < 24 && !ready(); i++) up.life.advanceTicks(5_000);
    if (!ready()) throw new Error("the fixture fly formed no memories to keep");
    const v3 = checkpointLife(ECHO_UPGRADED_LIFE, up.life, {
      genesis,
      birth: born,
      previous: up.checkpoint,
    });
    deployed = { legacy, v2, upgrade: up.checkpoint, v3 };
  }
  return structuredClone(deployed);
}

/** A store holding the deployed individual's history: legacy birth, ECHO v2, the v3 continuation, the v3 era. */
function historyStore(dir: string): Checkpoint {
  const { legacy, v2, upgrade, v3 } = experienced();
  LifeStore.create(
    dir,
    { ...BETHESDA_LIFE, versions: LEGACY_VERSIONS },
    legacy,
  ).release();
  const v2Store = LifeStore.open(dir, {
    ...ECHO_UPGRADED_LIFE,
    versions: ECHO_V2_VERSIONS,
  });
  v2Store.acquire();
  v2Store.commit(v2);
  v2Store.release();
  const v3Store = LifeStore.open(dir, ECHO_UPGRADED_LIFE);
  v3Store.acquire();
  v3Store.commit(upgrade);
  v3Store.commit(v3);
  v3Store.release();
  return v3;
}

/** The continuation committed as the one-time script commits it: paused from the v3 fly's last commit. */
function continued(dir: string): Checkpoint {
  const s = LifeStore.open(dir, ORGANISM_LIFE);
  const { checkpoint: head, committedUtc } = s.headRecord();
  const { checkpoint } = continueAsOrganism(head, new Date().toISOString(), committedUtc);
  s.acquire();
  s.commit(checkpoint);
  s.release();
  return checkpoint;
}

const echoOf = (life: { cityFly: { fly: { adapter: unknown } } }) =>
  life.cityFly.fly.adapter as EchoAdapter;
const rngOf = (o: unknown, key = "rng") =>
  streamPosition((o as Record<string, () => number>)[key]!);

describe("the deployed ECHO v3 individual continued as the organism", () => {
  it("keeps its identity, tick, body, memories, beliefs and streams, and adds only the declared components", () => {
    const { v3 } = experienced();
    const untouched = JSON.stringify(v3);
    const before = restoreLife(ECHO_UPGRADED_LIFE, v3);
    const { life, checkpoint, preservedGraphDigest } = continueAsOrganism(
      v3,
      upgraded,
      stopped,
    );
    expect(JSON.stringify(v3)).toBe(untouched);
    // One individual: its birth, genesis and ancestry, at the same tick.
    expect(checkpoint.birth).toEqual(v3.birth);
    expect(checkpoint.birth.individual).toBe(born.individual);
    expect(checkpoint.genesis).toEqual(v3.genesis);
    expect(checkpoint.genesisDigest).toBe(v3.genesisDigest);
    expect(checkpoint.parent).toBe(v3.digest);
    expect(checkpoint.sequence).toBe(v3.sequence + 1);
    expect(checkpoint.tick).toBe(v3.tick);
    expect(life.city.tick).toBe(v3.tick);
    expect(preservedGraphDigest).toBe(v3.graphDigest);
    // Its body, its city and everything its controller and self-model held.
    const a = life.organism,
      was = echoOf(before);
    expect(a).toBeInstanceOf(OrganismAdapter);
    expect(a).toBeInstanceOf(EchoAdapter);
    expect(life.city.stateHash()).toBe(before.city.stateHash());
    expect(life.cityFly.fly.state).toEqual(before.cityFly.fly.state);
    expect(life.cityFly.fly.log).toEqual(before.cityFly.fly.log);
    expect(a.inner.state).toEqual(was.inner.state);
    expect(a.model!.state).toEqual(was.model!.state);
    expect(a.state.replaced).toEqual(was.state.replaced);
    expect(a.model!.state.episodes.length).toBeGreaterThan(0);
    // Every stream where it was.
    expect(rngOf(a.inner)).toBe(rngOf(was.inner));
    expect(rngOf((a.inner as unknown as { nav: unknown }).nav)).toBe(
      rngOf((was.inner as unknown as { nav: unknown }).nav),
    );
    // The additions, and only they, are new: an innate circuit, filters at rest, resting tissue.
    const seed = life.cityFly.seed;
    expect(a.circuit.state).toEqual(
      new MushroomBody(resolveMushroomBodyParams(), seed).state,
    );
    expect(a.physiology.state).toEqual(new Physiology(true).state);
    expect(a.olfaction.state).toEqual(new OlfactoryNavigation(seed).state);
    expect(rngOf(a.olfaction)).toBe(rngOf(new OlfactoryNavigation(seed)));
    expect(life.archive).toEqual([]);
    // The places it remembers are the navigator's own, valued by the rule they were learned under.
    const places = a.inner.state.nav.places;
    expect(places.some((p) => p.landmarks.length > 0)).toBe(true);
    expect(a.valuation.inherited).toHaveLength(places.length);
    a.valuation.inherited.forEach((p, i) => expect(p).toBe(places[i]));
    expect(valuationOf(a)).toBe(a.valuation);
    // One recorded continuation, attesting its exact parent and what it added.
    expect(checkpoint.events).toHaveLength(1);
    const event = checkpoint.events[0]!;
    expect(event).toMatchObject({ tick: v3.tick, kind: ORGANISM_EVENT });
    expect(event.data).toMatchObject({
      sourceRelease: ORGANISM_CONTINUATION_SOURCE,
      parent: v3.digest,
      sourceStateHash: v3.stateHash,
      sourceGraphDigest: v3.graphDigest,
      preservedGraphDigest: v3.graphDigest,
      pausedFromUtc: stopped,
      upgradedUtc: upgraded,
      kept: {
        rememberedPlaces: places.length,
        inquiries: was.model!.state.counts.inquiries,
        episodesKept: was.model!.state.episodes.length,
        lastEpisode: was.model!.state.episodes.at(-1)!.id,
      },
    });
    // Anyone holding the checkpoint can take the v3 graph back out of it.
    expect(
      organismProjection(checkpoint.graph!, event.data.sourceDescriptor as GraphSnapshot),
    ).toBe(v3.graphDigest);
    const restored = restoreLife(ORGANISM_LIFE, checkpoint);
    expect(valuationOf(restored.organism)).toBe(restored.organism.valuation);
    expect(divergence(ORGANISM_LIFE, life, restored, [1, 10, 100, 500])).toBeNull();
  }, 240_000);

  it("values the places it remembered by their old rule and new ones by its mushroom body", () => {
    const circuit = new MushroomBody(resolveMushroomBodyParams(), 7);
    const valuation = new LifelongPlaceValuation(circuit);
    const place = (x: number, cue: string): Place => ({
      kind: "food",
      what: "cafe",
      at: [x, x],
      landmarks: [cue],
      t: 0,
      misses: 0,
    });
    const old = place(0, "old-landmark"),
      later = place(9, "new-landmark");
    valuation.inherited.push(old);
    // Synapses that never saw a place cannot give it up: it still draws a hungry fly.
    expect(valuation.worth(old)).toBe(true);
    expect(valuation.worth(later)).toBe(circuit.worth(later));
    // A fruitless return there is learned from, and counted by the rule it was learned under.
    expect(valuation.missed(old)).toBe(false);
    expect(circuit.state.trials).toBe(1);
    expect(circuit.state.last).toMatchObject({
      event: "fruitless return",
      cue: "old-landmark",
    });
    expect(valuation.missed(old)).toBe(true);
    expect(valuation.inherited).toEqual([]);
    // From then on the circuit learns every meal, and values the places remembered since.
    valuation.fed(later);
    expect(circuit.state.last).toMatchObject({ event: "meal", cue: "new-landmark" });
    expect(valuation.missed(later)).toBe(false);
    expect(circuit.state.last).toMatchObject({
      event: "fruitless return",
      cue: "new-landmark",
    });
    // It lets go of what the navigator itself no longer remembers.
    valuation.inherited.push(old);
    valuation.keep([later]);
    expect(valuation.inherited).toEqual([]);
  });

  it("refuses every source it cannot verify, a repeat, and an engine that would run it as another", () => {
    const { legacy, v2, v3 } = experienced();
    expect(() => continueAsOrganism(legacy, upgraded)).toThrow(/not an ECHO v3/);
    expect(() => continueAsOrganism(v2, upgraded)).toThrow(/not an ECHO v3/);
    const corrupt = structuredClone(v3);
    corrupt.graph!.nodes.push({ t: "fn" });
    expect(() => continueAsOrganism(corrupt, upgraded)).toThrow(/digest/);
    const compacted = structuredClone(v3);
    compacted.graph = null;
    expect(() => continueAsOrganism(compacted, upgraded)).toThrow(/compacted/);
    expect(() => continueAsOrganism(v3, stopped, upgraded)).toThrow(/UTC/);
    const failed = structuredClone(v3);
    new Graph(failed.graph!, false).set(["cityFly", "failed"], "a test failure");
    expect(() => continueAsOrganism(reseal(failed), upgraded)).toThrow(/healthy/);
    const { checkpoint } = continueAsOrganism(v3, upgraded, stopped);
    expect(() => continueAsOrganism(checkpoint, upgraded)).toThrow(/not an ECHO v3/);
    // Neither engine restores the other's checkpoint as its own.
    expect(() => restoreLife(ECHO_UPGRADED_LIFE, checkpoint)).toThrow();
    expect(() => restoreLife(ORGANISM_LIFE, v3)).toThrow();
  }, 240_000);

  it("admits the continuation only from the exact v3 parent, once, and never as a birth", () => {
    const { upgrade, v3 } = experienced();
    const { checkpoint } = continueAsOrganism(v3, upgraded, stopped);
    const transition = ORGANISM_LIFE.history!.transition;
    expect(transition(v3, checkpoint)).toEqual([]);
    // The older engines' history still verifies under this kind.
    expect(transition(upgrade, v3)).toEqual([]);
    expect(transition(null, checkpoint).join()).toMatch(/never a birth/);
    expect(transition(checkpoint, v3).join()).toMatch(/cannot revert/);
    const edit = (f: (c: Checkpoint) => void) => {
      const c = structuredClone(checkpoint);
      f(c);
      return transition(v3, reseal(c)).join();
    };
    expect(edit((c) => (c.events = []))).toMatch(/exactly one organism event/);
    expect(edit((c) => (c.tick += 1))).toMatch(/exactly one organism event/);
    expect(edit((c) => (c.events[0]!.data.sourceRelease = "0".repeat(40)))).toMatch(
      /preservation/,
    );
    expect(edit((c) => (c.events[0]!.data.parent = upgrade.digest))).toMatch(
      /preservation/,
    );
    expect(edit((c) => (c.events[0]!.data.pausedFromUtc = "never"))).toMatch(/pause/);
    // A fly newly built from the same genesis and seed is not this individual,
    // even with every claim copied from the real continuation.
    const newborn = structuredClone(checkpoint);
    newborn.graph = snapshotGraph(
      ORGANISM_LIFE.build(structuredClone(genesis)),
      indexGraph(ORGANISM_LIFE.build(structuredClone(genesis))),
    );
    expect(transition(v3, reseal(newborn)).join()).toMatch(/byte for byte/);
    // Once continued, it is never continued again.
    const life = restoreLife(ORGANISM_LIFE, checkpoint);
    life.advanceTicks(10);
    const next = checkpointLife(ORGANISM_LIFE, life, {
      genesis,
      birth: born,
      previous: checkpoint,
    });
    expect(transition(checkpoint, next)).toEqual([]);
    const again = structuredClone(next);
    again.events = [structuredClone(checkpoint.events[0]!)];
    expect(transition(checkpoint, reseal(again)).join()).toMatch(/cannot be repeated/);
  }, 240_000);

  it("recovers a depleted fly by artificial maintenance, resetting no memory, synapse or identity", () => {
    const { v3 } = experienced();
    const { life } = continueAsOrganism(v3, upgraded, stopped);
    const a = life.organism,
      fly = life.cityFly.fly,
      S = a.model!.state;
    const held = { episodes: S.episodes.map((e) => e.id), inquiries: S.counts.inquiries };
    // A test intervention on a disposable life: the reserve nearly empty.
    fly.state.reserve = 0.02 * fly.params.reserveJ;
    const fedBefore = fly.state.counts.fedJ;
    const events: LifeEvent[] = [];
    for (let i = 0; i < 40 && !events.some((e) => e.kind === "recovery-exit"); i++) {
      life.advanceTicks(1_000);
      events.push(...life.takeArchive());
    }
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("recovery-enter");
    expect(kinds).toContain("recovery-exit");
    const p = a.physiology.state;
    expect(p.recoveryBouts).toBeGreaterThanOrEqual(1);
    expect(p.maintenanceJ).toBeGreaterThan(0);
    expect(p.protective).toBe(false);
    expect(life.cityFly.failed).toBeNull();
    expect(fly.state.reserve / fly.params.reserveJ).toBeGreaterThanOrEqual(0.35);
    // The artificial supply is metered apart from food.
    expect(p.maintenanceJ).toBeGreaterThan(fly.state.counts.fedJ - fedBefore);
    // Nothing was reset: the same self-model, no replacement recorded, its record continuing.
    expect(a.model!.state).toBe(S);
    expect(a.state.replaced).toEqual([]);
    expect(S.counts.inquiries).toBeGreaterThanOrEqual(held.inquiries);
    const archived = events
      .filter((e) => e.kind === "echo-episode-archived")
      .map((e) => (e.data.episode as { id: number }).id);
    for (const id of held.episodes)
      expect(S.episodes.some((e) => e.id === id) || archived.includes(id)).toBe(true);
  }, 240_000);

  it("archives every episode its memory lets go, and stops the clock rather than drop a record", () => {
    const { v3 } = experienced();
    const { life } = continueAsOrganism(v3, upgraded, stopped);
    const S = life.organism.model!.state;
    const first = structuredClone(S.episodes[0]!);
    // As the self-model's memory does when full: let its least salient record go during a tick.
    const cityFly = life.cityFly as unknown as { tick(): void };
    const tick = cityFly.tick.bind(cityFly);
    Object.defineProperty(cityFly, "tick", {
      configurable: true,
      value: () => {
        tick();
        S.episodes.splice(0, 1);
      },
    });
    life.advanceTicks(1);
    delete (cityFly as { tick?: unknown }).tick;
    const archived = life.archive.filter((e) => e.kind === "echo-episode-archived");
    expect(archived).toHaveLength(1);
    expect(archived[0]!.tick).toBe(life.city.tick);
    expect((archived[0]!.data.episode as { id: number }).id).toBe(first.id);
    // A full archive stops the clock before the tick; nothing is dropped or advanced.
    const tickBefore = life.city.tick;
    while (life.archive.length <= ARCHIVE_LIMIT - 64)
      life.archive.push({ tick: tickBefore, kind: "test-record", data: {} });
    const pending = life.archive.length;
    expect(() => life.advanceTicks(1)).toThrow(/backpressure/);
    expect(life.city.tick).toBe(tickBefore);
    expect(life.archive).toHaveLength(pending);
    const taken = life.takeArchive();
    expect(life.archive).toEqual([]);
    life.returnArchive(taken);
    expect(life.archive).toHaveLength(pending);
  }, 240_000);

  it("lives through longer and longer runs, every checkpoint verified and restored, its own state bounded", () => {
    const { v3 } = experienced();
    const start = continueAsOrganism(v3, upgraded, stopped);
    let life: OrganismLife = start.life;
    let previous = start.checkpoint;
    const t0 = life.cityFly.fly.state.t;
    let lived = 0;
    for (const run of [1_000, 4_000, 16_000]) {
      for (let left = run; left > 0; left -= 4_000)
        life.advanceTicks(Math.min(left, 4_000));
      lived += run;
      const next = checkpointLife(ORGANISM_LIFE, life, {
        genesis,
        birth: born,
        previous,
        events: life.takeArchive(),
      });
      expect(ORGANISM_LIFE.history!.transition(previous, next)).toEqual([]);
      // Continue from the restored copy, as a restarted process does.
      const restored = restoreLife(ORGANISM_LIFE, next);
      expect(ORGANISM_LIFE.hash(restored)).toBe(ORGANISM_LIFE.hash(life));
      life = restored;
      previous = next;
      const a = life.organism,
        p = a.physiology.state;
      for (const v of [p.atp, p.water, p.fatigue, p.sleepPressure, p.stress])
        expect(v >= 0 && v <= 1).toBe(true);
      expect(a.circuit.state.wPlus).toHaveLength(resolveMushroomBodyParams().kenyonCells);
      expect(a.circuit.state.wPlus.every((w) => Number.isFinite(w) && w >= 0)).toBe(true);
      expect(a.model!.state.episodes.length).toBeLessThanOrEqual(24);
      expect(a.valuation.inherited.length).toBeLessThanOrEqual(
        start.life.organism.valuation.inherited.length,
      );
      expect(life.archive).toEqual([]);
      expect(valuationOf(a)).toBe(a.valuation);
    }
    // Simulated time is exactly the ticks computed: nothing skipped, nothing claimed.
    expect(life.city.tick).toBe(v3.tick + lived);
    expect(life.cityFly.fly.state.t - t0).toBeCloseTo(lived * 0.1, 3);
    expect(life.cityFly.failed).toBeNull();
  }, 300_000);

  it("is witnessed as the same ECHO fly, and watching it changes nothing", () => {
    const { v3 } = experienced();
    const { checkpoint } = continueAsOrganism(v3, upgraded, stopped);
    const watched = restoreLife(ORGANISM_LIFE, checkpoint);
    const unwatched = restoreLife(ORGANISM_LIFE, checkpoint);
    const look = () =>
      parseObservation(
        JSON.parse(
          JSON.stringify(
            watched.observation({
              individual: born.individual,
              epoch: 10,
              checkpoint: {
                sequence: checkpoint.sequence,
                tick: checkpoint.tick,
                committedUtc: upgraded,
              },
              checkpointing: false,
              observedUtc: upgraded,
            }),
          ),
        ),
      );
    const first = look();
    expect(first.tick).toBe(v3.tick);
    expect(first.flyController).toBe("echo");
    expect(first.selfModel?.echoVersion).toBe("echo-self-model/v3");
    expect(watched.selfModelCheckpoint()).not.toBeNull();
    for (let i = 0; i < 300; i++) {
      watched.advanceTicks(1);
      if (i % 10 === 0) look();
    }
    unwatched.advanceTicks(300);
    expect(ORGANISM_LIFE.hash(watched)).toBe(ORGANISM_LIFE.hash(unwatched));
  }, 240_000);
});

describe("the organism's store", () => {
  it("commits the continuation under the lease, refuses forgeries, forks, another genesis and a second writer", () => {
    const dir = scratch("organism-store");
    const v3 = historyStore(dir);
    const identity = readFileSync(join(dir, "individual.json"), "utf8");
    expect(bethesdaStoreKind(dir)).toBe(ECHO_UPGRADED_LIFE);
    const s = LifeStore.open(dir, ORGANISM_LIFE, { holder: "the writer" });
    const { checkpoint } = continueAsOrganism(s.head(), upgraded, stopped);
    s.acquire();
    const noEvent = reseal({ ...structuredClone(checkpoint), events: [] });
    expect(() => s.commit(noEvent)).toThrow(/exactly one organism event/);
    const falseProof = structuredClone(checkpoint);
    falseProof.events[0]!.data.preservedGraphDigest = "0".repeat(64);
    expect(() => s.commit(reseal(falseProof))).toThrow(/preservation/);
    const newborn = structuredClone(checkpoint);
    newborn.graph = snapshotGraph(
      ORGANISM_LIFE.build(structuredClone(genesis)),
      indexGraph(ORGANISM_LIFE.build(structuredClone(genesis))),
    );
    expect(() => s.commit(reseal(newborn))).toThrow(/byte for byte/);
    const otherGenesis = structuredClone(checkpoint);
    otherGenesis.genesis.config.seed += 1;
    otherGenesis.genesisDigest = sha256Json(otherGenesis.genesis);
    expect(() => s.commit(reseal(otherGenesis))).toThrow(/genesis|individual/);
    s.commit(checkpoint);
    expect(() => s.commit(checkpoint)).toThrow(/fork/);
    // A second writer is refused while the lease is held, and a fenced one after it took over.
    const second = LifeStore.open(dir, ORGANISM_LIFE, { holder: "a second writer" });
    expect(() => second.acquire()).toThrow(/lease is held/);
    const life = restoreLife(ORGANISM_LIFE, checkpoint);
    life.advanceTicks(200);
    const next = checkpointLife(ORGANISM_LIFE, life, {
      genesis,
      birth: born,
      previous: checkpoint,
      events: life.takeArchive(),
    });
    const later = LifeStore.open(dir, ORGANISM_LIFE, {
      holder: "a later writer",
      now: () => Date.now() + 120_000,
    });
    later.acquire();
    expect(() => s.commit(next)).toThrow(/epoch|lease/);
    later.commit(next);
    later.release();
    expect(later.verify()).toMatchObject({ checkpoints: 6, head: 5 });
    expect(readFileSync(join(dir, "individual.json"), "utf8")).toBe(identity);
    expect(bethesdaStoreKind(dir)).toBe(ORGANISM_LIFE);
    const events = LifeStore.open(dir, ORGANISM_LIFE).events();
    expect(events.filter((e) => e.kind === ORGANISM_EVENT)).toHaveLength(1);
    expect(LifeStore.open(dir, ORGANISM_LIFE).head().tick).toBe(v3.tick + 200);
  }, 300_000);
});

const runTs = (script: string, args: string[], timeout = 240_000) =>
  spawnSync(process.execPath, ["scripts/run-ts.mjs", script, ...args], {
    cwd: repo,
    encoding: "utf8",
    timeout,
  });
const runner = (args: string[]) => runTs("scripts/bethesda-life-headless.ts", args);
const lastJson = (out: string) =>
  JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, unknown>;
const latestLease = (dir: string) => {
  const name = readdirSync(join(dir, "leases")).sort().at(-1)!;
  return JSON.parse(readFileSync(join(dir, "leases", name), "utf8")) as {
    epoch: number;
    expiresUtc: string;
  };
};
const until = async (done: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 250));
  }
};

describe("the runner with an organism", () => {
  it("resumes the same individual across restarts, records each pause, and verifies the whole chain", () => {
    const dir = scratch("organism-runner");
    historyStore(dir);
    const organism = continued(dir);
    const identity = readFileSync(join(dir, "individual.json"), "utf8");
    const check = runner(["--store", dir, "--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(lastJson(check.stdout)).toMatchObject({
      individual: born.individual,
      restored: true,
      checkpoint: organism.sequence,
      organism: { version: "bethesda-echo-organism/v1" },
    });
    for (let i = 0; i < 2; i++) {
      const run = runner(["--store", dir, "--ticks", "300"]);
      expect(run.status, run.stderr).toBe(0);
    }
    const verify = runner(["--store", dir, "--verify"]);
    expect(verify.status, verify.stderr).toBe(0);
    expect(lastJson(verify.stdout)).toMatchObject({
      checkpoints: organism.sequence + 3,
      head: organism.sequence + 2,
    });
    const s = LifeStore.open(dir, ORGANISM_LIFE);
    expect(s.head().tick).toBe(organism.tick + 600);
    const gaps = s.events().filter((e) => e.kind === "gap");
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    // The pause before the first resume began when the v3 fly stopped, as the continuation records it.
    const first = gaps.find((e) => e.tick === organism.tick)!;
    expect(first.data.stoppedUtc).toBe(organism.events[0]!.data.pausedFromUtc);
    expect(readFileSync(join(dir, "individual.json"), "utf8")).toBe(identity);
  }, 300_000);

  it("after a hard kill: refuses a second writer, resumes only what was committed, and starts no one new", async () => {
    const dir = scratch("organism-kill");
    historyStore(dir);
    const organism = continued(dir);
    const epoch = latestLease(dir).epoch;
    const child: ChildProcess = spawn(
      process.execPath,
      [
        "scripts/run-ts.mjs",
        "scripts/bethesda-life-headless.ts",
        "--store",
        dir,
        "--continuous",
      ],
      { cwd: repo, stdio: "ignore" },
    );
    try {
      await until(() => latestLease(dir).epoch > epoch, 60_000);
      await new Promise((r) => setTimeout(r, 3_000));
      const second = runner(["--store", dir, "--ticks", "10"]);
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(/lease is held/);
    } finally {
      child.kill("SIGKILL");
    }
    await new Promise((r) => child.once("exit", r));
    // Its lease outlives it: nothing may write until it expires.
    const early = runner(["--store", dir, "--ticks", "10"]);
    if (Date.parse(latestLease(dir).expiresUtc) > Date.now() + 5_000) {
      expect(early.status).toBe(1);
      expect(early.stderr).toMatch(/lease is held/);
    }
    await until(
      () => Date.parse(latestLease(dir).expiresUtc) < Date.now() - 1_000,
      90_000,
    );
    const resumed = runner(["--store", dir, "--ticks", "100"]);
    expect(resumed.status, resumed.stderr).toBe(0);
    const s = LifeStore.open(dir, ORGANISM_LIFE);
    // What the killed process computed was never committed, so it is not claimed.
    expect(s.head().tick).toBe(organism.tick + 100);
    expect(s.head().birth.individual).toBe(born.individual);
    expect(s.events().filter((e) => e.kind === ORGANISM_EVENT)).toHaveLength(1);
  }, 300_000);

  it("fails closed, with its reason, instead of starting a fly in place of one it cannot restore", () => {
    const empty = scratch("organism-empty");
    const none = runner(["--store", empty, "--ticks", "10"]);
    expect(none.status).toBe(1);
    expect(none.stderr.trim().length).toBeGreaterThan(0);
    expect(readdirSync(empty)).toEqual([]);
    const dir = scratch("organism-corrupt");
    historyStore(dir);
    const organism = continued(dir);
    const head = join(
      dir,
      "checkpoints",
      `${String(organism.sequence).padStart(12, "0")}.json`,
    );
    const text = readFileSync(head, "utf8");
    writeFileSync(
      head,
      text.replace(`"tick":${organism.tick}`, `"tick":${organism.tick + 1}`),
    );
    const files = readdirSync(join(dir, "checkpoints"));
    const run = runner(["--store", dir, "--ticks", "10"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/corrupt|seal|digest|refused/);
    expect(readdirSync(join(dir, "checkpoints"))).toEqual(files);
  }, 300_000);

  it("continues a v3 store once by the one-time script, only from the exact deployed release", () => {
    const dir = scratch("organism-script");
    const v3 = historyStore(dir);
    const release = scratch("organism-release");
    symlinkSync(join(repo, "src"), join(release, "src"), "junction");
    const script = "scripts/bethesda-life-continue-organism.ts";
    const wrong = scratch("organism-wrong-release");
    writeFileSync(join(wrong, "RELEASE"), "commit 0000000\n");
    const refused = runTs(script, ["--store", dir, "--from-release", wrong, "--check"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/exact deployed d25e1f3/);
    writeFileSync(join(release, "RELEASE"), `commit ${ORGANISM_CONTINUATION_SOURCE}\n`);
    const files = () =>
      readdirSync(join(dir, "checkpoints")).map((f) =>
        sha256(readFileSync(join(dir, "checkpoints", f), "utf8")),
      );
    const before = files();
    const check = runTs(script, ["--store", dir, "--from-release", release, "--check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(lastJson(check.stdout)).toMatchObject({
      mode: "--check",
      individual: born.individual,
      tick: v3.tick,
      sourceGraphDigest: v3.graphDigest,
      preservedGraphDigest: v3.graphDigest,
      committedUtc: null,
    });
    expect(files()).toEqual(before);
    const commit = runTs(script, ["--store", dir, "--from-release", release, "--commit"]);
    expect(commit.status, commit.stderr).toBe(0);
    expect(bethesdaStoreKind(dir)).toBe(ORGANISM_LIFE);
    const again = runTs(script, ["--store", dir, "--from-release", release, "--check"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already continued/);
  }, 300_000);

  it("after an interrupted --commit holds the v3 head or the whole continuation, never part of one and never two", () => {
    const script = "scripts/bethesda-life-continue-organism.ts";
    const release = scratch("organism-interrupt-release");
    symlinkSync(join(repo, "src"), join(release, "src"), "junction");
    writeFileSync(join(release, "RELEASE"), `commit ${ORGANISM_CONTINUATION_SOURCE}\n`);
    const continuation = (dir: string, mode: string) =>
      runTs(script, ["--store", dir, "--from-release", release, mode]);
    const files = (dir: string) => readdirSync(join(dir, "checkpoints")).sort();

    // Killed while writing: a partial file beside the checkpoints, and its lease still held.
    const dir = scratch("organism-interrupted");
    const v3 = historyStore(dir);
    const next = join(
      dir,
      "checkpoints",
      `${String(v3.sequence + 1).padStart(12, "0")}.json`,
    );
    writeFileSync(
      `${next}.99999.${Date.now()}.tmp`,
      '{"schema":"life-store/v1","epoch":',
    );
    const held = LifeStore.open(dir, ORGANISM_LIFE);
    held.acquire();
    const before = files(dir);
    const check = continuation(dir, "--check");
    expect(check.status, check.stderr).toBe(0);
    expect(lastJson(check.stdout)).toMatchObject({
      tick: v3.tick,
      previousSequence: v3.sequence,
    });
    const blocked = continuation(dir, "--commit");
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toMatch(/lease is held/);
    expect(files(dir)).toEqual(before);
    expect(LifeStore.open(dir, ORGANISM_LIFE).head().digest).toBe(v3.digest);
    // Once that lease is gone the continuation is made, once; the partial file is never read.
    held.release();
    const commit = continuation(dir, "--commit");
    expect(commit.status, commit.stderr).toBe(0);
    const s = LifeStore.open(dir, ORGANISM_LIFE);
    expect(s.head().sequence).toBe(v3.sequence + 1);
    expect(s.events().filter((e) => e.kind === ORGANISM_EVENT)).toHaveLength(1);
    expect(files(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(1);

    // Killed after the commit, before letting its lease go: the continuation stands, and is never made again.
    const late = scratch("organism-interrupted-late");
    historyStore(late);
    const store = LifeStore.open(late, ORGANISM_LIFE);
    const { checkpoint: head, committedUtc } = store.headRecord();
    store.acquire();
    store.commit(
      continueAsOrganism(head, new Date().toISOString(), committedUtc).checkpoint,
    );
    const again = continuation(late, "--check");
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/already continued/);
    const waiting = runner(["--store", late, "--ticks", "10"]);
    expect(waiting.status).toBe(1);
    expect(waiting.stderr).toMatch(/lease is held/);
    store.release();
    const resumed = runner(["--store", late, "--ticks", "100"]);
    expect(resumed.status, resumed.stderr).toBe(0);
    const t = LifeStore.open(late, ORGANISM_LIFE);
    expect(t.head().tick).toBe(head.tick + 100);
    expect(t.head().birth.individual).toBe(born.individual);
    expect(t.events().filter((e) => e.kind === ORGANISM_EVENT)).toHaveLength(1);
  }, 600_000);

  it("commits one habit continuation onto the full legacy → ECHO → organism chain and resumes that individual", () => {
    const dir = scratch("echo-habit-history");
    const organism = continued(dir);
    const s = LifeStore.open(dir, HABIT_LIFE);
    const { checkpoint: source, committedUtc } = s.headRecord();
    expect(source.digest).toBe(organism.digest);
    const before = restoreLife(ORGANISM_LIFE, source);
    const keptState = before.organism.state;
    const next = continueWithHabits(source, new Date().toISOString(), committedUtc);
    expect(next.checkpoint.birth).toEqual(source.birth);
    expect(next.checkpoint.genesis).toEqual(source.genesis);
    expect(next.checkpoint.parent).toBe(source.digest);
    expect(next.checkpoint.tick).toBe(source.tick);
    expect(next.preservedGraphDigest).toBe(source.graphDigest);
    const inherited: Record<string, unknown> = { ...next.life.adaptive.state };
    delete inherited.habits;
    expect(inherited).toEqual(keptState);
    s.acquire();
    try { s.commit(next.checkpoint); } finally { s.release(); }
    const reopened = LifeStore.open(dir, HABIT_LIFE);
    reopened.verify();
    expect(bethesdaStoreKind(dir)).toBe(HABIT_LIFE);
    expect(reopened.head().birth.individual).toBe(source.birth.individual);
    expect(reopened.events().filter(e => e.kind === HABIT_EVENT)).toHaveLength(1);
    expect(reopened.events().filter(e => e.kind === ORGANISM_EVENT)).toHaveLength(1);
    const run = runner(["--store", dir, "--ticks", "10"]);
    expect(run.status, run.stderr).toBe(0);
    const resumed = LifeStore.open(dir, HABIT_LIFE);
    expect(resumed.head().birth).toEqual(source.birth);
    expect(resumed.head().tick).toBe(source.tick + 10);
    expect(resumed.events().filter(e => e.kind === HABIT_EVENT)).toHaveLength(1);
  }, 600_000);
});
