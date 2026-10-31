/**
 * Stage 2 as a study: do two research flies perceive and respond to each
 * other through the bridge, and does it matter that the encounter is live?
 *
 * Between subjects, three conditions with their own seeds
 * (`protocols/encounter-v1.json`):
 * - `live`: pair i, A_i and B_i, bridged both ways;
 * - `yoked`: a new subject C_i shown B_i's recorded body from live pair i,
 *   exactly as A_i was shown it, so it sees the same kind of motion but nothing
 *   it does changes it;
 * - `solitary`: a new subject D_i alone, its bridge never opened.
 *
 * A, C and D share a controller kind and seed distribution, so their
 * differences are the condition's. B's outcomes say whether the response runs
 * both ways.
 */
import type { ArenaSpec } from "../fly/arena.js";
import type { FlyStart } from "../fly/fly.js";
import type { BridgeConfig } from "./bridge.js";
import { refuseOriginal } from "./originals.js";
import { PERCEPT_APPROXIMATIONS } from "./percept.js";
import { runSession, type SessionResult, type SubjectOutcome } from "./session.js";
import { mean, meanDifference, newcombe, r, wilson, type Interval } from "./stats.js";
import { CONTROLLER_APPROXIMATIONS, type SubjectController } from "./subjects.js";

export const ENCOUNTER_SCHEMA = "first-contact-encounter/v1" as const;

export interface EncounterProtocol {
  schema: typeof ENCOUNTER_SCHEMA;
  id: string;
  question: string;
  hypotheses: Record<"E1" | "E2" | "E3", string>;
  pairs: number;
  seedBase: { A: number; B: number; C: number; D: number };
  controllers: { A: SubjectController; B: SubjectController };
  starts: { A: FlyStart; B: FlyStart };
  preContactS: { A: number; B: number };
  contactS: number;
  arena: ArenaSpec;
  bridge: Pick<BridgeConfig, "exchangeS" | "latencyS" | "maxSpeedMS">;
  criteria: { seenShare: number };
}

type Verdict = "supported" | "not supported" | "not interpretable";

export interface ConditionSummary {
  subjects: number;
  escapes: { mean: number | null; any: Interval | null };
  sawOther: { mean: number | null; share: number | null };
  escapesNear: number | null;
  nearS: number | null;
  closestMM: number | null;
  flownM: number | null;
}

export interface EncounterResult {
  schema: typeof ENCOUNTER_SCHEMA;
  protocol: { id: string; sha256: string };
  conditions: {
    live: ConditionSummary;
    yoked: ConditionSummary;
    solitary: ConditionSummary;
  };
  partner: ConditionSummary;
  synchronizedSessions: number;
  bridgeClosedEarly: number;
  contrasts: {
    id: "E1" | "E2" | "E3";
    difference: string;
    meanEscapes: Interval | null;
    anyEscape: Interval | null;
    verdict: Verdict;
  }[];
  clocks: { atContact: [number, number]; offsetS: number };
  approximations: string[];
  sessions: {
    id: string;
    condition: string;
    escapes: number[];
    sawOther: number[];
    head: string | null;
  }[];
  digest: string;
}

function summarizeOutcomes(xs: readonly SubjectOutcome[]): ConditionSummary {
  const any = xs.filter((x) => x.escapes > 0).length;
  const closest = xs.map((x) => x.closestM).filter((x): x is number => x !== null);
  return {
    subjects: xs.length,
    escapes: {
      mean: r(mean(xs.map((x) => x.escapes))),
      any: (() => {
        const w = wilson(any, xs.length);
        return w ? { estimate: r(w.estimate)!, low: r(w.low)!, high: r(w.high)! } : null;
      })(),
    },
    sawOther: {
      mean: r(mean(xs.map((x) => x.sawOther))),
      share: xs.length ? r(xs.filter((x) => x.sawOther > 0).length / xs.length) : null,
    },
    escapesNear: r(mean(xs.map((x) => x.escapesNear))),
    nearS: r(mean(xs.map((x) => x.nearS))),
    closestMM: closest.length ? r((mean(closest) ?? 0) * 1000, 2) : null,
    flownM: r(mean(xs.map((x) => x.flownM))),
  };
}

const ri = (x: Interval | null): Interval | null =>
  x ? { estimate: r(x.estimate)!, low: r(x.low)!, high: r(x.high)! } : null;

export function runEncounterStudy(
  p: EncounterProtocol,
  protocolSha256: string,
  digest: (value: unknown) => string,
  log: (line: string) => void = () => {},
): EncounterResult {
  if (p.schema !== ENCOUNTER_SCHEMA) throw new Error(`protocol: schema ${p.schema}`);
  const auth = (a: string, b: string) => ({
    by: `the frozen protocol ${p.id} (sha256 ${protocolSha256.slice(0, 12)}…), run by scripts/first-contact-evaluate.ts`,
    purpose: "Stage 2 controlled encounters between research subjects",
    subjects: [a, b] as [string, string],
    scope: "research-subjects-only" as const,
  });
  const sessions: SessionResult[] = [];
  const A: SubjectOutcome[] = [],
    B: SubjectOutcome[] = [],
    C: SubjectOutcome[] = [],
    D: SubjectOutcome[] = [];
  let atContact: [number, number] = [0, 0];
  for (let i = 0; i < p.pairs; i++) {
    const id = (role: string) => `research-fc-encounter-${role}-${i}`;
    for (const role of ["A", "B", "C", "D"]) refuseOriginal(id(role));
    const base = {
      preContactS: [p.preContactS.A, p.preContactS.B] as [number, number],
      contactS: p.contactS,
      arena: p.arena,
      bridge: p.bridge,
    };
    const live = runSession({
      ...base,
      id: `live-${i}`,
      condition: "live",
      subjects: [
        {
          id: id("A"),
          seed: p.seedBase.A + i,
          controller: p.controllers.A,
          start: p.starts.A,
        },
        {
          id: id("B"),
          seed: p.seedBase.B + i,
          controller: p.controllers.B,
          start: p.starts.B,
        },
      ],
      authorization: auth(id("A"), id("B")),
    });
    const yoked = runSession(
      {
        ...base,
        id: `yoked-${i}`,
        condition: "yoked",
        subjects: [
          {
            id: id("C"),
            seed: p.seedBase.C + i,
            controller: p.controllers.A,
            start: p.starts.A,
          },
          {
            id: id("B"),
            seed: p.seedBase.B + i,
            controller: p.controllers.B,
            start: p.starts.B,
          },
        ],
        authorization: auth(id("C"), id("B")),
      },
      live.trace,
    );
    const solitary = runSession({
      ...base,
      id: `solitary-${i}`,
      condition: "solitary",
      subjects: [
        {
          id: id("D"),
          seed: p.seedBase.D + i,
          controller: p.controllers.A,
          start: p.starts.A,
        },
        {
          id: id("B"),
          seed: p.seedBase.B + i,
          controller: p.controllers.B,
          start: p.starts.B,
        },
      ],
      authorization: auth(id("D"), id("B")),
    });
    A.push(live.subjects[0]);
    B.push(live.subjects[1]!);
    C.push(yoked.subjects[0]);
    D.push(solitary.subjects[0]);
    atContact = [live.subjects[0].clock[0], live.subjects[1]!.clock[0]];
    sessions.push(live, yoked, solitary);
    if ((i + 1) % 10 === 0) log(`${i + 1} of ${p.pairs} pairs`);
  }
  const live = summarizeOutcomes(A),
    yoked = summarizeOutcomes(C),
    solitary = summarizeOutcomes(D);
  const seenOk = (live.sawOther.share ?? 0) >= p.criteria.seenShare;
  const count = (xs: SubjectOutcome[]) => xs.filter((x) => x.escapes > 0).length;
  const contrast = (
    id: "E1" | "E2" | "E3",
    a: SubjectOutcome[],
    an: string,
    b: SubjectOutcome[],
    bn: string,
    supported: (x: Interval) => boolean,
    needsSeen: boolean,
  ) => {
    const md = meanDifference(
      a.map((x) => x.escapes),
      b.map((x) => x.escapes),
    );
    const any = newcombe(count(a), a.length, count(b), b.length);
    return {
      id,
      difference: `${an} − ${bn}`,
      meanEscapes: ri(md),
      anyEscape: ri(any),
      verdict:
        (needsSeen && !seenOk) || !any
          ? ("not interpretable" as const)
          : supported(any)
            ? ("supported" as const)
            : ("not supported" as const),
    };
  };
  const body = {
    schema: ENCOUNTER_SCHEMA,
    protocol: { id: p.id, sha256: protocolSha256 },
    conditions: { live, yoked, solitary },
    partner: summarizeOutcomes(B),
    synchronizedSessions: sessions.filter((s) => s.synchronized).length,
    bridgeClosedEarly: sessions.filter(
      (s) => s.bridge && s.bridge.closedReason !== "the session ended",
    ).length,
    contrasts: [
      contrast("E1", A, "live A", D, "solitary D", (x) => x.low > 0, true),
      contrast("E2", B, "live B", D, "solitary D", (x) => x.low > 0, true),
      contrast("E3", A, "live A", C, "yoked C", (x) => x.low > 0 || x.high < 0, true),
    ],
    clocks: { atContact, offsetS: r(atContact[0] - atContact[1], 3)! },
    approximations: [
      ...PERCEPT_APPROXIMATIONS,
      ...CONTROLLER_APPROXIMATIONS[p.controllers.A].map((x) => `A, C, D: ${x}`),
      ...CONTROLLER_APPROXIMATIONS[p.controllers.B].map((x) => `B: ${x}`),
    ],
    sessions: sessions.map((s) => ({
      id: s.id,
      condition: s.condition,
      escapes: s.subjects
        .filter((x): x is SubjectOutcome => x !== null)
        .map((x) => x.escapes),
      sawOther: s.subjects
        .filter((x): x is SubjectOutcome => x !== null)
        .map((x) => x.sawOther),
      head: s.bridge?.head ?? null,
    })),
  };
  return { ...body, digest: digest(body) };
}
