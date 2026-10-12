#!/usr/bin/env node
/**
 * Derives Noeterra's map geography from Natural Earth (public domain).
 *
 *   node noeterra/scripts/import-geography.mjs            # download, derive, write
 *   node noeterra/scripts/import-geography.mjs --from DIR # derive from files already in DIR
 *
 * Writes noeterra/data/geography-<region>.json and geography.source.json with
 * the real retrieval time, byte count and SHA-256 of every source file. The
 * output is display data only: it shapes the map and never enters the
 * simulation or its hashes. Never edit the outputs by hand; re-run this.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "data");
const BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const FILES = {
  land: "ne_50m_land.geojson",
  lakes: "ne_50m_lakes.geojson",
  rivers: "ne_50m_rivers_lake_centerlines.geojson",
};
// Regions are generous rectangles around each scenario, in degrees.
const REGIONS = {
  mediterranean: { bbox: [-18, 18, 56, 52] },
  tarim: { bbox: [52, 22, 124, 58] },
};
const TOLERANCE = 0.04; // Douglas-Peucker, degrees
const MIN_AREA = 0.03; // drop smaller rings, square degrees

const args = process.argv.slice(2);
const fromDir = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;

async function fetchSource(name) {
  if (fromDir) {
    const bytes = readFileSync(join(fromDir, name));
    return { bytes, url: `${BASE}${name}`, retrieved_at: null };
  }
  const url = `${BASE}${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, url, retrieved_at: new Date().toISOString() };
}

const round = (x) => Math.round(x * 1000) / 1000;

function clipRing(ring, [x0, y0, x1, y1]) {
  // Sutherland–Hodgman against the four edges of the rectangle.
  const edges = [
    (p) => p[0] >= x0,
    (p) => p[0] <= x1,
    (p) => p[1] >= y0,
    (p) => p[1] <= y1,
  ];
  const cut = [
    (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])],
    (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0],
    (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1],
  ];
  let out = ring;
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[(i + input.length - 1) % input.length],
        b = input[i];
      const ia = edges[e](a),
        ib = edges[e](b);
      if (ib) {
        if (!ia) out.push(cut[e](a, b));
        out.push(b);
      } else if (ia) out.push(cut[e](a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = points[s],
      [bx, by] = points[e];
    const dx = bx - ax,
      dy = by - ay,
      len = Math.hypot(dx, dy) || 1e-12;
    let best = -1,
      far = 0;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len;
      if (d > far) [far, best] = [d, i];
    }
    if (far > tol && best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// A closed ring starts and ends at one point, which would make every point lie
// "on" the chord; split it at the point farthest from the start instead.
function simplifyRing(ring, tol) {
  const [sx, sy] = ring[0];
  let far = 0;
  ring.forEach(([x, y], i) => {
    if (Math.hypot(x - sx, y - sy) > Math.hypot(ring[far][0] - sx, ring[far][1] - sy))
      far = i;
  });
  if (far === 0) return ring;
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

const area = (r) =>
  Math.abs(
    r.reduce((s, p, i) => {
      const q = r[(i + 1) % r.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;

function rings(geojson) {
  const out = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys =
      g.type === "Polygon"
        ? [g.coordinates]
        : g.type === "MultiPolygon"
          ? g.coordinates
          : [];
    for (const poly of polys) out.push(poly[0]); // outer rings; lakes are drawn on top
  }
  return out;
}

function lines(geojson) {
  const out = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const ls =
      g.type === "LineString"
        ? [g.coordinates]
        : g.type === "MultiLineString"
          ? g.coordinates
          : [];
    for (const l of ls)
      out.push({
        name: f.properties?.name ?? null,
        rank: f.properties?.scalerank ?? null,
        line: l,
      });
  }
  return out;
}

function clipLine(line, [x0, y0, x1, y1]) {
  // Keep runs of points inside the rectangle; good enough for display rivers.
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const runs = [];
  let cur = [];
  for (const p of line) {
    if (inside(p)) cur.push(p);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length >= 2);
}

const sources = {};
const data = {};
for (const [key, name] of Object.entries(FILES)) {
  const s = await fetchSource(name);
  sources[key] = {
    url: s.url,
    retrieved_at: s.retrieved_at,
    bytes: s.bytes.length,
    sha256: createHash("sha256").update(s.bytes).digest("hex"),
  };
  data[key] = JSON.parse(s.bytes.toString("utf8"));
}
mkdirSync(OUT, { recursive: true });
const summary = {};
for (const [region, { bbox }] of Object.entries(REGIONS)) {
  const poly = (list) =>
    list
      .map((r) => clipRing(r, bbox))
      .filter((r) => r.length >= 3 && area(r) >= MIN_AREA)
      .map((r) => simplifyRing(r, TOLERANCE).map(([x, y]) => [round(x), round(y)]))
      .filter((r) => r.length >= 3);
  const land = poly(rings(data.land));
  const lakes = poly(rings(data.lakes));
  const rivers = lines(data.rivers)
    .filter((l) => l.rank === null || l.rank <= 7)
    .flatMap((l) =>
      clipLine(l.line, bbox).map((run) => ({
        name: l.name,
        line: simplify(run, TOLERANCE).map(([x, y]) => [round(x), round(y)]),
      })),
    )
    .filter((r) => r.line.length >= 2);
  const out = { schema: "noeterra-geography/v1", region, bbox, land, lakes, rivers };
  writeFileSync(join(OUT, `geography-${region}.json`), JSON.stringify(out) + "\n");
  summary[region] = {
    land_rings: land.length,
    lakes: lakes.length,
    rivers: rivers.length,
  };
}
const manifest = {
  schema: "noeterra-geography-source/v1",
  publisher:
    "Natural Earth (naturalearthdata.com), via github.com/nvkelso/natural-earth-vector",
  license:
    "Public domain. Natural Earth: 'All versions of Natural Earth raster + vector map data found on this website are in the public domain.'",
  files: sources,
  derivation: {
    generator: "noeterra/scripts/import-geography.mjs",
    regions: REGIONS,
    simplify_tolerance_deg: TOLERANCE,
    min_ring_area_sq_deg: MIN_AREA,
    river_max_scalerank: 7,
    coordinate_decimals: 3,
  },
  outputs: summary,
  use: "Display only: map shapes. Never an input to the simulation or its state hashes.",
};
writeFileSync(
  join(OUT, "geography.source.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify(summary));
