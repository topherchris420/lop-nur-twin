import * as THREE from "three";
import { game } from "./gameState";
import type { EntityId, Team } from "./types";
import { STRUCTURES } from "@/lib/layout";

export type DetectionState = "detected" | "identified" | "tracked" | "lost";
export type ThreatLevel = "none" | "low" | "medium" | "high" | "critical";
export type SensorSource = "visual" | "radar" | "thermal" | "acoustic" | "uplink";
export type SpatialEntityType = "actor" | "structure" | "objective";

export interface SpatialEntity {
  id: string;
  actorId?: EntityId;
  type: SpatialEntityType;
  name: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  altitude: number;
  team: Team | "neutral";
  classification: "infantry" | "vehicle" | "structure" | "objective";
  detectionState: DetectionState;
  detectionConfidence: number; // 0..1
  threatLevel: ThreatLevel;
  sensorSource: SensorSource;
  lastSeen: number;
  trajectory: THREE.Vector3[]; // Last N position points
  distance: number;
  bearing: number;
  heading: number;
  hasLineOfSight: boolean;
  healthRatio: number;
  isLockedTarget: boolean;
}

export type SensorMode = "normal" | "flir" | "nvg" | "crt" | "recon";

class SpatialIntelligenceSystem {
  entities = new Map<string, SpatialEntity>();
  selectedTargetId: string | null = null;
  sensorMode: SensorMode = "normal";
  uavActive = false;
  tacticalMapActive = false;

  private scratchVec1 = new THREE.Vector3();
  private scratchVec2 = new THREE.Vector3();
  private maxTrailPoints = 12;
  private lastTrailUpdate = 0;

  /** Initialize or update entities from game state & layout */
  update(time: number, dt: number): void {
    const player = game.player;
    if (!player) return;

    const playerPos = player.position;
    const world = game.world;

    const currentKeys = new Set<string>();

    // 1. Process Actors (Player, Teammates, Hostile Bots)
    for (const actor of game.actors) {
      if (!actor.alive) continue;
      const key = `actor_${actor.id}`;
      currentKeys.add(key);

      let entity = this.entities.get(key);
      if (!entity) {
        entity = {
          id: key,
          actorId: actor.id,
          type: "actor",
          name: actor.name,
          position: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          yaw: 0,
          pitch: 0,
          altitude: 0,
          team: actor.team,
          classification: "infantry",
          detectionState: actor.isPlayer ? "tracked" : "detected",
          detectionConfidence: 1.0,
          threatLevel: actor.team === player.team ? "none" : "high",
          sensorSource: "visual",
          lastSeen: time,
          trajectory: [],
          distance: 0,
          bearing: 0,
          heading: 0,
          hasLineOfSight: true,
          healthRatio: 1.0,
          isLockedTarget: false,
        };
        this.entities.set(key, entity);
      }

      // Update spatial metrics
      entity.position.copy(actor.position);
      entity.velocity.copy(actor.velocity);
      entity.yaw = actor.yaw;
      entity.pitch = actor.pitch;
      entity.altitude = actor.position.y;
      entity.healthRatio = Math.max(0, actor.health / actor.maxHealth);

      // Distance & bearing relative to player
      const dx = actor.position.x - playerPos.x;
      const dz = actor.position.z - playerPos.z;
      entity.distance = Math.sqrt(dx * dx + dz * dz);
      const absBearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      entity.bearing = absBearing;
      entity.heading = ((actor.yaw * 180) / Math.PI + 360) % 360;

      // Line of sight evaluation
      if (actor.isPlayer) {
        entity.hasLineOfSight = true;
        entity.detectionState = "tracked";
        entity.detectionConfidence = 1.0;
        entity.sensorSource = "uplink";
        entity.lastSeen = time;
      } else if (actor.team === player.team) {
        entity.hasLineOfSight = true;
        entity.detectionState = "tracked";
        entity.detectionConfidence = 1.0;
        entity.sensorSource = "uplink";
        entity.lastSeen = time;
      } else {
        // Hostile entity detection logic
        this.scratchVec1.set(playerPos.x, playerPos.y + 1.6, playerPos.z);
        this.scratchVec2.set(actor.position.x, actor.position.y + 1.2, actor.position.z);
        const hasLos = world
          ? world.hasLineOfSight(this.scratchVec1, this.scratchVec2)
          : true;
        entity.hasLineOfSight = hasLos;

        // Check if firing or visible
        const timeSinceFired = time - actor.lastFireTime;
        const recentGunfire = timeSinceFired >= 0 && timeSinceFired < 3.0;

        if (hasLos && entity.distance < 120) {
          entity.detectionState = "tracked";
          entity.detectionConfidence = Math.min(
            1.0,
            entity.detectionConfidence + dt * 2.0,
          );
          entity.sensorSource = "visual";
          entity.lastSeen = time;
        } else if (hasLos || recentGunfire) {
          entity.detectionState =
            entity.detectionConfidence > 0.6 ? "identified" : "detected";
          entity.detectionConfidence = Math.min(
            0.9,
            entity.detectionConfidence + dt * 1.5,
          );
          entity.sensorSource = recentGunfire ? "acoustic" : "radar";
          entity.lastSeen = time;
        } else {
          // Decaying visibility / lost target state
          entity.detectionConfidence = Math.max(
            0,
            entity.detectionConfidence - dt * 0.25,
          );
          if (time - entity.lastSeen > 6.0) {
            entity.detectionState = "lost";
          }
        }

        // Assign threat level
        if (entity.isLockedTarget) {
          entity.threatLevel = "critical";
        } else if (recentGunfire && entity.distance < 40) {
          entity.threatLevel = "high";
        } else if (hasLos && entity.distance < 80) {
          entity.threatLevel = "medium";
        } else {
          entity.threatLevel = "low";
        }
      }

      entity.isLockedTarget = this.selectedTargetId === key;

      // Update historical trajectory
      if (time - this.lastTrailUpdate > 0.4) {
        if (actor.speed > 0.5) {
          entity.trajectory.push(actor.position.clone());
          if (entity.trajectory.length > this.maxTrailPoints) {
            entity.trajectory.shift();
          }
        }
      }
    }

    if (time - this.lastTrailUpdate > 0.4) {
      this.lastTrailUpdate = time;
    }

    // 2. Add/Update Key Airfield Structures as Intelligence Objects
    for (const struct of STRUCTURES) {
      const key = `struct_${struct.id}`;
      currentKeys.add(key);

      let entity = this.entities.get(key);
      if (!entity) {
        const pos = new THREE.Vector3(struct.position[0], 0, struct.position[1]);
        entity = {
          id: key,
          type: "structure",
          name: struct.description || struct.type,
          position: pos,
          velocity: new THREE.Vector3(),
          yaw: struct.rotation,
          pitch: 0,
          altitude: 0,
          team: "neutral",
          classification: "structure",
          detectionState: "identified",
          detectionConfidence: 1.0,
          threatLevel: "none",
          sensorSource: "uplink",
          lastSeen: time,
          trajectory: [],
          distance: 0,
          bearing: 0,
          heading: ((struct.rotation * 180) / Math.PI + 360) % 360,
          hasLineOfSight: true,
          healthRatio: 1.0,
          isLockedTarget: false,
        };
        this.entities.set(key, entity);
      }

      const dx = struct.position[0] - playerPos.x;
      const dz = struct.position[1] - playerPos.z;
      entity.distance = Math.sqrt(dx * dx + dz * dz);
      entity.bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      entity.isLockedTarget = this.selectedTargetId === key;
    }

    // 3. Remove inactive entities
    for (const [id] of this.entities) {
      if (!currentKeys.has(id)) {
        this.entities.delete(id);
      }
    }
  }

  /** Cycle target lock through hostile detected/tracked entities */
  cycleTarget(): string | null {
    const hostiles = Array.from(this.entities.values()).filter(
      (e) =>
        e.type === "actor" &&
        e.team !== game.player.team &&
        e.detectionState !== "lost" &&
        e.detectionConfidence > 0.2,
    );

    if (hostiles.length === 0) {
      this.selectedTargetId = null;
      return null;
    }

    // Sort by distance to player
    hostiles.sort((a, b) => a.distance - b.distance);

    if (!this.selectedTargetId) {
      this.selectedTargetId = hostiles[0]!.id;
    } else {
      const idx = hostiles.findIndex((h) => h.id === this.selectedTargetId);
      if (idx < 0 || idx >= hostiles.length - 1) {
        this.selectedTargetId = hostiles[0]!.id;
      } else {
        this.selectedTargetId = hostiles[idx + 1]!.id;
      }
    }

    return this.selectedTargetId;
  }

  clearTarget(): void {
    this.selectedTargetId = null;
  }

  cycleSensorMode(): SensorMode {
    const modes: SensorMode[] = ["normal", "flir", "nvg", "crt", "recon"];
    const currentIdx = modes.indexOf(this.sensorMode);
    this.sensorMode = modes[(currentIdx + 1) % modes.length]!;
    return this.sensorMode;
  }
}

export const spatialIntel = new SpatialIntelligenceSystem();
