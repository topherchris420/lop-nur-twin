/**
 * One research subject's life under the bench: a fresh fly, born from a seed in
 * the individuality yard, with one controller and one condition, stepped
 * exactly as the plasticity study steps its flies (`plasticity/study.ts`
 * `StudyLife`: maintenance into the reserve, then the body spends), and watched
 * by an instrument that only reads.
 *
 * The instrument knows the cause (the experimenter's perturbation schedule and
 * where the food is); the fly never does. Every reading here goes through public
 * state, draws nothing and writes nothing, so a watched life steps exactly as an
 * unwatched one (`life.test.ts` compares it with `StudyLife` byte for byte).
 *
 * Never an original: the subject id is `research-eimb-…` and passes
 * `refuseOriginal`; nothing here opens a store, a checkpoint or a network.
 */
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { mulberry32 } from "../../lib/noise.js";
import { DigitalFly } from "../fly/fly.js";
import {
  PERTURBATION_SCHEMA,
  perturbationAt,
  type Perturbation,
} from "../fly/perturbation.js";
import { DT } from "../simulation.js";
import {
  FoodYard,
  SITE_NAMES,
  SITES,
  TICK_S,
  type SiteName,
} from "../life/individuality.js";
import type { OrganismAdapter } from "../life/organism.js";
import { PlasticityOrganismAdapter } from "../life/plasticOrganism.js";
import { refuseOriginal } from "../firstContact/originals.js";
import { CONTROLLERS, type ControllerId } from "./controllers.js";
import type { ConditionSpec } from "./protocol.js";

/** Food positions between the compass sites, 6.5 m out: away from every pole. */
const DIAGONAL_R = 6.5;
export function foodAt(
  site: SiteName,
  layout: ConditionSpec["food"]["layout"],
): [number, number] {
  const [x, z] = SITES[site];
  if (layout === "compass") return [x, z];
  const c = Math.SQRT1_2;
  const r = DIAGONAL_R / Math.hypot(x, z);
  return [(x * c - z * c) * r, (x * c + z * c) * r];
}

/** The site the food is at, at a tick: a fixed rotation from the seed's site, as the plasticity study's. */
export function siteAt(
  seed: number,
  food: ConditionSpec["food"],
  tick: number,
): SiteName {
  const first = seed % SITE_NAMES.length;
  const moves = food.kind === "steady" ? 0 : Math.floor((tick * TICK_S) / food.everyS);
  return SITE_NAMES[(first + moves) % SITE_NAMES.length]!;
}

export function perturbationOf(condition: ConditionSpec): Perturbation | undefined {
  return condition.episodes.length
    ? { schema: PERTURBATION_SCHEMA, episodes: condition.episodes.map((e) => ({ ...e })) }
    : undefined;
}

/** When the condition's first episode begins and, if every episode ends, when the last ends. */
export function onsetOf(condition: ConditionSpec): {
  onsetS: number | null;
  untilS: number | null;
} {
  if (!condition.episodes.length) return { onsetS: null, untilS: null };
  const onsetS = Math.min(...condition.episodes.map((e) => e.from));
  const ends = condition.episodes.map((e) => e.until);
  const untilS = ends.every((u): u is number => u !== null) ? Math.max(...ends) : null;
  return { onsetS, untilS };
}

/** Which belief of ECHO's self-model the condition makes wrong, and its index in `belief.x`. */
export function beliefTargetOf(condition: ConditionSpec): {
  name: "leg speed gain" | "leg turning bias";
  index: number;
  field: "speedGain" | "turnBias";
  tolerance: number;
} | null {
  if (condition.episodes.some((e) => e.speedGain !== undefined && e.speedGain !== 1))
    return { name: "leg speed gain", index: 0, field: "speedGain", tolerance: 0.1 };
  if (condition.episodes.some((e) => e.turnBias !== undefined && e.turnBias !== 0))
    return { name: "leg turning bias", index: 2, field: "turnBias", tolerance: 0.2 };
  return null;
}

export interface Block {
  t: number;
  meals: number;
  fedJ: number;
  spentJ: number;
  walkedM: number;
  flownM: number;
  collisions: number;
  adaptations: number;
  /** Whether the plasticity would act now (either context); null without one. */
  cautious: boolean | null;
  /** ECHO's belief about the perturbed quantity (or its leg speed gain), and the truth then. */
  belief: number | null;
  truth: number;
  /** Mean horizontal distance to the food over the block's samples (m); null with no food. */
  foodDistanceM: number | null;
}

interface Tally {
  foodSite: SiteName;
  movedAtTick: number;
  mealsAtMove: number;
  latencies: number[];
  censored: number;
  /** Per placement: its window (s) and the time to its first meal, or null if never. */
  placements: { windowS: number; latencyS: number | null }[];
  walkingBlocks: number;
  wasBlocked: boolean;
  walkingTicks: number;
  fedAtLate: number | null;
  firstMealAfterOnsetS: number | null;
  mealsAtOnset: number | null;
  distanceSum: number;
  distanceN: number;
  blockDistanceSum: number;
  blockDistanceN: number;
  cautiousBeforeOnset: boolean;
  detectionS: number | null;
  releaseS: number | null;
  noticedAtOnset: number | null;
  convergedS: number | null;
}

export interface LifeSpec {
  seed: number;
  condition: ConditionSpec;
  controller: ControllerId;
  subject: string;
  durationS: number;
  blockS: number;
  sampleEveryTicks: number;
  lateFromS: number;
}

export class MetrologyLife {
  readonly spec: LifeSpec;
  readonly world: FoodYard;
  readonly fly: DigitalFly;
  readonly tally: Tally;
  readonly blocks: Block[] = [];
  readonly startYaw: number;
  readonly placements: { tick: number; site: SiteName; at: [number, number] }[] = [];
  readonly onsetS: number | null;
  readonly untilS: number | null;
  private readonly target: ReturnType<typeof beliefTargetOf>;
  private readonly perturbation: Perturbation | undefined;
  tick = 0;

  constructor(spec: LifeSpec) {
    refuseOriginal(spec.subject, "metrology subject");
    if (!spec.subject.startsWith("research-"))
      throw new Error(`a research subject's id starts with research-: ${spec.subject}`);
    this.spec = spec;
    const { condition } = spec;
    this.world = new FoodYard();
    // The plasticity study's start: the same stream, the same draw.
    const random = mulberry32(spec.seed ^ 0x5eed);
    this.startYaw = random() * 2 * Math.PI;
    this.perturbation = perturbationOf(condition);
    const build = CONTROLLERS[spec.controller].build;
    this.fly = new DigitalFly({
      seed: spec.seed,
      world: this.world,
      start: { p: [0, 0.0011, 0], yaw: this.startYaw },
      config: { startReserve: condition.startReserve },
      adapter: (rng, streams) => build(rng, streams, spec.seed),
      ...(this.perturbation ? { perturbation: this.perturbation } : {}),
    });
    ({ onsetS: this.onsetS, untilS: this.untilS } = onsetOf(condition));
    this.target = beliefTargetOf(condition);
    const site = siteAt(spec.seed, condition.food, 0);
    this.placeFood(site);
    this.tally = {
      foodSite: site,
      movedAtTick: 0,
      mealsAtMove: 0,
      latencies: [],
      censored: 0,
      placements: [],
      walkingBlocks: 0,
      wasBlocked: false,
      walkingTicks: 0,
      fedAtLate: null,
      firstMealAfterOnsetS: null,
      mealsAtOnset: null,
      distanceSum: 0,
      distanceN: 0,
      blockDistanceSum: 0,
      blockDistanceN: 0,
      cautiousBeforeOnset: false,
      detectionS: null,
      releaseS: null,
      noticedAtOnset: null,
      convergedS: null,
    };
  }

  get organism(): OrganismAdapter {
    return this.fly.adapter as OrganismAdapter;
  }

  get plasticity(): PlasticityOrganismAdapter["plasticity"] | null {
    const a = this.organism;
    return a instanceof PlasticityOrganismAdapter ? a.plasticity : null;
  }

  private placeFood(site: SiteName): void {
    const at = foodAt(site, this.spec.condition.food.layout);
    this.world.place({ site, at });
    this.placements.push({ tick: this.tick, site, at });
  }

  /** The experimenter's truth for the perturbed belief at fly time t. */
  truthAt(t: number): number {
    const field = this.target?.field ?? "speedGain";
    const active = this.perturbation ? perturbationAt(this.perturbation, t) : null;
    return active ? active[field] : field === "speedGain" ? 1 : 0;
  }

  belief(): number | null {
    const m = this.organism.model;
    return m ? m.state.belief.x[this.target?.index ?? 0]! : null;
  }

  private cautious(): boolean | null {
    const p = this.plasticity;
    if (!p) return null;
    return p.verdict("normal").cautious || p.verdict("low").cautious;
  }

  /** As `StudyLife.step`, then the instrument reads. */
  step(ticks: number): void {
    const a = this.organism,
      fly = this.fly,
      t = this.tally,
      spec = this.spec;
    const blockTicks = Math.round(spec.blockS / TICK_S);
    const lateTick = Math.round(spec.lateFromS / TICK_S);
    for (let i = 0; i < ticks; i++) {
      const site = siteAt(spec.seed, spec.condition.food, this.tick);
      if (site !== t.foodSite) {
        if (fly.state.counts.meals === t.mealsAtMove) t.censored++;
        t.placements.push({
          windowS: (this.tick - t.movedAtTick) * TICK_S,
          latencyS:
            fly.state.counts.meals > t.mealsAtMove ? t.latencies.at(-1)! * TICK_S : null,
        });
        t.foodSite = site;
        t.movedAtTick = this.tick;
        t.mealsAtMove = fly.state.counts.meals;
        this.placeFood(site);
      }
      const capacity = fly.params.reserveJ;
      const supplied = a.physiology.advance(DT, {
        mode: fly.state.mode,
        reserve: Math.min(fly.state.reserve, capacity),
        capacity,
      });
      if (supplied > 0)
        fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      const meals = fly.state.counts.meals;
      fly.advance(TICK_S);
      this.tick++;
      const s = fly.state;
      if (meals === t.mealsAtMove && s.counts.meals > meals)
        t.latencies.push(this.tick - t.movedAtTick);
      const blocked = s.mode === "walk" && s.edge;
      if (blocked && !t.wasBlocked) t.walkingBlocks++;
      t.wasBlocked = blocked;
      if (s.mode === "walk") t.walkingTicks++;
      // The instrument's readings: none of them changes the fly.
      const now = this.tick * TICK_S;
      if (this.tick === lateTick) t.fedAtLate = s.counts.fedJ;
      if (this.onsetS !== null) {
        if (t.mealsAtOnset === null && now >= this.onsetS) {
          t.mealsAtOnset = s.counts.meals;
          const m = a.model;
          t.noticedAtOnset = m ? m.state.counts.inquiries : 0;
        } else if (
          t.mealsAtOnset !== null &&
          t.firstMealAfterOnsetS === null &&
          s.counts.meals > t.mealsAtOnset
        )
          t.firstMealAfterOnsetS = now - this.onsetS;
      }
      if (this.tick % spec.sampleEveryTicks === 0) this.sample(now);
      if (this.tick % blockTicks === 0) this.closeBlock(now);
    }
  }

  private sample(now: number): void {
    const t = this.tally;
    const p = this.fly.state.p;
    const food = this.world.food;
    if (food) {
      const d = Math.hypot(p[0] - food.at[0], p[2] - food.at[1]);
      t.distanceSum += d;
      t.distanceN++;
      t.blockDistanceSum += d;
      t.blockDistanceN++;
    }
    const cautious = this.cautious();
    if (cautious !== null) {
      if (this.onsetS === null || now < this.onsetS) {
        if (cautious) t.cautiousBeforeOnset = true;
      } else if (cautious && t.detectionS === null) t.detectionS = now - this.onsetS;
      if (
        this.untilS !== null &&
        now >= this.untilS &&
        t.detectionS !== null &&
        !cautious &&
        t.releaseS === null
      )
        t.releaseS = now - this.untilS;
    }
    if (
      this.target &&
      this.onsetS !== null &&
      now >= this.onsetS &&
      t.convergedS === null
    ) {
      const b = this.belief();
      if (b !== null && Math.abs(b - this.truthAt(now)) <= this.target.tolerance)
        t.convergedS = now - this.onsetS;
    }
  }

  private closeBlock(now: number): void {
    const c = this.fly.state.counts,
      t = this.tally;
    const p = this.plasticity;
    this.blocks.push({
      t: now,
      meals: c.meals,
      fedJ: c.fedJ,
      spentJ: c.spentJ,
      walkedM: c.walkedM,
      flownM: c.flownM,
      collisions: c.collisions,
      adaptations: p ? p.state.adaptations : 0,
      cautious: this.cautious(),
      belief: this.belief(),
      truth: this.truthAt(now),
      foodDistanceM: t.blockDistanceN ? t.blockDistanceSum / t.blockDistanceN : null,
    });
    t.blockDistanceSum = 0;
    t.blockDistanceN = 0;
  }

  /** The body and the controller with any plasticity removed, hashed: equal across controllers exactly when behaviour was. */
  bodyHash(): string {
    const state = JSON.parse(JSON.stringify(this.organism.state)) as Record<
      string,
      unknown
    >;
    delete state.plasticity;
    return sha256(
      canonicalJson({
        body: this.fly.state,
        controller: state,
        food: this.world.food,
        latencies: this.tally.latencies,
        censored: this.tally.censored,
        walkingBlocks: this.tally.walkingBlocks,
      }),
    );
  }

  /** What the environment was, whatever the fly did: equal for every controller of a unit (paired fairness). */
  environmentDigest(): string {
    return sha256(
      canonicalJson({
        seed: this.spec.seed,
        startYaw: this.startYaw,
        startReserve: this.spec.condition.startReserve,
        episodes: this.spec.condition.episodes,
        placements: this.placements,
      }),
    );
  }
}
