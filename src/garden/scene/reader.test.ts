import * as THREE from "three";
import { describe, expect, it } from "vitest";
import pose from "./data/chrisw-reader.json";
import { readerGripPositions } from "./reader.js";

const data = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const original = new Int16Array(data(pose.position).buffer);
const faces = new Uint16Array(data(pose.index).buffer);

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
      if (y < 0.25 || y > 0.52 || z < 0.275) expect(displacement).toBeLessThan(1e-6);
      if (displacement > 0.01) moved[x < 0 ? 0 : 1]!++;
    }
    expect(moved.every((count) => count > 400)).toBe(true);
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
