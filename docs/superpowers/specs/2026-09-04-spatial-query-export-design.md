# Spatial Query and Interoperable Export Design

## Purpose

Lop Nur Twin already has a strong evidence ledger, uncertainty model, temporal
snapshots, release manifests, and accessible analysis route. The missing link is
a deterministic spatial-analysis layer. Researchers can inspect individual
structures and compare releases, but they cannot ask reproducible questions such
as which interpreted structures lie within a modeled distance of the runway or
export the answer as geospatial data.

This feature adds a pure, source-aware spatial catalog and query engine derived
from the existing layout. It exposes the results on `/analysis` and exports them
as canonical JSON, RFC 4180 CSV, and RFC 7946 GeoJSON. It does not add or alter
evidence, infer undocumented history, or claim that modeled coordinates are
survey-grade.

## Goals

- Make every spatial result reproducible from committed model data.
- Keep geometry, evidence, uncertainty, and temporal state joined by stable
  subject identifiers.
- Support deterministic filtering by subject kind, evidence classification,
  source support, uncertainty, temporal presence, and modeled proximity.
- Compute distance against modeled footprints rather than visual pixels or
  center-point shortcuts.
- Export results with the query criteria, CRS, derivation method, limitations,
  and release hashes needed to reproduce them.
- Keep `/analysis` fully usable without WebGL and preserve its current
  accessibility guarantees.

## Non-goals

- No automated imagery analysis, change detection, target tracking, or remote
  data ingestion.
- No new evidence, coordinates, source imagery, confidence values, dates, or
  uncertainty figures.
- No line-of-sight, terrain-slope, or visibility analysis; the terrain is a
  procedural proxy and cannot support those claims.
- No 3D relationship overlay or temporal ghost geometry in this iteration.
- No generic SQL-like language, natural-language query interpreter, spatial
  index, backend, account, or cloud persistence.
- The existing opt-in live ADS-B layer, its source registration, and its CSP
  allowance are preserved unchanged. Live traffic remains ephemeral and must
  not enter the analytical catalog, query results, exports, evidence ledger, or
  release hashes.

## Architectural position

The new pipeline is:

```text
layout.ts + siteData.ts
          |
          v
evidence.ts + temporal.ts + uncertainty.ts
          |
          v
spatialCatalog.ts  -- derived geometry and subject metadata
          |
          v
spatialQuery.ts    -- deterministic predicates and distances
          |
          +----> /analysis semantic query workbench
          +----> JSON / CSV / GeoJSON export
```

`layout.ts` remains the only authoritative geometry definition.
`spatialCatalog.ts` is a read-only projection, not another catalog to maintain.
No React component decides evidence semantics or performs spatial mathematics.

## Coordinate systems and geodesy

Create `src/lib/geospatial.ts` as the single place for coordinate conversion:

- Local model coordinates remain metres with `+x` east and `+z` south.
- `localToProjected()` and `projectedToLocal()` convert by the existing
  `GRID_EASTING_ORIGIN` and `GRID_NORTHING_ORIGIN` registration.
- `projectedToWgs84()` and `wgs84ToProjected()` implement WGS 84 / UTM zone 45N
  conversion using fixed WGS 84 ellipsoid constants and no network or new
  dependency.
- `localToWgs84()` composes the two transforms for GeoJSON output.
- Existing measurement and HUD coordinate readouts must use the centralized
  local/projected primitive so the new export cannot drift from current UI.

Tests will verify the published runway-center pair, inverse round trips across
the 6.8 km frame, hemisphere/zone constraints, finite-number rejection, and
stable rounding. GeoJSON coordinates will be rounded deterministically, while
properties explicitly state that numerical precision is not positional
accuracy and carry the existing uncertainty envelope.

## Derived spatial catalog

Create `src/lib/spatialCatalog.ts` with one immutable record per spatial layout
subject:

```ts
type SpatialSubjectKind = "structure" | "aircraft" | "pavement" | "apron";

interface SpatialSubject {
  id: string;
  label: string;
  kind: SpatialSubjectKind;
  geometry: SpatialGeometry;
  evidenceClass: EvidenceClassification;
  confidence: number | undefined;
  sourceIds: readonly string[];
  uncertainty: UncertaintyEnvelope | undefined;
  observedDate: string | undefined;
}
```

Geometry is derived as follows:

- Structures and aprons become oriented rectangular polygons using their
  declared center, rotation, and footprint dimensions.
- Runways, strips, taxiways, streets, and roads become rectangular pavement
  polygons using their centerline and declared width. Flat end caps match the
  rendered planar geometry; decorative fillets are excluded because they are
  presentation details, not authoritative records.
- Aircraft in `STRUCTURES` retain their declared rectangular analytical
  footprint and remain classified as aircraft.
- Simulation-only moving entities and live ADS-B traffic are excluded because
  they do not describe stable analytical geometry.

Each record resolves evidence through `getEvidenceForSubject()` and uncertainty
through `getUncertaintyForSubject()`. The catalog is sorted by subject id and
frozen. Any layout spatial subject without a catalog entry, evidence record, or
valid polygon fails validation.

## Spatial mathematics

Create pure geometry primitives in `src/lib/spatialQuery.ts`:

- point-to-segment distance;
- segment intersection with collinear and zero-length handling;
- point-in-polygon including boundary points;
- minimum polygon-to-polygon distance, returning zero for touching or
  overlapping footprints;
- centroid and cardinal relation helpers;
- nearest-subject selection with stable subject-id tie-breaking.

All distances are planar grid distances in EPSG:32645 metres. Results must say
"modeled footprint distance" and never imply geodesic or surveyed accuracy.
No uncertainty propagation formula will be invented. A result carries both
subjects' existing uncertainty envelopes and reports derived distance
uncertainty as `unknown` unless a separately documented propagation method is
added in a future release.

## Query contract

The engine accepts a serializable criteria object:

```ts
interface SpatialQuery {
  kinds?: readonly SpatialSubjectKind[];
  evidenceClasses?: readonly EvidenceClassification[];
  sourceSupport?: "any" | "direct-observation" | "without-direct-observation";
  maximumStatedHorizontalUncertaintyM?: number;
  includeUnknownHorizontalUncertainty?: boolean;
  snapshotDate?: string;
  presence?: readonly SubjectPresence[];
  anchorSubjectId?: string;
  maximumDistanceM?: number;
}
```

Rules:

- Omitted criteria do not filter.
- Unknown uncertainty is never treated as zero. It is excluded from a numeric
  maximum unless `includeUnknownHorizontalUncertainty` is explicitly true.
- `direct-observation` means at least one published evidence record classified
  `observed`; `without-direct-observation` means none. It does not promote the
  subject's overall classification.
- Temporal presence comes from `deriveSnapshot()` and preserves
  `established`, `not-yet-evidenced`, and `undated` as distinct states.
- Proximity requires a known catalog anchor and a finite non-negative maximum.
- The anchor itself is excluded from proximity results.
- Results are sorted by distance when proximity is active, then by subject id;
  otherwise by subject id.
- Invalid criteria return structured validation errors rather than being
  coerced into a plausible query.

Every result includes the subject record, optional anchor distance, the exact
criteria, and a derivation statement. A query produces the same ordered result
for the same model and criteria.

## Accessible analysis interface

Add a `Spatial query` section to `/analysis` before the existing structure
table. Use native controls only:

- subject-kind checkboxes;
- evidence-class checkboxes;
- source-support selector;
- uncertainty maximum plus an explicit "include not stated" checkbox;
- snapshot date and presence selectors;
- anchor subject selector and maximum-distance input;
- reset button and live result count with `role="status"`.

The result table includes subject, kind, evidence, modeled distance, stated
uncertainty, temporal presence, and sources. "Not stated" remains visible as
text. The table links each structure back to its 3D dossier.

Validated URL parameters represent the query so a copied URL reproduces the
same criteria. Parameters are bounded by the existing `params.ts` conventions;
unknown ids, non-finite numbers, oversized values, invalid dates, and unknown
enums are dropped safely. Existing `/analysis?structure=` links continue to
work.

## Export formats

Create `src/lib/spatialExport.ts`. Exports are generated from the query result,
never by scraping the rendered table.

### Canonical JSON

Contains a schema version, query criteria, model identity and hashes when the
same-origin manifest is available, CRS metadata, derivation notes, known
limitations, and sorted result records. Canonical serialization uses the
existing `canonicalJson.ts` helper.

### CSV

One deterministic row per result with RFC 4180 quoting. Compound values such as
source ids are stable, delimiter-separated strings. Unknown values are the
literal `not stated`, not zero or an empty field.

### GeoJSON

An RFC 7946 `FeatureCollection` in WGS 84 longitude/latitude. Each feature
contains the transformed footprint and properties for subject id, kind,
evidence class, confidence, sources, temporal presence, modeled distance,
uncertainty, source CRS, and derivation method. The collection includes a
foreign `lopNurTwin` metadata member for schema version, query criteria, model
hashes, and limitations. Consumers that ignore foreign members still receive
valid GeoJSON.

The exporter validates finite coordinates, polygon closure, longitude/latitude
bounds, stable ordering, and round-trip parseability before offering a file.

## Validation and tests

Use strict red-green-refactor cycles for each module.

Unit tests cover:

- local/projected/geographic conversion and round trips;
- oriented footprints at zero and non-zero rotation;
- zero-length, touching, overlapping, contained, and separated geometry;
- deterministic nearest-neighbor tie-breaking;
- every query predicate independently and in composition;
- unknown versus known-zero uncertainty behavior;
- undated versus not-yet-evidenced temporal state;
- empty catalogs and empty results;
- malformed, infinite, negative, and extreme criteria;
- byte-identical JSON/CSV/GeoJSON generation across repeated runs;
- valid GeoJSON rings and coordinates;
- live ADS-B entities never entering the catalog or exports.

Extend `scripts/validate-data.ts` to assert catalog completeness, evidence
linkage, finite geometry, closed polygons, valid subject ids, and representative
query invariants. Extend `tools/routes.mjs` for hostile query parameters,
keyboard order, filtering, export buttons, and mobile reflow. Extend the axe
gate through the existing `/analysis` route coverage.

Final verification runs:

```sh
bun run format:check
bun run lint
bun run test:run
bun run test:evidence
bun run validate:data
bun run build
bun run a11y
bun run routes
```

No rendering-performance claim will be made because the query workbench does
not enter the Three.js bundle or frame loop. Bundle sizes before and after will
still be recorded to confirm the 3D chunks do not absorb the query engine.

## Documentation

Update the README, `CONTRIBUTING.md`, `docs/SYSTEM_ARCHITECTURE.md`,
`docs/DATA_PROVENANCE.md`, `docs/SITE_MODEL.md`, `docs/VALIDATION.md`, and a new
`docs/SPATIAL_ANALYSIS.md`. Document geometry derivation, planar-distance
semantics, WGS 84 export, query reproduction, uncertainty limits, and the
explicit exclusion of live ADS-B data from analytical outputs.

## Decisions

- Chosen: a pure derived catalog and deterministic query engine.
- Chosen: footprint distance rather than center distance.
- Chosen: RFC 7946 WGS 84 GeoJSON rather than non-standard projected GeoJSON.
- Chosen: no dependency; geodesy is small, deterministic, and directly tested.
- Chosen: preserve live ADS-B unchanged but enforce its exclusion from every
  analytical artifact.
- Rejected: a 3D-only relationship overlay, because it would not be accessible
  or exportable.
- Rejected: automated imagery/STAC ingestion in this release, because no source
  artifact acquisition and licensing policy exists yet.
- Rejected: a natural-language query layer, because deterministic structured
  criteria are inspectable and reproducible.

