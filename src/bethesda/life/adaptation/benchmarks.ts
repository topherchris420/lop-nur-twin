/**
 * The benchmarks for one question, fixed before anything was measured:
 *
 *   Can Eva and ECHO demonstrate measurable behavioural adaptation while
 *   preserving their individual histories across software updates and
 *   restarts?
 *
 * Three families, each with a pass rule that a number either meets or does
 * not: behaviour (does experience change what the fly does, and does that
 * pay), memory (does what it keeps track the world), and continuity (does a
 * restart or an update leave the same individual with the same history).
 *
 * Two kinds of subject, and they are not interchangeable:
 *
 * - **Research ECHO flies.** Built from a seed for this suite, in the deployed
 *   ECHO configuration (`OrganismAdapter`: the reduced-order controller, its
 *   ECHO v3 self-model, the mushroom body, olfactory navigation and the
 *   maintenance physiology), living in Study B's yard (`individuality.ts`).
 *   None is the deployed individual, a copy of it or a continuation of it, and
 *   nothing here reads or writes a store. Behaviour and memory can only be
 *   tested here, because only here can the same fly be lived twice.
 * - **The originals, Eva and ECHO.** Only what their public witnesses and the
 *   append-only ledger show, read without writing anything. Eva's simulation is
 *   not in this repository (docs/EVA_ECHO_AUDIT.md), so most of the question
 *   cannot be put to her from here, and the verdict says so instead of
 *   guessing.
 *
 * Changing anything below after a result exists makes that result a
 * development result: bump `ADAPTATION_SUITE`, say why, and use new seeds.
 * Functional words only: a fly that remembers where it fed and acts on it is
 * not evidence of a self, of awareness or of consciousness.
 */
import { seedDomain } from "../individualityReport.js";

export const ADAPTATION_SUITE = "echo-adaptation-continuity/v1" as const;

export type Family = "behaviour" | "memory" | "continuity";
export type Subject = "research ECHO flies" | "Eva" | "ECHO (the original)";
export type Verdict = "pass" | "fail" | "untestable" | "not applicable";

export interface Benchmark {
  id: string;
  family: Family;
  subject: Subject;
  /** The question in a sentence. */
  question: string;
  /** What is measured, and on what. */
  measure: string;
  /** The rule a result must meet, fixed before any result. */
  passes: string;
}

// ------------------------------------------------------------------ design

/** Individuals per split. */
export const INDIVIDUALS = 24;
/** Moves of the food in a Study B life, as in Study B. */
export const EPOCHS = 8;
/**
 * Where a life is stopped for a restart or an update: the end of this many
 * epochs (half the life), so there is a history before and a future after.
 */
export const BREAK_AFTER_EPOCHS = 4;
/** M1's threshold: stale remembered food places per epoch's end, on average. */
export const STALE_LIMIT = 0.5;

/**
 * A split: one genesis seed and the experience streams of its individuals.
 * Development results guide the design; the held-out split is run once, after
 * the improvement is frozen, and is spent by being looked at.
 */
export interface Split {
  name: "dev" | "heldout";
  /** The fly's seed: its body, its controller's streams, its circuit's wiring. */
  genesisSeed: number;
  /** One draw per individual for Study A's training life (where and when food came). */
  training: number[];
  /** One draw per individual for Study B's relocation life (where food moved, and when). */
  relocation: number[];
  /** Birth nonces, one per individual (32 hex digits). */
  nonces: string[];
}

function split(name: Split["name"], genesisSeed: number): Split {
  return {
    name,
    genesisSeed,
    training: seedDomain(`${ADAPTATION_SUITE}|${name}|training`, INDIVIDUALS),
    relocation: seedDomain(`${ADAPTATION_SUITE}|${name}|relocation`, INDIVIDUALS),
    nonces: seedDomain(`${ADAPTATION_SUITE}|${name}|nonce`, INDIVIDUALS * 4).reduce<
      string[]
    >((out, s, i) => {
      if (i % 4 === 0) out.push("");
      out[out.length - 1] += s.toString(16).padStart(8, "0");
      return out;
    }, []),
  };
}

/** Studies A and B's genesis seed, so development flies start where those did. */
export const DEV = split("dev", 0x1d1e5);
/** A genesis no earlier study used, drawn from the suite's own name. */
export const HELDOUT = split(
  "heldout",
  seedDomain(`${ADAPTATION_SUITE}|heldout|genesis`, 1)[0]!,
);
export const SPLITS = { dev: DEV, heldout: HELDOUT } as const;

// -------------------------------------------------------------- benchmarks

/** Measured on research flies, once per release. */
export const RESEARCH_BENCHMARKS: readonly Benchmark[] = [
  {
    id: "B1",
    family: "behaviour",
    subject: "research ECHO flies",
    question: "Does experience change what the fly does?",
    measure:
      "Study A's protocol: each fly fed at one site (east or west, alternating) for a drawn spell, then its mind probed for 300 s in the empty yard from four headings. Preference for the fed site over the opposite one, its own mind less the same mind with its remembered places erased, per individual.",
    passes: "The 95% bootstrap interval's lower bound is above 0.",
  },
  {
    id: "B2",
    family: "behaviour",
    subject: "research ECHO flies",
    question: "Does that change pay where the world keeps changing?",
    measure:
      "Study B's protocol: food moved 8 times among the four sites, each stay 600–900 s, every life lived with memory and with the memory lesion applied every tick, on the same events. Meals per life, memory less lesion, per individual.",
    passes: "The 95% bootstrap interval's lower bound is above 0.",
  },
  {
    id: "M1",
    family: "memory",
    subject: "research ECHO flies",
    question: "Does what it remembers track the world?",
    measure:
      "In B2's lives with memory, the remembered food places where food no longer is (farther than 1.5 m from it) at the end of each epoch, averaged over the epochs and then over individuals.",
    passes: `The mean is below ${STALE_LIMIT}.`,
  },
  {
    id: "C1",
    family: "continuity",
    subject: "research ECHO flies",
    question: "Does a restart leave the same individual with the same history?",
    measure: `Each B2 life with memory is checkpointed after epoch ${BREAK_AFTER_EPOCHS}, written out as text, read back and restored (verified: same bytes and state hash), then lived on. Its later epochs' measures and its final state hash, against the uninterrupted life's; and B1's mind restored the same way, against the mind it was.`,
    passes:
      "Identical in every individual: every later epoch, the final state hash, and the restored mind's bytes and probes.",
  },
  {
    id: "C2",
    family: "continuity",
    subject: "research ECHO flies",
    question: "Does a software update keep the individual and everything it has learned?",
    measure: `The release under test applied to each B2 life after epoch ${BREAK_AFTER_EPOCHS} as a recorded continuation of its checkpoint on the release before it: whether the kind's history accepts it, whether the individual, birth, genesis and tick are unchanged, and whether the graph with the update's additions taken back out has the parent's digest exactly.`,
    passes:
      "All of these hold in every individual. Not applicable to the release every other is updated from.",
  },
  {
    id: "C3",
    family: "continuity",
    subject: "research ECHO flies",
    question: "Does an update's adaptation reach an individual that already has a past?",
    measure: `C2's updated lives: meals in epochs ${BREAK_AFTER_EPOCHS + 1}–${EPOCHS}, less the same individuals' meals in those epochs on the release they were updated from.`,
    passes:
      "The 95% bootstrap interval's lower bound is above 0. Not applicable to the release every other is updated from.",
  },
  {
    id: "C4",
    family: "continuity",
    subject: "research ECHO flies",
    question: "Is a copy someone else?",
    measure: `A twin started from each life's checkpoint after epoch ${BREAK_AFTER_EPOCHS}: its individual id, its recorded parentage, and whether a checkpoint can continue the original with the twin's birth.`,
    passes:
      "In every individual the twin has a new id, records whom it was copied from, and cannot continue the original.",
  },
];

/**
 * Read from the originals' public witnesses and the ledger. A benchmark the
 * observations cannot decide is `untestable`, never passed by default.
 */
export const ORIGINAL_BENCHMARKS: readonly Benchmark[] = [
  {
    id: "E1",
    family: "continuity",
    subject: "Eva",
    question:
      "Is she the same individual, with her clock intact, between two dated observations?",
    measure:
      "Two observations of `GET /api/state` on different dates: `life_id` and `born_at`, and on every state `updated_at = born_at + 5 s × ticks`, with ticks never lower later.",
    passes:
      "Same id and birth, the clock's contract holds on every state, ticks never fall.",
  },
  {
    id: "E2",
    family: "behaviour",
    subject: "Eva",
    question: "Does her behaviour adapt measurably?",
    measure:
      "Would need her controller or an intervention with a counterfactual. Neither exists here: her service is not in this repository and its only public interface is read-only. Changes in what she reports (trials, capability estimates, prediction error) are listed, not judged.",
    passes: "Cannot be decided from here.",
  },
  {
    id: "E3",
    family: "continuity",
    subject: "Eva",
    question: "Does her history survive software updates and restarts?",
    measure:
      "Would need a version, a restart count or a checkpoint record. Her witness exposes none, so an update or restart between observations cannot be seen; E1 is all that can be.",
    passes: "Cannot be decided from here.",
  },
  {
    id: "O1",
    family: "continuity",
    subject: "ECHO (the original)",
    question: "Is it the same individual across restarts?",
    measure:
      "Two dated observations of `GET /v1/now`: the individual, its lease epoch (one more for every writer that took over, so a restart shows) and its engine versions; and every line of the `live-fly-ledger` branch.",
    passes:
      "Same individual in both observations and in every ledger line, with checkpoint sequence and tick strictly increasing along the ledger.",
  },
  {
    id: "O2",
    family: "continuity",
    subject: "ECHO (the original)",
    question: "Can its history be re-derived, seal for seal, by someone else?",
    measure:
      "Every verdict in the ledger branch's `replays.jsonl` from a release whose seals must reproduce (`seals.required`).",
    passes: "At least one such replay, and every one passed.",
  },
  {
    id: "O3",
    family: "behaviour",
    subject: "ECHO (the original)",
    question: "Does the original's behaviour adapt measurably?",
    measure:
      "No experiment may be run on the original, and one life cannot be compared with a life it did not live. The research flies (B1, B2) stand in for its configuration; its own counters are listed, not judged.",
    passes: "Cannot be decided on the original.",
  },
];

export const BENCHMARKS: readonly Benchmark[] = [
  ...RESEARCH_BENCHMARKS,
  ...ORIGINAL_BENCHMARKS,
];

// -------------------------------------------------------------- comparison

/**
 * How one improvement is judged against the baseline, fixed before either was
 * measured: on the held-out split, with the individual as the unit.
 *
 * - **Primary:** B2's measure on its own, meals per life with memory, the
 *   improved release less the baseline, paired by individual. The improvement
 *   is shown only if its 95% lower bound is above 0.
 * - **Guards:** B1, C1, C2 and C4 must pass on the improved release. A gain
 *   bought by forgetting what the fly learned, or by breaking continuity, is
 *   not an improvement.
 * - Every benchmark is reported for both releases, whichever way it goes.
 */
export const COMPARISON = {
  primary: "B2-memory-meals",
  guards: ["B1", "C1", "C2", "C4"],
  split: "heldout",
} as const;

// ------------------------------------------------------------------ judging

/** A mean with a 95% bootstrap interval over individuals (`individualityReport.summary`). */
export interface Estimate {
  n: number;
  mean: number | null;
  ci95: [number, number] | null;
}

/** What a release's run reduces to, for judging. */
export interface ResearchMeasures {
  /** Self less erased preference, per individual. */
  b1: Estimate;
  /** Meals per life, memory less lesion. */
  b2: Estimate;
  /** Stale remembered places at an epoch's end, memory arm. */
  m1: Estimate;
  /** Individuals in which the restart changed nothing, of `n`. */
  c1: { identical: number; n: number };
  /** Individuals whose update kept everything, of `n`; null for the base release. */
  c2: { kept: number; n: number } | null;
  /** Meals in the later epochs, updated less the base release; null for the base release. */
  c3: Estimate | null;
  /** Individuals whose twin was someone else, of `n`. */
  c4: { someoneElse: number; n: number };
}

const lowAbove0 = (e: Estimate): Verdict =>
  e.ci95 !== null && e.ci95[0] > 0 ? "pass" : "fail";
const all = (k: number, n: number): Verdict => (n > 0 && k === n ? "pass" : "fail");

/** The verdict on each research benchmark, by its fixed rule. */
export function judgeResearch(m: ResearchMeasures): Record<string, Verdict> {
  return {
    B1: lowAbove0(m.b1),
    B2: lowAbove0(m.b2),
    M1: m.m1.mean !== null && m.m1.mean < STALE_LIMIT ? "pass" : "fail",
    C1: all(m.c1.identical, m.c1.n),
    C2: m.c2 ? all(m.c2.kept, m.c2.n) : "not applicable",
    C3: m.c3 ? lowAbove0(m.c3) : "not applicable",
    C4: all(m.c4.someoneElse, m.c4.n),
  };
}
