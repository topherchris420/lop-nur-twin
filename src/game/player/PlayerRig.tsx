import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGameStore } from "../core/gameStore";
import { useTwinStore } from "@/lib/store";
import { game, eyePosition } from "../core/gameState";
import { HUMAN_METRICS, MASK_SOLID } from "../core/types";
import type { CollisionWorld } from "../physics/collisionWorld";
import { PlayerController } from "./controller";
import { InputManager } from "./input";
import { WeaponRuntime } from "../weapons/runtime";
import { buildWeaponModel, type WeaponModel } from "../weapons/model";
import { ViewmodelAnimator } from "../weapons/animation";
import { getWeapon } from "../weapons/arsenal";
import type { FxManager } from "../fx/combatFx";
import { applyNearMissSuppression } from "../core/combat";
import { ViewmodelStage } from "./viewmodelStage";
import { sunElevationRad, SUN } from "../render/environment";
import { getPostExposure } from "../render/CombatEffects";

/**
 * The first-person rig: input, camera, weapon and viewmodel.
 *
 * The weapon is drawn by `ViewmodelStage` in a second pass with its own
 * camera, field of view and depth range — see that file for why parenting it
 * to the world camera cannot be made to work. This component owns the pass and
 * schedules it after the post-processing composer.
 */

const MAX_PITCH = Math.PI / 2 - 0.02;

interface PlayerRigProps {
  world: CollisionWorld | null;
  fx: FxManager | null;
  /** True when the post-processing composer owns the main render. */
  postEnabled: boolean;
  /** Radiance map shared with the world, so weapon metals match the sky. */
  environment: THREE.Texture | null;
  /** Called once the rig is live, so the scene can start the match. */
  onReady?: () => void;
}

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _ejectDir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _probeEnd = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _sunColor = new THREE.Color();
const _invQuat = new THREE.Quaternion();

export function PlayerRig({ world, fx, postEnabled, environment, onReady }: PlayerRigProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const screen = useGameStore((s) => s.screen);
  const loadout = useGameStore((s) => s.loadout);
  const sensitivity = useGameStore((s) => s.sensitivity);
  const adsSensitivity = useGameStore((s) => s.adsSensitivity);
  const invertY = useGameStore((s) => s.invertY);
  const fovSetting = useGameStore((s) => s.fov);

  const controller = useMemo(() => new PlayerController(), []);
  const animator = useMemo(() => new ViewmodelAnimator(), []);
  const stage = useMemo(() => new ViewmodelStage(), []);
  const viewmodelRoot = stage.root;

  useEffect(() => {
    // `?novm=1` hides the weapon, for isolating render problems in the probe.
    if (typeof window === "undefined") return;
    viewmodelRoot.visible =
      new URLSearchParams(window.location.search).get("novm") !== "1";
  }, [viewmodelRoot]);

  useEffect(() => {
    stage.setEnvironment(environment);
  }, [stage, environment]);

  useEffect(() => () => stage.dispose(), [stage]);

  const input = useMemo(
    () =>
      new InputManager({
        sensitivity,
        adsSensitivity,
        invertY,
        onLockChange: (locked) => {
          if (!locked && useGameStore.getState().screen === "playing") {
            useGameStore.getState().setScreen("paused");
          }
        },
        onPause: () => {
          const state = useGameStore.getState();
          if (state.screen === "playing") state.setScreen("paused");
        },
      }),
    // The manager is stateful and long-lived; settings are pushed in below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const weapons = useRef<{
    primary: WeaponRuntime;
    secondary: WeaponRuntime;
    active: "primary" | "secondary";
    models: { primary: WeaponModel; secondary: WeaponModel };
  } | null>(null);

  /* ------------------------------------------------------- lifecycle */

  useEffect(() => {
    input.setOptions({ sensitivity, adsSensitivity, invertY });
  }, [input, sensitivity, adsSensitivity, invertY]);

  useEffect(() => {
    const element = gl.domElement;
    input.attach(element);
    return () => input.detach();
  }, [input, gl]);

  // Build the loadout's weapons, and rebuild when the loadout changes.
  useEffect(() => {
    const primaryDef = getWeapon(loadout.primaryId);
    const secondaryDef = getWeapon(loadout.secondaryId);
    const primaryModel = buildWeaponModel(primaryDef);
    const secondaryModel = buildWeaponModel(secondaryDef);
    secondaryModel.root.visible = false;
    viewmodelRoot.add(primaryModel.root, secondaryModel.root);
    weapons.current = {
      primary: new WeaponRuntime(primaryDef),
      secondary: new WeaponRuntime(secondaryDef),
      active: "primary",
      models: { primary: primaryModel, secondary: secondaryModel },
    };
    game.player.weaponId = primaryDef.id;
    animator.reset();
    onReady?.();
    return () => {
      viewmodelRoot.remove(primaryModel.root, secondaryModel.root);
      primaryModel.dispose();
      secondaryModel.dispose();
      weapons.current = null;
    };
  }, [loadout.primaryId, loadout.secondaryId, viewmodelRoot, animator, onReady]);

  // Grab the pointer whenever we enter play.
  useEffect(() => {
    if (screen === "playing") {
      const id = window.setTimeout(() => input.requestLock(), 60);
      return () => window.clearTimeout(id);
    }
    input.releaseLock();
    return undefined;
  }, [screen, input]);

  /* ------------------------------------------------------------ loop */

  useFrame((_state, rawDelta) => {
    if (import.meta.env.DEV) {
      const d = (globalThis as { __rig?: Record<string, unknown> }).__rig ?? {};
      d["ticks"] = ((d["ticks"] as number) ?? 0) + 1;
      d["hasWorld"] = world !== null;
      d["hasWeapons"] = weapons.current !== null;
      (globalThis as { __rig?: Record<string, unknown> }).__rig = d;
    }
    const held = weapons.current;
    if (!world || !held) return;
    const playing = useGameStore.getState().screen === "playing";
    const dt = Math.min(0.05, rawDelta);
    const player = game.player;
    const active = held[held.active];
    const model = held.models[held.active];

    input.adsBlend = active.ads;

    if (playing && player.alive) {
      const s = input.state;

      /* ---------------------------------------------------- look */
      player.yaw += s.lookYaw;
      player.pitch = THREE.MathUtils.clamp(player.pitch + s.lookPitch, -MAX_PITCH, MAX_PITCH);

      /* ------------------------------------------------ movement */
      controller.update(player, s, world, dt, active.ads);
      for (const event of controller.events) {
        if (event.kind === "footstep" && fx) {
          fx.groundDust(player.position, event.surface, Math.min(1, event.speed / 5), 0.4);
        } else if (event.kind === "land" && fx && event.speed > 4) {
          fx.groundDust(player.position, event.surface, Math.min(1.4, event.speed / 7), 0.7);
        } else if (event.kind === "slide-start" && fx) {
          fx.groundDust(player.position, player.groundSurface, 1.4, 0.9);
        } else if (event.kind === "fall-damage") {
          player.health = Math.max(0, player.health - event.amount);
          player.lastDamageTime = game.time;
        }
      }

      /* ------------------------------------------------- weapons */
      if (s.swapPressed) {
        held.active = held.active === "primary" ? "secondary" : "primary";
        held.models.primary.root.visible = held.active === "primary";
        held.models.secondary.root.visible = held.active === "secondary";
        held[held.active].raise();
        animator.reset();
        game.player.weaponId = held[held.active].def.id;
      }
      if (s.reloadPressed) active.beginReload();
      if (s.fireModePressed) active.cycleFireMode();

      const canFire = !controller.firingBlocked && player.alive;
      active.update(dt, {
        wantsFire: s.fire,
        wantsAds: s.ads,
        canFire,
        adsTimeScale: 1,
      });
      active.maybeResetPattern(game.time);

      // Recoil from the weapon is added to the look angles, so the player
      // physically has to pull down through the pattern.
      const kickPitchDelta = active.kickPitch;
      const kickYawDelta = active.kickYaw;

      /* ---------------------------------------------------- fire */
      if (active.wantsShot(canFire)) {
        // The muzzle anchor lives on the viewmodel, which is parented to the
        // camera, so its world matrix is the truth for where rounds start.
        model.parts.muzzleTip.getWorldPosition(_muzzle);
        eyePosition(player, _eye);
        // Rounds leave from the eye, not the muzzle, so what the crosshair
        // covers is what gets hit; the muzzle only drives the visual effects.
        _aim.copy(_forward);
        active.fire({
          shooter: player,
          world,
          time: game.time,
          direction: _aim,
          origin: _eye,
          accuracy: 1,
        });
        if (fx) {
          const calibre =
            active.def.weaponClass === "sniper" || active.def.weaponClass === "lmg"
              ? 0.34
              : active.def.weaponClass === "pistol"
                ? 0.2
                : 0.26;
          fx.muzzleFlash(_muzzle, _forward, calibre, false, true);
          _probeEnd.copy(_eye).addScaledVector(_forward, 200);
          applyNearMissSuppression(_eye, _probeEnd, player.team);
        }
        player.lastFireTime = game.time;
      }

      if (active.ejectThisFrame && fx) {
        model.parts.ejectionPort.getWorldPosition(_muzzle);
        model.parts.ejectionPort.getWorldQuaternion(_quat);
        _ejectDir.set(1, 0.35, 0).applyQuaternion(_quat).normalize();
        fx.ejectCasing(_muzzle, _ejectDir);
      }

      active.updateProjectiles(dt, world, game.time);

      // Apply this frame's recoil delta to the view.
      player.pitch = THREE.MathUtils.clamp(
        player.pitch + (active.kickPitch - kickPitchDelta),
        -MAX_PITCH,
        MAX_PITCH,
      );
      player.yaw += active.kickYaw - kickYawDelta;
    } else {
      active.update(dt, { wantsFire: false, wantsAds: false, canFire: false });
    }

    /* -------------------------------------------------------- camera */
    const eyeHeight = controller.eyeHeight();
    const view = controller.view;
    _euler.set(player.pitch + view.pitch, player.yaw, view.roll);
    camera.quaternion.setFromEuler(_euler);
    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();
    _up.crossVectors(_right, _forward).normalize();

    camera.position.set(
      player.position.x + _right.x * view.position.x,
      player.position.y + eyeHeight + view.position.y,
      player.position.z + _right.z * view.position.x,
    );

    // Field of view: blend to the weapon's ADS value, and add a small
    // speed-driven widening that makes sprinting feel faster than it is.
    const speedFov = Math.min(1, controller.speed / 7.6) * (controller.tacSprinting ? 6 : 3);
    const targetFov =
      fovSetting + speedFov + (active.def.handling.adsFov - fovSetting - speedFov) * active.ads;
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov += (targetFov - perspective.fov) * Math.min(1, dt * 16);
    perspective.updateProjectionMatrix();

    /* ----------------------------------------------------- viewmodel */
    // The weapon has its own camera, so it needs no FOV compensation — it is
    // simply posed at true scale in front of a 62° lens.
    animator.update(model, active, {
      lookDeltaYaw: input.rawYaw,
      lookDeltaPitch: input.rawPitch,
      speed: controller.speed,
      grounded: player.grounded,
      view,
      time: game.time,
      lowered: playing ? 0 : 1,
      fovScale: 1,
    }, dt);
    stage.setAds(active.ads);

    /* --------------------------------------------------------- state */
    game.cameraPosition.copy(camera.position);
    game.cameraForward.copy(_forward);
    game.cameraRight.copy(_right);
    game.cameraUp.copy(_up);
    game.cameraFov = perspective.fov;
    game.adsProgress = active.ads;
    player.aimDir.copy(_forward);
    eyePosition(player, player.muzzle);

    const hud = game.hud;
    hud.health = player.health;
    hud.maxHealth = player.maxHealth;
    hud.ammo = active.ammo;
    hud.reserve = active.reserve;
    hud.magSize = active.def.magSize;
    hud.weaponName = active.def.shortName;
    hud.fireMode = active.fireMode.toUpperCase();
    hud.reloading = active.isReloading;
    hud.reloadProgress = active.reloadProgress;
    hud.spreadDeg = active.spreadDeg(player.stance, controller.speed, !player.grounded);
    if (hud.hitmarker > 0) hud.hitmarker = Math.max(0, hud.hitmarker - dt * 1000);

    input.endFrame();
  });

  /* -------------------------------------------------- viewmodel pass */

  // Priority 2 puts this after the post-processing composer (priority 1), so
  // the weapon is drawn over the finished frame. Registering any subscriber
  // above priority 0 disables R3F's automatic render, so when the composer is
  // not mounted this callback has to draw the world itself.
  useFrame((state) => {
    const gl2 = state.gl;
    if (!postEnabled) {
      gl2.render(state.scene, state.camera);
    }
    if (!viewmodelRoot.visible) return;

    const size = state.size;
    stage.setAspect(size.width / Math.max(1, size.height));

    // Track the world sun so the weapon is lit from the same direction.
    const dayFactor = useTwinStore.getState().night ? 0 : 1;
    const elevation = sunElevationRad(dayFactor);
    const azimuth = THREE.MathUtils.degToRad(SUN.azimuthDeg);
    _sunDir.set(
      Math.sin(azimuth) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(azimuth) * Math.cos(elevation),
    );
    // Express it in view space so the key light stays put as the player turns.
    _sunDir.applyQuaternion(_invQuat.copy(state.camera.quaternion).invert());
    _sunColor.setHex(dayFactor > 0.5 ? 0xfff1da : 0x9fb4d8);
    stage.setSun(_sunDir, _sunColor, Math.max(0.08, Math.sin(elevation)));

    // The composer leaves the renderer on NoToneMapping and applies AgX
    // itself; matching both the transform and the exposure here keeps the two
    // passes on one response curve.
    stage.render(
      gl2,
      THREE.AgXToneMapping,
      postEnabled ? getPostExposure() : 1.05,
    );
  }, 2);

  // Nothing renders from this component directly; the stage owns the model.
  return null;
}

/** Exposed for the scene: drop the player at a spawn point. */
export function placePlayer(
  world: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
): void {
  const player = game.player;
  const y = world.groundAt(x, z);
  player.position.set(x, y, z);
  player.velocity.set(0, 0, 0);
  player.yaw = yaw;
  player.pitch = 0;
  player.grounded = true;
  // Nudge upward if the spawn is inside a prop.
  for (let i = 0; i < 8; i += 1) {
    if (world.isPositionFree(player.position, HUMAN_METRICS.radius, HUMAN_METRICS.colliderHeight.stand)) {
      break;
    }
    player.position.y += 0.35;
  }
  void MASK_SOLID;
}
