import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { viewmodelDirToWorld, viewmodelToWorld } from "./viewmodelSpace";

function cameras(): { stage: THREE.PerspectiveCamera; world: THREE.PerspectiveCamera } {
  // The weapon's lens is narrower than the world's, and the world camera is
  // somewhere on the map, turned and pitched.
  const stage = new THREE.PerspectiveCamera(62, 16 / 9, 0.01, 8);
  const world = new THREE.PerspectiveCamera(56, 16 / 9, 0.12, 26000);
  world.position.set(1290, 3.1, 1350);
  world.rotation.order = "YXZ";
  world.rotation.set(-0.12, 2.3, 0.02);
  stage.updateMatrixWorld(true);
  world.updateMatrixWorld(true);
  return { stage, world };
}

describe("viewmodelToWorld", () => {
  it("puts a weapon socket on the same pixel, at the same depth, in the world", () => {
    const { stage, world } = cameras();
    const muzzle = new THREE.Vector3(0.11, -0.13, -0.72);
    const out = viewmodelToWorld(muzzle, stage, world, new THREE.Vector3());

    const stageNdc = muzzle.clone().project(stage);
    const worldNdc = out.clone().project(world);
    expect(worldNdc.x).toBeCloseTo(stageNdc.x, 5);
    expect(worldNdc.y).toBeCloseTo(stageNdc.y, 5);

    // Near the player, not near the world origin.
    expect(out.distanceTo(world.position)).toBeLessThan(1);
    const depth = out.clone().applyMatrix4(world.matrixWorldInverse).z;
    expect(depth).toBeCloseTo(muzzle.z, 5);
  });

  it("turns a stage direction with the world camera", () => {
    const { stage, world } = cameras();
    const forward = viewmodelDirToWorld(
      new THREE.Vector3(0, 0, -1),
      stage,
      world,
      new THREE.Vector3(),
    );
    const cameraForward = world.getWorldDirection(new THREE.Vector3());
    expect(forward.distanceTo(cameraForward)).toBeLessThan(1e-6);
  });
});
