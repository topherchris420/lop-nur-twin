import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { queueSound } from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";

/**
 * Ejected brass: a lathed case that leaves the port on an arc up and to the
 * right, tumbles end over end so its highlight travels, strikes the ground,
 * hops once and settles lying on its side.
 *
 * Pooled and instanced: one draw for every case in the world.
 */

interface Casing {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  rotation: THREE.Quaternion;
  life: number;
  bounces: number;
  resting: boolean;
  active: boolean;
}

const CASE_RADIUS = 0.0048 * 1.15;

const _step = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _lie = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();

export class CasingRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly casings: Casing[] = [];
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly rand = mulberry32(0xc51a9);

  constructor(capacity = 64) {
    // A rifle case: rim, extractor groove, body, shoulder, neck. About 15%
    // over a real 5.56 so it reads at the edge of a first-person frame.
    const profile: [number, number][] = [
      [0.0, -0.019],
      [0.0048, -0.019],
      [0.0048, -0.0174],
      [0.0037, -0.0166],
      [0.0037, -0.0152],
      [0.0045, -0.0142],
      [0.0043, 0.009],
      [0.0031, 0.0128],
      [0.0029, 0.019],
      [0.0024, 0.019],
      [0.0024, 0.017],
    ];
    const points = profile.map(
      ([r, y]) => new THREE.Vector2(Math.max(1e-5, r * 1.15), y * 1.15),
    );
    const geometry = new THREE.LatheGeometry(points, 20);
    // Cartridge brass: a warm, fairly polished conductor. Dark brass reads as
    // mud at this size; the highlight is the whole effect.
    const material = new THREE.MeshStandardMaterial({
      name: "casing-brass-metal",
      color: new THREE.Color(0.9, 0.7, 0.4),
      metalness: 1,
      roughness: 0.3,
      envMapIntensity: 1.1,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = "fx-casings";
    this.mesh.userData["noCollide"] = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i += 1) {
      this.casings.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        life: 0,
        bounces: 0,
        resting: false,
        active: false,
      });
      this.dummy.position.set(0, -9999, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  /**
   * `direction` is the ejection direction (unit), `orientation` the weapon's
   * orientation at the port so the case leaves lying across the receiver.
   */
  eject(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    rand: () => number,
    linearVelocity?: THREE.Vector3,
    orientation?: THREE.Quaternion,
  ): void {
    const casing = this.casings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.casings.length;
    casing.position.copy(position);
    casing.velocity
      .copy(direction)
      .multiplyScalar(2.6 + rand() * 1.1)
      .add(_dir.set((rand() - 0.5) * 0.35, 0.9 + rand() * 0.6, (rand() - 0.5) * 0.35));
    if (linearVelocity) casing.velocity.addScaledVector(linearVelocity, 0.85);
    // End over end about the case's short axis, plus a little wobble: slow
    // enough that the highlight travels instead of blurring.
    casing.spin.set(14 + rand() * 14, (rand() - 0.5) * 6, (rand() - 0.5) * 10);
    if (orientation) {
      // The case lies across the bore, mouth forward: its lathe axis (+Y)
      // along the weapon's -Z.
      casing.rotation
        .copy(orientation)
        .multiply(_quat.setFromEuler(_euler.set(-Math.PI / 2, 0, 0)));
    } else {
      casing.rotation.identity();
    }
    casing.life = 0;
    casing.bounces = 0;
    casing.resting = false;
    casing.active = true;
  }

  update(dt: number, world: CollisionWorld | null): void {
    let dirty = false;
    for (let i = 0; i < this.casings.length; i += 1) {
      const casing = this.casings[i]!;
      if (!casing.active) continue;
      casing.life += dt;
      if (casing.life > 12) {
        casing.active = false;
        this.dummy.position.set(0, -9999, 0);
        this.dummy.quaternion.identity();
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        dirty = true;
        continue;
      }
      if (casing.resting) continue;
      dirty = true;
      casing.velocity.y -= 9.81 * dt;
      // A light case feels the air.
      casing.velocity.multiplyScalar(Math.max(0, 1 - 0.35 * dt));
      _step.copy(casing.velocity).multiplyScalar(dt);
      const stepLen = _step.length();
      const ground = world ? world.groundAt(casing.position.x, casing.position.z) : 0;

      let hitNormal: THREE.Vector3 | null = null;
      if (world && stepLen > 0.005) {
        _dir.copy(casing.velocity).normalize();
        const wallHit = world.raycast(casing.position, _dir, stepLen + 0.015, 0x07);
        if (wallHit && wallHit.distance <= stepLen + 0.01) {
          casing.position.copy(wallHit.point).addScaledVector(wallHit.normal, 0.008);
          hitNormal = wallHit.normal;
        }
      }
      if (!hitNormal) {
        casing.position.add(_step);
        if (casing.position.y <= ground + CASE_RADIUS) {
          casing.position.y = ground + CASE_RADIUS;
          hitNormal = _up;
        }
      }

      if (hitNormal) {
        const speed = casing.velocity.length();
        if (speed > 0.6 && casing.bounces < 2) {
          // One real hop and a skitter, then it lies down.
          casing.bounces += 1;
          casing.velocity
            .reflect(hitNormal)
            .multiplyScalar(casing.bounces === 1 ? 0.38 : 0.2);
          casing.spin.set(
            (this.rand() - 0.5) * 30,
            (this.rand() - 0.5) * 12,
            (this.rand() - 0.5) * 20,
          );
          queueSound({
            id: "shell-drop",
            position: casing.position.clone(),
            gain: casing.bounces === 1 ? 0.5 : 0.25,
            pitch: 0.92 + this.rand() * 0.22,
          });
        } else if (hitNormal === _up) {
          // Settle on its side at a random heading: a case never stands up.
          casing.resting = true;
          casing.velocity.set(0, 0, 0);
          _lie.setFromAxisAngle(_dir.set(0, 0, 1), Math.PI / 2);
          _yaw.setFromAxisAngle(_up, this.rand() * Math.PI * 2);
          casing.rotation.copy(_yaw).multiply(_lie);
        } else {
          casing.velocity.multiplyScalar(0.2);
        }
      }

      if (!casing.resting && casing.spin.lengthSq() > 1e-5) {
        _quat.setFromEuler(
          _euler.set(casing.spin.x * dt, casing.spin.y * dt, casing.spin.z * dt),
        );
        casing.rotation.multiply(_quat);
      }
      this.dummy.position.copy(casing.position);
      this.dummy.quaternion.copy(casing.rotation);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Put a case in flight with an exact state (a hand-off from the stage). */
  launch(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    rotation: THREE.Quaternion,
    spin: THREE.Vector3,
  ): void {
    const casing = this.casings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.casings.length;
    casing.position.copy(position);
    casing.velocity.copy(velocity);
    casing.rotation.copy(rotation);
    casing.spin.copy(spin);
    casing.life = 0;
    casing.bounces = 0;
    casing.resting = false;
    casing.active = true;
  }

  dispose(): void {
    // Releases the instanceMatrix/instanceColor buffers; the geometry's
    // dispose does not cover them.
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** A first-person case in flight, in the weapon stage's space. */
export interface StageCasing {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  spin: THREE.Vector3;
  life: number;
  active: boolean;
}

/**
 * First-person brass flies in the weapon's own pass for its first instants.
 *
 * Cases leave the port beside the receiver, and the receiver is drawn after
 * the world with the depth cleared, so a world-space case is hidden behind
 * the very gun that threw it. Shooters draw their own brass with the weapon;
 * so does this, under the world's gravity carried into the stage, until the
 * case has cleared the frame and is handed to the world simulation to land.
 */
export class StageCasings {
  readonly mesh: THREE.InstancedMesh;
  private readonly casings: StageCasing[] = [];
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(
    source: CasingRenderer,
    capacity = 8,
    private readonly handoffAge = 0.32,
  ) {
    this.mesh = new THREE.InstancedMesh(
      source.mesh.geometry,
      source.mesh.material,
      capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.name = "fx-casings-fp";
    this.mesh.userData["noCollide"] = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.position.set(0, -9999, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i += 1) {
      this.casings.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        spin: new THREE.Vector3(),
        life: 0,
        active: false,
      });
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  /** `up` is the world's up in stage space. */
  eject(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    up: THREE.Vector3,
    orientation: THREE.Quaternion,
    rand: () => number,
  ): void {
    const casing = this.casings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.casings.length;
    casing.position.copy(position);
    casing.velocity
      .copy(direction)
      .multiplyScalar(1.9 + rand() * 0.8)
      .addScaledVector(up, 0.9 + rand() * 0.5);
    casing.spin.set(16 + rand() * 12, (rand() - 0.5) * 6, (rand() - 0.5) * 10);
    casing.rotation
      .copy(orientation)
      .multiply(_quat.setFromEuler(_euler.set(-Math.PI / 2, 0, 0)));
    casing.life = 0;
    casing.active = true;
  }

  update(dt: number, up: THREE.Vector3, handoff: (casing: StageCasing) => void): void {
    let dirty = false;
    for (let i = 0; i < this.casings.length; i += 1) {
      const casing = this.casings[i]!;
      if (!casing.active) continue;
      dirty = true;
      casing.life += dt;
      if (casing.life > this.handoffAge) {
        casing.active = false;
        handoff(casing);
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      casing.velocity.addScaledVector(up, -9.81 * dt);
      casing.position.addScaledVector(casing.velocity, dt);
      _quat.setFromEuler(
        _euler.set(casing.spin.x * dt, casing.spin.y * dt, casing.spin.z * dt),
      );
      casing.rotation.multiply(_quat);
      _lie.copy(casing.rotation);
      this.mesh.setMatrixAt(i, _matrix.compose(casing.position, _lie, _unit));
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    // Geometry and material belong to the world renderer.
    this.mesh.dispose();
  }
}

const _matrix = new THREE.Matrix4();
const _unit = new THREE.Vector3(1, 1, 1);
