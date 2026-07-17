# Lop Nur Twin — Digital Replica

> Step into a 3D digital twin of a remote desert airfield — an immersive, procedurally-generated reconstruction built from public satellite imagery. Explore the wasteland base in real-time with orbit, first-person, and cinematic camera modes.

**What's inside the wire:** A desolate airstrip deep in the arid expanse. Three runways form a triangular pattern — concrete main runway, graded earth strips — surrounded by scattered structures: hangars, control tower, fuel farm, radomes, solar arrays. Four aircraft stand parked on the apron, survivors of a bygone era.

![Aerial overview — triangular runway layout](docs/screenshot-overview.png)

![Structure dossier — click any building for details](docs/screenshot-dossier.png)

## Run it

```sh
bun install
bun run dev        # dev server
bun run build      # production build + strict typecheck
bun run preview    # serve the production build
```

`npm install && npm run dev` works too if Bun isn't available.

## What's Inside the Wire

- **4 km × 4 km desert terrain** — seeded simplex heightfield (two octaves,
  ~4 m relief), vertex-color mottling from gray-brown to dusty yellow, a
  generated tiling normal map for grain, and automatic flattening under every
  runway, road and building pad.
- **A triangular airfield**, as in the source imagery: a single 3.4 km pale
  concrete runway (08/26) forms the south leg, and two ~2.3–2.5 km
  graded-earth strips complete the triangle to a northern apex, overshooting
  the corners just like the real gradings. Centerline dashes, painted
  designators, threshold piano keys, chevrons, expansion joints and tire
  rubber are all painted into `CanvasTexture`s at runtime.
- **A compound on its own rotated street grid**, reached by a wide paved stub
  taxiway from mid-runway: concrete main apron, paved internal streets, and
  dirt roads reaching out to the perimeter radar sites.
- **19 procedural buildings**: a monolithic white assembly hangar with twin
  clerestory window bands and a full-width apron door, a three-bay flight
  shelter row, quonset shed, control tower with catwalk and glazed cab,
  logistics depot with roller doors, two-storey operations HQ, solar-roof
  barracks, walled vehicle and storage yards, gate post with barrier arm,
  fuel farm, pump house, met station, ground-mounted solar array and two
  perimeter radomes.
- **Four parked aircraft** — a flying-wing UCAV on the apron in front of the
  assembly hangar (matching the airframe in the overhead imagery) and three
  twin-tail fighters staged around the site. Aircraft are structures too:
  clickable, with dossiers, minimap markers and site-index entries.
- **Atmosphere**: sandy `FogExp2` haze, analytic sky, soft cascaded sun
  shadows, a drifting ground-level dust layer, and an animated day/night cycle
  (`N`) with stars, moonlight and lit windows at night.
- **Postprocessing**: SMAA, N8AO ambient occlusion, subtle bloom and a
  vignette — automatically shed under load (see below).

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
    scene/           ← R3F: Terrain, Pavements, Structures, Atmosphere, rigs, effects
    hud/             ← DOM overlays: HUD, minimap, dossier, site index, help
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
