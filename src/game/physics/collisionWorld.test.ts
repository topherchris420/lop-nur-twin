import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LAYER } from "../core/types";
import { CollisionWorld, makeCollider } from "./collisionWorld";

const RADIUS = 0.34;
const HEIGHT = 1.8;
const HALF = new THREE.Vector3(0.4, 0.4, 0.4);

/** A crate whose near face cuts `overlap` metres into a capsule at `feet`. */
function crateInto(
  world: CollisionWorld,
  feet: THREE.Vector3,
  yaw: number,
  overlap: number,
): void {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  // The crate's local +x faces the capsule axis, so its near face is square on.
  const out = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const centre = feet
    .clone()
    .addScaledVector(out, RADIUS - overlap + HALF.x)
    .setY(feet.y + HALF.y);
  world.addStatic(makeCollider(centre, HALF, q, LAYER.prop, "wood"));
}

describe("CollisionWorld.isPositionFree", () => {
  it("reports a crate overlapping a standing capsule far from the origin as blocked", () => {
    let checked = 0;
    for (const overlap of [0.05, 0.1, 0.15, 0.2]) {
      for (let i = 0; i < 12; i += 1) {
        const yaw = (i / 12) * Math.PI * 2 + 0.17;
        const world = new CollisionWorld(() => 0);
        const feet = new THREE.Vector3(1000 + i * 0.37, 0, 1400 - i * 0.23);
        crateInto(world, feet, yaw, overlap);
        expect(
          world.isPositionFree(feet, RADIUS, HEIGHT),
          `overlap ${overlap} m at yaw ${yaw.toFixed(2)}`,
        ).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBe(48);
  });

  it("reports the same crate standing clear of the capsule as free", () => {
    for (let i = 0; i < 12; i += 1) {
      const world = new CollisionWorld(() => 0);
      const feet = new THREE.Vector3(1000, 0, 1400);
      crateInto(world, feet, (i / 12) * Math.PI * 2, -0.05);
      expect(world.isPositionFree(feet, RADIUS, HEIGHT)).toBe(true);
    }
  });

  it("does not move the position it is handed", () => {
    const world = new CollisionWorld(() => 0);
    const feet = new THREE.Vector3(1000, 0, 1400);
    crateInto(world, feet, 0.4, 0.1);
    world.isPositionFree(feet, RADIUS, HEIGHT);
    expect(feet.toArray()).toEqual([1000, 0, 1400]);
  });
});

describe("CollisionWorld.raycast", () => {
  it("skips every entity in the ignore set, and only those", () => {
    const world = new CollisionWorld(() => -100);
    const q = new THREE.Quaternion();
    const box = new THREE.Vector3(0.2, 0.2, 0.2);
    world.addDynamic(
      makeCollider(
        new THREE.Vector3(0, 1, -2),
        box,
        q,
        LAYER.character,
        "flesh",
        7,
        "chest",
      ),
    );
    world.addDynamic(
      makeCollider(
        new THREE.Vector3(0, 1, -4),
        box,
        q,
        LAYER.character,
        "flesh",
        8,
        "chest",
      ),
    );
    const origin = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    expect(world.raycast(origin, dir, 10, LAYER.character)?.entityId).toBe(7);
    expect(
      world.raycast(origin, dir, 10, LAYER.character, null, new Set([7]))?.entityId,
    ).toBe(8);
    expect(world.raycast(origin, dir, 10, LAYER.character, 8, new Set([7]))).toBeNull();
  });
});
