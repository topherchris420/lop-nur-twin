# Lop Nur Twin Base — white paper

The same document as [`white-paper.html`](white-paper.html), as text. It was
inlined in the root README until this release; it lives here so the README can
stay an entry point and this can stay a long-form argument.

[![Lop Nur Twin Base — White Paper](white-paper.png)](white-paper.html)

<details>
<summary><b>Read the white paper as text</b></summary>

<br>

<sup>**VERS3DYNAMICS** · R.A.I.N. LAB — IMMERSIVE DIGITAL TWIN</sup>

## Lop Nur Twin Base

**A 1:1 horizontal-scale, explorable reconstruction of a remote desert airfield near
Lop Nur — built from public Earth-observation data, cited open reporting, and
clearly labelled interpretation.**

|                       |                          |                        |                       |
| :-------------------- | :----------------------- | :--------------------- | :-------------------- |
| **40.77°N**           | **~5 km**                | **6.8 km**             | **Public OSINT**      |
| 89.28°E · approximate | Runway 05/23 · 16,400 ft | Local simulation frame | Cited, offline inputs |

![Aerial overview — the triangular airfield in empty desert, with the compound on the south side of the paved runway](screenshot-overview.png)

<sup>**Fig. 1 — Aerial overview.** The triangular airfield in empty desert, with the compound on the south side of the paved runway. This is a procedural render of a layout interpreted from public Earth-observation data, not satellite imagery.</sup>

### 01 · A map, not an answer

The airfield near Lop Nur sits alone in the Xinjiang Gobi. Open reporting has
associated it with [likely reusable-spacecraft landings](https://www.swfound.org/publications-and-reports/chinese-reusable-experimental-spacecraft-fact-sheet)
and [2025 sightings of aircraft commonly called the J-36 and J-XDS](https://www.twz.com/air/chinas-6th-generation-stealth-fighters-both-appear-at-secretive-test-base).
Those are reported associations, not conclusions produced by this twin. The
place is too large to grasp from a single overhead frame, which makes a
spatially consistent model useful even when many labels remain uncertain.

This reconstruction does not claim to reveal what happens there. Its value is
different, and in some ways more useful: it turns scattered pixels into a space
you can _move through_. Walk the flight line, stand under the assembly hangar
door, follow the spur taxiway to the apron — and the questions you didn't know
to ask begin to surface on their own.

The twin is best understood as a structured instrument for discovery. Every
building, road and runway leg is a projection of one source-of-truth layout, so
the model is falsifiable: measure it, disagree with it, correct it. That is the
point. It is a foundation others are meant to build upon — not a verdict, but a
shared frame of reference for a place that has never had one.

### 02 · Inside the wire — the site anatomy

The 6.8 × 6.8 km airfield frame is driven by a single layout file. Add a
structure there and it appears in the world, the minimap, and the site index at
once. What follows is the current census of what has been represented.

| Zone                            | What's there                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The airfield**                | A single ~5 km pale-concrete runway (05/23, modeled grid bearing ~046°) with two ~5.5 km graded-earth strips completing the triangle out to a north-west apex.                                                                                                                                                                                                                                                                               |
| **The compound**                | Reached by a spur taxiway from mid-runway: three concrete aprons, paved internal streets, and dirt access tracks along the perimeter, now extended with frontage roads to the crew, south-east and fuel-area additions.                                                                                                                                                                                                                      |
| **Structures (43)**             | Public imagery informs footprints and roof forms for service and storage halls, a large assembly-hall interpretation, an arched shed, a tower, an operations block, and walled service courts. The 2025 build-out adds **reported** western fighter shelters, a north-east apron hangar, an expanded fuel farm and south-east construction, plus **interpreted** crew blocks. These names describe model hypotheses, not verified functions. |
| **Base support (illustrative)** | Power (photovoltaic field, switchyard), water (elevated tank), sanitation (wastewater plant), sensors (air-search radome, comms shelter) and security (perimeter towers, gate guardhouse) complete a base of this class. None is resolved in the cited 10 m imagery; all are labelled **illustrative**.                                                                                                                                      |
| **The flight line**             | Two parked models represent the J-36 and J-XDS aircraft reported in August and September 2025 imagery. Both are clickable and evidence-labelled; the separate animated flying-wing demonstrator is illustrative and not part of the structure catalog.                                                                                                                                                                                       |
| **Terrain**                     | 6.8 × 6.8 km of seeded, procedural dried-lakebed terrain. A nearby Copernicus GLO-30 sample supplies an approximate ~981 m EGM2008 elevation datum; the rendered relief is a proxy, not a DEM-derived surface.                                                                                                                                                                                                                               |
| **A living base**               | The flight circuit, radar-like prop, service vehicle, windsock, beacons and day/night cycle are illustrative systems that make scale and environmental conditions legible; they do not claim observed operations.                                                                                                                                                                                                                            |

![Structure dossier — click any building or aircraft for its details and a fly-to jump](screenshot-dossier.png)

<sup>**Fig. 2 — Structure dossier.** Click any building or aircraft for its details and a "fly to structure" jump.</sup>

### 03 · Methodology — from public evidence to 3D world

The pipeline is deliberately reproducible. Nothing here depends on classified
data, leaked plans, or private access. Public Earth-observation products,
published analysis and open reporting are cited according to the role each one
plays; interpretation and simulation are kept separate from source observations.

| Step   |                                |                                                                                                                                                                                                                                                                             |
| :----- | :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **01** | **Register public references** | Use Sentinel-2 as repeatable optical context, Copernicus GLO-30 as a coarse elevation reference, and cited reporting as event context. Approximate coordinates (40.77°N, 89.28°E), the ~5 km 05/23 runway and its modeled ~046° grid bearing anchor the 6.8 km local frame. |
| **02** | **Trace and classify**         | Encode visible runway, road and structure footprints once, in metric units, then label each claim as **observed**, **reported**, **interpreted**, or **illustrative**. A visible footprint does not establish a building's use.                                             |
| **03** | **Generate scenarios**         | A seeded procedural heightfield builds the plain; procedural geometry raises structures; embedded NASA POWER monthly climatology supplies broad regional weather scenarios. Neither source is presented as surveyed terrain or live site weather.                           |
| **04** | **Ship an offline snapshot**   | The browser makes no runtime imagery, DEM, reporting or climate requests. Source values and citations are reviewed ahead of release, then the self-contained scene and minimap render from the same deterministic layout.                                                   |

> **Determinism is the guarantee.** Noise is seeded, textures are generated
> locally, and structures are placed from one metric layout, so the same inputs
> produce the same world. Determinism makes the model auditable; it does not turn
> an interpretation into an observation.

**Geographic boundary.** The Northern Tunnel Test Area is not part of this
airfield frame. Published coordinates place it about 127 km away; it is retained
only as offsite context and no tunnel portals or support facilities are rendered.

**Terrain and climate boundary.** A nearby Copernicus GLO-30 sample is about
981 m above the EGM2008 geoid. It is a reference datum only: the current
heightfield is a procedural proxy, not a redistributed GLO-30 tile, and must not
be used for survey-grade elevation, slope or sightline analysis. NASA POWER
2001–2020 monthly means are coarse regional scenario inputs, not a local weather
station, forecast or record of conditions during any reported event.

### 04 · Who it's for

- **For OSINT researchers** — A measurable, walkable frame of reference. Compare
  the twin against fresh imagery, test spatial hypotheses about sightlines and
  dimensions, and cite a shared model instead of describing pixels in prose. The
  minimap ruler (`M`) reads distances and grid bearings straight off the model —
  clicks snap to modeled runway, strip and compound vertices, and the reading
  copies out as public EPSG:32645 coordinates.
- **For game developers** — A production-grade, real-world level: procedural
  terrain and structures, adaptive quality that sheds effects under load, and a
  clean layout-driven data model to fork, restyle, or drop straight into a scene.
- **For VR / XR enthusiasts** — An immersive place to be. First-person walk,
  free-fly orbit, and a cinematic flythrough turn a remote coordinate into
  somewhere you can stand — the sense of scale that no flat map delivers.

**How to explore**

| Key             | Action                                                                                                     |
| :-------------- | :--------------------------------------------------------------------------------------------------------- |
| `1` / `2` / `3` | Free-fly orbit · first-person walk (WASD, Shift sprints) · cinematic flythrough                            |
| `N`             | Toggle day / night                                                                                         |
| `I` / `H`       | Site index (grouped outliner) · help overlay                                                               |
| `M`             | Measure distances and grid bearings on the minimap (clicks snap to modeled vertices; copy the reading out) |
| `Click`         | Open a structure's dossier and fly to it · click the minimap to jump the orbit camera                      |

On phones and tablets, orbit responds to one-finger drag, pinch-zoom and
two-finger pan; first-person mode shows on-screen thumb-stick and look controls.

### 05 · Ethics & sourcing

- **Public, attributable inputs.** The reconstruction uses openly accessible
  Earth-observation products, public analysis and cited reporting. It uses no
  classified material, leaked plans or private access. Sentinel-2 is one input,
  not a sole or structure-resolving source.
- **Evidence status, clearly labelled.** **Observed** means visible in cited
  public imagery; **reported** means stated by a cited publisher; **interpreted**
  means the model assigns a dimension, identity or function; **illustrative**
  means procedural scenery, vehicles, aircraft detail, animation or atmosphere.
  These labels do not imply certainty beyond their stated source.
- **Separate sites stay separate.** The Northern Tunnel Test Area is roughly
  127 km from the airfield reference point and is not rendered in the 6.8 km
  scene. [CSIS found no significant visible change](https://nuclearnetwork.csis.org/satellite-imagery-analysis-of-chinas-alleged-2020-nuclear-test-at-lop-nur/)
  between its March 26 and June 25, 2020 comparison images and described the
  open-source evidence as inconclusive; this project does not infer tunnel
  activity or facility functions from that analysis.
- **Offline by design.** The deployed simulator does not fetch imagery, DEM,
  climate or reporting data at runtime. Updating a source is an explicit,
  reviewable data change rather than a hidden live dependency.
- **A model, not a target.** This is a scaled analytical reconstruction for
  research, education and creative work. It is not operational intelligence and
  confers no capability that public imagery does not already provide.
- **Correctable by design.** Because every element is a projection of one
  documented layout, errors are visible and fixable in the open. Disagreement is a
  feature: the honest response to a wrong wall is a pull request, not a footnote.

### Public-data ledger

| Source                                                                                                                                                                                                                                                                                                                         | Role in the twin                                                                                                                                                                                                                   | Important limit                                                                                                                         |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| [Sentinel-2 L2A scene T45TXF, 2025-09-28](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-l2a/items/S2A_MSIL2A_20250928T050231_N0511_R119_T45TXF_20250928T074723)                                                                                                                                               | The pinned public scene used to measure the runway and interpret the current footprint layout.                                                                                                                                     | The 10 m imagery supports site-scale measurement, not detailed interior or function claims; modeled endpoints retain ~40 m uncertainty. |
| [ESA Sentinel-2 User Handbook](https://sentinels.copernicus.eu/documents/247904/685211/Sentinel-2_User_Handbook)                                                                                                                                                                                                               | Repeatable multispectral optical context and registration conventions.                                                                                                                                                             | Native bands are 10, 20 or 60 m; Sentinel-2 alone cannot verify detailed building functions.                                            |
| [Copernicus DEM GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)                                                                                                                                                                        | An approximate sample near the public runway-center coordinate (~981 m, EGM2008; sampled 2026-07-19) anchors local altitude.                                                                                                       | The link identifies the collection rather than a pinned tile. The rendered relief is procedural and no DEM tile is redistributed.       |
| [NASA POWER climatology API](https://power.larc.nasa.gov/docs/services/api/temporal/climatology/) · [embedded point query](https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M%2CWS10M%2CPRECTOTCORR%2CALLSKY_SFC_SW_DWN%2CRH2M%2CWD10M&community=RE&longitude=89.281218&latitude=40.772521&format=JSON) | Monthly 2001–2020 temperature, humidity, precipitation, solar and wind means shape regional scenarios.                                                                                                                             | Modelled grid climatology, not local observations, a forecast or event-time weather.                                                    |
| [The War Zone, 2025](https://www.twz.com/air/chinas-6th-generation-stealth-fighters-both-appear-at-secretive-test-base)                                                                                                                                                                                                        | Public reporting for the J-36 and J-XDS sightings, the runway-length context, and the mid-2025 build-out (western fighter shelters, a >300 ft main hangar, expanded fuel storage, new utility buildings, south-east construction). | A secondary report; aircraft labels, facility functions and dimensions remain attributed reporting.                                     |
| [National Security Journal, 2025](https://nationalsecurityjournal.org/new-stealth-j-36-and-j-xds-fighters-might-be-undergoing-testing-at-chinas-area-51/)                                                                                                                                                                      | Corroborates the >16,400 ft runway, three western fighter-sized hangars, the large main hangar, and expanded fuel/utility/taxiway construction from commercial imagery.                                                            | A secondary report; identities and dimensions remain attributed reporting, not official records.                                        |
| [Secure World Foundation, 2026](https://www.swfound.org/publications-and-reports/chinese-reusable-experimental-spacecraft-fact-sheet)                                                                                                                                                                                          | Context for likely reusable experimental spacecraft landings.                                                                                                                                                                      | "Likely" is retained; the simulator does not independently verify a landing.                                                            |
| [CSIS PONI, 2026](https://nuclearnetwork.csis.org/satellite-imagery-analysis-of-chinas-alleged-2020-nuclear-test-at-lop-nur/) · [published tunnel-area coordinates](https://doi.org/10.1080/10736700.2025.2497201)                                                                                                             | Offsite context and the ~127 km separation from the airfield.                                                                                                                                                                      | The tunnel area is not rendered; CSIS's 2020 comparison was inconclusive and found no significant visible change.                       |

Copernicus DEM attribution: © DLR e.V. 2010–2014 and © Airbus Defence and
Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.
Climate data attribution: NASA Langley Research Center POWER Project.

### 06 · A foundation to build on

The reconstruction is open source and designed to be extended. The single-source
layout means the world, the minimap and the site index stay in sync
automatically — so contribution is low-friction by construction.

- **Refine the layout** — Correct a footprint, add a newly-visible structure, or
  re-measure a strip against fresh imagery — one file, and it propagates
  everywhere.
- **Fork for your medium** — Restyle it as a game level, export it for a VR
  headset, or substitute reviewed public datasets while keeping the runtime
  self-contained and non-operational.
- **Extend the dossiers** — Attach sourced annotations, measurements and
  citations to each structure so the twin doubles as a shared evidence base.
- **Reproduce the method** — Apply the same imagery-to-world pipeline to another
  site. The value compounds the moment a second reconstruction exists.

> ### The most valuable map is the one other people keep redrawing.
>
> _Explore it · Fork it · Correct it_
>
> **Live demo** — [lop-nur-twin.vercel.app](https://lop-nur-twin.vercel.app/) ·
> **Source** — [github.com/topherchris420/lop-nur-twin](https://github.com/topherchris420/lop-nur-twin) ·
> **Studio** — [vers3dynamics.com](https://vers3dynamics.com/)
>
> Created by Christopher Woodyard / Vers3Dynamics. Built from public data and
> cited open reporting, with procedural interpretation clearly separated from
> source observations. Special thanks to Kimi K3 Max.

</details>
