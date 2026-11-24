import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { sunState } from "@/lib/sunState";
import { SURFACE_PROFILES, type ImpactRequest, type SurfaceType } from "../core/types";
import { eyePosition, game } from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";
import { CasingRenderer } from "./casings";
import { DECAL, DecalRenderer, decalIndexFor } from "./decals";
import { MuzzleFlashRenderer, type FlashSpec } from "./muzzleFlash";
import {
  ParticleSystem,
  SPRITE,
  makeSpawnParams,
  resetSpawnParams,
  type ParticleLighting,
  type SpawnParams,
  type SpriteId,
} from "./particles";
import { TracerRenderer } from "./tracers";
import { viewmodelDirToWorld, viewmodelToWorld } from "./viewmodelSpace";

/**
 * Combat visual effects: muzzle flashes, smoke, tracers, impacts, decals and
 * ejected brass.
 *
 * Everything is pooled and instanced. The manager drains the queues on `game`
 * once per frame and never allocates in steady state.
 *
 * First-person effects start on the weapon, which is drawn in its own stage
 * scene (see `viewmodelSpace.ts`). The flash itself is drawn *in* that scene,
 * carried by the muzzle socket, so it sits exactly on the crown and the
 * weapon occludes it correctly; everything that has to stay behind in the
 * world when the camera turns — smoke, brass, the light on the ground, the
 * tracer's first metres — is carried into the world onto the same pixel.
 * Those are resolved in `update`, which runs after the rig has posed the
 * weapon and the camera for this frame, so nothing trails the gun by a frame.
 */

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _tmpD = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _tmpColor2 = new THREE.Color();
const _tmpQuat = new THREE.Quaternion();
const _spawn = makeSpawnParams();

/** 2400 K, the colour of a rifle's flash light on the surroundings. */
const FLASH_LIGHT = new THREE.Color(1.0, 0.56, 0.24);
const SUN_TINT = new THREE.Color(1.0, 0.93, 0.82);
const MOON_TINT = new THREE.Color(0.62, 0.72, 0.95);
const SKY_DAY = new THREE.Color(0.3, 0.36, 0.45);
const SKY_NIGHT = new THREE.Color(0.012, 0.018, 0.032);
const GROUND_DAY = new THREE.Color(0.3, 0.25, 0.18);
const GROUND_NIGHT = new THREE.Color(0.008, 0.007, 0.006);

export interface FxQuality {
  /** Scales every particle count. */
  particleScale: number;
  decals: boolean;
  casings: boolean;
  /** 0 turns the pooled world flash light off; anything above keeps one. */
  flashLights: number;
}

interface PendingShot {
  anchor: THREE.Object3D;
  calibre: number;
  suppressed: boolean;
}

interface PendingEject {
  anchor: THREE.Object3D;
  velocity: THREE.Vector3;
}

/** The weapon stage the first-person effects start in. */
interface ViewmodelBinding {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  worldCamera: THREE.Camera;
}

export class FxManager {
  readonly group = new THREE.Group();
  private readonly particles: ParticleSystem;
  private readonly decals: DecalRenderer;
  private readonly tracers: TracerRenderer;
  private readonly casings: CasingRenderer;
  /** First-person flash, drawn in the weapon stage, carried by the muzzle. */
  private readonly fpFlash: MuzzleFlashRenderer;
  /** Everyone else's flashes, in world space. */
  private readonly tpFlash: MuzzleFlashRenderer;
  /** One pooled light for the world around whichever flash is brightest. */
  private readonly worldLight: THREE.PointLight;
  /** One pooled light on the hands and receiver, inside the weapon stage. */
  private readonly stageLight: THREE.PointLight;
  private worldLightOn = false;
  private worldLightEnergy = 0;
  private readonly worldLightPos = new THREE.Vector3();
  private readonly rand = mulberry32(0xf0cca);
  private quality: FxQuality = {
    particleScale: 1,
    decals: true,
    casings: true,
    flashLights: 4,
  };
  private binding: ViewmodelBinding | null = null;
  private pendingShot: PendingShot | null = null;
  private readonly pendingEjects: PendingEject[] = [];
  private pendingHeat = 0;
  private pendingHeatAnchor: THREE.Object3D | null = null;
  private heatAccumulator = 0;
  private fpAnchor: THREE.Object3D | null = null;
  /** World position and aim of this frame's first-person shot, for its tracer. */
  private readonly fpMuzzleWorld = new THREE.Vector3();
  private fpShotThisFrame = false;
  private fpFlashEnergy = 0;
  private readonly lastFire = new Map<number, number>();
  private frameDt = 1 / 60;
  private readonly lighting: ParticleLighting = {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    skyColor: new THREE.Color(),
    groundColor: new THREE.Color(),
    flashPosition: new THREE.Vector3(),
    flashReach: 0,
    flashColor: new THREE.Color(),
  };

  constructor() {
    this.particles = new ParticleSystem(8192);
    this.decals = new DecalRenderer(320);
    this.tracers = new TracerRenderer(256);
    this.casings = new CasingRenderer(64);
    this.fpFlash = new MuzzleFlashRenderer(1, "fx-muzzle-flash-fp");
    this.tpFlash = new MuzzleFlashRenderer(12, "fx-muzzle-flash");
    this.group.name = "combat-fx";
    this.group.userData["noCollide"] = true;
    this.group.add(
      this.particles.mesh,
      this.decals.mesh,
      this.tracers.mesh,
      this.casings.mesh,
      this.tpFlash.mesh,
    );
    // Lights stay in the scene at zero intensity rather than toggling
    // `visible`: three counts only visible lights, so every toggle changed
    // the light count and recompiled every lit material on the next frame.
    this.worldLight = new THREE.PointLight(FLASH_LIGHT, 0, 9, 2);
    this.worldLight.castShadow = false;
    this.worldLight.name = "fx-flash-light";
    this.group.add(this.worldLight);
    this.worldLightOn = true;
    this.stageLight = new THREE.PointLight(FLASH_LIGHT, 0, 1.6, 2);
    this.stageLight.castShadow = false;
    this.stageLight.name = "fx-flash-light-fp";
    this.fpFlash.mesh.matrixAutoUpdate = false;
  }

  setQuality(quality: Partial<FxQuality>): void {
    this.quality = { ...this.quality, ...quality };
    const wantLight = this.quality.flashLights > 0;
    if (wantLight !== this.worldLightOn) {
      if (wantLight) this.group.add(this.worldLight);
      else this.group.remove(this.worldLight);
      this.worldLightOn = wantLight;
    }
  }

  /**
   * Hand the manager the first-person weapon's stage. The first-person flash
   * and its light move into that scene; shots, casings and barrel heat given
   * an anchor on the weapon are read in stage space from then on.
   */
  bindViewmodel(
    scene: THREE.Scene | null,
    camera: THREE.PerspectiveCamera | null,
    worldCamera: THREE.Camera | null,
  ): void {
    if (this.binding) {
      this.binding.scene.remove(this.fpFlash.mesh, this.stageLight);
    }
    this.binding = scene && camera && worldCamera ? { scene, camera, worldCamera } : null;
    if (this.binding) this.binding.scene.add(this.fpFlash.mesh, this.stageLight);
    this.pendingShot = null;
    this.pendingEjects.length = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Spawn helpers                                                     */
  /* ---------------------------------------------------------------- */

  /** The shared spawn record, back at its defaults. */
  private p(): SpawnParams {
    return resetSpawnParams(_spawn);
  }

  /** At least one rendered frame, at any frame rate. */
  private oneFrame(seconds: number): number {
    return Math.max(seconds, this.frameDt * 1.05);
  }

  private soft(
    p: SpawnParams,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    range: number,
  ): void {
    p.softPlane.set(normal.x, normal.y, normal.z, normal.dot(point));
    p.softRange = range;
  }

  /* ---------------------------------------------------------------- */
  /* Muzzle                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * A shot. With `firstPerson` and an `anchor` on the bound weapon, the flash
   * is laid out on that socket this frame; otherwise `position` and
   * `direction` are world space (a third-person shooter).
   */
  muzzleFlash(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    calibre: number,
    suppressed: boolean,
    firstPerson: boolean,
    anchor?: THREE.Object3D,
  ): void {
    if (firstPerson && anchor && this.binding) {
      this.pendingShot = { anchor, calibre, suppressed };
      this.fpAnchor = anchor;
      return;
    }
    this.worldShot(position, direction, calibre, suppressed, firstPerson ? 1 : 1.7);
  }

  /** A flash, smoke and light at a world-space muzzle. */
  private worldShot(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    calibre: number,
    suppressed: boolean,
    scale: number,
  ): void {
    if (!suppressed) {
      _tmpB.crossVectors(direction, THREE.Object3D.DEFAULT_UP);
      if (_tmpB.lengthSq() < 1e-6) _tmpB.set(1, 0, 0);
      _tmpB.normalize();
      _tmpC.crossVectors(_tmpB, direction).normalize();
      const spec: FlashSpec = {
        origin: position,
        forward: direction,
        right: _tmpB,
        up: _tmpC,
        scale,
        calibre,
        brake: calibre >= 0.3,
      };
      this.tpFlash.spawn(spec, this.rand);
      this.offerWorldLight(position, direction, 0.55 * (calibre / 0.26));
    }
    this.muzzleSmoke(position, direction, calibre, suppressed, 0.8, false);
  }

  /** Point the pooled world light at a flash if it outshines the current one. */
  private offerWorldLight(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    energy: number,
  ): void {
    // Distance from the camera decides which flash gets the one light.
    const d = position.distanceTo(game.cameraPosition);
    const weighted = energy / (1 + d * 0.08);
    if (weighted <= this.worldLightEnergy) return;
    this.worldLightEnergy = weighted;
    this.worldLightPos.copy(position).addScaledVector(direction, 0.25);
  }

  /**
   * Blast smoke out of the muzzle, then a slower grey drift that rises and
   * thins. Lit by the sun and by the flash that made it.
   */
  private muzzleSmoke(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    calibre: number,
    suppressed: boolean,
    density: number,
    firstPerson: boolean,
  ): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    const k = calibre / 0.26;
    // Through the optic the plume is in the way of the target: thinner.
    const ads = firstPerson ? 1 - game.adsProgress * 0.5 : 1;
    const blasts = Math.max(1, Math.round((suppressed ? 3 : 2) * scale));
    for (let i = 0; i < blasts; i += 1) {
      const p = this.p();
      p.position.copy(position).addScaledVector(direction, 0.03 + rand() * 0.04);
      p.velocity
        .copy(direction)
        .multiplyScalar(1.6 + rand() * 1.4)
        .add(
          _tmpA.set((rand() - 0.5) * 0.35, 0.12 + rand() * 0.2, (rand() - 0.5) * 0.35),
        );
      p.lifetime = 0.55 + rand() * 0.35;
      p.size0 = 0.035 * k;
      p.size1 = (0.2 + rand() * 0.1) * k;
      p.color0.setRGB(0.66, 0.62, 0.56);
      p.color1.setRGB(0.6, 0.58, 0.55);
      p.alpha0 = (suppressed ? 0.42 : 0.34) * density * ads;
      p.alpha1 = 0;
      p.drag = 5.2;
      p.gravity = -0.25;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.6;
      p.sprite = SPRITE.billow;
      p.turbulence = 0.14;
      p.lit = 1;
      this.particles.spawn(p);
    }
    const drifts = Math.max(1, Math.round((suppressed ? 2 : 1) * scale));
    for (let i = 0; i < drifts; i += 1) {
      const p = this.p();
      p.position.copy(position).addScaledVector(direction, 0.08 + rand() * 0.08);
      p.velocity
        .copy(direction)
        .multiplyScalar(0.35 + rand() * 0.35)
        .add(_tmpA.set((rand() - 0.5) * 0.2, 0.22 + rand() * 0.2, (rand() - 0.5) * 0.2));
      p.lifetime = 1.3 + rand() * 0.9;
      p.size0 = 0.06 * k;
      p.size1 = (0.45 + rand() * 0.25) * k;
      p.color0.setRGB(0.6, 0.59, 0.57);
      p.color1.setRGB(0.56, 0.56, 0.56);
      p.alpha0 = (suppressed ? 0.24 : 0.17) * density * ads;
      p.alpha1 = 0;
      p.drag = 1.4;
      p.gravity = -0.3;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 0.6;
      p.sprite = SPRITE.wisp;
      p.turbulence = 0.42;
      p.lit = 1;
      this.particles.spawn(p);
    }
    // Unburnt powder: a few hot specks that outrun the flash.
    if (!suppressed) {
      const specks = Math.max(1, Math.round(4 * scale));
      for (let i = 0; i < specks; i += 1) {
        const p = this.p();
        p.position.copy(position).addScaledVector(direction, 0.04);
        p.velocity
          .copy(direction)
          .multiplyScalar(6 + rand() * 9)
          .add(
            _tmpA.set((rand() - 0.5) * 2.2, (rand() - 0.5) * 2.2, (rand() - 0.5) * 2.2),
          );
        p.lifetime = this.oneFrame(0.06 + rand() * 0.08);
        p.size0 = 0.012;
        p.size1 = 0.004;
        p.color0.setRGB(16, 8.5, 2.4);
        p.color1.setRGB(3.4, 0.8, 0.1);
        p.alpha0 = 1;
        p.alpha1 = 0;
        p.gravity = 6;
        p.drag = 2.4;
        p.sprite = SPRITE.spark;
        p.additive = 1;
        p.stretch = 4.5;
        this.particles.spawn(p);
      }
    }
  }

  /** Lay out this frame's first-person shot on the weapon's crown. */
  private resolveFirstPersonShot(shot: PendingShot): void {
    const binding = this.binding!;
    const anchor = shot.anchor;
    anchor.updateWorldMatrix(true, false);
    if (!shot.suppressed) {
      // Muzzle-local frame: +X right, +Y up, -Z out of the bore.
      const spec: FlashSpec = {
        origin: _tmpA.set(0, 0, 0),
        forward: _tmpB.set(0, 0, -1),
        right: _tmpC.set(1, 0, 0),
        up: _tmpD.set(0, 1, 0),
        scale: 1,
        calibre: shot.calibre,
        brake: shot.calibre >= 0.3,
      };
      this.fpFlash.spawn(spec, this.rand, 0);
    }
    // Into the world onto the same pixel, for smoke, light and the tracer.
    anchor.getWorldPosition(_tmpA);
    viewmodelToWorld(_tmpA, binding.camera, binding.worldCamera, this.fpMuzzleWorld);
    _tmpB.set(0, 0, -1).transformDirection(anchor.matrixWorld);
    viewmodelDirToWorld(_tmpB, binding.camera, binding.worldCamera, _tmpC);
    this.fpShotThisFrame = true;
    if (!shot.suppressed) {
      this.offerWorldLight(this.fpMuzzleWorld, _tmpC, 1.0 * (shot.calibre / 0.26));
    }
    this.muzzleSmoke(this.fpMuzzleWorld, _tmpC, shot.calibre, shot.suppressed, 1, true);
  }

  /** Casing ejection, called by the weapon layer with the port transform. */
  ejectCasing(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    linearVelocity?: THREE.Vector3,
    anchor?: THREE.Object3D,
  ): void {
    if (!this.quality.casings) return;
    if (anchor && this.binding) {
      if (this.pendingEjects.length < 4) {
        this.pendingEjects.push({
          anchor,
          velocity: (linearVelocity ?? _tmpA.set(0, 0, 0)).clone(),
        });
      }
      return;
    }
    this.casings.eject(position, direction, this.rand, linearVelocity);
  }

  private resolveEject(eject: PendingEject): void {
    const binding = this.binding!;
    eject.anchor.updateWorldMatrix(true, false);
    eject.anchor.getWorldPosition(_tmpA);
    viewmodelToWorld(_tmpA, binding.camera, binding.worldCamera, _tmpB);
    // Out of the port: right, up and a touch rearward, in the weapon's frame.
    _tmpC.set(1, 0.62, 0.22).normalize().transformDirection(eject.anchor.matrixWorld);
    viewmodelDirToWorld(_tmpC, binding.camera, binding.worldCamera, _tmpD);
    // The case's orientation in the world: weapon frame, then camera.
    eject.anchor.getWorldQuaternion(_tmpQuat);
    binding.worldCamera.getWorldQuaternion(this.scratchQuat).multiply(_tmpQuat);
    this.casings.eject(_tmpB, _tmpD, this.rand, eject.velocity, this.scratchQuat);
  }

  private readonly scratchQuat = new THREE.Quaternion();

  /**
   * Heat shimmer off a hot barrel. There is no refraction pass to bend the
   * background with, and additive white rings read as ghosts, so the heat is
   * carried by thin rising wisps from `barrelSmoke`; this keeps its call site.
   */
  barrelHeatMirage(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    heat: number,
    anchor?: THREE.Object3D,
  ): void {
    this.barrelSmoke(position, direction, heat, anchor);
  }

  /** Thin smoke rising off a hot barrel after sustained fire. */
  barrelSmoke(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    heat: number,
    anchor?: THREE.Object3D,
  ): void {
    if (anchor && this.binding) {
      // Once per frame, whichever call came last.
      this.pendingHeat = heat;
      this.pendingHeatAnchor = anchor;
      return;
    }
    this.emitBarrelWisps(
      position,
      _tmpA.copy(position).addScaledVector(direction, -0.3),
      heat,
    );
  }

  /** Rate-based wisps between the muzzle and a point back along the barrel. */
  private emitBarrelWisps(
    muzzle: THREE.Vector3,
    breech: THREE.Vector3,
    heat: number,
  ): void {
    if (heat < 0.2) return;
    const rand = this.rand;
    this.heatAccumulator +=
      Math.min(1.5, heat) * 12 * this.quality.particleScale * this.frameDt;
    while (this.heatAccumulator >= 1) {
      this.heatAccumulator -= 1;
      const p = this.p();
      const t = Math.pow(rand(), 1.6);
      p.position.lerpVectors(muzzle, breech, t);
      p.position.y += 0.012;
      p.velocity.set((rand() - 0.5) * 0.06, 0.22 + rand() * 0.22, (rand() - 0.5) * 0.06);
      p.lifetime = 0.9 + rand() * 0.8;
      p.size0 = 0.018;
      p.size1 = 0.1 + rand() * 0.08;
      p.color0.setRGB(0.78, 0.77, 0.75);
      p.color1.setRGB(0.72, 0.72, 0.72);
      p.alpha0 = Math.min(0.2, 0.08 * heat);
      p.alpha1 = 0;
      p.gravity = -0.5;
      p.drag = 1.2;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.2;
      p.sprite = SPRITE.wisp;
      p.turbulence = 0.3;
      p.lit = 1;
      this.particles.spawn(p);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Impacts                                                           */
  /* ---------------------------------------------------------------- */

  private impact(request: ImpactRequest): void {
    if (request.kind === "explosion") {
      this.explosion(request.point, Math.max(0.15, Math.min(1, request.energy)));
      return;
    }
    if (request.kind === "blood" || request.kind === "blood-headshot") {
      this.fleshHit(request);
      return;
    }
    const surface = request.surface;
    const energy = Math.max(0.15, Math.min(1, request.energy));
    _tmpColor.setHex(SURFACE_PROFILES[surface].debrisColor);
    switch (surface) {
      case "metal":
      case "thin-metal":
        this.metalHit(request, energy);
        break;
      case "sand":
      case "gravel":
        this.looseHit(request, energy, surface === "gravel");
        break;
      case "glass":
        this.glassHit(request, energy);
        break;
      default:
        this.solidHit(request, energy, surface);
        break;
    }

    if (request.kind === "ricochet") {
      _tmpA.copy(request.incoming).reflect(request.normal).normalize();
      _tmpB.copy(request.point).addScaledVector(_tmpA, 40);
      this.tracers.add(request.point, _tmpB, 450, 0xffd277, false, 0.2);
      return;
    }

    if (this.quality.decals) {
      const isMetal = surface === "metal" || surface === "thin-metal";
      const tile =
        request.kind === "penetration-exit" ? DECAL.spall : decalIndexFor(surface);
      let size =
        (request.kind === "penetration-exit" ? 0.2 : 0.13) * (0.8 + energy * 0.4);
      let life = 30;
      if (isMetal) size *= 0.55;
      else if (surface === "sand") {
        size *= 1.7;
        life = 14;
      } else if (surface === "gravel") size *= 1.3;
      this.decals.add(request.point, request.normal, size, tile, life, 0.95);
    }
  }

  /** A short bright pop at the strike, held for exactly one frame. */
  private impactFlash(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    size: number,
    heat: number,
  ): void {
    const p = this.p();
    p.position.copy(point).addScaledVector(normal, 0.02);
    p.lifetime = this.oneFrame(0.035);
    p.size0 = size;
    p.size1 = size * 1.3;
    p.color0.setRGB(heat, heat * 0.72, heat * 0.4);
    p.color1.setRGB(heat * 0.3, heat * 0.12, heat * 0.03);
    p.alpha0 = 1;
    p.alpha1 = 0;
    p.drag = 0;
    p.rotation = this.rand() * 6.28;
    p.sprite = SPRITE.glow;
    p.additive = 1;
    this.particles.spawn(p);
  }

  private sparks(
    request: ImpactRequest,
    count: number,
    speed: number,
    life: number,
    hot: number,
    spread: number,
  ): void {
    const rand = this.rand;
    _tmpD.copy(request.incoming).reflect(request.normal).normalize();
    // Sparks skate off along the surface as much as they bounce.
    _tmpD.lerp(request.normal, 0.35).normalize();
    for (let i = 0; i < count; i += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.normal, 0.01);
      p.velocity
        .copy(_tmpD)
        .multiplyScalar(speed * (0.45 + rand() * 0.9))
        .add(
          _tmpA.set(
            (rand() - 0.5) * spread,
            (rand() - 0.5) * spread,
            (rand() - 0.5) * spread,
          ),
        );
      p.lifetime = this.oneFrame(life * (0.5 + rand() * 0.9));
      p.size0 = 0.014 + rand() * 0.008;
      p.size1 = 0.004;
      p.color0.setRGB(hot, hot * 0.6, hot * 0.16);
      p.color1.setRGB(hot * 0.22, hot * 0.035, hot * 0.003);
      p.alpha0 = 1;
      p.alpha1 = 0;
      p.gravity = 9.81;
      p.drag = 0.9;
      p.sprite = SPRITE.spark;
      p.additive = 1;
      p.stretch = 6.5;
      this.particles.spawn(p);
    }
  }

  private chips(
    request: ImpactRequest,
    count: number,
    speed: number,
    colour: THREE.Color,
    size: number,
  ): void {
    const rand = this.rand;
    for (let i = 0; i < count; i += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.normal, 0.01);
      p.velocity
        .copy(request.normal)
        .multiplyScalar(speed * (0.5 + rand()))
        .add(
          _tmpA.set((rand() - 0.5) * speed, rand() * speed * 0.5, (rand() - 0.5) * speed),
        );
      p.lifetime = 0.45 + rand() * 0.45;
      p.size0 = size * (0.6 + rand() * 0.8);
      p.size1 = p.size0 * 0.8;
      // Some chips show their pale broken face, some their weathered skin.
      const shade = rand() > 0.5 ? 0.95 : 0.5;
      p.color0.copy(colour).multiplyScalar(shade);
      p.color1.copy(colour).multiplyScalar(shade * 0.85);
      p.alpha0 = 1;
      p.alpha1 = 0.8;
      p.gravity = 12;
      p.drag = 0.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 16;
      p.sprite = SPRITE.debris;
      p.lit = 1;
      this.particles.spawn(p);
    }
  }

  /** Lit dust puffs that billow off the surface and settle. */
  private dustPuff(
    request: ImpactRequest,
    count: number,
    colour: THREE.Color,
    out: number,
    size0: number,
    size1: number,
    life: number,
    alpha: number,
  ): void {
    const rand = this.rand;
    for (let i = 0; i < count; i += 1) {
      const p = this.p();
      p.position
        .copy(request.point)
        .addScaledVector(request.normal, 0.03 + rand() * 0.04);
      p.velocity
        .copy(request.normal)
        .multiplyScalar(out * (0.5 + rand() * 0.9))
        .add(
          _tmpA.set(
            (rand() - 0.5) * out * 0.9,
            (rand() - 0.2) * out * 0.5,
            (rand() - 0.5) * out * 0.9,
          ),
        );
      p.lifetime = life * (0.75 + rand() * 0.5);
      p.size0 = size0 * (0.8 + rand() * 0.4);
      p.size1 = size1 * (0.75 + rand() * 0.5);
      p.color0.copy(colour).multiplyScalar(1.05);
      p.color1.copy(colour);
      p.alpha0 = alpha;
      p.alpha1 = 0;
      p.gravity = 0.35;
      p.drag = 3.2;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 0.9;
      p.sprite = rand() > 0.5 ? SPRITE.billow : SPRITE.wisp;
      p.turbulence = 0.16;
      p.lit = 1;
      this.soft(p, request.point, request.normal, size1 * 0.35);
      this.particles.spawn(p);
    }
  }

  /** Concrete, wood, rubber and the rest: grey puff, chips, a few sparks. */
  private solidHit(request: ImpactRequest, energy: number, surface: SurfaceType): void {
    const scale = this.quality.particleScale;
    const profile = SURFACE_PROFILES[surface];
    const isWood = surface === "wood";
    const soft = surface === "fabric" || surface === "rubber" || surface === "foliage";
    // A fast jet of powder straight out along the normal: the "pop".
    const rand = this.rand;
    const jets = Math.max(1, Math.round(2 * energy * scale));
    for (let i = 0; i < jets; i += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.normal, 0.02);
      p.velocity
        .copy(request.normal)
        .multiplyScalar(3 + rand() * 2.5)
        .addScaledVector(request.incoming, -0.8)
        .add(_tmpA.set((rand() - 0.5) * 0.8, rand() * 0.6, (rand() - 0.5) * 0.8));
      p.lifetime = 0.32 + rand() * 0.18;
      p.size0 = 0.03;
      p.size1 = 0.16;
      p.color0.copy(_tmpColor).multiplyScalar(1.1);
      p.color1.copy(_tmpColor);
      p.alpha0 = 0.7;
      p.alpha1 = 0;
      p.drag = 6;
      p.gravity = 1;
      p.sprite = SPRITE.plume;
      p.stretch = 1.4;
      p.lit = 1;
      this.soft(p, request.point, request.normal, 0.05);
      this.particles.spawn(p);
    }
    this.dustPuff(
      request,
      Math.max(1, Math.round((soft ? 2 : 4) * energy * scale)),
      _tmpColor,
      1.1,
      0.05,
      0.36,
      1.15,
      soft ? 0.32 : 0.5,
    );
    if (!soft) {
      this.chips(
        request,
        Math.round((isWood ? 5 : 7) * energy * scale),
        isWood ? 2.4 : 3.2,
        _tmpColor,
        isWood ? 0.014 : 0.011,
      );
    }
    const sparkCount = Math.round(
      Math.max(profile.sparkiness * 12, soft || isWood ? 0 : 2) * energy * scale,
    );
    if (sparkCount > 0) {
      this.sparks(request, sparkCount, 4.5, 0.16, 10, 2.2);
      this.impactFlash(request.point, request.normal, 0.09, 6);
    }
  }

  /** Metal: a white flash, a shower of streaking sparks, a glowing dent. */
  private metalHit(request: ImpactRequest, energy: number): void {
    const scale = this.quality.particleScale;
    const rand = this.rand;
    this.impactFlash(request.point, request.normal, 0.16 + energy * 0.08, 22);
    this.sparks(request, Math.max(4, Math.round(16 * energy * scale)), 11, 0.3, 18, 5);
    // A few heavier sparks that fall and burn longer.
    this.sparks(request, Math.max(1, Math.round(4 * energy * scale)), 4, 0.7, 9, 2.5);
    // The dent glows for a moment and cools.
    const ember = this.p();
    ember.position.copy(request.point).addScaledVector(request.normal, 0.006);
    ember.lifetime = 0.55 + rand() * 0.25;
    ember.size0 = 0.03;
    ember.size1 = 0.018;
    ember.color0.setRGB(6, 2.2, 0.4);
    ember.color1.setRGB(0.6, 0.08, 0.01);
    ember.alpha0 = 1;
    ember.alpha1 = 0;
    ember.drag = 0;
    ember.sprite = SPRITE.glow;
    ember.additive = 1;
    this.particles.spawn(ember);
    // A small grey wisp of burnt paint.
    _tmpColor2.setRGB(0.42, 0.41, 0.4);
    this.dustPuff(request, 1, _tmpColor2, 0.5, 0.04, 0.2, 0.7, 0.3);
  }

  /** Sand and gravel: a tall dusty spurt, a lingering cloud, falling grains. */
  private looseHit(request: ImpactRequest, energy: number, gravel: boolean): void {
    const scale = this.quality.particleScale;
    const rand = this.rand;
    // The spurt leaves mostly upward, leaning along the round's path.
    _tmpD
      .copy(request.normal)
      .multiplyScalar(1)
      .addScaledVector(request.incoming, 0.35)
      .normalize();
    const plumes = Math.max(2, Math.round((gravel ? 3 : 4) * energy * scale));
    for (let i = 0; i < plumes; i += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.normal, 0.02);
      p.velocity
        .copy(_tmpD)
        .multiplyScalar((gravel ? 2.8 : 3.6) + rand() * 2.6)
        .add(_tmpA.set((rand() - 0.5) * 0.9, 0, (rand() - 0.5) * 0.9));
      p.lifetime = 0.85 + rand() * 0.5;
      p.size0 = 0.07;
      p.size1 = 0.32 + rand() * 0.14;
      p.color0.copy(_tmpColor).multiplyScalar(1.08);
      p.color1.copy(_tmpColor);
      p.alpha0 = 0.75;
      p.alpha1 = 0;
      p.drag = 3.1;
      p.gravity = 3.2;
      p.rotation = (rand() - 0.5) * 0.3;
      p.sprite = SPRITE.plume;
      p.stretch = 1.6;
      p.turbulence = 0.08;
      p.lit = 1;
      this.soft(p, request.point, request.normal, 0.12);
      this.particles.spawn(p);
    }
    // The cloud the spurt leaves behind, drifting and settling.
    this.dustPuff(
      request,
      Math.max(2, Math.round(5 * energy * scale)),
      _tmpColor,
      0.8,
      0.12,
      0.75,
      2.1,
      0.42,
    );
    // Grains thrown up and falling back.
    for (let i = 0; i < Math.round((gravel ? 10 : 8) * energy * scale); i += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.normal, 0.02);
      p.velocity
        .copy(_tmpD)
        .multiplyScalar(2 + rand() * 4)
        .add(_tmpA.set((rand() - 0.5) * 1.8, rand() * 1.2, (rand() - 0.5) * 1.8));
      p.lifetime = 0.6 + rand() * 0.4;
      p.size0 = gravel ? 0.016 : 0.009;
      p.size1 = p.size0;
      p.color0.copy(_tmpColor).multiplyScalar(0.7);
      p.color1.copy(_tmpColor).multiplyScalar(0.6);
      p.alpha0 = 1;
      p.alpha1 = 0.6;
      p.gravity = 9.81;
      p.drag = 0.3;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 12;
      p.sprite = SPRITE.debris;
      p.lit = 1;
      this.particles.spawn(p);
    }
  }

  private glassHit(request: ImpactRequest, energy: number): void {
    const scale = this.quality.particleScale;
    this.impactFlash(request.point, request.normal, 0.06, 4);
    _tmpColor2.setRGB(1.1, 1.15, 1.2);
    this.chips(request, Math.round(8 * energy * scale), 3, _tmpColor2, 0.01);
    this.dustPuff(request, 1, _tmpColor, 0.6, 0.04, 0.18, 0.6, 0.22);
  }

  /** Flesh: a dark-red mist puff and a few fine droplets. Not gore. */
  private fleshHit(request: ImpactRequest): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    const headshot = request.kind === "blood-headshot";
    const mists = headshot ? 3 : 2;
    for (let m = 0; m < mists; m += 1) {
      const p = this.p();
      p.position.copy(request.point).addScaledVector(request.incoming, 0.04 * m);
      p.velocity
        .copy(request.incoming)
        .multiplyScalar(0.8 + rand() * 0.9)
        .add(_tmpA.set((rand() - 0.5) * 0.5, (rand() - 0.3) * 0.4, (rand() - 0.5) * 0.5));
      p.lifetime = 0.45 + rand() * 0.3;
      p.size0 = headshot ? 0.1 : 0.07;
      p.size1 = (headshot ? 0.5 : 0.36) * (0.8 + rand() * 0.4);
      p.color0.setRGB(0.3, 0.025, 0.02);
      p.color1.setRGB(0.22, 0.02, 0.018);
      p.alpha0 = headshot ? 0.6 : 0.48;
      p.alpha1 = 0;
      p.gravity = 0.8;
      p.drag = 3.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.5;
      p.sprite = SPRITE.billow;
      p.turbulence = 0.2;
      p.lit = 1;
      this.particles.spawn(p);
    }
    const drops = Math.round((headshot ? 10 : 6) * scale);
    for (let i = 0; i < drops; i += 1) {
      const p = this.p();
      p.position.copy(request.point);
      p.velocity
        .copy(request.incoming)
        .multiplyScalar(1.5 + rand() * 3)
        .add(_tmpA.set((rand() - 0.5) * 2.4, (rand() - 0.3) * 2, (rand() - 0.5) * 2.4));
      p.lifetime = 0.3 + rand() * 0.3;
      p.size0 = 0.012 + rand() * 0.012;
      p.size1 = 0.008;
      p.color0.setRGB(0.26, 0.02, 0.02);
      p.color1.setRGB(0.16, 0.012, 0.01);
      p.alpha0 = 0.9;
      p.alpha1 = 0;
      p.gravity = 9.81;
      p.drag = 1.2;
      p.sprite = SPRITE.blood;
      p.stretch = 0.6;
      p.lit = 1;
      this.particles.spawn(p);
    }
  }

  explosion(point: THREE.Vector3, energy: number): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    _tmpD.set(0, 1, 0);
    // Fireball.
    for (let i = 0; i < Math.round(10 * scale); i += 1) {
      const p = this.p();
      p.position
        .copy(point)
        .add(_tmpA.set((rand() - 0.5) * 0.6, rand() * 0.5, (rand() - 0.5) * 0.6));
      p.velocity.set((rand() - 0.5) * 7, 1.5 + rand() * 5, (rand() - 0.5) * 7);
      p.lifetime = 0.32 + rand() * 0.28;
      p.size0 = 0.7 * energy;
      p.size1 = 3.4 * energy;
      p.color0.setRGB(14, 6, 1.4);
      p.color1.setRGB(1.2, 0.35, 0.08);
      p.alpha0 = 1;
      p.alpha1 = 0;
      p.gravity = -2.5;
      p.drag = 2.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 3;
      p.sprite = SPRITE.fire;
      p.additive = 1;
      p.turbulence = 0.6;
      this.particles.spawn(p);
    }
    // Shockwave ring on the ground.
    const ring = this.p();
    ring.position.copy(point);
    ring.velocity.set(0, 0.4, 0);
    ring.lifetime = 0.45;
    ring.size0 = 0.6;
    ring.size1 = 11 * energy;
    ring.color0.setRGB(3.2, 2.6, 1.9);
    ring.color1.setRGB(0.5, 0.44, 0.35);
    ring.alpha0 = 0.8;
    ring.alpha1 = 0;
    ring.drag = 0;
    ring.sprite = SPRITE.ring;
    ring.additive = 1;
    this.particles.spawn(ring);
    // Dirt column and drifting smoke.
    for (let i = 0; i < Math.round(24 * scale); i += 1) {
      const p = this.p();
      p.position.copy(point);
      const angle = rand() * Math.PI * 2;
      const radial = 2 + rand() * 9;
      p.velocity.set(Math.cos(angle) * radial, 3 + rand() * 11, Math.sin(angle) * radial);
      p.lifetime = 1.6 + rand() * 2.6;
      p.size0 = 0.4;
      p.size1 = 3.5 + rand() * 4;
      p.color0.setRGB(0.42, 0.38, 0.32);
      p.color1.setRGB(0.55, 0.5, 0.44);
      p.alpha0 = 0.55;
      p.alpha1 = 0;
      p.gravity = 1.4;
      p.drag = 1.1;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.2;
      p.sprite = SPRITE.billow;
      p.turbulence = 0.7;
      p.lit = 1;
      this.soft(p, point, _tmpD, 1.2);
      this.particles.spawn(p);
    }
    // Ejecta.
    for (let i = 0; i < Math.round(22 * scale); i += 1) {
      const p = this.p();
      p.position.copy(point);
      const angle = rand() * Math.PI * 2;
      const radial = 3 + rand() * 14;
      p.velocity.set(Math.cos(angle) * radial, 5 + rand() * 13, Math.sin(angle) * radial);
      p.lifetime = 1.2 + rand() * 1.2;
      p.size0 = 0.05 + rand() * 0.09;
      p.size1 = 0.04;
      p.color0.setRGB(0.22, 0.19, 0.15);
      p.color1.setRGB(0.16, 0.14, 0.11);
      p.alpha0 = 1;
      p.alpha1 = 0.7;
      p.gravity = 15;
      p.drag = 0.3;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 14;
      p.sprite = SPRITE.debris;
      p.stretch = 0.4;
      p.lit = 1;
      this.particles.spawn(p);
    }
    if (this.quality.decals) {
      this.decals.add(point, _tmpD, 3.2 * energy, DECAL.scorch, 60, 0.85);
    }
    this.offerWorldLight(point, _tmpD, 6 * energy);
  }

  /** Dust kicked up by feet, sliding and landings. */
  groundDust(
    point: THREE.Vector3,
    surface: SurfaceType,
    strength: number,
    spread = 0.35,
  ): void {
    if (surface === "concrete" || surface === "metal") strength *= 0.35;
    const count = Math.round(3 * strength * this.quality.particleScale);
    if (count <= 0) return;
    const rand = this.rand;
    const colour = _tmpColor.setHex(SURFACE_PROFILES[surface].debrisColor);
    _tmpD.set(0, 1, 0);
    for (let i = 0; i < count; i += 1) {
      const p = this.p();
      p.position
        .copy(point)
        .add(_tmpA.set((rand() - 0.5) * spread, 0.04, (rand() - 0.5) * spread));
      p.velocity.set((rand() - 0.5) * 0.8, 0.25 + rand() * 0.5, (rand() - 0.5) * 0.8);
      p.lifetime = 0.7 + rand() * 0.9;
      p.size0 = 0.09;
      p.size1 = 0.5 + rand() * 0.5;
      p.color0.copy(colour);
      p.color1.copy(colour).multiplyScalar(0.92);
      p.alpha0 = 0.16 * strength;
      p.alpha1 = 0;
      p.gravity = 0.4;
      p.drag = 2.6;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.4;
      p.sprite = SPRITE.wisp;
      p.turbulence = 0.4;
      p.lit = 1;
      this.soft(p, point, _tmpD, 0.2);
      this.particles.spawn(p);
    }
  }

  /** Free-form access for systems that need a bespoke burst. */
  emit(sprite: SpriteId, configure: (p: SpawnParams) => void): void {
    const p = this.p();
    p.sprite = sprite;
    configure(p);
    this.particles.spawn(p);
  }

  /* ---------------------------------------------------------------- */
  /* Third-person shooters                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Bots fire through the weapon runtime, which knows nothing about effects;
   * a new `lastFireTime` is the shot. The muzzle sits forward of the eye
   * along the aim, at the right shoulder and a little low, which is where
   * the held weapon puts it.
   */
  private scanShooters(): void {
    for (const actor of game.actors) {
      if (actor.isPlayer) continue;
      const last = this.lastFire.get(actor.id);
      if (last === actor.lastFireTime) continue;
      this.lastFire.set(actor.id, actor.lastFireTime);
      if (last === undefined || !actor.alive) continue;
      if (game.time - actor.lastFireTime > 0.12) continue;
      this.botMuzzle(actor.id, _tmpA);
      _tmpB.copy(actor.aimDir).normalize();
      const weapon = actor.weaponId;
      const calibre = /lmg|sniper|marksman|pkm|m249|rpk/i.test(weapon) ? 0.32 : 0.26;
      this.worldShot(_tmpA, _tmpB, calibre, false, 1.7);
    }
  }

  private readonly botEye = new THREE.Vector3();
  private readonly botRight = new THREE.Vector3();

  private botMuzzle(id: number, out: THREE.Vector3): THREE.Vector3 {
    const actor = game.actors.find((a) => a.id === id);
    if (!actor) return out.set(0, 0, 0);
    eyePosition(actor, this.botEye);
    this.botRight.crossVectors(actor.aimDir, THREE.Object3D.DEFAULT_UP);
    if (this.botRight.lengthSq() < 1e-6) this.botRight.set(1, 0, 0);
    this.botRight.normalize();
    return out
      .copy(this.botEye)
      .addScaledVector(actor.aimDir, 0.74)
      .addScaledVector(this.botRight, 0.12)
      .addScaledVector(THREE.Object3D.DEFAULT_UP, -0.15);
  }

  /** A remote tracer starts at the eye; move it onto that shooter's muzzle. */
  private tracerOrigin(from: THREE.Vector3, out: THREE.Vector3): boolean {
    for (const actor of game.actors) {
      if (actor.isPlayer) continue;
      eyePosition(actor, this.botEye);
      if (this.botEye.distanceToSquared(from) < 1e-4) {
        this.botMuzzle(actor.id, out);
        return true;
      }
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                             */
  /* ---------------------------------------------------------------- */

  private updateLighting(): void {
    const day = THREE.MathUtils.clamp(sunState.dayFactor, 0, 1);
    const l = this.lighting;
    if (day > 0.5) l.sunDirection.copy(sunState.direction);
    else l.sunDirection.copy(sunState.moonDirection);
    // Lambert radiance off a white surface: E / pi, with the sun's elevation
    // already in its intensity.
    const sun = Math.max(0, sunState.intensity) / Math.PI;
    l.sunColor
      .copy(SUN_TINT)
      .multiplyScalar(sun * day)
      .add(_tmpColor.copy(MOON_TINT).multiplyScalar((0.5 / Math.PI) * (1 - day)));
    l.skyColor.lerpColors(SKY_NIGHT, SKY_DAY, day);
    l.groundColor.lerpColors(GROUND_NIGHT, GROUND_DAY, day);
    this.decals.setSun(l.sunDirection, 0.35 + day * 0.4);
  }

  update(dt: number, world: CollisionWorld | null): void {
    this.frameDt = Math.max(1 / 240, Math.min(0.1, dt));
    // Clocks first: everything born below is drawn at age zero this frame.
    this.particles.advance(dt);
    this.tracers.advance(dt);
    this.updateLighting();
    this.worldLightEnergy = 0;
    this.fpShotThisFrame = false;

    if (this.pendingShot && this.binding) this.resolveFirstPersonShot(this.pendingShot);
    this.pendingShot = null;
    if (this.binding) {
      for (const eject of this.pendingEjects) this.resolveEject(eject);
    }
    this.pendingEjects.length = 0;
    if (this.pendingHeatAnchor && this.binding) {
      const anchor = this.pendingHeatAnchor;
      anchor.updateWorldMatrix(true, false);
      anchor.getWorldPosition(_tmpA);
      viewmodelToWorld(_tmpA, this.binding.camera, this.binding.worldCamera, _tmpB);
      _tmpA.set(0, 0, 0.3).applyMatrix4(anchor.matrixWorld);
      viewmodelToWorld(_tmpA, this.binding.camera, this.binding.worldCamera, _tmpC);
      this.emitBarrelWisps(_tmpB, _tmpC, this.pendingHeat);
    }
    this.pendingHeatAnchor = null;

    this.scanShooters();

    // Drain the queues the simulation filled this frame.
    for (const request of game.impactQueue) this.impact(request);
    game.impactQueue.length = 0;
    for (const tracer of game.tracerQueue) {
      if (tracer.local && this.fpShotThisFrame) {
        // From the muzzle the player can see, not from behind his eyes.
        this.tracers.add(
          this.fpMuzzleWorld,
          tracer.to,
          tracer.speed,
          tracer.color,
          true,
          0.6,
        );
      } else if (!tracer.local && this.tracerOrigin(tracer.from, _tmpA)) {
        this.tracers.add(_tmpA, tracer.to, tracer.speed, tracer.color, false, 0.5);
      } else {
        this.tracers.add(
          tracer.from,
          tracer.to,
          tracer.speed,
          tracer.color,
          tracer.local,
        );
      }
    }
    game.tracerQueue.length = 0;

    // Flashes: this frame's are at full strength, last frame's become ghosts.
    this.fpFlash.update(dt, this.rand);
    this.tpFlash.update(dt, this.rand);
    this.fpFlashEnergy = this.fpFlash.peak();
    if (this.fpAnchor && this.binding && this.fpFlashEnergy > 0) {
      const anchor = this.fpAnchor;
      anchor.updateWorldMatrix(true, false);
      this.fpFlash.mesh.matrix.copy(anchor.matrixWorld);
      this.fpFlash.mesh.matrixWorld.copy(anchor.matrixWorld);
      // On the hands and receiver: just ahead of and above the crown.
      _tmpA.set(0, 0.03, -0.06).applyMatrix4(anchor.matrixWorld);
      this.stageLight.position.copy(_tmpA);
      this.stageLight.intensity = 1.5 * this.fpFlashEnergy;
    } else {
      this.stageLight.intensity = 0;
    }

    // One light in the world, on the strongest flash this frame or the last.
    const envelope = Math.max(this.fpFlashEnergy, this.tpFlash.peak() * 0.6);
    if (this.worldLightOn) {
      if (this.worldLightEnergy > 0) this.worldLight.position.copy(this.worldLightPos);
      const energy = envelope > 0 ? envelope : 0;
      this.worldLight.intensity = 10 * energy;
    }
    // Smoke near the flash catches it.
    if (envelope > 0) {
      this.lighting.flashPosition.copy(this.worldLight.position);
      this.lighting.flashReach = 2.2;
      this.lighting.flashColor.copy(FLASH_LIGHT).multiplyScalar(1.6 * envelope);
    } else {
      this.lighting.flashReach = 0;
    }
    this.particles.setLighting(this.lighting);

    this.particles.flush();
    this.tracers.flush();
    this.decals.update(dt);
    this.casings.update(dt, world);
  }

  dispose(): void {
    this.bindViewmodel(null, null, null);
    this.particles.dispose();
    this.decals.dispose();
    this.tracers.dispose();
    this.casings.dispose();
    this.fpFlash.dispose();
    this.tpFlash.dispose();
    this.worldLight.dispose();
    this.stageLight.dispose();
  }
}
