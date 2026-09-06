# The modeled site

What the reconstruction contains, how it is put together, and which parts are
observation, reporting, interpretation or invention. The authoritative source
for every coordinate here is `src/lib/layout.ts`; for every citation,
`src/lib/siteData.ts`. This document describes them — it does not duplicate
them, and where the two disagree the code is right.

- **6.8 km × 6.8 km desert terrain** — seeded simplex heightfield tuned for a
  flat dried-lakebed/gobi plain: broad low relief, vertex-color mottling
  across tan base, darker desert-pavement gravel fields, pale playa and
  braided dry-wash channels, a generated tiling normal map for grain, and
  automatic flattening under every runway, road and building pad. A nearby
  GLO-30 sample provides an approximate ~981 m EGM2008 datum, but the mesh's
  relief is illustrative rather than a DEM reconstruction. A large distant
  floor keeps the plain reading as endless at the horizon.
- **The full triangular airfield**, interpreted from public references: a single
  ~5 km (16,400+ ft) pale concrete runway (05/23) at a modeled grid bearing of
  ~046°, and two ~5.5 km graded-earth strips completing the
  triangle out to a north-west apex, overshooting the corners just like the
  real gradings. Centerline dashes, painted **05/23** designators, threshold
  piano keys, chevrons, expansion joints and tire rubber are all painted into
  `CanvasTexture`s at runtime.
- **A compound on the south side of the runway**, reached by a spur taxiway
  from mid-runway: expanded concrete apron, paved internal streets, and dirt
  tracks along the perimeter.
- **43 interpreted structures**: footprints and roof forms follow the layout.
  The catalog includes service and storage halls, a large assembly-hall
  interpretation, an arched shed, a tower, an operations block, and walled
  service courts. The 2025 build-out reported from commercial imagery adds
  three western fighter shelters, a north-east apron hangar, an expanded
  fuel-storage farm and south-east construction; plausible base-support
  systems — a photovoltaic field, switchyard, elevated water tank, wastewater
  plant, air-search radome, comms shelter, perimeter guard towers and a gate
  guardhouse — are included as clearly-labelled illustrative context. Public
  overhead imagery does not establish interiors, occupants or functions.
- **Two parked aircraft** on the flight line: J-36 and J-XDS models correspond
  to reported August and September 2025 sightings, both parked outside the
  main hangar as described. Their dimensions are the figures stated in that
  reporting — ~65 ft span by ~62 ft length for the J-36, ~50 ft span for the
  J-XDS — and the planforms are normalised so the geometry actually measures
  what the dossier reports. External shape follows widely circulated
  photographs of the airframes, which fixes the gross planform, the J-36's
  trijet exhaust arrangement and both blended centrebodies; provenance of
  those photographs is not verifiable and the dossiers say so. Both are
  clickable, with evidence-labelled dossiers, minimap markers and site-index
  entries. The animated flying-wing demonstrator is separate, illustrative
  scene dressing.
- **Northern Tunnel Test Area — offsite context only.** Published coordinates
  place this separate site about 127 km from the airfield, well outside the
  6.8 km frame, so no tunnel portals or associated facilities are rendered.
  CSIS's March–June 2020 comparison found no significant visible change and no
  conclusive open-source indicator of a test; the simulator makes no activity or
  function claim about the tunnel area.
- **Atmosphere**: sandy `FogExp2` haze, analytic sky, soft cascaded sun
  shadows, a drifting ground-level dust layer, soft **cloud shadows** sweeping
  the plain, and an animated day/night cycle (`N`) with stars, moonlight and
  lit windows at night.
- **An illustrative living scene** (`src/components/scene/LivingScene.tsx`): a resident
  demonstrator flies the **runway pattern** — a low high-speed pass up 05→23,
  climb-out and a downwind teardrop back onto final, with red/green navigation
  lights and an anti-collision strobe; a radar-like dish turns on its
  mast; a **service vehicle** follows an illustrative route (headlights on at night);
  a **windsock** reads the breeze by the apron; and red **obstruction beacons**
  wink on every tall structure after dark. These animations demonstrate scale
  and interaction; they are not observations of site operations.
- **A custom GLSL post-processing stack** (`src/gfx/postfx.ts`): the scene
  renders un-tonemapped into a half-float buffer, then N8AO ambient occlusion
  and a mipmap (dual-filter) bloom run while the image is still HDR, followed
  by hand-written **AgX** tone mapping with an exposed ASC-CDL look, a
  multi-pass **anamorphic streak** pass (bright pass at quarter res, then four
  horizontal blur ping-pongs at exponentially growing stride), SMAA on the
  display-referred image, and a final lens pass adding chromatic aberration,
  radial blur and 24 fps film grain that all scale toward the frame edge.
  Tone mapping happens in exactly one place — the renderer stays linear while
  the stack is mounted and applies AgX itself on the lower tiers, so every
  quality tier shares one look. Shed automatically under load (see below).
- **Procedural hard-surface detailing** (`src/gfx/greeble.ts`): shared
  materials are patched through `onBeforeCompile` with panel lines and plate
  seams derived from object-space cells, per-plate roughness and albedo
  variation, dust weighted by world-up, downward grime streaks, oxidisation
  and a grazing rim term that keeps geometric edges legible against a dark
  sky. Roof clutter — ducts, vents, cable trays, exhaust stacks — is generated
  seeded and merged into a single draw call per deck. Panel lines are injected
  in the shader rather than baked into textures so they follow arbitrary
  geometry and fade out before they can shimmer at distance.
- **Logarithmic depth buffer**: the site spans ~26 km of camera range while
  pavement decals sit 5 cm apart, so the canvas runs with
  `logarithmicDepthBuffer` and custom shader materials are built through a
  helper that cannot omit the log-depth chunks.
- **First-run polish**: a branded boot overlay covers texture generation and
  the first frame, and the cinematic pass captions each site feature as it
  comes into frame.
- **Measurement ruler** (`M`): drop points on the minimap to read leg and total
  distances, straight-line range and grid bearings. Clicks snap to modeled
  runway thresholds, strip ends and compound vertices, every vertex reports its
  public EPSG:32645 easting/northing, and the whole reading copies to the
  clipboard as a citable, offline summary. The reading is deterministic — the
  ruler measures the same source layout the scene is drawn from, so the runway
  reads its documented ~5 km at ~046°.

```
src/
  lib/
    layout.ts        ← single source of truth: runways, roads, structures, waypoints
    siteData.ts      ← public source register, CRS, datum, climatology
    evidence.ts      ← evidence schema + the derived ledger (129 records)
    evidenceValidation.ts ← the rules that fail a build on a false claim
    params.ts        ← validated, clamped URL query parameters
    safeUrl.ts       ← HTTPS-only external hrefs + noopener/noreferrer
    modelManifest.ts ← reads public/model-manifest.json for the UI panels
    terrain.ts       ← analytic heightfield (mesh, walking collision, placement)
    textures.ts      ← all CanvasTexture generators (asphalt, dirt, concrete…)
    noise.ts         ← seeded, deterministic noise
    store.ts         ← zustand app state (camera mode, selection, quality…)
    telemetry.ts     ← mutable frame-rate channel scene → HUD (no React state)
  gfx/
    postfx.ts        ← custom GLSL post stack: AgX, anamorphic streaks, lens artifacts
    greeble.ts       ← hard-surface material patching + procedural greeble geometry
  components/
    scene/           ← R3F: Terrain, Pavements, Structures, LivingScene, Atmosphere, rigs, effects
    hud/             ← DOM overlays: HUD, minimap, dossier, site index, evidence legend, research, help
    evidence/        ← shared badge, confidence, legend and provenance footer
    ui/              ← shadcn-style primitives (button, card, badge, separator)
  game/              ← Blacksite: the combat layer over the same reconstruction
    core/            ← shared vocabulary, the per-frame mutable singleton, damage
    physics/         ← oriented boxes in a uniform grid, capsule collide-and-slide
    weapons/         ← arsenal data, fire control, terminal ballistics, viewmodel
    characters/      ← procedural rig, IK, gait, hitboxes
    ai/              ← bot state machine, perception, shared contacts, spawn scoring
    player/ fx/ render/ hud/ modes/ audio/
  routes/            ← TanStack Router: / (twin), /play (Blacksite), /analysis (table)
scripts/
  run-ts.mjs         ← runs the TS build scripts under Bun or Node ≥ 22.18
  validate-data.ts   ← geometry, geodesy, sources, timeline, quality, evidence
  generate-manifest.ts ← public/model-manifest.json, canonical SHA-256 hashes
  test-evidence-validation.ts ← twenty malformed records; asserts each rule fires
tools/
  probe.mjs          ← headless-browser capture + exposure report + plan view
  frames.mjs         ← the canonical six-view frame set, with A/B statistics
  smoke.mjs          ← Blacksite plumbing: colliders, spawns, hit resolution
  engagement.mjs     ← a minute of match time, stepped; measures whether it plays
  gait.mjs           ← one animator, several stride cycles, five assertions
  a11y.mjs           ← axe-core + CSP violations across all four routes
  routes.mjs         ← deep links, refreshes, hostile parameters, keyboard, mobile
  shots.mjs          ← regenerates the screenshots in this README
deploy/nginx.conf    ← container runtime: SPA fallback, /healthz, security headers
```

The 3D scene and the 2D minimap are both projections of `lib/layout.ts`; add a
structure there and it appears in the world, the minimap, and the site index —
and, because Blacksite bakes its collision out of the rendered scene graph,
in the combat map too. See [AGENTS.md](../AGENTS.md) for extension recipes.

## Built With

The accessible analysis route also derives 68 stable spatial footprints from
the 45 structures, 20 pavement segments and 3 aprons. These support
evidence-aware temporal and proximity queries plus JSON, CSV and WGS84 GeoJSON
export. The catalog contains no live aircraft or other moving scene entity;
full method and limitations are in [`SPATIAL_ANALYSIS.md`](SPATIAL_ANALYSIS.md).

Vite 8 · TypeScript (strict) · React 19 · TanStack Router · React Three Fiber ·
drei · @react-three/postprocessing (with hand-written GLSL effects and passes) ·
Tailwind CSS 4 · zustand · simplex-noise · leva and puppeteer (dev only)

No binary assets. Every texture, every mesh, every sound and every animation in
both experiences is generated at runtime from seeded noise, so the repository
holds no imagery, no models, no audio files and no motion capture — and the
same seed always produces the same world.
