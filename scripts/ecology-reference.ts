/**
 * The research ecology's reference scenarios (docs/RAIN_GENESIS.md).
 *
 *   node scripts/run-ts.mjs scripts/ecology-reference.ts            # write docs/benchmarks/ecology/
 *   node scripts/run-ts.mjs scripts/ecology-reference.ts --check    # reproduce them byte for byte
 *   ... --long        also the 30-day research fly (about an hour and a half here)
 *   ... --scratch     write to .fly-ecology/ from a working tree, never a record
 *
 * 1. `alone-30d`: the reference yard (seed 42) for 30 days with no fly in it:
 *    its daily state hash, weather, fruit, nectar, soil water and odour, and
 *    whether its sugar, water and odour books close.
 * 2. `fly-1d`: the same yard for a day with one research fly in the deployed
 *    configuration, beside the same yard without it: what the fly took and
 *    left, that the ecology replayed bare from the fly's recorded interactions
 *    is the one the fly lived in, and how its world differs from the fly-less
 *    one at the end of the day.
 * 3. `fly-30d` (`--long`): the same for 30 days, with the fly's own record.
 *
 * Every subject is `research-…`, built from a seed. Nothing reads or writes a
 * store, checkpoint, backup or individual; the script refuses a production host.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { FLY_VERSION } from "../src/bethesda/fly/fly.js";
import { Ecosystem, referenceYard } from "../src/bethesda/ecology/ecosystem.js";
import { EcologicalLife, replay } from "../src/bethesda/ecology/life.js";
import { ECOLOGY_PARAMS, ECOLOGY_VERSION } from "../src/bethesda/ecology/params.js";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const scratch = args.includes("--scratch");
const long = args.includes("--long");
const outDir = scratch ? ".fly-ecology" : "docs/benchmarks/ecology";
refuseProductionHost(resolve(root, outDir), existsSync);
const git = (c: string) => execSync(`git ${c}`, { cwd: root, encoding: "utf8" }).trim();
if (!scratch && !check && git("status --porcelain"))
  throw new Error(
    "a record is made only from a clean commit; commit first, or pass --scratch",
  );

const DAY = 86_400;
const SEED = 42;
const r9 = (x: number) => Number(x.toPrecision(9));

function closes(e: Ecosystem) {
  const s = e.sugar,
    o = e.odour.books,
    w = e.water;
  return {
    sugar_residual_mg: r9(
      s.produced - (e.sugarStock() + s.consumed + s.fermented + s.rotted),
    ),
    water_residual_mm: r9(w.rained - w.evaporated - w.drained - e.waterStock()),
    odour_residual_ug: r9(o.emitted + o.rounding - o.lost - o.out - e.odour.total()),
  };
}

function day(e: Ecosystem) {
  const w = e.weather;
  return {
    day: e.t / DAY,
    hash: e.stateHash(),
    weather_at_end: {
      hour: r9(w.hour),
      light: r9(w.light),
      tempC: r9(w.tempC),
      humidity: r9(w.humidity),
      wind_ms: r9(Math.hypot(w.wind[0], w.wind[2])),
      rain_mm_h: r9(w.rainMmH),
    },
    ...e.summary(),
    books_close: closes(e),
  };
}

const cost: Record<string, number> = {};
const timed = <T>(name: string, f: () => T): T => {
  const t0 = performance.now();
  const v = f();
  cost[name] = r9((performance.now() - t0) / 1000);
  return v;
};

function alone(days: number) {
  const e = new Ecosystem(referenceYard(SEED));
  const out = [];
  for (let d = 0; d < days; d++) {
    e.run(DAY);
    out.push(day(e));
    process.stderr.write(`alone day ${d + 1}/${days}\n`);
  }
  return out;
}

function withFly(days: number, label: string) {
  const spec = referenceYard(SEED);
  const subject = `research-ecology-${label}`;
  const life = new EcologicalLife(spec, {
    subject,
    seed: 7,
    start: [0, 0],
    yaw: 0,
    startReserve: 0.3,
  });
  const daily = [];
  const ticks = DAY * 10;
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) life.step(ticks / 24);
    const fly = life.fly!;
    daily.push({
      ...day(life.eco),
      fly: {
        mode: fly.state.mode,
        reserve: r9(fly.state.reserve),
        fed_J: r9(fly.state.counts.fedJ),
        feed_s: r9(fly.state.counts.feedS),
        spent_J: r9(fly.state.counts.spentJ),
        maintenance_J: r9(life.maintenanceJ),
        hash: fly.stateHash(),
      },
    });
    process.stderr.write(`${label} day ${d + 1}/${days}\n`);
  }
  const steps = life.eco.steps;
  const replayed = replay(spec, life.eco.interactions, steps);
  const bare = new Ecosystem(spec);
  bare.run(steps);
  const byItem: Record<string, { consumed_mg: number; inoculated_s: number }> = {};
  for (const i of life.eco.interactions) {
    const b = (byItem[i.item] ??= { consumed_mg: 0, inoculated_s: 0 });
    if (i.kind === "consume") b.consumed_mg += i.effect;
    else b.inoculated_s += i.amount;
  }
  const inoculated = Object.keys(byItem).filter((k) => byItem[k]!.inoculated_s > 0);
  const fruitDiff = inoculated.map((id) => {
    const a = life.eco.fruits.find((f) => f.id === id),
      b = bare.fruits.find((f) => f.id === id);
    return {
      fruit: id,
      with_fly: a ? { sugar_mg: r9(a.sugarMg), yeast: r9(a.yeast) } : "gone",
      without_fly: b ? { sugar_mg: r9(b.sugarMg), yeast: r9(b.yeast) } : "gone",
    };
  });
  return {
    subject,
    genesis: { seed: 7, start: [0, 0], yaw: 0, startReserve: 0.3 },
    daily,
    interactions: life.eco.interactions.length,
    by_item: Object.fromEntries(
      Object.entries(byItem)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [
          k,
          { consumed_mg: r9(v.consumed_mg), inoculated_s: r9(v.inoculated_s) },
        ]),
    ),
    replay_matches: replayed.stateHash() === life.eco.stateHash(),
    differs_from_flyless_world: bare.stateHash() !== life.eco.stateHash(),
    flyless_hash: bare.stateHash(),
    unbacked_mg: r9(life.eco.sugar.unbacked),
    inoculated_fruit: fruitDiff,
  };
}

function header() {
  return {
    schema: "ecology-reference/v1",
    ecology_version: ECOLOGY_VERSION,
    fly_version: FLY_VERSION,
    seed: SEED,
    params: Object.fromEntries(
      Object.entries(ECOLOGY_PARAMS).map(([k, v]) => [
        k,
        { value: v.value, unit: v.unit, kind: v.kind },
      ]),
    ),
    platform: `${platform()} ${arch()}`,
    node: process.version,
    subjects:
      "Research subjects built from seeds; none is Eva or ECHO, a copy or a continuation.",
  };
}

function write(name: string, value: unknown) {
  const path = join(root, outDir, name);
  const text = JSON.stringify(value, null, 2) + "\n";
  if (check) {
    const old = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    const same =
      old &&
      JSON.stringify({ ...old, commit: null }) ===
        JSON.stringify({ ...(value as object), commit: null });
    console.log(`${outDir}/${name} ${same ? "reproduces" : "does NOT reproduce"}`);
    if (!same) process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${outDir}/${name}`);
}

const commit = git("rev-parse HEAD");
write("alone-30d.json", {
  ...header(),
  commit,
  scenario: "alone-30d",
  days: timed("alone-30d", () => alone(30)),
});
write("fly-1d.json", {
  ...header(),
  commit,
  scenario: "fly-1d",
  ...timed("fly-1d", () => withFly(1, "1d")),
});
if (long)
  write("fly-30d.json", {
    ...header(),
    commit,
    scenario: "fly-30d",
    ...timed("fly-30d", () => withFly(30, "30d")),
  });
if (!check)
  writeFileSync(
    join(root, outDir, long ? "cost-long.json" : "cost.json"),
    JSON.stringify(
      {
        wall_s: cost,
        platform: `${platform()} ${arch()}`,
        cpu: cpus()[0]?.model ?? "unknown",
        node: process.version,
      },
      null,
      2,
    ) + "\n",
  );

// --- the README, from the records only ---------------------------------------------

function readme(): string {
  const read = (n: string) => {
    const p = join(root, outDir, n);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  };
  const a = read("alone-30d.json"),
    f1 = read("fly-1d.json"),
    f30 = read("fly-30d.json");
  const L: string[] = [];
  L.push("# Research ecology: reference scenarios");
  L.push("");
  L.push(
    "Generated by `node scripts/run-ts.mjs scripts/ecology-reference.ts` from the records in this folder; `--check` reproduces them on their platform. Never edit by hand. The model is described in [docs/RAIN_GENESIS.md](../../RAIN_GENESIS.md). Every fly is a research subject built from a seed; none is Eva or ECHO.",
  );
  L.push("");
  if (a) {
    const last = a.days[a.days.length - 1];
    const worst = (k: string) =>
      Math.max(
        ...a.days.map((d: { books_close: Record<string, number> }) =>
          Math.abs(d.books_close[k]!),
        ),
      );
    L.push(
      `## alone-30d: the yard with no fly (seed ${a.seed}, commit \`${String(a.commit).slice(0, 12)}\`, ${a.platform}, Node ${a.node})`,
    );
    L.push("");
    L.push(
      `After 30 days: ${Object.values(last.fallen as Record<string, number>).reduce((x, y) => x + y, 0)} fruits had fallen, ${last.gone} were gone and ${last.fruits} lay in the yard; ${last.sugar.produced.toFixed(0)} mg of sugar had been produced, ${last.sugar.fermented.toFixed(0)} mg fermented and ${last.sugar.rotted.toFixed(0)} mg rotted. Largest residual of any day's books: sugar ${worst("sugar_residual_mg").toExponential(1)} mg, water ${worst("water_residual_mm").toExponential(1)} mm, odour ${worst("odour_residual_ug").toExponential(1)} µg.`,
    );
    L.push("");
    L.push(
      "| Day | Fruit in the yard | Sugar held (mg) | Nectar (mg) | Soil water (mm) | Odour held (µg) | State hash |",
    );
    L.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const d of a.days)
      L.push(
        `| ${d.day} | ${d.fruits} | ${d.sugarStockMg.toFixed(0)} | ${d.nectarMg.toFixed(2)} | ${d.soilWaterMm.toFixed(2)} | ${d.odourUg.toFixed(1)} | \`${String(d.hash).slice(0, 12)}\` |`,
      );
    L.push("");
  }
  for (const f of [f1, f30]) {
    if (!f) continue;
    const last = f.daily[f.daily.length - 1];
    L.push(
      `## ${f.scenario}: one research fly in the same yard (commit \`${String(f.commit).slice(0, 12)}\`)`,
    );
    L.push("");
    L.push(
      `Subject \`${f.subject}\`, the deployed configuration (\`OrganismAdapter\`), placed at the centre with ${f.genesis.startReserve} of a full reserve. Over ${f.daily.length} day(s) its body took ${last.fly.fed_J.toFixed(3)} J from food in ${last.fly.feed_s.toFixed(0)} s of feeding (maintenance supplied ${last.fly.maintenance_J.toFixed(3)} J, kept apart), in ${f.interactions} recorded interactions; ${f.unbacked_mg.toExponential(2)} mg of what it took was unbacked.`,
    );
    L.push("");
    L.push(
      `- The ecology replayed bare from those records equals the fly's world: **${f.replay_matches ? "yes" : "no"}**.`,
    );
    L.push(
      `- The fly's world differs from the fly-less one: **${f.differs_from_flyless_world ? "yes" : "no"}**.`,
    );
    L.push("");
    L.push("| Item | Sugar taken (mg) | Feeding time on it (s, fruit) |");
    L.push("| --- | --- | --- |");
    for (const [id, v] of Object.entries(
      f.by_item as Record<string, { consumed_mg: number; inoculated_s: number }>,
    ))
      L.push(
        `| ${id} | ${v.consumed_mg.toExponential(3)} | ${v.inoculated_s ? v.inoculated_s.toFixed(0) : "—"} |`,
      );
    L.push("");
    if (f.inoculated_fruit.length) {
      L.push("Fruit it fed on, at the end, against the fly-less world:");
      L.push("");
      L.push("| Fruit | With the fly | Without |");
      L.push("| --- | --- | --- |");
      for (const d of f.inoculated_fruit) {
        const s = (x: unknown) =>
          typeof x === "string"
            ? x
            : `${(x as { sugar_mg: number }).sugar_mg.toFixed(1)} mg, yeast ${(x as { yeast: number }).yeast.toFixed(3)}`;
        L.push(`| ${d.fruit} | ${s(d.with_fly)} | ${s(d.without_fly)} |`);
      }
      L.push("");
    }
  }
  return L.join("\n") + "\n";
}

{
  const text = readme();
  const path = join(root, outDir, "README.md");
  if (check) {
    const same = existsSync(path) && readFileSync(path, "utf8") === text;
    console.log(
      `${outDir}/README.md ${same ? "follows from the records" : "does NOT follow from the records"}`,
    );
    if (!same) process.exitCode = 1;
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${outDir}/README.md`);
  }
}
