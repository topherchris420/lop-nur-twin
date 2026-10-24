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
import rainCorpus from "../src/rain/data/corpus.json" with { type: "json" };
import rainPerspectives from "../src/rain/data/perspectives.json" with { type: "json" };
import rainSource from "../src/rain/data/source.json" with { type: "json" };
import {
  corpusFingerprint,
  hashCorpusDocuments,
  isCorpusPath,
} from "../src/rain/corpus.ts";
import { OFFLINE_ENGINE, REPOSITORY } from "../src/rain/protocol.ts";
import mathIndex from "../src/rain/mathematics/data/openai-math.json" with { type: "json" };
import { indexErrors } from "../src/rain/mathematics/substrateIndex.ts";
import flybodySource from "../src/bethesda/fly/data/flybody.source.json" with { type: "json" };
import { parseSkeleton } from "../src/bethesda/fly/skeleton.ts";
import { decodePart, parseMeshFile } from "../src/bethesda/fly/meshCodec.ts";
import { parseVfbReference } from "../src/bethesda/fly/reference.ts";
import { REDUCED_ORDER_DESCRIPTOR } from "../src/bethesda/fly/controller.ts";
import { CIRCUIT_DESCRIPTOR } from "../src/bethesda/fly/circuits/controller.ts";
import { parseGroomingReference } from "../src/bethesda/fly/calibration/groomingReference.ts";
import {
  changedFlySources,
  computeFlySource,
  workingTreeReader,
} from "../src/rain/scientific/flySourceDigest.ts";
import { FLY_SOURCE } from "../src/rain/scientific/flySource.ts";
import { fileURLToPath } from "node:url";
const fail = (s: string): never => {
  throw new Error("Bethesda data: " + s);
};
// Every file hashed here is committed text, imported and hashed with LF line
// endings. A checkout that turned them into CRLF (Git for Windows' default
// without .gitattributes) has not changed what they say, so the hash is taken
// over the LF form: identical to the raw bytes for an LF file.
const readText = (url: URL): Buffer => {
  const buf = readFileSync(url);
  return buf.includes(13)
    ? Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"))
    : buf;
};
// The licence text sits in the first fenced block of LICENSE.md.
const FENCED = /```\r?\n([\s\S]*?)```/;
const bytes = readText(new URL("../src/bethesda/data/osm.json", import.meta.url));
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
const terrainBytes = readText(
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
const streetscapeBytes = readText(
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
// The R.A.I.N. research runtime's bundled data: every corpus file and SOUL file
// hashes to its import manifest, the two snapshots are byte-identical to the
// manifest, and the corpus fingerprint is the one the DEMO was recorded against.
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const rainDataUrl = (name: string) =>
  new URL(`../src/rain/data/${name}`, import.meta.url);
if (
  rainSource.schema !== "rain-source/v1" ||
  !/^[0-9a-f]{40}$/.test(rainSource.commit) ||
  Number.isNaN(Date.parse(rainSource.importedAt)) ||
  rainSource.license !== "MIT" ||
  rainCorpus.license !== "MIT" ||
  rainPerspectives.license !== "MIT"
)
  fail("R.A.I.N. source manifest is incomplete");
if (sha256(readText(rainDataUrl("corpus.json"))) !== rainSource.corpus.snapshotSha256)
  fail(
    "R.A.I.N. corpus snapshot differs from its import manifest; re-import it, never hand-edit it",
  );
if (
  sha256(readText(rainDataUrl("perspectives.json"))) !==
  rainSource.perspectives.snapshotSha256
)
  fail("R.A.I.N. perspectives snapshot differs from its import manifest");
const license = readText(rainDataUrl("LICENSE.md")).toString("utf8");
if (sha256(FENCED.exec(license)?.[1] ?? "") !== rainSource.licenseSha256)
  fail("R.A.I.N. license text differs from its import manifest");
if (rainCorpus.files.length !== rainSource.corpus.files)
  fail("R.A.I.N. corpus file count differs");
for (const file of rainCorpus.files)
  if (
    sha256(file.text) !== file.sha256 ||
    Buffer.byteLength(file.text, "utf8") !== file.bytes ||
    !isCorpusPath(file.path)
  )
    fail("R.A.I.N. corpus file differs from its hash or is not a paper: " + file.path);
const rainFingerprint = corpusFingerprint(hashCorpusDocuments(rainCorpus.files));
if (rainFingerprint !== rainSource.corpus.fingerprintSha256)
  fail("R.A.I.N. corpus fingerprint differs from its import manifest");
if (
  rainPerspectives.souls.map((s) => s.name).join() !== "James,Jasmine,Luca,Elena" ||
  rainPerspectives.souls.some((s) => sha256(s.text) !== s.sha256) ||
  JSON.stringify(rainSource.perspectives.files) !==
    JSON.stringify(
      rainPerspectives.souls.map((s) => ({
        name: s.name,
        file: s.file,
        sha256: s.sha256,
      })),
    )
)
  fail("R.A.I.N. SOUL files differ from their import manifest");
// The R.A.I.N. Lab's DEMO recording: byte-identical to its manifest, a valid
// scripted meeting from the runtime's offline engine at a named, clean commit
// of this repository, over the bundled corpus, and a fixture proposal that
// passes the host's ordinary validation.
const demoBytes = readText(
  new URL("../src/bethesda/rain/fixtures/demo-meeting.json", import.meta.url),
);
if (sha256(demoBytes) !== demoSource.snapshotSha256)
  fail(
    "R.A.I.N. demo recording differs from its manifest; re-record it, never hand-edit it",
  );
const recorded = validateMeeting(demoMeeting);
if (!recorded.ok)
  fail("R.A.I.N. demo recording is invalid: " + recorded.errors.join("; "));
if (
  !/^[0-9a-f]{40}$/.test(demoSource.rain.commit ?? "") ||
  demoSource.rain.dirty !== false ||
  !REPOSITORY.test(demoSource.rain.repository) ||
  // The recording is this repository's engine's, at a commit of this repository.
  demoSource.rain.repository !== "topherchris420/lop-nur-twin" ||
  demoMeeting.rain.repository !== demoSource.rain.repository ||
  demoMeeting.rain.commit !== demoSource.rain.commit ||
  demoMeeting.engine !== OFFLINE_ENGINE ||
  demoSource.engine !== OFFLINE_ENGINE ||
  demoMeeting.meeting_id !== demoSource.meetingId ||
  demoMeeting.question !== demoSource.question ||
  demoMeeting.generation !== "scripted" ||
  demoMeeting.model !== null ||
  demoSource.corpus.sha256 !== rainFingerprint ||
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
// The R.A.I.N. runtime's mathematical substrate: the pinned index of
// openai/math passes every check its readers apply (schema, identifiers and
// paths, sorting, statuses that follow from what it holds, counts, and the
// content hash over everything but when it was made), and the licence beside
// it is the licence it hashed. Never hand-edited: re-index with
// `scripts/math-substrate.ts index --from <checkout>`.
const mathErrors = indexErrors(mathIndex);
if (mathErrors.length)
  fail(
    "the mathematical substrate index is invalid: " + mathErrors.slice(0, 3).join("; "),
  );
const mathLicense = readText(
  new URL("../src/rain/mathematics/data/LICENSE.md", import.meta.url),
).toString("utf8");
if (sha256(FENCED.exec(mathLicense)?.[1] ?? "") !== mathIndex.license.sha256)
  fail("the mathematical substrate's licence differs from the one its index hashed");
if (mathIndex.license.spdx !== "Apache-2.0")
  fail("the mathematical substrate's licence is not the one its repository declares");
// The digital fly. FlyBody's skeleton and meshes are exactly what
// `scripts/import-flybody.ts` wrote from the pinned commit, under the licence it
// hashed; every mesh decodes, belongs to a body of the skeleton and adds up to
// the triangle counts the manifest records. The Virtual Fly Brain reference
// (`scripts/import-vfb-reference.ts`) parses and holds every term the
// controller's region links cite. Never hand-edited.
const flyData = (name: string) =>
  readText(new URL(`../src/bethesda/fly/data/${name}`, import.meta.url));
if (
  flybodySource.schema !== "flybody-source/v1" ||
  flybodySource.license !== "Apache-2.0" ||
  !/^[0-9a-f]{40}$/.test(flybodySource.commit) ||
  Number.isNaN(Date.parse(flybodySource.importedAt)) ||
  Date.parse(flybodySource.importedAt) > Date.now()
)
  fail("FlyBody import manifest is incomplete");
for (const [name, hash] of Object.entries(flybodySource.outputs))
  if (sha256(flyData(name)) !== hash)
    fail(`FlyBody ${name} differs from its import manifest`);
if (
  sha256(FENCED.exec(flyData("LICENSE.md").toString("utf8"))?.[1] ?? "") !==
  flybodySource.licenseSha256
)
  fail("FlyBody licence text differs from its import manifest");
const flySkeleton = parseSkeleton(
  JSON.parse(flyData("flybody-skeleton.json").toString("utf8")),
);
const flyBodies = new Set(flySkeleton.bodies.map((b) => b.name));
const flyMaterials = new Set(flySkeleton.materials.map((m) => m.name));
for (const lod of flybodySource.lods) {
  const mesh = parseMeshFile(
    JSON.parse(flyData(`flybody-${lod.name}.json`).toString("utf8")),
  );
  let triangles = 0;
  for (const part of mesh.parts) {
    if (!flyBodies.has(part.body) || !flyMaterials.has(part.material))
      fail(
        `FlyBody ${lod.name} part names an unknown body or material: ${part.body}/${part.material}`,
      );
    triangles += decodePart(part, mesh.quantumCm).indices.length / 3;
  }
  if (
    triangles !== mesh.triangles ||
    triangles !== lod.triangles ||
    mesh.parts.length !== lod.parts
  )
    fail(`FlyBody ${lod.name} triangle or part count differs from its manifest`);
}
const vfb = parseVfbReference(JSON.parse(flyData("vfb-reference.json").toString("utf8")));
if (Date.parse(vfb.retrievedAt) > Date.now())
  fail("VFB reference retrieved in the future");
const vfbIds = new Set(vfb.terms.map((t) => t.id));
for (const descriptor of [REDUCED_ORDER_DESCRIPTOR, CIRCUIT_DESCRIPTOR]) {
  for (const region of descriptor.regions)
    for (const id of region.vfb)
      if (!vfbIds.has(id))
        fail(`${descriptor.id} links ${id}, which the VFB reference does not hold`);
  if (descriptor.simulatesNeurons)
    fail(`${descriptor.id} must not claim to simulate neurons`);
}
// The grooming ethograms' summaries are what the importer wrote: parsed
// strictly, retrieved in the past, under the dataset's CC BY 4.0.
const grooming = parseGroomingReference(
  JSON.parse(flyData("grooming-reference.json").toString("utf8")),
);
if (Date.parse(grooming.retrievedAt) > Date.now())
  fail("grooming reference retrieved in the future");
// Every fly plan and record binds the source digest in flySource.ts; a stale
// one would name code that did not make them.
const flySource = computeFlySource(
  workingTreeReader(fileURLToPath(new URL("..", import.meta.url))),
);
if (flySource.sha256 !== FLY_SOURCE.sha256)
  fail(
    `the digital fly's source digest is stale (${changedFlySources(FLY_SOURCE, flySource).join(", ")} changed): run node scripts/run-ts.mjs scripts/fly-source.ts`,
  );
console.log(
  `[validate:bethesda] digital fly: FlyBody ${flybodySource.commit.slice(0, 12)} (${flySkeleton.bodies.length} bodies, ${flybodySource.lods.map((l) => `${l.name} ${l.triangles}`).join(", ")} triangles) and VFB reference (${vfb.terms.length} terms, retrieved ${vfb.retrievedAt}) and grooming ethograms (${grooming.conditions.dusted.flies} + ${grooming.conditions.undusted.flies} flies, retrieved ${grooming.retrievedAt}) verified; experiment source digest ${FLY_SOURCE.sha256.slice(0, 12)} current`,
);
console.log(
  `[validate:bethesda] ${raw.features.length} real OSM features, ${streetscapeFeatures} streetscape features and 4225 real DTM samples; bounds, license and checksums verified; R.A.I.N. corpus ${rainCorpus.files.length} papers ${rainFingerprint.slice(0, 12)} verified; demo recording ${demoSource.meetingId} at ${demoSource.rain.repository} ${demoSource.rain.commit.slice(0, 12)} verified; mathematical substrate ${mathIndex.repository} ${mathIndex.commit.slice(0, 12)} (${mathIndex.counts.families} families, index ${mathIndex.content_sha256.slice(0, 12)}) verified`,
);
