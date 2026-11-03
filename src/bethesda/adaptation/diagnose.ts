/**
 * Development diagnosis: where a Study B life's meals go, and which part of
 * the fly's navigation memory moves them. Used on development individuals only,
 * to choose one improvement; never on the held-out split, which is spent by
 * being looked at.
 *
 * - **Selective lesions.** The full lesion (`eraseMemory`) erases remembered
 *   places, visited cells, failed sites, blocked headings, the goal and the
 *   search together. Erasing one part every tick, and keeping the rest, says
 *   which part costs or earns the meals the full lesion moves.
 * - **Return flights.** Long flights the controller aims at a remembered food
 *   place, as Study C counts them: launched, given up where food could be
 *   smelled, and aimed at a place the food had already left.
 */
import { AT_SITE_M, relocationLife } from "../life/individuality.js";
import type { NavigationState } from "../fly/navigation.js";
import { EPOCHS, type Split } from "./benchmarks.js";
import { genesisOf, liveEpochs, type EpochRow } from "./study.js";
import { ResearchLife, type Release } from "./yard.js";

export const LESIONS = {
  none: () => {},
  places: (n: NavigationState) => {
    n.places = [];
  },
  "places and goal": (n: NavigationState) => {
    n.places = [];
    if (n.goal?.kind === "return") n.goal = null;
  },
  visited: (n: NavigationState) => {
    n.visited = [];
  },
  "failed and blocked": (n: NavigationState) => {
    n.failed = [];
    n.blocked = [];
  },
  search: (n: NavigationState) => {
    n.search = null;
  },
} as const;
export type Lesion = keyof typeof LESIONS;

export interface Diagnosis {
  k: number;
  lesion: Lesion;
  meals: number;
  epochs: EpochRow[];
  returns: { launched: number; givenUpInOdour: number; aimedStale: number };
  /** Seconds in each of the body's modes over the life. */
  modeS: Record<string, number>;
  /** Share of ticks in which food could be smelled where the fly was. */
  odourShare: number;
}

/** One development life, with one part of memory erased every tick. */
export function diagnose(
  split: Split,
  k: number,
  release: Release,
  lesion: Lesion,
): Diagnosis {
  const g = genesisOf(split);
  const reloc = relocationLife(EPOCHS, split.relocation[k]!);
  const life = new ResearchLife(structuredClone(g), release);
  const erase = LESIONS[lesion];
  let launched = 0,
    givenUpInOdour = 0,
    aimedStale = 0,
    since: number | null = null,
    odourTicks = 0,
    ticks = 0;
  const modeS: Record<string, number> = {};
  // Step through liveEpochs' own loop by wrapping step: count after each tick.
  const step = life.step.bind(life);
  life.step = (n: number) => {
    for (let i = 0; i < n; i++) {
      step(1);
      erase(life.nav);
      const s = life.fly.state;
      ticks++;
      modeS[s.mode] = (modeS[s.mode] ?? 0) + 0.1;
      const smell = life.world.odour(s.p) >= life.fly.params.odourDetect;
      if (smell) odourTicks++;
      const goal = life.nav.goal;
      const now = goal?.kind === "return" ? goal.since : null;
      if (since !== null && now !== since && smell) givenUpInOdour++;
      if (now !== null && now !== since) {
        launched++;
        const food = life.world.food;
        // The goal is in the fly's own estimate, which seeing a site's pole keeps near the truth.
        if (
          food &&
          Math.hypot(goal!.at[0] - food.at[0], goal!.at[1] - food.at[1]) > AT_SITE_M
        )
          aimedStale++;
      }
      since = now;
    }
  };
  const epochs = liveEpochs(life, reloc.epochs, reloc.journal, 0);
  for (const m of Object.keys(modeS)) modeS[m] = Math.round(modeS[m]! * 10) / 10;
  return {
    k,
    lesion,
    meals: epochs.reduce((a, e) => a + e.meals, 0),
    epochs,
    returns: { launched, givenUpInOdour, aimedStale },
    modeS,
    odourShare: Math.round((odourTicks / ticks) * 1000) / 1000,
  };
}
