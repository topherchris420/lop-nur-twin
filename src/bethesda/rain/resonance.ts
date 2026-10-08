/**
 * R.A.I.N.'s resonance: what the lab's Chladni plates show, derived from the
 * runtime's state and from nothing else.
 *
 * R.A.I.N. has no face. In the lab it is seen through a plate instrument in
 * the Research Panel: one large plate, and four small ones for the four
 * perspectives, each driven at a resonance of its own. This module reads the
 * lab store — the meeting being staged, a question in flight, the cases and
 * their lifecycles, a run in progress — and says which state the instrument
 * is in, which partials drive which plate, how settled the sand is and why.
 * It keeps no state of its own: the same store gives the same view, every
 * time, so there is no second state machine to drift from the runtime's.
 *
 * It decides nothing. It never writes to the store, a case, a record, the
 * registry or the city, and nothing it returns is evidence: a figure is a
 * picture of the runtime's state, chosen by a hash where a figure has to be
 * chosen at all (`chladni.ts`'s signature). Agreement among the perspectives
 * is drawn as a figure resolving, never as validation, and confidence is
 * never drawn: the records carry none.
 *
 * The mathematical substrate drives it too, as process and nothing more: a
 * search in flight, context found, a formalization present, challenging
 * material found, a hypothesis framed with stated assumptions, an authorized
 * experiment ready to run. A figure that settles because a Lean formalization
 * is present says that a file exists at a commit, never that the mathematics
 * — still less the hypothesis — is true.
 *
 * Pure: no renderer, no React, no clock. `snapshotOf` reads a store;
 * `resonanceView` maps a snapshot to a view.
 */
import {
  modeOf,
  partnerOf,
  seat,
  signature,
  type PlateMode,
  type Point,
} from "./chladni";
import { PERSPECTIVES, type Perspective, type RainVerdict } from "./contracts";
import {
  CHALLENGING_RELATIONS,
  CONNECTING_RELATIONS,
} from "../../rain/mathematics/contracts";
import type { LabStore } from "./store";

export type ResonanceFaceState =
  | "idle"
  | "listening"
  | "deliberating"
  | "converging"
  | "uncertain"
  | "experiment"
  | "result-supported"
  | "result-contradicted"
  | "result-unresolved"
  | "awaiting-human"
  | "math-search"
  | "math-context"
  | "math-formalized"
  | "math-conflict"
  | "hypothesis-formed"
  | "ready-for-experiment";

export const RESONANCE_STATES: readonly ResonanceFaceState[] = [
  "idle",
  "listening",
  "deliberating",
  "converging",
  "uncertain",
  "experiment",
  "result-supported",
  "result-contradicted",
  "result-unresolved",
  "awaiting-human",
  "math-search",
  "math-context",
  "math-formalized",
  "math-conflict",
  "hypothesis-formed",
  "ready-for-experiment",
];

/** What a person reads for each state, in the registry's own words where it has them. */
export const RESONANCE_LABELS: Record<ResonanceFaceState, string> = {
  idle: "At rest",
  listening: "Listening",
  deliberating: "Deliberating",
  converging: "Converging",
  uncertain: "Unresolved",
  experiment: "Experiment running",
  "result-supported": "Result: supported",
  "result-contradicted": "Result: not supported",
  "result-unresolved": "Result: unresolved",
  "awaiting-human": "Waiting for a person",
  "math-search": "Searching the mathematics",
  "math-context": "Mathematical context found",
  "math-formalized": "Formalization found",
  "math-conflict": "Mathematical challenge found",
  "hypothesis-formed": "Hypothesis formed",
  "ready-for-experiment": "Ready for the experiment",
};

/** The studio's pigments: ramps from a single grain in shadow to a pile in full light. */
export const PIGMENTS = {
  bone: [
    [58, 56, 52],
    [142, 137, 127],
    [220, 215, 203],
    [250, 247, 240],
    [255, 255, 255],
  ],
  verdigris: [
    [14, 52, 46],
    [40, 132, 114],
    [111, 205, 180],
    [206, 250, 237],
    [255, 255, 255],
  ],
  copper: [
    [70, 42, 28],
    [176, 114, 76],
    [219, 168, 130],
    [255, 229, 206],
    [255, 255, 255],
  ],
} as const satisfies Record<string, readonly (readonly [number, number, number])[]>;
export type Pigment = keyof typeof PIGMENTS;

/**
 * Each perspective's own resonance on its small plate, and the frequency it
 * drives the large one with. Fixed: a perspective always sounds the same
 * figure, so the composite is recognisably made of the four.
 */
export const PERSPECTIVE_MODES: Record<Perspective, PlateMode> = {
  James: modeOf(4, 2),
  Jasmine: modeOf(1, 3),
  Luca: modeOf(2, 3),
  Elena: modeOf(4, 1),
};
const EXCITERS = Object.fromEntries(
  PERSPECTIVES.map((p) => [p, seat(PERSPECTIVE_MODES[p])]),
) as Record<Perspective, Point>;
/**
 * At rest the plate holds the studio's own "Harmonic cross" study, (8,4) —
 * "order, emerging from motion" in its collection — lightly driven.
 */
const REST = modeOf(8, 4);
const REST_AT = seat(REST);
/** A question in flight: driven between (3,3) and (2,4)−, where the plate barely answers. */
const BETWEEN = (modeOf(3, 3).f + modeOf(2, 4).f) / 2;
const BETWEEN_AT: Point = { x: 0.45, y: -0.3 };
/** A substrate search in flight: driven between (5,1) and (4,3)−, another place the plate barely answers. */
const SEARCHING = (modeOf(5, 1).f + modeOf(4, 3).f) / 2;
const SEARCHING_AT: Point = { x: -0.35, y: 0.4 };

/** The facts the view is derived from, read from the store and nothing else. */
export interface ResonanceSnapshot {
  live: boolean;
  asking: boolean;
  /** A model meeting's progress: turns started of turns planned. Never words. */
  progress: { started: number; planned: number } | null;
  meeting: {
    question: string;
    generation: "scripted" | "model";
    grounding: "strong" | "partial" | "none" | null;
    missing: number;
    unverified: number;
    speakers: Perspective[];
    moves: string[];
    revealed: number;
    stagedAt: string;
  } | null;
  run: {
    experimentId: string;
    definition: string;
    arm: number;
    arms: number;
    done: number;
  } | null;
  /** The newest case waiting for a person's authorization. */
  awaiting: { experimentId: string; definition: string } | null;
  /** The newest case a person authorized that has not run yet. */
  ready: { experimentId: string; definition: string } | null;
  /** The mathematical substrate's part: process facts, never what the mathematics says. */
  mathematics: {
    searching: "context" | "challenge" | null;
    /** The newer of the last context search and the last challenge. */
    framing: {
      mode: "context" | "challenge";
      /** The families shown, in rank order. */
      families: string[];
      formalized: number;
      /** Results a challenge found that state counterexamples, obstructions, bounds or conditions. */
      challenging: number;
      at: string;
    } | null;
    /** The next proposal's mathematical basis, when it has one. */
    basis: {
      families: string[];
      /** Entries whose relation asserts a connection, with stated assumptions. */
      connecting: number;
      /** Entries that offer a counterexample to, or contradict, the candidate. */
      challenging: number;
      at: string;
    } | null;
  };
  /** The case that ended most recently in this session. */
  result: {
    experimentId: string;
    definition: string;
    state: "COMPLETED" | "INCONCLUSIVE" | "FAILED";
    verdict: RainVerdict;
    at: string;
  } | null;
}

/** Reads the store. Writes nothing, calls nothing that writes, keeps nothing. */
export function snapshotOf(store: LabStore): ResonanceSnapshot {
  const m = store.meeting;
  let awaiting: ResonanceSnapshot["awaiting"] = null;
  let ready: ResonanceSnapshot["ready"] = null;
  let result: ResonanceSnapshot["result"] = null;
  for (const c of store.cases) {
    const state = c.lifecycle.state;
    if (!c.validated) continue;
    const ids = {
      experimentId: c.validated.experimentId,
      definition: c.validated.definitionSha256,
    };
    // Cases are newest first: the first one waiting is the newest.
    if (state === "AWAITING_HUMAN_APPROVAL" && !awaiting) awaiting = ids;
    if (state === "AUTHORIZED" && !ready) ready = ids;
    if (
      (state === "COMPLETED" || state === "INCONCLUSIVE" || state === "FAILED") &&
      c.record
    ) {
      const at = c.lifecycle.history.at(-1)!.at;
      if (!result || Date.parse(at) > Date.parse(result.at))
        result = { ...ids, state, verdict: c.record.outcome.verdict, at };
    }
  }
  const running = store.run ? store.caseById(store.run.caseId) : null;
  const p = store.run?.progress ?? null;
  const math = store.mathematics;
  const latest = [math.context, math.challenge]
    .filter((x) => x !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return {
    live: store.mode() === "LIVE",
    asking: store.asking,
    progress: store.meetingProgress
      ? {
          started: store.meetingProgress.turnsStarted,
          planned: store.meetingProgress.turnsPlanned,
        }
      : null,
    meeting: m
      ? {
          question: m.record.question,
          generation: m.record.generation,
          grounding: m.record.grounding,
          missing: m.record.missing_terms?.length ?? 0,
          unverified: m.record.turns.reduce((n, t) => n + t.unverified, 0),
          speakers: m.record.turns.map((t) => t.speaker),
          moves: m.record.turns.map((t) => t.move),
          revealed: m.revealed,
          stagedAt: m.stagedAt,
        }
      : null,
    run:
      store.run && running?.validated
        ? {
            experimentId: running.validated.experimentId,
            definition: running.validated.definitionSha256,
            arm: p ? p.armIndex : 0,
            arms: p ? p.arms : 0,
            done: p && p.arms > 0 ? (p.armIndex + p.tick / p.totalTicks) / p.arms : 0,
          }
        : null,
    awaiting,
    ready,
    result,
    mathematics: {
      searching: math.searching,
      framing: latest
        ? {
            mode: latest.answer.mode,
            families: latest.answer.results.map((r) => r.family),
            formalized: latest.answer.results.filter((r) => r.formalization_path !== null)
              .length,
            challenging: latest.answer.results.filter(
              (r) => r.group !== null && r.group !== "stated_results",
            ).length,
            at: latest.at,
          }
        : null,
      basis:
        math.basis.length && math.basisAt
          ? {
              families: math.basis.map((e) => e.result_family),
              connecting: math.basis.filter((e) =>
                CONNECTING_RELATIONS.includes(e.relation),
              ).length,
              challenging: math.basis.filter((e) =>
                CHALLENGING_RELATIONS.includes(e.relation),
              ).length,
              at: math.basisAt,
            }
          : null,
    },
  };
}

/** A partial driving a plate: a frequency, its amplitude and where it is driven. */
export interface Drive {
  f: number;
  a: number;
  at: Point;
}

export interface ResonanceView {
  state: ResonanceFaceState;
  label: string;
  /** The runtime facts the state follows, in words. */
  because: string;
  /** The large plate: what drives it, how settled its sand is, how far it swings. */
  plate: {
    drive: Drive[];
    /** 0 strewn, 1 resting on the nodes. */
    settle: number;
    /** 0 still, 1 swinging as far as the studio would draw it. */
    motion: number;
    /** How brightly the sand catches the light, 0–1. */
    level: number;
    pigment: Pigment;
  };
  /** Each perspective's small plate: how hard it is driven, and whether it is the one speaking. */
  sources: Record<Perspective, { level: number; speaking: boolean }>;
  /** The plate has reached the edge of what R.A.I.N. may do and stopped: a person decides. */
  boundary: boolean;
  /** Identity of the large plate's figure; a new key is a new figure to move the sand to. */
  key: string;
}

const quiet = (level: number) =>
  Object.fromEntries(PERSPECTIVES.map((p) => [p, { level, speaking: false }])) as Record<
    Perspective,
    { level: number; speaking: boolean }
  >;

/**
 * Signatures, kept: a seat is a search over the plate, and a view is derived
 * on every change of the store. Deterministic, so a kept answer is the answer.
 */
const signatures = new Map<string, ReturnType<typeof signature>>();
function signatureOf(text: string, split = false) {
  const key = (split ? "1:" : "0:") + text;
  if (!signatures.has(key)) {
    if (signatures.size >= 64) signatures.clear();
    signatures.set(key, signature(text, split));
  }
  return signatures.get(key) ?? null;
}

/** The figure an experiment is drawn with: its definition's signature, a mode with a partner. */
function experimentFigure(definition: string): { mode: PlateMode; at: Point } {
  const s = signatureOf(definition, true)!;
  return { mode: s.mode, at: s.exciter };
}

const keyOf = (state: ResonanceFaceState, drive: readonly Drive[]) =>
  state +
  ":" +
  drive
    .map(
      (d) =>
        `${d.f.toFixed(2)}/${d.a.toFixed(2)}@${d.at.x.toFixed(2)},${d.at.y.toFixed(2)}`,
    )
    .join(";");

function view(
  state: ResonanceFaceState,
  because: string,
  plate: Omit<ResonanceView["plate"], "drive">,
  drive: Drive[],
  sources: ResonanceView["sources"],
  boundary = false,
): ResonanceView {
  return {
    state,
    label: RESONANCE_LABELS[state],
    because,
    plate: { ...plate, drive },
    sources,
    boundary,
    key: keyOf(state, drive),
  };
}

const VERDICT_WORDS: Record<RainVerdict, string> = {
  supported: "SUPPORTED",
  not_supported: "NOT SUPPORTED",
  insufficient_evidence: "INSUFFICIENT EVIDENCE",
  not_evaluated: "NOT EVALUATED",
};

function resultView(r: NonNullable<ResonanceSnapshot["result"]>): ResonanceView {
  const { mode, at } = experimentFigure(r.definition);
  const record = `The registry recorded ${r.experimentId} as ${r.state} · hypothesis ${VERDICT_WORDS[r.verdict]}.`;
  const not = " The figure follows that record; it is not evidence for it.";
  if (r.state === "COMPLETED" && r.verdict === "supported")
    return view(
      "result-supported",
      record + " The experiment's figure settles as it formed." + not,
      { settle: 1, motion: 0.05, level: 0.75, pigment: "verdigris" },
      [{ f: mode.f, a: 1, at }],
      quiet(0.05),
    );
  if (r.state === "COMPLETED" && r.verdict === "not_supported") {
    const other = partnerOf(mode)!;
    return view(
      "result-contradicted",
      record + " The experiment's figure gives way to its partner." + not,
      { settle: 1, motion: 0.05, level: 0.75, pigment: "copper" },
      [{ f: other.f, a: 1, at }],
      quiet(0.05),
    );
  }
  const other = partnerOf(mode)!;
  return view(
    "result-unresolved",
    record +
      (r.state === "FAILED"
        ? " The run did not complete, so nothing was evaluated."
        : " The evidence did not settle it.") +
      " The figure and its partner both sound, and neither forms." +
      not,
    { settle: 0.68, motion: 0.1, level: 0.6, pigment: "bone" },
    [
      { f: mode.f, a: 0.7, at },
      { f: other.f, a: 0.7, at },
    ],
    quiet(0.05),
  );
}

function meetingView(
  meetingDone: NonNullable<ResonanceSnapshot["meeting"]>,
): ResonanceView {
  const spoken = PERSPECTIVES.filter((p) => meetingDone.speakers.includes(p));
  const grounded =
    meetingDone.generation === "scripted" &&
    meetingDone.grounding === "strong" &&
    meetingDone.unverified === 0;
  if (grounded) {
    const s0 = signatureOf(meetingDone.question);
    const fig = s0 ?? { mode: REST, exciter: REST_AT };
    return view(
      "converging",
      "The meeting ended with strong grounding and every quoted span verified, so the four figures resolve into one. Agreement among the perspectives is agreement, not validation; the figure is chosen by a hash of the question, not by what it means.",
      { settle: 1, motion: 0.15, level: 0.8, pigment: "verdigris" },
      [{ f: fig.mode.f, a: 1, at: fig.exciter }],
      quiet(0.25),
    );
  }
  const reasons: string[] = [];
  if (meetingDone.generation === "model")
    reasons.push(
      "a model meeting is not graded: the runtime states no grounding and no verdict for it",
    );
  else if (meetingDone.grounding !== "strong")
    reasons.push(
      `the corpus grounding was ${meetingDone.grounding ?? "not stated"}` +
        (meetingDone.missing
          ? ` and silent on ${meetingDone.missing} of the question's terms`
          : ""),
    );
  if (meetingDone.unverified)
    reasons.push(
      `${meetingDone.unverified} quoted span${meetingDone.unverified === 1 ? "" : "s"} could not be verified`,
    );
  return view(
    "uncertain",
    `The meeting ended unresolved: ${reasons.join("; ")}. Every perspective that spoke still sounds, and no single figure forms.`,
    { settle: 0.68, motion: 0.3, level: 0.6, pigment: "bone" },
    spoken.map((p) => ({ f: PERSPECTIVE_MODES[p].f, a: 0.6, at: EXCITERS[p] })),
    Object.fromEntries(
      PERSPECTIVES.map((p) => [
        p,
        { level: spoken.includes(p) ? 0.45 : 0.05, speaking: false },
      ]),
    ) as ResonanceView["sources"],
  );
}

/**
 * The figure a substrate result is drawn with: the signature of its family's
 * number, a mode with a partner. Chosen by a hash, it means nothing about the
 * mathematics.
 */
function familyFigure(family: string): { mode: PlateMode; at: Point } {
  const s = signatureOf(`mathematics:${family}`, true)!;
  return { mode: s.mode, at: s.exciter };
}
const RANKED = [1, 0.6, 0.4];
const NOT_A_VERDICT =
  " Each figure is chosen by a hash of a family's number: the plate shows that mathematics is on the table, never that it is relevant, applicable or true.";
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function framingView(
  f: NonNullable<ResonanceSnapshot["mathematics"]["framing"]>,
): ResonanceView | null {
  if (!f.families.length) return null;
  const top = f.families.slice(0, 3);
  const asked = f.mode === "challenge" ? "the hypothesis" : "the question";
  if (f.mode === "challenge" && f.challenging > 0)
    return view(
      "math-conflict",
      `A challenge of the hypothesis found ${f.challenging} ${plural(f.challenging, "result that states", "results that state")} a counterexample, an obstruction, a bound or a condition. Each figure sounds with its partner and none forms: whether any of them bears on the hypothesis has not been established.` +
        NOT_A_VERDICT,
      { settle: 0.55, motion: 0.3, level: 0.6, pigment: "copper" },
      top.flatMap((id, i) => {
        const { mode, at } = familyFigure(id);
        return [
          { f: mode.f, a: RANKED[i]! * 0.7, at },
          { f: partnerOf(mode)!.f, a: RANKED[i]! * 0.7, at },
        ];
      }),
      quiet(0.05),
    );
  const drive = top.map((id, i) => {
    const { mode, at } = familyFigure(id);
    return { f: mode.f, a: RANKED[i]!, at };
  });
  if (f.formalized > 0)
    return view(
      "math-formalized",
      `${f.families.length} result ${plural(f.families.length, "family shares", "families share")} terms with ${asked}, and ${f.formalized} ${plural(f.formalized, "has", "have")} a Lean formalization present in the repository. Present is not checked here, and a formalization proves a mathematical statement, never the simulator's behaviour.` +
        NOT_A_VERDICT,
      { settle: 0.75, motion: 0.12, level: 0.65, pigment: "bone" },
      drive,
      quiet(0.05),
    );
  return view(
    "math-context",
    `${f.families.length} result ${plural(f.families.length, "family shares", "families share")} terms with ${asked}, none with a Lean formalization here. Shared words are not applicability.` +
      NOT_A_VERDICT,
    { settle: 0.55, motion: 0.2, level: 0.55, pigment: "bone" },
    drive,
    quiet(0.05),
  );
}

function basisView(
  b: NonNullable<ResonanceSnapshot["mathematics"]["basis"]>,
): ResonanceView {
  const n = b.families.length;
  const top = b.families.slice(0, 3);
  if (b.challenging > 0)
    return view(
      "math-conflict",
      `A person cited ${b.challenging} ${plural(b.challenging, "result", "results")} as a counterexample to, or a contradiction of, the candidate, with stated assumptions. The challenge is recorded with the next proposal, not resolved; each figure sounds against its partner.` +
        NOT_A_VERDICT,
      { settle: 0.55, motion: 0.3, level: 0.6, pigment: "copper" },
      top.flatMap((id, i) => {
        const { mode, at } = familyFigure(id);
        return [
          { f: mode.f, a: RANKED[i]! * 0.7, at },
          { f: partnerOf(mode)!.f, a: RANKED[i]! * 0.7, at },
        ];
      }),
      quiet(0.05),
    );
  if (b.connecting > 0) {
    const s = signatureOf(`basis:${b.families.join(",")}`, true)!;
    return view(
      "hypothesis-formed",
      `A person framed the next proposal with ${n} mathematical ${plural(n, "result", "results")}, stating the assumptions that connect ${plural(n, "it", "them")} to the simulator. A framing, not a finding: nothing has been tested, and only the matched runs will decide.` +
        NOT_A_VERDICT,
      { settle: 0.85, motion: 0.1, level: 0.6, pigment: "bone" },
      [{ f: s.mode.f, a: 1, at: s.exciter }],
      quiet(0.05),
    );
  }
  return view(
    "math-context",
    `${n} ${plural(n, "result is", "results are")} in the next proposal's mathematical basis as context only: nobody has stated a connection to the simulator.` +
      NOT_A_VERDICT,
    { settle: 0.55, motion: 0.2, level: 0.55, pigment: "bone" },
    top.map((id, i) => {
      const { mode, at } = familyFigure(id);
      return { f: mode.f, a: RANKED[i]!, at };
    }),
    quiet(0.05),
  );
}

/**
 * The newest finished thing: a run's record, the next proposal's
 * mathematical basis, a substrate search, or a staged meeting. Ties go to the
 * record, then the basis, then the search, then the meeting.
 */
function ended(s: ResonanceSnapshot): ResonanceView | null {
  const m = s.meeting;
  const meetingDone = m && m.revealed >= m.speakers.length ? m : null;
  const when = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  const candidates: { at: number; order: number; make: () => ResonanceView | null }[] =
    [];
  const r = s.result;
  if (r) candidates.push({ at: when(r.at), order: 0, make: () => resultView(r) });
  const basis = s.mathematics.basis;
  if (basis)
    candidates.push({ at: when(basis.at), order: 1, make: () => basisView(basis) });
  const framing = s.mathematics.framing;
  if (framing)
    candidates.push({ at: when(framing.at), order: 2, make: () => framingView(framing) });
  if (meetingDone)
    candidates.push({
      at: when(meetingDone.stagedAt),
      order: 3,
      make: () => meetingView(meetingDone),
    });
  candidates.sort((a, b) => b.at - a.at || a.order - b.order);
  for (const c of candidates) {
    const v = c.make();
    if (v) return v;
  }
  return null;
}

/**
 * The state the instrument is in. What is happening now comes first — a run,
 * a question in flight, a substrate search, a meeting being staged — then a
 * case waiting for a person, then one a person authorized, then the newest of
 * a finished run, the next proposal's mathematical basis, a substrate search
 * and a finished meeting, then rest.
 */
export function resonanceView(s: ResonanceSnapshot): ResonanceView {
  if (s.run) {
    const { mode, at } = experimentFigure(s.run.definition);
    const pct = Math.round(Math.min(1, Math.max(0, s.run.done)) * 100);
    return view(
      "experiment",
      `${s.run.experimentId} is running${s.run.arms ? `: arm ${s.run.arm + 1} of ${s.run.arms}, ${pct}% of its ticks` : ""}. The simulator, not R.A.I.N., decides what happens; the sand gathers as the run proceeds.`,
      {
        settle: 0.25 + 0.6 * Math.min(1, Math.max(0, s.run.done)),
        motion: 0.55,
        level: 0.7,
        pigment: "verdigris",
      },
      [{ f: mode.f, a: 1, at }],
      quiet(0.05),
    );
  }
  if (s.asking) {
    const share =
      s.progress && s.progress.planned > 0 ? s.progress.started / s.progress.planned : 0;
    return view(
      "listening",
      s.progress
        ? `A model meeting is under way: ${s.progress.started} of ${s.progress.planned} turns started. Its words arrive only when it ends.`
        : "A question is with R.A.I.N. and no answer has arrived. The plate is driven between resonances, where it barely answers.",
      { settle: 0.3, motion: 0.25, level: 0.45 + 0.3 * share, pigment: "verdigris" },
      [{ f: BETWEEN, a: 1, at: BETWEEN_AT }],
      quiet(0.1 + 0.25 * share),
    );
  }
  if (s.mathematics.searching)
    return view(
      "math-search",
      s.mathematics.searching === "challenge"
        ? "R.A.I.N. is searching the mathematical substrate for what could weaken the hypothesis. The plate is driven between resonances while nothing has been found."
        : "R.A.I.N. is searching the mathematical substrate. The plate is driven between resonances while nothing has been found.",
      { settle: 0.3, motion: 0.3, level: 0.5, pigment: "bone" },
      [{ f: SEARCHING, a: 1, at: SEARCHING_AT }],
      quiet(0.06),
    );
  const m = s.meeting;
  if (m && m.revealed < m.speakers.length) {
    const r = Math.max(1, m.revealed);
    const speaker = m.speakers[r - 1]!;
    const heard = m.speakers.slice(0, r);
    const drive = PERSPECTIVES.filter((p) => heard.includes(p)).map((p) => ({
      f: PERSPECTIVE_MODES[p].f,
      a: p === speaker ? 1 : 0.45,
      at: EXCITERS[p],
    }));
    return view(
      "deliberating",
      `Turn ${r} of ${m.speakers.length}: ${speaker} (${m.moves[r - 1]}). Every perspective that has spoken drives the plate at its own resonance; ${speaker} leads.`,
      {
        settle: 0.62 + 0.23 * (r / m.speakers.length),
        motion: 0.6,
        level: 0.7,
        pigment: "verdigris",
      },
      drive,
      Object.fromEntries(
        PERSPECTIVES.map((p) => [
          p,
          {
            level: p === speaker ? 1 : heard.includes(p) ? 0.4 : 0.08,
            speaking: p === speaker,
          },
        ]),
      ) as ResonanceView["sources"],
    );
  }
  if (s.awaiting) {
    const { mode, at } = experimentFigure(s.awaiting.definition);
    return view(
      "awaiting-human",
      `${s.awaiting.experimentId} is AWAITING HUMAN APPROVAL. R.A.I.N. may propose it; only a person can authorize it, in the Experiment Bay. The plate has stopped: nothing drives it until someone decides.`,
      { settle: 1, motion: 0, level: 0.55, pigment: "bone" },
      [{ f: mode.f, a: 1, at }],
      quiet(0.03),
      true,
    );
  }
  if (s.ready) {
    const { mode, at } = experimentFigure(s.ready.definition);
    return view(
      "ready-for-experiment",
      `${s.ready.experimentId} is AUTHORIZED: a person approved its exact definition. It runs only when someone starts it; until then the plate holds its figure, still.`,
      { settle: 1, motion: 0, level: 0.5, pigment: "verdigris" },
      [{ f: mode.f, a: 1, at }],
      quiet(0.03),
    );
  }
  const finished = ended(s);
  if (finished) return finished;
  return s.live
    ? view(
        "idle",
        "R.A.I.N. is connected and nothing is in progress: no question in flight, no meeting being staged, no experiment waiting or running. The plate holds its resting figure.",
        { settle: 0.95, motion: 0.06, level: 0.35, pigment: "bone" },
        [{ f: REST.f, a: 1, at: REST_AT }],
        quiet(0.06),
      )
    : view(
        "idle",
        "The runtime is offline, so nothing drives the plate and the sand lies where it was strewn. The DEMO recording can still be staged here.",
        { settle: 0, motion: 0, level: 0.3, pigment: "bone" },
        [],
        quiet(0.03),
      );
}
