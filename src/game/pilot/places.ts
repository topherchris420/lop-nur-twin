import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import {
  HUMAN_METRICS,
  MASK_MOVEMENT,
  MASK_SIGHT,
  forwardToYaw,
  yawDelta,
} from "../core/types";
import { MAX_PLACES, type Place, type PlaceKind } from "./observation";

/**
 * The places a brain may send the body to, under places navigation.
 *
 * Found from geometry and from the threats the observation already reports —
 * the enemies in view, the remembered sightings and gunfire, the direction of
 * the last hit — and nothing else. No hidden enemy, no bot plan, no spawn is
 * consulted: "hidden" means hidden from the threats the brain was told about,
 * which may not be all the threats there are. That is the player's problem as
 * much as the brain's.
 *
 * The search is deterministic: a fixed ring of candidate points around the
 * player, tested in a fixed order. A candidate must have standing room and a
 * body-width straight walk, because the navigator walks straight lines; a place it could only
 * reach by pathfinding is not offered.
 *
 * Each kind keeps its best candidate:
 *
 *  - `cover` — hidden, nearest (route exposure breaking ties);
 *  - `advance` — hidden, at least 4 m nearer the nearest threat;
 *  - `flank` — hidden, at least 35° round the nearest threat from where the
 *    player stands, and not further from it;
 *  - `withdraw` — hidden, at least 5 m further from the nearest threat;
 *  - `objective` — the objective zone's centre, when the mode has one.
 *
 * The list is sorted nearest first and capped at `MAX_PLACES`. Its order says
 * nothing about which to choose.
 */

export const PLACE_ORDERS = ["nearest", "shuffled"] as const;
export type PlaceOrder = (typeof PLACE_ORDERS)[number];

/**
 * The same places in a seeded random order. Slot order is presentation, and
 * presentation can steer a model: this exists to measure whether it does.
 */
export function shufflePlaces<T>(places: readonly T[], seed: number): T[] {
  const out = [...places];
  const next = mulberry32(seed >>> 0);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** What the finder may ask of the world: the same queries the bots use. */
export interface PlaceWorld {
  groundAt(x: number, z: number): number;
  isPositionFree(position: THREE.Vector3, radius: number, height: number): boolean;
  raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    mask: number,
    ignoreEntity: number | null,
  ): { distance: number } | null;
  hasLineOfSight(
    from: THREE.Vector3,
    to: THREE.Vector3,
    mask: number,
    ignoreEntity: number | null,
  ): boolean;
}

/** A known threat's position: an enemy in view, a sighting, a shot heard. */
export interface Threat {
  x: number;
  /** Ground height at the threat; its eye is taken as a standing eye above it. */
  y: number;
  z: number;
}

/** A place with the world point the navigator will walk to. Never sent. */
export interface FoundPlace extends Place {
  x: number;
  z: number;
}

const RINGS_M = [5, 9, 14, 20, 27];
const SPOKES = 16;
/** Only the nearest few threats are tested; each costs raycasts per candidate. */
const MAX_THREATS = 3;
const ROUTE_SAMPLES = 4;
/** A bounded local geometry query, not an unbounded path search. */
export const MAX_PLACE_ROUTE_M = 128;

/**
 * Conservative straight-walk check. Three body-width rays at three heights
 * reject thin geometry between capsule samples; metre-spaced standing capsule
 * and terrain samples reject low ceilings and abrupt terrain. This is sampled
 * reachability, not a pathfinding guarantee. Only geometry is consulted.
 */
export function canWalkTo(
  world: PlaceWorld,
  from: { x: number; y: number; z: number; id: number | null },
  to: { x: number; z: number },
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance > MAX_PLACE_ROUTE_M) return false;
  const steps = Math.max(1, Math.ceil(distance));
  const radius = HUMAN_METRICS.radius;
  const ground = world.groundAt(from.x, from.z);
  const endGround = world.groundAt(to.x, to.z);
  if (distance > 0) {
    const sx = -dz / distance;
    const sz = dx / distance;
    _dir.set(dx, endGround - ground, dz);
    const length = _dir.length();
    _dir.normalize();
    for (const offset of [-radius, 0, radius]) {
      for (const height of [radius, 0.9, HUMAN_METRICS.eyeHeight.stand]) {
        _from.set(from.x + sx * offset, ground + height, from.z + sz * offset);
        if (world.raycast(_from, _dir, length, MASK_MOVEMENT, from.id)) return false;
      }
    }
  }
  let previousGround = ground;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const y = world.groundAt(x, z);
    if (!Number.isFinite(y)) return false;
    const rise = Math.abs(y - previousGround);
    const run = distance / steps;
    if (
      rise > HUMAN_METRICS.stepHeight &&
      rise > run * Math.tan(HUMAN_METRICS.maxSlope)
    ) {
      return false;
    }
    _point.set(x, y, z);
    if (!world.isPositionFree(_point, radius, HUMAN_METRICS.colliderHeight.stand))
      return false;
    previousGround = y;
  }
  return true;
}

const _eye = new THREE.Vector3();
const _point = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

const round1 = (value: number): number => Math.round(value * 10) / 10;

function threatEye(threat: Threat, out: THREE.Vector3): THREE.Vector3 {
  return out.set(threat.x, threat.y + HUMAN_METRICS.eyeHeight.stand, threat.z);
}

function seenByAny(
  world: PlaceWorld,
  threats: readonly Threat[],
  x: number,
  y: number,
  z: number,
  ignore: number | null,
): boolean {
  _point.set(x, y, z);
  for (const threat of threats) {
    if (world.hasLineOfSight(threatEye(threat, _eye), _point, MASK_SIGHT, ignore)) {
      return true;
    }
  }
  return false;
}

interface Candidate {
  x: number;
  y: number;
  z: number;
  distance: number;
  hidden: boolean;
  threatDistance: number | null;
}

export function findPlaces(
  world: PlaceWorld,
  player: { x: number; y: number; z: number; id: number | null },
  aimYaw: number,
  knownThreats: readonly Threat[],
  objective: { x: number; z: number } | null,
): FoundPlace[] {
  const threats = [...knownThreats]
    .sort(
      (a, b) =>
        Math.hypot(a.x - player.x, a.z - player.z) -
        Math.hypot(b.x - player.x, b.z - player.z),
    )
    .slice(0, MAX_THREATS);
  const nearest = threats[0] ?? null;
  const threatDistance = (x: number, z: number): number | null =>
    nearest ? Math.hypot(nearest.x - x, nearest.z - z) : null;
  const here = threatDistance(player.x, player.z);

  /** Metres of the straight walk from the player that some threat can see. */
  const routeExposure = (x: number, z: number, distance: number): number => {
    if (threats.length === 0) return 0;
    let seen = 0;
    for (let i = 1; i <= ROUTE_SAMPLES; i += 1) {
      const t = i / (ROUTE_SAMPLES + 1);
      const px = player.x + (x - player.x) * t;
      const pz = player.z + (z - player.z) * t;
      const py = world.groundAt(px, pz) + HUMAN_METRICS.eyeHeight.stand;
      if (seenByAny(world, threats, px, py, pz, player.id)) seen += 1;
    }
    return (seen / ROUTE_SAMPLES) * distance;
  };

  const describe = (c: Candidate, kind: PlaceKind): FoundPlace => ({
    kind,
    // Route exposure is measured for the few places that are listed, not for
    // every candidate: it is the expensive fact.
    bearingDeg: round1(
      -yawDelta(aimYaw, forwardToYaw(c.x - player.x, c.z - player.z)) * (180 / Math.PI),
    ),
    distanceM: round1(c.distance),
    hidden: c.hidden,
    routeExposedM: round1(routeExposure(c.x, c.z, c.distance)),
    threatDistanceM: c.threatDistance === null ? null : round1(c.threatDistance),
    x: c.x,
    z: c.z,
  });

  const best: Partial<Record<PlaceKind, { place: Candidate; score: number }>> = {};
  const keep = (kind: PlaceKind, place: Candidate, score: number): void => {
    const current = best[kind];
    if (!current || score > current.score) best[kind] = { place, score };
  };

  if (threats.length > 0) {
    const awayYaw = nearest ? Math.atan2(player.z - nearest.z, player.x - nearest.x) : 0;
    for (let ring = 0; ring < RINGS_M.length; ring += 1) {
      const radius = RINGS_M[ring]!;
      for (let spoke = 0; spoke < SPOKES; spoke += 1) {
        // Stagger alternate rings so the spokes do not line up.
        const angle = ((spoke + (ring % 2) * 0.5) / SPOKES) * Math.PI * 2;
        const x = player.x + Math.cos(angle) * radius;
        const z = player.z + Math.sin(angle) * radius;
        const y = world.groundAt(x, z);
        _point.set(x, y, z);
        if (
          !world.isPositionFree(
            _point,
            HUMAN_METRICS.radius,
            HUMAN_METRICS.colliderHeight.stand,
          )
        ) {
          continue;
        }
        // A straight walk: nothing at waist height between here and there.
        _from.set(player.x, player.y + 0.9, player.z);
        _dir.set(x - player.x, 0, z - player.z).normalize();
        if (world.raycast(_from, _dir, radius, MASK_MOVEMENT, player.id)) continue;
        const hidden = !seenByAny(
          world,
          threats,
          x,
          y + HUMAN_METRICS.eyeHeight.stand,
          z,
          player.id,
        );
        if (!hidden) continue;
        if (!canWalkTo(world, player, { x, z })) continue;
        const candidate: Candidate = {
          x,
          y,
          z,
          distance: radius,
          hidden,
          threatDistance: threatDistance(x, z),
        };
        keep("cover", candidate, -radius);
        if (here !== null && candidate.threatDistance !== null && nearest) {
          const closer = here - candidate.threatDistance;
          if (closer >= 4) keep("advance", candidate, closer - radius * 0.3);
          if (closer <= -5) keep("withdraw", candidate, -closer - radius * 0.3);
          const around = Math.abs(
            yawDelta(awayYaw, Math.atan2(z - nearest.z, x - nearest.x)),
          );
          if (around >= (35 * Math.PI) / 180 && closer >= -2) {
            keep("flank", candidate, around * 20 - radius * 0.3 + closer * 0.2);
          }
        }
      }
    }
  }

  const places: FoundPlace[] = [];
  for (const kind of ["cover", "advance", "flank", "withdraw"] as const) {
    const found = best[kind];
    if (!found) continue;
    // One point is one place: a spot that is both nearest cover and the best
    // advance is listed once, under the first kind that claimed it.
    if (places.some((p) => p.x === found.place.x && p.z === found.place.z)) continue;
    places.push(describe(found.place, kind));
  }
  if (objective && canWalkTo(world, player, objective)) {
    const y = world.groundAt(objective.x, objective.z);
    const distance = Math.hypot(objective.x - player.x, objective.z - player.z);
    const hidden =
      threats.length === 0 ||
      !seenByAny(
        world,
        threats,
        objective.x,
        y + HUMAN_METRICS.eyeHeight.stand,
        objective.z,
        player.id,
      );
    places.push(
      describe(
        {
          x: objective.x,
          y,
          z: objective.z,
          distance,
          hidden,
          threatDistance: threatDistance(objective.x, objective.z),
        },
        "objective",
      ),
    );
  }
  places.sort((a, b) => a.distanceM - b.distanceM || (a.kind < b.kind ? -1 : 1));
  return places.slice(0, MAX_PLACES);
}
