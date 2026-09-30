import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { clearInputEdges, createActor, createInputState } from "../core/gameState";
import { LAYER, MASK_MOVEMENT } from "../core/types";
import { CollisionWorld, makeCollider } from "../physics/collisionWorld";
import { PlayerController } from "../player/controller";
import { PlaceNavigator, type NavigatorRelease, type NavSense } from "./navigator";
import { canWalkTo, findPlaces, MAX_PLACE_ROUTE_M } from "./places";

const DT = 1 / 60;

function rig(world: CollisionWorld) {
  const actor = createActor(0, "pilot", "blue", true);
  const controller = new PlayerController();
  const input = createInputState();
  const navigator = new PlaceNavigator();
  const releases: NavigatorRelease[] = [];
  navigator.events = { onRelease: (reason) => releases.push(reason) };
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sense: NavSense = {
    now: 0,
    x: 0,
    z: 0,
    yaw: 0,
    probe: (dx, dz, range) => {
      from.set(actor.position.x, actor.position.y + 0.9, actor.position.z);
      dir.set(dx, 0, dz);
      return world.raycast(from, dir, range, MASK_MOVEMENT, actor.id)?.distance ?? null;
    },
  };
  /** One simulation step: navigator writes the input, the controller moves the body. */
  const step = (t: number, confirm = true): void => {
    if (confirm) navigator.confirm(t);
    sense.now = t;
    sense.x = actor.position.x;
    sense.z = actor.position.z;
    sense.yaw = actor.yaw;
    input.moveX = 0;
    input.moveY = 0;
    input.sprint = false;
    navigator.apply(input, sense, false);
    controller.update(actor, input, world, DT, 0);
    clearInputEdges(input);
  };
  return { actor, input, navigator, releases, step };
}

function wall(world: CollisionWorld, x: number, z: number, hx: number, hz: number): void {
  world.addStatic(
    makeCollider(
      new THREE.Vector3(x, 1.5, z),
      new THREE.Vector3(hx, 1.5, hz),
      new THREE.Quaternion(),
      LAYER.world,
      "concrete",
    ),
  );
}

describe("the place navigator", () => {
  it("walks the body to the place through the player controller, and stops", () => {
    const world = new CollisionWorld(() => 0);
    const { actor, navigator, releases, step } = rig(world);
    navigator.go({ x: 12, z: -9, kind: "cover" }, 0, { x: 0, z: 0 });
    for (let i = 0; i < 600 && navigator.active; i += 1) step(i * DT);
    expect(releases).toEqual(["arrived"]);
    expect(Math.hypot(actor.position.x - 12, actor.position.z + 9)).toBeLessThan(1.3);
  });

  it("moves relative to the body's facing without ever turning it", () => {
    const world = new CollisionWorld(() => 0);
    const { actor, input, navigator, step } = rig(world);
    // Facing north, going east: a pure strafe right.
    actor.yaw = 0;
    navigator.go({ x: 10, z: 0, kind: "flank" }, 0, { x: 0, z: 0 });
    step(0);
    expect(input.lookYaw).toBe(0);
    for (let i = 1; i < 30; i += 1) step(i * DT);
    expect(actor.yaw).toBe(0);
    expect(actor.position.x).toBeGreaterThan(0.5);
    expect(Math.abs(actor.position.z)).toBeLessThan(0.05);
  });

  it("runs toward a distant place ahead, and walks while the weapon fires", () => {
    const world = new CollisionWorld(() => 0);
    const { actor, input, navigator } = rig(world);
    navigator.go({ x: 0, z: -30, kind: "advance" }, 0, { x: 0, z: 0 });
    const sense: NavSense = { now: 0, x: 0, z: 0, yaw: actor.yaw, probe: () => null };
    navigator.apply(input, sense, false);
    expect(input.sprint).toBe(true);
    navigator.apply(input, sense, true);
    expect(input.sprint).toBe(false);
    expect(input.moveY).toBe(1);
  });

  it("lets go when nothing re-confirms the destination", () => {
    const world = new CollisionWorld(() => 0);
    const { navigator, releases, step } = rig(world);
    navigator.go({ x: 0, z: -100, kind: "objective" }, 0, { x: 0, z: 0 });
    for (let i = 0; i < 120; i += 1) step(i * DT, false);
    expect(releases).toEqual(["timeout"]);
  });

  it("lets go when the body stops making progress", () => {
    const world = new CollisionWorld(() => 0);
    // A wall straight across the route, wider than the feelers can bend round.
    wall(world, 0, -4, 30, 0.5);
    const { navigator, releases, step } = rig(world);
    navigator.go({ x: 0, z: -12, kind: "advance" }, 0, { x: 0, z: 0 });
    for (let i = 0; i < 400 && navigator.active; i += 1) step(i * DT);
    expect(releases).toEqual(["blocked"]);
  });

  it("does nothing at all without a destination", () => {
    const { input, navigator } = rig(new CollisionWorld(() => 0));
    input.moveX = 0.3;
    input.moveY = -1;
    input.sprint = true;
    navigator.apply(input, { now: 0, x: 0, z: 0, yaw: 0, probe: () => null }, false);
    expect([input.moveX, input.moveY, input.sprint]).toEqual([0.3, -1, true]);
  });

  it("releases movement immediately when all feelers meet geometry", () => {
    const { input, navigator } = rig(new CollisionWorld(() => 0));
    navigator.go({ x: 0, z: -30, kind: "cover" }, 0, { x: 0, z: 0 });
    input.moveY = 1;
    input.sprint = true;
    navigator.apply(input, { now: 0, x: 0, z: 0, yaw: 0, probe: () => 0.2 }, false);
    expect([input.moveX, input.moveY, input.sprint]).toEqual([0, 0, false]);
    expect(navigator.active).toBe(true);
    navigator.apply(input, { now: 2, x: 0, z: 0, yaw: 0, probe: () => 0.2 }, false);
    expect(navigator.active).toBe(false);
  });
});

describe("body-width route queries", () => {
  const from = { x: 0, y: 0, z: 0, id: null };

  it("rejects a corridor the center ray fits through but the body does not", () => {
    const world = new CollisionWorld(() => 0);
    wall(world, 0.36, -4.5, 0.1, 0.2);
    const destination = { x: 0, z: -10 };
    expect(
      world.raycast(
        new THREE.Vector3(0, 0.9, 0),
        new THREE.Vector3(0, 0, -1),
        10,
        MASK_MOVEMENT,
        null,
      ),
    ).toBeNull();
    expect(canWalkTo(world, from, destination)).toBe(false);
    expect(findPlaces(world, from, 0, [], destination)).toEqual([]);
  });

  it("rejects objectives through walls and inside geometry", () => {
    const world = new CollisionWorld(() => 0);
    wall(world, 0, -5, 5, 0.25);
    expect(findPlaces(world, from, 0, [], { x: 0, z: -10 })).toEqual([]);
    expect(findPlaces(world, from, 0, [], { x: 0, z: -5 })).toEqual([]);
  });

  it("rejects a low ceiling that has room for a crouched but not standing body", () => {
    const world = new CollisionWorld(() => 0);
    world.addStatic(
      makeCollider(
        new THREE.Vector3(0, 1.55, -5),
        new THREE.Vector3(3, 0.1, 3),
        new THREE.Quaternion(),
        LAYER.world,
        "concrete",
      ),
    );
    expect(canWalkTo(world, from, { x: 0, z: -10 })).toBe(false);
  });

  it("rejects steep terrain and bounds the geometry query", () => {
    expect(canWalkTo(new CollisionWorld((x) => x * 3), from, { x: 10, z: 0 })).toBe(
      false,
    );
    const world = new CollisionWorld(() => 0);
    expect(canWalkTo(world, from, { x: MAX_PLACE_ROUTE_M + 1, z: 0 })).toBe(false);
    expect(canWalkTo(world, from, { x: NaN, z: 0 })).toBe(false);
    expect(canWalkTo(world, from, { x: 10, z: 0 })).toBe(true);
  });

  it("reports standing-eye concealment rather than claiming low cover hides a standing eye", () => {
    const world = new CollisionWorld(() => 0);
    world.addStatic(
      makeCollider(
        new THREE.Vector3(5, 0.6, 0),
        new THREE.Vector3(0.2, 0.6, 6),
        new THREE.Quaternion(),
        LAYER.world,
        "concrete",
      ),
    );
    const places = findPlaces(
      world,
      { x: 9, y: 0, z: 0, id: null },
      0,
      [{ x: -30, y: 0, z: 0 }],
      null,
    );
    expect(places).toEqual([]);
  });
});

describe("the places finder", () => {
  it("offers hidden places behind geometry, from the known threat only", () => {
    const world = new CollisionWorld(() => 0);
    // A wall 8 m east of the origin, 12 m long north-south; the threat stands
    // 60 m west. The player is 14 m south of the wall's centre line, so the
    // lee of the wall is reachable by a straight walk past its end.
    wall(world, 8, 0, 0.5, 6);
    const places = findPlaces(
      world,
      { x: 0, y: 0, z: 14, id: null },
      0,
      [{ x: -60, y: 0, z: 0 }],
      null,
    );
    const cover = places.find((p) => p.kind === "cover");
    expect(cover).toBeDefined();
    expect(cover!.hidden).toBe(true);
    // In the lee of the wall: east of it, within its length.
    expect(cover!.x).toBeGreaterThan(8.5);
    expect(Math.abs(cover!.z)).toBeLessThan(6);
    for (const place of places) expect(place.hidden).toBe(true);
    // The finder offers straight walks only: nothing behind the wall from a
    // spot that would have to walk through it.
    const blocked = findPlaces(
      world,
      { x: 0, y: 0, z: 0, id: null },
      0,
      [{ x: -60, y: 0, z: 0 }],
      null,
    );
    for (const place of blocked)
      expect(place.x < 7.5 || Math.abs(place.z) > 6).toBe(true);
  });

  it("lists nothing to hide from when no threat is known", () => {
    const world = new CollisionWorld(() => 0);
    wall(world, 8, 0, 0.5, 6);
    expect(findPlaces(world, { x: 0, y: 0, z: 0, id: null }, 0, [], null)).toEqual([]);
    const withObjective = findPlaces(world, { x: 0, y: 0, z: 0, id: null }, 0, [], {
      x: 0,
      z: -50,
    });
    expect(withObjective.map((p) => p.kind)).toEqual(["objective"]);
    expect(withObjective[0]!.bearingDeg).toBeCloseTo(0, 5);
    expect(withObjective[0]!.distanceM).toBeCloseTo(50, 5);
  });

  it("gives bearings relative to the crosshair, clockwise-positive", () => {
    const world = new CollisionWorld(() => 0);
    const east = findPlaces(world, { x: 0, y: 0, z: 0, id: null }, 0, [], {
      x: 40,
      z: 0,
    });
    expect(east[0]!.bearingDeg).toBeCloseTo(90, 5);
  });

  it("is deterministic", () => {
    const world = new CollisionWorld(() => 0);
    wall(world, 8, 0, 0.5, 6);
    wall(world, -3, 12, 4, 0.5);
    const run = () =>
      JSON.stringify(
        findPlaces(
          world,
          { x: 0, y: 0, z: 0, id: null },
          0.3,
          [{ x: -60, y: 0, z: 10 }],
          {
            x: 30,
            z: 30,
          },
        ),
      );
    expect(run()).toEqual(run());
  });
});
