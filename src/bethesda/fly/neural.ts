/**
 * The seam between whatever decides what the fly does and the body that does
 * it.
 *
 * A `FlyNeuralAdapter` receives a delayed sensory frame, a snapshot of the
 * body, the landing sites on offer and the fly's parameters, all frozen
 * copies, and returns a `MotorCommand`; it may also answer every sensory
 * sample between decisions (`interrupt`), for a reflex that cannot wait for
 * the next decision. Every command passes `validateCommand` before the body
 * acts on it. The gate never throws: it
 * reads the command once into a plain copy, checks its whole shape and every
 * value, and either accepts that copy or refuses. A refused command (or a
 * decision maker that throws) is counted and logged, and the body switches
 * to a safe hold for its mode: hover in flight or while landing, stop when
 * walking, stay put when perched. It never keeps running the last accepted
 * command. That gate is the only way in: a future connectome-constrained
 * model, a learned policy or a language model plugged in here gets the same
 * bounds and the same transition rules as the built-in controller, and cannot
 * move the fly, pick a state the body is not in, land anywhere it was not
 * offered, or reach the world.
 *
 * The built-in adapter (`controller.ts`) is a reduced-order behavioural state
 * machine. It simulates no neurons. Its `regions` list says which brain
 * structures carry the function each module stands in for in the real fly,
 * as published associations, with the VFB terms to look them up; it is a
 * reading list, not a claim that those circuits are simulated.
 */
import type { ResolvedParams } from "./params.js";
import type { SenseFrame } from "./senses.js";
import type { V3 } from "./units.js";
import type { LandingSite, Perch } from "./world.js";

export const MODES = [
  "rest",
  "groom",
  "walk",
  "takeoff",
  "escape",
  "flight",
  "land",
] as const;
export type Mode = (typeof MODES)[number];
export const PERCHED: ReadonlySet<Mode> = new Set(["rest", "groom", "walk"]);
/** The body sites a fly grooms, front to back (the order of Seeds et al. 2014's dust cascade). */
export const GROOM_SITES = ["eyes", "antennae", "abdomen", "wings", "notum"] as const;
/**
 * Every grooming routine: a body site, or the legs rubbing each other after one
 * (the front pair after the head, the hind pair after the abdomen, wings or notum).
 */
export const GROOM_ROUTINES = [...GROOM_SITES, "front legs", "hind legs"] as const;
export type GroomRoutine = (typeof GROOM_ROUTINES)[number];
export type GroomSite = (typeof GROOM_SITES)[number];
export const FLIGHT_SUBS = ["cruise", "hover", "saccade", "approach"] as const;
export type FlightSub = (typeof FLIGHT_SUBS)[number];

/** Transitions a command may ask for. Touchdown and the end of a jump are physical, not commanded. */
export const COMMANDABLE: Readonly<Record<Mode, readonly Mode[]>> = {
  rest: ["rest", "groom", "walk", "takeoff", "escape"],
  groom: ["groom", "rest", "escape"],
  walk: ["walk", "rest", "takeoff", "escape"],
  takeoff: ["takeoff"],
  escape: ["escape"],
  flight: ["flight", "land"],
  land: ["land", "flight"],
};

export interface MotorCommand {
  mode: Mode;
  /** Flight: desired velocity (m/s, world). */
  velocity?: V3;
  /** Steering yaw rate (rad/s) outside saccades. */
  yawRate?: number;
  /** Start a saccade of this signed amplitude (rad, + left). */
  saccade?: number;
  /** Hold position in the air. */
  hover?: boolean;
  /** Walking speed (cm/s). */
  walkSpeed?: number;
  /** Takeoff or escape heading (rad). */
  heading?: number;
  /**
   * Takeoff or escape preparation: seconds from now to the jump. Sent while a
   * takeoff is already under way, a shorter one brings the jump forward, never
   * later.
   */
  prepare?: number;
  /**
   * Whether the wings rise before the jump (a long-mode takeoff) or stay
   * folded (short mode). Without it, a takeoff prepared in under 0.1 s is
   * short-mode; a takeoff brought forward before its wings began to rise is
   * short-mode unless this says otherwise; once they are rising it stays
   * long-mode.
   */
  wings?: boolean;
  /**
   * The landing site being approached (one of the offered sites, by id), and
   * the point on its top where the feet will touch.
   */
  land?: { id: string; point: V3 };
  groom?: GroomRoutine;
  /** Why, in the controller's words, for the decision log. */
  reason: string;
}

export interface BodySnapshot {
  t: number;
  mode: Mode;
  sub: string;
  modeT: number;
  p: V3;
  v: V3;
  yaw: number;
  altitude: number;
  walkSpeed: number;
  flightT: number;
  flightBout: number;
  responsiveness: number;
  groom: GroomRoutine | null;
  edge: boolean;
  /** The landing target: the point on the surface the feet are to touch. */
  target: { id: string; point: V3 } | null;
  /** Height of the thorax (the body's position) above the surface it stands on (m). */
  standingHeight: number;
  home: { center: V3; radius: number; ceiling: number };
}

export interface DecisionInput {
  body: BodySnapshot;
  frame: SenseFrame;
  sites: readonly LandingSite[];
  params: ResolvedParams;
  dt: number;
}

export interface RegionLink {
  /** A controller module, e.g. "looming escape". */
  module: string;
  /** VFB terms (FBbt classes or JRC2018U painted domains) associated with the function. */
  vfb: string[];
  relation: "functional association (published)";
  note: string;
}

export interface AdapterDescriptor {
  id: string;
  label: string;
  fidelity: string;
  simulatesNeurons: boolean;
  regions: RegionLink[];
}

export interface FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  /** Called once with the body as placed (at rest or in flight), before the first decision. */
  start?(body: BodySnapshot): void;
  /** Must be deterministic given its inputs and the random stream it was built with. */
  decide(input: DecisionInput): MotorCommand;
  /**
   * An optional fast pathway, for a reflex such as the giant-fiber escape: called
   * with every sensory sample that falls between decisions, on the same delayed
   * frame `decide` would get. It offers no new landing sites (only the one being
   * approached). Null (or nothing) lets the current command run on; a command
   * returned here passes the same gate as a decision. Deterministic like
   * `decide`.
   */
  interrupt?(input: DecisionInput): MotorCommand | null;
}

/** Hard limits the body enforces whatever the adapter. Model bounds, wider than any behaviour asked of it. */
export const LIMITS = {
  flightSpeed: 1.5,
  yawRate: Math.PI * 4,
  saccade: Math.PI,
  prepareMin: 0.01,
  prepareMax: 0.5,
  /** How far a landing point may lie from its site's real top (m). */
  landPointTolM: 0.003,
  /** Longest reason the log keeps, and longest site id, in characters. */
  reasonChars: 500,
  idChars: 200,
} as const;

/** What the gate needs to check a landing target against the world. */
export interface GateContext {
  /** The landing sites offered with this decision. */
  sites: readonly LandingSite[];
  /** The world's surface: the highest walkable top at (x, z) at or below `maxY`. */
  surface: (x: number, z: number, maxY: number) => Perch | null;
}

export type Validation =
  { ok: true; command: MotorCommand } | { ok: false; reason: string };

const FIELDS: ReadonlySet<string> = new Set([
  "mode",
  "velocity",
  "yawRate",
  "saccade",
  "hover",
  "walkSpeed",
  "heading",
  "prepare",
  "wings",
  "land",
  "groom",
  "reason",
]);
const LAND_FIELDS: ReadonlySet<string> = new Set(["id", "point"]);
const STEERED: ReadonlySet<Mode> = new Set(["walk", "flight", "land"]);
const AIRBORNE: ReadonlySet<Mode> = new Set(["flight", "land"]);
const LAUNCH: ReadonlySet<Mode> = new Set(["takeoff", "escape"]);

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite 3-vector read once into a fresh array, or null. */
function vector(v: unknown): V3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out: V3 = [v[0], v[1], v[2]];
  return out.every(finite) ? out : null;
}

/**
 * The offered site named `id` whose top holds `point` (inside its rectangle,
 * and within `LIMITS.landPointTolM` of the world's surface there), or null.
 */
export function siteHolding(ctx: GateContext, id: string, point: V3): LandingSite | null {
  for (const site of ctx.sites)
    if (site.id === id && onTop(site, point, ctx)) return site;
  return null;
}

function onTop(site: LandingSite, point: V3, ctx: GateContext): boolean {
  const tol = LIMITS.landPointTolM;
  const dx = point[0] - site.center[0],
    dz = point[2] - site.center[2];
  const c = Math.cos(site.angle),
    s = Math.sin(site.angle);
  // Into the site's frame (the inverse of Three's rotateY).
  const u = dx * c - dz * s,
    w = dx * s + dz * c;
  if (Math.abs(u) > site.half[0] + tol || Math.abs(w) > site.half[1] + tol) return false;
  const top = ctx.surface(point[0], point[2], point[1] + tol);
  return top !== null && top.id === site.id && Math.abs(top.y - point[1]) <= tol;
}

/**
 * Check a decision maker's command against the body's mode, the hard limits,
 * the fly's own parameters and the offered landing sites. Never throws: any
 * malformed input is a refusal. On acceptance it returns the plain copy the
 * body must act on.
 */
export function validateCommand(
  cmd: unknown,
  body: BodySnapshot,
  params: ResolvedParams,
  ctx?: GateContext,
): Validation {
  try {
    return check(cmd, body, params, ctx);
  } catch {
    return { ok: false, reason: "malformed command" };
  }
}

function check(
  raw: unknown,
  body: BodySnapshot,
  params: ResolvedParams,
  ctx: GateContext | undefined,
): Validation {
  const no = (reason: string): Validation => ({ ok: false, reason });
  if (!isObject(raw)) return no("not a command object");
  for (const key of Object.keys(raw))
    if (!FIELDS.has(key)) return no(`unknown field ${key.slice(0, 40)}`);
  // Each field is read exactly once; everything below checks and returns the copy.
  const f = {
    mode: raw.mode,
    velocity: raw.velocity,
    yawRate: raw.yawRate,
    saccade: raw.saccade,
    hover: raw.hover,
    walkSpeed: raw.walkSpeed,
    heading: raw.heading,
    prepare: raw.prepare,
    wings: raw.wings,
    land: raw.land,
    groom: raw.groom,
    reason: raw.reason,
  };
  if (typeof f.mode !== "string" || !(MODES as readonly string[]).includes(f.mode))
    return no(
      `unknown mode ${typeof f.mode === "string" ? f.mode.slice(0, 40) : typeof f.mode}`,
    );
  const mode = f.mode as Mode;
  if (!COMMANDABLE[body.mode].includes(mode))
    return no(`${body.mode} → ${mode} is not a commandable transition`);
  if (typeof f.reason !== "string" || !f.reason) return no("no reason given");
  if (f.reason.length > LIMITS.reasonChars) return no("reason too long");
  const cmd: MotorCommand = { mode, reason: f.reason };

  if (f.velocity !== undefined) {
    const v = vector(f.velocity);
    if (!v) return no("velocity is not a finite 3-vector");
    if (Math.hypot(...v) > LIMITS.flightSpeed)
      return no("velocity exceeds the flight limit");
    if (!AIRBORNE.has(mode)) return no("velocity outside flight");
    cmd.velocity = v;
  }
  if (f.yawRate !== undefined) {
    if (!finite(f.yawRate) || Math.abs(f.yawRate) > LIMITS.yawRate)
      return no("yaw rate out of bounds");
    if (!STEERED.has(mode)) return no("yaw rate outside walking or flight");
    cmd.yawRate = f.yawRate;
  }
  if (f.saccade !== undefined) {
    if (!finite(f.saccade) || Math.abs(f.saccade) > LIMITS.saccade)
      return no("saccade out of bounds");
    if (mode !== "flight") return no("saccade outside flight");
    cmd.saccade = f.saccade;
  }
  if (f.hover !== undefined) {
    if (typeof f.hover !== "boolean") return no("hover is not true or false");
    if (!AIRBORNE.has(mode)) return no("hover outside flight");
    cmd.hover = f.hover;
  }
  if (f.walkSpeed !== undefined) {
    if (!finite(f.walkSpeed) || f.walkSpeed < 0 || f.walkSpeed > params.walkSpeedMaxCmS)
      return no("walking speed out of bounds");
    if (mode !== "walk") return no("walking speed outside walking");
    cmd.walkSpeed = f.walkSpeed;
  }
  if (f.heading !== undefined) {
    if (!finite(f.heading)) return no("heading is not finite");
    if (!LAUNCH.has(mode)) return no("a heading outside a takeoff");
    cmd.heading = f.heading;
  }
  if (f.prepare !== undefined) {
    if (
      !finite(f.prepare) ||
      f.prepare < LIMITS.prepareMin ||
      f.prepare > LIMITS.prepareMax
    )
      return no("preparation time out of bounds");
    if (!LAUNCH.has(mode)) return no("a preparation outside a takeoff");
    cmd.prepare = f.prepare;
  }
  if (f.wings !== undefined) {
    if (typeof f.wings !== "boolean") return no("wings is not true or false");
    if (!LAUNCH.has(mode)) return no("a wing raise outside a takeoff");
    cmd.wings = f.wings;
  }
  if (LAUNCH.has(mode) && body.mode !== mode && cmd.heading === undefined)
    return no("a takeoff needs a heading");
  if (f.groom !== undefined) {
    if (
      typeof f.groom !== "string" ||
      !(GROOM_ROUTINES as readonly string[]).includes(f.groom)
    )
      return no("unknown grooming routine");
    if (mode !== "groom") return no("a grooming routine outside grooming");
    cmd.groom = f.groom as GroomRoutine;
  }
  if (f.land !== undefined) {
    const land = f.land;
    if (!isObject(land)) return no("landing target is not an object");
    for (const key of Object.keys(land))
      if (!LAND_FIELDS.has(key)) return no(`unknown landing field ${key.slice(0, 40)}`);
    const id = land.id;
    const point = vector(land.point);
    if (typeof id !== "string" || !id || id.length > LIMITS.idChars)
      return no("landing site id is not a name");
    if (!point) return no("landing point is not a finite 3-vector");
    if (mode !== "land") return no("a landing target outside landing");
    if (!ctx) return no("no landing sites were offered");
    if (!ctx.sites.some((s) => s.id === id))
      return no(`landing site ${id} was not offered`);
    if (!siteHolding(ctx, id, point))
      return no(`landing point is not on the top of ${id}`);
    cmd.land = { id, point };
  }
  if (mode === "land" && body.mode === "flight" && !cmd.land)
    return no("landing without a target");
  return { ok: true, command: cmd };
}
