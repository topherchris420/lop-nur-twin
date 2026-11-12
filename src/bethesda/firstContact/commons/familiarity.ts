/**
 * Stage 3b, in the commons: does contact make a partner familiar?
 *
 * Research only (`docs/FIRST_CONTACT.md`, "The commons"). Each replicate is
 * one focal fly of the deployed ECHO's kind with the social brain
 * (`social.ts`), living with one partner of the same kind in the encounter
 * dish (`dish.ts`) for `familiarizationS`. At the first moment after that
 * when the partner is on its feet, out of contact and at least
 * `swapMinDistanceM` away, the condition decides who shares the dish for the
 * test: the partner itself, or a new fly placed where the partner stood (a
 * stranger, a stranger with the partner's exact chemistry, or the stranger's
 * own body with no chemistry at all). The focal fly is never touched by the
 * experimenter: it lives one continuous life, and every condition's history
 * up to the swap is the same (the run is deterministic).
 *
 * What is measured on the focal fly: its α′3 compartment's answer to the
 * partner's and the stranger's chemistry at the swap (a probe on a copy, as
 * calcium imaging would read it, changing nothing); the response at each
 * contact; and what it did at each onset (walked away, alerted). Nothing
 * about the partner's identity is ever available to the focal fly.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { DigitalFly } from "../../fly/fly.js";
import type { V3 } from "../../fly/units.js";
import type { SurfaceChemistry } from "../socialSensing.js";
import { newcombe, r, type Interval, Z95 } from "../stats.js";
import { Commons } from "./commons.js";
import { encounterDish } from "./dish.js";
import { FlyOccupant } from "./occupants.js";
import { SocialBrain, SocialOrganismAdapter, type ContactOnset } from "./social.js";

export const FAMILIARITY_SCHEMA = "first-contact-familiarity/v1" as const;
export const Z90 = 1.6448536269514722;

export type Condition = "same" | "stranger" | "twin" | "unscented";
export type Phase = "development" | "held-out";

export interface FamiliarityProtocol {
  schema: typeof FAMILIARITY_SCHEMA;
  id: string;
  phases: Record<
    Phase,
    {
      replicates: number;
      focalSeedBase: number;
      partnerSeedBase: number;
      strangerSeedBase: number;
      twinSeedBase: number;
    }
  >;
  arms: Record<
    string,
    { focal: { tastes?: boolean; plastic?: boolean }; conditions: Condition[] }
  >;
  /** Changes made after a development run and before the held-out run, with their reasons. */
  revisions?: string[];
  world: "encounter-dish";
  starts: Record<"focal" | "partner", { p: V3; yaw: number }>;
  startReserve: number;
  chemistry: {
    speciesProfile: [number, number, number, number];
    individualSigma: number;
  };
  timing: {
    familiarizationS: number;
    swapMaxWaitS: number;
    swapMinDistanceM: number;
    testS: number;
  };
  criteria: {
    responseMargin: number;
    proportionMargin: number;
    minTestContactShare: number;
    minFamiliarizationContacts: number;
    minFamiliarizedShare: number;
    bootstrap: number;
    bootstrapSeed: number;
  };
}

/** A synthetic individual profile: the species profile with log-normal variation, from the individual's seed. */
export function individualChemistry(
  seed: number,
  spec: FamiliarityProtocol["chemistry"],
): SurfaceChemistry {
  const rng = mulberry32((seed ^ 0x0c4c_0ffe) >>> 0);
  const raw = spec.speciesProfile.map((m) => {
    const u = Math.max(rng(), 1e-12),
      v = rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return m * Math.exp(spec.individualSigma * z);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum) as unknown as SurfaceChemistry;
}

export interface ReplicateRecord {
  arm: string;
  condition: Condition;
  replicate: number;
  seeds: { focal: number; partner: number; test: number | null };
  /** Contacts during familiarization, and the focal's last α′3 response to the partner then. */
  familiarization: { contacts: number; lastResponse: number | null };
  /** Null if the swap rule never held within `swapMaxWaitS`: the replicate is skipped. */
  swapT: number | null;
  /** The focal's α′3 answer at the swap, probed on a copy (null if it cannot taste). */
  probe: { partner: number | null; stranger: number | null } | null;
  test: {
    contacts: number;
    onsets: number;
    firstResponse: number | null;
    /** First onset at which the focal fly was grooming or feeding: was it alerted? */
    firstEligibleAlerted: boolean | null;
    eligible: number;
    alerted: number;
    /** First onset at which it was resting or grooming: did it walk away? */
    firstStationaryWalked: boolean | null;
    stationary: number;
    walked: number;
    escapesAtOnset: number;
    /** Share of the test spent grooming or feeding. */
    groomFeedShare: number;
  } | null;
  focalReserveAtEnd: number;
}

function socialFly(
  commons: Commons,
  place: 0 | 1,
  seed: number,
  start: { p: V3; yaw: number },
  reserve: number,
  brain: SocialBrain,
) {
  return new DigitalFly({
    seed,
    world: commons.view(place),
    start,
    config: { startReserve: reserve },
    adapter: (rng, streams) =>
      new SocialOrganismAdapter(rng, streams, seed, "active", brain),
  });
}

const PERCHED = new Set(["rest", "groom", "walk", "feed"]);

/** One replicate of one arm and condition: deterministic given the protocol. */
export function runReplicate(
  P: FamiliarityProtocol,
  phase: Phase,
  arm: string,
  condition: Condition,
  replicate: number,
  /** Read-only: called at the end with the focal fly's social brain (for figures; changes nothing). */
  inspect?: (focal: SocialBrain, swapT: number | null) => void,
): ReplicateRecord {
  const ph = P.phases[phase];
  const spec = P.arms[arm];
  if (!spec || !spec.conditions.includes(condition))
    throw new Error(`familiarity: no ${condition} in arm ${arm}`);
  const seeds = {
    focal: ph.focalSeedBase + replicate,
    partner: ph.partnerSeedBase + replicate,
    test:
      condition === "same"
        ? null
        : condition === "twin"
          ? ph.twinSeedBase + replicate
          : ph.strangerSeedBase + replicate,
  };
  const chem = {
    focal: individualChemistry(seeds.focal, P.chemistry),
    partner: individualChemistry(seeds.partner, P.chemistry),
    stranger: individualChemistry(ph.strangerSeedBase + replicate, P.chemistry),
  };
  const commons = new Commons(encounterDish());
  const focalBrain = new SocialBrain(seeds.focal, spec.focal);
  const focal = socialFly(
    commons,
    0,
    seeds.focal,
    P.starts.focal,
    P.startReserve,
    focalBrain,
  );
  const tag = `research-fam-${phase}-${replicate}`;
  commons.join(
    0,
    new FlyOccupant({
      id: `${tag}-focal`,
      fly: focal,
      chemistry: chem.focal,
      port: focalBrain,
    }),
  );
  const partnerBrain = new SocialBrain(seeds.partner);
  const partner = socialFly(
    commons,
    1,
    seeds.partner,
    P.starts.partner,
    P.startReserve,
    partnerBrain,
  );
  commons.join(
    1,
    new FlyOccupant({
      id: `${tag}-partner`,
      fly: partner,
      chemistry: chem.partner,
      port: partnerBrain,
    }),
  );

  commons.run(P.timing.familiarizationS);
  const famOnsets = focalBrain.onsets.slice();
  const famResponses = famOnsets
    .map((o) => o.novelty)
    .filter((n): n is number => n !== null);
  const familiarization = {
    contacts: commons.bouts.length + (commons.openBout ? 1 : 0),
    lastResponse: famResponses.at(-1) ?? null,
  };

  // The swap: the partner on its feet, out of contact, far enough away.
  const ready = () => {
    const a = focal.state.p,
      b = partner.state.p;
    return (
      PERCHED.has(partner.state.mode) &&
      !commons.openBout &&
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= P.timing.swapMinDistanceM
    );
  };
  const waitSteps = Math.round(P.timing.swapMaxWaitS / commons.stepS);
  let k = 0;
  while (!ready() && k < waitSteps) {
    commons.step();
    k++;
  }
  const base = {
    arm,
    condition,
    replicate,
    seeds,
    familiarization,
    focalReserveAtEnd: 0,
  };
  if (!ready()) {
    inspect?.(focalBrain, null);
    return {
      ...base,
      swapT: null,
      probe: null,
      test: null,
      focalReserveAtEnd: r(focal.state.reserve / focal.params.reserveJ)!,
    };
  }
  const swapT = commons.t;
  const tastes = spec.focal.tastes ?? true;
  const probe = {
    partner: tastes ? r(focalBrain.compartment.probe(chem.partner, swapT), 6) : null,
    stranger: tastes ? r(focalBrain.compartment.probe(chem.stranger, swapT), 6) : null,
  };
  if (condition !== "same") {
    const at = partner.state;
    const reserve = at.reserve / partner.params.reserveJ;
    commons.leave(1);
    const testBrain = new SocialBrain(seeds.test!);
    const stranger = socialFly(
      commons,
      1,
      seeds.test!,
      { p: [at.p[0], at.p[1], at.p[2]], yaw: at.yaw },
      reserve,
      testBrain,
    );
    const chemistry =
      condition === "twin"
        ? chem.partner
        : condition === "stranger"
          ? chem.stranger
          : null;
    commons.join(
      1,
      new FlyOccupant({
        id: `${tag}-${condition}`,
        fly: stranger,
        chemistry,
        port: testBrain,
      }),
    );
  }
  const boutsBefore = commons.bouts.length + (commons.openBout ? 1 : 0);
  const onsetsBefore = focalBrain.onsets.length;
  let groomFeed = 0,
    samples = 0;
  const testSteps = Math.round(P.timing.testS / commons.stepS);
  for (let s = 0; s < testSteps; s++) {
    commons.step();
    if (s % 20 === 0) {
      samples++;
      if (focal.state.mode === "groom" || focal.state.mode === "feed") groomFeed++;
    }
  }
  // An onset still pending a decision at the end is not counted.
  const onsets: ContactOnset[] = focalBrain.onsets.slice(onsetsBefore);
  const eligible = onsets.filter((o) => o.mode === "groom" || o.mode === "feed");
  const stationary = onsets.filter((o) => o.mode === "rest" || o.mode === "groom");
  inspect?.(focalBrain, swapT);
  return {
    ...base,
    swapT: r(swapT, 3),
    probe,
    test: {
      contacts: commons.bouts.length + (commons.openBout ? 1 : 0) - boutsBefore,
      onsets: onsets.length,
      firstResponse: r(onsets.find((o) => o.novelty !== null)?.novelty ?? null, 6),
      firstEligibleAlerted: eligible[0]?.alerted ?? null,
      eligible: eligible.length,
      alerted: eligible.filter((o) => o.alerted).length,
      firstStationaryWalked: stationary[0]?.touchResponse ?? null,
      stationary: stationary.length,
      walked: stationary.filter((o) => o.touchResponse).length,
      escapesAtOnset: onsets.filter((o) => o.mode === "escape").length,
      groomFeedShare: r(groomFeed / samples, 4)!,
    },
    focalReserveAtEnd: r(focal.state.reserve / focal.params.reserveJ, 4)!,
  };
}

/** Every (arm, condition, replicate) a phase runs, in a fixed order. */
export function plan(P: FamiliarityProtocol, phase: Phase) {
  const out: { arm: string; condition: Condition; replicate: number }[] = [];
  for (const [arm, spec] of Object.entries(P.arms))
    for (const condition of spec.conditions)
      for (let replicate = 0; replicate < P.phases[phase].replicates; replicate++)
        out.push({ arm, condition, replicate });
  return out;
}

/** Percentile bootstrap of a mean, seeded. */
function bootstrapMean(
  xs: number[],
  n: number,
  seed: number,
  z: number,
): Interval | null {
  if (xs.length < 2) return null;
  const rng = mulberry32(seed >>> 0);
  const means = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rng() * xs.length)]!;
    means[b] = s / xs.length;
  }
  means.sort();
  const tail = z === Z95 ? 0.025 : 0.05;
  const est = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    estimate: est,
    low: means[Math.floor(tail * (n - 1))]!,
    high: means[Math.ceil((1 - tail) * (n - 1))]!,
  };
}

export type Verdict = "supported" | "not supported" | "untestable";

export interface FamiliarityResult {
  schema: typeof FAMILIARITY_SCHEMA;
  protocol: { id: string; sha256: string };
  phase: Phase;
  groups: Record<
    string,
    {
      replicates: number;
      skipped: number;
      withTestContact: number;
      familiarized: number;
      meanFamiliarizationContacts: number | null;
      meanFirstResponse: number | null;
      firstResponses: number;
      alerted: { successes: number; n: number };
      walked: { successes: number; n: number };
      meanEscapesAtOnset: number | null;
      meanGroomFeedShare: number | null;
    }
  >;
  manipulation: { passed: boolean; notes: string[] };
  hypotheses: Record<
    string,
    { estimate: Interval | null; n: number; verdict: Verdict; rule: string }
  >;
  lesions: Record<string, string>;
}

const meanOf = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const rr = (i: Interval | null): Interval | null =>
  i ? { estimate: r(i.estimate)!, low: r(i.low)!, high: r(i.high)! } : null;

export function evaluate(
  P: FamiliarityProtocol,
  sha: string,
  phase: Phase,
  records: ReplicateRecord[],
): FamiliarityResult {
  const C = P.criteria;
  const key = (arm: string, c: string) => `${arm}/${c}`;
  const by = new Map<string, ReplicateRecord[]>();
  for (const rec of records) {
    const k = key(rec.arm, rec.condition);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(rec);
  }
  for (const list of by.values()) list.sort((a, b) => a.replicate - b.replicate);
  const groups: FamiliarityResult["groups"] = {};
  const notes: string[] = [];
  let passed = true;
  for (const [k, list] of by) {
    const run = list.filter((x) => x.test);
    const firsts = run
      .map((x) => x.test!.firstResponse)
      .filter((v): v is number => v !== null);
    const al = run
      .map((x) => x.test!.firstEligibleAlerted)
      .filter((v): v is boolean => v !== null);
    const wk = run
      .map((x) => x.test!.firstStationaryWalked)
      .filter((v): v is boolean => v !== null);
    const g = {
      replicates: list.length,
      skipped: list.length - run.length,
      withTestContact: run.filter((x) => x.test!.contacts > 0).length,
      familiarized: list.filter(
        (x) => x.familiarization.contacts >= C.minFamiliarizationContacts,
      ).length,
      meanFamiliarizationContacts: r(
        meanOf(list.map((x) => x.familiarization.contacts)),
        2,
      ),
      meanFirstResponse: r(meanOf(firsts)),
      firstResponses: firsts.length,
      alerted: { successes: al.filter(Boolean).length, n: al.length },
      walked: { successes: wk.filter(Boolean).length, n: wk.length },
      meanEscapesAtOnset: r(meanOf(run.map((x) => x.test!.escapesAtOnset)), 3),
      meanGroomFeedShare: r(meanOf(run.map((x) => x.test!.groomFeedShare))),
    };
    groups[k] = g;
    if (g.withTestContact < C.minTestContactShare * list.length) {
      passed = false;
      notes.push(
        `${k}: ${g.withTestContact} of ${list.length} replicates had a test contact`,
      );
    }
    if (g.familiarized < C.minFamiliarizedShare * list.length) {
      passed = false;
      notes.push(
        `${k}: ${g.familiarized} of ${list.length} replicates reached ${C.minFamiliarizationContacts} familiarization contacts`,
      );
    }
  }
  const paired = (
    arm: string,
    a: Condition,
    b: Condition,
    pick: (x: ReplicateRecord) => number | null,
  ) => {
    const A = new Map((by.get(key(arm, a)) ?? []).map((x) => [x.replicate, pick(x)]));
    const out: number[] = [];
    for (const x of by.get(key(arm, b)) ?? []) {
      const va = A.get(x.replicate),
        vb = pick(x);
      if (va !== null && va !== undefined && vb !== null) out.push(va - vb);
    }
    return out;
  };
  const first = (x: ReplicateRecord) => x.test?.firstResponse ?? null;
  const hyp: FamiliarityResult["hypotheses"] = {};
  const above = (i: Interval | null): Verdict =>
    !i ? "untestable" : i.low > 0 ? "supported" : "not supported";
  const within = (i: Interval | null, m: number): Verdict =>
    !i ? "untestable" : i.low > -m && i.high < m ? "supported" : "not supported";

  const probeDiffs = (by.get(key("intact", "same")) ?? [])
    .filter((x) => x.probe?.partner !== null && x.probe?.partner !== undefined)
    .map((x) => x.probe!.stranger! - x.probe!.partner!);
  const h1 = bootstrapMean(probeDiffs, C.bootstrap, C.bootstrapSeed, Z95);
  hyp.H1 = {
    estimate: rr(h1),
    n: probeDiffs.length,
    verdict: above(h1),
    rule: "95% bootstrap interval of probe(stranger) − probe(partner) wholly above 0",
  };
  const d2 = paired("intact", "stranger", "same", first);
  const h2 = bootstrapMean(d2, C.bootstrap, C.bootstrapSeed + 1, Z95);
  hyp.H2 = {
    estimate: rr(h2),
    n: d2.length,
    verdict: above(h2),
    rule: "95% paired bootstrap interval of first-test-contact response, stranger − same, wholly above 0",
  };
  const g = (k: string) => groups[key("intact", k)];
  const h3 =
    g("stranger") && g("same")
      ? newcombe(
          g("stranger")!.alerted.successes,
          g("stranger")!.alerted.n,
          g("same")!.alerted.successes,
          g("same")!.alerted.n,
          Z95,
        )
      : null;
  hyp.H3 = {
    estimate: rr(h3),
    n: (g("stranger")?.alerted.n ?? 0) + (g("same")?.alerted.n ?? 0),
    verdict: above(h3),
    rule: "95% Newcombe interval of P(alerted | first eligible onset), stranger − same, wholly above 0",
  };
  const d4 = paired("intact", "twin", "same", first);
  const h4 = bootstrapMean(d4, C.bootstrap, C.bootstrapSeed + 3, Z90);
  hyp.H4 = {
    estimate: rr(h4),
    n: d4.length,
    verdict: within(h4, C.responseMargin),
    rule: `90% paired bootstrap interval of first-test-contact response, twin − same, wholly within ±${C.responseMargin}`,
  };
  const h5 =
    g("unscented") && g("stranger")
      ? newcombe(
          g("unscented")!.walked.successes,
          g("unscented")!.walked.n,
          g("stranger")!.walked.successes,
          g("stranger")!.walked.n,
          Z90,
        )
      : null;
  hyp.H5 = {
    estimate: rr(h5),
    n: (g("unscented")?.walked.n ?? 0) + (g("stranger")?.walked.n ?? 0),
    verdict: within(h5, C.proportionMargin),
    rule: `90% Newcombe interval of P(walked away | first stationary onset), unscented − stranger, wholly within ±${C.proportionMargin}`,
  };

  const lesions: Record<string, string> = {};
  const ag = [
    ...(by.get(key("agustatory", "same")) ?? []),
    ...(by.get(key("agustatory", "stranger")) ?? []),
  ];
  lesions.agustatory =
    ag.every((x) => !x.test || x.test.firstResponse === null) &&
    ag.every((x) => x.probe === null || x.probe.partner === null)
      ? "passed: no contact was tasted"
      : "FAILED: a contact was tasted";
  const fr = [
    ...(by.get(key("frozen", "same")) ?? []),
    ...(by.get(key("frozen", "stranger")) ?? []),
  ];
  lesions.frozen = fr.every(
    (x) => (x.test?.firstResponse ?? 1) === 1 && (x.probe?.partner ?? 1) === 1,
  )
    ? "passed: every response was 1"
    : "FAILED: a response was below 1";

  return {
    schema: FAMILIARITY_SCHEMA,
    protocol: { id: P.id, sha256: sha },
    phase,
    groups,
    manipulation: { passed, notes },
    hypotheses: hyp,
    lesions,
  };
}
