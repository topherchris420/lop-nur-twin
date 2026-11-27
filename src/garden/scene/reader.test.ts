import * as THREE from "three";
import { describe, expect, it } from "vitest";
import pose from "./data/chrisw-reader.json";
import { readerGripPositions } from "./reader.js";

const data = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const original = new Int16Array(data(pose.position).buffer);
const faces = new Uint16Array(data(pose.index).buffer);

type Face = { ids: number[]; triangle: THREE.Triangle; bounds: THREE.Box3 };

function properCrossing(a: Face, b: Face): boolean {
  if (!a.bounds.intersectsBox(b.bounds) || a.ids.some((id) => b.ids.includes(id))) {
    return false;
  }
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const bary = new THREE.Vector3();
  const eps = 1e-5;
  for (const [first, second] of [
    [a.triangle, b.triangle],
    [b.triangle, a.triangle],
  ] as const) {
    for (const [p, q] of [
      [first.a, first.b],
      [first.b, first.c],
      [first.c, first.a],
    ] as const) {
      ray.origin.copy(p);
      ray.direction.subVectors(q, p);
      const length = ray.direction.length();
      if (length < eps) continue;
      ray.direction.multiplyScalar(1 / length);
      if (!ray.intersectTriangle(second.a, second.b, second.c, false, hit)) continue;
      const t = hit.distanceTo(p) / length;
      if (t <= eps || t >= 1 - eps) continue;
      if (second.getBarycoord(hit, bary) && Math.min(bary.x, bary.y, bary.z) > eps) {
        return true;
      }
    }
  }
  return false;
}

function cuffFaces(position: ArrayLike<number>, scale: number): Map<number, Face> {
  const result = new Map<number, Face>();
  const get = (id: number) =>
    new THREE.Vector3(
      position[id * 3]! * scale,
      position[id * 3 + 1]! * scale,
      position[id * 3 + 2]! * scale,
    );
  for (let f = 0; f < faces.length; f += 3) {
    const ids = Array.from(faces.subarray(f, f + 3));
    if (
      !ids.some((id) => {
        const i = id * 3;
        return (
          Math.abs(original[i]!) > 105 &&
          original[i + 1]! >= 270 &&
          original[i + 1]! <= 380 &&
          original[i + 2]! >= 265 &&
          original[i + 2]! <= 335
        );
      })
    )
      continue;
    const corners = ids.map(get);
    result.set(f, {
      ids,
      triangle: new THREE.Triangle(corners[0], corners[1], corners[2]),
      bounds: new THREE.Box3().setFromPoints(corners),
    });
  }
  return result;
}

describe("Christopher's book grip", () => {
  it("moves the hands and cuffs without moving the head or anything below the elbows", () => {
    const result = readerGripPositions(original);
    const moved = [0, 0];
    for (let i = 0; i < original.length; i += 3) {
      const x = original[i]! / 1000;
      const y = original[i + 1]! / 1000;
      const z = original[i + 2]! / 1000;
      const displacement = Math.hypot(
        result[i]! - x,
        result[i + 1]! - y,
        result[i + 2]! - z,
      );
      expect(Number.isFinite(displacement)).toBe(true);
      if (y <= 0.19 || y >= 0.62 || z <= 0.08) expect(displacement).toBeLessThan(1e-6);
      if (displacement > 0.01) moved[x < 0 ? 0 : 1]!++;
    }
    expect(moved.every((count) => count > 400)).toBe(true);
  });

  it("adds no crossings between nonadjacent faces around either cuff", () => {
    const before = cuffFaces(original, 0.001);
    const after = cuffFaces(readerGripPositions(original), 1);
    const entries = Array.from(after);
    const newCrossings: [number, number][] = [];
    for (let i = 0; i < entries.length; i++) {
      const [a, first] = entries[i]!;
      for (let j = i + 1; j < entries.length; j++) {
        const [b, second] = entries[j]!;
        if (
          properCrossing(first, second) &&
          !properCrossing(before.get(a)!, before.get(b)!)
        ) {
          newCrossings.push([a / 3, b / 3]);
        }
      }
    }
    expect(newCrossings).toEqual([]);
  });

  it("keeps both hands outside the bulk of the book panels", () => {
    const result = readerGripPositions(original);
    const xAxis = new THREE.Vector3(1, 0, 0);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const vertices = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ] as const;
    const triangle = new THREE.Triangle(...vertices);
    for (const side of [-1, 1]) {
      const panel = new THREE.Box3(
        new THREE.Vector3(side < 0 ? -0.189 : 0.001, -0.138, -0.02),
        new THREE.Vector3(side < 0 ? -0.001 : 0.189, 0.138, 0.004),
      );
      const count = (position: ArrayLike<number>, scale: number) => {
        let hits = 0;
        for (let f = 0; f < faces.length; f += 3) {
          for (const [corner, vertex] of vertices.entries()) {
            const i = faces[f + corner]! * 3;
            vertex
              .set(
                position[i]! * scale,
                position[i + 1]! * scale - 0.4,
                position[i + 2]! * scale - 0.379,
              )
              .applyAxisAngle(xAxis, -0.42)
              .applyAxisAngle(yAxis, side * 0.32);
          }
          if (panel.intersectsTriangle(triangle)) hits++;
        }
        return hits;
      };
      expect(count(original, 0.001)).toBeGreaterThan(0);
      expect(count(result, 1)).toBe(0);
    }
  });
});
