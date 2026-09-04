# Spatial Query and Interoperable Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, evidence-aware spatial query engine and canonical JSON, CSV, and WGS84 GeoJSON exports to the accessible `/analysis` route.

**Architecture:** Pure modules derive spatial subjects from `layout.ts`, join them to the existing evidence and temporal ledgers, and calculate planar footprint relationships in EPSG:32645. A thin route component owns native form controls and file downloads; it never reimplements evidence or geometry rules. The live ADS-B layer remains unchanged and is explicitly excluded from the spatial catalog and all exports.

**Tech Stack:** TypeScript 5.9, React 19, TanStack Router, Vitest, Vite, existing canonical JSON and evidence/temporal modules.

**Spec:** `docs/superpowers/specs/2026-09-04-spatial-query-export-design.md`

## Global Constraints

- Do not add dependencies, sources, coordinates, dates, confidence values, or uncertainty figures.
- `src/lib/layout.ts` remains the authoritative geometry source.
- Evidence semantics come only from `src/lib/evidence.ts`; temporal presence comes only from `src/lib/temporal.ts`.
- Unknown uncertainty is never treated as zero and exports print it as `not stated`.
- All distances are modeled planar footprint distances in EPSG:32645, not geodesic or survey measurements.
- GeoJSON is RFC 7946 WGS84 longitude/latitude and carries the original CRS, derivation method, uncertainty, and limitations as properties.
- Preserve the live ADS-B code, CSP allowance, and source registration unchanged; exclude live entities from every analytical artifact.
- No Three.js import, render-loop work, runtime telemetry, or third-party request may enter the query/export path.

---

### Task 1: Central geospatial coordinate primitives

**Files:**

- Create: `src/lib/geospatial.test.ts`
- Create: `src/lib/geospatial.ts`
- Modify: `src/lib/measure.ts`
- Modify: `src/components/hud/Hud.tsx`

**Interfaces:**

- Consumes: `GRID_EASTING_ORIGIN`, `GRID_NORTHING_ORIGIN`, `SITE_PROFILE.localCrs`
- Produces:

```ts
export interface LocalCoordinate { x: number; z: number }
export interface ProjectedCoordinate { easting: number; northing: number }
export interface GeographicCoordinate { longitude: number; latitude: number }
export function localToProjected(point: LocalCoordinate): ProjectedCoordinate
export function projectedToLocal(point: ProjectedCoordinate): LocalCoordinate
export function projectedToWgs84(point: ProjectedCoordinate): GeographicCoordinate
export function wgs84ToProjected(point: GeographicCoordinate): ProjectedCoordinate
export function localToWgs84(point: LocalCoordinate): GeographicCoordinate
```

- [ ] **Step 1: Write coordinate-contract tests**

```ts
import { describe, expect, it } from "vitest";
import { RUNWAY_CENTER } from "./layout";
import { SITE_PROFILE } from "./siteData";
import {
  localToProjected,
  localToWgs84,
  projectedToLocal,
  projectedToWgs84,
  wgs84ToProjected,
} from "./geospatial";

describe("geospatial transforms", () => {
  it("registers the modeled runway center to the published UTM coordinate", () => {
    expect(localToProjected({ x: RUNWAY_CENTER[0], z: RUNWAY_CENTER[1] })).toEqual({
      easting: SITE_PROFILE.localCrs.runwayCenterEastingM,
      northing: SITE_PROFILE.localCrs.runwayCenterNorthingM,
    });
  });

  it("maps the published UTM reference back to the published WGS84 reference", () => {
    const geographic = projectedToWgs84({
      easting: SITE_PROFILE.localCrs.runwayCenterEastingM,
      northing: SITE_PROFILE.localCrs.runwayCenterNorthingM,
    });
    expect(geographic.latitude).toBeCloseTo(SITE_PROFILE.referenceCoordinate.latitude, 5);
    expect(geographic.longitude).toBeCloseTo(SITE_PROFILE.referenceCoordinate.longitude, 5);
  });

  it("round-trips representative local and geographic coordinates", () => {
    for (const point of [{ x: 0, z: 0 }, { x: -3400, z: 3400 }, { x: 3400, z: -3400 }]) {
      const roundTrip = projectedToLocal(localToProjected(point));
      expect(roundTrip.x).toBeCloseTo(point.x, 8);
      expect(roundTrip.z).toBeCloseTo(point.z, 8);
      const geographic = localToWgs84(point);
      const projected = wgs84ToProjected(geographic);
      const expected = localToProjected(point);
      expect(projected.easting).toBeCloseTo(expected.easting, 3);
      expect(projected.northing).toBeCloseTo(expected.northing, 3);
    }
  });

  it("rejects non-finite and out-of-zone inputs", () => {
    expect(() => localToProjected({ x: Number.NaN, z: 0 })).toThrow(TypeError);
    expect(() => projectedToWgs84({ easting: -1, northing: 0 })).toThrow(RangeError);
    expect(() => wgs84ToProjected({ longitude: 0, latitude: 95 })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun x vitest run src/lib/geospatial.test.ts`

Expected: FAIL because `./geospatial` does not exist.

- [ ] **Step 3: Implement fixed-zone WGS84/UTM transforms**

Use the WGS84 constants `a = 6378137`, `f = 1 / 298.257223563`, UTM scale `0.9996`, false easting `500000`, northern false northing `0`, and zone-45 central meridian `87°`. Implement the standard Transverse Mercator forward and inverse series as pure finite-number-checked functions. Do not round inside the primitives.

`localToProjected` must be exactly:

```ts
return {
  easting: GRID_EASTING_ORIGIN + point.x,
  northing: GRID_NORTHING_ORIGIN - point.z,
};
```

- [ ] **Step 4: Verify GREEN and centralize existing callers**

Run: `bun x vitest run src/lib/geospatial.test.ts src/lib/measure.test.ts`

Expected: PASS.

Replace `gridEastingNorthing()` internals with `localToProjected({ x, z })`. Update `Hud.tsx` to use the same primitive. Preserve the existing `GridCoordinate` public shape and displayed integer formatting.

- [ ] **Step 5: Commit the geospatial primitive**

```sh
git add src/lib/geospatial.ts src/lib/geospatial.test.ts src/lib/measure.ts src/components/hud/Hud.tsx
git commit -m "Keep every coordinate export on one verified transform" \
  -m "Centralize local, UTM zone 45N, and WGS84 conversion so HUD, measurements, and future exports cannot drift."
```

---

### Task 2: Derived spatial catalog and footprint mathematics

**Files:**

- Create: `src/lib/spatialCatalog.test.ts`
- Create: `src/lib/spatialCatalog.ts`
- Create: `src/lib/spatialQuery.test.ts`
- Create: `src/lib/spatialQuery.ts`

**Interfaces:**

- Consumes: `STRUCTURES`, `ALL_SEGMENTS`, `APRONS`, `getEvidenceForSubject()`, `getUncertaintyForSubject()`
- Produces:

```ts
export type LocalPoint = readonly [x: number, z: number];
export type LocalRing = readonly LocalPoint[];
export type SpatialSubjectKind = "structure" | "aircraft" | "pavement" | "apron";
export interface SpatialSubject {
  id: string;
  label: string;
  kind: SpatialSubjectKind;
  footprint: LocalRing;
  evidenceClass: EvidenceClassification;
  confidence?: number;
  sourceIds: readonly string[];
  uncertainty?: UncertaintyEnvelope;
  observedDate?: string;
}
export const SPATIAL_SUBJECTS: readonly SpatialSubject[];
export function getSpatialSubject(id: string): SpatialSubject | undefined;
export function pointToSegmentDistance(point: LocalPoint, a: LocalPoint, b: LocalPoint): number;
export function polygonsIntersect(left: LocalRing, right: LocalRing): boolean;
export function footprintDistanceM(left: LocalRing, right: LocalRing): number;
```

- [ ] **Step 1: Write failing catalog tests**

Assert that the catalog contains exactly `STRUCTURES.length + ALL_SEGMENTS.length + APRONS.length` subjects, ids are unique and sorted, every ring is closed with five points, structure/apron/segment corners match declared dimensions, and no id starts with `live-aircraft-`.

```ts
expect(SPATIAL_SUBJECTS.map((subject) => subject.id)).toEqual(
  [...SPATIAL_SUBJECTS.map((subject) => subject.id)].sort(),
);
expect(SPATIAL_SUBJECTS.some((subject) => subject.id.startsWith("live-aircraft-"))).toBe(false);
```

- [ ] **Step 2: Write failing geometry tests**

```ts
function square(centerX: number, centerZ: number, size: number): LocalRing {
  const half = size / 2;
  return [
    [centerX - half, centerZ - half],
    [centerX + half, centerZ - half],
    [centerX + half, centerZ + half],
    [centerX - half, centerZ + half],
    [centerX - half, centerZ - half],
  ];
}
```

```ts
it("returns zero for touching, overlapping, and contained footprints", () => {
  expect(footprintDistanceM(square(0, 0, 10), square(10, 0, 10))).toBe(0);
  expect(footprintDistanceM(square(0, 0, 10), square(4, 0, 2))).toBe(0);
});

it("uses edge distance rather than center distance", () => {
  expect(footprintDistanceM(square(0, 0, 10), square(20, 0, 10))).toBeCloseTo(10);
});

it("handles zero-length segments without NaN", () => {
  expect(pointToSegmentDistance([3, 4], [0, 0], [0, 0])).toBe(5);
});
```

- [ ] **Step 3: Run both suites and verify RED**

Run: `bun x vitest run src/lib/spatialCatalog.test.ts src/lib/spatialQuery.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement catalog and geometry primitives**

Build oriented rectangles by rotating local half-extents around the declared center. A segment footprint uses the normalized centerline perpendicular times `width / 2`; reject zero-length source segments because the layout validator already forbids them. Close every ring by repeating the first point. Resolve all evidence through existing accessors; use the strongest classification, highest recorded confidence, distinct sorted source ids, and widest merged uncertainty.

Implement polygon intersection through segment intersection plus containment. Compute separation as the minimum point-to-edge distance in both directions. Reject rings with fewer than four points or non-finite coordinates.

- [ ] **Step 5: Verify GREEN and commit**

Run: `bun x vitest run src/lib/spatialCatalog.test.ts src/lib/spatialQuery.test.ts`

Expected: PASS.

```sh
git add src/lib/spatialCatalog.ts src/lib/spatialCatalog.test.ts src/lib/spatialQuery.ts src/lib/spatialQuery.test.ts
git commit -m "Make modeled spatial relationships calculable instead of visual guesses" \
  -m "Derive immutable analytical footprints from the authoritative layout and calculate deterministic edge-to-edge distances."
```

---

### Task 3: Query contract and deterministic exports

**Files:**

- Modify: `src/lib/spatialQuery.ts`
- Modify: `src/lib/spatialQuery.test.ts`
- Create: `src/lib/spatialExport.ts`
- Create: `src/lib/spatialExport.test.ts`

**Interfaces:**

- Consumes: `SPATIAL_SUBJECTS`, `deriveSnapshot()`, `canonicalize()`, `KNOWN_LIMITATIONS`
- Produces:

```ts
export type SourceSupport = "any" | "direct-observation" | "without-direct-observation";
export interface SpatialQuery {
  kinds?: readonly SpatialSubjectKind[];
  evidenceClasses?: readonly EvidenceClassification[];
  sourceSupport?: SourceSupport;
  maximumStatedHorizontalUncertaintyM?: number;
  includeUnknownHorizontalUncertainty?: boolean;
  snapshotDate?: string;
  presence?: readonly SubjectPresence[];
  anchorSubjectId?: string;
  maximumDistanceM?: number;
}
export interface SpatialQueryResult { subject: SpatialSubject; distanceM?: number; presence?: SubjectPresence }
export type SpatialQueryResponse =
  | { ok: true; query: SpatialQuery; results: readonly SpatialQueryResult[]; derivation: string }
  | { ok: false; errors: readonly string[] };
export type SuccessfulSpatialQuery = Extract<SpatialQueryResponse, { ok: true }>;
export function runSpatialQuery(query: SpatialQuery): SpatialQueryResponse;

export interface SpatialExportIdentity {
  modelVersion?: string;
  geometryHash?: string;
  evidenceLedgerHash?: string;
}
export function spatialResultsToJson(response: SuccessfulSpatialQuery, identity?: SpatialExportIdentity): string;
export function spatialResultsToCsv(response: SuccessfulSpatialQuery): string;
export function spatialResultsToGeoJson(response: SuccessfulSpatialQuery, identity?: SpatialExportIdentity): string;
```

- [ ] **Step 1: Write failing predicate tests**

Cover each filter independently and in composition. Explicitly test that an unknown horizontal uncertainty fails a numeric maximum unless the include-unknown flag is true; undated and not-yet-evidenced remain distinct; direct observation inspects records rather than promoting overall classification; invalid anchor/date/radius returns errors; proximity excludes the anchor and sorts equal distances by id.

- [ ] **Step 2: Run query tests and verify RED**

Run: `bunx vitest run src/lib/spatialQuery.test.ts`

Expected: FAIL on missing query interfaces/functions.

- [ ] **Step 3: Implement query validation and filtering**

Validate enum members against exported vocabularies, require finite non-negative numeric thresholds, require snapshot dates to pass `isIsoDate`, and require anchors to resolve in the catalog. Never mutate or coerce caller input. Use `deriveSnapshot()` once per query and index its subjects by id.

- [ ] **Step 4: Write failing export tests**

```ts
function successful(response: SpatialQueryResponse): SuccessfulSpatialQuery {
  if (!response.ok) throw new Error(response.errors.join("; "));
  return response;
}

it("is byte-identical across repeated JSON, CSV, and GeoJSON exports", () => {
  const response = successful(runSpatialQuery({ anchorSubjectId: "rwy-05-23", maximumDistanceM: 500 }));
  expect(spatialResultsToJson(response)).toBe(spatialResultsToJson(response));
  expect(spatialResultsToCsv(response)).toBe(spatialResultsToCsv(response));
  expect(spatialResultsToGeoJson(response)).toBe(spatialResultsToGeoJson(response));
});

it("emits closed finite WGS84 polygon rings", () => {
  const collection = JSON.parse(spatialResultsToGeoJson(successful(runSpatialQuery({}))));
  for (const feature of collection.features) {
    const ring = feature.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.flat().every(Number.isFinite)).toBe(true);
  }
});

it("does not serialize unknown uncertainty as zero", () => {
  expect(spatialResultsToCsv(successful(runSpatialQuery({})))).toContain("not stated");
});
```

- [ ] **Step 5: Implement and verify exports**

Canonical JSON contains schema `lop-nur-spatial-query/1.0.0`, normalized criteria, identity, CRS metadata, derivation text, limitations, and sorted results. CSV uses a local RFC 4180 quoting helper. GeoJSON converts each ring with `localToWgs84`, rounds to six decimal degrees, validates bounds/closure, and attaches evidence, source, uncertainty, presence, distance, and derivation properties.

Run: `bun x vitest run src/lib/geospatial.test.ts src/lib/spatialCatalog.test.ts src/lib/spatialQuery.test.ts src/lib/spatialExport.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit query and export behavior**

```sh
git add src/lib/spatialQuery.ts src/lib/spatialQuery.test.ts src/lib/spatialExport.ts src/lib/spatialExport.test.ts
git commit -m "Let researchers reproduce spatial questions outside the browser" \
  -m "Add validated evidence-aware queries and canonical JSON, CSV, and WGS84 GeoJSON exports with explicit model-space limitations."
```

---

### Task 4: Accessible `/analysis` spatial workbench

**Files:**

- Create: `src/components/evidence/SpatialQueryPanel.tsx`
- Modify: `src/routes/analysis.tsx`
- Modify: `src/lib/params.ts`
- Modify: `src/lib/params.test.ts`
- Modify: `tools/routes.mjs`

**Interfaces:**

- Consumes: `runSpatialQuery()`, export functions, `useModelManifest()`, route search state
- Produces: native query controls, semantic result table, validated shareable search state, file downloads

- [ ] **Step 1: Add failing pure parameter tests**

Refactor parameter parsing to accept a `URLSearchParams` input through pure exported helpers while preserving current browser readers. Add bounded comma-list parsing for `kinds`, `classes`, and `presence`, plus `support`, `anchor`, `distance`, `uncertainty`, `includeUnknown`, and `spatialDate`. Values longer than 64 characters, unknown members, invalid ids/dates, non-finite numbers, negatives, and values over `SITE_SIZE` must return null or an empty list.

Run: `bun x vitest run src/lib/params.test.ts`

Expected: RED on the new helper imports.

- [ ] **Step 2: Implement parameter helpers and verify GREEN**

The route `validateSearch` must return a typed search object containing the existing optional `structure` plus only validated spatial fields. UI changes call TanStack Router navigation with `replace: true`; they do not write `window.history` directly.

Run: `bun x vitest run src/lib/params.test.ts`

Expected: PASS with all existing parameter tests unchanged.

- [ ] **Step 3: Build `SpatialQueryPanel`**

Keep the route under 1,100 lines by moving all new controls, result rendering, and download handling into the component. Use `<fieldset>`, `<legend>`, `<label>`, native checkbox/select/number controls, `<table>`, a `<caption>`, row headers, `role="status"`, and visible focus styles. Download through object URLs revoked immediately after the click. Disable exports for invalid queries; empty valid results remain exportable.

- [ ] **Step 4: Mount the panel and preserve existing navigation**

Place it before the current structure table. Change the skip link target and text to `#spatial-query-results` / `Skip to spatial query results`; keep a secondary in-page link to `#structure-table`. Existing deep-linked structure highlighting, bookmarks, temporal tables, evidence modes, and current structure filters must keep working.

- [ ] **Step 5: Extend route checks and verify**

Add browser assertions for:

```text
/analysis?anchor=rwy-05-23&distance=500
/analysis?kinds=structure,aircraft&support=without-direct-observation
/analysis?uncertainty=0&includeUnknown=1
/analysis?spatialDate=2025-09-13&presence=established
```

Assert result count text, stable first-row order, export-button availability, keyboard reachability, mobile containment, and safe handling of hostile/oversized spatial parameters.

Run against preview: `bun run build`, then `bun run preview`, then `bun run a11y` and `bun run routes`.

- [ ] **Step 6: Commit the accessible workbench**

```sh
git add src/components/evidence/SpatialQueryPanel.tsx src/routes/analysis.tsx src/lib/params.ts src/lib/params.test.ts tools/routes.mjs
git commit -m "Put deterministic spatial questions at the accessible front door" \
  -m "Expose validated shareable query controls, semantic results, and local exports on /analysis without adding WebGL or third-party traffic."
```

---

### Task 5: Build invariants and research documentation

**Files:**

- Modify: `scripts/validate-data.ts`
- Create: `docs/SPATIAL_ANALYSIS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/SYSTEM_ARCHITECTURE.md`
- Modify: `docs/DATA_PROVENANCE.md`
- Modify: `docs/SITE_MODEL.md`
- Modify: `docs/VALIDATION.md`

**Interfaces:**

- Consumes: completed catalog/query/export modules
- Produces: build-gating catalog invariants and reproducible researcher guidance

- [ ] **Step 1: Add validator assertions before implementation edits**

Import the spatial catalog and query engine into `validate-data.ts`. Assert expected catalog size, unique/sorted ids, closed finite rings, all layout ids represented exactly once, all subjects have evidence, no live id appears, runway-to-itself exclusion, overlapping distance zero, and two repeated representative queries serialize identically.

Run: `bun run validate:data`

Expected: RED until all validator imports and assertions are satisfied.

- [ ] **Step 2: Make validator GREEN without weakening evidence rules**

Run: `bun run validate:data && bun run test:evidence`.

Expected: both PASS; all 35 negative evidence rules still fire.

- [ ] **Step 3: Document the complete method**

`docs/SPATIAL_ANALYSIS.md` must explain authoritative inputs, footprint derivation, coordinate transforms, planar distance, query semantics, GeoJSON conversion, reproducibility, uncertainty limits, exclusion of live ADS-B, and examples for each export. Update existing docs only where their architecture, feature list, extension recipes, or validation commands change. Correct the README unit-test count from its stale value to the observed suite count only after the final run establishes the new number.

- [ ] **Step 4: Run the full static and deterministic gate**

```sh
bun run format
bun run format:check
bun run lint
bun run test:run
bun run test:evidence
bun run validate:data
SOURCE_DATE_EPOCH=1700000000 bun run manifest
Copy-Item public/model-manifest.json "$env:TEMP\lop-nur-manifest-a.json"
SOURCE_DATE_EPOCH=1700000000 bun run manifest
Compare-Object (Get-Content "$env:TEMP\lop-nur-manifest-a.json") (Get-Content public/model-manifest.json)
bun run build
git diff --check
```

Expected: every command exits 0; `Compare-Object` prints nothing.

- [ ] **Step 5: Run production browser gates**

Start `bun run preview -- --host 127.0.0.1`, then run:

```sh
bun run a11y
bun run routes
```

Expected: `/analysis` and `/compare` have zero serious/critical axe violations, zero CSP violations, zero page errors, and all route assertions pass. Record `/play` findings separately because its axe policy is advisory.

- [ ] **Step 6: Record bundle and integrity impact**

Copy the Vite gzip table from the build output. Confirm `spatialQuery`, `spatialExport`, and `geospatial` are absent from the `/play` chunk dependency graph and no `fetch`, `setInterval`, `requestAnimationFrame`, `useFrame`, or `three` import exists in the new modules:

```sh
rg -n "fetch\(|setInterval|requestAnimationFrame|useFrame|from ['\"]three['\"]" src/lib/geospatial.ts src/lib/spatialCatalog.ts src/lib/spatialQuery.ts src/lib/spatialExport.ts
```

Expected: no matches.

- [ ] **Step 7: Commit validation and documentation**

```sh
git add scripts/validate-data.ts docs/SPATIAL_ANALYSIS.md README.md CONTRIBUTING.md docs/SYSTEM_ARCHITECTURE.md docs/DATA_PROVENANCE.md docs/SITE_MODEL.md docs/VALIDATION.md
git commit -m "Make spatial conclusions carry their derivation and limits" \
  -m "Gate catalog integrity at build time and document exactly what the query and export surfaces establish and what they do not."
```

---

### Task 6: Final analytical integrity review

**Files:** Review every changed file and commit; no new feature scope.

- [ ] **Step 1: Inspect the complete branch diff**

Run: `git diff origin/main...HEAD --stat`, `git diff origin/main...HEAD --check`, and `git diff origin/main...HEAD`.

Verify that every new number is a fixed geodetic constant, a layout-derived value, a user-supplied bounded query threshold, or an existing documented model value. Verify no output labels a modeled distance geodesic, observed, surveyed, or exact.

- [ ] **Step 2: Re-run focused examples**

Use unit tests or a small `bun -e` invocation to answer and inspect:

- interpreted/illustrative structures within 500 modeled metres of `rwy-05-23`;
- subjects without direct observational evidence;
- subjects with unknown stated horizontal uncertainty;
- subjects established by a selected snapshot date;
- an empty query result;
- identical repeated exports.

- [ ] **Step 3: Confirm ADS-B isolation**

Run `rg -n "ADSB|liveTraffic|live-aircraft" src docs vite.config.ts SECURITY.md` and inspect every hit. Existing live-layer files and CSP/source hooks must remain. New spatial modules and exports must contain only negative exclusion tests or documentation; no live entity can enter `SPATIAL_SUBJECTS`.

- [ ] **Step 4: Produce the engineering report**

Report repository assessment, selected opportunity, implementation, files, analytical impact, evidence integrity, exact validation statuses, bundle impact, limitations, and the next three improvements. Do not claim geodesic accuracy, source verification, performance improvement, or accessibility conformance beyond the checks actually run.
