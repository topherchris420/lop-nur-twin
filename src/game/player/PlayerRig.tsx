import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useGameStore } from "../core/gameStore";
import { useTwinStore } from "@/lib/store";
import { readFlag } from "@/lib/params";
import { game, eyePosition } from "../core/gameState";
import { HUMAN_METRICS, MASK_BULLET, MASK_SOLID, horizontalToVerticalFov } from "../core/types";
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
import { getPostExposure } from "../render/screenEffects";

/**
 * The first-person rig: input, camera, weapon and viewmodel.
 *
 * Implements Modern Warfare-tier kinetic gunplay:
 * - 45-degree Tac-Stance (canting) with an active visible tactical collimated laser beam and glowing endpoint dot.
 * - Tactical Sprint (Tac-Sprint) vertical one-handed weapon carry with high-speed cadence bobbing.
 * - Slide Canceling with instantaneous standing/sprint recovery and dynamic camera roll banking.
 * - Multi-phase procedural weapon chamber & magazine inspection animation ('I' key).
 * - Physical brass casing ejection with 3-axis angular tumbling and metallic ground/wall bouncing.
 * - Barrel heat mirage distortion waves under rapid automatic fire.
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
const _laserStart = new THREE.Vector3();
const _laserEnd = new THREE.Vector3();
const _laserNormal = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _ejectDir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _probeEnd = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _sunColor = new THREE.Color();
const _invQuat = new THREE.Quaternion();

/** Procedural collimated tactical laser beam and glowing endpoint dot. */
function createTacticalLaser(): {
  group: THREE.Group;
  beam: THREE.Mesh;
  dot: THREE.Mesh;
  flare: THREE.Mesh;
  update(
    from: THREE.Vector3,
    to: THREE.Vector3,
    normal: THREE.Vector3,
    visible: boolean,
    intensity: number,
  ): void;
  dispose(): void;
} {
  const group = new THREE.Group();
  group.name = "tactical-laser-rig";
  group.userData["noCollide"] = true;

  // Collimated cylindrical laser beam
  const beamGeo = new THREE.CylinderGeometry(0.0032, 0.0055, 1, 8, 1, true);
  beamGeo.translate(0, 0.5, 0);
  beamGeo.rotateX(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x33ff88,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  group.add(beam);

  // Soft glowing laser endpoint dot texture
  const dotCanvas = document.createElement("canvas");
  dotCanvas.width = dotCanvas.height = 64;
  const ctx = dotCanvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255, 255, 255, 1)");
  grad.addColorStop(0.22, "rgba(60, 255, 140, 0.95)");
  grad.addColorStop(0.55, "rgba(30, 255, 120, 0.35)");
  grad.addColorStop(1, "rgba(0, 255, 100, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const dotTex = new THREE.CanvasTexture(dotCanvas);

  const dotGeo = new THREE.PlaneGeometry(0.048, 0.048);
  const dotMat = new THREE.MeshBasicMaterial({
    map: dotTex,
    color: 0x55ffaa,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.renderOrder = 12;
  dot.frustumCulled = false;
  group.add(dot);

  // Emitter lens flare
  const flareGeo = new THREE.SphereGeometry(0.007, 8, 8);
  const flareMat = new THREE.MeshBasicMaterial({
    color: 0x88ffcc,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flare = new THREE.Mesh(flareGeo, flareMat);
  flare.frustumCulled = false;
  group.add(flare);

  const _laserDir = new THREE.Vector3();

  return {
    group,
    beam,
    dot,
    flare,
    update(from, to, normal, visible, intensity) {
      group.visible = visible;
      if (!visible) return;
      beamMat.opacity = 0.65 * intensity;
      dotMat.opacity = 0.92 * intensity;
      flareMat.opacity = 0.85 * intensity;

      _laserDir.subVectors(to, from);
      const dist = _laserDir.length();
      if (dist < 0.05) return;
      _laserDir.multiplyScalar(1 / dist);

      beam.position.copy(from);
      beam.scale.set(1, 1, dist);
      beam.lookAt(to);

      dot.position.copy(to).addScaledVector(normal, 0.008);
      if (Math.abs(normal.y) > 0.98) {
        dot.quaternion.setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          normal.y > 0 ? -Math.PI / 2 : Math.PI / 2,
        );
      } else {
        dot.lookAt(dot.position.clone().add(normal));
      }

      flare.position.copy(from);
    },
    dispose() {
      beamGeo.dispose();
      beamMat.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      dotTex.dispose();
      flareGeo.dispose();
      flareMat.dispose();
    },
  };
}

export function PlayerRig({
  world,
  fx,
  postEnabled,
  environment,
  onReady,
}: PlayerRigProps) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
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
  const laser = useMemo(() => createTacticalLaser(), []);
  const viewmodelRoot = stage.root;
  /** 0..1 death-camera blend; eased so respawning stands you back up. */
  const death = useRef(0);
  /** Eased horizontal field of view, in degrees. See `core/types.ts`. */
  const horizontalFov = useRef(fovSetting);

  useEffect(() => {
    scene.add(laser.group);
    return () => {
      scene.remove(laser.group);
      laser.dispose();
    };
  }, [scene, laser]);

  useEffect(() => {
    // `?novm=1` hides the weapon, for isolating render problems in the probe.
    viewmodelRoot.visible = !readFlag("novm");
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
      player.pitch = THREE.MathUtils.clamp(
        player.pitch + s.lookPitch,
        -MAX_PITCH,
        MAX_PITCH,
      );

      /* ------------------------------------------------ movement */
      controller.update(player, s, world, dt, active.ads);
      active.setTacStance(controller.isTacStance);

      for (const event of controller.events) {
        if (event.kind === "footstep" && fx) {
          fx.groundDust(
            player.position,
            event.surface,
            Math.min(1, event.speed / 5),
            0.4,
          );
        } else if (event.kind === "land" && fx && event.speed > 4) {
          fx.groundDust(
            player.position,
            event.surface,
            Math.min(1.4, event.speed / 7),
            0.7,
          );
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
        held[held.active].setTacStance(controller.isTacStance);
        animator.reset();
        game.player.weaponId = held[held.active].def.id;
      }
      if (s.reloadPressed) active.beginReload();
      if (s.fireModePressed) active.cycleFireMode();
      if (s.inspectPressed) active.beginInspect();

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

      // Physical brass casing ejection with player momentum
      if (active.ejectThisFrame && fx) {
        model.parts.ejectionPort.getWorldPosition(_muzzle);
        model.parts.ejectionPort.getWorldQuaternion(_quat);
        _ejectDir.set(1, 0.35, 0).applyQuaternion(_quat).normalize();
        fx.ejectCasing(_muzzle, _ejectDir, player.velocity);
      }

      // Barrel heat mirage distortion waves and rising barrel smoke
      if (active.barrelHeat > 0.15 && fx) {
        model.parts.muzzleTip.getWorldPosition(_muzzle);
        fx.barrelHeatMirage(_muzzle, _forward, active.barrelHeat);
        if (active.barrelHeat > 0.25) {
          fx.barrelSmoke(_muzzle, _forward, active.barrelHeat);
        }
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
    death.current = player.alive
      ? Math.max(0, death.current - dt * 2.4)
      : Math.min(1, death.current + dt * 1.6);
    const fell = death.current * death.current * (3 - 2 * death.current);

    const eyeHeight = THREE.MathUtils.lerp(controller.eyeHeight(), 0.34, fell);
    const view = controller.view;
    _euler.set(
      player.pitch + view.pitch + fell * 0.5,
      player.yaw,
      view.roll + fell * 1.05,
    );
    camera.quaternion.setFromEuler(_euler);
    camera.getWorldDirection(_forward);
    _right.crossVectors(_forward, THREE.Object3D.DEFAULT_UP).normalize();
    _up.crossVectors(_right, _forward).normalize();

    camera.position.set(
      player.position.x + _right.x * view.position.x,
      player.position.y + eyeHeight + view.position.y,
      player.position.z + _right.z * view.position.x,
    );

    // Field of view: speed widening + Tac-Sprint rush + ADS zoom
    const speedFov =
      Math.min(1, controller.speed / 7.6) * (controller.tacSprinting ? 6.5 : 3);
    const targetFov =
      fovSetting +
      speedFov +
      (active.def.handling.adsFov - fovSetting - speedFov) *
        (controller.isTacStance ? active.ads * 0.45 : active.ads);
    const perspective = camera as THREE.PerspectiveCamera;
    horizontalFov.current += (targetFov - horizontalFov.current) * Math.min(1, dt * 16);
    perspective.fov = horizontalToVerticalFov(horizontalFov.current, perspective.aspect);
    perspective.updateProjectionMatrix();

    /* ------------------------------------------------- tactical laser */
    // In Tac-Stance, render the tactical laser beam and glowing endpoint dot on target
    const isTacStanceActive = controller.isTacStance && player.alive && playing;
    if (isTacStanceActive) {
      if (model.parts.laserEmitter) {
        model.parts.laserEmitter.getWorldPosition(_laserStart);
      } else {
        model.parts.muzzleTip.getWorldPosition(_laserStart);
      }
      eyePosition(player, _eye);
      const hit = world.raycast(_eye, _forward, 150, MASK_BULLET, player.id);
      if (hit) {
        _laserEnd.copy(hit.point);
        _laserNormal.copy(hit.normal);
      } else {
        _laserEnd.copy(_eye).addScaledVector(_forward, 120);
        _laserNormal.copy(_forward).negate();
      }
      laser.update(_laserStart, _laserEnd, _laserNormal, true, 1.0);
    } else {
      laser.update(_eye, _eye, _forward, false, 0);
    }

    /* ----------------------------------------------------- viewmodel */
    animator.update(
      model,
      active,
      {
        lookDeltaYaw: input.rawYaw,
        lookDeltaPitch: input.rawPitch,
        speed: controller.speed,
        grounded: player.grounded,
        view,
        time: game.time,
        lowered: playing ? 0 : 1,
        fovScale: 1,
      },
      dt,
    );
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
    hud.alive = player.alive;
    hud.respawnIn = Math.max(0, player.respawnTimer);
    hud.ammo = active.ammo;
    hud.reserve = active.reserve;
    hud.magSize = active.def.magSize;
    hud.weaponName = active.def.shortName;
    hud.fireMode = active.fireMode.toUpperCase();
    hud.reloading = active.isReloading;
    hud.reloadProgress = active.reloadProgress;
    hud.spreadDeg = active.spreadDeg(player.stance, controller.speed, !player.grounded);
    hud.tacStance = controller.isTacStance;
    hud.tacSprint = controller.tacSprinting;
    hud.inspecting = active.isInspecting;
    if (hud.hitmarker > 0) hud.hitmarker = Math.max(0, hud.hitmarker - dt * 1000);

    input.endFrame();
  });

  /* -------------------------------------------------- viewmodel pass */

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
    _sunDir.applyQuaternion(_invQuat.copy(state.camera.quaternion).invert());
    _sunColor.setHex(dayFactor > 0.5 ? 0xfff1da : 0x9fb4d8);
    stage.setSun(_sunDir, _sunColor, Math.max(0.08, Math.sin(elevation)));

    stage.render(gl2, THREE.AgXToneMapping, postEnabled ? getPostExposure() : 1.05);
  }, 2);

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
  for (let i = 0; i < 8; i += 1) {
    if (
      world.isPositionFree(
        player.position,
        HUMAN_METRICS.radius,
        HUMAN_METRICS.colliderHeight.stand,
      )
    ) {
      break;
    }
    player.position.y += 0.35;
  }
  void MASK_SOLID;
}
