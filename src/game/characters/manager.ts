import * as THREE from "three";
import { HUMAN_METRICS, type HitRegion, type Team } from "../core/types";
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
 *
 * **The local player is bound too, with hitboxes and no model.** Nothing else
 * in the simulation registers a collider for entity 0, so without this entry
 * the player is the one actor in the match that rounds pass straight through:
 * bots acquire, aim and fire perfectly correctly, and every shot resolves
 * against the concrete behind you. A first-person body is a separate question
 * — this is the target, not the avatar.
 */

interface Visual {
  model: SoldierModel;
  weapon: HeldWeaponModel;
  /** The weapon id the held model was built for, so swaps rebuild it. */
  weaponId: string;
  animator: CharacterAnimator;
}

interface Bound {
  actor: Actor;
  /** Null for the local player, who is drawn as a viewmodel, not a body. */
  visual: Visual | null;
  colliders: Collider[];
  regions: HitRegion[];
}

interface RegionSpec {
  region: HitRegion;
  /** Fraction of stance height at the box centre. */
  centre: number;
  /** Half extents in metres, before stance scaling. */
  half: [number, number, number];
}

/**
 * The hit regions, stacked so that **consecutive boxes overlap**.
 *
 * Sized from the fractions of standing height a body actually occupies, then
 * deliberately grown until each box's top reaches past the next one's bottom.
 * Boxes that merely touch leave a seam at every joint — hips, ankles, the base
 * of the neck — and a round through a seam registers as world geometry, so a
 * centre-mass shot silently does nothing. Overlaps cost nothing: the raycast
 * returns the nearest hit, so the more specific box in front always wins.
 */
const REGION_SPECS: readonly RegionSpec[] = [
  { region: "head", centre: 0.94, half: [0.145, 0.16, 0.15] },
  { region: "neck", centre: 0.862, half: [0.11, 0.08, 0.11] },
  { region: "chest", centre: 0.755, half: [0.26, 0.19, 0.18] },
  { region: "stomach", centre: 0.6, half: [0.24, 0.175, 0.165] },
  { region: "arm", centre: 0.73, half: [0.34, 0.2, 0.14] },
  { region: "leg", centre: 0.34, half: [0.22, 0.36, 0.16] },
  { region: "foot", centre: 0.085, half: [0.22, 0.16, 0.2] },
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

  /** Bound once so every animator shares one closure rather than allocating. */
  private readonly sampleGround = (x: number, z: number): number =>
    this.world.groundAt(x, z);

  /**
   * Attach hitboxes to an actor, and a soldier model unless it is the local
   * player. Idempotent.
   */
  add(actor: Actor, team: Team = actor.team): void {
    if (this.bound.has(actor.id)) return;

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

    this.bound.set(actor.id, {
      actor,
      visual: actor.isPlayer ? null : this.buildVisual(actor, team),
      colliders,
      regions,
    });
  }

  private buildVisual(actor: Actor, team: Team): Visual {
    const model = buildSoldier({ team, seed: actor.seed });
    model.group.position.copy(actor.position);
    this.group.add(model.group);

    // Parent the weapon to the rig's dedicated weapon bone, which the
    // animation layer already keeps in the right hand.
    const weapon = buildHeldWeapon(actor.weaponId);
    model.bones[B.weapon]!.add(weapon.mesh);

    const animator = new CharacterAnimator();
    // Feet are planted on the sampled ground rather than on the actor's own
    // plane, so a soldier on a slope stands on it instead of through it.
    animator.groundAt = this.sampleGround;
    animator.reset(actor);
    return { model, weapon, weaponId: actor.weaponId, animator };
  }

  remove(actorId: number): void {
    const entry = this.bound.get(actorId);
    if (!entry) return;
    for (const collider of entry.colliders) this.world.removeDynamic(collider);
    const visual = entry.visual;
    if (visual) {
      this.group.remove(visual.model.group);
      visual.weapon.mesh.removeFromParent();
      visual.weapon.dispose();
      visual.model.dispose();
    }
    this.bound.delete(actorId);
  }

  /** Notify the animator that an actor was hit, for the flinch layer. */
  reportHit(actorId: number, lateralSign: number): void {
    this.bound.get(actorId)?.visual?.animator.hit(lateralSign);
  }

  /** Notify the animator that an actor fired. */
  reportFire(actorId: number): void {
    this.bound.get(actorId)?.visual?.animator.recoil();
  }

  update(dt: number, camera: THREE.Camera): void {
    this.frame += 1;
    _cameraFlat.copy(camera.position);

    for (const entry of this.bound.values()) {
      const actor = entry.actor;

      // Hitboxes always follow the simulation, for every bound actor including
      // the player, because shooting a character must never lag its position.
      this.updateHitboxes(entry);

      const visual = entry.visual;
      if (!visual) continue;

      const distance = _cameraFlat.distanceTo(actor.position);

      // Distance-scaled update rate: full rate up close, every other frame at
      // medium range, every fourth beyond that.
      const stride = distance < 30 ? 1 : distance < 80 ? 2 : 4;
      if (this.frame % stride !== 0) continue;
      const step = dt * stride;

      // Rebuild the held weapon if the actor swapped to a different class.
      if (visual.weaponId !== actor.weaponId) {
        visual.weapon.mesh.removeFromParent();
        visual.weapon.dispose();
        visual.weapon = buildHeldWeapon(actor.weaponId);
        visual.weaponId = actor.weaponId;
        visual.model.bones[B.weapon]!.add(visual.weapon.mesh);
      }
      // A dead actor drops the weapon from view rather than clipping it
      // through the ground as the body folds.
      visual.weapon.mesh.visible = actor.alive;

      visual.model.group.position.copy(actor.position);
      // Per-foot ground sampling and the off-hand IK only read at close range,
      // and the ground sampler is the most expensive thing in the pose.
      visual.animator.update(
        visual.model.bones,
        visual.model.group,
        actor,
        step,
        distance < 45,
      );
      visual.model.bones[B.root]!.updateMatrixWorld(true);

      // Shadows are the most expensive thing a character does; only the ones
      // close enough for their shadow to be legible cast at all.
      const cast = distance < 60 && actor.alive;
      if (visual.model.mesh.castShadow !== cast) visual.model.mesh.castShadow = cast;
      visual.model.group.visible = distance < 420;
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

  /** Posed bone hierarchy of a bound actor, for tooling and debug overlays. */
  bonesOf(actorId: number): readonly THREE.Bone[] | null {
    return this.bound.get(actorId)?.visual?.model.bones ?? null;
  }

  /**
   * Advance one actor's pose by a fixed delta, without touching hitboxes,
   * shadows or anything else the frame loop does.
   *
   * This exists so a gait can be measured rather than eyeballed. A headless
   * capture only ever advances a handful of frames with clamped deltas, which
   * is nowhere near a full stride — stepping the animator directly is the only
   * way to see a whole cycle.
   */
  poseOnly(actorId: number, dt: number, detail = true): void {
    const visual = this.bound.get(actorId)?.visual;
    if (!visual) return;
    const actor = this.bound.get(actorId)!.actor;
    visual.model.group.position.copy(actor.position);
    visual.animator.update(visual.model.bones, visual.model.group, actor, dt, detail);
    visual.model.group.updateMatrixWorld(true);
  }

  /** Total triangles across live characters, for the statistics readout. */
  get triangleCount(): number {
    let total = 0;
    for (const entry of this.bound.values()) {
      const visual = entry.visual;
      if (visual && visual.model.group.visible) total += visual.model.triangleCount;
    }
    return total;
  }

  /**
   * Bind every actor in the simulation that is not bound yet — the player
   * included, so their hitboxes exist from the first frame of the match.
   */
  syncWithActors(): void {
    for (const actor of game.actors) this.add(actor);
    for (const id of [...this.bound.keys()]) {
      if (!game.actorById.has(id)) this.remove(id);
    }
  }

  dispose(): void {
    for (const id of [...this.bound.keys()]) this.remove(id);
  }
}
