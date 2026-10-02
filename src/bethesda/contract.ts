/** Provider-facing data only: no renderer or authoritative world imports. */
export const CITY_SCHEMA = "bethesda-observation/v2" as const;
export const ACTIONS = [
  "continue",
  "wait",
  "watch",
  "record",
  "leave",
  "shelter",
  "enter",
  "gather",
  "cross",
  "board",
  "drive",
  "detour",
  "stop",
  "pull_over",
  "park",
  "respond",
] as const;
export type Action = (typeof ACTIONS)[number];
export type AgentKind = "pedestrian" | "vehicle" | "emergency";
/** What the agent is, not what it should do. Closed so a provider cannot widen it. */
export const ROLES = ["walker", "car", "bus", "engine", "ambulance", "police"] as const;
export type Role = (typeof ROLES)[number];
/** Seeded routine families. Illustrative, not a survey of who is in Bethesda. */
export const PERSONAS = [
  "commuter",
  "shopper",
  "resident",
  "worker",
  "visitor",
  "none",
] as const;
export type Persona = (typeof PERSONAS)[number];
export const EVENT_KINDS = [
  "fire",
  "storm",
  "metro-closure",
  "parade",
  "object",
  "crash",
  "outage",
  "gas-leak",
  "rally",
  "festival",
  "road-closure",
  "flood",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
/** Coarse crowd bucket: none, a few (1–3), a crowd (4–11), dense (12+) within 15 m. */
export type CrowdLevel = 0 | 1 | 2 | 3;
export interface Observation {
  schema: typeof CITY_SCHEMA;
  sequence: number;
  tick: number;
  agentId: number;
  kind: AgentKind;
  role: Role;
  persona: Persona;
  /** The nearest event the agent should avoid, if any. */
  hazard: EventKind | null;
  hazardDistance: number | null;
  insidePerimeter: boolean;
  /** The nearest event that draws attention (may be the same event). */
  attraction: EventKind | null;
  attractionDistance: number | null;
  sheltering: boolean;
  trafficNearby: boolean;
  emergencyApproaching: boolean;
  crossing: boolean;
  safeToCross: boolean;
  signalDark: boolean;
  blocked: boolean;
  routeClosed: boolean;
  atPortal: boolean;
  atGathering: boolean;
  atBusStop: boolean;
  busBoarding: boolean;
  atMetro: boolean;
  metroOpen: boolean;
  assigned: boolean;
  crowd: CrowdLevel;
  candidates: Action[];
}
export interface Proposal {
  sequence: number;
  agentId: number;
  action: Action;
  model: string;
  confidence: number;
  probabilities: Record<string, number>;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (v: unknown, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
export const FLAGS = [
  "insidePerimeter",
  "sheltering",
  "trafficNearby",
  "emergencyApproaching",
  "crossing",
  "safeToCross",
  "signalDark",
  "blocked",
  "routeClosed",
  "atPortal",
  "atGathering",
  "atBusStop",
  "busBoarding",
  "atMetro",
  "metroOpen",
  "assigned",
] as const;
/**
 * Mechanics, never tactics: an action is offered when the simulator can carry
 * it out from here. Whether it is wise is the chooser's question.
 */
export function legalActions(o: Omit<Observation, "candidates">): Action[] {
  if (o.kind !== "pedestrian")
    return [
      "stop",
      ...(o.blocked ? [] : ["drive" as const]),
      ...(o.routeClosed || o.blocked ? ["detour" as const] : []),
      "pull_over",
      "park",
      ...(o.kind === "emergency" && o.assigned ? ["respond" as const] : []),
    ];
  const actions: Action[] = ["wait", "watch", "record"];
  if (!o.crossing || o.safeToCross) actions.push("continue", "leave", "shelter");
  if (o.crossing && o.safeToCross) actions.push("cross");
  if (o.atPortal || (o.atMetro && o.metroOpen)) actions.push("enter");
  if (o.atGathering || o.atBusStop) actions.push("gather");
  if (o.busBoarding) actions.push("board");
  return actions;
}
const distanceOK = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3000);
export function validateObservation(v: unknown): v is Observation {
  if (
    !record(v) ||
    v.schema !== CITY_SCHEMA ||
    !integer(v.sequence, 1e9) ||
    !integer(v.tick, 1e9) ||
    !integer(v.agentId, 10000) ||
    typeof v.kind !== "string" ||
    !["pedestrian", "vehicle", "emergency"].includes(v.kind) ||
    !ROLES.includes(v.role as Role) ||
    !PERSONAS.includes(v.persona as Persona) ||
    !integer(v.crowd, 3)
  )
    return false;
  for (const k of ["hazard", "attraction"])
    if (v[k] !== null && !EVENT_KINDS.includes(v[k] as EventKind)) return false;
  if (!distanceOK(v.hazardDistance) || !distanceOK(v.attractionDistance)) return false;
  if ((v.hazard === null) !== (v.hazardDistance === null)) return false;
  if ((v.attraction === null) !== (v.attractionDistance === null)) return false;
  if (!FLAGS.every((k) => typeof v[k] === "boolean")) return false;
  // Every field is closed; an extra key is a provider-facing channel we did not design.
  const keys = new Set([
    "schema",
    "sequence",
    "tick",
    "agentId",
    "kind",
    "role",
    "persona",
    "hazard",
    "hazardDistance",
    "attraction",
    "attractionDistance",
    "crowd",
    "candidates",
    ...FLAGS,
  ]);
  if (Object.keys(v).some((k) => !keys.has(k))) return false;
  if (
    !Array.isArray(v.candidates) ||
    !v.candidates.length ||
    v.candidates.length > ACTIONS.length ||
    new Set(v.candidates).size !== v.candidates.length
  )
    return false;
  const allowed = legalActions(v as unknown as Observation);
  return v.candidates.every((a) => allowed.includes(a as Action));
}
export function validateProposal(v: unknown, o: Observation): v is Proposal {
  if (
    !record(v) ||
    v.sequence !== o.sequence ||
    v.agentId !== o.agentId ||
    !o.candidates.includes(v.action as Action) ||
    typeof v.model !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,95}$/.test(v.model)
  )
    return false;
  if (
    typeof v.confidence !== "number" ||
    !Number.isFinite(v.confidence) ||
    v.confidence < 0 ||
    v.confidence > 1 ||
    !record(v.probabilities)
  )
    return false;
  const entries = Object.entries(v.probabilities);
  if (
    entries.length !== o.candidates.length ||
    entries.some(
      ([a, p]) =>
        !o.candidates.includes(a as Action) ||
        typeof p !== "number" ||
        !Number.isFinite(p) ||
        p < 0 ||
        p > 1,
    )
  )
    return false;
  const values = entries.map(([, p]) => p as number);
  return (
    Math.abs(values.reduce((s, p) => s + p, 0) - 1) < 0.02 &&
    (v.probabilities[v.action as string] as number) >= Math.max(...values) - 1e-5
  );
}
/** Semantics only: what the simulator does, never when to choose it. */
export const DESCRIPTIONS: Record<Action, string> = {
  continue: "Follow the current sidewalk route.",
  wait: "Stay at the current position.",
  watch: "Pause to observe a local event.",
  record: "Pause to record the local event (abstract behavior).",
  leave: "Follow a reachable route away from the nearest event.",
  shelter: "Route to a nearby building portal.",
  enter: "Enter the adjacent portal (building or open Metro entrance) and dwell inside.",
  gather: "Dwell at the public gathering point or bus stop here.",
  cross: "Traverse the crossing if safety checks pass.",
  board: "Board the bus dwelling at this stop and ride out of view.",
  drive: "Continue along permitted, open road edges.",
  detour: "Turn around if needed and route around closed road edges.",
  stop: "Brake and stay in the current lane.",
  pull_over: "Brake and move toward the curb.",
  park: "Pull toward the curb and dwell.",
  respond: "Route toward the assigned incident and stage at its perimeter.",
};
