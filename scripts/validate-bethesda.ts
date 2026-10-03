import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import source from "../src/bethesda/data/source.json" with { type: "json" };
import raw from "../src/bethesda/data/osm.json" with { type: "json" };
import terrain from "../src/bethesda/data/terrain.json" with { type: "json" };
import terrainSource from "../src/bethesda/data/terrain-source.json" with { type: "json" };
import streetscape from "../src/bethesda/data/streetscape.json" with { type: "json" };
import streetscapeSource from "../src/bethesda/data/streetscape-source.json" with { type: "json" };
import demoSource from "../src/bethesda/rain/fixtures/demo-source.json" with { type: "json" };
import demoMeeting from "../src/bethesda/rain/fixtures/demo-meeting.json" with { type: "json" };
import demoProposal from "../src/bethesda/rain/fixtures/demo-proposal.json" with { type: "json" };
import { validateMeeting } from "../src/bethesda/rain/validation.ts";
import { validateExperiment } from "../src/bethesda/rain/experiments.ts";
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
  if (f.geometry.type === "Polygon") {
    for (const ring of f.geometry.coordinates as number[][][]) {
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
        fail("unclosed polygon ring");
    }
  }
  counts.set(f.properties.kind, (counts.get(f.properties.kind) ?? 0) + 1);
  if (!/^\d+$/.test(f.properties.osmId)) fail("source object id missing");
}
for (const [kind, n] of Object.entries(source.counts))
  if (counts.get(kind) !== n) fail("feature count differs: " + kind);
const terrainBytes = readFileSync(
  new URL("../src/bethesda/data/terrain.json", import.meta.url),
);
if (
  createHash("sha256").update(terrainBytes).digest("hex") !== terrainSource.snapshotSha256
)
  fail("terrain checksum differs from acquisition manifest");
if (
  terrain.width !== 65 ||
  terrain.height !== 65 ||
  terrain.elevations.length !== 4225 ||
  terrain.elevations.some((v) => !Number.isFinite(v) || v < 80 || v > 120) ||
  terrain.bbox.some((v, i) => v !== raw.bbox[i]) ||
  !terrainSource.licenseText.includes("You can copy, modify, distribute")
)
  fail("invalid terrain, crop bounds or redistribution terms");
const streetscapeBytes = readFileSync(
  new URL("../src/bethesda/data/streetscape.json", import.meta.url),
);
if (
  createHash("sha256").update(streetscapeBytes).digest("hex") !==
  streetscapeSource.snapshotSha256
)
  fail("streetscape checksum differs from acquisition manifest");
if (
  streetscape.license !== "ODbL-1.0" ||
  streetscapeSource.license !== streetscape.license ||
  streetscape.bbox.some((v, i) => v !== raw.bbox[i])
)
  fail("streetscape license or bounds differ");
let streetscapeFeatures = 0;
for (const [key, n] of Object.entries(streetscapeSource.counts)) {
  const group = (streetscape as unknown as Record<string, unknown[]>)[key];
  if (!Array.isArray(group) || group.length !== n)
    fail("streetscape count differs: " + key);
  for (const item of group as Record<string, unknown>[]) {
    if (typeof item.osmId !== "string" || !/^\d+$/.test(item.osmId))
      fail("streetscape source id missing");
    // Contact and identity fields must never be copied into the derivative.
    for (const k of Object.keys(item))
      if (/phone|email|website|opening_hours|user|uid|contact/.test(k))
        fail("streetscape copies a disallowed field: " + k);
    for (const c of ["point", "coordinates"]) if (c in item) coordinates(item[c]);
    streetscapeFeatures++;
  }
}
const snapshotVersions = new Map(
  raw.features.map((f) => [f.properties.osmId, f.properties.version] as const),
);
for (const a of streetscape.buildingAttributes)
  if (snapshotVersions.get(a.osmId) !== a.version)
    fail("building attribute joined across OSM versions: " + a.osmId);
// The R.A.I.N. Lab's DEMO recording: byte-identical to its manifest, a valid
// scripted meeting from a named, clean james_library commit, and a fixture
// proposal that passes the host's ordinary validation.
const demoBytes = readFileSync(
  new URL("../src/bethesda/rain/fixtures/demo-meeting.json", import.meta.url),
);
if (createHash("sha256").update(demoBytes).digest("hex") !== demoSource.snapshotSha256)
  fail(
    "R.A.I.N. demo recording differs from its manifest; re-record it, never hand-edit it",
  );
const recorded = validateMeeting(demoMeeting);
if (!recorded.ok)
  fail("R.A.I.N. demo recording is invalid: " + recorded.errors.join("; "));
if (
  !/^[0-9a-f]{40}$/.test(demoSource.rain.commit ?? "") ||
  demoSource.rain.dirty !== false ||
  demoMeeting.rain.commit !== demoSource.rain.commit ||
  demoMeeting.meeting_id !== demoSource.meetingId ||
  demoMeeting.generation !== "scripted" ||
  demoMeeting.model !== null ||
  Number.isNaN(Date.parse(demoSource.recordedAt))
)
  fail("R.A.I.N. demo recording and manifest disagree, or the recording claims a model");
const demoExperiment = validateExperiment(demoProposal);
if (
  !demoExperiment.ok ||
  demoProposal.origin !== "fixture" ||
  demoProposal.rain_decision !== null
)
  fail("R.A.I.N. demo proposal must be a valid fixture that claims no R.A.I.N. decision");
console.log(
  `[validate:bethesda] ${raw.features.length} real OSM features, ${streetscapeFeatures} streetscape features and 4225 real DTM samples; bounds, license and checksums verified; R.A.I.N. demo recording ${demoSource.meetingId} at james_library ${demoSource.rain.commit.slice(0, 12)} verified`,
);
