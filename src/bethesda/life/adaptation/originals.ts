/**
 * The benchmarks put to the originals (benchmarks.ts, E1–E3 and O1–O3), judged
 * from what anyone may read: responses from their public witnesses, as
 * `scripts/first-contact-observe.ts` records them, and the `live-fly-ledger`
 * branch's two files. Pure: it reads text it is handed and fetches nothing.
 *
 * A benchmark the observations cannot decide is `untestable`. Nothing here is
 * ever passed by default, and nothing the originals report about learning is
 * judged as adaptation: without a counterfactual it is a description.
 */
import {
  parseObservation as parseGarden,
  type Observation,
} from "../../../garden/core/observation.js";
import { parseReplay } from "../../live/publicRecord.js";
import { checkGardenClock, checkLifeClock } from "../../firstContact/clock.js";
import { parseLedger } from "../ledger.js";
import { parseWitness, type LifeObservation } from "../observation.js";
import type { Verdict } from "./benchmarks.js";

/** One recorded response, as the first-contact recorder writes it. */
export interface RecordedResponse {
  receivedUtc: string;
  stream: "eva" | "echo";
  status: number;
  body: string;
}

export interface OriginalsInput {
  responses: readonly RecordedResponse[];
  /** `ledger.jsonl` from the `live-fly-ledger` branch. */
  ledger: string;
  /** `replays.jsonl` from the same branch; "" when none. */
  replays: string;
}

const day = (utc: string) => utc.slice(0, 10);

interface Dated<T> {
  receivedUtc: string;
  value: T;
}

function parsed<T>(
  responses: readonly RecordedResponse[],
  stream: RecordedResponse["stream"],
  parse: (v: unknown) => T,
): { states: Dated<T>[]; refused: number } {
  const states: Dated<T>[] = [];
  let refused = 0;
  for (const r of responses) {
    if (r.stream !== stream) continue;
    if (r.status !== 200) {
      refused++;
      continue;
    }
    try {
      states.push({ receivedUtc: r.receivedUtc, value: parse(JSON.parse(r.body)) });
    } catch {
      refused++;
    }
  }
  states.sort((a, b) => Date.parse(a.receivedUtc) - Date.parse(b.receivedUtc));
  return { states, refused };
}

/** What Eva reports about her learning, first and last, listed and never judged. */
export interface EvaDescription {
  trials: [number, number] | null;
  journeys: [number, number];
  moments: [number | null, number | null];
  predictionError: [number | null, number | null];
  surprises: [number | null, number | null];
  flySamples: [number | null, number | null];
  walkSpeed: [number | null, number | null];
  /** Her clock's seconds per second of her server's, between the first and last state. */
  clockRate: number | null;
}

export interface EvaMeasures {
  states: number;
  refused: number;
  dates: string[];
  lifeIds: string[];
  bornAts: number[];
  /** States whose `updated_at` is not `born_at + 5 s × ticks`. */
  clockBreaks: number;
  /** Consecutive states (in receipt order) whose ticks fell. */
  ticksFell: number;
  description: EvaDescription | null;
}

export function measureEva(input: OriginalsInput): EvaMeasures {
  const { states, refused } = parsed<Observation>(input.responses, "eva", parseGarden);
  const unique = <T>(xs: T[]) => [...new Set(xs)];
  let clockBreaks = 0,
    ticksFell = 0;
  states.forEach((s, i) => {
    if (!checkGardenClock(s.value).consistent) clockBreaks++;
    if (i > 0 && s.value.ticks < states[i - 1]!.value.ticks) ticksFell++;
  });
  const first = states[0]?.value,
    last = states.at(-1)?.value;
  const pair = <T>(f: (o: Observation) => T): [T, T] => [f(first!), f(last!)];
  return {
    states: states.length,
    refused,
    dates: unique(states.map((s) => day(s.receivedUtc))),
    lifeIds: unique(states.map((s) => s.value.lifeId)),
    bornAts: unique(states.map((s) => s.value.bornAt)),
    clockBreaks,
    ticksFell,
    description:
      first && last
        ? {
            trials:
              first.learning && last.learning
                ? [first.learning.trials, last.learning.trials]
                : null,
            journeys: pair((o) => o.journeys),
            moments: pair((o) => o.momentsCount),
            predictionError: pair((o) => o.learning?.predictionError ?? null),
            surprises: pair((o) => o.learning?.surprises ?? null),
            flySamples: pair((o) => o.learning?.fly?.samples ?? null),
            walkSpeed: pair((o) => o.learning?.walk?.estimatedSpeed ?? null),
            clockRate:
              last.serverTime > first.serverTime
                ? (last.updatedAt - first.updatedAt) /
                  (last.serverTime - first.serverTime)
                : null,
          }
        : null,
  };
}

export interface EchoMeasures {
  states: number;
  refused: number;
  dates: string[];
  individuals: string[];
  /** Lease epochs, first and last observed: each writer that takes over adds one. */
  epochs: [number, number] | null;
  /** Engine versions, first and last observed, as canonical text. */
  versions: [string, string] | null;
  clockBreaks: number;
  ledger: {
    lines: number;
    individuals: string[];
    /** Consecutive lines whose sequence or tick did not rise: a rewound history. */
    notRising: number;
    first: { seenUtc: string; checkpoint: number } | null;
    last: { seenUtc: string; checkpoint: number } | null;
  };
  replays: {
    lines: number;
    /** Replays from a release whose seals must reproduce, and how many passed. */
    sealed: number;
    sealedPassed: number;
    /** Each sealed replay's verdict, oldest first. */
    sealedVerdicts: {
      seenUtc: string;
      passed: boolean;
      from: number | null;
      differs: string | null;
    }[];
  };
  description: {
    meals: [number, number];
    escapes: [number, number];
    /** Simulated seconds per UTC second between the first and last observation. */
    clockRate: number | null;
  } | null;
}

export function measureEcho(input: OriginalsInput): EchoMeasures {
  const { states, refused } = parsed<LifeObservation | null>(
    input.responses,
    "echo",
    (v) => parseWitness(v).observation,
  );
  const live = states.filter((s): s is Dated<LifeObservation> => s.value !== null);
  const unique = <T>(xs: T[]) => [...new Set(xs)];
  const first = live[0]?.value,
    last = live.at(-1)?.value;
  const canonical = (o: LifeObservation) =>
    JSON.stringify(Object.fromEntries(Object.entries(o.versions).sort()));
  const individual = first?.individual ?? "";
  const anchors = parseLedger(input.ledger);
  let notRising = 0;
  anchors.forEach((a, i) => {
    const b = anchors[i - 1];
    if (b && (a.checkpoint <= b.checkpoint || a.tick <= b.tick)) notRising++;
  });
  const replays = input.replays
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => parseReplay(line, individual))
    .filter((r) => r !== null);
  const sealed = replays.filter((r) => r.seals?.required === true);
  return {
    states: live.length,
    refused: refused + (states.length - live.length),
    dates: unique(live.map((s) => day(s.receivedUtc))),
    individuals: unique(live.map((s) => s.value.individual)),
    epochs: first && last ? [first.epoch, last.epoch] : null,
    versions: first && last ? [canonical(first), canonical(last)] : null,
    clockBreaks: live.filter((s) => !checkLifeClock(s.value).consistent).length,
    ledger: {
      lines: anchors.length,
      individuals: unique(anchors.map((a) => a.individual)),
      notRising,
      first: anchors[0]
        ? { seenUtc: anchors[0].seenUtc, checkpoint: anchors[0].checkpoint }
        : null,
      last: anchors.at(-1)
        ? { seenUtc: anchors.at(-1)!.seenUtc, checkpoint: anchors.at(-1)!.checkpoint }
        : null,
    },
    replays: {
      lines: replays.length,
      sealed: sealed.length,
      sealedPassed: sealed.filter((r) => r.passed).length,
      sealedVerdicts: sealed.map((r) => ({
        seenUtc: r.seenUtc,
        passed: r.passed,
        from: r.from?.sequence ?? null,
        differs: r.difference
          ? `${r.difference.field} at checkpoint ${r.difference.sequence}`
          : (r.stopped ?? r.reason),
      })),
    },
    description:
      first && last
        ? {
            meals: [first.fly.meals, last.fly.meals],
            escapes: [first.fly.escapes, last.fly.escapes],
            clockRate:
              Date.parse(last.observedUtc) > Date.parse(first.observedUtc)
                ? (last.simulatedSeconds - first.simulatedSeconds) /
                  ((Date.parse(last.observedUtc) - Date.parse(first.observedUtc)) / 1000)
                : null,
          }
        : null,
  };
}

/** Each original benchmark's verdict, by the rule benchmarks.ts fixed. */
export function judgeOriginals(
  eva: EvaMeasures,
  echo: EchoMeasures,
): Record<string, Verdict> {
  const E1: Verdict =
    eva.states < 2 || eva.dates.length < 2
      ? "untestable"
      : eva.lifeIds.length === 1 &&
          eva.bornAts.length === 1 &&
          eva.clockBreaks === 0 &&
          eva.ticksFell === 0
        ? "pass"
        : "fail";
  let O1: Verdict;
  if (echo.states < 2 || echo.dates.length < 2 || !echo.epochs) O1 = "untestable";
  else if (
    echo.individuals.length !== 1 ||
    echo.ledger.individuals.some((i) => i !== echo.individuals[0]) ||
    echo.ledger.notRising > 0 ||
    echo.clockBreaks > 0
  )
    O1 = "fail";
  // Same individual throughout, but with no restart between the observations it says nothing about restarts.
  else O1 = echo.epochs[1] > echo.epochs[0] ? "pass" : "untestable";
  const O2: Verdict =
    echo.replays.sealed === 0
      ? "untestable"
      : echo.replays.sealedPassed === echo.replays.sealed
        ? "pass"
        : "fail";
  return { E1, E2: "untestable", E3: "untestable", O1, O2, O3: "untestable" };
}
