/** The shapes the Noeterra engine answers with (noeterra/src/views.rs, api.rs). */

export type Pt = [number, number];

export interface Personality {
  aggression: number;
  expansion: number;
  caution: number;
  honor: number;
  mercantile: number;
  diplomacy: number;
}

export interface Civ {
  id: number;
  key: string;
  name: string;
  adjective: string;
  color: string;
  culture: string;
  government: string;
  ruler: string;
  capital: number;
  personality: Personality;
  treasury: number;
  manpower: number;
  stability: number;
  tech: number;
  war_weariness: number;
  prestige: number;
  alive: boolean;
}

export interface Province {
  id: number;
  key: string;
  name: string;
  terrain: string;
  owner: number | null;
  controller: number | null;
  claims: number[];
  population: number;
  development: number;
  fort: number;
  unrest: number;
  natives: number;
  siege_by: number | null;
  siege: number;
  culture: string;
  coastal: boolean;
}

export interface Army {
  id: number;
  owner: number;
  location: number;
  strength: number;
  morale: number;
}

export type TreatyKind = "alliance" | "non_aggression" | "trade";

export interface Treaty {
  kind: TreatyKind;
  a: number;
  b: number;
  since: number;
  expires: number | null;
}

export interface War {
  id: number;
  attackers: number[];
  defenders: number[];
  started: number;
  score: number;
  battles: number;
}

export type Terms =
  | { type: "alliance" }
  | { type: "non_aggression" }
  | { type: "trade" }
  | { type: "peace"; war: number; cede: number[]; concede: number[]; tribute: number }
  | { type: "tribute"; amount: number }
  | { type: "join_war"; war: number };

export interface Proposal {
  id: number;
  from: number;
  to: number;
  turn: number;
  terms: Terms;
}

export type Generation = "scripted" | "model" | "human";

export interface Letter {
  turn: number;
  from: number;
  to: number;
  text: string;
  generation: Generation;
}

export interface GameEvent {
  turn: number;
  kind: string;
  civs: number[];
  provinces: number[];
  text: string;
  magnitude: number;
}

export type Action =
  | { type: "move"; army: number; to: number }
  | { type: "recruit"; province: number; amount: number }
  | { type: "fortify"; province: number }
  | { type: "develop"; province: number }
  | { type: "research" }
  | { type: "suppress"; province: number }
  | { type: "propose"; to: number; terms: Terms }
  | { type: "declare_war"; target: number }
  | { type: "gift"; to: number; amount: number }
  | { type: "cancel_treaty"; with: number; kind: TreatyKind };

export interface Offer {
  index: number;
  action: Action;
  text: string;
}

export interface ProposalView {
  id: number;
  from: number;
  terms: Terms;
  text: string;
  against: number[];
}

export interface Goal {
  kind: string;
  text: string;
  civ: number | null;
  province: number | null;
  weight: number;
}

export interface HumanSeat {
  civ: number;
  offered: Offer[];
  proposals: ProposalView[];
  goals: Goal[];
  queued: boolean;
}

export interface Shape {
  id: number;
  rings: Pt[][];
  center: Pt;
}

export interface Geometry {
  view_box: [number, number, number, number];
  shapes: Shape[];
  lanes: { a: number; b: number; sea: boolean }[];
  land: Pt[][];
  lakes: Pt[][];
  rivers: { name: string | null; line: Pt[] }[];
  scale: number;
  has_basemap: boolean;
  /** [lon0, lat0, cos(lat0), units per degree]. */
  projection: [number, number, number, number];
}

export type Label =
  "rules" | "amnesic" | "random" | "live" | "fallback" | "human" | "replay";

export interface DecisionSummary {
  civ: number;
  brain: string;
  label: Label;
  chosen: string[];
  rationale: string | null;
  error: string | null;
  discarded: string[];
  letters: number;
}

export interface LastTurn {
  turn: number;
  date: string;
  hash: string;
  applied: number;
  rejected: { civ: number; what: string; reason: string }[];
  decisions: DecisionSummary[];
}

export interface CivStats {
  provinces: number;
  population: number;
  strength: number;
  treasury: number;
  stability: number;
}

export interface GameState {
  date: string;
  turn: number;
  start_year: number;
  scenario: { id: string; name: string; description: string; provenance: string };
  seats: { civ: number; seat: { kind: string }; brain: string }[];
  civs: Civ[];
  stats: CivStats[][];
  provinces: Province[];
  armies: Army[];
  opinion: number[][];
  treaties: Treaty[];
  wars: War[];
  proposals: Proposal[];
  messages: Letter[];
  events: GameEvent[];
  event_count: number;
  geometry: Geometry | null;
  humans: HumanSeat[];
  last_turn: LastTurn | null;
}

export interface CivView {
  id: number;
  key: string;
  name: string;
  ruler: string;
  alive: boolean;
  in_contact: boolean;
  our_opinion: number;
  their_opinion_est: number;
  strength_est: number;
  provinces: number;
  at_war_with_us: boolean;
  treaties: TreatyKind[];
  trust: number;
  grievances: number;
  favors: number;
}

export interface MemoryEntry {
  turn: number;
  kind: string;
  about: number[];
  text: string;
  salience: number;
  valence: number;
}

export interface Mind {
  civ: number;
  goals: Goal[];
  beliefs: CivView[];
  income: number;
  upkeep: number;
  memory: { entries: MemoryEntry[]; notes: { turn: number; text: string }[] };
  chronicle: string[];
  recent_decisions: {
    turn: number;
    date: string;
    decision: { label: Label; chosen: string[]; rationale: string | null } | null;
    rejected: { what: string; reason: string }[];
  }[];
}

export interface ScenarioCard {
  id: string;
  name: string;
  description: string;
  provenance: string;
  date: string;
  provinces: number;
  civs: {
    key: string;
    name: string;
    color: string;
    ruler: string;
    government: string;
    provinces: number;
    personality: Personality;
  }[];
  points: [number, number, number | null][];
}

export interface ReplayReport {
  ok: boolean;
  turns_checked: number;
  first_divergence: number | null;
  reason: string | null;
  final_hash: string;
}
