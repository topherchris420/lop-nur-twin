import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../simulation.js";
import { BETHESDA_LIFE, HeadlessBethesdaLife } from "./headless.js";
import {
  CHECKPOINTING_STALE_AFTER_S,
  NEARBY_M,
  OBSERVATION_SCHEMA,
  parseObservation,
  parseWitness,
  STALE_AFTER_S,
  witness,
  type LifeObservation,
} from "./observation.js";
import {
  readObservation,
  removeObservation,
  writeObservation,
} from "./observationFile.js";

const TEST_CITY: Config = {
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
};
const AT = Date.parse("2026-10-26T15:00:00.000Z");
const observe = (life: HeadlessBethesdaLife, checkpointing = false) =>
  life.observation({
    individual: "a".repeat(64),
    epoch: 3,
    checkpoint: { sequence: 7, tick: 0, committedUtc: "2026-10-26T14:59:00.000Z" },
    checkpointing,
    observedUtc: new Date(AT).toISOString(),
  });

describe("observing the life", () => {
  it("records what an observer may see, and it parses", () => {
    const life = new HeadlessBethesdaLife(TEST_CITY);
    life.advanceTicks(200);
    const o = observe(life);
    expect(parseObservation(JSON.parse(JSON.stringify(o)))).toEqual(o);
    expect(o.schema).toBe(OBSERVATION_SCHEMA);
    expect(o.tick).toBe(200);
    expect(o.fly.position).toEqual([...life.cityFly.fly.state.p]);
    expect(o.fly.recent.length).toBeGreaterThan(0);
    expect(o.flyController).toBe("reduced-order");
    expect(o.selfModel).toBeNull();
    // The city's wind, at 10 m and (weaker near the ground) where the fly is.
    const now = life.cityFly.world.windNow(life.cityFly.fly.state.t);
    expect(o.weather?.regime).toBe(now.regime);
    expect(o.weather?.speedMS).toBe(now.speedMS);
    expect(o.weather!.fromDeg).toBeGreaterThanOrEqual(0);
    expect(o.weather!.fromDeg).toBeLessThan(360);
    expect(o.weather!.atFlyMS).toBeLessThan(now.speedMS);
    for (const n of o.nearby)
      expect(
        Math.hypot(n.x - o.fly.position[0], n.z - o.fly.position[2]),
      ).toBeLessThanOrEqual(NEARBY_M);
  });

  it("summarizes the ECHO fly's self-model", () => {
    const life = new HeadlessBethesdaLife(TEST_CITY, { flyController: "echo" });
    life.advanceTicks(50);
    const o = parseObservation(JSON.parse(JSON.stringify(observe(life))));
    expect(o.flyController).toBe("echo");
    expect(o.selfModel?.echoVersion).toMatch(/^echo-self-model\//);
    // What it attends to, what it last concluded and what it is asking: written, though maybe null.
    expect(o.selfModel!.attending).not.toBeUndefined();
    expect(o.selfModel!.lastConclusion).not.toBeUndefined();
    expect(o.selfModel!.openInquiry).not.toBeUndefined();
  });

  it("reads what an ECHO fly attends to and concluded, refuses it malformed, and reads one written before them", () => {
    const life = new HeadlessBethesdaLife(TEST_CITY, { flyController: "echo" });
    life.advanceTicks(20);
    const good = JSON.parse(JSON.stringify(observe(life))) as LifeObservation;
    const sm = good.selfModel!;
    sm.attending = {
      source: "self",
      what: "why its predictions fail",
      since: 1.5,
      shielded: true,
      expectsNext: "routine",
    };
    sm.lastConclusion = {
      t: 1.2,
      explanation: "self",
      candidate: "self:legs",
      confidence: 0.97,
      resolved: true,
      checked: "revised",
    };
    sm.openInquiry = { since: 1.3, leading: "external:drift", p: 0.6, secondLook: false };
    expect(parseObservation(structuredClone(good)).selfModel).toEqual(sm);
    const broken = (f: (s: Record<string, Record<string, unknown>>) => void) => {
      const o = structuredClone(good);
      f(o.selfModel as unknown as Record<string, Record<string, unknown>>);
      return () => parseObservation(o);
    };
    expect(broken((s) => (s.attending!.source = "<b>"))).toThrow(/attending.source/);
    expect(broken((s) => (s.attending!.shielded = "yes"))).toThrow(/shielded/);
    expect(broken((s) => (s.lastConclusion!.confidence = 1.5))).toThrow(/confidence/);
    expect(broken((s) => (s.lastConclusion!.checked = "maybe"))).toThrow(/checked/);
    expect(broken((s) => (s.openInquiry!.extra = 1))).toThrow(/unexpected extra/);
    const old = structuredClone(good);
    delete old.selfModel!.attending;
    delete old.selfModel!.lastConclusion;
    delete old.selfModel!.openInquiry;
    expect("attending" in parseObservation(old).selfModel!).toBe(false);
  });

  it("changes nothing: a life watched every tick lives as one never watched", () => {
    const watched = new HeadlessBethesdaLife(TEST_CITY),
      alone = new HeadlessBethesdaLife(TEST_CITY);
    for (let i = 0; i < 300; i++) {
      watched.advanceTicks(1);
      observe(watched);
    }
    alone.advanceTicks(300);
    expect(BETHESDA_LIFE.hash(watched)).toBe(BETHESDA_LIFE.hash(alone));
    expect(watched.status()).toEqual(alone.status());
  });
});

describe("validating an observation", () => {
  const life = new HeadlessBethesdaLife(TEST_CITY);
  life.advanceTicks(200);
  const good = JSON.parse(JSON.stringify(observe(life))) as LifeObservation;
  /** The good observation with the value at `path` (dot-separated) replaced. */
  const bad = (path: string, value: unknown) => {
    const o = structuredClone(good) as unknown as Record<string, unknown>;
    const keys = path.split(".");
    let at = o;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    at[keys.at(-1)!] = value;
    return () => parseObservation(o);
  };

  it("refuses anything it does not expect", () => {
    expect(bad("extra", 1)).toThrow(/unexpected extra/);
    expect(bad("schema", "x")).toThrow(/schema/);
    expect(bad("individual", "A".repeat(64))).toThrow(/individual/);
    expect(bad("tick", -1)).toThrow(/tick/);
    expect(bad("checkpoint.tick", good.tick + 1)).toThrow(/later than/);
    expect(bad("fly.position", [0, Number.NaN, 0])).toThrow(/finite/);
    expect(bad("fly.mode", "<script>")).toThrow(/malformed/);
    expect(bad("fly.recent.0.reason", "x".repeat(241))).toThrow(/longer/);
    expect(bad("nearby", Array(25).fill({ kind: "pedestrian", x: 0, z: 0 }))).toThrow(
      /more than/,
    );
    expect(bad("flyController", "echo")).toThrow(/selfModel/);
    expect(bad("checkpointing", "yes")).toThrow(/checkpointing/);
    expect(bad("weather.regime", "hurricane")).toThrow(/weather.regime/);
    expect(bad("weather.fromDeg", 360)).toThrow(/weather.fromDeg/);
    expect(bad("weather.extra", 1)).toThrow(/unexpected extra/);
  });

  it("still reads an observation from a life older than the wind", () => {
    const old = structuredClone(good) as Partial<LifeObservation>;
    delete old.weather;
    const parsed = parseObservation(old);
    expect(parsed.weather).toBeUndefined();
    expect("weather" in parsed).toBe(false);
  });
});

describe("the witness", () => {
  const life = new HeadlessBethesdaLife(TEST_CITY);
  const o = observe(life);

  it("is live while fresh, stale after, and unavailable without an observation", () => {
    expect(witness(o, AT + 1000).status).toBe("live");
    const stale = witness(o, AT + (STALE_AFTER_S + 1) * 1000);
    expect(stale.status).toBe("stale");
    expect(stale.reason).toMatch(/no new observation for 6 s/);
    expect(stale.observation).toEqual(o);
    const none = witness(null, AT);
    expect(none).toMatchObject({ status: "unavailable", observation: null, ageS: null });
  });

  it("waits longer while the life makes a checkpoint", () => {
    const making = observe(life, true);
    expect(witness(making, AT + 60_000).status).toBe("live");
    expect(witness(making, AT + (CHECKPOINTING_STALE_AFTER_S + 1) * 1000).status).toBe(
      "stale",
    );
  });

  it("parses back, and refuses a witness that contradicts itself", () => {
    const w = JSON.parse(JSON.stringify(witness(o, AT + 1000)));
    expect(parseWitness(w)).toEqual(witness(o, AT + 1000));
    expect(() => parseWitness({ ...w, reason: "x" })).toThrow(/null exactly when live/);
    expect(() => parseWitness({ ...w, status: "unavailable" })).toThrow(
      /null exactly when unavailable/,
    );
  });
});

describe("the observation file", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is published whole, readable by others, and gone when removed", () => {
    dir = mkdtempSync(join(tmpdir(), "observation-"));
    const path = join(dir, "observation.json");
    expect(readObservation(path)).toBeNull();
    const o = observe(new HeadlessBethesdaLife(TEST_CITY));
    writeObservation(path, o);
    expect(readObservation(path)).toEqual(o);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o644);
    writeFileSync(path, "{}");
    expect(() => readObservation(path)).toThrow(/missing/);
    removeObservation(path);
    expect(readObservation(path)).toBeNull();
  });
});
