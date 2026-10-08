import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { LAYER } from "../core/types";
import { createActor, game } from "../core/gameState";
import { CollisionWorld, makeCollider } from "../physics/collisionWorld";
import { getWeapon } from "./arsenal";
import { MELEE_REACH_M, WeaponRuntime } from "./runtime";

/** A chest box as `hitboxSpecs` sizes one: 0.36 m deep along the shot. */
const CHEST = new THREE.Vector3(0.24, 0.3, 0.18);

function body(world: CollisionWorld, id: number, z: number): void {
  world.addDynamic(
    makeCollider(
      new THREE.Vector3(0, 1.62, z),
      CHEST,
      new THREE.Quaternion(),
      LAYER.character,
      "flesh",
      id,
      "chest",
    ),
  );
}

function shoot(runtime: WeaponRuntime, world: CollisionWorld): void {
  const shooter = createActor(1, "shooter", "blue");
  runtime.ads = 1;
  runtime.fire({
    shooter,
    world,
    time: 1,
    direction: new THREE.Vector3(0, 0, -1),
    origin: new THREE.Vector3(0, 1.62, 0),
    accuracy: 1,
  });
}

beforeEach(() => {
  game.damageQueue.length = 0;
});
afterEach(() => {
  game.damageQueue.length = 0;
});

describe("traceBullet", () => {
  it("hits a body once per round, not again from inside its own chest box", () => {
    const world = new CollisionWorld(() => -100);
    body(world, 7, -5);
    shoot(new WeaponRuntime(getWeapon("m4a1")), world);
    const hits = game.damageQueue.filter((e) => e.targetId === 7);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.penetrated).toBe(false);
  });

  it("still carries through one body into a second one behind it", () => {
    const world = new CollisionWorld(() => -100);
    body(world, 7, -5);
    body(world, 8, -6);
    shoot(new WeaponRuntime(getWeapon("m4a1")), world);
    expect(game.damageQueue.map((e) => [e.targetId, e.penetrated])).toEqual([
      [7, false],
      [8, true],
    ]);
  });
});

describe("melee", () => {
  function swing(target: number): WeaponRuntime {
    const world = new CollisionWorld(() => -100);
    body(world, 7, -target);
    const knife = new WeaponRuntime(getWeapon("trench-knife"));
    knife.update(0.016, { wantsFire: true, wantsAds: false, canFire: true });
    expect(knife.wantsShot(true)).toBe(true);
    shoot(knife, world);
    return knife;
  }

  it("attacks with an empty magazine and spends nothing", () => {
    const knife = swing(1.2);
    expect(knife.def.magSize).toBe(0);
    expect(knife.ammo).toBe(0);
    expect(knife.readyToFire).toBe(false); // cycling after the swing
    expect(game.damageQueue).toHaveLength(1);
    const hit = game.damageQueue[0]!;
    expect(hit.kind).toBe("melee");
    expect(hit.targetId).toBe(7);
    expect(hit.amount).toBeGreaterThanOrEqual(100);
  });

  it("reaches no further than its reach", () => {
    swing(MELEE_REACH_M + 0.6);
    expect(game.damageQueue).toHaveLength(0);
  });

  it("is ready again once the swing has cycled, still without ammunition", () => {
    const knife = new WeaponRuntime(getWeapon("trench-knife"));
    expect(knife.readyToFire).toBe(true);
  });
});

describe("refill", () => {
  it("restores a fresh weapon", () => {
    const rifle = new WeaponRuntime(getWeapon("m4a1"));
    const world = new CollisionWorld(() => -100);
    shoot(rifle, world);
    rifle.ammo = 0;
    rifle.reserve = 0;
    rifle.refill();
    expect(rifle.ammo).toBe(rifle.def.magSize);
    expect(rifle.reserve).toBe(rifle.def.startingReserve);
    expect(rifle.readyToFire).toBe(true);
    expect(rifle.barrelHeat).toBe(0);
  });
});
