# AGENTS.md — extending the desert airfield twin

Guidance for coding agents (and humans) working on this repo.

## Ground rules

- **`bun run build` must stay green.** It runs the offline data validator,
  `vite build`, and then a strict `tsc --noEmit` (no `any`, unused locals are errors). Run it before you
  finish any change.
- **Everything is procedural and deterministic.** No binary assets, no runtime
  downloads (drei helpers that fetch CDN assets, e.g. `<Environment preset>`,
  are off-limits). All randomness must flow through `mulberry32`/`seededNoise2D`
  in `src/lib/noise.ts` so a given seed always reproduces the same site.
- **`src/lib/layout.ts` is the single source of truth** for geometry placement,
  while `src/lib/siteData.ts` owns public sources, evidence types, the local
  CRS/datum and climatology. The 3D scene, minimap, index, cinematic path and
  the minimap measurement ruler (`src/lib/measure.ts`, whose snap targets are
  derived from the layout vertices) read from those modules. Never hard-code
  coordinates in components.
- **No React state on the frame loop.** Per-frame data flows through mutable
  singletons (`src/lib/telemetry.ts`) or refs mutated in `useFrame`. React
  state (zustand) is only for discrete events: mode switches, selection,
  month changes and toggles.
- Coordinates: meters, `+x` east, `+z` south (north is `-z`), `y` up. The HUD
  translates the local frame into the public EPSG:32645 runway-center reference.

## Recipe: add a new structure

1. In `src/lib/layout.ts`, append a `StructureDef` to `STRUCTURES` (unique
   `id`, existing or new `type`, position, rotation, size, capacity,
   description and evidence). If it sits outside the main cluster, add a `FlattenPad` so
   the terrain is leveled beneath it.
2. If you used an existing `type`, you're done — placement, dossier, minimap
   and site index all pick it up automatically.
3. For a **new type**: extend the `StructureType` union and
   `STRUCTURE_TYPE_LABELS` in `layout.ts`, then add a builder component in
   `src/components/scene/Structures.tsx` and a case in `StructureBody`.
   Compose primitives (box/cylinder/extrude) with the shared materials from
   `useSharedMaterials`; set `castShadow` on meshes with height. Selection,
   hover cursor and the highlight ring come free from `StructureNode`.

## Recipe: add a dynamic (moving) element

Animated scene dressing lives in `src/components/scene/LivingScene.tsx`
(circuit aircraft, rotating radar, service vehicle, windsock, night beacons).
Follow the house rules: drive motion from `useFrame` + refs — **never** React
state on the frame loop — and read every position from `src/lib/layout.ts`
(e.g. `WINDSOCK_POS`, `RADAR_POS`, `SERVICE_ROUTE`, `CIRCUIT_WAYPOINTS`) rather
than hard-coding coordinates. Seat ground props with `terrainHeight(x, z)` and
keep any randomness flowing through `mulberry32`/`SITE_SEED`. Because these
props run on active tiers, keep their geometry cheap and treat motion as illustrative.

## Recipe: add a new camera mode

1. Extend the `CameraMode` union in `src/lib/store.ts`.
2. Add a rig component in `src/components/scene/CameraRigs.tsx` (or a
   lazy-loaded file like `CinematicRig.tsx` if it pulls in heavy code) and
   mount it from the `CameraRigs` switch. A rig owns the camera while mounted;
   drive `state.camera` from `useFrame` or mount a drei control with
   `makeDefault`.
3. Bind a key in `src/lib/useKeyboardShortcuts.ts` and add a button/label in
   `src/components/hud/TopBar.tsx` and `Hud.tsx`'s `MODE_LABELS`.
4. Use `terrainHeight(x, z)` from `src/lib/terrain.ts` to stay above ground.

## Recipe: tweak the terrain

- Relief: `BIG_FREQ/BIG_AMP/MID_FREQ/MID_AMP` in `src/lib/terrain.ts`.
  `terrainHeight` is analytic and shared by the mesh, the FPS camera and
  structure placement, so changes stay consistent everywhere.
- Flattening: `FLAT_MARGIN`/`BLEND_DIST` control how far pavement smoothing
  reaches; per-area pads live in `layout.ts` (`FLATTEN_PADS`).
- Coloring: the palette constants and mottling mix are at the top of
  `src/components/scene/Terrain.tsx`; the micro-grain normal map comes from
  `makeGroundNormalTexture` in `src/lib/textures.ts`.
- Mesh resolution: `terrainSegments` in `src/lib/quality.ts` controls every tier;
  displacement cost is O(vertices x flatten shapes), so watch startup time.
  A large flat distant floor plane sits under the detailed mesh to hide the
  terrain edge — keep it below the lowest `rawHeight`.

## Performance expectations

- The adaptive ladder (`AdaptiveQuality.tsx`) must keep working: profiles in
  `src/lib/quality.ts` scale terrain, dust, shadows, pixel ratio, effects and animation.
  Test tiers by hand with `?quality=N` (also disables auto-stepping).
- Instancing is only warranted when a structure type has >5 instances; none
  do today.
- Textures are generated once and cached by `useMemo` — keep new generators
  seeded and sized ≤ 4096 px.

## Recipe: change how the scene looks

Look development lives in `src/gfx/`, and the rules are in
`.claude/skills/blender-hardsurface/SKILL.md` — read it before touching
either file.

- `src/gfx/postfx.ts` — the custom GLSL post stack: AgX tone mapping, a
  multi-pass anamorphic streak `Pass`, and the lens artifact effect
  (chromatic aberration, radial blur, film grain). Wired up, ordered and
  tuned in `src/components/scene/Effects.tsx`, which only mounts on tier 3.
- `src/gfx/greeble.ts` — `applyHardSurface()` patches a
  `MeshStandardMaterial` with procedural panel lines, plate seams, per-plate
  PBR variation, weathering and a grazing rim term;
  `makeGreebleGeometry()` builds merged, seeded roof clutter.
  `Structures.tsx` applies the presets in `decorateHardSurfaces`.
- **Tone mapping happens exactly once.** `Atmosphere.tsx` picks
  `NoToneMapping` when the post stack is mounted (AgX runs in the composer)
  and `AgXToneMapping` otherwise, so every tier shares one look. Do not set
  `gl.toneMapping` anywhere else.
- The `<Canvas>` runs with `logarithmicDepthBuffer: true`. Any custom
  `ShaderMaterial` must include the logdepth chunks — use
  `createHardSurfaceShaderMaterial()` rather than rolling your own.

## The first-person mode (`src/game/`)

`/play` is a combat layer over the same reconstruction the twin renders at `/`.
It mounts the twin's `Terrain`, `Pavements`, `Structures` and `Atmosphere`
unchanged and bakes its collision out of the rendered scene graph, so the map
and the twin can never drift apart.

- `core/` — `types.ts` is the shared vocabulary every subsystem codes against.
  `gameState.ts` is the mutable per-frame singleton (the same "no React state
  on the frame loop" rule applies); `gameStore.ts` is zustand, for discrete
  state only.
- `physics/collisionWorld.ts` — oriented boxes in a uniform grid, capsule
  collide-and-slide, and an analytic heightfield raycast that calls the same
  `terrainHeight` the terrain mesh is displaced by.
- `player/`, `weapons/`, `characters/`, `ai/`, `fx/`, `render/`, `hud/`.
- `_wip/` is excluded from `tsconfig`: sound but unfinished subsystems, kept
  rather than deleted. Finish one and move it back.

Three things that will bite anyone extending this:

1. **Tone mapping and exposure are decided in two places.** `Atmosphere` sets
   the renderer's transform; on the top tier `render/CombatEffects.tsx` owns it
   instead and the renderer stays linear. The viewmodel draws in its own pass
   and reads `getPostExposure()` so both agree. Change one, check the others.
2. **The composer's buffer is scene-linear HDR**, not display-referred. Sunlit
   concrete sits near 2.0 there, so bloom and streak thresholds must be set
   *above* the diffuse level or the whole ground blooms.
3. **Anything feeding a convolution must be finite.** `HdrGuardEffect` runs
   first for this reason; without it the sun overflows half-float to `Inf`,
   the bloom downsample turns that into `NaN`, and the frame goes black while
   the sky stays perfect. The same overflow ruins a `PMREMGenerator` input,
   which is why `render/environment.ts` generates a bounded sky instead of
   pre-filtering three's `Sky`.

## Verifying changes

```sh
bun run build              # validate data + bundle + typecheck
bun run preview            # serve dist/ on :4173
```

Shader and lighting work also needs a look, not just a green build:

```sh
bun run dev &
node tools/probe.mjs                                    # → render_output.png
node tools/probe.mjs --focus "Main assembly hangar" --no-hud
```

`tools/probe.mjs` drives a headless browser, captures a frame and prints
mean luma, clipped/crushed percentages and a histogram, so exposure and
bloom values can be tuned against numbers. `--help` lists every flag.

For the combat mode, the look is only half of it — assert the simulation and
the audio too:

```sh
bun run smoke                 # 22 checks; exits non-zero on failure
bun run audio                 # renders each sound offline and measures it
node tools/inspect.mjs        # dump live camera, lights, colliders, actors
```

`tools/smoke.mjs` fires a ray at a bot and asserts it resolves to a named body
region, pushes lethal damage through the real queue and checks the kill is
credited, and steps the match director to confirm the clock runs. Every check
in it corresponds to something that has actually broken: a camera that never
left its spawn, an environment map full of `NaN`, bots spawned inside a
hangar, a heading convention mirrored between the camera and the simulation. A
screenshot reported the first three as "the screen is dark" and nothing more.

Two notes on testing this headlessly. The render loop advances only a handful
of frames under a headless browser and `dt` is clamped per frame, so anything
time-based has to be stepped directly rather than waited on. And a check that
only holds at yaw 0 — like comparing a heading — passes trivially, because the
default spawn faces north; deliberately turn away from the axis first.

`bun run audio` renders each sound through an `OfflineAudioContext` and checks
peak and crest factor. Peak above unity means it is clipping the bus before the
limiter sees it; crest below 8 means it will not read as percussive.

To check the **layout** rather than the look, capture a plan view:

```sh
node tools/probe.mjs --plan 700 --center "-20,-40" \
  --width 1000 --height 1000 --no-hud
```

The camera goes straight overhead at the altitude that makes the frame cover
exactly 700 m, and the probe prints the metres-per-pixel. Scale a satellite
crop to the same m/px and the two overlay directly — that is the only way to
judge whether a building is in the right place. Comparing an oblique render
to a nadir satellite image proves nothing.

Note that `--plan` needs `window.__twinStore`, exposed by `src/lib/store.ts`
in dev builds only; it is stripped from production.

Then in a browser: check all three cameras (`1`/`2`/`3`), click a structure
(dossier + fly-to), click the minimap, toggle `N`/`I`/`R`/`H`, change the
climate month, and confirm telemetry updates without React frame-loop state.
