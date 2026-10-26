import { describe, expect, it } from "vitest";
import { observations, raw, SEQUENCES, type Raw } from "./fixtures/index.js";
import { standingHeight } from "./layout.js";
import { parseObservation, type Observation } from "./observation.js";
import {
  anchorOf,
  perform,
  placeOf,
  prefersWalking,
  type FlyPose,
} from "./performance.js";
import { perchPoint } from "./stage.js";
import { Timeline } from "./timeline.js";
import { distance, dot, length } from "./vec.js";

const timelineOf = (states: Observation[]) => {
  const tl = new Timeline();
  for (const s of states) tl.push(s);
  return tl;
};
const poseAt = (tl: Timeline, t: number) => perform(tl.at(t)!, t);
const angle = (a: FlyPose, b: FlyPose) =>
  Math.acos(Math.min(1, Math.max(-1, dot(a.forward, b.forward))));

/** Every presented instant across a sequence, sixty to the second. */
function sweep(states: Observation[], fps = 60) {
  const tl = timelineOf(states);
  const out: { t: number; pose: FlyPose }[] = [];
  const t0 = states[0]!.updatedAt,
    t1 = states.at(-1)!.updatedAt;
  for (let t = t0; t <= t1; t += 1 / fps) out.push({ t, pose: poseAt(tl, t) });
  return out;
}

describe("the director", () => {
  it("gives every visitor the same performance", () => {
    const states = observations("stone-to-flowers");
    const a = timelineOf(states),
      b = timelineOf(observations("stone-to-flowers"));
    for (let t = states[0]!.updatedAt; t < states.at(-1)!.updatedAt; t += 0.37)
      expect(poseAt(a, t)).toEqual(poseAt(b, t));
  });

  it("never jumps: the fly moves continuously through every recorded sequence", () => {
    for (const name of Object.keys(SEQUENCES) as (keyof typeof SEQUENCES)[]) {
      const frames = sweep(observations(name));
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1]!.pose,
          b = frames[i]!.pose;
        // At sixty frames a second nothing in the garden moves more than a few millimetres.
        expect(
          distance(a.position, b.position),
          `${name} at ${frames[i]!.t}`,
        ).toBeLessThan(0.012);
        expect(angle(a, b), `${name} heading at ${frames[i]!.t}`).toBeLessThan(0.5);
      }
    }
  });

  it("performs a recorded journey: rest, take off, fly, land, feed", () => {
    const frames = sweep(observations("stone-to-flowers"), 20);
    const seen = new Set(frames.map((f) => f.pose.behaviour));
    for (const b of ["resting", "taking off", "flying", "landing", "feeding"] as const)
      expect(seen, b).toContain(b);
    const order = frames
      .map((f) => f.pose.behaviour)
      .filter((b, i, all) => b !== all[i - 1]);
    expect(order.indexOf("taking off")).toBeLessThan(order.indexOf("flying"));
    expect(order.indexOf("flying")).toBeLessThan(order.indexOf("landing"));
    expect(order.lastIndexOf("landing")).toBeLessThan(order.lastIndexOf("feeding"));
    // It ends on the aster, where the server put it.
    const last = observations("stone-to-flowers").at(-1)!;
    const end = frames.at(-1)!.pose;
    expect(
      distance(end.position, perchPoint("flowers", last.position).position),
    ).toBeLessThan(0.01);
    expect(end.place).toBe("flowers");
  });

  it("stays in the air and above whatever is below while flying", () => {
    for (const f of sweep(observations("fence-to-stone"), 20)) {
      if (f.pose.behaviour !== "flying") continue;
      expect(f.pose.beating).toBe(true);
      expect(f.pose.position[1]).toBeGreaterThanOrEqual(
        standingHeight(f.pose.position[0], f.pose.position[2]) - 1e-6,
      );
    }
  });

  it("gets closer to the destination as the server's progress grows", () => {
    const states = observations("fence-to-stone");
    const tl = timelineOf(states);
    const dest = perchPoint("stone", states.at(-2)!.position).position;
    const flying = states.filter((s) => s.travel && s.learning?.last?.action === "fly");
    const d = flying.map((s) => distance(poseAt(tl, s.updatedAt).position, dest));
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeLessThan(d[i - 1]!);
  });

  it("draws a perched calibration step as a few millimetres of walking", () => {
    const states = observations("fence-to-stone");
    const step = states.findIndex(
      (s, i) => i > 0 && !s.travel && s.learning?.last?.action === "walk",
    );
    expect(step).toBeGreaterThan(0);
    const tl = timelineOf(states);
    const a = states[step - 1]!,
      b = states[step]!;
    const modes = new Set<string>();
    for (let t = a.updatedAt; t < b.updatedAt; t += 0.05) modes.add(poseAt(tl, t).mode);
    expect(modes).toContain("walk");
    const moved = distance(
      poseAt(tl, a.updatedAt + 0.001).position,
      poseAt(tl, b.updatedAt).position,
    );
    expect(moved).toBeGreaterThan(0.001);
    expect(moved).toBeLessThan(0.01);
  });

  it("holds and hovers when the next state is late, without leaving the route", () => {
    const states = observations("fence-to-stone");
    const inFlight = states.findIndex(
      (s) => s.travel && s.learning?.last?.action === "fly",
    );
    const tl = timelineOf(states.slice(0, inFlight + 2));
    const last = tl.latest()!;
    const anchor = anchorOf(last).point.position;
    for (let late = 0; late < 4; late += 0.25) {
      const p = poseAt(tl, last.updatedAt + late);
      expect(p.behaviour).toBe("flying");
      expect(distance(p.position, anchor)).toBeLessThan(0.01);
    }
  });

  it("keeps a sleeping or feeding fly's details within FlyBody's joints", () => {
    for (const f of sweep(observations("drinking"), 10)) {
      const p = f.pose;
      expect(p.proboscis).toBeGreaterThanOrEqual(0);
      expect(p.proboscis).toBeLessThanOrEqual(1);
      expect(Math.abs(p.antenna)).toBeLessThanOrEqual(1);
      expect(length(p.up)).toBeCloseTo(1, 6);
      expect(Math.abs(dot(p.up, p.forward))).toBeLessThan(1e-6);
    }
  });
});

/** A recorded state changed into a situation the recording does not contain. */
function variant(r: Raw, change: (r: Raw) => void) {
  const v = raw(r);
  change(v);
  return parseObservation(v);
}

describe("situations derived from the recording", () => {
  const flight = SEQUENCES["fence-to-stone"];
  const departure = flight.findIndex(
    (r) => r.travel && (r.learning as { last: { action: string } }).last.action !== "fly",
  );

  it("walks the journey on surfaces when the fly's own estimates favour walking", () => {
    const walk = (r: Raw) => {
      const l = r.learning as Record<string, Record<string, Record<string, number>>>;
      l.capabilities!.fly!.estimated_speed = 0.0025;
      l.capabilities!.walk!.estimated_speed = 0.0035;
      if ((l.last as unknown as { action: string }).action === "fly")
        (l.last as unknown as { action: string }).action = "walk";
    };
    const states = flight.slice(departure, departure + 5).map((r) => variant(r, walk));
    expect(prefersWalking(states[1]!)).toBe(true);
    const frames = sweep(states, 20).slice(5 * 20 + 1);
    for (const f of frames) {
      expect(f.pose.behaviour).toBe("walking");
      expect(f.pose.altitude).toBeLessThan(1e-6);
      expect(f.pose.mode).toBe("walk");
    }
  });

  it("buzzes its wings on the spot when a flight attempt does not move it", () => {
    const states = [flight[departure - 1]!, flight[departure]!].map((r) =>
      variant(r, () => {}),
    );
    // The server tried to fly and the position did not change (wet or worn wings, say).
    states.push(
      variant(flight[departure]!, (r) => {
        r.ticks += 1;
        r.updated_at += 5;
        r.server_time = (r.server_time as number) + 5;
        (r.learning as { last: { action: string } }).last.action = "fly";
      }),
    );
    const tl = timelineOf(states);
    const t = states[1]!.updatedAt + 2.5;
    const p = poseAt(tl, t);
    expect(p.behaviour).toBe("trying its wings");
    expect(p.beating).toBe(true);
    expect(distance(p.position, anchorOf(states[1]!).point.position)).toBeLessThan(1e-9);
  });

  it("puts a place it does not know at the nearest place it does", () => {
    const o = variant(flight[0]!, (r) => {
      r.place = "greenhouse";
    });
    expect(o.place).toBeNull();
    expect(placeOf(o)).toBe("fence");
  });
});
