/**
 * The host's side of the mathematical substrate: what this lab knows about
 * its own simulator, and how a person turns an inspected result into an
 * entry of a proposal's mathematical basis.
 *
 * R.A.I.N.'s substrate knows mathematics and nothing about Bethesda; the lab
 * knows its simulator and nothing about mathematics. So the simulator's
 * assumptions are declared here, in the host's words, and so is the one
 * deterministic judgment the host makes about a result: whether its
 * discipline has any counterpart in the simulator at all. A result from a
 * discipline with none — an L-function, a moduli space — is related to a
 * question by words only, and the host rule says so
 * (`related_but_not_applicable`). For every other result the host rule says
 * only `insufficient_context`: whether a random-walk theorem bears on
 * pedestrians is a person's claim to make, with the assumptions that make it.
 *
 * Pure: no renderer, no client, no network, no store. The lab imports it;
 * `experiments.ts` takes its sentences into every definition with a basis.
 */
import {
  CONNECTING_RELATIONS,
  HOST_RULE_RELATIONS,
  parseBasisEntry,
  type MathematicalBasisEntry,
  type MathematicalRelation,
} from "../../rain/mathematics/contracts";
import type { MathRecord, MathResultSummary } from "./mathValidation";

/**
 * What the cited mathematics does not establish, said once. Shown beside
 * every mathematical result and written into every definition that cites one.
 */
export const NOT_ESTABLISHED = [
  "The cited mathematics does not establish the simulator outcome.",
  "A Lean formalization, where present, proves a mathematical statement; it validates nothing about Bethesda or this simulator, and this lab has not checked it.",
  "A hypothesis framed with mathematics is still a hypothesis: only the matched runs decide what the simulator does.",
] as const;

/**
 * The Bethesda simulator, as a mathematician would need to know it before
 * claiming a result applies. The host's declaration, from the simulator's own
 * code and the experiment profile; a result's assumptions are compared with
 * these by a person, never by this module.
 */
export const SIMULATOR_ASSUMPTIONS = [
  "A finite population: the fixed experiment profile's pedestrians, cars and buses, never a limit of infinitely many agents.",
  "Discrete time: ten ticks a simulated second, observed every hundred ticks.",
  "Rule-based agents responding to an event's declared effects; no physics of crowds, fire, weather or transit is modelled.",
  "Seeded pseudo-randomness: one seed is one deterministic run, and a few seeds are a small sample.",
  "A finite, mapped street and sidewalk graph of downtown Bethesda, not a lattice or a continuum.",
  "Short windows after a warm-up: at most 3,000 ticks, so no long-run or stationary regime is reached.",
] as const;

/**
 * Disciplines whose objects have some counterpart in the simulator, and what
 * it is. A counterpart is not applicability: it only means a person could try
 * to state the assumptions that connect a result to the experiment. A
 * discipline not listed has none, and its results are related by words only.
 */
export const DISCIPLINE_COUNTERPARTS: Readonly<Record<string, string>> = {
  "Probability and statistical mechanics":
    "seeded random choices made by a finite population of agents",
  Combinatorics: "the finite street graph and counts of agents on it",
  "Theoretical computer science":
    "the simulator's own algorithms, such as routing on the street graph",
  "Dynamical systems and ergodic theory":
    "the simulator as a deterministic map from one tick's state to the next",
};

export interface HostReading {
  /** The simulator's counterpart to the result's discipline, or null when it has none. */
  counterpart: string | null;
  /** The only relation a host rule may give it. */
  relation: MathematicalRelation;
  why: string;
}
/** The host rule for one result: deterministic, from its discipline alone. */
export function hostReading(result: Pick<MathResultSummary, "discipline">): HostReading {
  const name = result.discipline?.name ?? null;
  const counterpart = name ? (DISCIPLINE_COUNTERPARTS[name] ?? null) : null;
  return counterpart
    ? {
        counterpart,
        relation: "insufficient_context",
        why: `${name} has a counterpart in the simulator (${counterpart}), but nobody has stated how this result's assumptions meet the simulator's. Until a person does, it is context only.`,
      }
    : {
        counterpart: null,
        relation: "related_but_not_applicable",
        why: name
          ? `The simulator has nothing of ${name.toLowerCase()}'s kind: the result shares words with the question, and its assumptions do not match the simulator.`
          : "The repository classifies the result under no discipline, so the host can say nothing about its fit; it is related by words only.",
      };
}

/** What a person chose to cite, and how. */
export interface BasisChoice {
  /** A manuscript of the family, by path; null cites the family as a whole. */
  manuscriptPath: string | null;
  /** Cite the family's released reasoning summary instead. */
  reasoningSummary: boolean;
  relation: MathematicalRelation;
  assumptions: string[];
  rationale: string;
  /** A person, or the host rule (which may only say what `hostReading` says). */
  assessedBy: "person" | "host-rule";
}

/**
 * A basis entry from a validated inspection: the identifiers, paths and
 * status come from the substrate's answer, never from the person; the
 * relation, assumptions and rationale come from the person, and are checked
 * against the same rules the runtime applies. Returns the entry or why not.
 */
export function basisEntryFrom(
  record: MathRecord,
  choice: BasisChoice,
): { ok: true; value: MathematicalBasisEntry } | { ok: false; errors: string[] } {
  const f = record.family;
  const p = record.provenance;
  let manuscript_path: string | null = null;
  let reasoning_summary_path: string | null = null;
  let status = f.status;
  let formalization_path: string | null =
    f.status === "formalized" ? (f.formalization?.path ?? null) : null;
  if (choice.reasoningSummary) {
    if (!f.reasoning_summary)
      return { ok: false, errors: ["this family has no released reasoning summary"] };
    reasoning_summary_path = f.reasoning_summary.path;
    status = "reasoning-summary";
    formalization_path = null;
  } else if (choice.manuscriptPath !== null) {
    const m = f.manuscripts.find((x) => x.path === choice.manuscriptPath);
    if (!m) return { ok: false, errors: ["the family holds no such manuscript"] };
    manuscript_path = m.path;
    status = m.status;
    formalization_path =
      m.status === "formalized" ? (f.formalization?.path ?? null) : null;
  }
  const assumptions = choice.assumptions.map((a) => a.trim()).filter(Boolean);
  const entry = {
    repository: p.repository,
    commit: p.commit,
    index_sha256: p.index_sha256,
    result_family: f.id,
    title: f.title,
    manuscript_path,
    formalization_path,
    reasoning_summary_path,
    status,
    relation: choice.relation,
    assumptions,
    rationale: choice.rationale.trim(),
    assessed_by: choice.assessedBy,
  };
  return parseBasisEntry(entry);
}

/** Whether a relation asserts a connection, and so needs stated assumptions. */
export const connects = (r: MathematicalRelation) => CONNECTING_RELATIONS.includes(r);
/** Whether a host rule may give the relation. */
export const hostMay = (r: MathematicalRelation) => HOST_RULE_RELATIONS.includes(r);

/**
 * The repository's text, easier to read: its manuscript map writes HTML tags,
 * entities and TeX in code spans (`<i>p</i>`, `&gt;`, ``$`\zeta(s)`$``). This
 * drops the italic and bold tags, writes sub- and superscripts as `_` and
 * `^`, decodes the three entities it uses and unwraps the code spans. It is a
 * reading aid for the screen only: every record keeps the text verbatim, and
 * nothing here is ever rendered as HTML.
 */
export function readable(text: string): string {
  return text
    .replace(/<\/?(?:i|b|em|strong)>/gi, "")
    .replace(/<sub>(.*?)<\/sub>/gi, "_$1")
    .replace(/<sup>(.*?)<\/sup>/gi, "^$1")
    .replace(/\$`([^`]*)`\$/g, "$$$1$$")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
