/** Prespecified seeded research protocol, not an independent or registered R.A.I.N. experiment.
 * No tuning after evaluation. Model-only behavior until physics readiness passes. */
import { mulberry32 } from "../../../lib/noise.js";
import { MushroomBodyController } from "../../fly/mushroomBody/controller.js";
import { SITES, SITE_NAMES, AT_SITE_M, type SiteName } from "../individuality.js";
import {
  IMMORTAL_RESEARCH_LIFE as KIND,
  researchGenesis,
  type ImmortalLife,
} from "./life.js";
import { proceduralChallenge } from "./challenges.js";

export const IMMORTAL_STUDY = "echo-lifelong-study/v1";
export const STUDY_ARMS = [
  "persistent",
  "memory-reset",
  "fixed-policy",
  "independent",
] as const;
export type StudyArm = (typeof STUDY_ARMS)[number];
export const STUDY_PLAN = {
  version: IMMORTAL_STUDY,
  developmentSeeds: [1201, 1202, 1203],
  heldOutSeeds: [8101, 8102, 8103, 8104],
  phaseSeconds: 180,
  phases: ["acquisition", "retention", "transfer", "reversal", "composition"],
  success: {
    adaptationLatencyReduction: 0.2,
    retentionNearSeconds: 10,
    minimumPairedMeals: 3,
  },
  limitations: [
    "not preregistered",
    "same-repository evaluation, not independent validation",
    "single scalar odour, no novel chemical identities",
    "reduced-order body; MuJoCo readiness not met",
    "fixed-policy arm retains heuristic navigation state but has no learned parameters",
    "finite challenges do not demonstrate open-ended learning",
  ],
} as const;

export interface PhaseResult {
  phase: (typeof STUDY_PLAN.phases)[number];
  food: SiteName | null;
  latencyS: number | null;
  meals: number;
  feedS: number;
  nearPreviousS: number;
  visitedCells: number;
  spentJ: number;
  trials: number;
  rejectedCommands: number;
  endpoint: [number, number];
}

export function studyGenesis(seed: number, arm: StudyArm) {
  const g = researchGenesis(arm === "independent" ? seed + 100000 : seed);
  g.flags = {
    immortality: true,
    associativeLearning: arm !== "fixed-policy",
    predictiveSelfModel: arm !== "fixed-policy",
  };
  const from = STUDY_PLAN.phaseSeconds * 4;
  g.perturbation = {
    schema: "fly-perturbation/v1",
    episodes: [
      {
        id: "composition-leg-disturbance",
        cause: "self",
        from,
        until: from + STUDY_PLAN.phaseSeconds,
        speedGain: 0.6,
      },
    ],
  };
  return g;
}

/** Lives on through every phase: no body replacement, picked-up probe, or synthetic reward. */
export function studyRun(
  life: ImmortalLife,
  seed: number,
  arm: StudyArm,
  onTick: (life: ImmortalLife) => void,
): PhaseResult[] {
  const u = mulberry32(seed ^ 0x6c696665);
  const start = Math.floor(u() * SITE_NAMES.length);
  const foodOrder = [
    SITE_NAMES[start]!,
    null,
    SITE_NAMES[(start + 1) % 4]!,
    SITE_NAMES[(start + 2) % 4]!,
    SITE_NAMES[start]!,
  ] as const;
  const out: PhaseResult[] = [];
  for (const [phaseIndex, phase] of STUDY_PLAN.phases.entries()) {
    const food = foodOrder[phaseIndex]!;
    if (arm === "memory-reset" && phaseIndex > 0)
      KIND.apply!(life, {
        tick: life.tick,
        kind: "memory-lesion",
        data: { control: "reset learned memory, retain body and RNG streams" },
      });
    KIND.apply!(life, {
      tick: life.tick,
      kind: "challenge",
      data: {
        challenge: proceduralChallenge(
          seed + phaseIndex,
          phaseIndex < 2 ? "development" : "held-out",
        ),
      },
    });
    KIND.apply!(life, {
      tick: life.tick,
      kind: "food",
      data: {
        food: food ? { site: food, at: [...SITES[food]] } : null,
      },
    });
    const before = { ...life.fly.state.counts };
    const began = life.tick;
    const visited = new Set<string>();
    let latencyS: number | null = null,
      nearPreviousS = 0;
    for (let tick = 0; tick < STUDY_PLAN.phaseSeconds * 10; tick++) {
      life.advanceTicks(1);
      const s = life.fly.state;
      visited.add(`${Math.floor(s.p[0])},${Math.floor(s.p[2])}`);
      if (
        food &&
        latencyS === null &&
        s.mode === "feed" &&
        Math.hypot(s.p[0] - SITES[food][0], s.p[2] - SITES[food][1]) < AT_SITE_M
      )
        latencyS = (life.tick - began) / 10;
      if (phaseIndex > 0) {
        const prev = foodOrder[phaseIndex - 1];
        if (
          prev &&
          Math.hypot(s.p[0] - SITES[prev][0], s.p[2] - SITES[prev][1]) < AT_SITE_M
        )
          nearPreviousS += 0.1;
      }
      onTick(life);
    }
    const a = life.adapter.inner,
      s = life.fly.state;
    out.push({
      phase,
      food,
      latencyS,
      meals: s.counts.meals - before.meals,
      feedS: s.counts.feedS - before.feedS,
      nearPreviousS: Math.round(nearPreviousS * 10) / 10,
      visitedCells: visited.size,
      spentJ: s.counts.spentJ - before.spentJ,
      trials: a instanceof MushroomBodyController ? a.circuit.state.trials : 0,
      rejectedCommands: s.counts.rejected - before.rejected,
      endpoint: [s.p[0], s.p[2]],
    });
  }
  return out;
}

export interface StudyRow {
  seed: number;
  arm: StudyArm;
  phases: PhaseResult[];
}
export function evaluateStudy(rows: readonly StudyRow[]) {
  const pairs = STUDY_PLAN.heldOutSeeds.flatMap((seed) => {
    const a = rows
      .find((r) => r.seed === seed && r.arm === "persistent")
      ?.phases.find((p) => p.phase === "transfer");
    const b = rows
      .find((r) => r.seed === seed && r.arm === "memory-reset")
      ?.phases.find((p) => p.phase === "transfer");
    return a?.latencyS != null && b?.latencyS != null
      ? [(b.latencyS - a.latencyS) / Math.max(0.1, b.latencyS)]
      : [];
  });
  const reduction = pairs.length ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;
  const adaptation =
    pairs.length < STUDY_PLAN.success.minimumPairedMeals
      ? "inconclusive"
      : reduction! >= STUDY_PLAN.success.adaptationLatencyReduction
        ? "criterion-met-in-model"
        : "criterion-not-met";
  const retained = rows
    .filter((r) => r.arm === "persistent")
    .map((r) => r.phases.find((p) => p.phase === "retention")!.nearPreviousS);
  return {
    adaptation: {
      status: adaptation,
      validPairs: pairs.length,
      meanLatencyReduction: reduction,
    },
    retention: {
      nearPreviousSeconds: retained,
      thresholdS: STUDY_PLAN.success.retentionNearSeconds,
      interpretation:
        "occupancy measure only; paired lesions needed to attribute it to memory",
    },
    openEndedLearning: "not demonstrated",
    biologicalValidation: "not established",
    skillComposition:
      "measured as performance on the joint composition phase; no acquisition claim",
    catastrophicForgetting:
      "not established: no isolated cue-retention assay in this embodied protocol",
    individualDivergence: rows
      .filter((r) => r.arm === "persistent")
      .map((r) => {
        const d = rows.find((x) => x.arm === "independent" && x.seed === r.seed);
        const a = r.phases.at(-1)!.endpoint,
          b = d?.phases.at(-1)?.endpoint;
        return {
          seed: r.seed,
          endpointDistanceM: b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : null,
        };
      }),
  };
}
