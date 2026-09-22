# Lop Nur Twin

An unclassified, public-source reconstruction of a remote desert airfield near
Lop Nur (~40.77° N, 89.28° E). The analytical model is the product. Every claim
in it carries an evidence classification, an uncertainty envelope, and a
citation. `/play` is a separate first-person simulation on the same geometry,
and it is not evidence.

> **Public sources only. Not operational data.** This is a modeled
> reconstruction built from cited open Earth-observation products and published
> reporting. It is not an official facility record, an aeronautical chart, or a
> verified statement of any building's interior use. It is **not
> government-certified, not FedRAMP authorized, not CMMC certified, and not
> approved for classified or Controlled Unclassified Information.** See
> [`docs/GOVERNMENT_EVALUATION.md`](docs/GOVERNMENT_EVALUATION.md).

**Live demo:** <https://lop-nur-twin.vercel.app/>

## Contents

- [Run it](#run-it)
- [Blacksite](#blacksite)
- [Routes](#routes)
- [The model](#the-model)
- [Uncertainty and time](#uncertainty-and-time)
- [Code map](#code-map)
- [Checks](#checks)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)
- [License](#license)

## Run it

### Prerequisites

- [Bun](https://bun.sh), or Node.js **22.18+**
- A browser with WebGL for `/` and `/play`. `/analysis` and `/compare` do not
  need WebGL.

### Install and run

```sh
bun install
bun run dev      # dev server on :5173; regenerates the manifest first
bun run build    # validate → manifest → production build → strict typecheck
bun run preview  # serve the production build on :4173
```

`npm install && npm run dev` works on Node.js 22.18 or newer. The TypeScript
build scripts run under Bun natively, or under Node through
`scripts/run-ts.mjs`, and both produce byte-identical manifests.

Before a pull request:

```sh
bun run check
```

That runs formatting, lint, unit tests, the evidence-rule tests, and the
production build. Narrower commands are listed under [Checks](#checks).

## Blacksite

`/play` is **Blacksite**, an illustrative first-person match on the
reconstructed airfield. The weapons, the soldiers, and the engagement are
invented. A note on the route says so, outside the game HUD, because the HUD
comes and goes and the note must not. The simulation reads the layout and
writes nothing back to the evidence ledger.

These four frames are from a local run of this tree (`/play`, quality tier 2).

![Blacksite title screen: the word Blacksite, the line Lop Nur · First-Person Engagement Simulator, and Press any key to continue.](docs/screenshots/title.png)

The boot screen. Any key opens the menu.

![Blacksite main menu over a darkened view of the airfield, with Team Deathmatch, Domination, Free-for-All and Hardpoint, plus Deploy, Loadout, and Return to Digital Twin.](docs/screenshots/menu.png)

The menu: mode, opposition, difficulty, loadout, and a way back to the twin.

![First-person match on the apron: a rifle in the lower right, another soldier ahead, hangar walls to the right, and the combat HUD (compass, health, ammunition, minimap).](docs/screenshots/gameplay.png)

In a match. The rifle, the HUD, and the other soldier belong to the simulation,
not to the analytical model.

![A procedural soldier at a few metres on the apron, helmet and vest on, rifle held across the body, with the match compass and minimap still on screen.](docs/screenshots/character.png)

A soldier at a few metres. Characters are built in code. There is no imported
character mesh.

Controls, modes, and the boundary with the analysis:
[`docs/BLACKSITE.md`](docs/BLACKSITE.md).

## Routes

| Route           | What it is                                                                                                                                        |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`/`**         | The analytical twin. Orbit it, walk it, open a structure's sourced dossier, measure distances and grid bearings, and filter by evidence mode.     |
| **`/analysis`** | The same model without the 3D scene. An equal front door, not a fallback: the analytical capabilities in a semantic, screen-reader-friendly form. |
| **`/compare`**  | Diff two release manifests. A reworded description is not the same event as a moved footprint.                                                    |
| **`/play`**     | Blacksite. Optional, illustrative, and labelled as such. It contributes nothing to an analytical conclusion.                                      |

`/` and `/analysis` are the research product. `/compare` checks what a build
changed. `/play` is a way to cross the same geometry on foot.

![Aerial overview — the compound on the south side of the runway](docs/screenshot-overview.png)

![Structure dossier — every claim with its source, uncertainty and temporal evidence](docs/screenshot-dossier.png)

## The model

The layout and the source register are the inputs. The evidence ledger and the
release manifest are generated from them. A claim cannot outlive the thing it
describes, because nothing in the ledger is written by hand.

- **Evidence modes.** Four nested thresholds, applied by the scene, the
  minimap, the structure index, the dossier, the measurement ruler, and
  `/analysis`.
- **Structured uncertainty.** A machine-readable envelope per claim. A number
  appears only where this project documents one.
- **Time.** Read the model at a date, and diff two dates.
- **Measurement.** Snap to modeled vertices. Distances and grid bearings are in
  EPSG:32645. A measurement can be copied out as plain text with its citation.
- **Spatial queries.** Filter stable footprints by evidence, source support,
  uncertainty, temporal presence, and edge-to-edge proximity. Export canonical
  JSON, CSV, or WGS84 GeoJSON.
- **Release manifest.** SHA-256 over canonical model data, per-subject digests,
  and an explicit list of what the model does not know.
- **Local bookmarks.** A saved view that records the hashes of the model it was
  taken against.

The site model is procedural and deterministic. There are no binary art assets
and no analytics. By default the analytical view's only network request is its
own manifest, fetched from the origin that served the page. `?liveTraffic=1`
opts into an ADS-B poll of the public ADSB.lol feed. That request is off unless
the flag is set: the upstream response does not currently send browser CORS
headers, so the default page does not call it.

### Classifications

Shown everywhere as a symbol and a word, never by colour alone.

|     | Status           | Means                                                                                      |
| :-- | :--------------- | :----------------------------------------------------------------------------------------- |
| ◆   | **Observed**     | Visible in the cited public imagery. Presence and extent — never function or interior use. |
| ■   | **Reported**     | A cited publication states it exists. Placement and dimensions here are still modeled.     |
| ▲   | **Interpreted**  | This project assigned an identity, dimension, or function no source states.                |
| ○   | **Illustrative** | Modeled scenery or motion, not resolved in any source.                                     |

An evidence mode is a threshold. Each mode adds one weaker class:

| Mode                    | Draws                                                                          |
| :---------------------- | :----------------------------------------------------------------------------- |
| **Observed only**       | Only what a cited scene shows directly, plus the measurements taken from it.   |
| **Observed + reported** | Adds features a cited publication states are there.                            |
| **+ interpreted**       | Adds identities, functions, and dimensions this project assigned.              |
| **Full simulation**     | The complete reconstruction, including illustrative infrastructure and motion. |

Observed mode currently draws **one** of the model's 68 filterable subjects.
That count is the point: it is how much of the reconstruction is directly
visible in a cited scene. Terrain and atmosphere are never filtered. They are
the canvas, and they carry their own classification wherever it is published.

## Uncertainty and time

**Unknown stays unknown.** An absent figure is printed as "not stated", never
as zero and never as a missing row. Height and orientation tolerances are
absent from every envelope because no cited source states one.

A number is only allowed from three places, and every envelope names which:
stated by the cited source, documented by this project (the ±40 m runway
endpoint uncertainty), or a resolution floor derived from the cited scene's
ground sample distance. The build fails on a number with no method, no basis, a
reversed date range, or an `observed` claim that bounds no position at all.

Three dates stay separate. Collapsing them is how a publication date becomes a
construction date:

1. **When something happened at the site.** Almost never known. A first
   appearance bounds when a building existed _by_, so the interface says
   "existed by 2025-09-13; earliest date unknown".
2. **When the evidence became public.** This is the date that decides what an
   analyst could have concluded at a given moment.
3. **When the change entered this model.** A fact about this repository. The
   model does not currently record it, and says so.

Method: [`docs/UNCERTAINTY_MODEL.md`](docs/UNCERTAINTY_MODEL.md) and
[`docs/TEMPORAL_MODEL.md`](docs/TEMPORAL_MODEL.md).

## Code map

```text
src/lib/           layout, evidence, parameters, validation
src/components/    3D scene and the analytical route UI
src/game/          the /play simulation (physics, characters, weapons, HUD)
src/gfx/           procedural hard-surface shading and the post stack
scripts/           data validation and the release manifest
tools/             browser, accessibility, and simulation checks
docs/              methods, provenance, architecture, operations
experiments/       unfinished work, outside src/ and outside the typecheck
```

Do not hard-code coordinates in a component. Placement comes from
`src/lib/layout.ts`. Sources, the local CRS, and climatology come from
`src/lib/siteData.ts`. URL parameters go through `src/lib/params.ts`.

## Checks

```sh
bun run check         # format:check → lint → test:run → test:evidence → build
bun run test:run      # unit tests over the deterministic modules
bun run test:evidence # all 35 evidence-validator rules still fire
bun run validate:data # sources, geometry, bounds, geodesy, evidence ledger
bun run a11y          # axe-core + CSP, against the preview build
bun run routes        # deep links, hostile parameters, keyboard, mobile
bun run smoke         # Blacksite simulation checks
bun run gait          # walk-cycle checks
bun run audio         # each sound, rendered offline, peak and crest factor
```

`bun run build` is the integration gate. What each check does and does not
prove: [`docs/VALIDATION.md`](docs/VALIDATION.md).

`bun run a11y` and `bun run routes` need the preview server (`bun run build &&
bun run preview`), because they test the artifact that ships, including its
security headers.

## Documentation

| Document                                                         | What it covers                                                                    |
| :--------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                             | Setup, the rules a change has to hold to, and what a pull request needs           |
| [`docs/VALIDATION.md`](docs/VALIDATION.md)                       | Every check, what it proves, and the repository settings code cannot configure    |
| [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md)             | Source registration, classification, confidence, hashing, reproducing a release   |
| [`docs/SPATIAL_ANALYSIS.md`](docs/SPATIAL_ANALYSIS.md)           | Footprint derivation, spatial queries, distance semantics, interoperable exports  |
| [`docs/UNCERTAINTY_MODEL.md`](docs/UNCERTAINTY_MODEL.md)         | The envelope schema, where a number may come from, and what the build refuses     |
| [`docs/TEMPORAL_MODEL.md`](docs/TEMPORAL_MODEL.md)               | The three dates, the event ledger, snapshots, and change comparison               |
| [`docs/MODEL_COMPARISON.md`](docs/MODEL_COMPARISON.md)           | Manifest schema 1.1, the four per-subject hashes, and what a diff cannot see      |
| [`docs/SITE_MODEL.md`](docs/SITE_MODEL.md)                       | What the reconstruction contains and how it is put together                       |
| [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md)     | Frontend, scene, routes, stores, validation pipeline, build, and trust boundaries |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md)                 | What is implemented, what the axe run covers, and the manual checks that remain   |
| [`docs/CONTROLS.md`](docs/CONTROLS.md)                           | Keyboard, pointer, and URL parameters for every route                             |
| [`docs/BLACKSITE.md`](docs/BLACKSITE.md)                         | The optional simulation, and the wall between it and the analysis                 |
| [`SECURITY.md`](SECURITY.md)                                     | Supported versions, vulnerability reporting, and the limits of a browser demo     |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)                   | Assets, trust boundaries, threats, and residual risk                              |
| [`docs/GOVERNMENT_EVALUATION.md`](docs/GOVERNMENT_EVALUATION.md) | What this is, what it is not, and a 30-minute evaluation path                     |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                       | Vercel settings, the container image, and verifying a deployment matches a commit |
| [`docs/FUTURE_BACKEND.md`](docs/FUTURE_BACKEND.md)               | PostGIS, STAC, OIDC, and audit logging — implemented, scaffolded, and not         |
| [`docs/WHITE_PAPER.md`](docs/WHITE_PAPER.md)                     | The long-form argument, also as [HTML](docs/white-paper.html)                     |
| [`AGENTS.md`](AGENTS.md)                                         | Extending the twin: house rules and recipes                                       |
| [`experiments/README.md`](experiments/README.md)                 | Unfinished subsystems kept outside `src/`, and why                                |

## Known limitations

The authoritative list is `KNOWN_LIMITATIONS` in `src/lib/evidence.ts`, published
in the release manifest and rendered on `/analysis`. In summary:

- **It is a reconstruction.** Facility functions are interpretations. Names such
  as "assembly hangar" and "operations block" are model hypotheses. Public
  overhead imagery does not establish interiors, occupants, or use.
- **Terrain is a seeded procedural proxy** around an approximate ~981 m EGM2008
  datum. No DEM tile is redistributed. The surface must not be used for
  survey-grade elevation, slope, or sightline analysis.
- **Modeled runway endpoints carry roughly 40 m of uncertainty.** The 10 m
  source imagery supports site-scale measurement, not detailed interior or
  function claims.
- **Base-support systems are illustrative.** Power, water, sanitation,
  communications, sensors, and security are not resolved in the cited imagery.
- **Confidence values are project-assigned ordinal ranks** on a 0–1 scale, not
  measured probabilities.
- **No source artifact is retrieved at build time**, so no source content hashes
  are recorded. Provenance is pinned by citation, access date, and reviewed
  data change.
- **Temporal coverage is partial.** Five of the ten event categories the schema
  defines hold no evidence, and `/analysis` shows the gaps rather than filling
  them.
- **Deferred from this release:** local reference-image registration, GeoTIFF
  processing, automated imagery-difference detection, relationship-graph
  visualisation, a report builder, PDF generation, and a spatial ghost of an
  earlier state in 3D. Temporal comparison is complete semantically on
  `/analysis`. Only its 3D rendering is absent.

## License

The original source code, procedural models, and original documentation in this
repository are licensed under the **Apache License 2.0** — see
[`LICENSE`](LICENSE).

That grant covers this repository's own work and nothing else.
[`NOTICE`](NOTICE) states the boundary: cited satellite imagery, digital
elevation models, climate products, journalism, and academic publications are
**referenced, not relicensed**, and no provider data file is redistributed here.
Product names, aircraft designations, and organisation names are used
descriptively. Apache-2.0 section 6 grants no trademark licence, including for
the Vers3Dynamics name and branding.

Attribution required by cited providers — Copernicus, ESA, DLR, Airbus Defence
and Space, and NASA POWER — is reproduced in `NOTICE`. The machine-readable
register is `src/lib/siteData.ts`.
