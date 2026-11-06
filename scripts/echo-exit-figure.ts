/**
 * A plan view of the deployed fly leaving building 1011267786 on 2026-11-04,
 * drawn from what was recorded and nothing else (docs/ECHO_COLLISION.md).
 *
 *   node scripts/run-ts.mjs scripts/echo-exit-figure.ts          write docs/media/echo-collision/exit.svg
 *   node scripts/run-ts.mjs scripts/echo-exit-figure.ts --check  exit 1 unless it reproduces byte for byte
 *
 * Inputs, all committed:
 *
 * - the service's journal (one status line a simulated minute) and the witness
 *   samples (about every 5 s) read on the VM that day, in
 *   docs/benchmarks/echo-collision/2026-11-04/live/;
 * - the building rings from `src/bethesda/model.ts`, the same rings the fly's
 *   world turns into the solids it collides with (`fly/bethesdaWorld.ts`);
 * - the exit itself, which those files do not hold: the `body-left-solid`
 *   record in checkpoint 2563, as the cutover record quotes it (`EXIT`).
 *
 * Positions are the simulation's, in the city's local frame (metres, +x east,
 * +z south, so north is up). Straight segments join successive samples; they
 * are not the path flown between them, and no line crosses a stretch the
 * journal does not cover. Nothing here reads a store, a checkpoint or the VM.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { buildings, type Building } from "../src/bethesda/model.js";

/** The recorded journal and witness of the cutover day, relative to the repository root. */
export const EXIT_RECORDS = "docs/benchmarks/echo-collision/2026-11-04/live";
/** The figure, relative to the repository root. */
export const EXIT_FIGURE = "docs/media/echo-collision/exit.svg";

/** The `body-left-solid` record (checkpoint 2563), as docs/ECHO_COLLISION.md quotes it. */
export const EXIT = { tick: 7_664_060, x: 476.336, z: 642.026 } as const;
const BUILDING_ID = "1011267786";
/** Up to here the close-up runs: checkpoint 2569, the cutover record's "after" column. */
const CLOSE_UP_UNTIL = "2026-11-04T12:16";
/** A longer silence than this (ticks; 10 simulated minutes) breaks a line. */
const BREAK_TICKS = 6_000;

export interface Sample {
  utc: string;
  tick: number;
  x: number;
  z: number;
  mode: string;
  meals: number;
}

function journal(live: string, name: string): Sample[] {
  const text = gunzipSync(readFileSync(join(live, name))).toString("utf8");
  const out: Sample[] = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(': {"schema":"bethesda-headless-life/');
    if (at < 0) continue;
    const o = JSON.parse(line.slice(at + 2)) as {
      tick: number;
      fly: { position: [number, number, number]; mode: string; meals: number };
    };
    const [x, , z] = o.fly.position;
    out.push({
      utc: line.slice(0, 19) + "Z",
      tick: o.tick,
      x,
      z,
      mode: o.fly.mode,
      meals: o.fly.meals,
    });
  }
  return out;
}

function witness(live: string): Sample[] {
  const text = gunzipSync(readFileSync(join(live, "witness.jsonl.gz"))).toString("utf8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [utc, , tick, p, mode, , meals] = JSON.parse(l) as [
        string,
        string,
        number,
        [number, number, number],
        string,
        number,
        number,
      ];
      return { utc, tick, x: p[0], z: p[2], mode, meals };
    });
}

const byTick = (a: Sample, b: Sample) => a.tick - b.tick;

/** The day's samples: one a simulated minute from the journals, and the witness's. */
export function exitRecords(root = process.cwd()): {
  minutes: Sample[];
  fives: Sample[];
} {
  const live = join(root, EXIT_RECORDS);
  const minutes = [
    ...new Map(
      ["journal.txt.gz", "journal-2.txt.gz", "journal-3.txt.gz"]
        .flatMap((name) => journal(live, name))
        .map((s) => [s.tick, s] as const),
    ).values(),
  ].sort(byTick);
  return { minutes, fives: witness(live).sort(byTick) };
}

// ---- drawing -------------------------------------------------------------

const SIZE = 440;
const INK = "#1f2933";
const MUTED = "#52606d";
const BEFORE = "#b45309";
const AFTER = "#0b6e99";
const n1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** 7664060 → "7,664,060", without the runtime's locale data. */
const thousands = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const hhmm = (utc: string) => utc.slice(11, 16);

interface Frame {
  x0: number;
  z0: number;
  scale: number;
}
/** A square frame around `pts`, with `margin` metres on every side. */
function frame(pts: readonly { x: number; z: number }[], margin: number): Frame {
  const xs = pts.map((p) => p.x),
    zs = pts.map((p) => p.z);
  const [x0, x1, z0, z1] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...zs),
    Math.max(...zs),
  ];
  const span = Math.max(x1 - x0, z1 - z0) + 2 * margin;
  return {
    x0: (x0 + x1) / 2 - span / 2,
    z0: (z0 + z1) / 2 - span / 2,
    scale: SIZE / span,
  };
}
const px = (f: Frame, x: number) => n1((x - f.x0) * f.scale);
const pz = (f: Frame, z: number) => n1((z - f.z0) * f.scale);

function ring(
  f: Frame,
  b: Building,
  fill: string,
  stroke: string,
  width: number,
): string {
  const d = [b.ring, ...b.holes]
    .map((r) => "M" + r.map((p) => `${px(f, p.x)} ${pz(f, p.z)}`).join("L") + "Z")
    .join("");
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" fill-rule="evenodd"/>`;
}

function near(f: Frame): Building[] {
  const span = SIZE / f.scale;
  return buildings.filter((b) =>
    b.ring.some(
      (p) => p.x >= f.x0 && p.x <= f.x0 + span && p.z >= f.z0 && p.z <= f.z0 + span,
    ),
  );
}

/** Lines through consecutive samples, broken wherever the record is silent. */
function lines(f: Frame, pts: readonly Sample[], stroke: string, width: number): string {
  const runs: Sample[][] = [];
  for (const s of pts) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && s.tick - last.tick <= BREAK_TICKS) run.push(s);
    else runs.push([s]);
  }
  return runs
    .filter((r) => r.length > 1)
    .map(
      (r) =>
        `<polyline points="${r.map((s) => `${px(f, s.x)},${pz(f, s.z)}`).join(" ")}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`,
    )
    .join("");
}

const dot = (f: Frame, s: { x: number; z: number }, fill: string, r: number) =>
  `<circle cx="${px(f, s.x)}" cy="${pz(f, s.z)}" r="${r}" fill="${fill}"/>`;
const square = (f: Frame, s: { x: number; z: number }, fill: string, r: number) =>
  `<rect x="${n1(Number(px(f, s.x)) - r)}" y="${n1(Number(pz(f, s.z)) - r)}" width="${2 * r}" height="${2 * r}" fill="${fill}"/>`;

function scaleBar(f: Frame, metres: number): string {
  const w = n1(metres * f.scale);
  const y = SIZE - 14;
  return (
    `<g fill="${INK}" font-size="11"><rect x="12" y="${y}" width="${w}" height="3"/>` +
    `<text x="12" y="${y - 5}">${metres} m</text></g>`
  );
}
const north = `<g fill="${INK}" font-size="11" text-anchor="middle"><path d="M${SIZE - 18} 14l5 12h-10z"/><text x="${SIZE - 18}" y="40">N</text></g>`;

function panel(
  title: string,
  f: Frame,
  body: string,
  bar: number,
  ox: number,
  id: string,
): string {
  return (
    `<g transform="translate(${ox},64)">` +
    `<text x="0" y="-12" font-size="15" font-weight="600" fill="${INK}">${esc(title)}</text>` +
    `<clipPath id="${id}"><rect width="${SIZE}" height="${SIZE}"/></clipPath>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="#ffffff" stroke="#cbd2d9"/>` +
    `<g clip-path="url(#${id})">${body}</g>${scaleBar(f, bar)}${north}</g>`
  );
}

/** The figure as SVG text, drawn from the records under `root`. */
export function exitFigure(root = process.cwd()): {
  svg: string;
  closeUpSamples: number;
  daySamples: number;
  buildingsDrawn: number;
} {
  const { minutes, fives } = exitRecords(root);
  const building = buildings.find((b) => b.id === BUILDING_ID);
  if (!building) throw new Error(`building ${BUILDING_ID} is not in the model`);
  const firstMeal = minutes.find((s) => s.meals > 161);
  if (!firstMeal) throw new Error("the journal holds no meal after 161");

  // Panel A: the close-up, from the continuation to checkpoint 2569.
  const closeMinutes = minutes.filter((s) => s.utc < CLOSE_UP_UNTIL);
  const closeFives = fives.filter((s) => s.utc < CLOSE_UP_UNTIL);
  const fa = frame([...building.ring, ...closeMinutes, ...closeFives], 4);
  const before = (s: Sample) => s.tick < EXIT.tick;
  const a = [
    ...near(fa)
      .filter((b) => b.id !== BUILDING_ID)
      .map((b) => ring(fa, b, "#eef0f2", "#c3cad1", 1)),
    ring(fa, building, "#f3e3c3", "#8a6d3b", 1.6),
    lines(fa, closeMinutes.filter(before), BEFORE, 1.4),
    lines(
      fa,
      closeMinutes.filter((s) => !before(s)),
      AFTER,
      1.4,
    ),
    ...closeFives.filter(before).map((s) => dot(fa, s, BEFORE, 2.2)),
    ...closeFives.filter((s) => !before(s)).map((s) => square(fa, s, AFTER, 2.2)),
    `<circle cx="${px(fa, EXIT.x)}" cy="${pz(fa, EXIT.z)}" r="9" fill="none" stroke="${INK}" stroke-width="2"/>`,
    `<text x="${n1(Number(px(fa, EXIT.x)) + 13)}" y="${n1(Number(pz(fa, EXIT.z)) + 4)}" font-size="12" fill="${INK}">exit, tick ${thousands(EXIT.tick)}</text>`,
  ].join("");

  // Panel B: the whole recorded day, to the first meal.
  const day = minutes.filter((s) => s.tick <= firstMeal.tick);
  const fb = frame(day, 12);
  const b = [
    ...near(fb)
      .filter((x) => x.id !== BUILDING_ID)
      .map((x) => ring(fb, x, "#eef0f2", "#c3cad1", 0.6)),
    ring(fb, building, "#f3e3c3", "#8a6d3b", 1.2),
    lines(fb, day.filter(before), BEFORE, 1.2),
    lines(
      fb,
      day.filter((s) => !before(s)),
      AFTER,
      1.2,
    ),
    `<circle cx="${px(fb, firstMeal.x)}" cy="${pz(fb, firstMeal.z)}" r="8" fill="none" stroke="${INK}" stroke-width="2"/>`,
    `<text x="${n1(Number(px(fb, firstMeal.x)) + 12)}" y="${n1(Number(pz(fb, firstMeal.z)) + 4)}" font-size="12" fill="${INK}">first meal, ${hhmm(firstMeal.utc)} UTC</text>`,
    `<text x="${n1(Number(px(fb, building.center.x)) - 14)}" y="${n1(Number(pz(fb, building.center.z)) - 10)}" font-size="11" fill="${MUTED}" text-anchor="end">building ${BUILDING_ID}</text>`,
  ].join("");

  const silent = (() => {
    let gap = { from: "", to: "", ticks: 0 };
    for (let i = 1; i < day.length; i++) {
      const [p, q] = [day[i - 1]!, day[i]!];
      if (q.tick - p.tick > gap.ticks)
        gap = { from: p.utc, to: q.utc, ticks: q.tick - p.tick };
    }
    return gap;
  })();

  const W = 2 * SIZE + 72;
  const H = SIZE + 168;
  const legendY = SIZE + 92;
  const legend =
    `<g font-size="12" fill="${INK}" transform="translate(24,${legendY})">` +
    `<circle cx="6" cy="-4" r="4" fill="${BEFORE}"/><text x="16" y="0">inside the building, before the recorded exit</text>` +
    `<rect x="300" y="-8" width="8" height="8" fill="${AFTER}"/><text x="314" y="0">after the exit</text>` +
    `<rect x="430" y="-9" width="14" height="10" fill="#f3e3c3" stroke="#8a6d3b"/><text x="450" y="0">building ${BUILDING_ID} (the solid it was in)</text>` +
    `</g>`;
  const notes = [
    `Recorded positions of the deployed fly (simulated, city frame, north up). Lines join one sample a simulated minute (dots and squares: about every 5 s);`,
    `they are not the path flown. No positions were recorded from ${hhmm(silent.from)} to ${hhmm(silent.to)} UTC. Sources: docs/benchmarks/echo-collision/2026-11-04/live/,`,
    `src/bethesda/model.ts, and the exit record in checkpoint 2563 (docs/ECHO_COLLISION.md). Generated by scripts/echo-exit-figure.ts.`,
  ]
    .map(
      (t, i) =>
        `<text x="24" y="${legendY + 26 + i * 16}" font-size="11" fill="${MUTED}">${esc(t)}</text>`,
    )
    .join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">` +
    `<title id="title">ECHO leaves building ${BUILDING_ID}, 4 November 2026</title>` +
    `<desc id="desc">Two plan views drawn from the deployed fly's recorded positions. Left: inside the building after the physics repair, then the recorded exit at tick ${thousands(EXIT.tick)}. Right: the rest of the recorded day, to its first meal at ${hhmm(firstMeal.utc)} UTC.</desc>` +
    `<style>text{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}</style>` +
    `<rect width="${W}" height="${H}" fill="#f8f7f4"/>` +
    `<text x="24" y="30" font-size="18" font-weight="700" fill="${INK}">The repaired physics let ECHO out of building ${BUILDING_ID} · 4 November 2026</text>` +
    panel(
      `A · The exit, ${hhmm(closeMinutes[0]!.utc)}–${hhmm(closeMinutes[closeMinutes.length - 1]!.utc)} UTC`,
      fa,
      a,
      5,
      24,
      "clip-a",
    ) +
    panel(
      `B · The day, to the first meal at ${hhmm(firstMeal.utc)} UTC`,
      fb,
      b,
      50,
      SIZE + 48,
      "clip-b",
    ) +
    legend +
    notes +
    `</svg>\n`;
  return {
    svg,
    closeUpSamples: closeMinutes.length + closeFives.length,
    daySamples: day.length,
    buildingsDrawn: near(fb).length,
  };
}

// Run directly, or as `node scripts/run-ts.mjs scripts/echo-exit-figure.ts`, which puts it at argv[2].
const invoked = process.argv.slice(1, 3).some((a) => /echo-exit-figure\.ts$/.test(a));
if (invoked) {
  const out = join(process.cwd(), EXIT_FIGURE);
  const figure = exitFigure();
  if (process.argv.includes("--check")) {
    if (readFileSync(out, "utf8") !== figure.svg) {
      console.error(`[echo-exit-figure] ${EXIT_FIGURE} does not reproduce`);
      process.exit(1);
    }
    console.log(`[echo-exit-figure] ${EXIT_FIGURE} reproduces byte for byte`);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, figure.svg);
    console.log(
      `[echo-exit-figure] wrote ${EXIT_FIGURE}: ${figure.closeUpSamples} close-up samples, ${figure.daySamples} day samples, ${figure.buildingsDrawn} buildings`,
    );
  }
}
