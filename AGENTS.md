# AGENTS.md — extending the desert airfield twin

Guidance for coding agents (and humans) working on this repo.

## Ground rules

- **`bun run build` must stay green.** It runs the offline data validator, the
  release-manifest generator, `vite build`, and then a strict `tsc --noEmit`
  (no `any`, unused locals are errors). Run it before you finish any change.
  The build scripts run under Bun _and_ under Node ≥ 22.18 through
  `scripts/run-ts.mjs`, and both must keep producing byte-identical manifests.
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
- **`src/lib/evidence.ts` derives the evidence ledger; never hand-write a
  record.** Records come from the layout and the source register, so a claim
  cannot outlive the thing it describes. UI reads it through
  `getEvidenceForSubject()` — do not re-resolve source metadata in a component,
  and do not add a second place that decides what "observed" means.
- **A claim's classification is load-bearing, and the build enforces it.**
  `src/lib/evidenceValidation.ts` fails `validate:data` if an illustrative
  subject gets a non-illustrative record, an interpreted subject is labelled
  observed, an observed/reported record has no citable source, a confidence
  falls outside `[0, 1]`, a measurement uses an unsupported CRS, or the wording
  of an interpreted/illustrative claim asserts verification.
  `scripts/test-evidence-validation.ts` asserts each rule still fires — if you
  relax a rule, that file is where you have to say so out loud.
- **Never fabricate a source, a date, a hash, a measurement or a confidence
  value.** Unknown means omitted or printed as "unknown", not estimated. There
  is deliberately no `sourceHash` anywhere: the build fetches nothing, so there
  is nothing to hash.
- **Read every URL parameter through `src/lib/params.ts`.** It bounds, clamps
  and rejects; a raw `new URLSearchParams(...).get()` in a component is a
  regression. External links go through `safeExternalHref()` and carry
  `EXTERNAL_LINK_PROPS`. A route's `validateSearch` returns **every** key it
  owns, `undefined` when rejected: TanStack Router keeps any raw key a
  validator leaves out, so omitting one hands the page the unvalidated value
  (`?before=1e309` once crashed `/compare` as the number Infinity). The router
  also JSON-parses values first — `?distance=500` arrives as a number — and
  `params.ts` judges a parsed number or boolean by its text.
- **`/analysis` and `/compare` are not optional.** They are the model's
  accessible front doors — the routes that work when WebGL does not. A new
  analytical field belongs in the table as well as the dossier, and every new
  analytical _capability_ needs a semantic representation there, not only a
  control in the HUD. `bun run a11y` gates both routes on serious/critical axe
  violations. The claim inspector answers for every subject the ledger claims
  anything about (`CLAIM_SUBJECT_IDS`), not only structures, and the ruler has
  a form (`MeasureBetween`) that offers exactly the vertices it would snap to.
- **A measurement states only the error its own evidence documents.** Each
  endpoint's positional error comes from the subject that positions it
  (`positionalStatement()` in `measure.ts`); the runway's ±40 m belongs to the
  runway thresholds and nothing else.
- **Evidence mode and the evidence timeline compose in one predicate.**
  `src/lib/drawState.ts` owns it and answers solid, outline or hidden;
  `src/lib/sceneVisibility.ts` wraps it in hooks. A component asking "should I
  draw this?" calls `useSubjectFilter()` or `useSubjectDrawState()` rather than
  comparing classifications or dates itself. The timeline filter was
  copy-pasted into four components once already, and a second filter beside it
  would have been four chances to disagree about what exists. The evidence
  lens (`L`, `?lens=1`) asks the same module one more question —
  `subjectLensClassification()`, the class to paint a solid subject, knowable
  at the date — and `src/lib/evidenceLens.ts` only renders and counts it: the
  palette, the status glyphs, the dash patterns (shared with the minimap's
  uncertainty rings through `IDENTIFICATION_DASH`) and the tally the legend and
  `/analysis` print. A surface that paints by status reads `LENS_PALETTE`; it
  never picks a colour from a classification itself.
- **A claim is knowable no earlier than its evidence.** `recordKnowability()` in
  `src/lib/evidence.ts` is the one place that decides from when a claim could
  have been made: the later of its source's publication and the observation it
  rests on. A source published before the observation it would attest fails
  `validate:data`; a sensor handbook or other method reference goes in
  `methodSourceIds`, never in `sourceIds`. At a past timeline date the scene
  draws solid only what was publicly established then, and outlines the rest —
  an outline is absence of evidence, never evidence of absence.
- **Unknown stays unknown.** An uncertainty figure the project does not
  document is absent, and prints as "not stated" — never as zero, a dash or an
  omitted row. The three dates (site event, evidence publication, model entry)
  are separate fields and separate columns, always.
- **The model's history is recorded, never written.** `model-history/` holds the
  manifest each model-changing commit on `main` produced, re-derived from that
  commit by `bun run model:record` and reproduced byte for byte by
  `bun run model:verify` (CI runs it). Never edit a recorded manifest or type a
  date into the index; `scripts/validate-model-history.ts` checks every byte and
  rederives the per-subject table. Model entry is about this repository and
  lives in `modelHistory.ts` — never in a temporal evidence event.
- **The twin's bottom edge is one grid.** The site map, mode hints, timeline,
  touch pan-stick and evidence legend sit in `.hud-dock` (`src/routes/index.tsx`,
  `src/styles.css`), which reflows by width. A new panel along the bottom goes
  in a dock cell, never at an `absolute bottom-*` offset of its own: panels
  placed one by one collided on every screen narrower than a desktop.
  `bun run routes` measures the boxes at five screen sizes and fails on an
  overlap.
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
   **Choose the evidence status honestly**: `observed` only if it is visible in
   a cited scene, `reported` only if a cited publication says it is there,
   `interpreted` if you assigned the identity, `illustrative` if you invented
   it to complete the site. The evidence record, the dossier entry and the
   `/analysis` row are generated from that choice.
2. If you used an existing `type`, you're done — placement, dossier, minimap,
   site index, analysis table and evidence ledger all pick it up automatically.
   Re-run `bun run manifest`: the `geometryHash` and `evidenceLedgerHash`
   change, and that is the audit trail. Then record it: commit the change, run
   `bun run model:record` (full history and Bun required), and commit
   `model-history/`. The build refuses a model that is not its own latest
   recorded revision, because otherwise the claim inspector could not say when
   the structure entered the model.
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
- `pilot/` — who sits in the player's seat: the human, the TypeSafe Jev model,
  a seeded random baseline or a recorded trace. See "The player seat" below.
- Unfinished match-mode subsystems live in `experiments/game-modes/`, outside
  `src/` and outside the TypeScript project entirely. `tsconfig.json` has no
  exclusions: every file under `src/` is strict-checked. See
  `experiments/README.md` for what is parked there and how to finish one.

Two subsystems have contracts worth knowing before you touch them:

- **`characters/` legs are placed, not rotated.** `animation.ts` computes an
  explicit foot trajectory and `ik.ts` solves the hip and knee to reach it.
  Three properties fall out and must stay true: cadence is tied to speed by
  `stride = speed x duty x period` so a planted foot never slides; the solver
  clamps reach below full extension so a joint cannot hyperextend; and hip
  height is _solved_, not iterated — lowering the hips shortens the reach to
  the foot by less than the drop, so subtracting the excess under-corrects and
  the planted foot creeps. `rig.ts` guarantees identity rest rotations, which
  is what makes the solve closed-form; do not add a rest rotation. The model
  faces `-z`, so a positive X rotation swings a bone _forward_ — getting that
  backwards is what made every knee bend the wrong way for weeks.
- **First-person hands are solved against the weapon, not posed.**
  `weapons/arms.ts` sculpts each glove as one signed distance field
  (`weapons/sdf.ts`) and closes every finger joint until it meets the
  `GraspSpec` contact solids the weapon builder returns. Change a grip,
  handguard or trigger and update its contact solid in the same edit, or the
  fingers close on air or inside the polymer. Hand placement is palm point,
  facing and index side. The long-gun support hand holds the handguard from
  underneath — palm on the lowest solid under the hold (a shotgun's magazine
  tube, not the handguard above it), fingers up the far side, thumb along the
  near side. An overhand hold reads as the hand lying on top of the gun.
  Bakes are cached per contact set and their geometry is shared, so weapon
  disposal skips meshes marked `sharedGeometry`.
- **`world/clutter.ts` cannot use `mergeAndDispose`.** Normalising for merge
  deletes every attribute except position, normal and uv, which is right for
  the weapons it was written for and silently drops the vertex colours all
  clutter weathering lives in. It has its own `mergeParts`.
- **The player is an actor like any other, and needs the same rig.**
  `CharacterManager` binds entity 0 with hitboxes and no model. Nothing else in
  the simulation registers a collider for the player, so an "optimisation" that
  skips them makes the player unhittable — and the failure is silent and
  one-sided: bots acquire, aim and fire correctly, and every round resolves
  against the wall behind you. `tools/engagement.mjs` asserts it.
- **Every field-of-view number in `src/game/` is horizontal degrees.**
  `THREE.PerspectiveCamera.fov` is vertical, so `horizontalToVerticalFov` in
  `core/types.ts` sits between them. Feeding a horizontal figure straight into
  the camera is a mistake that looks plausible until it is measured: 90 taken
  as vertical is 121° horizontal at 16:9, which is a fisheye, and under it
  aiming down the sights barely narrows anything.

Three things that will bite anyone extending this:

1. **Tone mapping and exposure are decided in two places.** `Atmosphere` sets
   the renderer's transform; on the top tier `render/CombatEffects.tsx` owns it
   instead and the renderer stays linear. The viewmodel draws in its own pass
   and reads `getPostExposure()` so both agree. Change one, check the others.
2. **The composer's buffer is scene-linear HDR**, not display-referred. Sunlit
   concrete sits near 2.0 there, so bloom and streak thresholds must be set
   _above_ the diffuse level or the whole ground blooms.
3. **Anything feeding a convolution must be finite.** `HdrGuardEffect` runs
   first for this reason; without it the sun overflows half-float to `Inf`,
   the bloom downsample turns that into `NaN`, and the frame goes black while
   the sky stays perfect. The same overflow ruins a `PMREMGenerator` input,
   which is why `render/environment.ts` generates a bounded sky instead of
   pre-filtering three's `Sky`.

## The player seat (`src/game/pilot/`)

`/play?brain=human|jev|glide|llm|random|script|replay` chooses who drives the player. The rule
the whole directory exists to keep is in `docs/JEV_BLACKSITE.md`: a brain
_chooses_ controls; Blacksite decides what they do. Read that document before
changing anything here.

- **A brain writes `InputState` and nothing else.** There is one seam, in
  `PlayerRig.tsx`: `pilot.frame(dt, playing) ?? input.state`. The controller,
  weapon runtime, recoil, collision and damage then run exactly as they do
  for a human. Never give a brain a path to the camera, the actor, the
  weapon's ammunition or the bots.
- **Cognition and motor control are separate, and stay labelled.** Under
  `jevControl=precision` a brain names a target slot and an aim region;
  `motor.ts` executes them at frame rate. The controller may only rewrite the
  `InputState` (look, trigger, sights, and movement shaped to make the requested
  action coherent — never a destination). It never picks an enemy by itself,
  reads a body only while `hasLineOfSight` reaches it, and lets go on death,
  sight loss, outage or takeover. `authority.test.ts` fails if any control-layer
  file queues damage, writes a collider, health or weapon state, moves a body,
  fires a weapon or touches the camera — add new control files to its list.
  Every episode, trace and benchmark names its `control`, `navigation`,
  interval and `profile`; never report a precision result as the brain's aim
  alone.
- **Places are the feet's precision control.** Under `jevNav=places` the
  observation lists up to four places (`places.ts`: cover from the threats the
  observation reports, a way nearer, round, back, the objective) with facts,
  never coordinates; a brain names one and `navigator.ts` walks there by
  writing `moveX`, `moveY` and `sprint` only. It never turns the view, never
  picks a destination, and lets go on arrival, no progress, or 1.5 s without
  confirmation. "Hidden" means hidden from _known_ threats — the finder must
  never consult a bot, a spawn or anything the observation did not report.
- **Negotiate, do not special-case.** `capabilities.ts` is where a brain says
  what it can use and the host says what it accepts. A new model or adapter
  declares capabilities; it does not get a branch in `pilot.ts`. The host
  deliberately accepts more than today's remote model can use at speed.
  `?cadence=`/`?latency=` apply to local brains only; Jev's latency is never
  altered, and an injected delay is recorded in every report it touches.
- **One set of senses.** What the human's HUD shows about enemies is what a
  brain's observation may contain: gunfire within `HEARING_RANGE_M`, the hit
  direction, teammates within `RADAR_RANGE_M`. A HUD element that reveals an
  enemy the observation would not (a bracket through a wall, a ping from
  400 m) breaks every human-versus-model comparison; add it to both or to
  neither. The ESP overlay, UAV camera and sensor modes were removed for this.
- **The debrief is after-action, and for every seat.** `debrief.ts` classes
  deaths by what the seat perceived (`sightOf`, perception's own rule) against
  what the simulation did. It reads authoritative state — that is its job —
  so it must never feed an observation.
- **Scripted policies are measuring instruments.** `policies.ts` holds
  hand-written players (`marksman`, `skirmisher`) that read the same
  observation and choose only legal options. They are labelled SCRIPTED and
  claim no probabilities. When a model's result looks like a strategy, write
  the strategy down as a policy and run it on the same seeds: if the script
  matches the model, the finding is about the game.
- **Hitboxes have one definition.** `characters/hitboxSpecs.ts` builds the
  colliders and feeds the aim geometry; a test pins the numbers. Changing a box
  changes every shooter, so it is a gameplay change, not a controller tweak.
- **Offer only controls the rig already consumes.** `contract.ts` is the
  vocabulary; each action maps to held inputs, edges or a bounded look delta
  that `executor.ts` applies for a host-defined window and then releases.
  Adding or changing an action bumps `ACTION_CONTRACT_VERSION`, and traces
  recorded under the old version are then rejected on load, as they should be.
- **Describe what a control does, never when to use it.** The action
  descriptions and the server's question are semantics only. `legalActionsFor`
  filters by mechanics (no ammunition, already reloading, pitch limit), never
  by tactics — a filter that removes "bad" choices is the host playing for the
  model. Arithmetic stays in code: the question `server/jev/question.ts` writes
  states, per visible enemy, the turn and tilt that would centre the crosshair
  on it, so the model is never asked to subtract bearings.
- **Perception is the player's, not the world's.** `perception.ts` reports an
  enemy only inside the camera's field of view, within sight range, with a
  clear line to the head or chest. Anything else arrives the way it reaches a
  human: a gunfire ping, a damage direction, a remembered last-seen position.
- **`contract.ts`, `observation.ts`, `decision.ts`, `llmDecision.ts`,
  `hash.ts`, `hitGeometry.ts` and `capabilities.ts` are shared with the
  server**, and `src/game/eval/` is imported in-process by
  `tools/experiment.mjs` under plain Node (`scripts/ts-hooks.mjs`). `@vercel/node` compiles each
  file on its own and keeps import specifiers, so those and everything under
  `server/` import siblings
  as `./x.js` and never through the `@/` alias — an extensionless import
  builds, typechecks and then fails at runtime with `ERR_MODULE_NOT_FOUND`.
- **The keys never reach the browser.** Only `api/jev/decision.ts`,
  `api/rain/_config.ts` (for the R.A.I.N. Lab's optional bounded decisions, see
  below) and the dev middleware in `vite.config.ts` read `TYPESAFE_API_KEY`;
  only `api/glide/decision.ts` and the same middleware read `FASTINO_API_KEY`;
  only `api/llm/decision.ts` and the same middleware read `LLM_API_KEY`; there
  is never a `VITE_`-prefixed copy, and `@anthropic-ai/sdk` is imported under
  `server/` only. `secretBoundary.test.ts` fails if any other file reads a key
  or browser code mentions one, and `bun run build` ends with
  `tools/jev-secret-scan.mjs` over `dist/`. None of the three decision
  endpoints is a prompt proxy: the browser sends a validated observation, and
  the server writes the question.
- **Jev and the LLM are asked the same question.** Both are built from
  `questionParts()` in `server/jev/question.ts`; `server/llm/handler.test.ts`
  fails if the state, questions or option descriptions diverge. Change the
  wording for one and you have changed it for both, which is the point. Where
  the APIs genuinely differ (parallel per-axis questions against one
  completion, probabilities against a written confidence, 1.5 s against 12 s
  answer age) the difference is declared in `capabilities.ts` and stated in the
  docs — never quietly compensated. Glide (Fastino) speaks Jev's SystemOne
  protocol, so `server/glide/handler.ts` is Jev's handler pointed at Fastino
  (`createSystemOneDecisionHandler`); `server/glide/handler.test.ts` fails if
  its state, options or words drift from Jev's. Fastino takes the instructions
  as one string, so the context and question are joined — the envelope differs,
  the words do not.
- **Every decision leaves a record, and unknown stays null.** A brain returns
  `accounting` (`brain.ts`) and, if it states one, a `confidence` with its
  source (`provider-probability`, `verbalized`); the seat turns that into a
  `blacksite-decision/v1` record with an outcome window. Tokens, prices and
  confidences a brain does not report are `null`, never zero and never 1/k.
- **Stale answers fail closed.** `staleness.ts` re-judges every frame at
  execution against the world as it is then; under the default
  `?stale=strict` a frame with an illegal part does not run. Do not add a path
  that executes an answer because it arrived; `?stale=observe` exists only to
  measure the difference.
- **Measuring is not judging.** The browser records raw outcome windows;
  success is decided offline by an outcome contract in
  `eval/outcomeContracts.ts`. A contract's rule is never edited in place — a
  changed rule is a new version (`/v2`) — because experiments declared against
  the old one must still be scored against it. A primary metric must be in
  `eval/metricRegistry.ts` before an experiment can name it.
- **Prices live in `config/pricing.json` and nowhere else**, each with a source
  and a date; the committed file prices nothing. `pricing.test.ts` fails on a
  dollar-per-token figure anywhere in the source.
- **Labels are claims.** LIVE JEV is shown only while the controls in effect
  came from a validated TypeSafe answer, and LIVE GLIDE only from a validated
  Fastino one — each endpoint's answers name their provider, and the browser
  refuses one provider's answer on the other's endpoint; anything the fallback
  issues is labelled FALLBACK, and a failure shows the status TIMEOUT,
  UNAVAILABLE or ERROR rather than a substitute. Probabilities and confidence
  are displayed as the provider returned them, and the random brain has none —
  never fill them in. The label is decided once, in `controlLabel.ts`: LIVE
  only after a validated answer with no failure since; a connecting or failing
  seat reads JEV CONNECTING, GLIDE TIMEOUT and so on.
- **A decision is shown as recorded, never explained.** `/evaluation` validates
  every decision file it opens (`eval/episodeRecords.ts`) and the decision
  inspector (`eval/ui/DecisionInspector.tsx`) shows what the seat perceived,
  could choose, chose, stated, cost, and what followed — and prints that no
  reason is recorded, because a seat returns a choice, not an explanation.
  Never add a field that reads a reason into a record.
- **No network on the frame loop.** Decisions are requested from a 50 ms timer
  in `pilot.ts`, at most one in flight, with monotonic sequence numbers; a late
  or superseded answer is dropped, not applied. `useFrame` only executes the
  frame already accepted.
- **Frame outcomes compare monotonic counters.** `pilot.ts` measures a
  frame's shots, hits and damage against `lifetime` counters that never reset.
  Measuring against the resettable benchmark metrics once produced a negative
  shot count; the server rejected the observation with a 400, and every later
  decision failed with it.
- **Offline tools never call a paid model.** `bun run jev` answers from a fake
  endpoint installed with `beforeNavigate`, _before_ the page loads — a route
  added after navigation loses the race to the first request — and asserts
  the only model it saw was the test double. `bun run llm` runs the real LLM
  endpoint against `tools/fake-llm.mjs` on its own dev server. Anything that
  spends credit (`jev:live`, `benchmark:jev`, `glide:live`, `benchmark:glide`,
  a Jev, Glide or LLM experiment arm) refuses to start without
  `JEV_LIVE_TEST=1`, `FASTINO_LIVE_TEST=1` or `LLM_LIVE_TEST=1`; the
  experiment runner records unflagged live arms as PENDING and fills in
  nothing for them.

### Recipe: measure a change to `/play`

A gameplay change is not done when it compiles; it is done when a matched
experiment says what it did.

1. Write the question down as an experiment file in `tools/experiments/`
   (`blacksite-experiment/v1`, see `src/game/eval/experimentSpec.ts`): the
   question, a hypothesis that could be false, the primary metric by registry
   id, the outcome contract if it is a decision metric, seeds (or a preset),
   duration, and the arms. Name at least one arm that should _not_ change in
   `controls`. `node tools/experiment.mjs x.json --dry-run` validates it and
   prints the plan without running anything; commit it before you run it.
2. Serve the old build from a worktree on another port:
   `git worktree add /tmp/before <commit>` and `vite --port 5174` inside it.
3. Run the same file against both builds, one arm at a time:
   `node tools/experiment.mjs tools/experiments/x.json --origin http://localhost:5174 --out shots/experiments/x-before`,
   then again against the current dev server.
4. `node tools/experiment.mjs --compare before/evaluation.json after/evaluation.json`.
5. Archive what you will cite: `node tools/experiment.mjs --archive <run> docs/benchmarks/<date>/<id>`
   copies the run with its decision records and traces gzipped and
   re-evaluates it there, so every number keeps a path back to its episodes.
   `--evaluate <dir>` re-scores saved artifacts (for example after adding a
   sourced price) without running a match.

Run arms sequentially. Two headless pages share one software GPU; when the
simulation falls behind real time the benchmark flags the episode (`pacing`)
because decisions are paced in wall time. Same-seed runs still differ from
each other — frame pacing is not deterministic — so report every episode and
do not read a single seed as a result.

### Recipe: add a brain

1. Implement `DecisionProvider` (`loop.ts`): take an observation, return a
   frame of legal options, or a typed failure. Never throw at the loop.
2. Give it a `descriptor` (`brain.ts`), return `accounting` with every
   figure it cannot measure as `null`, and a `confidence` only with its true
   source. Declare its `Capabilities` (`capabilities.ts`) — including any
   longer loop limits it needs, which are then recorded with its results —
   and add a `BrainKind`.
3. Give it a label that tells the truth (`ControlLabel` in `pilot.ts`), and
   record `null` wherever it has no probabilities.
4. Add it to the benchmark's `--brain` list and to `BRAINS` and `LIVE_FLAGS`
   in `eval/experimentSpec.ts` if it spends money, then run the matched
   experiments against the existing seats. A remote brain needs an offline test
   double before it needs a live run.

## The Bethesda anomaly (`src/bethesda/`)

A hidden second environment, lazily loaded from `src/components/AnomalyGate.tsx`
(backtick resolver, or Bethesda's coordinates typed into the Site Index). Read
`docs/BETHESDA_ANOMALY.md` before changing it. It must stay removable: outside
`src/bethesda/`, only the gate, the Site Index row, `server/jev/city.ts` (with
its test and the city branch of `server/jev/handler.ts`),
`scripts/validate-bethesda.ts` and the `build`/
`test:bethesda`/`verify:bethesda` scripts reference it. The R.A.I.N. Lab inside
it adds `src/rain/` (the research runtime), `server/rain/` and `api/rain/`
(with `rainApi` in `vite.config.ts` and their functions in `vercel.json`),
`tools/rain-lab.mjs`, `tools/rain-conformance.mjs`, `tools/rain-admit.mjs`,
`tools/rain-figures.mjs`, `tools/stand-in-model.mjs`, `scripts/export-rain-demo.ts`,
`scripts/import-rain-source.ts`, `scripts/math-substrate.ts`, the `RAIN_` lines
of `.env.example`, the R.A.I.N. names in `tools/jev-secret-scan.mjs` and
`src/game/pilot/secretBoundary.test.ts`, and the `verify:rain-lab`/`rain:*`
scripts. Its autonomous researcher adds `src/rain/autonomy/`,
`tools/rain-autonomous.mjs` and the `.rain-research/` line of `.gitignore`.

- **Two OSM derivatives, two hashes.** `data/osm.json` builds the road and
  pedestrian graphs; `data/streetscape.json` holds storefront names, monuments,
  bus stops and routes, construction and building attributes. Each has a source
  manifest with real retrieval times and byte hashes, an importer under
  `scripts/`, and checks in `scripts/validate-bethesda.ts`. Never hand-edit
  either file, and never type a timestamp: use the download's real time.
- **Events declare effects; agents react to effects.** `scenarios.ts` compiles
  text into a typed `Scenario` and `EVENT_EFFECTS` says what it does (avoid,
  attract, closures and how far a road closure reaches, a crowd to join,
  shelter, slowdown, dark signals, Metro closure, dispatch). Agent rules in
  `simulation.ts` and `locomotion.ts` read effects, never event names, and
  `effects.test.ts` fails on a name in them. A new family is a vocabulary line
  and an effects row, not a script.
- **Places come only from the gazetteer.** Every alias resolves to a mapped
  feature. Unknown places are refused, never relocated to a default.
- **One gate for every chooser.** Humans, Jev and the rules all pass
  `legalActions` and are recorded through `apply`, and `accept`/`humanAction`
  return what the gate did (`ChoiceOutcome`) so no label has to guess. An agent
  indoors takes no choice from anyone until it comes out. `contract.ts` is
  shared with the server; changing an observation field or action means bumping
  `CITY_SCHEMA` and updating `server/jev/city.ts` and its test. Actions are
  offered by mechanics, never by tactics.
- **Anything that changes outcomes is a recorded command or part of the
  config**, including the full-rate LOD focus. A behaviour change bumps
  `SIM_VERSION`/`REPLAY_SCHEMA`; older traces are refused with an explanation,
  never replayed against different rules.
- **One way to ask for a step.** WASD and the touch stick both go through
  `walkIntent`/`stepFor` (`walkInput.ts`), in the city and in the lab; in the
  city the step is always `movePlayer`, a recorded command, so a walk taken by
  thumb replays like one taken on keys. A new input (a gamepad, say) is another
  source for `walkIntent`, never a second path to the walker. Controls that
  only make sense with a view on screen ask `canRender()` (`webgl.ts`) first.
- **Presentation never writes simulation state.** `Actors.tsx`,
  `EventVisuals.tsx`, `landmarks.ts` and `signals.ts` read the simulator; the
  dev-only `window.__bethesda` handle exists for captures and is stripped from
  production.
- **Claims stay derived.** `evidence.ts` classifies massing with Lop Nur's four
  classes from height provenance; the field notes print the computed tally.
  Do not write a fidelity sentence the tally does not support.

### The R.A.I.N. Lab (`src/bethesda/rain/`) and its runtime (`src/rain/`)

A hidden lab behind a door in the city, where R.A.I.N.'s four perspectives meet
and their hypotheses become experiments. Its research runtime lives in
`src/rain/` — the citation corpus and the bundled papers (`data/`), the offline
meeting engine and model meetings (`meeting/`), the bounded decision router
(`judgment/`) and the experiment registry (`experiments/`) — and is served
in-process by `server/rain/handler.ts`. It was ported from
`topherchris420/james_library` (see `docs/RAIN_MIGRATION.md`); read
`docs/RAIN_LAB_BETHESDA.md` before changing either directory. The rule they
exist to keep: **models propose; host code validates; the simulator determines
world state; recorded observations become evidence.**

- **The four perspectives are drawn from the vocabulary, never from a claim.**
  `figures.ts` builds James, Jasmine, Luca and Elena from the Godot client's
  `LOOKS` (`embodiment.ts`; Jasmine's dress is the lab's own, and says so
  there) as skinned meshes on the shared rig in
  `game/characters/rig.ts` — procedural, like everything else; a Blender or
  Godot export would be a binary asset. `figureMotion.ts` animates them from
  what the neutral event vocabulary says (whose turn is shown, where the
  meeting is) and nothing else: the client's tone presets, nods and
  celebration are deliberately not ported, because each reads as agreement or
  confidence, and `figures.test.ts` fails if the animator imports a record or
  names a verdict, confidence or tone. Feet are placed by the shared IK, so a
  planted foot must not slide (the test walks them). A skirt hangs from its
  own bones, which the animator swings clear of the legs; a skirt weighted to
  the thighs tents at every stride, and the test fails if a leg comes through
  Jasmine's on her walk to the table. Routes go through
  `routeInLab`, which collides with the same `blocked` as the visitor; never
  move a figure through a wall. Check a change by eye with
  `node tools/rain-figures.mjs` against the dev server.
- **R.A.I.N.'s resonance is a view, never a source.** The plate instrument in
  the Research Panel (`ResonanceFace.tsx`) is drawn from `resonance.ts`, whose
  `snapshotOf`/`resonanceView` read the lab store and keep no state, so there is
  no second state machine beside the runtime's. A new driver is another field
  read from the store — never a timer, a random number or a guess at what a
  model is doing — and the instrument receives only `read()` and an
  `onInspect` that navigates to the Research Panel, never the store, a client or
  a provider. Where a figure must be chosen it is a hash, which says
  nothing about meaning, and no figure is evidence. `resonance.test.ts` fails if
  deriving a view changes a case, a record, the registry or the city. The plate
  numerics in `chladni.ts` are the Vers3Dynamics Cymatics studio's (MIT, see
  `NOTICE`): keep its constants, or the figures stop being the studio's.
- **The lab holds the live city read-only.** Only `runner.ts` and `replay.ts`
  call a simulator's mutating methods, and only on simulators they built.
  `authority.test.ts` scans every lab module for `step`, `inject`, `accept`,
  `humanAction`, `movePlayer`, `setFocus` and writes to `paused`, and fails on
  any other caller. A new observation goes in `tools.ts` as a read; there is
  never a tool that acts.
- **The browser bundle takes only the runtime's pure modules.** The lab may
  import `src/rain/protocol.ts`, `experiments/evaluate.ts`,
  `judgment/routing.ts` (and its `contracts`, `calibration`, `sensitive`),
  `meeting/perspectives.ts`, `sha256.ts`, `text.ts`, `corpus.ts` and
  `mathematics/contracts.ts`; `authority.test.ts` fails on anything else. The
  corpus data, the SOUL files, the offline engine, model meetings, the
  registry, the mathematical substrate's index, indexer and search, and the
  runtime itself are server-side and reach the browser only as validated
  `rain-bethesda/v2` or `rain-mathematics/v1` answers.
- **No words are written here.** A meeting is a validated R.A.I.N. record —
  LIVE from `/api/rain/meeting` (a model meeting arrives later, through
  `/api/rain/meeting-status`) or the DEMO recording — staged through
  R.A.I.N.'s neutral events. Do not add a line a perspective says. The offline
  engine's text is R.A.I.N.'s script, ported word for word: `offline.test.ts`
  asserts the engine reproduces the DEMO recording, which R.A.I.N.'s own
  engine made, by id and by every word.
- **Say who wrote every word.** A meeting and each turn carry `generation`
  (`scripted` or `model`). A model meeting names its model and the runtime's
  `rain-session-artifact/v1` by SHA-256, and has no grade and no verdict,
  because the model meeting computes neither; a line the runtime's code adds —
  the closing line, the placeholder for an unusable answer
  (`meeting/perspectives.ts`) — is `scripted` even there. Never fill in the
  offline engine's analysis for a model meeting, and never label a model's turn
  as scripted or the reverse — `validateMeeting` refuses both.
- **A model's words only ever come back as text.** `meeting/model.ts` talks
  to an OpenAI-compatible server through `fetch` and nothing else; the runtime
  starts no subprocess but `git`, for its own revision. Nothing from a request
  but the question reaches a prompt, and nothing a model writes is ever run,
  opened, fetched or linked. Under `RAIN_MEETING_PRIVACY=local` (the default)
  `meeting/privacy.ts` refuses an endpoint that is not loopback or
  private-network before the runtime starts.
- **An answer R.A.I.N. did not act on is shown, never used.**
  `decision.attempts` keeps every engine the router consulted, with its
  probabilities as returned. A person may adopt a handed-back pick
  (`adoptSuggestion`: origin `human`, no `rain_decision`); the lab never opens
  a R.A.I.N. proposal R.A.I.N. did not make. Whether Jev may be asked is
  `RAIN_DECISION_MODE=jev` with `RAIN_DECISION_REMOTE_ALLOWED=true` in the
  server's environment — never a lab setting, never on by default, and never
  a path for the browser; `laya` and `cascade` are refused because the runtime
  carries no local checkpoint.
- **R.A.I.N. chooses; the host writes.** R.A.I.N. picks among `OPTIONS` in
  `session.ts`; the proposal is built from the option. A proposal is a closed
  `rain-bethesda-experiment/v2` object with ids from the vocabulary in
  `contracts.ts` — never a coordinate, command, code, URL or path. The scenario
  is compiled by the city's own compiler (`compileFor`) and must land on the
  expected mapped place. A hand-written proposal is a person's
  (`proposeByHand`): it may not claim R.A.I.N.'s or the DEMO's authorship.
- **Nothing runs without a human authorization bound to the digest.** The
  record is a local operator attestation with `identity_verified: false`; do
  not describe it as identity, and do not add a path to `runExperiment` that
  skips `preflight`. The one other authority `preflight` accepts is a standing
  one (`standing.ts`): a charter a person authorized by its digest, listing the
  exact design digests it covers, and the autonomy policy's admission of one
  definition under it. A record carries exactly one of the two.
- **LIVE never falls back to DEMO.** `client.ts` must not import the recording
  (a test asserts it). A failure is a typed failure shown as such.
- **The DEMO recording is re-recorded, never edited.**
  `scripts/export-rain-demo.ts` (`bun run rain:demo`) writes it and its
  manifest with the real time and hashes from a clean, committed checkout, and
  refuses a recording whose meeting id differs from the first recording's;
  `scripts/validate-bethesda.ts` fails when they disagree.
- **The corpus is imported, never edited.** `src/rain/data/` is written by
  `scripts/import-rain-source.ts` from a clean checkout of the source
  repository, with per-file hashes, the corpus fingerprint and the real import
  time in `source.json`; `validate-bethesda.ts` checks every hash. The same
  discovery rules (`corpus.ts`) decide what counts as a paper on import and at
  run time.
- **Secrets reach the runtime by value.** Only `api/rain/_config.ts` and
  `vite.config.ts` read `RAIN_LLM_API_KEY`, `RAIN_REGISTRY_SECRET` (and, for
  Jev, `TYPESAFE_API_KEY`); nothing under `src/rain/` names a credential or
  reads the process environment, and `secretBoundary.test.ts` fails if that
  changes. Never `VITE_`-prefixed. The runtime, `contracts.ts` and
  `validation.ts` are shared with `server/rain/` and import siblings as
  `./x.js`.
- **A pre-registration is certified, not remembered.** A function deployment's
  instances share no disk, so the registry signs each pre-registration (an
  HMAC under `RAIN_REGISTRY_SECRET` over the definition) and the lab brings the
  certificate and draft back with the submission; whichever instance it reaches
  rebuilds the definition (`assembleDefinition`, the one `create` uses), checks
  the certificate and judges the run against exactly that definition. Never
  admit a run against a definition matched by ID alone — scratch registries all
  start at `V3D-EXP-0001` — and never put the certificate in a record. Without
  the secret, Vercel reports the registry unavailable; a configured
  `RAIN_REGISTRY_DIR` is refused there.
- **The registry judges its own criteria.** A submission carries measurements
  and no status or verdict; `experiments/runner.ts` evaluates the
  pre-registered criteria, and `bun run rain:conformance` runs the lab's
  output through the runtime's validators, evaluator and registry and fails if
  they disagree. `experiments/evaluate.ts` is the one `rain-criteria/v1`
  implementation, used by the browser and the registry alike.
- **Records are evidence only through replay.** Every ending is a sealed
  `bethesda-rain-experiment-record/v3`; `verifyRecord` re-simulates it. A digest
  is not a signature: an imported record stays in the store's `quarantine` —
  out of `records`, the Evidence Library and the tools — until `verifyRecord`
  passes. A change to the record, the protocol or the simulator's behaviour
  bumps its schema or `SIM_VERSION`, and older records fail verification with a
  reason.
- **Unknown stays unknown.** A commit, model or token count nobody reported is
  `null`; the submission refuses to invent the producing commit.

### The autonomous researcher (`src/rain/autonomy/`)

The registry's operator research-lineage workflow is documented in
`docs/RAIN_RESEARCH_LINEAGE.md`. `experiments/research.ts` derives claim standing
from existing definitions, runs and artifacts; all mutations remain in
`experiments/registry.ts`. Never accept a claim's own verdict or substitute
model prose for measurements. Research revisions are immutable and extend an
explicit parent; changed sources invalidate their consumers on inspection.
Follow-ups do not schedule or authorize execution. Preserve the default
hash-only artifact policy unless a definition explicitly opted into storage.
Autonomous replay receipts bind the stable run artifact SHA-256, so attaching
the registry's admission does not change the artifact that was verified.

`npm run rain:autonomous` (`tools/rain-autonomous.mjs`) runs R.A.I.N.'s
research loop with a local open model — Ollama or LM Studio — in the researcher
and analyst seats. Read "Autonomous research" in `docs/RAIN_LAB_BETHESDA.md`
first. The rule it exists to keep: **the model does not become the Lab** — it
proposes; the host writes the experiment; a charter a person authorized
decides what may run; the simulator produces the consequences; the
registry's criteria decide; the records say who did what.

- **Autonomy moves the review; it never removes it.** The charter
  (`buildCharter`) lists every design by the SHA-256 of what would run
  (`designSha256`), the model, the ceilings and the validity; a person
  authorizes its digest with the lab's ritual; `admit` (the autonomy policy)
  issues one admission per definition, only when every rule holds. Never admit
  a design the charter does not list, never let a session raise a ceiling, and
  never add a path that runs without the policy's admission or skips
  `preflight`. A changed rule bumps `POLICY_VERSION`, and a changed design is a
  new charter, authorized again.
- **A model's words never enter a definition.** The host writes the question
  and hypothesis for a design (`autonomousProposal`); the `host-written` rule
  refuses anything else. The model's question, hypothesis, rationale and
  interpretation live in the trace, labelled `generation: "model"`, and the
  registry stores the analyst's reading as `MODEL_INFERRED`, apart from its
  evaluation. Hypothesis status comes from sealed records and the criteria
  (`state.ts`), never from a model's reading; a disagreement is recorded, and
  the criteria stand.
- **The model gets a vocabulary, not a computer.** `actions.ts` is closed:
  read-only inspections, a proposal of a listed design, a stop, an analysis.
  A new tool is a read the host answers from its records; there is never one
  that writes, fetches, runs or edits. `boundary.test.ts` fails if a module
  here imports the evidence ledger or the site model, starts a process, writes
  outside `store.ts`, fetches outside `models.ts`, or touches a simulator.
- **Memory is derived, never written back.** Records are written once (`wx`)
  and left out of the state when their digest fails; the trace is append-only;
  `state.json` is a snapshot for people that nothing reads. Every model call
  leaves a `rain-autonomy-decision/v1` record with the prompt and the answer,
  and the proposal and the admission name it by SHA-256.
- **Bounded, and closed when in doubt.** There is no `while (true)`: every
  iteration, experiment, second, failed proposal, model call and token is
  counted against a budget at most the charter's ceiling. A model that does
  not answer, a registry that refuses, a run that fails or does not replay, a
  proposal repeated after its refusal: the session stops and says why.
  Token counts a server does not report are `null`; a token ceiling then stops
  the session rather than guess.
- **Local models only, and no credentials.** The endpoint must be loopback or
  private-network and an Ollama `:cloud` model is refused; nothing under
  `src/rain/autonomy/` reads the environment (`autonomyConfig` takes it by
  value) or sends a key.
- **CI never needs a model.** Tests use `fixtures.ts` (a scripted model) and
  fake servers; `tools/stand-in-model.mjs` answers both adapters' APIs for
  checking the CLI by hand. Never make a test depend on Ollama or LM Studio.

### The mathematical substrate (`src/rain/mathematics/`)

A read-only, version-pinned index of `openai/math`'s catalogue that the lab
searches for mathematical context before it proposes. Read "The mathematical
substrate" in `docs/RAIN_LAB_BETHESDA.md` first. The rule it exists to keep:
**a mathematical result is context, never evidence** — it cannot authorize,
execute, change the simulator, change a record's evidence, or pass the host
gate.

- **The index is generated, never edited.** `data/openai-math.json` is written
  by `bun run rain:math:index -- --from <clean checkout of openai/math>` with
  the real commit, generation time and content hash; `rain:math:verify`
  (and `validate-bethesda.ts`, inside `bun run build`) checks every path,
  status, count and the hash, and `--from` re-derives it from the checkout. To
  move to a newer commit, re-index; never patch an entry. No PDF, LaTeX, Lean
  source or reasoning-summary PDF is copied — only the catalogue's own words,
  and `data/LICENSE.md` carries the repository's Apache-2.0 licence verbatim.
- **Status comes from the repository, never from a reading.** `formalized`
  means a Lean scope page exists at the pinned commit — the Lean is never
  compiled or checked here, and the label says so; `reasoning-summary` is not
  a proof; `unverified` (missing or inconsistent metadata) is shown and never
  admissible in a basis. The words for every status, relation and finding live
  once, in `mathematics/contracts.ts`.
- **No relation from similarity.** Search is deterministic, lexical and
  explained: each result lists the terms it shares and the fields they came
  from, and every result arrives as `insufficient_context`. Only a person
  states a connecting relation (`supports_hypothesis`, `provides_method`, …),
  with assumptions and a rationale; the host's own rule may say no more than
  `insufficient_context` or `related_but_not_applicable`. Challenge mode
  orders counterexamples and obstructions first and never claims one refutes
  the hypothesis.
- **A basis is sealed and re-checked, never trusted.** `mathematical_basis` is
  part of the `rain-bethesda-experiment/v2` proposal and the definition
  digest. `parseBasis` refuses an unknown field, an unverified status, mixed
  revisions or a connecting relation without assumptions — in the browser, at
  pre-registration and at replay — and the runtime's `verifyBasis` refuses a
  moved commit, another index, or a wrong title, status or path before it
  pre-registers. The basis never enters the Evidence Library or the evidence
  list of a record.
- **The API reads and nothing else.** `math-status`, `math-search` and
  `math-inspect` take closed, bounded fields — never a URL, a path, code or a
  repository name — and answer `rain-mathematics/v1` objects the lab validates
  (`mathValidation.ts`) before it shows a word. A missing or broken index
  fails closed: the runtime still starts, the substrate reports itself
  unavailable, and a proposal with a basis is refused. The three routes share
  one Vercel Function, `api/rain/math.ts`, behind a rewrite in `vercel.json`:
  the Hobby plan refuses a deployment with more than twelve functions, after
  the build has passed, and `src/lib/deployFunctions.test.ts` fails first.
- **Tests never touch the network.** `fixtures/openai-math-fixture.json` is a
  small excerpt (four families verbatim from the pinned commit, plus synthetic
  entries marked as such that exist to be refused or flagged); `fixture.ts`
  builds an index from it in memory.

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
bun run engagement            # 13 checks that the match actually plays
bun run gait                  # 15 checks on the walk cycle
bun run audio                 # renders each sound offline and measures it
bun run jev                   # the player seat, places included; no API calls
bun run glide                 # the Glide seat against an in-browser fake; no API calls
bun run llm                   # the LLM seat against the offline test double
bun run test:eval             # evaluation core, seat and server unit tests
bun run shots                 # regenerate the documentation screenshots
node tools/inspect.mjs        # dump live camera, lights, colliders, actors
node tools/closeup.mjs        # stage a soldier 3 m from the camera
node tools/frames.mjs --out shots/before   # the canonical frame set
node tools/lookdev.mjs --list               # per-subject shot sets + the ab gate
```

The analytical side has its own two, and both need the **preview** server
(`bun run build && bun run preview`) rather than the dev server, because they
test the artifact that actually ships — including its security headers:

```sh
bun run a11y                  # axe-core on every route (+ /evaluation with a run open) + CSP
bun run verify:bethesda       # the hidden city end to end (both entrances, scenarios,
                              # outage fallback, replay, a11y, CSP, WebGL failure)
bun run verify:rain-lab       # the hidden lab end to end on three previews of its own:
                              # OFFLINE (RAIN_RUNTIME=off), DEMO, authorization, run,
                              # replay, tampered import, outings, tools, a11y, CSP, no
                              # WebGL; LIVE against the in-process runtime; a model
                              # meeting against tools/stand-in-model.mjs
bun run rain:conformance      # the lab's drafts and submissions through the runtime's
                              # validators, evaluator and registry
node tools/rain-figures.mjs   # (dev server) the four perspectives close up, walking,
                              # and at the table -> shots/rain-figures/
bun run routes                # 140 checks: deep links, refreshes, hostile
                              # parameters and what the state ones set,
                              # ?liveTraffic= staying opt-in, keyboard order,
                              # filtering, mobile, focus without WebGL, and
                              # HUD panels that never cover one another
```

`tools/routes.mjs` is where a URL-parameter regression shows up: it throws
`?quality=1e309`, `?at=1e308,-1e308`, `?structure=<script>…` and a 500-character
id at the app and asserts it renders normally with no page errors; on the dev
build it reads the store to assert what `?year=`, `?compare=`, `?night=`,
`?uncertainty=` and `?at=` actually set, and it answers `?liveTraffic=`
locally to prove that only the documented values make the third-party
request. Its expected timeline dates come from `src/lib/temporal.ts` itself. It also
proved a real bug into existence once — a manifest fetch whose effect aborted
its own request and left the panel reading "Reading the manifest…" forever.

Two of these exist because a screenshot could not answer the question:

- `tools/gait.mjs` drives one actor's animator with a fixed delta across
  several stride cycles and asserts the knee bends forward, the leg never
  locks out, the feet reach the ground and a planted foot does not slide. The
  render loop is no use for this — a headless capture advances a handful of
  frames and a stride takes sixty. A knee that bends backwards looks like a
  bent knee in a still frame, which is how it survived several visual reviews.
- `tools/frames.mjs` captures the _same_ six views every run and prints the
  same statistics for each, including local contrast over the lower half of
  the frame — the number that moves when ground stops being a flat wash.
  Pass `--compare shots/before` to diff against a previous run. Visual work
  went in circles for a while because every review looked at a different
  frame, and a shot into the sun disagrees with a shot away from it about
  almost everything.
- `tools/lookdev.mjs` is the same idea per subject — `viewmodel`,
  `characters`, `vfx`, `terrain`, `props`, `structures`, `sky` — plus `ab`,
  nine frames that between them cover every subject. **`ab` is the gate for
  any visual change:** capture it from the untouched code, capture it again
  after, and pass `--compare <before>`; it prints, per frame, the share of
  pixels that changed, the mean difference, the exposure statistics and the
  draw calls. A change ships when the frames it was meant to touch are better
  and the frames it was not meant to touch did not move. It can fire, aim,
  reload and inspect (it stands in for the pointer lock a headless browser
  never grants), it waits in rendered frames rather than milliseconds — under
  software WebGL a frame takes seconds, and a millisecond sleep in
  `frames.mjs` once photographed the first composited frame after load and
  reported a black spawn that no player ever saw — and it queues renders
  machine-wide, so parallel agents can capture without starving the CPU.
  `--serve <worktree>` captures another checkout without a dev server of
  its own; `--check gait|smoke|engagement` runs those the same way.

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

### Native generated experimental discovery

`docs/RAIN_EXPERIMENTAL_DISCOVERY.md` documents the optional discovery path.
The legacy 44-design v1 charter policy above remains intact. Generated v3
proposals/definitions use `discoveryProtocol.ts` and `discoveryCompiler.ts`,
with a v2 family charter and policy. For that version, the reviewed parameter
envelope replaces enumeration of every exact design. Host-derived operational
questions and hypotheses remain in definitions; model prose and design lineage
are immutable journal entries. `verifyDefinition` must recompile generated
protocols before execution. Never bypass `preflight`, native preregistration,
replay, or the registry's evaluator. `experiments/jsonSchema.ts` is an additional
pure browser-safe runtime import used for this closed data vocabulary.

`src/rain/autonomy/discovery.ts` uses the existing runner and registry, never
simulator mutation methods. All discovery writes go through `store.ts`; network
calls stay in `models.ts`. The local workbench service starts only on explicit
operator request. Keep its loopback/same-origin restriction, shared session lock,
cooperative stop checkpoints and no-restart-resume behavior. Scripted integration
demonstrations must be labeled as scripted, never as Qwen discoveries.

### Native research programs

`src/rain/research/` extends the discovery controller; it is not a second runner.
Read `docs/RAIN_RESEARCH_PROGRAM.md`. Research source excerpts, perspectives and
manuscripts are model context, never simulator evidence. The optional versioned
research scope binds the question, external literature permission and delivery
limits into the charter digest. Only the fixed, bounded Crossref adapter in
`autonomy/models.ts` performs approved public metadata queries; inference stays
local by default. Project Inception may use an explicitly charter-bound server-side
OpenAI collaborator only with operator remote consent and server-owned credentials;
the founder, designer and controller remain local. Network adapters remain in
`autonomy/models.ts`; keys must never enter prompts, journals or browser code.
Research modules cannot start processes, fetch, write files or mutate the
simulator. All persistence uses `autonomy/store.ts`.

Keep exact source receipts and reading scope. Numeric manuscript references bind
to actual admitted, replay-verified runs; the host writes quantitative tables and
figures. Each metric/unit has a separate figure scale. A critic cannot replace
validation, and rejected manuscript revisions or disagreements must remain in the
journal. Ready means ready for human review. Research graph views do not create
operator-reviewed claims in `experiments/research.ts`. Preserve explicit start,
shared locks, emergency stop and incomplete checkpoints on interruption. Tests and
demonstrations must label scripted reasoning and mock literature explicitly.
