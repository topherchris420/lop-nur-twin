import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import source from "../src/bethesda/data/source.json" with { type: "json" };
import raw from "../src/bethesda/data/osm.json" with { type: "json" };
const fail = (s: string): never => {
  throw new Error("Bethesda data: " + s);
};
const bytes = readFileSync(new URL("../src/bethesda/data/osm.json", import.meta.url));
if (createHash("sha256").update(bytes).digest("hex") !== source.snapshotSha256)
  fail("snapshot checksum differs from acquisition manifest");
if (raw.license !== "ODbL-1.0" || source.license !== raw.license) fail("missing license");
const counts = new Map<string, number>();
function coordinates(v: unknown): void {
  if (!Array.isArray(v) || !v.length) return fail("empty geometry");
  if (typeof v[0] === "number") {
    const [lon, lat] = v;
    if (
      !Number.isFinite(lon) ||
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      lon < raw.bbox[0]! ||
      lon > raw.bbox[2]! ||
      lat < raw.bbox[1]! ||
      lat > raw.bbox[3]!
    )
      fail("coordinate outside bounds");
  } else for (const p of v) coordinates(p);
}
for (const f of raw.features) {
  coordinates(f.geometry.coordinates);
  counts.set(f.properties.kind, (counts.get(f.properties.kind) ?? 0) + 1);
  if (!/^\d+$/.test(f.properties.osmId)) fail("source object id missing");
}
for (const [kind, n] of Object.entries(source.counts))
  if (counts.get(kind) !== n) fail("feature count differs: " + kind);
console.log(
  `[validate:bethesda] ${raw.features.length} real OSM features; bounds, license and checksum verified`,
);
