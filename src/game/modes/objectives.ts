import type { GameModeId, Team } from "../core/types";
import type { Actor } from "../core/gameState";
import { getGroundZone } from "../../lib/layout";

export interface DominationZone {
  id: string;
  label: string;
  /** World coords: [x, z] */
  center: [number, number];
  radius: number;
  owner: Team | null;
  /**
   * Capture progress, 0 to 1. On a neutral zone it belongs to `capturingTeam`;
   * on an owned zone it is the owner's hold, worn down by the other team.
   */
  progress: number;
  /** Whose progress a neutral zone is carrying; `null` when it has none. */
  capturingTeam: Team | null;
  contested: boolean;
}

export interface HardpointZone {
  id: string;
  label: string;
  center: [number, number];
  radius: number;
}

export interface ObjectiveHudZone {
  id: string;
  label: string;
  x: number;
  z: number;
  owner: Team | null;
  progress: number;
  /** Whose progress a neutral zone is carrying, for colouring the ring. */
  capturingTeam: Team | null;
  contested: boolean;
}

export interface ObjectiveHudState {
  zones: ObjectiveHudZone[];
  activeHardpoint: number | null;
  holdTime: number;
}

const DOMINATION_CAPTURE_TIME_SEC = 10;
/**
 * Progress on an empty zone drifts back to rest at this rate per second: a
 * neutral zone toward 0, an owned one toward full hold. Half the capture rate,
 * so a contested-then-abandoned capture is lost over twenty seconds.
 */
const DOMINATION_DECAY_PER_SEC = 0.5 / DOMINATION_CAPTURE_TIME_SEC;
const HARDPOINT_ROTATION_INTERVAL = 60;
const ZONE_RADIUS = 18;

function createDominationZone(id: string, label: string, zoneId: string): DominationZone {
  const gz = getGroundZone(zoneId);
  if (!gz) throw new Error(`GroundZone not found: ${zoneId}`);
  return {
    id,
    label,
    center: gz.position,
    radius: ZONE_RADIUS,
    owner: null,
    progress: 0,
    capturingTeam: null,
    contested: false,
  };
}

function createHardpointZone(id: string, zoneId: string): HardpointZone {
  const gz = getGroundZone(zoneId);
  if (!gz) throw new Error(`GroundZone not found: ${zoneId}`);
  return {
    id,
    label: gz.name,
    center: gz.position,
    radius: ZONE_RADIUS,
  };
}

/**
 * One uncontested step of a domination capture by `team` with `count` bodies
 * on the point. Progress always belongs to somebody: a neutral zone carries
 * one team's progress, and another team has to drain it to zero before
 * building its own — it never inherits it.
 */
export function stepCapture(
  zone: DominationZone,
  team: Team,
  count: number,
  dt: number,
): void {
  if (zone.owner === team) {
    zone.progress = 1;
    zone.capturingTeam = null;
    return;
  }
  // Faster capture with more teammates: 1x for 1 player, 1.5x for 2, 2.0x for 3, etc.
  const rate = (1 / DOMINATION_CAPTURE_TIME_SEC) * (1 + 0.5 * (count - 1));

  if (zone.owner !== null) {
    // Neutralising an enemy zone; once it falls, the neutraliser starts on it.
    zone.progress -= rate * dt;
    if (zone.progress <= 0) {
      zone.progress = 0;
      zone.owner = null;
      zone.capturingTeam = team;
    }
    return;
  }

  if (zone.capturingTeam !== null && zone.capturingTeam !== team) {
    // Somebody else's half-capture: wear it down first.
    zone.progress -= rate * dt;
    if (zone.progress <= 0) {
      zone.progress = 0;
      zone.capturingTeam = team;
    }
    return;
  }

  zone.capturingTeam = team;
  zone.progress += rate * dt;
  if (zone.progress >= 1) {
    zone.progress = 1;
    zone.owner = team;
    zone.capturingTeam = null;
  }
}

/** An empty zone drifts back to rest: neutral toward 0, owned toward full. */
export function decayCapture(zone: DominationZone, dt: number): void {
  const step = DOMINATION_DECAY_PER_SEC * dt;
  if (zone.owner !== null) {
    zone.progress = Math.min(1, zone.progress + step);
    return;
  }
  if (zone.progress <= 0) return;
  zone.progress = Math.max(0, zone.progress - step);
  if (zone.progress === 0) zone.capturingTeam = null;
}

export class ObjectiveManager {
  private readonly mode: GameModeId;
  private readonly dominationZones: DominationZone[];
  private readonly hardpoints: HardpointZone[];

  private hpActiveIndex = 0;
  private hpRotationTimer = HARDPOINT_ROTATION_INTERVAL;
  private hpHoldTime = 0;
  private hpOwner: Team | null = null;
  private hpContested = false;

  private scoreBlue = 0;
  private scoreRed = 0;

  constructor(mode: GameModeId) {
    this.mode = mode;

    this.dominationZones = [
      createDominationZone("A", "A", "fighter-shelters"), // West apron area
      createDominationZone("B", "B", "ops-complex"), // Central operations
      createDominationZone("C", "C", "fuel-farm"), // East fuel area
    ];

    this.hardpoints = [
      createHardpointZone("hp1", "ops-complex"),
      createHardpointZone("hp2", "main-apron"),
      createHardpointZone("hp3", "east-labs"),
      createHardpointZone("hp4", "west-courts"),
      createHardpointZone("hp5", "crew-blocks"),
    ];
  }

  update(dt: number, actors: readonly Actor[]): void {
    if (this.mode === "domination") {
      this.updateDomination(dt, actors);
    } else if (this.mode === "hardpoint") {
      this.updateHardpoint(dt, actors);
    }
  }

  private updateDomination(dt: number, actors: readonly Actor[]): void {
    for (const zone of this.dominationZones) {
      let blueCount = 0;
      let redCount = 0;

      for (const actor of actors) {
        if (!actor.alive) continue;
        const dx = actor.position.x - zone.center[0];
        const dz = actor.position.z - zone.center[1];
        if (dx * dx + dz * dz <= zone.radius * zone.radius) {
          if (actor.team === "blue") blueCount++;
          else if (actor.team === "red") redCount++;
        }
      }

      zone.contested = blueCount > 0 && redCount > 0;

      if (!zone.contested) {
        const count = Math.max(blueCount, redCount);
        const cappingTeam: Team | null =
          blueCount > 0 ? "blue" : redCount > 0 ? "red" : null;

        if (cappingTeam) {
          stepCapture(zone, cappingTeam, count, dt);
        } else {
          decayCapture(zone, dt);
        }
      }

      // 1 point per controlled zone every 2.5 seconds -> 0.4 points/sec
      if (zone.owner === "blue") this.scoreBlue += 0.4 * dt;
      if (zone.owner === "red") this.scoreRed += 0.4 * dt;
    }
  }

  private updateHardpoint(dt: number, actors: readonly Actor[]): void {
    this.hpRotationTimer -= dt;
    if (this.hpRotationTimer <= 0) {
      this.hpRotationTimer = HARDPOINT_ROTATION_INTERVAL;
      this.hpActiveIndex = (this.hpActiveIndex + 1) % this.hardpoints.length;
      this.hpOwner = null;
      this.hpContested = false;
      this.hpHoldTime = 0;
    }

    const activeZone = this.hardpoints[this.hpActiveIndex]!;
    let blueCount = 0;
    let redCount = 0;

    for (const actor of actors) {
      if (!actor.alive) continue;
      const dx = actor.position.x - activeZone.center[0];
      const dz = actor.position.z - activeZone.center[1];
      if (dx * dx + dz * dz <= activeZone.radius * activeZone.radius) {
        if (actor.team === "blue") blueCount++;
        else if (actor.team === "red") redCount++;
      }
    }

    this.hpContested = blueCount > 0 && redCount > 0;

    if (!this.hpContested) {
      if (blueCount > 0) {
        this.hpOwner = "blue";
        this.scoreBlue += 1 * dt; // 1 point per second
        this.hpHoldTime += dt;
      } else if (redCount > 0) {
        this.hpOwner = "red";
        this.scoreRed += 1 * dt;
        this.hpHoldTime += dt;
      } else {
        this.hpOwner = null;
      }
    }
  }

  getScore(): { blue: number; red: number } {
    return {
      blue: Math.floor(this.scoreBlue),
      red: Math.floor(this.scoreRed),
    };
  }

  getZones(): readonly (DominationZone | HardpointZone)[] {
    if (this.mode === "domination") return this.dominationZones;
    if (this.mode === "hardpoint") return this.hardpoints;
    return [];
  }

  getHudState(): ObjectiveHudState {
    if (this.mode === "domination") {
      return {
        zones: this.dominationZones.map((z) => ({
          id: z.id,
          label: z.label,
          x: z.center[0],
          z: z.center[1],
          owner: z.owner,
          progress: z.progress,
          capturingTeam: z.capturingTeam,
          contested: z.contested,
        })),
        activeHardpoint: null,
        holdTime: 0,
      };
    } else if (this.mode === "hardpoint") {
      const activeZone = this.hardpoints[this.hpActiveIndex]!;
      return {
        zones: [
          {
            id: activeZone.id,
            label: activeZone.label,
            x: activeZone.center[0],
            z: activeZone.center[1],
            owner: this.hpOwner,
            // Provide rotation progress for HUD to display timer
            progress: this.hpRotationTimer / HARDPOINT_ROTATION_INTERVAL,
            capturingTeam: null,
            contested: this.hpContested,
          },
        ],
        activeHardpoint: this.hpActiveIndex,
        holdTime: this.hpHoldTime,
      };
    }

    return { zones: [], activeHardpoint: null, holdTime: 0 };
  }

  reset(): void {
    this.scoreBlue = 0;
    this.scoreRed = 0;

    for (const z of this.dominationZones) {
      z.owner = null;
      z.progress = 0;
      z.capturingTeam = null;
      z.contested = false;
    }

    this.hpActiveIndex = 0;
    this.hpRotationTimer = HARDPOINT_ROTATION_INTERVAL;
    this.hpHoldTime = 0;
    this.hpOwner = null;
    this.hpContested = false;
  }
}
