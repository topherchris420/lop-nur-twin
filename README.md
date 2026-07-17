# Desert Airfield — Digital Twin

An interactive, realistic 3D reconstruction of a remote arid-zone airfield,
built from public aerial imagery as a "digital twin" baseline. Everything —
terrain, runways, buildings, textures — is **procedural and deterministic**:
no binary assets, no downloads at runtime, one seed reproduces the whole site.

![Overview of the airfield](docs/screenshot-overview.png)

![Structure dossier](docs/screenshot-dossier.png)

## Run it

```sh
bun install
bun run dev        # dev server
bun run build      # production build + strict typecheck
bun run preview    # serve the production build
```

`npm install && npm run dev` works too if Bun isn't available.

## What's in the scene

- **4 km × 4 km desert terrain** — seeded simplex heightfield (two octaves,
  ~4 m relief), vertex-color mottling from gray-brown to dusty yellow, a
  generated tiling normal map for grain, and automatic flattening under every
  runway, road and building pad.
- **Two 2.5 km paved runways** in an asymmetric cross (N–S and E–NW), with
  faded centerlines, threshold piano keys, chevrons and tire rubber — all
  painted into `CanvasTexture`s at runtime.
- **A triangular loop of graded strips** northwest of the field, taxiways and
  a concrete apron by the building cluster, and dirt roads reaching out to the
  perimeter radar sites.
- **12 procedural structures**: control tower with glazed cab, two barrel-roof
  hangars, a gable hangar, logistics depot, admin/barracks/power/pump support
  buildings, a fuel tank in its bund, and two perimeter radomes.
- **Atmosphere**: sandy `FogExp2` haze, analytic sky, soft cascaded sun
  shadows, a drifting ground-level dust layer, and an animated day/night cycle
  (`N`) with stars, moonlight and lit windows at night.
- **Postprocessing**: SMAA, N8AO ambient occlusion, subtle bloom and a
  vignette — automatically shed under load (see below).

## Controls

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

The top-left HUD shows live grid easting/northing, altitude and heading. It is
updated imperatively (a `requestAnimationFrame` loop writing into DOM refs) —
the panel itself never re-renders on frame, which you can confirm from its
`panel renders` counter.

## Adaptive quality

`src/components/scene/AdaptiveQuality.tsx` tracks a rolling FPS estimate.
Below 50 FPS for more than a second it steps down a ladder — postprocessing
off → pixel ratio to 1 → shadow map halved — and steps back up after two
seconds above 55 FPS. Pin a tier for testing with `?quality=0..3` (this also
disables the automatic ladder). A Leva tweaks panel is available in dev builds.

## Architecture

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
    scene/           ← R3F: Terrain, Pavements, Structures, Atmosphere, rigs, effects
    hud/             ← DOM overlays: HUD, minimap, dossier, site index, help
    ui/              ← shadcn-style primitives (button, card, badge, separator)
  routes/            ← TanStack Router file-based routes
```

The 3D scene and the 2D minimap are both projections of `lib/layout.ts`; add a
structure there and it appears in the world, the minimap, and the site index.
See [AGENTS.md](AGENTS.md) for extension recipes.

## Stack

Vite 8 · TypeScript (strict) · React 19 · TanStack Router · React Three Fiber ·
drei · @react-three/postprocessing · Tailwind CSS 4 · zustand · simplex-noise ·
leva (dev only)
