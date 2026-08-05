import * as THREE from "three";
import { GROUND_ZONES, type GroundZone } from "@/lib/layout";
import { mulberry32 } from "@/lib/noise";
import { HUMAN_METRICS, MASK_SIGHT, OPPOSING_TEAM } from "../core/types";
import { game, type Actor } from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";

/**
 * Spawn selection.
 *
 * The genre's rule is simple to state and hard to satisfy: put the player back
 * in the fight, facing it, without putting them in front of a gun. This is a
 * scored search over a fixed candidate set derived from `GROUND_ZONES` — the
 * same named places the map is built from — with a small number of *hard*
 * rejections layered under a soft score:
 *
 *   hard   position must be free of geometry
 *   hard   no live enemy within `hardEnemyRadiusM` that can see the point
 *   soft   + near friendlies, + near the mode's anchor/objectives
 *   soft   − near enemies, − enemies looking this way, − recent deaths here,
 *          − points used moments ago, − wrong side of the map
 *
 * Line-of-sight is the expensive term, so the search is two-phase: every
 * candidate gets the cheap distance score, then only the best handful are
 * ray-tested. A returned point has therefore always been LOS-validated.
 *
 * Everything random flows through `mulberry32` seeded from the match seed, so
 * a replayed match spawns everyone in the same order in the same places.
 */

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

export const SPAWN_TUNING = {
  /** No spawn ever lands this close to an enemy who can see it. */
  hardEnemyRadiusM: 12,
  /** Enemies further away than this are ignored by the LOS pass. */
  losCheckRangeM: 110,
  /** Penalty applied when a live enemy can see the candidate. */
  losPenalty: 900,
  /** Extra penalty scaled by how directly that enemy is already aiming at it. */
  aimPenalty: 520,
  /** Enemy proximity is punished inside this radius. */
  enemyDangerM: 70,
  enemyWeight: 620,
  /** Friendlies are rewarded, peaking at `friendlyIdealM`. */
  friendlyIdealM: 24,
  friendlyRangeM: 75,
  friendlyWeight: 210,
  /** How long a death at a point suppresses it. */
  deathMemorySec: 14,
  deathRadiusM: 16,
  deathWeight: 260,
  /** A point that just produced a spawn death is hard-blacklisted this long. */
  blacklistSec: 9,
  /** A point used by anyone recently is discouraged (no stacked spawns). */
  reuseSec: 4,
  reuseWeight: 300,
  /** Objective attraction, scaled per objective by the mode. */
  objectiveWeight: 240,
  objectiveIdealM: 45,
  /** Anchor (team home / forward push point) attraction. */
  anchorWeight: 300,
  anchorFalloffM: 220,
  /** Penalty for a candidate on the opposite side of the compound. */
  wrongSidePenalty: 260,
  /** Deterministic tie-breaking jitter. */
  jitter: 26,
  /** How many candidates survive the cheap pass into the LOS pass. */
  refineCount: 14,
  /** Points scattered inside each zone. */
  pointsPerZone: 14,
} as const;

const CAPSULE_RADIUS = HUMAN_METRICS.radius * 1.08;
const CAPSULE_HEIGHT = HUMAN_METRICS.colliderHeight.stand;
const EYE_HEIGHT = HUMAN_METRICS.eyeHeight.stand;

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export interface SpawnPoint {
  /** Index into the selector's candidate table. */
  readonly candidateId: number;
  readonly zoneId: string;
  readonly zoneName: string;
  /** Feet position, seated on the analytic ground. */
  readonly position: THREE.Vector3;
  /** Facing, radians, yaw 0 looks toward -z. */
  readonly yaw: number;
  /** Final score, for debugging and telemetry. */
  readonly score: number;
}

/** A place the mode wants people to spawn near (a flag, the hill, a package). */
export interface SpawnObjective {
  readonly position: THREE.Vector3;
  /** Multiplier on `objectiveWeight`; negative repels (e.g. the enemy's flag). */
  readonly weight: number;
}

export interface SpawnQuery {
  actor: Actor;
  time: number;
  /** Where this actor's team is fighting from; usually a home flag. */
  anchor?: THREE.Vector3 | null;
  anchorWeight?: number;
  objectives?: readonly SpawnObjective[];
  /** Zone ids the mode forbids outright (the live hardpoint, a gunfight arena). */
  bannedZoneIds?: readonly string[];
  /** Zone ids the mode restricts the search to. Empty/undefined = all zones. */
  allowedZoneIds?: readonly string[];
  /** Free-for-all: everyone but the actor counts as an enemy. */
  ffa?: boolean;
  /** Preferred half of the compound. */
  preferSide?: GroundZone["side"] | null;
}

export interface SpawnSelectorStats {
  /** Selections that found a legal point. */
  resolved: number;
  /** Selections that found nothing and asked the caller to retry. */
  blocked: number;
  /** Candidates rejected because an enemy could see them from close range. */
  hardRejects: number;
  /** Candidates rejected because geometry occupied the capsule. */
  geometryRejects: number;
  /** Candidates in the table. */
  candidates: number;
}

/* ------------------------------------------------------------------ */
/* Candidates                                                          */
/* ------------------------------------------------------------------ */

interface SpawnCandidate {
  id: number;
  zone: GroundZone;
  position: THREE.Vector3;
  /** Eye point used for line-of-sight tests. */
  eye: THREE.Vector3;
  /** Facing toward the compound centroid; overridden when a target exists. */
  defaultYaw: number;
  /** Wall-clock time this point stops being blacklisted. */
  blockedUntil: number;
  /** Last time anyone spawned here. */
  lastUsed: number;
}

interface DeathMark {
  x: number;
  z: number;
  time: number;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Yaw that points `from` at `to`, in the engine's convention (0 = -z). */
export function faceYaw(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

function zoneCentroid(): THREE.Vector3 {
  const centre = new THREE.Vector3();
  for (const zone of GROUND_ZONES) {
    centre.x += zone.position[0];
    centre.z += zone.position[1];
  }
  const n = Math.max(1, GROUND_ZONES.length);
  centre.x /= n;
  centre.z /= n;
  return centre;
}

/* ------------------------------------------------------------------ */
/* Selector                                                            */
/* ------------------------------------------------------------------ */

export class SpawnSelector {
  private readonly world: CollisionWorld;
  private readonly candidates: SpawnCandidate[] = [];
  private readonly byZone = new Map<string, SpawnCandidate[]>();
  private readonly deaths: DeathMark[] = [];
  private readonly rng: () => number;
  private readonly centre = zoneCentroid();
  private readonly stats: SpawnSelectorStats = {
    resolved: 0,
    blocked: 0,
    hardRejects: 0,
    geometryRejects: 0,
    candidates: 0,
  };

  /** Scratch, so selection allocates nothing in the steady state. */
  private readonly scored: { candidate: SpawnCandidate; score: number }[] = [];
  private readonly _eye = new THREE.Vector3();
  private readonly _tmp = new THREE.Vector3();

  constructor(world: CollisionWorld, seed: number) {
    this.world = world;
    this.rng = mulberry32(seed >>> 0);
    this.build();
  }

  /* ---------------------------------------------------------------- */
  /* Construction                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Scatter points inside every zone with a deterministic sunflower spiral,
   * drop the ones that land inside a building, and cache the rest. The world
   * is static once baked, so this happens exactly once per match.
   */
  private build(): void {
    const golden = Math.PI * (3 - Math.sqrt(5));
    let id = 0;
    for (const zone of GROUND_ZONES) {
      const list: SpawnCandidate[] = [];
      const count = SPAWN_TUNING.pointsPerZone;
      for (let i = 0; i < count; i += 1) {
        // Sunflower placement fills the disc evenly; the seeded jitter keeps
        // two matches on the same map from feeling identical.
        const radial = Math.sqrt((i + 0.5) / count) * zone.radius * 0.92;
        const angle = i * golden + this.rng() * 0.9;
        const x = zone.position[0] + Math.cos(angle) * radial;
        const z = zone.position[1] + Math.sin(angle) * radial;
        const y = this.world.groundAt(x, z);
        const position = new THREE.Vector3(x, y, z);
        if (!this.world.isPositionFree(position, CAPSULE_RADIUS, CAPSULE_HEIGHT)) {
          this.stats.geometryRejects += 1;
          continue;
        }
        const candidate: SpawnCandidate = {
          id: id++,
          zone,
          position,
          eye: new THREE.Vector3(x, y + EYE_HEIGHT, z),
          defaultYaw: faceYaw(position, this.centre),
          blockedUntil: -1,
          lastUsed: -1,
        };
        this.candidates.push(candidate);
        list.push(candidate);
      }
      this.byZone.set(zone.id, list);
    }
    this.stats.candidates = this.candidates.length;
  }

  /* ---------------------------------------------------------------- */
  /* Memory                                                            */
  /* ---------------------------------------------------------------- */

  /** Record a death so the area cools off for a while. */
  noteDeath(position: THREE.Vector3, time: number): void {
    this.deaths.push({ x: position.x, z: position.z, time });
    if (this.deaths.length > 64) this.deaths.shift();

    // A death within a few seconds of spawning at a point is a spawn trap:
    // blacklist that exact point outright rather than merely discouraging it.
    for (const candidate of this.candidates) {
      if (candidate.lastUsed < 0) continue;
      if (time - candidate.lastUsed > 6) continue;
      const dx = candidate.position.x - position.x;
      const dz = candidate.position.z - position.z;
      if (dx * dx + dz * dz < 14 * 14) {
        candidate.blockedUntil = time + SPAWN_TUNING.blacklistSec;
      }
    }
  }

  /** Forget everything between rounds. */
  reset(): void {
    this.deaths.length = 0;
    for (const candidate of this.candidates) {
      candidate.blockedUntil = -1;
      candidate.lastUsed = -1;
    }
  }

  getStats(): Readonly<SpawnSelectorStats> {
    return this.stats;
  }

  /** Every legal candidate inside a zone, for modes that need one directly. */
  candidatesInZone(zoneId: string): readonly THREE.Vector3[] {
    return (this.byZone.get(zoneId) ?? []).map((c) => c.position);
  }

  /* ---------------------------------------------------------------- */
  /* Selection                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Pick a spawn, or return `null` when every candidate is compromised — the
   * caller should wait a tick and ask again rather than force a bad spawn.
   */
  select(query: SpawnQuery): SpawnPoint | null {
    const { actor, time } = query;
    const ffa = query.ffa === true;
    const enemyTeam = OPPOSING_TEAM[actor.team];
    const banned = query.bannedZoneIds;
    const allowed = query.allowedZoneIds;

    this.scored.length = 0;

    for (const candidate of this.candidates) {
      if (candidate.blockedUntil > time) continue;
      if (banned && banned.includes(candidate.zone.id)) continue;
      if (allowed && allowed.length > 0 && !allowed.includes(candidate.zone.id)) continue;
      this.scored.push({ candidate, score: this.cheapScore(candidate, query, ffa, enemyTeam) });
    }

    // Nothing survived the zone filters — retry with the blacklist relaxed
    // before giving up, so a heavily-camped match still spawns people.
    if (this.scored.length === 0) {
      for (const candidate of this.candidates) {
        if (banned && banned.includes(candidate.zone.id)) continue;
        if (allowed && allowed.length > 0 && !allowed.includes(candidate.zone.id)) continue;
        this.scored.push({ candidate, score: this.cheapScore(candidate, query, ffa, enemyTeam) });
      }
    }
    if (this.scored.length === 0) {
      this.stats.blocked += 1;
      return null;
    }

    this.scored.sort((a, b) => b.score - a.score);
    const refine = Math.min(SPAWN_TUNING.refineCount, this.scored.length);

    let best: SpawnCandidate | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < refine; i += 1) {
      const entry = this.scored[i]!;
      const candidate = entry.candidate;

      // Dynamic colliders (other characters, vehicles) move, so the build-time
      // geometry test is re-run on the shortlist only.
      if (!this.world.isPositionFree(candidate.position, CAPSULE_RADIUS, CAPSULE_HEIGHT)) {
        this.stats.geometryRejects += 1;
        continue;
      }

      const sight = this.sightScore(candidate, actor, ffa, enemyTeam);
      if (sight === null) {
        this.stats.hardRejects += 1;
        continue;
      }
      const total = entry.score + sight;
      if (total > bestScore) {
        bestScore = total;
        best = candidate;
      }
    }

    if (!best) {
      this.stats.blocked += 1;
      return null;
    }

    best.lastUsed = time;
    this.stats.resolved += 1;

    // Face the fight: the mode's anchor if it gave one, else the nearest
    // objective, else the middle of the compound.
    let target: THREE.Vector3 = this.centre;
    const objectives = query.objectives;
    if (objectives && objectives.length > 0) {
      let closest = Infinity;
      for (const objective of objectives) {
        if (objective.weight <= 0) continue;
        const d = objective.position.distanceToSquared(best.position);
        if (d < closest) {
          closest = d;
          target = objective.position;
        }
      }
    }
    const yaw = target === this.centre ? best.defaultYaw : faceYaw(best.position, target);

    return {
      candidateId: best.id,
      zoneId: best.zone.id,
      zoneName: best.zone.name,
      position: best.position.clone(),
      yaw,
      score: bestScore,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Scoring                                                           */
  /* ---------------------------------------------------------------- */

  /** Distance-only terms; no raycasts, evaluated for every candidate. */
  private cheapScore(
    candidate: SpawnCandidate,
    query: SpawnQuery,
    ffa: boolean,
    enemyTeam: string,
  ): number {
    const { actor, time } = query;
    const position = candidate.position;
    let score = 0;

    for (const other of game.actors) {
      if (!other.alive || other.id === actor.id) continue;
      const hostile = ffa ? true : other.team === enemyTeam;
      const dx = other.position.x - position.x;
      const dz = other.position.z - position.z;
      const distance = Math.hypot(dx, dz);

      if (hostile) {
        if (distance < SPAWN_TUNING.enemyDangerM) {
          const closeness = 1 - distance / SPAWN_TUNING.enemyDangerM;
          score -= closeness * closeness * SPAWN_TUNING.enemyWeight;
        }
      } else if (distance < SPAWN_TUNING.friendlyRangeM) {
        // A tent around the ideal distance: right next to a friendly is as
        // bad as being alone, because both mean you spawn into their fight.
        const delta = Math.abs(distance - SPAWN_TUNING.friendlyIdealM);
        const falloff = Math.max(0, 1 - delta / SPAWN_TUNING.friendlyRangeM);
        score += falloff * SPAWN_TUNING.friendlyWeight;
      }
    }

    for (const death of this.deaths) {
      const age = time - death.time;
      if (age > SPAWN_TUNING.deathMemorySec) continue;
      const dx = death.x - position.x;
      const dz = death.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > SPAWN_TUNING.deathRadiusM) continue;
      const recency = 1 - age / SPAWN_TUNING.deathMemorySec;
      const nearness = 1 - distance / SPAWN_TUNING.deathRadiusM;
      score -= recency * nearness * SPAWN_TUNING.deathWeight;
    }

    if (candidate.lastUsed >= 0) {
      const age = time - candidate.lastUsed;
      if (age < SPAWN_TUNING.reuseSec) {
        score -= (1 - age / SPAWN_TUNING.reuseSec) * SPAWN_TUNING.reuseWeight;
      }
    }

    const anchor = query.anchor;
    if (anchor) {
      const weight = query.anchorWeight ?? 1;
      const distance = Math.hypot(anchor.x - position.x, anchor.z - position.z);
      const falloff = Math.max(0, 1 - distance / SPAWN_TUNING.anchorFalloffM);
      score += falloff * SPAWN_TUNING.anchorWeight * weight;
    }

    const objectives = query.objectives;
    if (objectives) {
      for (const objective of objectives) {
        const distance = Math.hypot(
          objective.position.x - position.x,
          objective.position.z - position.z,
        );
        // Attractive at the ideal stand-off, neutral far away — you want to
        // land near the objective, not on top of it.
        const delta = Math.abs(distance - SPAWN_TUNING.objectiveIdealM);
        const falloff = Math.max(0, 1 - delta / (SPAWN_TUNING.objectiveIdealM * 2.6));
        score += falloff * SPAWN_TUNING.objectiveWeight * objective.weight;
      }
    }

    const prefer = query.preferSide;
    if (prefer && candidate.zone.side !== "neutral" && candidate.zone.side !== prefer) {
      score -= SPAWN_TUNING.wrongSidePenalty;
    }

    // Deterministic per-point jitter keeps identical scores from always
    // resolving to the same candidate.
    score += ((candidate.id * 2654435761) % 1000) / 1000 * SPAWN_TUNING.jitter;

    return score;
  }

  /**
   * Line-of-sight terms for a shortlisted candidate.
   * Returns `null` when the point is illegal (a close enemy can see it).
   */
  private sightScore(
    candidate: SpawnCandidate,
    actor: Actor,
    ffa: boolean,
    enemyTeam: string,
  ): number | null {
    let score = 0;
    for (const other of game.actors) {
      if (!other.alive || other.id === actor.id) continue;
      if (!(ffa ? true : other.team === enemyTeam)) continue;

      const dx = other.position.x - candidate.position.x;
      const dz = other.position.z - candidate.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > SPAWN_TUNING.losCheckRangeM) continue;

      this._eye.set(
        other.position.x,
        other.position.y + HUMAN_METRICS.eyeHeight[other.stance],
        other.position.z,
      );
      if (!this.world.hasLineOfSight(this._eye, candidate.eye, MASK_SIGHT, other.id)) continue;

      // Hard rule. Nothing overrides it, and every returned point has been
      // through this test, so "spawned in front of an enemy" is impossible.
      if (distance <= SPAWN_TUNING.hardEnemyRadiusM) return null;

      const closeness = 1 - distance / SPAWN_TUNING.losCheckRangeM;
      score -= closeness * SPAWN_TUNING.losPenalty;

      // Being *looked at* is worse than merely being visible.
      this._tmp
        .set(-dx, candidate.eye.y - this._eye.y, -dz)
        .normalize();
      const facing = this._tmp.dot(other.aimDir);
      if (facing > 0.5) {
        score -= ((facing - 0.5) / 0.5) * closeness * SPAWN_TUNING.aimPenalty;
      }
    }
    return score;
  }
}

/**
 * True when `position` would be an illegal spawn for `team` right now. Exposed
 * so tests (and the mode layer) can assert the invariant independently of the
 * selector that enforces it.
 */
export function isSpawnCompromised(
  world: CollisionWorld,
  position: THREE.Vector3,
  team: string,
  ffa: boolean,
  ignoreId: number,
  radiusM: number = SPAWN_TUNING.hardEnemyRadiusM,
): boolean {
  const eye = new THREE.Vector3(position.x, position.y + EYE_HEIGHT, position.z);
  const from = new THREE.Vector3();
  for (const other of game.actors) {
    if (!other.alive || other.id === ignoreId) continue;
    if (!(ffa ? true : other.team !== team)) continue;
    const distance = Math.hypot(other.position.x - position.x, other.position.z - position.z);
    if (distance > radiusM) continue;
    from.set(
      other.position.x,
      other.position.y + HUMAN_METRICS.eyeHeight[other.stance],
      other.position.z,
    );
    if (world.hasLineOfSight(from, eye, MASK_SIGHT, other.id)) return true;
  }
  return false;
}
