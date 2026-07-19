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
  CRS/datum and climatology. The 3D scene, minimap, index and cinematic path
  read from those modules. Never hard-code coordinates in components.
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

## Verifying changes

```sh
bun run build              # validate data + bundle + typecheck
bun run preview            # serve dist/ on :4173
```

Then in a browser: check all three cameras (`1`/`2`/`3`), click a structure
(dossier + fly-to), click the minimap, toggle `N`/`I`/`R`/`H`, change the
climate month, and confirm telemetry updates without React frame-loop state.
