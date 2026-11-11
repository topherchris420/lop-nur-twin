/**
 * Claim 3: the collision repair's research flies.
 *
 * Records: one JSONL per fly in docs/benchmarks/echo-collision/2026-11-03/flies/,
 * a `period` line every three simulated hours (meals, seconds inside a solid)
 * and an `entry` line when a body first passed into a building.
 */
import type { Binding } from "../check.js";
import { REGISTER, README } from "../documents.js";
import { listFiles, num, readJsonl, str } from "../records.js";
import { mean, signTest, sum } from "../stats.js";
import { fixed, grouped, says, signed } from "../statement.js";

const FLIES = "docs/benchmarks/echo-collision/2026-11-03/flies";
const COLLISION = "docs/ECHO_COLLISION.md";

interface Life {
  seed: number;
  meals: number;
  insideS: number;
  /** Meals in each simulated day. */
  byDay: number[];
  /** When and where it first passed into a building; null if it never did. */
  entry: { hour: number; building: string } | null;
  /** The hour of the period that held its last meal. */
  lastMealBy: number;
}

function lives(arm: "control" | "repaired", from: number, to: number): Life[] {
  const out: Life[] = [];
  for (const path of listFiles(FLIES, new RegExp(`^${arm}-\\d+\\.jsonl$`))) {
    const lines = readJsonl(path);
    const seed = num(lines[0], "seed");
    if (seed < from || seed > to) continue;
    const periods = lines.filter((l) => str(l, "kind") === "period");
    const entries = lines.filter((l) => str(l, "kind") === "entry");
    const byDay: number[] = [];
    for (const p of periods) {
      const day = Math.ceil(num(p, "h") / 24) - 1;
      byDay[day] = (byDay[day] ?? 0) + num(p, "meals");
    }
    const fed = periods.filter((p) => num(p, "meals") > 0);
    out.push({
      seed,
      meals: sum(periods.map((p) => num(p, "meals"))),
      insideS: sum(periods.map((p) => num(p, "insideS"))),
      byDay,
      entry:
        entries.length > 0
          ? { hour: num(entries[0], "h"), building: str(entries[0], "in") }
          : null,
      lastMealBy: fed.length > 0 ? num(fed.at(-1), "h") : 0,
    });
  }
  if (out.length !== to - from + 1)
    throw new Error(`expected ${to - from + 1} ${arm} flies, found ${out.length}`);
  return out.sort((a, b) => a.seed - b.seed);
}

const old = () => lives("control", 301, 312);
const repaired = () => lives("repaired", 301, 312);
const trapped = (flies: Life[]) => flies.filter((f) => f.entry !== null).length;
const meals = (flies: Life[]) => flies.map((f) => f.meals);

/** Old against repaired, seed by seed. */
function paired() {
  const before = old();
  const after = repaired();
  const pairs = before.map((b, i) => ({
    seed: b.seed,
    old: b,
    diff: after[i]!.meals - b.meals,
  }));
  const ties = pairs.filter((p) => p.diff === 0);
  return {
    pairs,
    test: signTest(pairs.map((p) => p.diff)),
    untouched: ties.filter((p) => p.old.entry === null),
    late: ties.filter((p) => p.old.entry !== null),
  };
}

export const collision: Binding[] = [
  {
    id: "3.seeds",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const seeds = old().map((f) => f.seed);
      return says`on the same new seeds (${seeds[0]!}–${seeds.at(-1)!})`;
    },
  },
  {
    id: "3.trapped",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const [a, b] = [old(), repaired()];
      const further = [lives("repaired", 181, 192), lives("repaired", 201, 212)];
      if (further.some((set) => trapped(set) !== 0))
        throw new Error("a further seed set holds a trapped fly");
      return says`Trapped: ${trapped(a)} of ${a.length} on the old physics, ${trapped(b)} of ${b.length} on the new (and ${trapped(further[0]!)} of ${further[0]!.length} on each of two further seed sets)`;
    },
  },
  {
    id: "3.meals",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const [a, b] = [meals(old()), meals(repaired())];
      return says`Mean meals in 96 h: ${fixed(mean(a), 1)} → ${fixed(mean(b), 1)}; fewest ${Math.min(...a)} → ${Math.min(...b)}`;
    },
  },
  {
    id: "3.paired",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const { pairs, test } = paired();
      if (test.negative !== 0)
        throw new Error("a fly ate fewer meals on the repaired physics");
      return says`The paired difference is ${signed(mean(pairs.map((p) => p.diff)), 1)} meals; more in ${test.positive} seeds, equal in ${test.ties}, fewer in none (exact two-sided sign test on the ${test.positive + test.negative} untied seeds, p = ${fixed(test.pTwoSided, 3)})`;
    },
  },
  {
    id: "3.ties",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const { test, untouched, late } = paired();
      // A tie that met the defect did so after the period of its last meal.
      for (const p of late)
        if (p.old.entry!.hour < p.old.lastMealBy - 3)
          throw new Error(`seed ${p.seed} was trapped before its last meal`);
      const reached = late.map((p) => [p.seed, Math.floor(p.old.entry!.hour)] as const);
      if (untouched.length !== 3 || reached.length !== 2)
        throw new Error("the ties are no longer three untouched flies and two late ones");
      return says`The ${test.ties} ties are the ${untouched.length} flies the defect never reached (${untouched[0]!.seed}, ${untouched[1]!.seed}, ${untouched[2]!.seed}) and the ${reached.length} it reached only after their last meal (${reached[0]![0]} at ${reached[0]![1]} h, ${reached[1]![0]} at ${reached[1]![1]} h)`;
    },
  },
  {
    id: "3.hungry-days",
    doc: REGISTER,
    section: "3",
    statement: () => {
      const all = [
        repaired(),
        lives("repaired", 181, 192),
        lives("repaired", 201, 212),
      ].flat();
      const days = all.flatMap((f) => f.byDay);
      return says`${days.filter((m) => m === 0).length} of ${days.length} fly-days held no meal`;
    },
  },
  {
    id: "3.summary",
    doc: REGISTER,
    section: "summary",
    statement: () => {
      const [a, b] = [old(), repaired()];
      return says`${trapped(a)} of ${a.length} trapped → ${trapped(b)} of ${b.length}`;
    },
  },
  {
    id: "readme.03.collision",
    doc: README,
    section: "03",
    statement: () => {
      const [a, b] = [old(), repaired()];
      return says`In a ${a.length}-seed comparison, **${trapped(a)} of ${a.length}** subjects were trapped under the old physics and **${trapped(b)} of ${b.length}** under`;
    },
  },
  {
    id: "readme.04.collision",
    doc: README,
    section: "04",
    statement: () => {
      const [a, b] = [old(), repaired()];
      return says`| Collision correction | ${trapped(a)} / ${a.length} subjects trapped before; ${trapped(b)} / ${b.length} after |`;
    },
  },
  // The study's own page: its table row by row, and the sentences under it.
  ...(
    [
      ["old", "`digital-fly/8`", "control", 301, 312],
      ["repaired", "`digital-fly/9`", "repaired", 301, 312],
      ["repaired-181", "`digital-fly/9`", "repaired", 181, 192],
      ["repaired-201", "`digital-fly/9`", "repaired", 201, 212],
    ] as const
  ).map(([name, physics, arm, from, to]): Binding => ({
    id: `collision.table.${name}`,
    doc: COLLISION,
    statement: () => {
      const flies = lives(arm, from, to);
      const m = meals(flies);
      return says`| ${physics} | ${from}–${to} | ${trapped(flies)} of ${flies.length} | ${grouped(sum(flies.map((f) => f.insideS)))} | ${fixed(mean(m), 1)} | ${Math.min(...m)} |`;
    },
  })),
  {
    id: "collision.buildings",
    doc: COLLISION,
    statement: () => {
      const buildings = new Set(
        old().flatMap((f) => (f.entry ? [f.entry.building] : [])),
      );
      const words = [
        "No",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
      ];
      return says`**${words[buildings.size]!} buildings trapped the old flies,**`;
    },
  },
  {
    id: "collision.hungry-days",
    doc: COLLISION,
    statement: () => {
      const all = [
        repaired(),
        lives("repaired", 181, 192),
        lives("repaired", 201, 212),
      ].flat();
      const days = all.flatMap((f) => f.byDay);
      return says`${days.filter((m) => m === 0).length} of the ${days.length} repaired fly-days held no meal`;
    },
  },
];
