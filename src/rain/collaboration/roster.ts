/**
 * Who holds each research responsibility in a collaboration episode.
 *
 * The four perspectives keep the identities `meeting/perspectives.ts` gives
 * them; this roster only assigns responsibilities to them by name and never
 * edits them. Their agent ids carry a `rain-` prefix so that the R.A.I.N.
 * perspective named James is never confused with the James desktop
 * application (whose agents are `james-desktop` records).
 *
 * Independence rule: whoever proposes a hypothesis may not also criticise,
 * falsify or verify it. Replication and memory revision are host seats: the
 * host re-executes on fresh simulators and writes the ledger, as the
 * experimenter and archivist seats already do in `autonomy/roles.ts`.
 *
 * Imports only pure modules; server and scripts only by convention.
 */
import { PERSPECTIVES, TEAM, type Perspective } from "../meeting/perspectives.js";
import { sha256Json } from "../sha256.js";

export const ROSTER_VERSION = "rain-collab-roster/v1" as const;
export const RESPONSIBILITIES = [
  "hypothesis",
  "design",
  "criticism",
  "falsification",
  "replication",
  "verification",
  "memory_revision",
] as const;
export type Responsibility = (typeof RESPONSIBILITIES)[number];

export interface Seat {
  responsibility: Responsibility;
  holder: Perspective | "host";
  agent_id: string;
  why: string;
}

export const agentIdOf = (p: Perspective | "host") =>
  p === "host" ? "host" : `rain-${p.toLowerCase()}`;

const seat = (
  responsibility: Responsibility,
  holder: Perspective | "host",
  why: string,
): Seat => ({
  responsibility,
  holder,
  agent_id: agentIdOf(holder),
  why,
});

export const ROSTER: readonly Seat[] = [
  seat(
    "hypothesis",
    "James",
    "Lead Scientist and pattern-seeker in R.A.I.N.'s team: proposes.",
  ),
  seat("design", "Luca", "Field Topographer / Theorist: shapes the geometry of a test."),
  seat(
    "criticism",
    "Jasmine",
    "The team's sceptical devil's advocate: objects before anything is believed.",
  ),
  seat(
    "falsification",
    "Jasmine",
    "Designs the experiment most likely to prove the claim wrong.",
  ),
  seat(
    "verification",
    "Elena",
    "Math purist: re-checks records, digests and numerical error.",
  ),
  seat(
    "replication",
    "host",
    "The host re-executes on fresh simulators with perturbed numerics.",
  ),
  seat(
    "memory_revision",
    "host",
    "The host writes the claim ledger; revisions supersede, never delete.",
  ),
];

export function holderOf(r: Responsibility): Seat {
  const s = ROSTER.find((x) => x.responsibility === r);
  if (!s) throw new Error(`no seat for ${r}`);
  return s;
}

/** The roster record whose digest every episode and result carries. */
export function rosterRecord() {
  return {
    schema: ROSTER_VERSION,
    seats: ROSTER.map((s) => ({ ...s })),
    perspectives: TEAM.map((m) => ({ name: m.name, role: m.role })),
  };
}
export const rosterSha256 = () => sha256Json(rosterRecord());

/** Every perspective is a known one, and the independence rule holds. */
export function rosterErrors(): string[] {
  const errors: string[] = [];
  for (const s of ROSTER)
    if (s.holder !== "host" && !(PERSPECTIVES as readonly string[]).includes(s.holder))
      errors.push(`${s.responsibility}: unknown perspective ${s.holder}`);
  const proposer = holderOf("hypothesis").holder;
  for (const r of ["criticism", "falsification", "verification"] as const)
    if (holderOf(r).holder === proposer)
      errors.push(`${r} is held by the proposer, ${proposer}`);
  return errors;
}
