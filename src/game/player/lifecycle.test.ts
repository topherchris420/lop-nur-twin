import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LAYER } from "../core/types";
import { createActor, createInputState } from "../core/gameState";
import { respawnActor } from "../core/combat";
import { CollisionWorld, makeCollider } from "../physics/collisionWorld";
import { getWeapon } from "../weapons/arsenal";
import { WeaponRuntime } from "../weapons/runtime";
import { PlayerController } from "./controller";
import { startNewLife } from "./lifecycle";

/** Flat ground with a 1 m ledge 0.6 m in front of the origin, facing -z. */
function ledgeWorld(): CollisionWorld {
  const world = new CollisionWorld(() => 0);
  world.addStatic(
    makeCollider(
      new THREE.Vector3(0, 0.5, -1.6),
      new THREE.Vector3(2, 0.5, 1),
      new THREE.Quaternion(),
      LAYER.prop,
      "concrete",
    ),
  );
  return world;
}

describe("startNewLife", () => {
  it("stops a mantle that was running when the player died", () => {
    const world = ledgeWorld();
    const controller = new PlayerController();
    const player = createActor(0, "You", "blue", true);
    const jump = createInputState();
    jump.jumpPressed = true;
    controller.update(player, jump, world, 0.016, 0);
    expect(controller.isMantling).toBe(true);

    // Killed mid-vault, put back in 200 m away.
    const spawn = new THREE.Vector3(200, 0, 200);
    respawnActor(player, spawn, 0);
    startNewLife([], controller);
    expect(controller.isMantling).toBe(false);

    const idle = createInputState();
    for (let i = 0; i < 30; i += 1) controller.update(player, idle, world, 0.016, 0);
    expect(player.position.distanceTo(spawn)).toBeLessThan(0.01);
  });

  it("drops a held crouch so the respawn stands", () => {
    const world = new CollisionWorld(() => 0);
    const controller = new PlayerController();
    const player = createActor(0, "You", "blue", true);
    const crouch = createInputState();
    crouch.crouchPressed = true;
    controller.update(player, crouch, world, 0.016, 0);
    const idle = createInputState();
    for (let i = 0; i < 30; i += 1) controller.update(player, idle, world, 0.016, 0);
    expect(player.stance).toBe("crouch");

    respawnActor(player, new THREE.Vector3(10, 0, 10), 0);
    startNewLife([], controller);
    controller.update(player, idle, world, 0.016, 0);
    expect(player.stance).toBe("stand");
    expect(controller.eyeHeight()).toBeCloseTo(1.62, 2);
  });

  it("refills every weapon the seat carries", () => {
    const primary = new WeaponRuntime(getWeapon("m4a1"));
    const secondary = new WeaponRuntime(getWeapon("trench-knife"));
    primary.ammo = 0;
    primary.reserve = 3;
    startNewLife([primary, secondary], new PlayerController());
    expect(primary.ammo).toBe(primary.def.magSize);
    expect(primary.reserve).toBe(primary.def.startingReserve);
    expect(secondary.readyToFire).toBe(true);
  });
});
