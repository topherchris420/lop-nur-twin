# Data provenance

Every analytical claim in this model is attached to a source, a classification,
a confidence rank and — where the project has one — a stated uncertainty. This
document explains how that machinery works, what it deliberately refuses to
assert, and how to reproduce a release.

The governing rule is short: **an interpretation is never published as an
observation, and an unknown value is marked unknown rather than estimated.**

## 1. Registering a source

Public sources live in exactly one place: `PUBLIC_SOURCES` in
`src/lib/siteData.ts`. A source record carries an id, title, publisher,
publication date (optional — some sources genuinely have none), the date this
project last accessed it, an HTTPS URL, an optional direct data-query URL, a
role (`imagery`, `terrain`, `climate`, `reporting`, `analysis`, `telemetry`)
and an attribution string that states what the source supports **and what it
does not**.

`scripts/validate-data.ts` fails the build if a source has a duplicate id, a
missing title, publisher, access date or attribution, or a URL that is not
parseable HTTPS.

There is one non-public "source": `model-internal-definition`. It labels claims
that originate in this repository — illustrative scenery, deterministic motion,
derived scenario geometry. Naming the model as the source of its own procedural
content is honest; inventing a citation for it would not be. The validator
forbids an `observed` or `reported` record from citing it.

## 2. Classifying a claim

Four classifications, defined once in `src/lib/evidence.ts` and used verbatim
everywhere:

| Classification | Means                                                                     | Published statement                   |
| :------------- | :------------------------------------------------------------------------ | :------------------------------------ |
| `observed`     | Visible in the cited public imagery                                       | "Observed in cited public imagery"    |
| `reported`     | A cited publication states it exists                                      | "Reported by cited publication"       |
| `interpreted`  | This project assigned an identity, dimension or function no source states | "Interpreted from available evidence" |
| `illustrative` | Modeled scenery or motion, not resolved in any source                     | "Illustrative simulation element"     |

Visibility establishes presence and rough extent — never function, interior use
or occupancy. Reporting establishes that something exists; its placement,
dimensions and purpose in this model remain interpretation.

The build fails when a classification is misapplied:

- an illustrative subject carrying a non-illustrative record;
- an interpreted subject carrying an observed record;
- a simulation subject not classified illustrative;
- an `observed` or `reported` record with no source URL or no register entry;
- wording on an interpreted or illustrative record that asserts verification
  ("is verified", "confirmed", "authoritative") without a negation.

`scripts/test-evidence-validation.ts` feeds twenty deliberately broken records
through the validator and asserts each rule fires.

## 3. Recording confidence

The upstream data records ordinal judgements — low, medium, high. The schema
publishes a number in `[0, 1]`. One documented mapping bridges them:

```ts
CONFIDENCE_SCALE = { low: 0.3, medium: 0.55, high: 0.8 };
```

Those three values are the only numeric confidences the ledger emits. The
manifest and both UIs restate what that means:

> Confidence is a project-assigned ordinal rank published on a 0–1 scale. It
> ranks how well a claim is supported by its cited source; it is **not** a
> measured probability or a statistical estimate.

Confidence is always shown as a number _and_ a rank ("0.55 (medium)"), never as
a colour or a bar on its own.

## 4. Representing uncertainty

Three distinct things are kept distinct, because conflating them is how a
model starts overstating itself:

| Field                     | Meaning                                                          | Populated when                                                                                                                     |
| :------------------------ | :--------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `measurementUncertaintyM` | Stated positional uncertainty of a measurement                   | Only where this project documents a figure — currently ±40 m on the modeled runway endpoints and the coordinates derived from them |
| `sourceResolutionM`       | Ground sample distance of the cited imagery                      | Where the source states one — 10 m for Sentinel-2                                                                                  |
| `analystNotes`            | Prose caveats: method, what the number does and does not support | Wherever the upstream evidence carries them                                                                                        |

A structure interpreted from 10 m imagery records the 10 m resolution and does
**not** invent a positional uncertainty from it. Where a value is unknown, the
field is omitted and the UI prints "unknown" or "not stated" rather than a
plausible-looking number.

Unsupported coordinate reference systems fail validation. Two are allowed:
`EPSG:32645` (WGS 84 / UTM zone 45N — the projected frame every modeled metre
is registered to) and `EPSG:4326` for published geographic references. A record
classified as a measurement must declare one.

## 5. Building the ledger

`src/lib/evidence.ts` **derives** the ledger; nothing in it is hand-maintained.
One record is emitted per (subject, cited source) pair for:

- every structure and parked aircraft (classification and confidence copied
  from the layout's evidence block, source metadata resolved from the register);
- every pavement record — runway, strips, taxiways, streets, roads, aprons;
- the runway length, grid bearing and site reference coordinate, as explicit
  measurement subjects carrying their documented uncertainty;
- the terrain datum and the monthly climatology;
- site-level context and the offsite Northern Tunnel Test Area;
- every illustrative simulation element, sourced to the model itself.

Record ids are deterministic (`ev-<subject>-<source>`) and the ledger is sorted
by id, so two builds of the same commit produce the same ledger in the same
order. Subject ids must resolve in the subject registry — the mission-entity
catalog plus offsite context plus the measurement subjects — and geometry-backed
subjects must additionally exist in the layout, so a record cannot outlive the
thing it describes.

The current ledger holds **129 records across 11 public sources** covering 45
structures.

## 6. Updating a source

1. Edit the entry in `PUBLIC_SOURCES` — including `accessedOn`, which records
   when a human last looked at it.
2. Update whatever claims changed in `src/lib/layout.ts`. If a claim is now
   better supported, change its classification; if it is now contradicted,
   change or remove it.
3. Run `npm run validate:data` and `npm run test:evidence`.
4. Run `npm run manifest`. The `evidenceLedgerHash` changes; that is the
   audit trail.
5. Commit both the data change and the reason in the message. A source update
   is a reviewable code change, never a silent live dependency.

When a claim is genuinely superseded rather than corrected, the schema's
`supersedes` field records the replaced record id, and the validator requires it
to name a record that exists.

## 7. Hashes, and what is not hashed

`scripts/generate-manifest.ts` computes two SHA-256 digests with Node's
standard `node:crypto`:

- **`geometryHash`** over segments, aprons, structures, flatten pads, the site
  extent and the CRS registration — position, rotation, size, observed date,
  evidence status and cited sources. Presentation-only fields (descriptions,
  labels) are excluded, so a wording fix does not read as a geometry change.
- **`evidenceLedgerHash`** over the full ledger.

Both inputs are canonicalised first: object keys sorted recursively,
`undefined` dropped, arrays kept in declared order, serialised as compact UTF-8
JSON. Non-finite numbers throw rather than hash. No path, username, environment
variable or machine detail is read or emitted.

**No source content hash is recorded.** The build fetches nothing, so there is
no retrieved artifact to hash, and fabricating a digest would be worse than
having none. The `sourceHash` field exists in the schema for a future ingestion
pipeline that pins downloaded files; until then it is absent, and the validator
rejects any value that is not a real `sha256:<64 hex>` digest.

## 8. Reproducing a release

```sh
git checkout <commit>
npm ci                                   # or: bun install --frozen-lockfile
SOURCE_DATE_EPOCH=1700000000 npm run manifest
sha256sum public/model-manifest.json
```

With `SOURCE_DATE_EPOCH` set, the manifest is byte-for-byte reproducible —
verified here across both runtimes: Bun 1.3.11 and Node 22.22 produce identical
files. Without it, only `generatedAt` differs; `geometryHash` and
`evidenceLedgerHash` are pure functions of the committed data.

To check a deployment against a commit, compare the hashes in its
`/model-manifest.json` (downloadable from the research panel and from
`/analysis`) with the hashes a local `npm run manifest` produces.

## 9. What is interpreted or illustrative

Stated plainly, and shipped inside the manifest as `knownLimitations`:

- **Terrain** is a seeded procedural proxy around an approximate ~981 m EGM2008
  datum sampled from Copernicus GLO-30. No DEM tile is redistributed, and the
  surface must not be used for survey-grade elevation, slope or sightline work.
- **Facility functions** are interpretations. "Assembly hangar", "operations
  block" and "crew accommodation" are model hypotheses. Public overhead imagery
  does not establish interiors, occupants or use.
- **Aircraft** identifications, dimensions and parking positions follow cited
  reporting; external shapes are massed from widely circulated photographs
  whose provenance cannot be verified.
- **Base-support systems** — power, water, sanitation, communications, sensors,
  security — are illustrative. None is resolved in the cited 10 m imagery.
- **All motion** — flight circuit, patrol vehicles, radar rotation, windsock,
  day/night cycle — is illustrative scenario content, not observed operations.
- **Climate** values are 2001–2020 monthly means for a model grid cell, not
  local observations or event-time weather.
- **Blacksite** at `/play` is an illustrative interactive demonstration on the
  same geometry. Nothing in it represents observed activity, capability or
  tactics.
