# Spatial analysis and export

Lop Nur Twin's spatial workbench answers deterministic questions about the
committed model. It does not analyse live traffic, infer activity, or turn a
modeled coordinate into survey control.

## Authoritative inputs

The only spatial inputs are `STRUCTURES`, `ALL_SEGMENTS`, and `APRONS` in
`src/lib/layout.ts`. `src/lib/spatialCatalog.ts` derives one immutable subject
per layout record and joins it to the existing evidence and uncertainty
accessors. There is no second editable geometry registry.

Live ADS-B aircraft and other moving simulation entities are intentionally
absent. They are ephemeral context, not stable analytical subjects, and never
enter query results, exports, the evidence ledger, or model hashes.

## Footprint derivation

- Structures and aprons become oriented rectangular polygons from their
  declared center, rotation, and footprint dimensions.
- Runways, strips, taxiways, streets, and roads become rectangles around their
  centerline using the declared width and flat end caps.
- Decorative pavement fillets are presentation details and are not included.

Each local ring is finite, closed, and ordered deterministically. The build
fails if a layout subject is missing, duplicated, unlinked from evidence, or
produces invalid geometry.

## Coordinate systems

Model coordinates are local metres: +x east, +z south. `localToProjected()` in
`src/lib/geospatial.ts` applies the same registration used by the HUD and ruler
to produce EPSG:32645 easting/northing. The same module converts WGS 84 / UTM
zone 45N to EPSG:4326 for RFC 7946 GeoJSON.

The conversion uses WGS 84 ellipsoid and UTM constants and is tested against
the published runway-center coordinate and frame-wide round trips. Exported
longitude/latitude values are rounded deterministically to six decimal places.
That numerical precision is not positional accuracy. The model registration
still carries the documented uncertainty and is not survey-grade.

## Distance semantics

Proximity is the minimum planar distance between modeled footprint edges in
EPSG:32645. Touching, overlapping, or contained polygons return zero. Results
say `modeled footprint distance`; they are not geodesic distances and do not
establish a real-world clearance.

Both the result subject and anchor carry their existing uncertainty envelopes.
No uncertainty-propagation formula is documented, so derived distance
uncertainty is explicitly `unknown` rather than computed or shown as zero.

## Query criteria

The `/analysis` workbench composes these deterministic filters:

- subject kind: structure, aircraft, pavement, apron;
- declared evidence classification;
- presence or absence of direct observational support, including the existing
  measurement-to-runway evidence linkage;
- maximum stated horizontal uncertainty, with a separate choice to include
  subjects where that value is not stated;
- evidence snapshot and the distinct states established, not-yet-evidenced,
  and undated;
- maximum modeled footprint distance from a selected anchor.

Omitted criteria do not filter. An explicitly empty checkbox group matches
nothing. Invalid ids, dates, enums, non-finite numbers, negative thresholds,
and values beyond the site extent are dropped at the route boundary. The query
engine also validates its typed input and returns structured errors rather than
coercing it.

URL criteria are canonical and shareable. For example:

    /analysis?anchor=rwy-05-23&distance=500
    /analysis?kinds=structure,aircraft&support=without-direct-observation
    /analysis?uncertainty=0&includeUnknown=1
    /analysis?spatialDate=2025-09-13&presence=established

## Exports

Exports are generated from a successful query response, never by scraping the
table. Before emitting bytes, each serializer re-runs the query and requires
canonical equality of both criteria and results. Fabricated, stale, unsorted,
unclosed, or non-finite responses are refused.

- JSON uses schema `lop-nur-spatial-query/1.0.0` and the repository's canonical
  JSON serialization. It includes local and projected footprints.
- CSV uses CRLF records and RFC 4180 quoting. Unknown values are the literal
  `not stated`.
- GeoJSON is an RFC 7946 WGS84 FeatureCollection. A `lopNurTwin` foreign member
  carries the schema, original CRS, query, derivation, limitations, and current
  model hashes when the same-origin manifest is available.

Every format includes classification, confidence, sources, temporal presence,
modeled distance, subject uncertainty, anchor uncertainty, and the statement
that distance uncertainty is unknown.

Abbreviated examples:

```json
{
  "schemaVersion": "lop-nur-spatial-query/1.0.0",
  "query": { "anchorSubjectId": "rwy-05-23", "maximumDistanceM": 500 },
  "results": [
    { "subjectId": "tri-north", "modeledDistanceM": 0, "distanceUncertainty": "unknown" }
  ]
}
```

```csv
subject_id,label,kind,evidence_class,modeled_distance_m,distance_uncertainty
"tri-north","North graded strip","pavement","illustrative",0,"unknown"
```

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "tri-north",
      "geometry": { "type": "Polygon", "coordinates": "generated closed WGS84 ring" }
    }
  ]
}
```

The GeoJSON fragment above is structural shorthand, not a valid standalone
feature; actual exports contain closed counterclockwise rings with five
positions and complete provenance properties.

## Reproduction

1. Check out the commit or deployment identified by the geometry and evidence
   hashes in the export.
2. Run `bun install --frozen-lockfile` and `bun run build`.
3. Open `/analysis` with the exported query criteria.
4. Export the same format and compare bytes.

`generatedAt` is not part of a spatial query export. Given the same model,
query, and optional manifest identity, the output is byte-identical.

## Limits

- Results describe modeled geometry, not observed activity or official site
  records.
- Unknown historical states remain unknown; undated is not absent.
- Terrain slope, elevation, occlusion, and line-of-sight analysis are excluded
  because the terrain is procedural.
- No spatial index is necessary for the current 68-subject catalog. Add one
  only after profiling a larger dataset.
- GeoJSON interoperability does not improve the accuracy of its source model.
