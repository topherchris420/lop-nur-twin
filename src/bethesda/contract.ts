/** Provider-facing data only: no renderer or authoritative world imports. */
export const CITY_SCHEMA = "bethesda-observation/v1" as const;
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
  "drive",
  "stop",
  "pull_over",
  "park",
  "respond",
] as const;
export type Action = (typeof ACTIONS)[number];
export type AgentKind = "pedestrian" | "vehicle" | "emergency";
export const EVENT_KINDS = [
  "fire",
  "storm",
  "metro-closure",
  "parade",
  "object",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export interface Observation {
  schema: typeof CITY_SCHEMA;
  sequence: number;
  tick: number;
  agentId: number;
  kind: AgentKind;
  hazard: EventKind | null;
  hazardDistance: number | null;
  trafficNearby: boolean;
  crossing: boolean;
  safeToCross: boolean;
  blocked: boolean;
  atPortal: boolean;
  atGathering: boolean;
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
export function legalActions(o: Omit<Observation, "candidates">): Action[] {
  if (o.kind !== "pedestrian")
    return [
      "stop",
      ...(o.blocked ? [] : ["drive" as const]),
      "pull_over",
      "park",
      ...(o.kind === "emergency" && o.hazard === "fire" ? ["respond" as const] : []),
    ];
  const actions: Action[] = ["wait", "watch", "record"];
  if (!o.crossing || o.safeToCross) actions.push("continue", "leave", "shelter");
  if (o.crossing && o.safeToCross) actions.push("cross");
  if (o.atPortal) actions.push("enter");
  if (o.atGathering) actions.push("gather");
  return actions;
}
export function validateObservation(v: unknown): v is Observation {
  if (
    !record(v) ||
    v.schema !== CITY_SCHEMA ||
    !integer(v.sequence, 1e9) ||
    !integer(v.tick, 1e9) ||
    !integer(v.agentId, 10000) ||
    typeof v.kind !== "string" ||
    !["pedestrian", "vehicle", "emergency"].includes(v.kind)
  )
    return false;
  if (v.hazard !== null && !EVENT_KINDS.includes(v.hazard as EventKind)) return false;
  if (
    v.hazardDistance !== null &&
    (typeof v.hazardDistance !== "number" ||
      !Number.isFinite(v.hazardDistance) ||
      v.hazardDistance < 0 ||
      v.hazardDistance > 3000)
  )
    return false;
  if (
    ![
      "trafficNearby",
      "crossing",
      "safeToCross",
      "blocked",
      "atPortal",
      "atGathering",
    ].every((k) => typeof v[k] === "boolean")
  )
    return false;
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
export const DESCRIPTIONS: Record<Action, string> = {
  continue: "Follow the current sidewalk route.",
  wait: "Stay at the current position.",
  watch: "Pause to observe a local event.",
  record: "Pause to record the local event (abstract behavior).",
  leave: "Follow a reachable route away from the local hazard.",
  shelter: "Route to a nearby building portal.",
  enter: "Enter the adjacent abstract portal and dwell inside.",
  gather: "Dwell at a public gathering point.",
  cross: "Traverse the crossing if safety checks pass.",
  drive: "Continue along permitted road edges.",
  stop: "Brake and stay in the current lane.",
  pull_over: "Brake and move toward the curb.",
  park: "Pull toward the curb and dwell.",
  respond: "Route toward the dispatched fire.",
};
