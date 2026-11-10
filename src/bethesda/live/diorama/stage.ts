/**
 * The clay model of Bethesda that `/live` photographs: its scale, its lens,
 * and how a reported mode becomes a puppet's posture. Nothing here draws, and
 * nothing here decides anything about the fly: these are the picture's own
 * conventions, kept in one place so the scene, the overlay and the tests
 * agree on them.
 *
 * The city is a tabletop model at 1 : 400, so a block is the size of a hand
 * and a thumbprint in the clay is eight metres of street. The fly is a
 * puppet enlarged until it can be seen: at true scale it would be seven
 * micrometres long.
 */
import { GROOM_ROUTINES, type GroomRoutine, type Mode } from "../../fly/neural.js";
import { STEPPING_MIN_CMS, stepPeriodS, type GaitParams } from "../../fly/gait.js";
import { buildingAt, type Point } from "../../model.js";
import { groundAt, maximumGround } from "../../terrain.js";

/** Model metres per city metre. */
export const MODEL_SCALE = 1 / 400;

/** The lens: a long one, as a miniature is photographed. */
export const LENS = { fovDeg: 24, near: 0.02, far: 40 } as const;

/**
 * Zoom is CSS pixels per city metre at the fly, as it was on the flat map.
 * The model goes a little closer than the map did; past this the clay's hand
 * marks would be larger than the streets.
 */
export const ZOOM = { min: 1, max: 36, start: 8, step: 1.5 } as const;

export const clampZoom = (z: number) =>
  Number.isFinite(z) ? Math.min(ZOOM.max, Math.max(ZOOM.min, z)) : ZOOM.start;

/** How far the camera stands from the fly (model metres) for a zoom, on a view `heightPx` CSS pixels tall. */
export function cameraDistance(zoom: number, heightPx: number): number {
  const visible = (Math.max(1, heightPx) / clampZoom(zoom)) * MODEL_SCALE;
  return visible / (2 * Math.tan((LENS.fovDeg * Math.PI) / 360));
}

/** The puppet is kept at least this long on screen (CSS px) while its enlargement allows. */
export const PUPPET_MIN_PX = 104;
/** The most the puppet is enlarged over the model's own scale: a fly as long as a bus. */
export const PUPPET_MAX_CITY_M = 14;

/**
 * The puppet's body length in city metres at a zoom: long enough to be seen,
 * never longer than a bus. Not to scale at any zoom: the fly is about 3 mm.
 */
export function puppetCityLength(zoom: number): number {
  return Math.min(PUPPET_MAX_CITY_M, PUPPET_MIN_PX / clampZoom(zoom));
}

/** How the puppet is posed for a mode the life reports. */
export interface Posture {
  mode: Mode;
  groom: GroomRoutine | null;
  /** 0 retracted (flight) … 1 extended. */
  legs: number;
  /** 0 folded … 1 spread. */
  wingsOpen: number;
  beating: boolean;
  /** 0 folded … 1 extended to the surface. */
  proboscis: number;
  /** In the air: the puppet is lifted clear of the model so it reads as flying. */
  airborne: boolean;
}

const STANDING: Posture = {
  mode: "rest",
  groom: null,
  legs: 1,
  wingsOpen: 0,
  beating: false,
  proboscis: 0,
  airborne: false,
};
const FLYING: Posture = {
  mode: "flight",
  groom: null,
  legs: 0,
  wingsOpen: 1,
  beating: true,
  proboscis: 0,
  airborne: true,
};

const isRoutine = (v: string | undefined): v is GroomRoutine =>
  (GROOM_ROUTINES as readonly string[]).includes(v ?? "");

/**
 * The posture for a reported mode ("rest", "groom/eyes", "flight/cruise",
 * "land/legs extended"). A mode this page does not know is drawn standing
 * still: the words beside the picture still say what the life reported.
 */
export function postureOf(reported: string): Posture {
  const [head, sub] = reported.split("/");
  switch (head) {
    case "flight":
      return FLYING;
    case "escape":
      return { ...FLYING, mode: "escape" };
    case "takeoff":
      // Preparing, it is still on its feet with its wings raised.
      return sub === "prepare"
        ? { ...STANDING, mode: "takeoff", wingsOpen: 1 }
        : { ...FLYING, mode: "takeoff", legs: 0.5 };
    case "land":
      return { ...FLYING, mode: "land", legs: sub === "legs extended" ? 1 : 0.4 };
    case "walk":
      return { ...STANDING, mode: "walk" };
    case "feed":
      return { ...STANDING, mode: "feed", proboscis: 1 };
    case "groom":
      return { ...STANDING, mode: "groom", groom: isRoutine(sub) ? sub : "front legs" };
    default:
      return STANDING;
  }
}

/**
 * The gait clock a walking puppet's legs run on: advanced on the picture's
 * own clock at the step period of the reported speed. Presentation only; the
 * life sends where the fly is, not where each foot is.
 */
export function advanceGait(
  clock: number,
  speedCmS: number,
  dt: number,
  gait: GaitParams,
): number {
  if (!(speedCmS >= STEPPING_MIN_CMS) || !(dt > 0)) return clock;
  return (clock + dt / stepPeriodS(speedCmS, gait)) % 1;
}

// ------------------------------------------------------------------ figures

/** A pedestrian or vehicle the life reports near the fly. */
export interface Agent {
  kind: string;
  x: number;
  z: number;
}

/** No walker covers more than this between two observations, and no vehicle more than that (m). */
const SAME_WALKER_M = 5;
const SAME_VEHICLE_M = 30;

/**
 * For each of `next`, where it stood in `prev`: the nearest of the same kind
 * not already claimed, if one is near enough to be the same figure.
 */
export function matchAgents(
  prev: readonly Agent[],
  next: readonly Agent[],
): (Point | null)[] {
  const taken = new Set<number>();
  return next.map((b) => {
    const reach = b.kind === "pedestrian" ? SAME_WALKER_M : SAME_VEHICLE_M;
    let best = -1,
      bestD = reach;
    prev.forEach((a, i) => {
      if (a.kind !== b.kind || taken.has(i)) return;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return null;
    taken.add(best);
    return { x: prev[best]!.x, z: prev[best]!.z };
  });
}

// ------------------------------------------------------------- lines of sight

/** The taller buildings' height above the highest ground: past this nothing is in the way (city m). */
const CLEAR_ABOVE = maximumGround + 110;

/**
 * Whether a building stands between a point (city metres) and a lens looking
 * at it from `azimuth` and `pitch`, `reach` city metres away. A point inside
 * a building, below its roof, is hidden from every angle.
 */
export function buildingInTheWay(
  p: { x: number; y: number; z: number },
  azimuth: number,
  pitch: number,
  reach: number,
): boolean {
  const c = Math.cos(pitch);
  const dx = Math.sin(azimuth) * c,
    dy = Math.sin(pitch),
    dz = Math.cos(azimuth) * c;
  for (let s = 0; s <= reach; s += 2) {
    const y = p.y + dy * s;
    if (y > CLEAR_ABOVE) return false;
    const b = buildingAt({ x: p.x + dx * s, z: p.z + dz * s });
    if (b && y < groundAt(b.center) + b.height) return true;
  }
  return false;
}
