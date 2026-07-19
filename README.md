# Lop Nur Base — Digital Twin

> An immersive 3D experience of China's most secretive desert airfield — the Lop Nur test base (~40.77° N, 89.28° E) in the Xinjiang Gobi, rebuilt to scale from public Sentinel-2 satellite imagery. Often called "China's Area 51," this remote airstrip has been linked to reusable-spaceplane landings and, more recently, sightings of next-generation stealth fighters.

**What's inside the wire:** A giant triangular airfield in empty desert. A single ~5 km (16,400+ ft) paved concrete runway (05/23, aligned ~046°/226°) forms one leg; two ~5.5 km graded-earth strips run out to a north-west apex, completing the triangle and overshooting the corners just like the real gradings. A spur taxiway drops south-east from mid-runway to the compound: an expanded concrete apron lined with the big white assembly hangar, three joined fighter shelters, a newer north-east hangar, fuel farm, control tower, operations block, walled yards, switchyard, a detached support camp and perimeter sensors. On the apron, the J-36 and J-XDS demonstrators and a flying-wing UCAV — each clickable for a dossier.

![Aerial overview — the compound on the south side of the runway](docs/screenshot-overview.png)

![Structure dossier — click any building for details](docs/screenshot-dossier.png)

## white paper

[![Lop Nur Twin Base — White Paper](docs/white-paper.png)](docs/white-paper.html)

<details>
<summary><b>Read the white paper as text</b></summary>

<br>

<sup>**VERS3DYNAMICS** · R.A.I.N. LAB — IMMERSIVE DIGITAL TWIN</sup>

## Lop Nur Twin Base

**A full-scale, explorable 3D reconstruction of one of China's most remote and
secretive desert airfields — built entirely from publicly available satellite
imagery.**

|  |  |  |  |
| :-- | :-- | :-- | :-- |
| **40.77°N** | **~5 km** | **~25** | **Sentinel-2** |
| 89.28°E · Xinjiang Gobi | Runway 05/23 · 16,400 ft | Procedural structures | Sole source imagery |

![Aerial overview — the triangular airfield in empty desert, with the compound on the south side of the paved runway](docs/screenshot-overview.png)

<sup>**Fig. 1 — Aerial overview.** The triangular airfield in empty desert, with the compound on the south side of the paved runway. Rendered in the digital twin; imagery reconstructed from public Sentinel-2 tiles.</sup>

### 01 · A map, not an answer

The Lop Nur test base — often called "China's Area 51" — sits alone in the
Xinjiang Gobi, a giant triangular airfield linked to reusable-spaceplane
landings and, more recently, sightings of next-generation stealth fighters. It
is exactly the kind of place that resists understanding: too remote to visit,
too controlled to photograph, too large to grasp from a single overhead frame.

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

The whole site is scaled from the source imagery and driven by a single layout
file. Add a structure there and it appears in the world, the minimap, and the
site index at once. What follows is the current census of what has been rebuilt.

| Zone | What's there |
| :-- | :-- |
| **The airfield** | A single ~5 km pale-concrete runway (05/23, azimuth ~046°) — among the longest in the world — with two ~5.5 km graded-earth strips completing the triangle out to a north-west apex, overshooting the corners just like the real gradings. |
| **The compound** | Reached by a spur taxiway from mid-runway: an expanded concrete apron, paved internal streets, and dirt tracks out to the support camp and along the perimeter. |
| **Structures (~25)** | The dominant white assembly hangar (>90 m across), a three-bay fighter-shelter block, a newer NE hangar, control tower, operations block, fuel farm, high-voltage switchyard, water towers, gatehouse, a detached SW support camp, and perimeter radar and guard towers. |
| **The flight line** | Three parked aircraft matching 2025 sightings — the J-36 sixth-generation demonstrator, the J-XDS lambda-wing demonstrator, and a flying-wing UCAV. Each is clickable, with its own dossier and site-index entry. |
| **Terrain** | 6.8 × 6.8 km of seeded dried-lakebed gobi plain — desert-pavement gravel fields, pale playa, braided dry-wash channels, and automatic flattening under every runway, road and building pad. |
| **A living base** | A resident demonstrator flies the runway pattern; a surveillance radar turns on its mast; a guard vehicle runs the perimeter; a windsock reads the breeze; obstruction beacons wink on tall structures at night under a full day/night cycle. |

![Structure dossier — click any building or aircraft for its details and a fly-to jump](docs/screenshot-dossier.png)

<sup>**Fig. 2 — Structure dossier.** Click any building or aircraft for its details and a "fly to structure" jump.</sup>

### 03 · Methodology — from satellite tile to 3D world

The pipeline is deliberately reproducible. Nothing here depends on classified
data, leaked plans, or private access. Everything begins with imagery anyone can
pull, and every downstream artifact traces back to it.

| Step | | |
| :-- | :-- | :-- |
| **01** | **Acquire & register** | Pull public Sentinel-2 tiles over the site and geo-register them. The known coordinates (40.77°N, 89.28°E) and runway azimuth (~046°) anchor scale and orientation. |
| **02** | **Trace the layout** | Every runway, road, structure footprint and waypoint is measured off the imagery and encoded once, in metric units, in a single source-of-truth layout file. |
| **03** | **Generate the world** | A seeded heightfield builds the gobi plain; procedural geometry raises the structures; runtime canvas textures paint concrete, dirt, centerline dashes, 05/23 designators, piano keys and tire rubber. |
| **04** | **Animate & verify** | Atmosphere, a day/night cycle and a living base add legibility; the 3D scene and 2D minimap are both projections of the same layout, so any error is visible and correctable in one place. |

> **Determinism is the guarantee.** Noise is seeded, textures are generated at
> runtime, and structures are placed from measured coordinates — so the same
> inputs always produce the same world. There is nothing to hand-tune away from
> the evidence, which is what makes the model auditable.

### 04 · Who it's for

- **For OSINT researchers** — A measurable, walkable frame of reference. Compare
  the twin against fresh imagery, test spatial hypotheses about sightlines and
  dimensions, and cite a shared model instead of describing pixels in prose.
- **For game developers** — A production-grade, real-world level: procedural
  terrain and structures, adaptive quality that sheds effects under load, and a
  clean layout-driven data model to fork, restyle, or drop straight into a scene.
- **For VR / XR enthusiasts** — An immersive place to be. First-person walk,
  free-fly orbit, and a cinematic flythrough turn a remote coordinate into
  somewhere you can stand — the sense of scale that no flat map delivers.

**How to explore**

| Key | Action |
| :-- | :-- |
| `1` / `2` / `3` | Free-fly orbit · first-person walk (WASD, Shift sprints) · cinematic flythrough |
| `N` | Toggle day / night |
| `I` / `H` | Site index (grouped outliner) · help overlay |
| `Click` | Open a structure's dossier and fly to it · click the minimap to jump the orbit camera |

On phones and tablets, orbit responds to one-finger drag, pinch-zoom and
two-finger pan; first-person mode shows on-screen thumb-stick and look controls.

### 05 · Ethics & sourcing

- **Public imagery only.** The reconstruction is built exclusively from openly
  licensed Sentinel-2 satellite tiles. It uses no classified material, no leaked
  documents, and no private or restricted data. Anyone with an internet
  connection can obtain the same source and check the work.
- **Interpretation, clearly labelled.** Overhead imagery shows footprints and
  pavement, not interiors or intent. Structure identities, aircraft types and
  functional labels are informed inferences drawn from open reporting and 2025
  sightings — offered as hypotheses to test, not as established fact.
- **A model, not a target.** This is a scaled analytical reconstruction for
  research, education and creative work. It is not operational intelligence and
  confers no capability that public imagery does not already provide.
- **Correctable by design.** Because every element is a projection of one
  measured layout, errors are visible and fixable in the open. Disagreement is a
  feature: the honest response to a wrong wall is a pull request, not a footnote.

### 06 · A foundation to build on

The reconstruction is open source and designed to be extended. The single-source
layout means the world, the minimap and the site index stay in sync
automatically — so contribution is low-friction by construction.

- **Refine the layout** — Correct a footprint, add a newly-visible structure, or
  re-measure a strip against fresh imagery — one file, and it propagates
  everywhere.
- **Fork for your medium** — Restyle it as a game level, export it for a VR
  headset, or wire it to a live imagery feed for change detection.
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
> Created by Christopher Woodyard / Vers3Dynamics. Built entirely from publicly
> available satellite imagery. Special thanks to Kimi K3 Max.

</details>

## Run it

```sh
bun install
bun run dev        # dev server
bun run build      # production build + strict typecheck
bun run preview    # serve the production build
```

`npm install && npm run dev` works too if Bun isn't available.

## What's Inside the Wire

- **6.8 km × 6.8 km desert terrain** — seeded simplex heightfield tuned for a
  flat dried-lakebed/gobi plain: broad low relief, vertex-color mottling
  across tan base, darker desert-pavement gravel fields, pale playa and
  braided dry-wash channels, a generated tiling normal map for grain, and
  automatic flattening under every runway, road and building pad. A large
  distant floor keeps the plain reading as endless at the horizon.
- **The full triangular airfield**, scaled from the source imagery: a single
  ~5 km (16,400+ ft) pale concrete runway (05/23) at azimuth ~046° — one of the
  longest in the world — and two ~5.5 km graded-earth strips completing the
  triangle out to a north-west apex, overshooting the corners just like the
  real gradings. Centerline dashes, painted **05/23** designators, threshold
  piano keys, chevrons, expansion joints and tire rubber are all painted into
  `CanvasTexture`s at runtime.
- **A compound on the south side of the runway**, reached by a spur taxiway
  from mid-runway: expanded concrete apron, paved internal streets, and dirt
  tracks out to the support camp and along the perimeter.
- **~25 procedural buildings**: the dominant white assembly hangar (>90 m
  across) with a full-width apron door, a three-bay joined fighter-shelter
  block, a newer north-east hangar, control/observation tower, operations
  building and annex, logistics depot, maintenance workshop, walled equipment
  yard, an east-side fuel farm with pump house, high-voltage switchyard, water
  towers, comms shelter, gatehouse, a detached south-west support camp
  (barracks, mess, solar field) and perimeter radar and guard towers.
- **Three parked aircraft** on the flight line in front of the assembly
  hangar, matching 2025 sightings: the **J-36** sixth-generation demonstrator,
  the **J-XDS** lambda-wing demonstrator, and a flying-wing UCAV. Aircraft are
  structures too: clickable, with dossiers, minimap markers and site-index
  entries.
- **Northern tunnel test area** — based on CSIS satellite imagery analysis of
  China's alleged 2020 nuclear test at Lop Nur. Features Tunnel 5 portal
  (significant activity detected between March-June 2020), Tunnel 3 & 4 portals,
  central tunnel support complex, decontamination station, monitoring posts,
  and dedicated power station. All clickable with detailed dossiers referencing
  the CSIS analysis.
- **Atmosphere**: sandy `FogExp2` haze, analytic sky, soft cascaded sun
  shadows, a drifting ground-level dust layer, soft **cloud shadows** sweeping
  the plain, and an animated day/night cycle (`N`) with stars, moonlight and
  lit windows at night.
- **A base that's alive** (`src/components/scene/LivingScene.tsx`): a resident
  demonstrator flies the **runway pattern** — a low high-speed pass up 05→23,
  climb-out and a downwind teardrop back onto final, with red/green navigation
  lights and an anti-collision strobe; a **surveillance radar** turns on its
  mast; a **guard vehicle** runs the perimeter patrol (headlights on at night);
  a **windsock** reads the breeze by the apron; and red **obstruction beacons**
  wink on every tall structure after dark.
- **Postprocessing**: SMAA, N8AO ambient occlusion, subtle bloom and a
  vignette — automatically shed under load (see below).
- **First-run polish**: a branded boot overlay covers texture generation and
  the first frame, and the cinematic pass captions each site feature as it
  comes into frame.

## Controls — How to Explore

| Key            | Action                                          |
| -------------- | ----------------------------------------------- |
| `1`            | Free-fly orbit camera (damped, terrain-clamped) |
| `2`            | First-person walk — WASD + mouse, Shift sprints |
| `3`            | Cinematic spline flythrough                     |
| `N`            | Toggle day / night                              |
| `I`            | Site index (grouped outliner of structures)     |
| `H`            | Help overlay                                    |
| `Esc`          | Close panels / release the mouse                |
| Click building | Open its dossier, with a "Fly to structure"     |
| Click minimap  | Fly the orbit camera to that point              |

**On phones and tablets**, orbit mode responds to the usual one-finger drag,
pinch-zoom and two-finger pan. First-person mode shows on-screen controls: a
left thumb-stick to walk (push it to the edge to sprint) and the right half of
the screen to look around.

The top-left HUD shows live grid easting/northing, altitude and heading. It is
updated imperatively (a `requestAnimationFrame` loop writing into DOM refs) —
the panel itself never re-renders on frame, which you can confirm from its
`panel renders` counter.

## Adaptive quality

`src/components/scene/AdaptiveQuality.tsx` tracks a rolling FPS estimate.
Below 50 FPS for more than a second, it steps down a ladder — postprocessing
off → pixel ratio to 1 → shadow map halved — and steps back up after two
seconds above 55 FPS. Pin a tier for testing with `?quality=0..3` (this also
disables the automatic ladder). A Leva tweaks panel is available in dev builds.

## Under the Hood

```
src/
  lib/
    layout.ts        ← single source of truth: runways, roads, structures, waypoints
    terrain.ts       ← analytic heightfield (mesh, walking collision, placement)
    textures.ts      ← all CanvasTexture generators (asphalt, dirt, concrete…)
    noise.ts         ← seeded, deterministic noise
    store.ts         ← zustand app state (camera mode, selection, quality…)
    telemetry.ts     ← mutable frame-rate channel scene → HUD (no React state)
  components/
    scene/           ← R3F: Terrain, Pavements, Structures, LivingScene, Atmosphere, rigs, effects
    hud/             ← DOM overlays: HUD, minimap, dossier, site index, help, intro, cinematic caption
    ui/              ← shadcn-style primitives (button, card, badge, separator)
  routes/            ← TanStack Router file-based routes
```

The 3D scene and the 2D minimap are both projections of `lib/layout.ts`; add a
structure there and it appears in the world, the minimap, and the site index.
See [AGENTS.md](AGENTS.md) for extension recipes.

## Built With

Vite 8 · TypeScript (strict) · React 19 · TanStack Router · React Three Fiber ·
drei · @react-three/postprocessing · Tailwind CSS 4 · zustand · simplex-noise ·
leva (dev only)
