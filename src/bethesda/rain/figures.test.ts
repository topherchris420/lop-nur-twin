import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { B } from "../../game/characters/rig";
import { PERSPECTIVES, type Perspective } from "./contracts";
import {
  assembleFigure,
  buildFigure,
  figureGeometry,
  figurePieces,
  type FigureRig,
} from "./figures";
import {
  FigureAnimator,
  arrived,
  followRoute,
  seedFor,
  yawToward,
  type FigureCue,
  type RouteWalk,
} from "./figureMotion";
import { SEATS, STATIONS, clearWalk, routeInLab } from "./labLayout";

const cue = (over: Partial<FigureCue> = {}): FigureCue => ({
  x: 0,
  z: 0,
  ground: 0,
  face: null,
  look: null,
  glances: [],
  speaking: false,
  scan: false,
  ...over,
});
function hash(array: ArrayLike<number>) {
  let h = 0x811c9dc5;
  for (let i = 0; i < array.length; i++)
    h = Math.imul(h ^ Math.round(array[i]! * 1e5), 0x01000193);
  return h >>> 0;
}
const world = (rig: FigureRig, bone: number) => {
  rig.root.updateMatrixWorld(true);
  return rig.bones[bone]!.getWorldPosition(new THREE.Vector3());
};

describe("the four figures", () => {
  it.each(PERSPECTIVES)("%s is a valid skinned mesh within budget", (who) => {
    const rig = buildFigure(who, "lab");
    const g = rig.mesh.geometry;
    const weights = g.getAttribute("skinWeight"),
      index = g.getAttribute("skinIndex");
    for (let v = 0; v < weights.count; v++) {
      const sum = weights.getX(v) + weights.getY(v) + weights.getZ(v) + weights.getW(v);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
      for (const i of [index.getX(v), index.getY(v), index.getZ(v), index.getW(v)])
        expect(i).toBeLessThan(rig.bones.length);
    }
    // The documented budget (docs/RAIN_LAB_BETHESDA.md): 19–32k a figure.
    expect(rig.triangles).toBeLessThan(34000);
    // Solid parts and open sheets, two draw groups, one material each.
    expect(g.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(-0.005);
    if (rig.kind === "humanoid") {
      expect(box.max.y).toBeGreaterThan(1.75);
      expect(box.max.y).toBeLessThan(1.9);
    } else expect(box.max.y).toBeLessThan(1.65);
    rig.dispose();
  });

  it.each(PERSPECTIVES)(
    "%s's face is rigged: eyes, lids and mouth have their own vertices",
    (who) => {
      const { geometry, face } = figureGeometry(who);
      const index = geometry.getAttribute("skinIndex"),
        weights = geometry.getAttribute("skinWeight");
      const owned = new Set<number>();
      for (let v = 0; v < index.count; v++)
        if (weights.getX(v) > 0.99) owned.add(index.getX(v));
      for (const bone of [face.eyeL, face.eyeR, face.lidL, face.lidR, face.mouth])
        expect(owned.has(bone), `${who} bone ${bone}`).toBe(true);
    },
  );

  it("the same perspective is the same figure every time", () => {
    const a = hash(assembleFigure("Elena").getAttribute("position").array);
    expect(hash(assembleFigure("Elena").getAttribute("position").array)).toBe(a);
  });
});

describe("the walk", () => {
  /** Walk a figure straight ahead (-z) at `speed` and record each ankle. */
  function walk(who: Perspective, speed: number, seconds = 4) {
    const rig = buildFigure(who, "lab");
    const anim = new FigureAnimator(rig, seedFor(who));
    const dt = 1 / 60;
    const track: { left: THREE.Vector3; right: THREE.Vector3; rig: FigureRig }[] = [];
    let z = 0;
    const knees: number[] = [];
    for (let f = 0; f < seconds / dt; f++) {
      z -= speed * dt;
      anim.update(dt, cue({ z }), false);
      if (f < 60) continue; // up to speed
      const left = world(rig, B.footL),
        right = world(rig, B.footR);
      track.push({ left, right, rig });
      // The knee against the line from hip to ankle: positive is ahead (-z).
      const hip = world(rig, B.thighL),
        knee = world(rig, B.shinL);
      const t = (knee.y - hip.y) / (left.y - hip.y);
      const lineZ = hip.z + (left.z - hip.z) * t;
      knees.push(lineZ - knee.z);
    }
    rig.dispose();
    return { track, knees };
  }

  it.each([
    ["Luca", 1.35],
    ["Elena", 1.35],
    ["Jasmine", 3],
  ] as const)("%s at %s m/s: a planted foot does not slide", (who, speed) => {
    const { track } = walk(who, speed);
    for (const side of ["left", "right"] as const) {
      const ys = track.map((f) => f[side].y);
      const floor = Math.min(...ys);
      // Contiguous frames with the foot flat on the floor.
      let run: THREE.Vector3[] = [];
      let runs = 0;
      const check = () => {
        if (run.length >= 4) {
          runs++;
          const a = run[0]!,
            b = run[run.length - 1]!;
          expect(Math.hypot(a.x - b.x, a.z - b.z), `${who} ${side}`).toBeLessThan(0.02);
        }
        run = [];
      };
      for (const f of track) {
        if (f[side].y < floor + 0.003) run.push(f[side]);
        else check();
      }
      check();
      expect(runs).toBeGreaterThanOrEqual(2);
    }
  });

  it("knees bend forward, never back", () => {
    const { knees } = walk("Luca", 1.35);
    expect(Math.min(...knees)).toBeGreaterThan(-0.004);
    expect(Math.max(...knees)).toBeGreaterThan(0.02);
  });

  it("feet reach the floor and lift clear of it", () => {
    const { track } = walk("Luca", 1.35);
    const ys = track.map((f) => f.left.y);
    expect(Math.min(...ys)).toBeLessThan(0.1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.04);
  });

  it("James's arm tips stay near the floor at rest", () => {
    const rig = buildFigure("James", "lab");
    const anim = new FigureAnimator(rig, seedFor("James"));
    for (let f = 0; f < 240; f++) anim.update(1 / 60, cue(), false);
    for (const chain of rig.octopus!.arms)
      expect(world(rig, chain[chain.length - 1]!).y).toBeLessThan(0.25);
    rig.dispose();
  });
});

describe("the Godot client's behaviours", () => {
  it("blinks, on the client's timings, and the same way for the same seed", () => {
    const run = () => {
      const rig = buildFigure("Luca", "lab");
      const anim = new FigureAnimator(rig, seedFor("Luca"));
      const closed: number[] = [];
      for (let f = 0; f < 600; f++) {
        anim.update(1 / 60, cue(), false);
        if (rig.bones[rig.face.lidL]!.rotation.x < -0.9) closed.push(f);
      }
      rig.dispose();
      return closed;
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toEqual(first);
  });

  it("talks while its turn is shown, and closes its mouth when the turn passes", () => {
    const rig = buildFigure("Elena", "lab");
    const anim = new FigureAnimator(rig, seedFor("Elena"));
    let open = 0;
    for (let f = 0; f < 180; f++) {
      anim.update(1 / 60, cue({ speaking: true }), false);
      open = Math.max(open, rig.bones[rig.face.mouth]!.scale.y);
    }
    expect(open).toBeGreaterThan(1.8);
    for (let f = 0; f < 90; f++) anim.update(1 / 60, cue(), false);
    expect(rig.bones[rig.face.mouth]!.scale.y).toBeLessThan(1.02);
    rig.dispose();
  });

  it("a speaker gestures; a listener keeps its hands down", () => {
    const hands = (speaking: boolean) => {
      const rig = buildFigure("Luca", "lab");
      const anim = new FigureAnimator(rig, seedFor("Luca"));
      let high = -Infinity;
      for (let f = 0; f < 360; f++) {
        anim.update(1 / 60, cue({ speaking }), false);
        high = Math.max(high, world(rig, B.handL).y, world(rig, B.handR).y);
      }
      rig.dispose();
      return high;
    };
    expect(hands(true)).toBeGreaterThan(1.0);
    expect(hands(false)).toBeLessThan(0.95);
  });

  it("a listener's eyes go to the speaker before its head does", () => {
    const rig = buildFigure("Jasmine", "lab");
    const anim = new FigureAnimator(rig, seedFor("Jasmine"));
    const speaker = new THREE.Vector3(-3, 1.6, -3);
    anim.update(1 / 60, cue(), false);
    for (let f = 0; f < 6; f++) anim.update(1 / 60, cue({ look: speaker }), false);
    const eye = rig.bones[rig.face.eyeL]!.rotation.y;
    const head = rig.bones[B.head]!.rotation.y;
    // The speaker is to the figure's left (+yaw): the eyes are already there.
    expect(eye).toBeGreaterThan(0.2);
    expect(head).toBeLessThan(eye);
    rig.dispose();
  });

  it("under reduced motion nothing breathes, blinks, talks or walks", () => {
    const rig = buildFigure("Luca", "lab");
    const anim = new FigureAnimator(rig, seedFor("Luca"));
    const snapshot = () => rig.bones.map((b) => b.quaternion.toArray().join()).join("|");
    anim.update(1 / 60, cue({ speaking: true }), true);
    const first = snapshot();
    for (let f = 0; f < 300; f++) anim.update(1 / 60, cue({ speaking: true }), true);
    expect(snapshot()).toBe(first);
    expect(rig.bones[rig.face.mouth]!.scale.y).toBe(1);
    anim.update(1 / 60, cue({ z: -0.5, speaking: true }), true);
    expect(anim.speed).toBe(0);
    rig.dispose();
  });

  it("the animator reads no record, verdict, confidence or tone", () => {
    const code = readFileSync(new URL("./figureMotion.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/confidence|verdict|agree|grounding|tone|celebrat|nod\(/i);
    expect(code).not.toMatch(
      /from "\.\/(store|session|record|validation|contracts|client|demo)"/,
    );
  });
});

describe("routes through the lab", () => {
  it.each(PERSPECTIVES)(
    "%s walks from station to seat and back through doorways",
    (who) => {
      for (const [from, to] of [
        [STATIONS[who].at, SEATS[who]],
        [SEATS[who], STATIONS[who].at],
      ] as const) {
        const route = routeInLab(from, to);
        expect(route[0]).toEqual(from);
        expect(route[route.length - 1]).toEqual(to);
        for (let i = 1; i < route.length; i++)
          expect(clearWalk(route[i - 1]!, route[i]!), `${who} leg ${i}`).toBe(true);
        let length = 0;
        for (let i = 1; i < route.length; i++)
          length += Math.hypot(
            route[i]!.x - route[i - 1]!.x,
            route[i]!.z - route[i - 1]!.z,
          );
        expect(length).toBeLessThan(40);
        expect(routeInLab(from, to)).toEqual(route);
      }
    },
  );
});

/* ------------------------------------------------------------------ */
/* Regressions found in review                                         */
/* ------------------------------------------------------------------ */

/** Ankle positions while each foot is flat on the floor, run by run. */
function plantedRuns(track: THREE.Vector3[]) {
  const floor = Math.min(...track.map((p) => p.y));
  const runs: THREE.Vector3[][] = [];
  let run: THREE.Vector3[] = [];
  for (const p of track) {
    if (p.y < floor + 0.003) run.push(p);
    else {
      if (run.length >= 4) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 4) runs.push(run);
  return runs;
}
const drift = (run: THREE.Vector3[]) =>
  Math.max(...run.map((p) => Math.hypot(p.x - run[0]!.x, p.z - run[0]!.z)));

describe("walking the lab's routes", () => {
  it.each([1 / 60, 1 / 120, 1 / 144])(
    "every walk arrives, exactly, at %s s a frame",
    (dt) => {
      for (const who of PERSPECTIVES)
        for (const [from, to] of [
          [STATIONS[who].at, SEATS[who]],
          [SEATS[who], STATIONS[who].at],
        ] as const) {
          const walk: RouteWalk = {
            ...from,
            route: routeInLab(from, to).slice(1),
            leg: 0,
            speed: 0,
          };
          for (let f = 0; f < 60 / dt && !arrived(walk); f++) followRoute(walk, dt);
          expect(arrived(walk), `${who}`).toBe(true);
          expect(walk.x).toBe(to.x);
          expect(walk.z).toBe(to.z);
        }
    },
  );

  it.each(["Jasmine", "Luca", "Elena"] as const)(
    "%s's feet stay planted round the corners of the walk to the table and on turning to it",
    (who) => {
      const rig = buildFigure(who, "lab");
      const anim = new FigureAnimator(rig, seedFor(who));
      const from = STATIONS[who].at,
        to = SEATS[who];
      anim.place(from.x, from.z, STATIONS[who].facing);
      const walk: RouteWalk = {
        ...from,
        route: routeInLab(from, to).slice(1),
        leg: 0,
        speed: 0,
      };
      const left: THREE.Vector3[] = [],
        right: THREE.Vector3[] = [];
      for (let f = 0; f < 60 * 30; f++) {
        followRoute(walk, 1 / 60);
        // Once there, turn to the table, as the lab does.
        const face = arrived(walk) ? yawToward(-walk.x, 1 - walk.z) : null;
        anim.update(1 / 60, cue({ x: walk.x, z: walk.z, face }), false);
        left.push(world(rig, B.footL));
        right.push(world(rig, B.footR));
      }
      for (const track of [left, right])
        for (const run of plantedRuns(track)) expect(drift(run), who).toBeLessThan(0.03);
      rig.dispose();
    },
  );

  it("turning on the spot steps round rather than dragging a planted foot", () => {
    const rig = buildFigure("Luca", "lab");
    const anim = new FigureAnimator(rig, seedFor("Luca"));
    anim.place(0, 0, 0);
    const feet: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    for (let f = 0; f < 240; f++) {
      anim.update(1 / 60, cue({ face: f < 30 ? 0 : 2.0 }), false);
      feet[0].push(world(rig, B.footL));
      feet[1].push(world(rig, B.footR));
    }
    for (const track of feet)
      for (const run of plantedRuns(track)) expect(drift(run)).toBeLessThan(0.03);
    expect(anim.position.yaw).toBeCloseTo(2.0, 2);
    rig.dispose();
  });
});

describe("review fixes hold", () => {
  it("under reduced motion a turn moves no bone, and a moved figure faces where it went", () => {
    const rig = buildFigure("Elena", "lab");
    const anim = new FigureAnimator(rig, seedFor("Elena"));
    const bones = () =>
      rig.bones
        .map((b) => [...b.quaternion.toArray(), ...b.position.toArray()].join())
        .join("|");
    anim.update(1 / 60, cue({ face: 0 }), true);
    const still = bones();
    for (let f = 0; f < 30; f++) {
      anim.update(1 / 60, cue({ face: Math.PI / 2 }), true);
      expect(bones()).toBe(still);
    }
    // An outing under reduced motion: snapped along, facing the way it goes (east).
    anim.update(1 / 60, cue({ x: 0.3, face: null }), true);
    expect(anim.position.yaw).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("the lids follow the eyes down", () => {
    const rig = buildFigure("Elena", "lab");
    const anim = new FigureAnimator(rig, seedFor("Elena"));
    const low = new THREE.Vector3(0, 0.3, -1.2);
    let checked = 0;
    for (let f = 0; f < 120; f++) {
      anim.update(1 / 60, cue({ look: low }), false);
      const eye = rig.bones[rig.face.eyeL]!.rotation.x,
        lid = rig.bones[rig.face.lidL]!.rotation.x;
      if (f > 30 && eye < -0.1 && lid > -0.5) {
        expect(lid).toBeLessThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    rig.dispose();
  });

  it("a gesturing hand opens palm up", () => {
    const rig = buildFigure("Luca", "lab");
    const anim = new FigureAnimator(rig, seedFor("Luca"));
    const palm = new THREE.Vector3(),
      q = new THREE.Quaternion();
    let best = -Infinity;
    for (let f = 0; f < 600; f++) {
      anim.update(1 / 60, cue({ speaking: true }), false);
      rig.root.updateMatrixWorld(true);
      for (const [bone, side] of [
        [B.handL, -1],
        [B.handR, 1],
      ] as const) {
        if (world(rig, bone).y < 1.0) continue;
        // At rest the palm faces the thigh: -side along x.
        rig.bones[bone]!.getWorldQuaternion(q);
        palm.set(-side, 0, 0).applyQuaternion(q);
        best = Math.max(best, palm.y);
      }
    }
    expect(best).toBeGreaterThan(0.3);
    rig.dispose();
  });

  it("James crawls: the arms on the floor push back while the lifted ones reach", () => {
    const rig = buildFigure("James", "lab");
    const anim = new FigureAnimator(rig, seedFor("James"));
    const speed = 1;
    let z = 0,
      grounded = 0,
      sum = 0;
    // Each arm's floor contact: the bone of the chain that rests lowest, and
    // how high it rests (bones run along the arm, a few centimetres up).
    anim.update(1 / 60, cue(), false);
    const tips = rig.octopus!.arms.map((c) =>
      c.reduce((low, b) => (world(rig, b).y < world(rig, low).y ? b : low), c[0]!),
    );
    const restY = tips.map((t) => world(rig, t).y);
    let last = tips.map((t) => world(rig, t));
    for (let f = 0; f < 300; f++) {
      z -= speed / 60;
      anim.update(1 / 60, cue({ z }), false);
      const now = tips.map((t) => world(rig, t));
      if (f > 60)
        now.forEach((p, i) => {
          if (p.y < restY[i]! + 0.015) {
            // Along the walk only: an arm swung about its root also sweeps
            // sideways, which is sculling; skating is moving with the body.
            sum += Math.abs(p.z - last[i]!.z) * 60;
            grounded++;
          }
        });
      last = now;
    }
    expect(grounded).toBeGreaterThan(100);
    // Planted arms hold their place along the walk; a backwards crawl had them
    // skating ahead of the body at 1.6 m/s.
    expect(sum / grounded).toBeLessThan(speed * 0.25);
    rig.dispose();
  });

  it("James looks at what he attends to", () => {
    const rig = buildFigure("James", "lab");
    const anim = new FigureAnimator(rig, seedFor("James"));
    const target = new THREE.Vector3(-0.6, 1.62, -1.8);
    const fwd = new THREE.Vector3(),
      q = new THREE.Quaternion();
    for (let f = 0; f < 600; f++) {
      anim.update(1 / 60, cue({ look: target }), false);
      // Past the first glance, with the glance offsets that a listener sometimes takes ignored:
      // the check is that the eyes can land on a target, not that they always do.
    }
    let error = Infinity;
    for (let f = 0; f < 600; f++) {
      anim.update(1 / 60, cue({ look: target }), false);
      for (const eye of [rig.face.eyeL, rig.face.eyeR]) {
        const at = world(rig, eye);
        rig.bones[eye]!.getWorldQuaternion(q);
        fwd.set(0, 0, -1).applyQuaternion(q);
        const to = target.clone().sub(at).normalize();
        error = Math.min(error, Math.acos(Math.min(1, fwd.dot(to))));
      }
    }
    expect(error).toBeLessThan(0.06);
    rig.dispose();
  });

  it.each(PERSPECTIVES)("every closed piece of %s faces outward", (who) => {
    for (const { geometry } of figurePieces(who)) {
      const index = geometry.getIndex();
      if (!index) continue;
      // Closed by its own indices: every edge is shared by two triangles.
      const edges = new Map<string, number>();
      for (let i = 0; i < index.count; i += 3)
        for (const [a, b] of [
          [index.getX(i), index.getX(i + 1)],
          [index.getX(i + 1), index.getX(i + 2)],
          [index.getX(i + 2), index.getX(i)],
        ] as const) {
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      if ([...edges.values()].some((n) => n !== 2)) continue;
      const p = geometry.getAttribute("position");
      const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let volume = 0;
      for (let i = 0; i < index.count; i += 3) {
        for (let k = 0; k < 3; k++) v[k]!.fromBufferAttribute(p, index.getX(i + k));
        volume += v[0]!.dot(v[1]!.clone().cross(v[2]!)) / 6;
      }
      expect(volume, `${who}: a piece of ${p.count} vertices`).toBeGreaterThan(0);
    }
  });

  it("a fresh build is the same figure, and the built one is kept for the page", () => {
    const a = hash(assembleFigure("Jasmine").getAttribute("position").array);
    const b = hash(assembleFigure("Jasmine").getAttribute("position").array);
    expect(b).toBe(a);
    const first = buildFigure("Jasmine", "lab");
    const geometry = first.mesh.geometry;
    first.dispose();
    const second = buildFigure("Jasmine", "city");
    expect(second.mesh.geometry).toBe(geometry);
    expect(hash(geometry.getAttribute("position").array)).toBe(a);
    second.dispose();
  });
});
