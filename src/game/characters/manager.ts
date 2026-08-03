import * as THREE from "three";
import {
  HUMAN_METRICS,
  type HitRegion,
  type Team,
} from "../core/types";
import { LAYER } from "../core/types";
import { game, type Actor } from "../core/gameState";
import {
  makeCollider,
  updateCollider,
  type Collider,
  type CollisionWorld,
} from "../physics/collisionWorld";
import { CharacterAnimator } from "./animation";
import { buildSoldier, type SoldierModel } from "./soldier";
import { buildHeldWeapon, type HeldWeaponModel } from "./heldWeapon";
import { B } from "./rig";

/**
 * Binds soldier models, animators and hitboxes to actors.
 *
 * Hitboxes are driven from the actor's capsule rather than from bones. Bone
 * matrices are the more accurate source, but they are also a frame behind the
 * simulation and cost a world-matrix walk per character per frame; against
 * bots that move at 5 m/s the difference in where a shot registers is smaller
 * than the aim error the AI applies to itself, and the stance-scaled boxes
 * still give a real head, chest, stomach and legs to hit.
 */

interface Bound {
  actor: Actor;
  model: SoldierModel;
  weapon: HeldWeaponModel;
  /** The weapon id the held model was built for, so swaps rebuild it. */
  weaponId: string;
  animator: CharacterAnimator;
  colliders: Collider[];
  regions: HitRegion[];
  /** Frames since this character was last fully updated. */
  skip: number;
}

interface RegionSpec {
  region: HitRegion;
  /** Fraction of stance height at the box centre. */
  centre: number;
  /** Half extents in metres, before stance scaling. */
  half: [number, number, number];
}

const REGION_SPECS: readonly RegionSpec[] = [
  { region: "head", centre: 0.935, half: [0.105, 0.115, 0.115] },
  { region: "neck", centre: 0.855, half: [0.07, 0.04, 0.07] },
  { region: "chest", centre: 0.735, half: [0.19, 0.135, 0.13] },
  { region: "stomach", centre: 0.575, half: [0.165, 0.13, 0.115] },
  { region: "arm", centre: 0.72, half: [0.265, 0.12, 0.1] },
  { region: "leg", centre: 0.29, half: [0.15, 0.27, 0.12] },
  { region: "foot", centre: 0.045, half: [0.15, 0.06, 0.16] },
];

const _centre = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _cameraFlat = new THREE.Vector3();

export class CharacterManager {
  readonly group = new THREE.Group();
  private readonly bound = new Map<number, Bound>();
  private readonly world: CollisionWorld;
  private frame = 0;

  constructor(world: CollisionWorld) {
    this.world = world;
    this.group.name = "characters";
    this.group.userData["noCollide"] = true;
  }

  /** Attach a model and hitboxes to an actor. Idempotent. */
  add(actor: Actor, team: Team = actor.team): void {
    if (this.bound.has(actor.id)) return;
    const model = buildSoldier({ team, seed: actor.seed });
    model.group.position.copy(actor.position);
    this.group.add(model.group);

    const colliders: Collider[] = [];
    const regions: HitRegion[] = [];
    for (const spec of REGION_SPECS) {
      const collider = makeCollider(
        _centre.set(0, -1000, 0),
        new THREE.Vector3(...spec.half),
        _quat.identity(),
        LAYER.character,
        "flesh",
        actor.id,
        spec.region,
      );
      this.world.addDynamic(collider);
      colliders.push(collider);
      regions.push(spec.region);
    }

    // Parent the weapon to the rig's dedicated weapon bone, which the
    // animation layer already keeps in the right hand.
    const weapon = buildHeldWeapon(actor.weaponId);
    model.bones[B.weapon]!.add(weapon.mesh);

    const animator = new CharacterAnimator();
    animator.reset(actor);
    this.bound.set(actor.id, {
      actor,
      model,
      weapon,
      weaponId: actor.weaponId,
      animator,
      colliders,
      regions,
      skip: 0,
    });
  }

  remove(actorId: number): void {
    const entry = this.bound.get(actorId);
    if (!entry) return;
    for (const collider of entry.colliders) this.world.removeDynamic(collider);
    this.group.remove(entry.model.group);
    entry.weapon.mesh.removeFromParent();
    entry.weapon.dispose();
    entry.model.dispose();
    this.bound.delete(actorId);
  }

  /** Notify the animator that an actor was hit, for the flinch layer. */
  reportHit(actorId: number, lateralSign: number): void {
    this.bound.get(actorId)?.animator.hit(lateralSign);
  }

  /** Notify the animator that an actor fired. */
  reportFire(actorId: number): void {
    this.bound.get(actorId)?.animator.recoil();
  }

  update(dt: number, camera: THREE.Camera): void {
    this.frame += 1;
    _cameraFlat.copy(camera.position);

    for (const entry of this.bound.values()) {
      const actor = entry.actor;
      const distance = _cameraFlat.distanceTo(actor.position);

      // Distance-scaled update rate: full rate up close, every other frame at
      // medium range, every fourth beyond that. Hitboxes always follow the
      // simulation, because shooting a character must never lag its position.
      const stride = distance < 30 ? 1 : distance < 80 ? 2 : 4;
      const shouldAnimate = this.frame % stride === 0;

      this.updateHitboxes(entry);

      if (!shouldAnimate) continue;
      const step = dt * stride;

      // Rebuild the held weapon if the actor swapped to a different class.
      if (entry.weaponId !== actor.weaponId) {
        entry.weapon.mesh.removeFromParent();
        entry.weapon.dispose();
        entry.weapon = buildHeldWeapon(actor.weaponId);
        entry.weaponId = actor.weaponId;
        entry.model.bones[B.weapon]!.add(entry.weapon.mesh);
      }
      // A dead actor drops the weapon from view rather than clipping it
      // through the ground as the body folds.
      entry.weapon.mesh.visible = actor.alive;

      entry.model.group.position.copy(actor.position);
      entry.animator.update(entry.model.bones, entry.model.group, actor, step);
      entry.model.bones[B.root]!.updateMatrixWorld(true);

      // Shadows are the most expensive thing a character does; only the ones
      // close enough for their shadow to be legible cast at all.
      const cast = distance < 60 && actor.alive;
      if (entry.model.mesh.castShadow !== cast) entry.model.mesh.castShadow = cast;
      entry.model.group.visible = distance < 420;
    }
  }

  private updateHitboxes(entry: Bound): void {
    const actor = entry.actor;
    const height = HUMAN_METRICS.colliderHeight[actor.stance];
    _euler.set(0, actor.yaw, 0);
    _quat.setFromEuler(_euler);

    for (let i = 0; i < entry.colliders.length; i += 1) {
      const spec = REGION_SPECS[i]!;
      const collider = entry.colliders[i]!;
      if (!actor.alive) {
        // Park dead actors' boxes far below the map rather than removing them,
        // so respawning does not churn the dynamic list.
        _centre.set(actor.position.x, -1000, actor.position.z);
        updateCollider(collider, _centre, _quat);
        continue;
      }
      _centre.set(
        actor.position.x,
        actor.position.y + spec.centre * height,
        actor.position.z,
      );
      updateCollider(collider, _centre, _quat);
    }
  }

  /** Total triangles across live characters, for the statistics readout. */
  get triangleCount(): number {
    let total = 0;
    for (const entry of this.bound.values()) {
      if (entry.model.group.visible) total += entry.model.triangleCount;
    }
    return total;
  }

  /** Bind every actor in the simulation that does not have a model yet. */
  syncWithActors(): void {
    for (const actor of game.actors) {
      if (actor.isPlayer) continue;
      this.add(actor);
    }
    for (const id of [...this.bound.keys()]) {
      if (!game.actorById.has(id)) this.remove(id);
    }
  }

  dispose(): void {
    for (const id of [...this.bound.keys()]) this.remove(id);
  }
}
