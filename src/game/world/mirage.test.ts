import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MIRAGE, mirageAmplitude, mirageOffset, mirageState } from "./mirage";

const eye = new THREE.Vector3(0, 1.6, 0);
const at = (z: number) => new THREE.Vector3(0, 0, -z);

describe("heat shimmer", () => {
  it("leaves anything inside the onset range exactly where it is", () => {
    const out = new THREE.Vector3(9, 9, 9);
    for (let t = 0; t < 5; t += 0.37) {
      mirageOffset(eye, at(MIRAGE.onsetM - 1), 7, t, out);
      expect(out.length()).toBe(0);
    }
  });

  it("grows with range", () => {
    expect(mirageAmplitude(60)).toBeGreaterThan(0.02);
    expect(mirageAmplitude(60)).toBeLessThan(0.08);
    expect(mirageAmplitude(100)).toBeGreaterThan(0.15);
    expect(mirageAmplitude(100)).toBeLessThan(0.3);
    expect(mirageAmplitude(150)).toBeGreaterThan(mirageAmplitude(100) * 1.8);
  });

  it("displaces across the line of sight, never along it", () => {
    const out = new THREE.Vector3();
    for (let t = 0; t < 10; t += 0.5) {
      mirageOffset(eye, at(120), 3, t, out);
      // The line of sight is along -z here: no component along it.
      expect(Math.abs(out.z)).toBeLessThan(1e-9);
      // Vertical and sideways combine: the peak is A·√(1 + lateral²).
      expect(out.length()).toBeLessThanOrEqual(
        mirageAmplitude(120.02) * Math.hypot(1, MIRAGE.lateral) * 1.001,
      );
    }
  });

  it("is a smooth, deterministic function of time and body", () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    mirageOffset(eye, at(110), 5, 12.3, a);
    mirageOffset(eye, at(110), 5, 12.3, b);
    expect(a.equals(b)).toBe(true);
    // Different bodies waver differently.
    mirageOffset(eye, at(110), 6, 12.3, b);
    expect(a.equals(b)).toBe(false);
    // One simulation step moves it by a small fraction of its amplitude.
    mirageOffset(eye, at(110), 5, 12.3 + 1 / 60, b);
    expect(a.distanceTo(b)).toBeLessThan(mirageAmplitude(110) * 0.15);
  });

  it("is gone at night", () => {
    const out = new THREE.Vector3();
    mirageState.strength = 0;
    try {
      mirageOffset(eye, at(150), 5, 3, out);
      expect(out.length()).toBe(0);
    } finally {
      mirageState.strength = 1;
    }
  });
});
