/**
 * The individuality report: two seeded studies on flies with one genesis
 * (individuality.ts), written to docs/benchmarks/fly-individuality/ by
 * `scripts/individuality-evaluate.ts`.
 *
 * - **A. Distinct histories.** 24 individuals, each from the same genesis,
 *   each fed at one site for one drawn spell (12 east, 12 west, alternating),
 *   then probed in the empty yard from four headings under five minds
 *   (self, stored, replay, erased, genesis).
 * - **B. Open-ended adaptation.** 24 individuals whose food moves eight times
 *   among the four sites, lived twice: with memory, and with the memory
 *   lesion applied throughout; the remembering fly also probed after each move.
 *
 * Seeded (SHA-256 of a domain and a counter), so a run reproduces byte for
 * byte. These are seeded studies of one deterministic simulator, not
 * registered R.A.I.N. experiments: no preregistration, no host-drawn seeds,
 * no authorization, and their intervals are over individuals of one
 * genesis, never a population of flies. Node only (the stored arm writes to
 * a temporary directory).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mulberry32 } from "../../lib/noise";
import { sha256 } from "../../rain/sha256";
import { FLY_VERSION } from "../fly/fly";
import { birth, checkpointLife, restoreLife } from "./continuity";
import {
  eraseMemory,
  GENESIS,
  INDIVIDUALITY_VERSION,
  live,
  mindDigest,
  mindOf,
  preference,
  probe,
  PROBE_S,
  PROBE_YAWS,
  relocationLife,
  relocationRun,
  SITE_NAMES,
  trackDistance,
  trainingLife,
  YARD_LIFE,
  YardLife,
  type EpochResult,
  type ProbeResult,
  type SiteName,
} from "./individuality";
import { LifeStore } from "./store";
import { restoreGraph } from "./snapshot";

export const INDIVIDUALITY_REPORT = "fly-individuality-report/v1" as const;
export const INDIVIDUALS = 24;
export const EPOCHS = 8;

/** `count` 32-bit seeds from SHA-256(`domain` + "|" + counter), eight per digest. */
export function seedDomain(domain: string, count: number): number[] {
  const seeds: number[] = [];
  for (let counter = 0; seeds.length < count; counter++) {
    const block = sha256(`${domain}|${counter}`);
    for (let i = 0; i < 64 && seeds.length < count; i += 8) {
      const s = Number.parseInt(block.slice(i, i + 8), 16);
      if (!seeds.includes(s)) seeds.push(s);
    }
  }
  return seeds;
}

// --------------------------------------------------------------- statistics

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r4 = (x: number | null) => (x === null ? null : Number(x.toPrecision(4)));

export interface Summary {
  n: number;
  mean: number | null;
  /**
   * 95% percentile bootstrap over individuals (2000 resamples). The stream is
   * fixed per measure, not per arm, so identical arms print identical intervals.
   */
  ci95: [number, number] | null;
}

function summary(xs: readonly number[], salt: string): Summary {
  if (xs.length < 2) return { n: xs.length, mean: r4(mean(xs)), ci95: null };
  const r = mulberry32(Number.parseInt(sha256(`bootstrap|${salt}`).slice(0, 8), 16));
  const means: number[] = [];
  for (let b = 0; b < 2000; b++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(r() * xs.length)]!;
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return { n: xs.length, mean: r4(mean(xs)), ci95: [r4(means[49]!)!, r4(means[1949]!)!] };
}

/** An exact two-sided sign test over paired differences; ties are dropped. */
export function signTest(diffs: readonly number[]): {
  up: number;
  down: number;
  p: number | null;
} {
  const up = diffs.filter((d) => d > 1e-12).length,
    down = diffs.filter((d) => d < -1e-12).length;
  const n = up + down;
  if (!n) return { up, down, p: null };
  const k = Math.min(up, down);
  let tail = 0,
    c = 1;
  for (let i = 0; i <= n; i++) {
    if (i <= k) tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return { up, down, p: r4(Math.min(1, (2 * tail) / 2 ** n)) };
}

// -------------------------------------------------------------- study A

export const MINDS = ["self", "stored", "replay", "erased", "genesis"] as const;
export type MindArm = (typeof MINDS)[number];

const OPPOSITE: Record<SiteName, SiteName> = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
};

interface ProbeRow {
  yaw: number;
  preference: number;
  first: SiteName | null;
  firstT: number | null;
  near: Record<SiteName, number>;
  digest: string;
}

export interface IndividualA {
  draw: number;
  site: SiteName;
  /** The life: when food came (s), how long the spell was (s), and what the fly did. */
  onsetS: number;
  livedS: number;
  meals: number;
  remembered: number;
  /** Whether the stored and replayed minds are the self mind, byte for byte. */
  storedIsSelf: boolean;
  replayIsSelf: boolean;
  checkpointBytes: number;
  probes: Record<MindArm, ProbeRow[]>;
}

const row = (r: ProbeResult, yaw: number, trained: SiteName): ProbeRow => ({
  yaw: r4(yaw)!,
  preference: r4(preference(r, trained, OPPOSITE[trained]))!,
  first: r.first?.site ?? null,
  firstT: r.first ? r4(r.first.t) : null,
  near: r.near,
  digest: r.digest.slice(0, 16),
});

function individualA(
  i: number,
  draw: number,
  scratch: string,
): {
  result: IndividualA;
  tracks: Record<MindArm, ProbeResult[]>;
} {
  const site: SiteName = i % 2 ? "west" : "east";
  const { journal, end } = trainingLife(site, draw);
  // The individual: born, lived, checkpointed at birth and at the end of its life.
  const life = YARD_LIFE.build(structuredClone(GENESIS));
  const b = birth(YARD_LIFE.id, GENESIS, sha256(`individual|${draw}`).slice(0, 32));
  const dir = join(scratch, `individual-${i}`);
  const store = LifeStore.create(
    dir,
    YARD_LIFE,
    checkpointLife(YARD_LIFE, life, { genesis: GENESIS, birth: b, previous: null }),
    { holder: "individuality-report" },
  );
  live(life, journal, end);
  const last = checkpointLife(YARD_LIFE, life, {
    genesis: GENESIS,
    birth: b,
    previous: store.head(),
    events: journal,
  });
  store.commit(last);
  store.release();
  // Stored: read back from disk by a store that did not write it.
  const reopened = LifeStore.open(dir, YARD_LIFE);
  const stored = restoreLife(YARD_LIFE, reopened.head());
  // Replay: another fly from the same genesis, living the recorded events.
  const replay = new YardLife(structuredClone(GENESIS));
  live(replay, reopened.events(), end);
  // Erased: the fly's own mind, its memory lesioned.
  const erased = new YardLife(structuredClone(GENESIS));
  restoreGraph(mindOf(life), erased.mind);
  eraseMemory(erased.mind.state.nav);

  const minds: Record<MindArm, ReturnType<typeof mindOf> | null> = {
    self: mindOf(life),
    stored: mindOf(stored),
    replay: mindOf(replay),
    erased: mindOf(erased),
    genesis: null,
  };
  const tracks = {} as Record<MindArm, ProbeResult[]>;
  const probes = {} as Record<MindArm, ProbeRow[]>;
  for (const arm of MINDS) {
    tracks[arm] = PROBE_YAWS.map((yaw) => probe(minds[arm], yaw));
    probes[arm] = tracks[arm].map((r, k) => row(r, PROBE_YAWS[k]!, site));
  }
  const self = mindDigest(life);
  return {
    result: {
      draw,
      site,
      onsetS: r4(journal[0]!.tick / 10)!,
      livedS: r4(end / 10)!,
      meals: life.fly.state.counts.meals,
      remembered: life.mind.state.nav.places.length,
      storedIsSelf: mindDigest(stored) === self,
      replayIsSelf: mindDigest(replay) === self,
      checkpointBytes: JSON.stringify(last).length,
      probes,
    },
    tracks,
  };
}

export interface ArmSummaryA {
  /** Preference for the site it fed at over the opposite one, per individual (mean of its four probes). */
  preference: Summary;
  /** Shares of probes whose first site reached was the fed one, the opposite one, another, or none. */
  firstFed: number;
  firstOpposite: number;
  firstOther: number;
  firstNone: number;
  /** Share of individuals whose fed site (east or west) is read correctly from where they went (ties 0.5). */
  decoded: Summary;
  /** Mean distance between two individuals' probe tracks from the same heading (m), over all pairs. */
  twinDistanceM: number;
}

function summarizeA(
  rows: IndividualA[],
  tracks: Record<MindArm, ProbeResult[]>[],
): Record<MindArm, ArmSummaryA> {
  const out = {} as Record<MindArm, ArmSummaryA>;
  for (const arm of MINDS) {
    const probes = rows.flatMap((r) => r.probes[arm].map((p) => ({ p, site: r.site })));
    const share = (f: (x: { p: ProbeRow; site: SiteName }) => boolean) =>
      r4(probes.filter(f).length / probes.length)!;
    const decoded = rows.map((r) => {
      const east = r.probes[arm].reduce((s, p) => s + p.near.east, 0),
        west = r.probes[arm].reduce((s, p) => s + p.near.west, 0);
      if (east === west) return 0.5;
      return (east > west ? "east" : "west") === r.site ? 1 : 0;
    });
    let d = 0,
      pairs = 0;
    for (let i = 0; i < tracks.length; i++)
      for (let j = i + 1; j < tracks.length; j++)
        for (let k = 0; k < PROBE_YAWS.length; k++) {
          d += trackDistance(tracks[i]![arm][k]!, tracks[j]![arm][k]!);
          pairs++;
        }
    out[arm] = {
      preference: summary(
        rows.map((r) => mean(r.probes[arm].map((p) => p.preference))!),
        "A|preference",
      ),
      firstFed: share(({ p, site }) => p.first === site),
      firstOpposite: share(({ p, site }) => p.first === OPPOSITE[site]),
      firstOther: share(
        ({ p, site }) =>
          p.first !== null && p.first !== site && p.first !== OPPOSITE[site],
      ),
      firstNone: share(({ p }) => p.first === null),
      decoded: summary(decoded, "A|decoded"),
      twinDistanceM: r4(d / pairs)!,
    };
  }
  return out;
}

// -------------------------------------------------------------- study B

export interface IndividualB {
  draw: number;
  sites: SiteName[];
  full: EpochResult[];
  amnesic: EpochResult[];
  /** After each move (epochs 2–8): what the remembering fly's first probe site was to that epoch. */
  probeFirst: ("current" | "previous" | "earlier" | "never fed" | null)[];
}

function individualB(draw: number): IndividualB {
  const { journal, epochs } = relocationLife(EPOCHS, draw);
  const probeFirst: IndividualB["probeFirst"] = [];
  const full = relocationRun(epochs, journal, false, (life, k) => {
    if (k < 1) return;
    const first =
      probe(mindOf(life), PROBE_YAWS[k % PROBE_YAWS.length]!).first?.site ?? null;
    const fedAt = new Set(epochs.slice(0, k + 1).map((e) => e.site));
    probeFirst.push(
      first === null
        ? null
        : first === epochs[k]!.site
          ? "current"
          : first === epochs[k - 1]!.site
            ? "previous"
            : fedAt.has(first)
              ? "earlier"
              : "never fed",
    );
  });
  const amnesic = relocationRun(epochs, journal, true);
  return { draw, sites: epochs.map((e) => e.site), full, amnesic, probeFirst };
}

export interface ArmSummaryB {
  /** Per individual, over its eight epochs. */
  mealsPerEpoch: Summary;
  epochsWithoutMeal: Summary;
  latencyS: Summary;
  staleArrivalsPerMove: Summary;
  /** Food places remembered at an epoch's end where the food no longer was. */
  staleRemembered: Summary;
  /** Mean meals in each epoch, first to last, over individuals. */
  mealsByEpoch: (number | null)[];
  latencyByEpoch: (number | null)[];
}

function summarizeB(rows: IndividualB[], arm: "full" | "amnesic"): ArmSummaryB {
  const per = (f: (e: EpochResult[]) => number | null) =>
    rows.map((r) => f(r[arm])).filter((x): x is number => x !== null);
  const found = (e: EpochResult[]) =>
    e.filter((x) => x.latency !== null).map((x) => x.latency!);
  return {
    mealsPerEpoch: summary(
      per((e) => mean(e.map((x) => x.meals))),
      "B|meals",
    ),
    epochsWithoutMeal: summary(
      per((e) => e.filter((x) => x.meals === 0).length),
      "B|none",
    ),
    latencyS: summary(
      per((e) => mean(found(e))),
      "B|latency",
    ),
    staleArrivalsPerMove: summary(
      per((e) => mean(e.slice(1).map((x) => x.staleArrivals))),
      "B|stale",
    ),
    staleRemembered: summary(
      per((e) => mean(e.map((x) => x.staleRemembered))),
      "B|staleMem",
    ),
    mealsByEpoch: Array.from({ length: EPOCHS }, (_, k) =>
      r4(mean(rows.map((r) => r[arm][k]!.meals))),
    ),
    latencyByEpoch: Array.from({ length: EPOCHS }, (_, k) =>
      r4(
        mean(rows.map((r) => r[arm][k]!.latency).filter((x): x is number => x !== null)),
      ),
    ),
  };
}

// --------------------------------------------------------------- the report

export function individualityReport(log: (s: string) => void = () => {}) {
  const scratch = mkdtempSync(join(tmpdir(), "fly-individuality-"));
  try {
    const drawsA = seedDomain(`${INDIVIDUALITY_VERSION}|training`, INDIVIDUALS);
    const a = drawsA.map((draw, i) => {
      const out = individualA(i, draw, scratch);
      log(`A ${i + 1}/${INDIVIDUALS}: ${out.result.site}, ${out.result.meals} meals`);
      return out;
    });
    const rowsA = a.map((x) => x.result);
    const armsA = summarizeA(
      rowsA,
      a.map((x) => x.tracks),
    );
    const selfMinusErased = rowsA.map(
      (r) =>
        mean(r.probes.self.map((p) => p.preference))! -
        mean(r.probes.erased.map((p) => p.preference))!,
    );
    const identicalProbes = (arm: MindArm) =>
      rowsA.every((r) =>
        r.probes[arm].every((p, k) => p.digest === r.probes.self[k]!.digest),
      );
    const genesisAllAlike = PROBE_YAWS.every((_, k) =>
      rowsA.every(
        (r) => r.probes.genesis[k]!.digest === rowsA[0]!.probes.genesis[k]!.digest,
      ),
    );

    const drawsB = seedDomain(`${INDIVIDUALITY_VERSION}|relocation`, INDIVIDUALS);
    const rowsB = drawsB.map((draw, i) => {
      const r = individualB(draw);
      log(`B ${i + 1}/${INDIVIDUALS}: ${r.sites.join(" ")}`);
      return r;
    });
    const mealsDiff = rowsB.map(
      (r) =>
        r.full.reduce((s, e) => s + e.meals, 0) -
        r.amnesic.reduce((s, e) => s + e.meals, 0),
    );
    const noneDiff = rowsB.map(
      (r) =>
        r.full.filter((e) => e.meals === 0).length -
        r.amnesic.filter((e) => e.meals === 0).length,
    );
    const firsts = rowsB.flatMap((r) => r.probeFirst);
    const shareOf = (v: IndividualB["probeFirst"][number]) =>
      r4(firsts.filter((x) => x === v).length / firsts.length)!;

    return {
      schema: INDIVIDUALITY_REPORT,
      individuality: INDIVIDUALITY_VERSION,
      fly: FLY_VERSION,
      genesis: GENESIS,
      probeS: PROBE_S,
      probeYaws: PROBE_YAWS.map((y) => r4(y)!),
      sites: SITE_NAMES,
      a: {
        individuals: INDIVIDUALS,
        continuity: {
          storedIsSelf: rowsA.filter((r) => r.storedIsSelf).length,
          replayIsSelf: rowsA.filter((r) => r.replayIsSelf).length,
          storedProbesIdentical: identicalProbes("stored"),
          replayProbesIdentical: identicalProbes("replay"),
          genesisProbesAllAlike: genesisAllAlike,
          checkpointBytes: summary(
            rowsA.map((r) => r.checkpointBytes),
            "A|bytes",
          ),
        },
        arms: armsA,
        selfMinusErased: {
          preference: summary(selfMinusErased, "A|self-erased"),
          sign: signTest(selfMinusErased),
        },
        individualsDetail: rowsA,
      },
      b: {
        individuals: INDIVIDUALS,
        epochs: EPOCHS,
        full: summarizeB(rowsB, "full"),
        amnesic: summarizeB(rowsB, "amnesic"),
        fullMinusAmnesic: {
          mealsPerLife: summary(mealsDiff, "B|meals-diff"),
          mealsSign: signTest(mealsDiff),
          epochsWithoutMeal: summary(noneDiff, "B|none-diff"),
          epochsWithoutMealSign: signTest(noneDiff),
        },
        probeFirst: {
          probes: firsts.length,
          current: shareOf("current"),
          previous: shareOf("previous"),
          earlier: shareOf("earlier"),
          neverFed: shareOf("never fed"),
          none: shareOf(null),
        },
        individualsDetail: rowsB,
      },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export type IndividualityReport = ReturnType<typeof individualityReport>;

// ---------------------------------------------------------------- the README

const num = (x: number | null | undefined) => (typeof x === "number" ? String(x) : "—");
const ci = (s: Summary) =>
  s.ci95 ? `${num(s.mean)} [${s.ci95[0]}, ${s.ci95[1]}]` : `${num(s.mean)} (n = ${s.n})`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

const ARM_TEXT: Record<MindArm, string> = {
  self: "its own mind",
  stored: "its mind after the whole life went to disk and back",
  replay: "the mind of a same-genesis fly that re-lived its recorded events",
  erased: "its own mind, remembered places erased",
  genesis: "the mind of a same-genesis fly that never lived",
};

export function renderIndividualityReadme(
  r: IndividualityReport,
  commit: string,
): string {
  const A = r.a,
    B = r.b;
  const lines: string[] = [
    "# Digital-fly individuality: seeded report",
    "",
    `Generated by \`node scripts/run-ts.mjs scripts/individuality-evaluate.ts\` from ${commit}; \`--check\` reproduces it byte for byte. Never edit this folder by hand. The design, the arms and what they can and cannot show are in [docs/INDIVIDUAL_CONTINUITY.md](../../INDIVIDUAL_CONTINUITY.md).`,
    "",
    `${r.individuality}, ${r.fly}, reduced-order controller. Every fly has one genesis: seed ${r.genesis.seed}, placed at the yard's centre, ${r.genesis.startReserve} of a full reserve. Seeded study of one deterministic simulator: not a registered R.A.I.N. experiment, and its intervals (95% bootstrap over individuals) say nothing about a population of flies.`,
    "",
    "## A. Distinct histories from one genesis",
    "",
    `${A.individuals} individuals, fed at one site (east or west, alternating) for a drawn spell, then each mind probed for ${r.probeS} s in the empty yard from ${r.probeYaws.length} headings.`,
    "",
    "### Continuity",
    "",
    `- Stored mind is the self mind, byte for byte: ${A.continuity.storedIsSelf} of ${A.individuals}; its probes identical: ${A.continuity.storedProbesIdentical ? "yes" : "no"}.`,
    `- Replayed mind is the self mind: ${A.continuity.replayIsSelf} of ${A.individuals}; its probes identical: ${A.continuity.replayProbesIdentical ? "yes" : "no"}.`,
    `- Never-lived minds probe alike for every individual: ${A.continuity.genesisProbesAllAlike ? "yes" : "no"}.`,
    `- Checkpoint size (bytes): ${ci(A.continuity.checkpointBytes)}.`,
    "",
    "### Behaviour in the probe",
    "",
    "| mind | preference for the fed site | first reached: fed | opposite | other | none | fed site decoded | distance between twins (m) |",
    "| ---- | --------------------------- | ------------------ | -------- | ----- | ---- | ---------------- | -------------------------- |",
    ...MINDS.map((m) => {
      const s = A.arms[m];
      return `| ${m}: ${ARM_TEXT[m]} | ${ci(s.preference)} | ${pct(s.firstFed)} | ${pct(s.firstOpposite)} | ${pct(s.firstOther)} | ${pct(s.firstNone)} | ${ci(s.decoded)} | ${s.twinDistanceM} |`;
    }),
    "",
    `Self minus erased, preference per individual: ${ci(A.selfMinusErased.preference)}; higher in ${A.selfMinusErased.sign.up}, lower in ${A.selfMinusErased.sign.down} (exact sign test p = ${num(A.selfMinusErased.sign.p)}).`,
    "",
    "## B. Open-ended adaptation: food that keeps moving",
    "",
    `${B.individuals} individuals, food moved ${B.epochs} times among the four sites; each life lived with memory (full) and with the memory lesion applied throughout (amnesic), on the same events.`,
    "",
    "| measure (per individual) | full | amnesic |",
    "| ------------------------ | ---- | ------- |",
    `| meals per epoch | ${ci(B.full.mealsPerEpoch)} | ${ci(B.amnesic.mealsPerEpoch)} |`,
    `| epochs without a meal (of ${B.epochs}) | ${ci(B.full.epochsWithoutMeal)} | ${ci(B.amnesic.epochsWithoutMeal)} |`,
    `| latency to the first meal at the new site (s) | ${ci(B.full.latencyS)} | ${ci(B.amnesic.latencyS)} |`,
    `| arrivals at the site the food just left, per move | ${ci(B.full.staleArrivalsPerMove)} | ${ci(B.amnesic.staleArrivalsPerMove)} |`,
    `| remembered places where food no longer is, at an epoch's end | ${ci(B.full.staleRemembered)} | ${ci(B.amnesic.staleRemembered)} |`,
    "",
    `Full minus amnesic, meals per life: ${ci(B.fullMinusAmnesic.mealsPerLife)} (more in ${B.fullMinusAmnesic.mealsSign.up}, fewer in ${B.fullMinusAmnesic.mealsSign.down}; p = ${num(B.fullMinusAmnesic.mealsSign.p)}). Epochs without a meal: ${ci(B.fullMinusAmnesic.epochsWithoutMeal)} (more in ${B.fullMinusAmnesic.epochsWithoutMealSign.up}, fewer in ${B.fullMinusAmnesic.epochsWithoutMealSign.down}; p = ${num(B.fullMinusAmnesic.epochsWithoutMealSign.p)}).`,
    "",
    "By epoch, first to last (mean over individuals):",
    "",
    `| | ${Array.from({ length: B.epochs }, (_, k) => k + 1).join(" | ")} |`,
    `| - | ${Array.from({ length: B.epochs }, () => "-").join(" | ")} |`,
    `| meals, full | ${B.full.mealsByEpoch.map(num).join(" | ")} |`,
    `| meals, amnesic | ${B.amnesic.mealsByEpoch.map(num).join(" | ")} |`,
    `| latency (s), full | ${B.full.latencyByEpoch.map(num).join(" | ")} |`,
    `| latency (s), amnesic | ${B.amnesic.latencyByEpoch.map(num).join(" | ")} |`,
    "",
    `Probes after each move (full only, ${B.probeFirst.probes} probes): the first site reached was the current one in ${pct(B.probeFirst.current)}, the one the food just left in ${pct(B.probeFirst.previous)}, an earlier one in ${pct(B.probeFirst.earlier)}, one never fed at in ${pct(B.probeFirst.neverFed)}, and none in ${pct(B.probeFirst.none)}.`,
    "",
    "Every individual, its life and every probe are in `report.json`.",
    "",
  ];
  return lines.join("\n");
}
