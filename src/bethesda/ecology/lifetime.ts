/**
 * Long lives in the ecology (R.A.I.N. Genesis Stages D and E): a research fly
 * in the deployed configuration, alone in its own copy of a spun-up yard, for
 * days, with a summary of each day.
 *
 * - **Stage D, does what it learns help?** An intact fly against the same fly
 *   with its place memory lesioned: after every tick the navigator's
 *   remembered food places are cleared, so it can never fly back to food it
 *   found (its mushroom body still learns from each meal; nothing it learns
 *   can be used to return). Every other part of the fly is unchanged.
 * - **Stage E, does it become someone in particular?** Intact flies of
 *   different seeds in identical yards: whether each keeps a way of living
 *   from day to day (where it feeds, how much it flies, where it spends its
 *   time) that differs from the others' more than its own days differ.
 *
 * The body is the deployed configuration's, whose artificial maintenance keeps
 * it from dying, as Eva's and ECHO's do; the energy that maintenance supplies
 * is metered apart from food, so a fly that forages worse needs more of it.
 */
import type { Ecosystem, EcosystemSpec } from "./ecosystem.js";
import { cloneEcosystem, EcologicalLife, TICK_S, type FlyGenesis } from "./life.js";

export const LIFETIME_SCHEMA = "ecology-lifetime/v1";
export type LifetimeArm = "intact" | "no-place-memory";

/** The yard divided into `GRID` × `GRID` cells, for where a fly spends its time. */
export const GRID = 4;

export interface DaySummary {
  day: number;
  fed_j: number;
  feed_s: number;
  maintenance_j: number;
  flight_s: number;
  walk_s: number;
  rest_s: number;
  distance_m: number;
  /** Food places remembered at the day's end. */
  places: number;
  mb_trials: number;
  /** Share of the day's feeding seconds on each kind of food. */
  feed_share: { flower: number; fruit: number };
  /** Share of the day's feeding seconds at each tree's fruit or each flower (by id). */
  feed_by_site: Record<string, number>;
  /** Share of the day spent in each cell of the yard (row-major, x then z). */
  occupancy: number[];
  /** Hours of the day the fly was most active (flight + walk), a 24-vector of seconds. */
  active_by_hour: number[];
}

const r6 = (x: number) => Number(x.toPrecision(6));

/** The fly's food places forgotten: the lesion of Stage D. */
function forgetFoodPlaces(life: EcologicalLife): void {
  const nav = life.organism!.inner.state.nav;
  if (nav.places.some((p) => p.kind === "food"))
    nav.places = nav.places.filter((p) => p.kind !== "food");
}

/**
 * A fly's life of `days` days in a copy of `world`, a summary per day. Each
 * second the fly's mode and place are sampled.
 */
export function runLifetime(
  spec: EcosystemSpec,
  world: Ecosystem,
  genesis: FlyGenesis,
  arm: LifetimeArm,
  days: number,
  onDay: (d: DaySummary, life: EcologicalLife) => void = () => {},
): { days: DaySummary[]; life: EcologicalLife } {
  const life = new EcologicalLife(
    spec,
    genesis,
    { kind: "deployed" },
    cloneEcosystem(world),
  );
  const fly = life.fly!;
  const half = spec.half;
  const out: DaySummary[] = [];
  const perSecond = Math.round(1 / TICK_S);
  for (let day = 0; day < days; day++) {
    const start = {
      fedJ: fly.state.counts.fedJ,
      feedS: fly.state.counts.feedS,
      maint: life.maintenanceJ,
      trials: life.organism!.circuit.state.trials,
    };
    let flight = 0,
      walk = 0,
      rest = 0,
      dist = 0;
    const occ = new Array<number>(GRID * GRID).fill(0);
    const byHour = new Array<number>(24).fill(0);
    const feedBy: Record<string, number> = {};
    let feedFlower = 0,
      feedFruit = 0;
    let last: [number, number, number] = [fly.state.p[0], fly.state.p[1], fly.state.p[2]];
    for (let s = 0; s < 86_400; s++) {
      life.step(perSecond);
      if (arm === "no-place-memory") forgetFoodPlaces(life);
      const st = fly.state;
      const m = st.mode;
      if (m === "flight" || m === "takeoff" || m === "land" || m === "escape") flight++;
      else if (m === "walk") walk++;
      else rest++;
      const p = st.p;
      dist += Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]);
      last = [p[0], p[1], p[2]];
      const cx = Math.min(
        GRID - 1,
        Math.max(0, Math.floor(((p[0] + half) / (2 * half)) * GRID)),
      );
      const cz = Math.min(
        GRID - 1,
        Math.max(0, Math.floor(((p[2] + half) / (2 * half)) * GRID)),
      );
      occ[cx * GRID + cz]!++;
      if (m === "flight" || m === "walk" || m === "takeoff" || m === "land")
        byHour[Math.floor(life.eco.weather.hour) % 24]!++;
      if (m === "feed") {
        const item = life.world.foodAt([p[0], 0, p[2]]);
        if (item) {
          const site = item.kind === "fruit" ? siteOfFruit(life, item.id) : item.id;
          feedBy[site] = (feedBy[site] ?? 0) + 1;
          if (item.kind === "fruit") feedFruit++;
          else feedFlower++;
        }
      }
    }
    const feedTotal = feedFlower + feedFruit;
    const summary: DaySummary = {
      day,
      fed_j: r6(fly.state.counts.fedJ - start.fedJ),
      feed_s: r6(fly.state.counts.feedS - start.feedS),
      maintenance_j: r6(life.maintenanceJ - start.maint),
      flight_s: flight,
      walk_s: walk,
      rest_s: rest,
      distance_m: r6(dist),
      places: life.organism!.inner.state.nav.places.filter((p) => p.kind === "food")
        .length,
      mb_trials: life.organism!.circuit.state.trials - start.trials,
      feed_share: {
        flower: r6(feedTotal ? feedFlower / feedTotal : 0),
        fruit: r6(feedTotal ? feedFruit / feedTotal : 0),
      },
      feed_by_site: Object.fromEntries(
        Object.entries(feedBy)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, r6(v / Math.max(1, feedTotal))]),
      ),
      occupancy: occ.map((c) => r6(c / 86_400)),
      active_by_hour: byHour,
    };
    out.push(summary);
    onDay(summary, life);
  }
  return { days: out, life };
}

/** A fruit is counted at the tree it fell from (fruit ids name their tree). */
function siteOfFruit(life: EcologicalLife, id: string): string {
  const fruit = life.eco.item(id) as { tree?: string } | undefined;
  return fruit?.tree ?? "fruit (gone)";
}
