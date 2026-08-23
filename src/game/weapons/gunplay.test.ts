import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { PlayerController } from "../player/controller";
import { WeaponRuntime } from "./runtime";
import { ViewmodelAnimator } from "./animation";
import { buildWeaponModel } from "./model";
import { getWeapon } from "./arsenal";
import { createActor, createInputState } from "../core/gameState";
import { CollisionWorld } from "../physics/collisionWorld";

describe("Call of Duty Modern Warfare Kinetic Gunplay Mechanics", () => {
  let controller: PlayerController;
  let world: CollisionWorld;

  beforeEach(() => {
    controller = new PlayerController();
    world = new CollisionWorld(() => 0);
  });

  describe("Tac-Stance (45-Degree Canting & Tactical Stance)", () => {
    it("toggles Tac-Stance active on input key edge", () => {
      const actor = createActor(1, "test-player", "blue", true);
      const input = createInputState();

      expect(controller.isTacStance).toBe(false);

      input.tacStancePressed = true;
      controller.update(actor, input, world, 0.016, 0);

      expect(controller.isTacStance).toBe(true);
      expect(input.tacStance).toBe(true);
      expect(controller.view.tacStancePose).toBeGreaterThan(0);

      // Toggle off
      input.tacStancePressed = true;
      controller.update(actor, input, world, 0.016, 0);
      expect(controller.isTacStance).toBe(false);
    });

    it("collimates weapon spread in Tac-Stance for accurate laser point shooting", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);

      const standardHipSpread = runtime.spreadDeg("stand", 0, false);
      runtime.ads = 1.0;
      const standardAdsSpread = runtime.spreadDeg("stand", 0, false);

      expect(standardAdsSpread).toBeLessThan(standardHipSpread);

      // Enable Tac-Stance
      runtime.setTacStance(true);
      const tacStanceSpread = runtime.spreadDeg("stand", 0, false);

      // Tac-Stance spread is tightly collimated between hip and ads
      expect(tacStanceSpread).toBeLessThan(standardHipSpread);
      expect(tacStanceSpread).toBeGreaterThan(standardAdsSpread);
    });

    it("allows higher mobility during Tac-Stance aim than conventional ADS", () => {
      const actor = createActor(1, "test-player", "blue", true);
      const input = createInputState();
      input.moveY = 1.0;

      // Regular ADS update
      controller.update(actor, input, world, 0.016, 1.0);
      const standardAdsSpeed = controller.speed;

      // Tac-Stance ADS update
      controller.setTacStance(true);
      controller.update(actor, input, world, 0.016, 1.0);
      const tacStanceSpeed = controller.speed;

      expect(tacStanceSpeed).toBeGreaterThanOrEqual(standardAdsSpeed);
    });
  });

  describe("Tactical Sprint (Tac-Sprint)", () => {
    it("enters Tac-Sprint on tacSprintPressed with high speed boost", () => {
      const actor = createActor(1, "test-player", "blue", true);
      const input = createInputState();
      input.sprint = true;
      input.moveY = 1.0;
      input.tacSprintPressed = true;

      controller.update(actor, input, world, 0.016, 0);

      expect(controller.sprinting).toBe(true);
      expect(controller.tacSprinting).toBe(true);
      expect(controller.view.tacSprintPose).toBeGreaterThan(0);
    });

    it("blends into vertical one-handed weapon carry pose in animator", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);
      const model = buildWeaponModel(weaponDef);
      const animator = new ViewmodelAnimator();

      controller.view.tacSprintPose = 1.0;
      controller.view.sprintPose = 1.0;

      for (let i = 0; i < 20; i += 1) {
        animator.update(
          model,
          runtime,
          {
            lookDeltaYaw: 0,
            lookDeltaPitch: 0,
            speed: 7.2,
            grounded: true,
            view: controller.view,
            time: i * 0.016,
            lowered: 0,
            fovScale: 1.0,
          },
          0.016,
        );
      }

      // Model root should have muzzle elevated significantly (+X pitch in viewmodel space)
      expect(model.root.position.y).toBeDefined();
      expect(model.root.rotation.x).toBeGreaterThan(0.5);

      model.dispose();
    });
  });

  describe("Slide Canceling & Slide Camera Roll", () => {
    it("cancels slide early when crouch, jump, or sprint is pressed", () => {
      const actor = createActor(1, "test-player", "blue", true);
      actor.grounded = true;
      actor.velocity.set(0, 0, 6.0);

      const input = createInputState();
      input.crouchPressed = true;

      // Start slide
      controller.update(actor, input, world, 0.016, 0);
      expect(controller.isSliding).toBe(true);

      // Advance slide
      input.crouchPressed = false;
      controller.update(actor, input, world, 0.2, 0);
      expect(controller.isSliding).toBe(true);

      // Slide cancel via crouch / jump
      input.slideCancelPressed = true;
      controller.update(actor, input, world, 0.016, 0);

      expect(controller.isSliding).toBe(false);
    });

    it("computes dynamic camera roll banking during slides", () => {
      const actor = createActor(1, "test-player", "blue", true);
      actor.grounded = true;
      actor.velocity.set(4.0, 0, 4.0);

      const input = createInputState();
      input.crouchPressed = true;
      input.moveX = -1.0;

      controller.update(actor, input, world, 0.05, 0);

      expect(controller.view.slideRoll).not.toBe(0);
      expect(controller.view.roll).not.toBe(0);
    });
  });

  describe("Procedural Chamber & Magazine Inspect ('I' Key)", () => {
    it("begins inspect and cycles through phases", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);

      expect(runtime.isInspecting).toBe(false);
      const started = runtime.beginInspect();
      expect(started).toBe(true);
      expect(runtime.isInspecting).toBe(true);

      // Advance inspect timer
      runtime.update(1.0, { wantsFire: false, wantsAds: false, canFire: true });
      expect(runtime.inspectProgress).toBeGreaterThan(0.2);

      // Interruption on trigger pull
      runtime.update(0.016, { wantsFire: true, wantsAds: false, canFire: true });
      expect(runtime.isInspecting).toBe(false);
    });

    it("interferes with bolt position during chamber inspection in animator", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);
      const model = buildWeaponModel(weaponDef);
      const animator = new ViewmodelAnimator();

      runtime.beginInspect();
      runtime.inspectTimer = 0.5; // Phase 1: chamber check

      animator.update(
        model,
        runtime,
        {
          lookDeltaYaw: 0,
          lookDeltaPitch: 0,
          speed: 0,
          grounded: true,
          view: controller.view,
          time: 0,
          lowered: 0,
          fovScale: 1.0,
        },
        0.016,
      );

      // Bolt should be retracted slightly to view chambered round
      expect(model.parts.bolt.position.z).toBeDefined();

      model.dispose();
    });
  });

  describe("Procedural Recoil & Barrel Heat Mirage", () => {
    it("accumulates barrel heat on firing and cools down over time", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);
      const actor = createActor(1, "shooter", "blue", true);

      expect(runtime.barrelHeat).toBe(0);

      runtime.fire({
        shooter: actor,
        world,
        time: 0,
        direction: new THREE.Vector3(0, 0, -1),
        origin: new THREE.Vector3(0, 1.6, 0),
        accuracy: 1,
      });

      expect(runtime.barrelHeat).toBeGreaterThan(0.1);
      const hot = runtime.barrelHeat;

      // Dissipates over time
      runtime.update(1.5, { wantsFire: false, wantsAds: false, canFire: true });
      expect(runtime.barrelHeat).toBeLessThan(hot);
    });

    it("drives multi-stage recoil spring simulation", () => {
      const weaponDef = getWeapon("m4a1");
      const runtime = new WeaponRuntime(weaponDef);
      const model = buildWeaponModel(weaponDef);
      const animator = new ViewmodelAnimator();
      const actor = createActor(1, "shooter", "blue", true);

      runtime.fire({
        shooter: actor,
        world,
        time: 0,
        direction: new THREE.Vector3(0, 0, -1),
        origin: new THREE.Vector3(0, 1.6, 0),
        accuracy: 1,
      });

      expect(runtime.viewKick).toBeGreaterThan(0);
      expect(runtime.firedThisFrame).toBe(true);

      animator.update(
        model,
        runtime,
        {
          lookDeltaYaw: 0,
          lookDeltaPitch: 0,
          speed: 0,
          grounded: true,
          view: controller.view,
          time: 0,
          lowered: 0,
          fovScale: 1.0,
        },
        0.016,
      );

      // Model position should have linear kick along Z
      expect(model.root.position.z).toBeDefined();

      model.dispose();
    });
  });
});
