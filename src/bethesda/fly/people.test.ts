import { describe, expect, it } from "vitest";
import { DigitalFly } from "./fly";
import {
  PEOPLE_PARAMS,
  People,
  perceive,
  resolvePeopleParams,
  type PeopleConfig,
  type PersonView,
} from "./people";
import { degToRad, type V3 } from "./units";
import { PrimitiveWorld, type Mover } from "./world";

const P = resolvePeopleParams();
/** Someone standing at the origin, facing +x. */
const ALICE: PersonView = { id: "p1", x: 0, z: 0, g: 0, heading: 0 };
const clear = () => true;
/** A point at `dist` from Alice's eyes, `deg` to her left and `up` degrees above eye level. */
const fromEyes = (dist: number, deg: number, up = 0): V3 => {
  const a = degToRad(deg),
    e = degToRad(up);
  return [
    dist * Math.cos(e) * Math.cos(a),
    P.eyeHeightM + dist * Math.sin(e),
    -dist * Math.cos(e) * Math.sin(a),
  ];
};

/** People who see whatever is in front of them, around Alice alone. */
const people = (config: PeopleConfig = {}, seed = 1) =>
  new People({
    seed,
    sight: clear,
    where: (id) => (id === ALICE.id ? ALICE : null),
    config,
  });

/** Alice looks at a fly held still at `p` every 50 ms for `seconds`. */
const watch = (folk: People, p: V3, seconds: number, flying = true, t0 = 0) => {
  for (let k = 0; k <= Math.round(seconds / 0.05); k++)
    folk.observe(t0 + k * 0.05, { p, flying }, [ALICE]);
};

describe("what a person can see of the fly", () => {
  it("sees it in front of them, not behind, and only as far as their acuity reaches", () => {
    const look = (p: V3, flying = true, looking = false) =>
      perceive(P, ALICE, { p, flying }, looking, clear);
    expect(look(fromEyes(1, 0)).inSight).toBe(true);
    // Outside the 214° field: behind them.
    expect(look(fromEyes(1, 180)).inField).toBe(false);
    expect(look(fromEyes(1, 110)).inField).toBe(false);
    expect(look(fromEyes(1, 100)).inField).toBe(true);
    // Straight ahead, a flying fly is resolved out to about 18 m, a perched one to 10 m.
    expect(look(fromEyes(17, 0)).resolved).toBe(true);
    expect(look(fromEyes(19, 0)).resolved).toBe(false);
    expect(look(fromEyes(9.5, 0), false).resolved).toBe(true);
    expect(look(fromEyes(11, 0), false).resolved).toBe(false);
  });
  it("needs it larger the farther it is from where they look", () => {
    const at2m = (deg: number) =>
      perceive(P, ALICE, { p: fromEyes(2, deg), flying: true }, false, clear);
    // 2 m away a flying fly spans about 9′: enough 5° off their gaze, not 30°.
    expect(at2m(5).resolved).toBe(true);
    expect(at2m(30).resolved).toBe(false);
    expect(at2m(30).neededArcmin).toBeCloseTo(1 + 30 / 2.72, 9);
    // Once they look at it, it is where their eyes point, as far round as
    // head and eyes turn (130°), and no farther.
    const followed = (deg: number) =>
      perceive(P, ALICE, { p: fromEyes(2, deg), flying: true }, true, clear);
    expect(followed(120).inSight).toBe(true);
    expect(followed(120).eccentricityDeg).toBe(0);
    expect(followed(150).inSight).toBe(false);
  });
  it("does not see it behind something, and casts no line of sight it does not need", () => {
    let lines = 0;
    const blocked = () => {
      lines++;
      return false;
    };
    expect(
      perceive(P, ALICE, { p: fromEyes(1, 0), flying: true }, false, blocked).inSight,
    ).toBe(false);
    expect(lines).toBe(1);
    perceive(P, ALICE, { p: fromEyes(1, 180), flying: true }, false, blocked);
    perceive(P, ALICE, { p: fromEyes(40, 0), flying: true }, false, blocked);
    expect(lines).toBe(1);
  });
});

describe("what a person does about it", () => {
  it("notices only a fly in sight, looks at it after their reaction time, and forgets it out of sight", () => {
    const behind = people({ noticeHz: 20 });
    watch(behind, fromEyes(1, 180), 10);
    expect(behind.state.persons[ALICE.id]?.aware).toBe(false);
    expect(behind.state.counts.noticed).toBe(0);

    const front = people({ noticeHz: 20 });
    let noticedAt = -1;
    for (let k = 0; k < 40 && noticedAt < 0; k++) {
      front.observe(k * 0.05, { p: fromEyes(1, 20), flying: true }, [ALICE]);
      if (front.state.persons[ALICE.id]?.aware) noticedAt = k * 0.05;
    }
    expect(noticedAt).toBeGreaterThan(0);
    const st = front.state.persons[ALICE.id]!;
    expect(st.lookFrom - noticedAt).toBeCloseTo(P.reactionMs / 1000, 9);
    expect(front.pose(ALICE.id, noticedAt)).toBeNull();
    expect(front.pose(ALICE.id, st.lookFrom)?.look).toEqual(fromEyes(1, 20));
    // Behind her for longer than she remembers: forgotten.
    watch(front, fromEyes(1, 180), P.forgetS + 0.2, true, noticedAt + 0.05);
    expect(front.state.persons[ALICE.id]?.aware ?? false).toBe(false);
  });
  it("notices a still fly less readily than a flying one", () => {
    let flying = 0,
      still = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = people({}, seed),
        b = people({}, seed);
      watch(a, fromEyes(0.8, 0), 0.5, true);
      watch(b, fromEyes(0.8, 0), 0.5, false);
      if (a.state.counts.noticed) flying++;
      if (b.state.counts.noticed) still++;
    }
    expect(flying).toBeGreaterThan(still);
  });
  it("swats only at a fly within reach in front, after their reaction time, in a slap's time and no faster than a slap", () => {
    // Out of reach, or behind: never.
    const far = people({ noticeHz: 20, swatP: 1 });
    watch(far, fromEyes(1.5, 0), 3);
    expect(far.state.counts.swats).toBe(0);

    const near = people({ noticeHz: 20, swatP: 1 });
    // Within reach of her left shoulder, in front of her.
    const fly: V3 = [0.4, 1.45, -0.25];
    let decided = -1;
    for (let k = 0; k < 40 && decided < 0; k++) {
      near.observe(k * 0.05, { p: fly, flying: true }, [ALICE]);
      if (near.state.counts.swats) decided = k * 0.05;
    }
    expect(decided).toBeGreaterThan(0);
    const swat = near.state.swats[0]!;
    expect(swat.side).toBe(1);
    expect(swat.start - decided).toBeCloseTo(P.reactionMs / 1000, 9);
    expect(swat.duration).toBeGreaterThanOrEqual(P.swatS);
    const hand = (t: number) => {
      const out: Mover[] = [];
      near.hands(t, fly, 5, out);
      return out[0] ?? null;
    };
    // No hand before it starts; at its end it is where she saw the fly; then it goes back.
    expect(hand(swat.start - 0.01)).toBeNull();
    expect(hand(swat.start + swat.duration)!.center.map((v) => +v.toFixed(9))).toEqual(
      fly,
    );
    expect(hand(swat.start + swat.duration)).toMatchObject({
      kind: "hand",
      radius: P.handRadiusM,
    });
    let peak = 0;
    for (let t = swat.start; t < swat.start + 2 * swat.duration; t += 0.001) {
      const a = hand(t),
        b = hand(t + 0.001);
      if (a && b)
        peak = Math.max(
          peak,
          Math.hypot(...b.center.map((v, k) => v - a.center[k]!)) / 0.001,
        );
    }
    expect(peak).toBeLessThanOrEqual(P.swatPeakSpeedMS + 1e-6);
    expect(hand(swat.start + 2 * swat.duration + 0.01)).toBeNull();
    // Played out, it is counted (the fly held still where she aimed: reached), then dropped.
    watch(
      near,
      fly,
      swat.start + 2 * swat.duration - decided + 0.1,
      true,
      decided + 0.05,
    );
    expect(near.state.swats).toHaveLength(0);
    expect(near.state.counts.reached).toBe(1);
  });
  it("is the same people for the same seed and the same fly", () => {
    const run = (seed: number) => {
      const folk = people({}, seed);
      for (let k = 0; k < 200; k++)
        folk.observe(
          k * 0.05,
          { p: fromEyes(0.7, Math.sin(k / 10) * 40), flying: true },
          [ALICE],
        );
      return folk.stateHash();
    };
    expect(run(3)).toBe(run(3));
  });
  it("keeps published values fixed and model values in range, each sourced value with a DOI", () => {
    expect(() => resolvePeopleParams({ fieldOfViewDeg: 180 })).toThrow(/published value/);
    expect(() => resolvePeopleParams({ swatP: 2 })).toThrow(/must lie in/);
    expect(resolvePeopleParams({ swatP: 0 }).swatP).toBe(0);
    for (const p of Object.values(PEOPLE_PARAMS)) {
      if (p.kind === "published") expect(p.source?.doi).toMatch(/^10\./);
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
    }
  });
});

describe("a person and the fly together", () => {
  /** A room with Alice in it: the fly sees her body and, when she swats, her hand. */
  const meet = (config: PeopleConfig, seed: number) => {
    let folk: People | null = null;
    const world = new PrimitiveWorld({
      id: "room",
      home: { center: [0, 0, 0], radius: 5, ceiling: 3 },
      inputs: { supported: ["a person"], proxies: [], unsupported: [] },
      ground: () => 0,
      groundMax: 0,
      ambient: 1,
      movers: (near, radius, out, t) => {
        for (const [id, y, r] of [
          ["p1:legs", 0.45, 0.3],
          ["p1:torso", 1.3, 0.38],
        ] as const)
          if (Math.hypot(near[0], near[1] - y, near[2]) <= radius + r)
            out.push({ id, kind: "person", center: [0, y, 0], radius: r });
        folk?.hands(t, near, radius, out);
      },
    });
    folk = new People({
      seed,
      sight: (a, b) => {
        const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const len = Math.hypot(...d);
        const hit = world.raycast(a, [d[0] / len, d[1] / len, d[2] / len], len, true);
        return !hit || hit.t >= len - 0.01;
      },
      where: (id) => (id === ALICE.id ? ALICE : null),
      config: { noticeHz: 20, ...config },
    });
    // The fly hovering by her left shoulder.
    const fly = new DigitalFly({
      seed,
      world,
      start: { p: [0.4, 1.45, -0.25], yaw: Math.PI, mode: "flight", v: [0, 0, 0] },
    });
    const looms: string[] = [];
    for (let k = 0; k < 60; k++) {
      const s = fly.state;
      folk.observe(s.t, { p: s.p, flying: s.mode === "flight" || s.mode === "land" }, [
        ALICE,
      ]);
      fly.advance(0.05);
      const last = fly.log[fly.log.length - 1];
      if (last && /looming hand/.test(last.reason) && !looms.includes(last.reason))
        looms.push(last.reason);
    }
    return { fly, folk, looms };
  };
  it("turns away from a hand that swats at it, and from nothing when no one swats", () => {
    const swatted = meet({ swatP: 1 }, 2);
    expect(swatted.folk.state.counts.swats).toBeGreaterThan(0);
    expect(swatted.looms.length).toBeGreaterThan(0);
    expect(swatted.looms[0]).toMatch(/giant-fiber proxy/);
    expect(swatted.fly.state.counts.rejected).toBe(0);
    const left = meet({ swatP: 0 }, 2);
    expect(left.folk.state.counts.swats).toBe(0);
    expect(left.looms).toHaveLength(0);
  });
});
