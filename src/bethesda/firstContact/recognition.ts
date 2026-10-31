/**
 * Stage 3: does meeting a partner again change what a fly does, and is any
 * change about that partner?
 *
 * A habituation–dishabituation playback design (the protocol is
 * `protocols/recognition-v1.json`, frozen before any run; its SHA-256 is in
 * every result). Each subject is a new research fly in an arena of its own,
 * assigned to one group:
 *
 * - `naive`: one presentation of a partner's flight: the first encounter;
 * - `familiar`: a series of presentations of one partner (F), then a test
 *   presentation of F (a stretch of F's flight not shown before);
 * - `stranger`: the same series of F, then a test presentation of another
 *   partner (S): the control encounter. A response to S that recovers while
 *   the response to F stays reduced would be specific to the partner, which
 *   is what recognition would have to mean here;
 * - `familiar-late`: the series of F, then a test of F after a long delay:
 *   whether any change outlasts the delay.
 *
 * The outcome is an escape during the test presentation. Nothing is scripted:
 * the partners' motion is their own recorded flight, the subjects' responses
 * are their unchanged controllers', and the verdicts are computed from the
 * protocol's criteria. Escape habituation in this fly is one shared scalar
 * (`responsiveness`, params.ts: `habituationStep`, `habituationRecoveryS`),
 * and the sensory model carries no identity; the study measures whether that
 * shows, rather than assuming it.
 */
import { arenaWorld, type ArenaSpec } from "../fly/arena.js";
import { EchoAdapter } from "../fly/echo/adapter.js";
import type { DigitalFly, FlyStart } from "../fly/fly.js";
import type { V3 } from "../fly/units.js";
import { BRIDGE_MOVER_ID, BridgedWorld, BridgeLog, PerceptChannel } from "./bridge.js";
import { applyMap } from "./frames.js";
import { refuseOriginal } from "./originals.js";
import { FLY_EQUIVALENT_RADIUS_M, PERCEPT_APPROXIMATIONS, percept } from "./percept.js";
import {
  drawPlacement,
  flightSegments,
  placementMap,
  recordPartner,
  seeded,
  type FlightSegment,
  type SegmentCriteria,
} from "./playback.js";
import {
  fisherExact,
  mean,
  meanDifference,
  newcombe,
  r,
  wilson,
  type Interval,
} from "./stats.js";
import {
  CONTROLLER_APPROXIMATIONS,
  CONTROLLERS,
  perched,
  researchSubject,
  type SubjectController,
} from "./subjects.js";

export const RECOGNITION_SCHEMA = "first-contact-recognition/v1" as const;
export const GROUPS = ["naive", "familiar", "stranger", "familiar-late"] as const;
export type Group = (typeof GROUPS)[number];
export const PHASES = ["development", "held-out"] as const;
export type Phase = (typeof PHASES)[number];

export interface PhaseSpec {
  subjectsPerGroup: number;
  subjectSeedBase: number;
  partnerSeedBase: number;
}

export interface RecognitionProtocol {
  schema: typeof RECOGNITION_SCHEMA;
  id: string;
  question: string;
  hypotheses: Record<"H1" | "H2" | "H3", string>;
  arms: SubjectController[];
  phases: Record<Phase, PhaseSpec>;
  partners: {
    count: number;
    controller: SubjectController;
    arena: ArenaSpec;
    start: FlyStart;
    settleS: number;
    recordS: number;
  };
  segments: SegmentCriteria;
  subject: { arena: ArenaSpec; start: FlyStart; settleS: number };
  presentations: {
    habituation: number;
    intervalS: number;
    lateDelayS: number;
    missM: number;
    maxElevationDeg: number;
    maxWaitS: number;
    responseWindowS: number;
  };
  exchangeS: number;
  latencyS: number;
  criteria: {
    /** Each group's tests must show the partner to the subject's eyes in at least this share. */
    seenShare: number;
    /** A difference whose whole 95% interval lies within ± this is "no difference larger than it". */
    equivalenceMargin: number;
    /** Familiar and stranger test stretches' mean pass speeds may differ by at most this (m/s). */
    balanceSpeedMS: number;
  };
}

export function checkProtocol(p: RecognitionProtocol): RecognitionProtocol {
  if (p.schema !== RECOGNITION_SCHEMA) throw new Error(`protocol: schema ${p.schema}`);
  for (const a of p.arms)
    if (!(CONTROLLERS as readonly string[]).includes(a))
      throw new Error(`protocol: arm ${a}`);
  for (const ph of PHASES) {
    const s = p.phases[ph];
    if (!(
      Number.isInteger(s.subjectsPerGroup) &&
      s.subjectsPerGroup > 0 &&
      s.subjectsPerGroup <= 1000
    ))
      throw new Error(`protocol: ${ph} subjects per group`);
  }
  const d = p.phases.development,
    h = p.phases["held-out"];
  const span = (s: PhaseSpec) => [s.subjectSeedBase, s.subjectSeedBase + 100_000];
  const [d0, d1] = span(d),
    [h0, h1] = span(h);
  if (d0! < h1! && h0! < d1!)
    throw new Error("protocol: development and held-out subject seeds overlap");
  if (d.partnerSeedBase === h.partnerSeedBase)
    throw new Error("protocol: development and held-out partners must differ");
  if (p.partners.count < 2)
    throw new Error("protocol: a stranger needs two partners or more");
  if (!(p.presentations.habituation >= 1))
    throw new Error("protocol: at least one habituation presentation");
  if (!(p.latencyS >= p.exchangeS))
    throw new Error("protocol: latency below one exchange");
  return p;
}

// --------------------------------------------------------------- the trial

export interface PresentationRecord {
  kind: "habituation" | "test";
  partner: string;
  segment: number;
  /** Subject clock at the start (s), and how long it waited to be perched first. */
  startS: number;
  waitedS: number;
  skipped: boolean;
  escaped: boolean;
  /** Decisions whose strongest looming thing was the partner. */
  seen: number;
  /** Closest the partner's body came to the subject's (m): the experimenter's measure. */
  closestM: number | null;
  speedAtPassMS: number;
  /** The subject's escape responsiveness when the presentation began (fly.ts): a readout, never shown to the fly. */
  responsiveness: number;
}

export interface SubjectRecord {
  id: string;
  arm: SubjectController;
  group: Group;
  seed: number;
  familiar: string;
  stranger: string | null;
  presentations: PresentationRecord[];
  /** ECHO's self-model, where the arm has one: episodes and inquiries before the first presentation and after the test. */
  selfModel: { before: [number, number]; after: [number, number] } | null;
  /** The playback log's head: one hash-chained event per presentation. */
  logHead: string;
}

function selfModelCounts(fly: DigitalFly): [number, number] | null {
  if (!(fly.adapter instanceof EchoAdapter)) return null;
  const s = fly.adapter.state.self;
  return s ? [s.episodes.length, s.counts.inquiries] : null;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface Pool {
  partners: { id: string; seed: number; segments: FlightSegment[] }[];
}

/** Records every partner of a phase and cuts its stretches. */
export function partnerPool(p: RecognitionProtocol, phase: Phase): Pool {
  const ph = p.phases[phase];
  const partners = [];
  for (let j = 0; j < p.partners.count; j++) {
    const id = `research-fc-partner-${phase}-${j}`;
    refuseOriginal(id);
    const seed = ph.partnerSeedBase + j;
    const trace = recordPartner(
      { id, seed, controller: p.partners.controller, start: p.partners.start },
      p.partners.arena,
      { durationS: p.partners.recordS, stepS: p.exchangeS, settleS: p.partners.settleS },
    );
    partners.push({
      id,
      seed,
      segments: flightSegments(id, trace, p.exchangeS, p.segments),
    });
  }
  return { partners };
}

function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Runs one subject through its group's schedule. */
export function runSubject(
  p: RecognitionProtocol,
  pool: Pool,
  arm: SubjectController,
  group: Group,
  seed: number,
  id: string,
): SubjectRecord {
  refuseOriginal(id);
  const usable = pool.partners.filter(
    (x) => x.segments.length >= p.presentations.habituation + 1,
  );
  if (usable.length < 2)
    throw new Error("recognition: fewer than two partners have enough stretches");
  const rng = seeded(seed ^ 0x51ed270b);
  const fi = Math.floor(rng() * usable.length);
  let si = Math.floor(rng() * (usable.length - 1));
  if (si >= fi) si++;
  const F = usable[fi]!,
    S = usable[si]!;
  const fSegs = shuffled(F.segments, rng);
  const sSeg = S.segments[Math.floor(rng() * S.segments.length)]!;
  const channel = new PerceptChannel(p.latencyS);
  const world = new BridgedWorld(
    arenaWorld(p.subject.arena, `subject-arena:${id}`),
    channel,
    (t) => t,
  );
  const { fly } = researchSubject(
    { id, seed, controller: arm, start: p.subject.start },
    world,
  );
  const log = new BridgeLog();
  fly.advance(p.subject.settleS);
  const dt = p.exchangeS;
  const step = () => fly.advance(dt);

  const present = (
    seg: FlightSegment,
    kind: PresentationRecord["kind"],
  ): PresentationRecord => {
    let waited = 0;
    while (!perched(fly) && waited < p.presentations.maxWaitS) {
      step();
      waited = round6(waited + dt);
    }
    const responsiveness = fly.state.responsiveness;
    const base: Omit<PresentationRecord, "skipped" | "escaped" | "seen" | "closestM"> = {
      kind,
      partner: seg.partner,
      segment: seg.index,
      startS: fly.state.t,
      waitedS: waited,
      speedAtPassMS: seg.speedAtPassMS,
      responsiveness,
    };
    if (!perched(fly)) {
      log.append(fly.state.t, "presentation", {
        kind,
        partner: seg.partner,
        segment: seg.index,
        skipped: true,
      });
      return { ...base, skipped: true, escaped: false, seen: 0, closestM: null };
    }
    const placement = drawPlacement(
      rng,
      { p: fly.state.p, yaw: fly.state.yaw },
      p.presentations.missM,
      (p.presentations.maxElevationDeg * Math.PI) / 180,
    );
    const map = placementMap(seg, placement, `${id}:${kind}:${seg.partner}:${seg.index}`);
    log.append(fly.state.t, "presentation", {
      kind,
      partner: seg.partner,
      segment: seg.index,
      map,
    });
    const escapes0 = fly.state.counts.escapes;
    let seen = 0,
      lastFrameT = -1,
      closest = Infinity;
    const watch = (center: V3 | null) => {
      const f = fly.lastFrame;
      if (f && f.t !== lastFrameT) {
        lastFrameT = f.t;
        if (f.looming?.id === BRIDGE_MOVER_ID) seen++;
      }
      if (center) {
        const d = Math.hypot(
          center[0] - fly.state.p[0],
          center[1] - fly.state.p[1],
          center[2] - fly.state.p[2],
        );
        if (d < closest) closest = d;
      }
    };
    for (let k = 0; k < seg.samples.length; k++) {
      const center = applyMap(map, seg.samples[k]!);
      channel.push(fly.state.t, percept({ center, radius: FLY_EQUIVALENT_RADIUS_M }));
      watch(center);
      step();
    }
    channel.break();
    const after = Math.round(p.presentations.responseWindowS / dt);
    for (let k = 0; k < after; k++) {
      watch(null);
      step();
    }
    return {
      ...base,
      skipped: false,
      escaped: fly.state.counts.escapes > escapes0,
      seen,
      closestM: Number.isFinite(closest) ? closest : null,
    };
  };

  const waitUntil = (t: number) => {
    while (fly.state.t < t - 1e-9) step();
  };

  const records: PresentationRecord[] = [];
  const before = selfModelCounts(fly);
  if (group === "naive") {
    records.push(present(fSegs[0]!, "test"));
  } else {
    let start = fly.state.t;
    for (let i = 0; i < p.presentations.habituation; i++) {
      if (i) waitUntil(start + p.presentations.intervalS);
      start = fly.state.t;
      records.push(present(fSegs[i]!, "habituation"));
    }
    waitUntil(
      start +
        (group === "familiar-late"
          ? p.presentations.lateDelayS
          : p.presentations.intervalS),
    );
    records.push(
      present(group === "stranger" ? sSeg : fSegs[p.presentations.habituation]!, "test"),
    );
  }
  const after = selfModelCounts(fly);
  return {
    id,
    arm,
    group,
    seed,
    familiar: F.id,
    stranger: group === "stranger" ? S.id : null,
    presentations: records,
    selfModel: before && after ? { before, after } : null,
    logHead: log.head,
  };
}

// ------------------------------------------------------------- the analysis

type Verdict = "supported" | "not supported" | "not interpretable";

export interface GroupSummary {
  assigned: number;
  tested: number;
  skipped: number;
  escaped: number;
  escape: Interval | null;
  seenShare: number | null;
  responsivenessAtTest: number | null;
  testPassSpeedMS: number | null;
  selfModelEpisodesAdded: number | null;
}

export interface Contrast {
  id: "H1" | "H2" | "H3";
  difference: string;
  estimate: Interval | null;
  fisherP: number | null;
  verdict: Verdict;
  /** True when the whole interval lies within ± the equivalence margin. */
  withinMargin: boolean;
}

export interface ArmSummary {
  arm: SubjectController;
  approximations: string[];
  groups: Record<Group, GroupSummary>;
  habituationCurve: {
    index: number;
    tested: number;
    escaped: number;
    share: number | null;
  }[];
  manipulation: { passed: boolean; detail: string };
  balance: { familiarMinusStrangerMS: Interval | null; passed: boolean };
  contrasts: Contrast[];
}

const ri = (x: Interval | null, d = 4): Interval | null =>
  x ? { estimate: r(x.estimate, d)!, low: r(x.low, d)!, high: r(x.high, d)! } : null;

export function summarize(
  p: RecognitionProtocol,
  subjects: readonly SubjectRecord[],
): ArmSummary[] {
  return p.arms.map((arm) => {
    const mine = subjects.filter((s) => s.arm === arm);
    const tests = (g: Group) =>
      mine.filter((s) => s.group === g).map((s) => s.presentations.at(-1)!);
    const groups = {} as Record<Group, GroupSummary>;
    for (const g of GROUPS) {
      const t = tests(g);
      const done = t.filter((x) => !x.skipped);
      const esc = done.filter((x) => x.escaped).length;
      const sm = mine
        .filter((s) => s.group === g && s.selfModel)
        .map((s) => s.selfModel!.after[0] - s.selfModel!.before[0]);
      groups[g] = {
        assigned: t.length,
        tested: done.length,
        skipped: t.length - done.length,
        escaped: esc,
        escape: ri(wilson(esc, done.length)),
        seenShare: done.length
          ? r(done.filter((x) => x.seen > 0).length / done.length)
          : null,
        responsivenessAtTest: r(mean(done.map((x) => x.responsiveness))),
        testPassSpeedMS: r(mean(done.map((x) => x.speedAtPassMS))),
        selfModelEpisodesAdded: sm.length ? r(mean(sm)) : null,
      };
    }
    const curve = Array.from({ length: p.presentations.habituation }, (_, i) => {
      const xs = mine
        .filter((s) => s.group !== "naive")
        .map((s) => s.presentations[i]!)
        .filter((x) => x && !x.skipped);
      const e = xs.filter((x) => x.escaped).length;
      return {
        index: i + 1,
        tested: xs.length,
        escaped: e,
        share: xs.length ? r(e / xs.length) : null,
      };
    });
    const seenOk = GROUPS.every(
      (g) => (groups[g].seenShare ?? 0) >= p.criteria.seenShare,
    );
    const manipulation = {
      passed: seenOk,
      detail: GROUPS.map((g) => `${g} ${groups[g].seenShare ?? "—"}`).join(", "),
    };
    const fam = tests("familiar").filter((x) => !x.skipped),
      str = tests("stranger").filter((x) => !x.skipped);
    const speedDiff = meanDifference(
      fam.map((x) => x.speedAtPassMS),
      str.map((x) => x.speedAtPassMS),
    );
    const balance = {
      familiarMinusStrangerMS: ri(speedDiff),
      passed:
        speedDiff !== null && Math.abs(speedDiff.estimate) <= p.criteria.balanceSpeedMS,
    };
    const contrast = (
      id: Contrast["id"],
      a: Group,
      b: Group,
      supported: (x: Interval) => boolean,
    ): Contrast => {
      const A = groups[a],
        B = groups[b];
      const est = newcombe(A.escaped, A.tested, B.escaped, B.tested);
      const interpretable =
        manipulation.passed && est !== null && (id !== "H2" || balance.passed);
      return {
        id,
        difference: `P(escape | ${a}) − P(escape | ${b})`,
        estimate: ri(est),
        fisherP: r(fisherExact(A.escaped, A.tested, B.escaped, B.tested), 6),
        verdict: !interpretable
          ? "not interpretable"
          : supported(est)
            ? "supported"
            : "not supported",
        withinMargin:
          est !== null &&
          est.low >= -p.criteria.equivalenceMargin &&
          est.high <= p.criteria.equivalenceMargin,
      };
    };
    return {
      arm,
      approximations: [...CONTROLLER_APPROXIMATIONS[arm]],
      groups,
      habituationCurve: curve,
      manipulation,
      balance,
      contrasts: [
        contrast("H1", "familiar", "naive", (x) => x.high < 0),
        contrast("H2", "stranger", "familiar", (x) => x.low > 0),
        contrast("H3", "familiar-late", "naive", (x) => x.high < 0),
      ],
    };
  });
}

export interface RecognitionResult {
  schema: typeof RECOGNITION_SCHEMA;
  protocol: { id: string; sha256: string };
  phase: Phase;
  partners: {
    id: string;
    seed: number;
    stretches: number;
    meanPassSpeedMS: number | null;
  }[];
  arms: ArmSummary[];
  approximations: string[];
  subjects: {
    id: string;
    arm: string;
    group: Group;
    seed: number;
    tests: string;
    logHead: string;
  }[];
  digest: string;
}

/** Runs a whole phase. `log` gets progress lines. */
export function runRecognition(
  p: RecognitionProtocol,
  protocolSha256: string,
  phase: Phase,
  digest: (value: unknown) => string,
  log: (line: string) => void = () => {},
): RecognitionResult {
  checkProtocol(p);
  const ph = p.phases[phase];
  const pool = partnerPool(p, phase);
  log(
    `partners: ${pool.partners.map((x) => `${x.id} ${x.segments.length} stretches`).join("; ")}`,
  );
  const subjects: SubjectRecord[] = [];
  p.arms.forEach((arm, ai) => {
    for (let i = 0; i < ph.subjectsPerGroup * GROUPS.length; i++) {
      const group = GROUPS[i % GROUPS.length]!;
      const seed = ph.subjectSeedBase + ai * 10_000 + i;
      const id = `research-fc-${phase}-${arm}-${i}`;
      subjects.push(runSubject(p, pool, arm, group, seed, id));
    }
    log(`${arm}: ${ph.subjectsPerGroup * GROUPS.length} subjects`);
  });
  const arms = summarize(p, subjects);
  const compact = subjects.map((s) => ({
    id: s.id,
    arm: s.arm,
    group: s.group,
    seed: s.seed,
    // Per presentation: E escaped, n not, s skipped; seen in parentheses when zero.
    tests: s.presentations
      .map((x) => (x.skipped ? "s" : (x.escaped ? "E" : "n") + (x.seen ? "" : "?")))
      .join(""),
    logHead: s.logHead,
  }));
  const body = {
    schema: RECOGNITION_SCHEMA,
    protocol: { id: p.id, sha256: protocolSha256 },
    phase,
    partners: pool.partners.map((x) => ({
      id: x.id,
      seed: x.seed,
      stretches: x.segments.length,
      meanPassSpeedMS: r(mean(x.segments.map((s) => s.speedAtPassMS))),
    })),
    arms,
    approximations: [...PERCEPT_APPROXIMATIONS],
    subjects: compact,
  };
  return { ...body, digest: digest(body) };
}
