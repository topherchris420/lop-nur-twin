import * as THREE from "three";
import { GROUND_ZONES } from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import { mulberry32, SITE_SEED } from "@/lib/noise";
import type { Team } from "@/game/core/types";
import { HUMAN_METRICS, MASK_SIGHT, OPPOSING_TEAM } from "@/game/core/types";
import type { Actor } from "@/game/core/gameState";
import type { CollisionWorld } from "@/game/physics/collisionWorld";

const CAPSULE_RADIUS = HUMAN_METRICS.radius * 1.08;
const CAPSULE_HEIGHT = HUMAN_METRICS.colliderHeight.stand;
const EYE_HEIGHT = HUMAN_METRICS.eyeHeight.stand;
const HARD_ENEMY_RADIUS_M = 12;
const LOS_CHECK_RANGE_M = 110;
const POINTS_PER_ZONE = 14;

interface SpawnCandidate {
  position: THREE.Vector3;
  eye: THREE.Vector3;
  zoneId: string;
  side: "north" | "south" | "neutral";
}

export class SpawnSelector {
  private readonly world: CollisionWorld;
  private readonly candidates: SpawnCandidate[] = [];
  private readonly rng: () => number;

  constructor(world: CollisionWorld) {
    this.world = world;
    this.rng = mulberry32(SITE_SEED);
    this.build();
  }

  private build(): void {
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (const zone of GROUND_ZONES) {
      for (let i = 0; i < POINTS_PER_ZONE; i += 1) {
        const radial = Math.sqrt((i + 0.5) / POINTS_PER_ZONE) * zone.radius * 0.92;
        const angle = i * golden + this.rng() * 0.9;
        const x = zone.position[0] + Math.cos(angle) * radial;
        const z = zone.position[1] + Math.sin(angle) * radial;
        const y = terrainHeight(x, z);
        const position = new THREE.Vector3(x, y, z);
        
        if (!this.world.isPositionFree(position, CAPSULE_RADIUS, CAPSULE_HEIGHT)) {
          continue;
        }

        this.candidates.push({
          position,
          eye: new THREE.Vector3(x, y + EYE_HEIGHT, z),
          zoneId: zone.id,
          side: zone.side,
        });
      }
    }
  }

  pickSpawn(
    team: Team,
    actors: readonly Actor[],
    avoidPos?: THREE.Vector3
  ): { position: [number, number, number]; yaw: number } {
    let bestScore = -Infinity;
    let bestCandidate: SpawnCandidate | null = null;
    const enemyTeam = OPPOSING_TEAM[team];
    const _eye = new THREE.Vector3();

    for (const candidate of this.candidates) {
      if (!this.world.isPositionFree(candidate.position, CAPSULE_RADIUS, CAPSULE_HEIGHT)) {
        continue;
      }

      let score = 0;
      let compromised = false;

      // Treat 'south' as blue-favored, 'north' as red-favored, 'neutral' as neutral
      if (candidate.side === "south" && team === "blue") score += 100;
      else if (candidate.side === "north" && team === "red") score += 100;
      else if (candidate.side === "north" && team === "blue") score -= 100;
      else if (candidate.side === "south" && team === "red") score -= 100;

      for (const actor of actors) {
        if (!actor.alive) continue;
        const isEnemy = actor.team === enemyTeam;
        const distance = candidate.position.distanceTo(actor.position);

        if (isEnemy) {
          if (distance < 70) {
            score -= (1 - distance / 70) * 600;
          }

          if (distance <= LOS_CHECK_RANGE_M) {
            _eye.set(
              actor.position.x,
              actor.position.y + HUMAN_METRICS.eyeHeight[actor.stance],
              actor.position.z
            );
            if (this.world.hasLineOfSight(_eye, candidate.eye, MASK_SIGHT, actor.id)) {
              if (distance <= HARD_ENEMY_RADIUS_M) {
                compromised = true;
                break;
              }
              score -= (1 - distance / LOS_CHECK_RANGE_M) * 900;
            }
          }
        } else {
          if (distance < 75) {
            const delta = Math.abs(distance - 24);
            score += Math.max(0, 1 - delta / 75) * 200;
          }
        }
      }

      if (compromised) continue;

      if (avoidPos) {
        const distAvoid = candidate.position.distanceTo(avoidPos);
        if (distAvoid < 30) {
          score -= (1 - distAvoid / 30) * 300;
        }
      }

      score += this.rng() * 20;

      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      return {
        position: [bestCandidate.position.x, bestCandidate.position.y, bestCandidate.position.z],
        yaw: this.rng() * Math.PI * 2,
      };
    }

    const zone = GROUND_ZONES[Math.floor(this.rng() * GROUND_ZONES.length)] ?? GROUND_ZONES[0]!;
    const fbX = zone.position[0];
    const fbZ = zone.position[1];
    const fbY = terrainHeight(fbX, fbZ);
    return {
      position: [fbX, fbY, fbZ],
      yaw: this.rng() * Math.PI * 2,
    };
  }
}
