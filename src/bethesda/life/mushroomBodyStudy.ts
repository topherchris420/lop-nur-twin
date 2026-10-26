/**
 * Study C: what the mushroom-body controller learns, on yard flies of one
 * genesis (individuality.ts), written to docs/benchmarks/fly-mushroom-body/
 * by `scripts/mushroom-body-evaluate.ts`.
 *
 * - **C1. Extinction.** 24 individuals, each fed at one site (east or west,
 *   alternating); the food is taken away as the fly begins its first meal
 *   there, or its third, and the fly lives on for an hour in the empty yard.
 *   Every life is lived by four controllers on the same events: the
 *   reduced-order controller (its bookkeeping gives a place up after two
 *   fruitless returns), the mushroom-body controller, the same with its
 *   dopaminergic neurons' output blocked in fruitless returns, and the
 *   bookkeeping with one fruitless return instead of two.
 * - **C2. Relocation.** Study B's 24 lives (food moved eight times among the
 *   four sites), lived by the reduced-order and the mushroom-body
 *   controllers.
 *
 * Seeded like studies A and B, and like them not a registered R.A.I.N.
 * experiment. It was designed after a pilot on six individuals, which found
 * that in relocation lives no return flight reaches the place it was aimed
 * at; its contrasts were chosen knowing the pilot, not preregistered.
 */
import { FLY_VERSION } from "../fly/fly";
import { MushroomBodyController } from "../fly/mushroomBody/controller";
import { MUSHROOM_BODY_PARAMS } from "../fly/mushroomBody/params";
import type { Place } from "../fly/navigation";
import {
  AT_SITE_M,
  INDIVIDUALITY_VERSION,
  relocationLife,
  relocationRun,
  SITES,
  TICK_S,
  trainingLife,
  YARD_LIFE,
  YARD_MINDS,
  YardLife,
  GENESIS,
  type EpochResult,
  type SiteName,
  type YardMind,
} from "./individuality";
import {
  EPOCHS,
  INDIVIDUALS,
  seedDomain,
  signTest,
  summary,
  type Summary,
} from "./individualityReport";

export const MUSHROOM_BODY_STUDY = "fly-mushroom-body-study/v1" as const;
export const MUSHROOM_BODY_REPORT = "fly-mushroom-body-report/v1" as const;
/** Meals at the site before the food is taken away: once, or three times. */
export const TRAINING_MEALS = [1, 3] as const;
export type TrainingMeals = (typeof TRAINING_MEALS)[number];
/** A fly that has not begun its last training meal by then has no extinction (s). */
export const TRAINING_CAP_S = 3600;
/** How long the fly lives on in the empty yard (s). */
export const EXTINCTION_S = 3600;
/** The controllers C2 compares. */
export const RELOCATION_MINDS = ["reduced-order", "mushroom-body"] as const;

const r4 = (x: number | null) => (x === null ? null : Number(x.toPrecision(4)));

// ------------------------------------------------------------ return flights

/**
 * Watches a fly tick by tick: the long flights its controller aims at a
 * remembered food place, how they end, and the fruitless returns the
 * controller registers (a place's misses rising, or the circuit's
 * unrewarded trials).
 */
class ReturnWatch {
  launched = 0;
  /** Return flights given up where the fly smelled food: a hungry fly follows the odour instead. */
  inOdour = 0;
  lastLaunchTick: number | null = null;
  private since: number | null = null;
  private misses = new Map<Place, number>();
  private extra = 0;
  private readonly life: YardLife;
  private readonly circuit0: number;

  constructor(life: YardLife) {
    this.life = life;
    this.circuit0 = this.circuitFruitless();
    this.snapshot();
  }

  private circuitFruitless(): number {
    const a = this.life.mind;
    return a instanceof MushroomBodyController ? a.circuit.state.fruitless : 0;
  }

  private snapshot(): void {
    this.misses = new Map(this.life.nav.places.map((p) => [p, p.misses]));
  }

  /** Call after every tick. */
  tick(): void {
    const life = this.life;
    for (const [p, m] of this.misses) if (p.misses > m) this.extra++;
    this.snapshot();
    const g = life.nav.goal;
    const now = g?.kind === "return" ? g.since : null;
    if (this.since !== null && now !== this.since) {
      const p = life.fly.state.p;
      if (life.world.odour(p) >= life.fly.params.odourDetect) this.inOdour++;
    }
    if (now !== null && now !== this.since) {
      this.launched++;
      this.lastLaunchTick = life.tick;
    }
    this.since = now;
  }

  /** Fruitless returns the controller registered since the watch began. */
  get fruitless(): number {
    return this.extra + this.circuitFruitless() - this.circuit0;
  }
}

// ------------------------------------------------------------------ C1

export interface ExtinctionRun {
  /** From the food's arrival to the start of the last training meal (s); null if not begun by `TRAINING_CAP_S`, and then nothing else is measured. */
  trainedS: number | null;
  /** In the empty hour: long flights the controller aimed at the remembered place. */
  returns: number;
  /** Of them, the ones the controller registered as fruitless. */
  fruitless: number;
  /** When the last return flight was launched (s after the food went), or null. */
  lastReturnS: number | null;
  /** Entries within `AT_SITE_M` of the site, however the fly came there. */
  arrivals: number;
  /** Whether the place still draws a hungry fly back at the hour's end. */
  stillDrawn: boolean;
  /** The circuit's prediction m+ − m− for the place's cue at the hour's end (mushroom-body controllers). */
  value: number | null;
}

export interface ExtinctionIndividual {
  draw: number;
  site: SiteName;
  meals: TrainingMeals;
  runs: Record<YardMind, ExtinctionRun>;
}

function extinctionRun(
  site: SiteName,
  draw: number,
  meals: TrainingMeals,
  mind: YardMind,
): ExtinctionRun {
  const food = trainingLife(site, draw).journal[0]!;
  const life = new YardLife({ ...GENESIS, mind });
  const cap = food.tick + Math.round(TRAINING_CAP_S / TICK_S);
  let trained = false;
  while (life.tick < cap) {
    if (life.tick === food.tick) YARD_LIFE.apply!(life, food);
    life.step(1);
    if (life.fly.state.counts.meals >= meals) {
      trained = true;
      break;
    }
  }
  const none: ExtinctionRun = {
    trainedS: null,
    returns: 0,
    fruitless: 0,
    lastReturnS: null,
    arrivals: 0,
    stillDrawn: false,
    value: null,
  };
  if (!trained) return none;
  // The fly has begun meal `meals`, so its circuit has had that many rewarded
  // trials; the food goes, and the meal ends at its controller's next decision.
  YARD_LIFE.apply!(life, { tick: life.tick, kind: "food", data: { site: null } });
  const removed = life.tick;
  const watch = new ReturnWatch(life);
  const [sx, sz] = SITES[site];
  let arrivals = 0,
    wasAt = true;
  while (life.tick < removed + Math.round(EXTINCTION_S / TICK_S)) {
    life.step(1);
    watch.tick();
    const p = life.fly.state.p;
    const at = Math.hypot(p[0] - sx, p[2] - sz) < AT_SITE_M;
    if (at && !wasAt) arrivals++;
    wasAt = at;
  }
  const place = life.nav.places.find((p) => p.kind === "food") ?? null;
  const a = life.mind;
  const circuit = a instanceof MushroomBodyController ? a.circuit : null;
  const cue = place?.landmarks[0];
  return {
    trainedS: r4((removed - food.tick) * TICK_S),
    returns: watch.launched,
    fruitless: watch.fruitless,
    lastReturnS:
      watch.lastLaunchTick === null
        ? null
        : r4((watch.lastLaunchTick - removed) * TICK_S),
    arrivals,
    stillDrawn: place !== null && (circuit ? circuit.worth(place) : true),
    value: circuit && cue !== undefined ? r4(circuit.predict(cue)) : null,
  };
}

export interface ExtinctionArm {
  trained: number;
  returns: Summary;
  fruitless: Summary;
  lastReturnS: Summary;
  arrivals: Summary;
  /** Share of trained individuals whose place still draws the fly back after the hour. */
  stillDrawn: number | null;
  value: Summary;
}

function summarizeExtinction(
  rows: ExtinctionIndividual[],
  mind: YardMind,
): ExtinctionArm {
  const runs = rows.map((r) => r.runs[mind]).filter((x) => x.trainedS !== null);
  const of = (f: (x: ExtinctionRun) => number | null) =>
    runs.map(f).filter((x): x is number => x !== null);
  return {
    trained: runs.length,
    returns: summary(
      of((x) => x.returns),
      "C1|returns",
    ),
    fruitless: summary(
      of((x) => x.fruitless),
      "C1|fruitless",
    ),
    lastReturnS: summary(
      of((x) => x.lastReturnS),
      "C1|last",
    ),
    arrivals: summary(
      of((x) => x.arrivals),
      "C1|arrivals",
    ),
    stillDrawn: runs.length
      ? r4(runs.filter((x) => x.stillDrawn).length / runs.length)
      : null,
    value: summary(
      of((x) => x.value),
      "C1|value",
    ),
  };
}

/** Paired differences in return flights, over individuals trained under both. */
function contrast(
  a: (r: ExtinctionRun) => number,
  b: (r: ExtinctionRun) => number,
  pairs: [ExtinctionRun, ExtinctionRun][],
  salt: string,
) {
  const diffs = pairs
    .filter(([x, y]) => x.trainedS !== null && y.trainedS !== null)
    .map(([x, y]) => a(x) - b(y));
  return { returns: summary(diffs, salt), sign: signTest(diffs) };
}

// ------------------------------------------------------------------ C2

export interface RelocationRunC {
  meals: number;
  epochsWithoutMeal: number;
  returns: number;
  inOdour: number;
  fruitless: number;
  /** The circuit's trials over the life (mushroom-body controller). */
  trials: number | null;
}

export interface RelocationIndividual {
  draw: number;
  sites: SiteName[];
  runs: Record<(typeof RELOCATION_MINDS)[number], RelocationRunC>;
  /** Whether both controllers lived the same epochs, measure for measure. */
  identical: boolean;
}

function relocationIndividual(draw: number): RelocationIndividual {
  const { journal, epochs } = relocationLife(EPOCHS, draw);
  const results = {} as Record<(typeof RELOCATION_MINDS)[number], EpochResult[]>;
  const runs = {} as RelocationIndividual["runs"];
  for (const mind of RELOCATION_MINDS) {
    let watch: ReturnWatch | null = null;
    const circuit = { trials: null as number | null };
    results[mind] = relocationRun(epochs, journal, {
      mind,
      onTick: (life) => (watch ??= new ReturnWatch(life)).tick(),
      onEpochEnd: (life) => {
        const a = life.mind;
        if (a instanceof MushroomBodyController) circuit.trials = a.circuit.state.trials;
      },
    });
    const e = results[mind];
    const w = watch as ReturnWatch | null;
    runs[mind] = {
      meals: e.reduce((s, x) => s + x.meals, 0),
      epochsWithoutMeal: e.filter((x) => x.meals === 0).length,
      returns: w?.launched ?? 0,
      inOdour: w?.inOdour ?? 0,
      fruitless: w?.fruitless ?? 0,
      trials: circuit.trials,
    };
  }
  return {
    draw,
    sites: epochs.map((e) => e.site),
    runs,
    identical:
      JSON.stringify(results["reduced-order"]) ===
      JSON.stringify(results["mushroom-body"]),
  };
}

function summarizeRelocation(
  rows: RelocationIndividual[],
  mind: (typeof RELOCATION_MINDS)[number],
) {
  const of = (f: (x: RelocationRunC) => number) => rows.map((r) => f(r.runs[mind]));
  return {
    meals: summary(
      of((x) => x.meals),
      "C2|meals",
    ),
    epochsWithoutMeal: summary(
      of((x) => x.epochsWithoutMeal),
      "C2|none",
    ),
    returns: summary(
      of((x) => x.returns),
      "C2|returns",
    ),
    inOdour: summary(
      of((x) => x.inOdour),
      "C2|odour",
    ),
    fruitless: summary(
      of((x) => x.fruitless),
      "C2|fruitless",
    ),
  };
}

// ---------------------------------------------------------------- the report

export function mushroomBodyReport(log: (s: string) => void = () => {}) {
  const drawsC1 = seedDomain(`${MUSHROOM_BODY_STUDY}|extinction`, INDIVIDUALS);
  const c1: ExtinctionIndividual[] = [];
  for (const [i, draw] of drawsC1.entries()) {
    const site: SiteName = i % 2 ? "west" : "east";
    for (const meals of TRAINING_MEALS) {
      const runs = {} as ExtinctionIndividual["runs"];
      for (const mind of YARD_MINDS) runs[mind] = extinctionRun(site, draw, meals, mind);
      c1.push({ draw, site, meals, runs });
      log(
        `C1 ${i + 1}/${INDIVIDUALS} ${site}, ${meals} meal${meals > 1 ? "s" : ""}: returns ${YARD_MINDS.map((m) => runs[m].returns).join(" ")}`,
      );
    }
  }
  const byMeals = (n: TrainingMeals) => c1.filter((r) => r.meals === n);
  const arms = Object.fromEntries(
    TRAINING_MEALS.map((n) => [
      n,
      Object.fromEntries(YARD_MINDS.map((m) => [m, summarizeExtinction(byMeals(n), m)])),
    ]),
  ) as Record<TrainingMeals, Record<YardMind, ExtinctionArm>>;
  const R = (x: ExtinctionRun) => x.returns;
  const within = (n: TrainingMeals, a: YardMind, b: YardMind) =>
    contrast(
      R,
      R,
      byMeals(n).map((r) => [r.runs[a], r.runs[b]]),
      `C1|${a}-${b}|${n}`,
    );
  const once = byMeals(1),
    thrice = byMeals(3);
  const history = (m: YardMind) =>
    contrast(
      R,
      R,
      thrice.map((r, i) => [r.runs[m], once[i]!.runs[m]]),
      `C1|history|${m}`,
    );
  // (MB after 3 − MB after 1) − (bookkeeping after 3 − bookkeeping after 1):
  // the meals' effect on hunger and timing is in both, the learning only in the first.
  const learned = thrice
    .map((r, i) => [r.runs, once[i]!.runs] as const)
    .filter(([a, b]) =>
      (["mushroom-body", "reduced-order"] as const).every(
        (m) => a[m].trainedS !== null && b[m].trainedS !== null,
      ),
    )
    .map(
      ([a, b]) =>
        a["mushroom-body"].returns -
        b["mushroom-body"].returns -
        (a["reduced-order"].returns - b["reduced-order"].returns),
    );

  const drawsC2 = seedDomain(`${INDIVIDUALITY_VERSION}|relocation`, INDIVIDUALS);
  const c2 = drawsC2.map((draw, i) => {
    const r = relocationIndividual(draw);
    log(
      `C2 ${i + 1}/${INDIVIDUALS}: meals ${RELOCATION_MINDS.map((m) => r.runs[m].meals).join(" ")}, returns ${r.runs["reduced-order"].returns}, fruitless ${RELOCATION_MINDS.map((m) => r.runs[m].fruitless).join(" ")}`,
    );
    return r;
  });
  const mealsDiff = c2.map(
    (r) => r.runs["mushroom-body"].meals - r.runs["reduced-order"].meals,
  );

  return {
    schema: MUSHROOM_BODY_REPORT,
    study: MUSHROOM_BODY_STUDY,
    fly: FLY_VERSION,
    genesis: GENESIS,
    circuit: {
      learningRate: MUSHROOM_BODY_PARAMS.learningRate.value,
      mealReward: MUSHROOM_BODY_PARAMS.mealReward.value,
      approachThreshold: MUSHROOM_BODY_PARAMS.approachThreshold.value,
    },
    c1: {
      individuals: INDIVIDUALS,
      trainingMeals: TRAINING_MEALS,
      trainingCapS: TRAINING_CAP_S,
      extinctionS: EXTINCTION_S,
      arms,
      contrasts: {
        mushroomBodyMinusBookkeeping: {
          1: within(1, "mushroom-body", "reduced-order"),
          3: within(3, "mushroom-body", "reduced-order"),
        },
        blockedMinusMushroomBody: {
          1: within(1, "mushroom-body, omission blocked", "mushroom-body"),
          3: within(3, "mushroom-body, omission blocked", "mushroom-body"),
        },
        threeMinusOneMeal: Object.fromEntries(
          YARD_MINDS.map((m) => [m, history(m)]),
        ) as Record<YardMind, ReturnType<typeof history>>,
        learnedFromHistory: {
          returns: summary(learned, "C1|learned"),
          sign: signTest(learned),
        },
      },
      individualsDetail: c1,
    },
    c2: {
      individuals: INDIVIDUALS,
      epochs: EPOCHS,
      identical: c2.filter((r) => r.identical).length,
      arms: Object.fromEntries(
        RELOCATION_MINDS.map((m) => [m, summarizeRelocation(c2, m)]),
      ) as Record<
        (typeof RELOCATION_MINDS)[number],
        ReturnType<typeof summarizeRelocation>
      >,
      mushroomBodyMinusBookkeeping: {
        mealsPerLife: summary(mealsDiff, "C2|meals-diff"),
        sign: signTest(mealsDiff),
      },
      individualsDetail: c2,
    },
  };
}

export type MushroomBodyReport = ReturnType<typeof mushroomBodyReport>;

// ---------------------------------------------------------------- the README

const num = (x: number | null | undefined) => (typeof x === "number" ? String(x) : "—");
const ci = (s: Summary) =>
  s.ci95 ? `${num(s.mean)} [${s.ci95[0]}, ${s.ci95[1]}]` : `${num(s.mean)} (n = ${s.n})`;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 1000) / 10}%`);
const sign = (s: { up: number; down: number; p: number | null }) =>
  `more in ${s.up}, fewer in ${s.down}; p = ${num(s.p)}`;

const MIND_TEXT: Record<YardMind, string> = {
  "reduced-order": "bookkeeping (two fruitless returns)",
  "mushroom-body": "mushroom body",
  "mushroom-body, omission blocked": "mushroom body, omission blocked",
  "one fruitless return": "bookkeeping (one fruitless return)",
};

export function renderMushroomBodyReadme(r: MushroomBodyReport, commit: string): string {
  const C1 = r.c1,
    C2 = r.c2,
    K = C1.contrasts;
  const lines: string[] = [
    "# Digital-fly mushroom body: seeded report",
    "",
    `Generated by \`node scripts/run-ts.mjs scripts/mushroom-body-evaluate.ts\` from ${commit}; \`--check\` reproduces it byte for byte. Never edit this folder by hand. The design and what it can and cannot show are in [docs/INDIVIDUAL_CONTINUITY.md](../../INDIVIDUAL_CONTINUITY.md#study-c-learning-from-omission-the-mushroom-body).`,
    "",
    `${r.study}, ${r.fly}, the mushroom-body controller (η = ${r.circuit.learningRate}, meal reinforcement ${r.circuit.mealReward}, approach threshold ${r.circuit.approachThreshold}) against the reduced-order controller it changes. Every fly has one genesis: seed ${r.genesis.seed}, placed at the yard's centre, ${r.genesis.startReserve} of a full reserve. Seeded study of one deterministic simulator, designed after a pilot: not a registered R.A.I.N. experiment, and its intervals (95% bootstrap over individuals) say nothing about a population of flies. The circuit is a rate model; nothing here is evidence of experience or awareness.`,
    "",
    "## C1. Extinction: the food taken away",
    "",
    `${C1.individuals} individuals, fed at one site (east or west, alternating); the food is taken away as the fly begins its first meal there, or its third, and the fly lives on for ${C1.extinctionS / 60} min in the empty yard. Each life lived by four controllers on the same events.`,
    "",
    ...C1.trainingMeals.flatMap((n) => [
      `### Food taken away at meal ${n}`,
      "",
      "| controller | trained | return flights | registered fruitless | last return flight (s) | arrivals at the site | place still draws the fly | circuit's prediction |",
      "| ---------- | ------- | -------------- | -------------------- | ---------------------- | -------------------- | ------------------------- | -------------------- |",
      ...YARD_MINDS.map((m) => {
        const a = C1.arms[n][m];
        return `| ${MIND_TEXT[m]} | ${a.trained} | ${ci(a.returns)} | ${ci(a.fruitless)} | ${ci(a.lastReturnS)} | ${ci(a.arrivals)} | ${pct(a.stillDrawn)} | ${a.value.n ? ci(a.value) : "—"} |`;
      }),
      "",
    ]),
    "### Contrasts in return flights (paired by individual)",
    "",
    `- Mushroom body minus bookkeeping, food taken at meal 1: ${ci(K.mushroomBodyMinusBookkeeping[1].returns)} (${sign(K.mushroomBodyMinusBookkeeping[1].sign)}); at meal 3: ${ci(K.mushroomBodyMinusBookkeeping[3].returns)} (${sign(K.mushroomBodyMinusBookkeeping[3].sign)}).`,
    `- Omission blocked minus mushroom body, at meal 1: ${ci(K.blockedMinusMushroomBody[1].returns)} (${sign(K.blockedMinusMushroomBody[1].sign)}); at meal 3: ${ci(K.blockedMinusMushroomBody[3].returns)} (${sign(K.blockedMinusMushroomBody[3].sign)}).`,
    `- Three meals minus one, per controller: ${YARD_MINDS.map((m) => `${MIND_TEXT[m]} ${ci(K.threeMinusOneMeal[m].returns)} (${sign(K.threeMinusOneMeal[m].sign)})`).join("; ")}.`,
    `- What the mushroom body learned from the meals beyond what the meals changed anyway, (MB at 3 − MB at 1) − (bookkeeping at 3 − bookkeeping at 1): ${ci(K.learnedFromHistory.returns)} (${sign(K.learnedFromHistory.sign)}).`,
    "",
    "## C2. Relocation: Study B's lives",
    "",
    `Study B's ${C2.individuals} lives (food moved ${C2.epochs} times among the four sites), lived by the bookkeeping and the mushroom-body controllers. Lives identical under both, epoch for epoch: ${C2.identical} of ${C2.individuals}.`,
    "",
    "| measure (per life) | bookkeeping | mushroom body |",
    "| ------------------ | ----------- | ------------- |",
    `| meals | ${ci(C2.arms["reduced-order"].meals)} | ${ci(C2.arms["mushroom-body"].meals)} |`,
    `| epochs without a meal (of ${C2.epochs}) | ${ci(C2.arms["reduced-order"].epochsWithoutMeal)} | ${ci(C2.arms["mushroom-body"].epochsWithoutMeal)} |`,
    `| return flights | ${ci(C2.arms["reduced-order"].returns)} | ${ci(C2.arms["mushroom-body"].returns)} |`,
    `| return flights given up in food odour | ${ci(C2.arms["reduced-order"].inOdour)} | ${ci(C2.arms["mushroom-body"].inOdour)} |`,
    `| registered fruitless returns | ${ci(C2.arms["reduced-order"].fruitless)} | ${ci(C2.arms["mushroom-body"].fruitless)} |`,
    "",
    `Mushroom body minus bookkeeping, meals per life: ${ci(C2.mushroomBodyMinusBookkeeping.mealsPerLife)} (${sign(C2.mushroomBodyMinusBookkeeping.sign)}).`,
    "",
    "Every individual and every run are in `report.json`.",
    "",
  ];
  return lines.join("\n");
}
