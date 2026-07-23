# Deterministic Analysis Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-grounded construction timeline, a seeded perimeter patrol fleet, and a notional screen-space aircraft analysis overlay without compromising the twin's deterministic or adaptive-quality architecture.

**Architecture:** `src/lib/layout.ts` remains the canonical data layer for temporal records, the closed patrol route, aircraft-analysis profiles, and the scripted-aircraft ID. Zustand stores only the discrete timeline year and existing selection. R3F frame data crosses to the DOM through a mutable projection singleton; patrol and aircraft motion remain ref-driven in `useFrame`.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Three.js/R3F, HTML Canvas 2D, Bun validator/build.

## Global Constraints

- No new packages or runtime downloads.
- No `Math.random()`, `Date.now()`, unseeded randomness, raycasting, pathfinding, physics, or terrain occlusion.
- Keep `layout.ts` the single source of truth for spatial and scenario definitions.
- Never write frame-rate data into React state or Zustand.
- Preserve the Zustand property name `night`.
- All performance budgets must degrade gracefully from quality tier 3 to tier 0.
- Historical dates and aircraft values must remain source-grounded or explicitly notional.

---

### Task 1: Executable data-contract validation

**Files:**
- Modify: `scripts/validate-data.ts`

**Interfaces:**
- Consumes: `TIMELINE_BOUNDS`, `getObservedYear`, `isVisibleAtTimelineYear`, `PERIMETER_PATROL_ROUTE`, `AIRCRAFT_ANALYSIS_PROFILES`, `QUALITY_PROFILES`
- Produces: build-time validation for temporal, patrol, analysis, and quality contracts

- [ ] **Step 1: Add failing imports and assertions**

```ts
import {
  AIRCRAFT_ANALYSIS_PROFILES,
  PERIMETER_PATROL_ROUTE,
  TIMELINE_BOUNDS,
  getObservedYear,
  isVisibleAtTimelineYear,
} from "../src/lib/layout";
```

Validate exact `YYYY-MM-DD` syntax, Gregorian month/day limits, finite integer years, derived bounds, helper behavior, explicit route closure/distinct vertices/non-zero segments, notional-profile ranges/disclaimers, patrol counts, overlay sample budgets, refresh rates, and monotonic tier capabilities.

- [ ] **Step 2: Run the validator and confirm RED**

Run: `bun scripts/validate-data.ts`

Expected: TypeScript import failure because the new layout and quality contracts do not yet exist.

---

### Task 2: Layout-owned temporal, patrol, and aircraft-analysis data

**Files:**
- Modify: `src/lib/layout.ts`
- Modify: `src/lib/quality.ts`

**Interfaces:**
- Produces:

```ts
export interface TemporalDef { observedDate?: string }
export function getObservedYear(item: TemporalDef): number | undefined
export function isVisibleAtTimelineYear(item: TemporalDef, year: number): boolean
export const TIMELINE_BOUNDS: Readonly<{ minYear: number; maxYear: number }>
export function getVisibleDatedAdditionCount(year: number): number
export const PERIMETER_PATROL_ROUTE: readonly (readonly [number, number])[]
export const CIRCUIT_AIRCRAFT_ID: string
export interface AircraftAnalysisProfile {
  label: string;
  scenarioRadiusM: number;
  radarRangeM: number;
  radarFovDeg: number;
  altitudeM?: number;
  disclaimer: string;
}
export function getAircraftAnalysisProfile(id: string): AircraftAnalysisProfile | undefined
```

- [ ] **Step 1: Add temporal types and helpers**

Use pure string-prefix parsing for render-time year checks. Derive bounds once at module initialization from segments, aprons, and structures, with a fixed modeled-snapshot fallback.

- [ ] **Step 2: Add only source-supported dates**

Date the runway to the 2021 public expansion report, the resurfaced taxiways and reported 2025 build-out to their 2025 evidence, and the two parked aircraft to their reported observation dates. Leave older core facilities and illustrative operational infrastructure undated.

- [ ] **Step 3: Add a closed patrol route**

Build the route from the existing compound perimeter streets and repeat the first point explicitly as the last point. Do not add component-local coordinates.

- [ ] **Step 4: Add notional aircraft profiles**

Provide profile data for existing aircraft structure types and the stable scripted-circuit ID. Every profile must explicitly state that values are illustrative scenario geometry, not verified performance.

- [ ] **Step 5: Add quality budgets**

```ts
patrolVehicleCount: 1 | 2 | 3;
patrolHeadlightLights: boolean;
overlayRefreshHz: number;
overlayRangeSamples: number;
overlayRadarSamples: number;
```

Use tier budgets `1/1/2/3` vehicles and `10/15/24/30 Hz`, `24/32/48/64` range samples, `12/16/24/32` radar samples.

- [ ] **Step 6: Run the validator and confirm GREEN**

Run: `bun scripts/validate-data.ts`

Expected: all new data contracts pass.

---

### Task 3: Discrete timeline state and consistent projections

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/components/scene/Structures.tsx`
- Modify: `src/components/scene/Pavements.tsx`
- Modify: `src/components/scene/LivingScene.tsx`
- Modify: `src/components/hud/Minimap.tsx`
- Modify: `src/components/hud/SiteIndex.tsx`
- Modify: `src/components/hud/Dossier.tsx`
- Create: `src/components/hud/TimelineControl.tsx`
- Modify: `src/routes/index.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `TIMELINE_BOUNDS`, `isVisibleAtTimelineYear`, `getVisibleDatedAdditionCount`
- Produces: `activeTimelineYear`, `setActiveTimelineYear(year)`

- [ ] **Step 1: Add clamped timeline state**

Initialize to `TIMELINE_BOUNDS.maxYear`. Round and clamp finite input. When a newly hidden selected structure is detected, clear only that structure selection; preserve unknown synthetic IDs.

- [ ] **Step 2: Apply the shared helper everywhere**

Filter structure rendering, selection rings, dossier resolution, site index, minimap markers, pavement visibility, fillets, aprons, and obstruction beacons through `isVisibleAtTimelineYear`.

- [ ] **Step 3: Preserve generated resources**

Keep shared structure materials and pavement texture components mounted. Toggle pavement mesh visibility rather than recreating procedural textures. Do not make terrain flattening timeline-reactive.

- [ ] **Step 4: Add the scrubber**

Create an accessible immediate-update range input that shows the active year and visible dated-addition count. Mount it as a positioned DOM sibling and add compact mobile/reduced-motion styling.

---

### Task 4: Seeded, frame-rate-independent patrol fleet

**Files:**
- Modify: `src/components/scene/LivingScene.tsx`

**Interfaces:**
- Consumes: `PERIMETER_PATROL_ROUTE`, `SITE_SEED`, `mulberry32`, `getQualityProfile`
- Produces: one R3F `useFrame` loop driving a quality-budgeted patrol fleet

- [ ] **Step 1: Precompute route and profiles**

Memoize `THREE.Vector2` points, segment lengths, cumulative lengths, total length, and three profiles derived from `mulberry32(SITE_SEED + stableOffset)`.

- [ ] **Step 2: Sample by elapsed simulation time**

```ts
distance = seededPhaseM
  + direction * state.clock.elapsedTime * baseSpeedMps * speedMultiplier;
```

Wrap by total length, interpolate the active segment, sample a short look-ahead, and smooth yaw over the shortest arc. Reuse scratch vectors and heading buffers.

- [ ] **Step 3: Render cheap shared vehicles**

Reuse materials and primitive geometry, vary scale deterministically, seat with `terrainHeight`, freeze at seeded phase under reduced motion, update shared emissive headlights from `night`, and enable at most one non-shadow-casting real light at tier 3.

---

### Task 5: Mutable projection bridge and selectable scripted aircraft

**Files:**
- Create: `src/lib/sceneProjection.ts`
- Create: `src/components/scene/ProjectionBridge.tsx`
- Modify: `src/components/scene/LivingScene.tsx`
- Modify: `src/components/scene/Scene.tsx`

**Interfaces:**
- Produces:

```ts
export const sceneProjection: {
  camera: THREE.Camera | null;
  width: number;
  height: number;
  frame: number;
  circuitAircraftActive: boolean;
  circuitAircraftPosition: THREE.Vector3;
  circuitAircraftHeadingRad: number;
};
```

- [ ] **Step 1: Publish camera state imperatively**

`ProjectionBridge` stores the active camera reference, R3F CSS viewport size, and a monotonically increasing frame marker in one `useFrame` callback.

- [ ] **Step 2: Publish scripted-aircraft state**

Always mount the circuit demonstrator. Freeze it at deterministic curve phase when its animation budget or reduced-motion preference disables movement. Update its world position/heading in the mutable bridge and select `CIRCUIT_AIRCRAFT_ID` on click without broadening the store model.

---

### Task 6: Screen-space Canvas analysis overlay

**Files:**
- Create: `src/components/hud/InterceptionOverlay.tsx`
- Modify: `src/routes/index.tsx`

**Interfaces:**
- Consumes: discrete `selectedId`, quality tier, reduced motion, active timeline year; mutable `sceneProjection`
- Produces: pointer-transparent, quality-throttled Canvas 2D visualization

- [ ] **Step 1: Resolve supported selections**

Use existing structure IDs for parked aircraft and the stable synthetic ID for the circuit aircraft. Unknown synthetic selections remain harmless to structure-only HUDs.

- [ ] **Step 2: Preallocate projection buffers**

Allocate reusable Three.js vectors and typed angular buffers only when the selected profile or quality budget changes.

- [ ] **Step 3: Draw projected world geometry**

Project low-sample horizontal world circles point-by-point through `Vector3.project(camera)`, draw a heading-aligned radar sector from precomputed angular samples, and render a center marker plus the labels `NOTIONAL ANALYSIS ENVELOPE` and `ILLUSTRATIVE — NOT OPERATIONAL DATA`.

- [ ] **Step 4: Insulate performance**

Start RAF only for supported selection, throttle to the quality profile, lower refresh under reduced motion, clamp backing DPR to `dprMax`, and use `ResizeObserver` only for actual CSS-size changes.

---

### Task 7: Integration and completion evidence

**Files:**
- Review all modified files

- [ ] **Step 1: Static constraint scan**

Run:

```sh
rg -n "Math\.random|Date\.now|setState|requestAnimationFrame|useFrame" src scripts
git diff --check
```

Inspect every hit for compliance.

- [ ] **Step 2: Build**

Run: `bun run build`

Expected: data validation, Vite production bundle, and strict `tsc --noEmit` all exit 0.

- [ ] **Step 3: Manual browser matrix**

Serve the built app and test `?quality=0`, `1`, `2`, and `3`: timeline filtering and selection clearing, patrol count/motion/night lights, parked and scripted aircraft overlay, orbit/FPS/cinematic alignment, resize, reduced motion, and existing dossier/minimap/index/research/fly-to/keyboard/touch behavior.

- [ ] **Step 4: Final review**

Compare the diff to every user requirement, document intentionally undefined historical dates, and report remaining limitations without claiming unsupported verification.
