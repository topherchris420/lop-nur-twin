import * as THREE from "three";
import { game, eyePosition, type Actor } from "../core/gameState";
import {
  HUMAN_METRICS,
  MASK_BULLET,
  MASK_MOVEMENT,
  MASK_SIGHT,
  OPPOSING_TEAM,
  forwardToYaw,
  yawDelta,
  yawToForward,
  type EntityId,
} from "../core/types";
import { useGameStore } from "../core/gameStore";
import {
  ACTION_CONTRACT_VERSION,
  OBSERVATION_SCHEMA_VERSION,
  type ControlFrame,
  type ControlMode,
} from "./contract";
import {
  MAX_CONTACTS,
  MAX_VISIBLE_ENEMIES,
  OBSTACLE_PROBE_M,
  SIGHT_RANGE_M,
  legalActionsFor,
  type Contact,
  type JevObservation,
  type PreviousOutcome,
  type VisibleEnemy,
} from "./observation";
import { rigState } from "./rigState";

/**
 * Builds a brain's observation from the live game, at decision time only.
 *
 * The rules are the player's, not the simulation's:
 *
 *  - An enemy is **visible** when it is alive, within the bots' sight range,
 *    inside the camera's current field of view (which narrows when aiming down
 *    the sights), and an unobstructed sight line reaches its head or chest from
 *    the player's eye — the same `hasLineOfSight` test the bots perceive by.
 *  - **On the crosshair** comes from one ray along the real aim direction,
 *    resolved against real hitboxes: exactly what the rounds would meet.
 *  - **Contacts** are the awareness the HUD already gives a human: enemy
 *    gunfire pings on the radar within hearing range, and where an enemy was
 *    last seen. Both report the position where the thing was heard or seen,
 *    never where the enemy is now.
 *  - **Damage** is the HUD's damage indicator; **obstacles** are waist-high
 *    probes around the body, which a player sees on screen.
 *
 * Nothing here reads a bot's plan, a spawn, a hidden position or a future.
 */

/** How far unsuppressed gunfire is heard — the bots' own hearing range. */
const HEARING_RANGE_M = 115;
/** Gunfire pings and sightings older than this are forgotten. */
const PING_MEMORY_S = 3;
const SIGHTING_MEMORY_S = 6;
/** An enemy seen firing within this long is marked as shooting. */
const FIRING_WINDOW_S = 1;
/** The HUD's damage indicator fades out over about this long. */
const DAMAGE_MEMORY_S = 1.5;

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();
const _head = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _dir = new THREE.Vector3();

const RAD = 180 / Math.PI;
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Clockwise-positive degrees from the aim yaw to a world-space direction. */
function bearingTo(aimYaw: number, dx: number, dz: number): number {
  return -yawDelta(aimYaw, forwardToYaw(dx, dz)) * RAD;
}

function chestHeight(actor: Actor): number {
  return actor.stance === "prone" ? 0.3 : actor.stance === "crouch" ? 0.8 : 1.15;
}

interface Sighting {
  x: number;
  y: number;
  z: number;
  time: number;
}

export interface PerceptionInput {
  sequence: number;
  previousFrame: ControlFrame | null;
  previousOutcome: PreviousOutcome | null;
  control: ControlMode;
  /** The enemy the precision controller is tracking, if any. Marked, never revealed. */
  trackedId: EntityId | null;
}

export class Perception {
  /** Where each enemy was last seen, by the player's own eyes. */
  private readonly lastSeen = new Map<EntityId, Sighting>();
  /** The nearest visible enemy at the last capture, for the HUD. */
  lastTarget: { distanceM: number; bearingDeg: number; onCrosshair: boolean } | null =
    null;
  /**
   * The entity behind each `TARGET_n` slot of the last capture, in slot order.
   * It stays in the browser: the observation and the question carry only the
   * slot, so a brain can name an enemy it was shown and nothing else.
   */
  lastTargetIds: EntityId[] = [];

  reset(): void {
    this.lastSeen.clear();
    this.lastTarget = null;
    this.lastTargetIds = [];
  }

  capture(input: PerceptionInput): JevObservation {
    const player = game.player;
    const world = game.world;
    const hud = game.hud;
    const now = game.time;
    const enemyTeam = OPPOSING_TEAM[player.team];

    eyePosition(player, _eye);
    _aim.copy(game.cameraForward);
    if (_aim.lengthSq() < 1e-8) yawToForward(player.yaw, _aim, player.pitch);
    _aim.normalize();
    const aimYaw = forwardToYaw(_aim.x, _aim.z);
    const aimPitch = Math.asin(THREE.MathUtils.clamp(_aim.y, -1, 1));
    const halfH = rigState.horizontalFovDeg / 2;
    const halfV = Math.max(10, game.cameraFov / 2);

    /* ------------------------------------------------ crosshair */
    let crosshairId: EntityId | null = null;
    if (world) {
      const hit = world.raycast(_eye, _aim, SIGHT_RANGE_M, MASK_BULLET, player.id);
      if (hit && hit.entityId !== null) crosshairId = hit.entityId;
    }

    /* -------------------------------------------------- visible */
    const visible: (VisibleEnemy & { id: EntityId })[] = [];
    for (const other of game.actors) {
      if (other.isPlayer || !other.alive || other.team !== enemyTeam) continue;
      eyePosition(other, _head);
      _chest.set(
        other.position.x,
        other.position.y + chestHeight(other),
        other.position.z,
      );
      _to.copy(_chest).sub(_eye);
      const distance = _to.length();
      if (distance > SIGHT_RANGE_M || distance < 1e-3) continue;
      const bearing = bearingTo(aimYaw, _to.x, _to.z);
      const elevation =
        (Math.asin(THREE.MathUtils.clamp(_to.y / distance, -1, 1)) - aimPitch) * RAD;
      if (Math.abs(bearing) > halfH || Math.abs(elevation) > halfV) continue;
      const headVisible =
        !world || world.hasLineOfSight(_eye, _head, MASK_SIGHT, other.id);
      const chestVisible =
        !world || world.hasLineOfSight(_eye, _chest, MASK_SIGHT, other.id);
      if (!headVisible && !chestVisible) continue;
      // Motion across the view, as the player would see it: relative velocity
      // projected on the view's horizontal right-hand axis.
      const lateral =
        (other.velocity.x - player.velocity.x) * -_aim.z +
        (other.velocity.z - player.velocity.z) * _aim.x;
      const flat = Math.hypot(_aim.x, _aim.z) || 1;
      this.lastSeen.set(other.id, {
        x: other.position.x,
        y: other.position.y,
        z: other.position.z,
        time: now,
      });
      visible.push({
        id: other.id,
        bearingDeg: round1(bearing),
        elevationDeg: round1(elevation),
        distanceM: round1(distance),
        onCrosshair: crosshairId === other.id,
        firing:
          now - other.lastFireTime >= 0 && now - other.lastFireTime < FIRING_WINDOW_S,
        headVisible,
        chestVisible,
        lateralMps: round1(THREE.MathUtils.clamp(lateral / flat, -50, 50)),
        tracked: input.trackedId === other.id,
      });
    }
    visible.sort(
      (a, b) =>
        Number(b.onCrosshair) - Number(a.onCrosshair) ||
        Math.abs(a.bearingDeg) - Math.abs(b.bearingDeg) ||
        a.distanceM - b.distanceM ||
        a.id - b.id,
    );
    const listed = visible.slice(0, MAX_VISIBLE_ENEMIES);
    this.lastTargetIds = listed.map((v) => v.id);
    // Only a listed enemy can be marked tracked; one tracked beyond the list
    // cap is simply not reported as tracked.
    const visibleIds = new Set(visible.map((v) => v.id));
    const nearest = visible[0];
    this.lastTarget = nearest
      ? {
          distanceM: nearest.distanceM,
          bearingDeg: nearest.bearingDeg,
          onCrosshair: nearest.onCrosshair,
        }
      : null;

    /* ------------------------------------------------- contacts */
    const contacts: (Contact & { key: string })[] = [];
    for (const [id, sighting] of this.lastSeen) {
      const actor = game.actorById.get(id);
      const age = now - sighting.time;
      if (!actor || !actor.alive || age > SIGHTING_MEMORY_S || age < 0) {
        this.lastSeen.delete(id);
        continue;
      }
      if (visibleIds.has(id)) continue;
      const dx = sighting.x - player.position.x;
      const dz = sighting.z - player.position.z;
      contacts.push({
        key: `seen-${id}`,
        source: "last_seen",
        bearingDeg: round1(bearingTo(aimYaw, dx, dz)),
        distanceM: round1(Math.hypot(dx, dz)),
        ageS: round1(age),
      });
    }
    const pings = hud.gunfirePings ?? [];
    for (let i = pings.length - 1; i >= 0; i -= 1) {
      const ping = pings[i]!;
      if (ping.shooterTeam !== enemyTeam) continue;
      const age = now - ping.time;
      if (age < 0 || age > PING_MEMORY_S) continue;
      const dx = ping.x - player.position.x;
      const dz = ping.z - player.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > HEARING_RANGE_M) continue;
      // A ping from an enemy already in view, or next to one already listed,
      // adds nothing a player would count separately.
      const duplicate =
        visible.some((v) => {
          const actor = game.actorById.get(v.id);
          return actor
            ? Math.hypot(actor.position.x - ping.x, actor.position.z - ping.z) < 4
            : false;
        }) ||
        contacts.some(
          (c) =>
            c.source === "gunfire" &&
            Math.abs(c.distanceM - distance) < 4 &&
            Math.abs(c.bearingDeg - bearingTo(aimYaw, dx, dz)) < 6,
        );
      if (duplicate) continue;
      contacts.push({
        key: `ping-${i}`,
        source: "gunfire",
        bearingDeg: round1(bearingTo(aimYaw, dx, dz)),
        distanceM: round1(distance),
        ageS: round1(age),
      });
    }
    contacts.sort(
      (a, b) => a.ageS - b.ageS || a.distanceM - b.distanceM || (a.key < b.key ? -1 : 1),
    );

    /* --------------------------------------------------- damage */
    let damage: JevObservation["perception"]["damage"] = null;
    const lastHit = hud.damageDirs[hud.damageDirs.length - 1];
    if (lastHit && now - lastHit.time >= 0 && now - lastHit.time <= DAMAGE_MEMORY_S) {
      // `angle` is the heading of the round's travel; the shooter is behind it.
      damage = {
        ageS: round1(now - lastHit.time),
        bearingDeg: round1(
          bearingTo(aimYaw, -Math.sin(lastHit.angle), -Math.cos(lastHit.angle)),
        ),
      };
    }

    /* ------------------------------------------------ obstacles */
    const bodyYaw = player.yaw;
    const probe = (angle: number, height: number, range: number): number | null => {
      if (!world) return null;
      _probe.set(player.position.x, player.position.y + height, player.position.z);
      yawToForward(bodyYaw + angle, _dir);
      const hit = world.raycast(_probe, _dir, range, MASK_MOVEMENT, player.id);
      return hit ? Math.max(0, hit.distance - HUMAN_METRICS.radius) : null;
    };
    const forwardM = probe(0, 0.9, OBSTACLE_PROBE_M);
    const forwardHigh =
      forwardM !== null && forwardM < 1.4 ? probe(0, 1.75, forwardM + 0.9) : 0;
    const obstacles = {
      forwardM: forwardM === null ? null : round1(forwardM),
      leftM: nullable(probe(Math.PI / 2, 0.9, OBSTACLE_PROBE_M)),
      rightM: nullable(probe(-Math.PI / 2, 0.9, OBSTACLE_PROBE_M)),
      backM: nullable(probe(Math.PI, 0.9, OBSTACLE_PROBE_M)),
      forwardClimbable: forwardM !== null && forwardM < 1.4 && forwardHigh === null,
    };

    /* ------------------------------------------------ objective */
    const mode = useGameStore.getState().mode;
    const objective = this.objective(mode, aimYaw);

    /* -------------------------------------------------- player */
    const motion = rigState.mantling
      ? "climbing"
      : rigState.sliding
        ? "sliding"
        : !player.grounded
          ? "airborne"
          : rigState.sprinting && player.speed > 4.6
            ? "sprinting"
            : player.speed < 0.35
              ? "still"
              : player.speed > 3.1
                ? "running"
                : "walking";
    const playerObs: JevObservation["player"] = {
      alive: player.alive,
      health: round1(THREE.MathUtils.clamp(player.health, 0, 1000)),
      headingDeg: round1((((-aimYaw * RAD) % 360) + 360) % 360),
      pitchDeg: round1(THREE.MathUtils.clamp(aimPitch * RAD, -90, 90)),
      speedMps: round1(Math.min(100, player.speed)),
      stance: player.stance,
      motion,
      grounded: player.grounded,
      adsProgress: Math.round(THREE.MathUtils.clamp(game.adsProgress, 0, 1) * 100) / 100,
    };
    // The heading wraps to exactly 360 when rounded up; the schema is [0, 360].
    const magSize = Math.max(1, Math.round(hud.magSize));
    const runtime = rigState.weapon;
    const spread = runtime
      ? runtime.spreadDeg(player.stance, player.speed, !player.grounded)
      : 0;
    const settled = runtime ? runtime.settledSpreadDeg(player.stance) : 0;
    const weapon: JevObservation["weapon"] = {
      slot: rigState.slot,
      weaponClass: rigState.weaponClass,
      fireMode: rigState.fireMode,
      ammo: Math.min(magSize, Math.max(0, Math.round(hud.ammo))),
      magSize,
      reserve: Math.max(0, Math.round(hud.reserve)),
      reloading: hud.reloading,
      canFire: !rigState.firingBlocked,
      spreadDeg: Math.round(THREE.MathUtils.clamp(spread, 0, 45) * 100) / 100,
      aimedSpreadDeg: Math.round(THREE.MathUtils.clamp(settled, 0, 45) * 100) / 100,
    };

    const director = game.matchDirector;
    const blue = Math.max(0, Math.floor(hud.scoreBlue));
    const red = Math.max(0, Math.floor(hud.scoreRed));
    const phase = director?.phase;

    return {
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      actionContract: ACTION_CONTRACT_VERSION,
      sequence: input.sequence,
      control: input.control,
      match: {
        mode,
        phase:
          phase === "warmup" ||
          phase === "live" ||
          phase === "overtime" ||
          phase === "post"
            ? phase
            : "live",
        timeRemainingS: round1(THREE.MathUtils.clamp(hud.timeRemaining, 0, 7200)),
        team: player.team,
        ownScore: player.team === "blue" ? blue : red,
        enemyScore: player.team === "blue" ? red : blue,
      },
      player: playerObs,
      weapon,
      perception: {
        visibleEnemies: listed.map(({ id: _id, ...enemy }) => enemy),
        contacts: contacts
          .slice(0, MAX_CONTACTS)
          .map(({ key: _key, ...contact }) => contact),
        damage,
        obstacles,
      },
      objective,
      previous: {
        frame: input.previousFrame,
        outcome: input.previousOutcome,
      },
      legal: legalActionsFor(playerObs, weapon, {
        control: input.control,
        visibleEnemies: listed.length,
      }),
    };
  }

  private objective(
    mode: JevObservation["match"]["mode"],
    aimYaw: number,
  ): JevObservation["objective"] {
    const none: JevObservation["objective"] = {
      kind: "none",
      bearingDeg: null,
      distanceM: null,
      state: null,
    };
    const zones = game.hud.objectiveZones;
    if ((mode !== "domination" && mode !== "hardpoint") || zones.length === 0)
      return none;
    const player = game.player;
    const distanceTo = (zone: (typeof zones)[number]): number =>
      Math.hypot(zone.x - player.position.x, zone.z - player.position.z);
    let zone: (typeof zones)[number] | undefined;
    if (mode === "hardpoint") {
      const active = game.hud.activeHardpoint;
      zone = active === null ? undefined : zones[active];
    } else {
      const unheld = zones.filter((z) => z.owner !== player.team || z.contested);
      zone = (unheld.length > 0 ? unheld : zones)
        .slice()
        .sort((a, b) => distanceTo(a) - distanceTo(b) || (a.id < b.id ? -1 : 1))[0];
    }
    if (!zone) return none;
    return {
      kind: mode === "hardpoint" ? "hardpoint" : "zone",
      bearingDeg: round1(
        bearingTo(aimYaw, zone.x - player.position.x, zone.z - player.position.z),
      ),
      distanceM: round1(Math.min(5000, distanceTo(zone))),
      state: zone.contested
        ? "contested"
        : zone.owner === null
          ? "neutral"
          : zone.owner === player.team
            ? "friendly"
            : "enemy",
    };
  }
}

function nullable(value: number | null): number | null {
  return value === null ? null : round1(value);
}
