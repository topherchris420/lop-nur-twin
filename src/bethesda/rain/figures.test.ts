import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { B } from "../../game/characters/rig";
import { PERSPECTIVES, type Perspective } from "./contracts";
import { buildFigure, figureGeometry, type FigureRig } from "./figures";
import { FigureAnimator, seedFor, type FigureCue } from "./figureMotion";
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
    expect(rig.triangles).toBeLessThan(40000);
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
    const first = buildFigure("Elena", "lab");
    const a = hash(first.mesh.geometry.getAttribute("position").array);
    first.dispose();
    const second = buildFigure("Elena", "city");
    expect(hash(second.mesh.geometry.getAttribute("position").array)).toBe(a);
    second.dispose();
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
