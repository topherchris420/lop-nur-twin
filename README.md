# Lop Nur Base — Digital Twin

> An immersive 3D experience of China's most secretive desert airfield — the Lop Nur test base (~40.77° N, 89.28° E) in the Xinjiang Gobi, rebuilt to scale from public Sentinel-2 satellite imagery. Often called "China's Area 51," this remote airstrip has been linked to reusable-spaceplane landings and, more recently, sightings of next-generation stealth fighters.

**What's inside the wire:** A giant triangular airfield in empty desert. A single ~5 km (16,400+ ft) paved concrete runway (05/23, aligned ~046°/226°) forms one leg; two ~5.5 km graded-earth strips run out to a north-west apex, completing the triangle and overshooting the corners just like the real gradings. A spur taxiway drops south-east from mid-runway to the compound: an expanded concrete apron lined with the big white assembly hangar, three joined fighter shelters, a newer north-east hangar, fuel farm, control tower, operations block, walled yards, switchyard, a detached support camp and perimeter sensors. On the apron, the J-36 and J-XDS demonstrators and a flying-wing UCAV — each clickable for a dossier.

![Aerial overview — the compound on the south side of the runway](docs/screenshot-overview.png)

![Structure dossier — click any building for details](docs/screenshot-dossier.png)

## White paper

A designed, print-ready white paper for the project lives at
[`docs/white-paper.html`](docs/white-paper.html) — masthead, site anatomy,
methodology, ethics & sourcing, and a "build on it" call to action. It's a
single self-contained file: open it straight from disk in any browser, read it
responsively on any screen, and use the **Print / PDF** button for clean
US-Letter output. It's served alongside the app too — run the dev server and
visit [`/docs/white-paper.html`](http://localhost:5173/docs/white-paper.html).

- **Project:** [Lop Nur Twin Base — White Paper](https://claude.ai/design/p/4e3d3c1c-b69d-40cd-ad08-803e9ab30242?file=Lop+Nur+Twin+Base+-+White+Paper.dc.html)
  (`Lop Nur Twin Base - White Paper.dc.html`)

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
