import { describe, expect, it } from "vitest";
import { arenaWorld } from "../fly/arena";
import { EchoAdapter } from "../fly/echo/adapter";
import { DigitalFly } from "../fly/fly";
import type { V3 } from "../fly/units";
import {
  BRIDGE_MOVER_ID,
  BridgedWorld,
  BridgeLog,
  DEFAULT_BRIDGE,
  EncounterBridge,
  PerceptChannel,
  verifyChain,
  type BridgeAuthorization,
} from "./bridge";
import {
  checkGardenClock,
  checkLifeClock,
  EncounterClock,
  fitClock,
  type SubjectClock,
} from "./clock";
import {
  applyMap,
  composeMaps,
  fitSimilarity2D,
  identityMap,
  invertMap,
  type FrameMap,
} from "./frames";
import {
  ECHO,
  EVA,
  isOriginalId,
  refuseOriginal,
  refuseProductionHost,
} from "./originals";
import { FLY_EQUIVALENT_RADIUS_M, percept } from "./percept";

const ARENA = {
  size: [1, 0.6, 1] as V3,
  ambient: 1,
  lights: [{ at: [0, 0.6, 0] as V3, intensity: 1 }],
};
const AUTH = (a: string, b: string): BridgeAuthorization => ({
  by: "bridge.test.ts",
  purpose: "unit test",
  subjects: [a, b],
  scope: "research-subjects-only",
});

describe("the originals are refused", () => {
  it("refuses either original's id, its printed prefix and anything containing it", () => {
    for (const o of [EVA, ECHO]) {
      expect(isOriginalId(o.id)).toBe(true);
      expect(isOriginalId(o.id.slice(0, 8))).toBe(true);
      expect(isOriginalId(o.id.toUpperCase())).toBe(true);
      expect(() => refuseOriginal(o.id)).toThrow(/original individual/);
      expect(() => refuseOriginal(o.id.slice(0, 8))).toThrow(/original individual/);
      expect(() => refuseOriginal(`copy-of-${o.id}`)).toThrow(/original individual/);
      expect(() => refuseOriginal(`twin-${o.id.slice(0, 8)}-1`)).toThrow();
    }
    expect(() => refuseOriginal("")).toThrow();
    expect(() => refuseOriginal("research-contact-1")).not.toThrow();
  });

  it("refuses a production host and a production output path", () => {
    expect(() =>
      refuseProductionHost("/tmp/x", (p) => p === "/var/lib/bethesda-life"),
    ).toThrow(/production host/);
    expect(() =>
      refuseProductionHost("/tmp/x", (p) => p === "/var/lib/bethesda-fly"),
    ).toThrow(/production host/);
    expect(() => refuseProductionHost("/var/lib/bethesda-fly/x", () => false)).toThrow(
      /refusing to write/,
    );
    expect(() => refuseProductionHost("/tmp/x", () => false)).not.toThrow();
  });

  it("a bridge refuses an original as an endpoint or in its authorization", () => {
    const at = (p: V3) => () => p;
    const maps: [FrameMap, FrameMap] = [
      identityMap("arena", "test"),
      identityMap("arena", "test"),
    ];
    expect(
      () =>
        new EncounterBridge(
          [
            { id: EVA.id, frame: "arena", position: at([0, 0, 0]) },
            { id: "research-b", frame: "arena", position: at([0, 0, 0]) },
          ],
          maps,
          AUTH(EVA.id, "research-b"),
        ),
    ).toThrow(/original individual/);
    expect(
      () =>
        new EncounterBridge(
          [
            { id: "research-a", frame: "arena", position: at([0, 0, 0]) },
            { id: "research-b", frame: "arena", position: at([0, 0, 0]) },
          ],
          maps,
          AUTH("research-a", "research-c"),
        ),
    ).toThrow(/other subjects/);
  });
});

describe("clocks", () => {
  it("checks each original's own clock contract", () => {
    // Eva's first public observation, docs/LIVE_GARDEN.md: born_at 1792908400.321717.
    expect(
      checkGardenClock({
        bornAt: 1792908400.321717,
        ticks: 10,
        updatedAt: 1792908450.321717,
      }).consistent,
    ).toBe(true);
    expect(
      checkGardenClock({ bornAt: 1792908400.321717, ticks: 10, updatedAt: 1792908452 })
        .consistent,
    ).toBe(false);
    expect(checkLifeClock({ tick: 855931, simulatedSeconds: 85593.1 }).consistent).toBe(
      true,
    );
    expect(checkLifeClock({ tick: 855931, simulatedSeconds: 85600 }).consistent).toBe(
      false,
    );
  });

  it("measures a clock's rate and names its gaps", () => {
    const samples = [
      { utcS: 0, ownS: 100 },
      { utcS: 1, ownS: 101 },
      { utcS: 2, ownS: 102 },
      // A 60 s checkpoint pause: the own clock waits.
      { utcS: 62, ownS: 103 },
      { utcS: 63, ownS: 104 },
    ];
    const fit = fitClock(samples);
    expect(fit.rate).toBeCloseTo(1, 9);
    expect(fit.gaps).toHaveLength(1);
    expect(fit.gaps[0]!.utcAdvanceS).toBe(60);
    expect(fit.offsetS).toBe(104 - 63);
    expect(fit.runningShare!).toBeLessThan(0.1);
  });

  it("keeps two subjects of different ages on one timeline", () => {
    let a = 120,
      b = 45;
    const clocks: [SubjectClock, SubjectClock] = [
      {
        id: "a",
        ownAtContactS: 120,
        read: () => a,
        advance: (dt) => (a = Math.round((a + dt) * 1e6) / 1e6),
      },
      {
        id: "b",
        ownAtContactS: 45,
        read: () => b,
        advance: (dt) => (b = Math.round((b + dt) * 1e6) / 1e6),
      },
    ];
    const clock = new EncounterClock(clocks, { stepS: 0.01, toleranceS: 0.0051 });
    for (let i = 0; i < 1000; i++) expect(clock.step().synchronized).toBe(true);
    expect(clock.tau).toBeCloseTo(10, 9);
    expect(a).toBeCloseTo(130, 6);
    expect(b).toBeCloseTo(55, 6);
    // A subject that does not advance is out of sync, and says so.
    clocks[1].advance = () => {};
    expect(clock.step().synchronized).toBe(false);
  });
});

describe("frames", () => {
  const m: FrameMap = {
    id: "m",
    from: "a",
    to: "b",
    yaw: 0.7,
    scale: 2.5,
    translate: [1, -2, 3],
    class: "design",
    note: "test",
  };
  it("inverts and composes", () => {
    const p: V3 = [0.3, 0.2, -0.9];
    const q = applyMap(invertMap(m), applyMap(m, p));
    q.forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 12));
    const id = composeMaps(m, invertMap(m));
    applyMap(id, p).forEach((v, i) => expect(v).toBeCloseTo(p[i]!, 12));
  });
  it("recovers a similarity from point pairs", () => {
    const a: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [0.4, 0.7],
    ];
    const s = 3,
      th = 0.4;
    const b = a.map(
      ([x, y]) =>
        [
          s * (Math.cos(th) * x - Math.sin(th) * y) + 5,
          s * (Math.sin(th) * x + Math.cos(th) * y) - 1,
        ] as [number, number],
    );
    const fit = fitSimilarity2D(a, b);
    expect(fit.scale).toBeCloseTo(3, 9);
    expect(fit.angle).toBeCloseTo(0.4, 9);
    expect(fit.rmsResidual).toBeLessThan(1e-9);
  });
});

describe("the shared sensory model", () => {
  it("passes a fly-sized body at a place, and nothing else", () => {
    expect(FLY_EQUIVALENT_RADIUS_M).toBeCloseTo(0.00148, 4);
    expect(percept({ center: [0, 1, 2], radius: 0.0015 })).toEqual({
      center: [0, 1, 2],
      radius: 0.0015,
    });
    for (const extra of [
      "id",
      "kind",
      "velocity",
      "mode",
      "heading",
      "lifeId",
      "memories",
      "distance",
    ])
      expect(() => percept({ center: [0, 0, 0], radius: 0.0015, [extra]: 1 })).toThrow(
        /not something one fly can see/,
      );
    expect(() => percept({ center: [0, Number.NaN, 0], radius: 0.0015 })).toThrow();
    expect(() => percept({ center: [0, 0, 0], radius: 1 })).toThrow();
  });
});

describe("the channel never extrapolates", () => {
  it("interpolates between delivered samples, refuses beyond the newest, and forgets on a break", () => {
    const c = new PerceptChannel(0.01);
    expect(c.at(1)).toBeNull();
    c.push(0, { center: [0, 0, 0], radius: 0.001 });
    c.push(0.01, { center: [0.01, 0, 0], radius: 0.001 });
    expect(c.at(0.015)!.center[0]).toBeCloseTo(0.005, 12);
    expect(c.at(0.02)!.center[0]).toBeCloseTo(0.01, 12);
    expect(c.at(0.03)).toBeNull();
    expect(c.stats.beyond).toBe(1);
    c.break();
    expect(c.at(0.02)).toBeNull();
  });
});

describe("the bridged world", () => {
  it("with nothing delivered, a subject steps exactly as in the bare world", () => {
    for (const adapter of [undefined, EchoAdapter.factory({ seed: 11 })]) {
      const bare = new DigitalFly({
        seed: 11,
        world: arenaWorld(ARENA),
        start: { p: [0, 0.3, 0], yaw: 0, mode: "flight", v: [0.2, 0, 0] },
        ...(adapter ? { adapter } : {}),
      });
      const bridged = new DigitalFly({
        seed: 11,
        world: new BridgedWorld(arenaWorld(ARENA), new PerceptChannel(0.01), (t) => t),
        start: { p: [0, 0.3, 0], yaw: 0, mode: "flight", v: [0.2, 0, 0] },
        ...(adapter ? { adapter: EchoAdapter.factory({ seed: 11 }) } : {}),
      });
      for (let i = 0; i < 300; i++) {
        bare.advance(0.1);
        bridged.advance(0.1);
        expect(bridged.stateHash()).toBe(bare.stateHash());
      }
    }
  });

  it("forwards wind only where the wrapped world has it", () => {
    const still = new BridgedWorld(arenaWorld(ARENA), new PerceptChannel(0.01), (t) => t);
    expect("wind" in still).toBe(false);
  });

  it("a delivered percept is seen through the receiver's own eyes, and can evoke an escape", () => {
    // A fly-sized body passing 4 mm from a perched subject at 0.3 m/s.
    const channel = new PerceptChannel(0.01);
    const fly = new DigitalFly({
      seed: 3,
      world: new BridgedWorld(arenaWorld(ARENA), channel, (t) => t),
      start: { p: [0, 0.1, 0], yaw: 0 },
    });
    const head = fly.state.p;
    let seen = 0;
    for (let k = 0; k <= 400; k++) {
      const tau = Math.round(k * 0.01 * 1e6) / 1e6;
      const x = -0.6 + 0.3 * (tau - 0); // starts 60 cm off, arrives at 2 s
      if (tau > 0) fly.advance(0.01);
      channel.push(
        tau,
        percept({
          center: [head[0] + x, head[1] + 0.004, head[2]],
          radius: FLY_EQUIVALENT_RADIUS_M,
        }),
      );
      if (fly.lastFrame?.looming?.id === BRIDGE_MOVER_ID) seen++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(channel.stats.beyond).toBe(0);
  });
});

describe("the bridge", () => {
  const twoSubjects = () => {
    const tau = { now: 0 };
    const mk = (id: string, seed: number, p: V3) => {
      const ch = new PerceptChannel(DEFAULT_BRIDGE.latencyS);
      return { id, seed, p, ch };
    };
    return {
      tau,
      a: mk("research-a", 1, [0, 0.1, 0]),
      b: mk("research-b", 2, [0.01, 0.1, 0]),
    };
  };

  it("delivers both ways only while synchronized, refuses jumps, and keeps a verifiable chain", () => {
    const { a, b } = twoSubjects();
    let pa: V3 = [0, 0.1, 0],
      pb: V3 = [0.05, 0.1, 0];
    const bridge = new EncounterBridge(
      [
        { id: a.id, frame: "arena-a", position: () => pa },
        { id: b.id, frame: "arena-b", position: () => pb },
      ],
      [
        { ...identityMap("x", "b in a"), id: "b→a", from: "arena-b", to: "arena-a" },
        { ...identityMap("x", "a in b"), id: "a→b", from: "arena-a", to: "arena-b" },
      ],
      AUTH(a.id, b.id),
    );
    bridge.open(0);
    const ok = (tau: number) => ({
      tau,
      skewS: [0, 0] as [number, number],
      synchronized: true,
    });
    bridge.exchange(0, ok(0));
    bridge.exchange(0.01, ok(0.01));
    expect(bridge.channel(0).at(0.02)!.center).toEqual([0.05, 0.1, 0]);
    expect(bridge.channel(1).at(0.02)!.center).toEqual([0, 0.1, 0]);
    // A 1 m jump in 10 ms (100 m/s): refused, and nothing is drawn across it.
    pb = [1.05, 0.1, 0];
    bridge.exchange(0.02, ok(0.02));
    expect(bridge.channel(0).at(0.03)).toBeNull();
    pa = [0.001, 0.1, 0];
    bridge.exchange(0.03, { tau: 0.03, skewS: [0, 0.02], synchronized: false });
    expect(bridge.isOpen).toBe(false);
    expect(bridge.channel(0).at(0.04)).toBeNull();
    expect(bridge.channel(1).at(0.04)).toBeNull();
    const kinds = bridge.log.events.map((e) => e.kind);
    expect(kinds).toEqual(["open", "refuse", "desync", "close", "summary"]);
    expect(verifyChain(bridge.log.events)).toBeNull();
    const forged = bridge.log.events.map((e, i) => (i === 1 ? { ...e, tau: 5 } : e));
    expect(verifyChain(forged)).toBe(1);
  });

  it("a log is append-only", () => {
    const log = new BridgeLog();
    const e = log.append(0, "open", {});
    expect(Object.isFrozen(e)).toBe(true);
  });
});
