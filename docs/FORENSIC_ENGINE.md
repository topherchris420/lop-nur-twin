# The forensic evidence engine

This document describes the layer that turns the reconstruction into an
instrument for interrogating itself: what it claims, what defends those claims,
and what happens to the picture when only the defended part is allowed to stand.

It is the answer to a problem the reconstruction created. A convincing 3D model
of a place nobody can visit is _persuasive in proportion to how much of it was
invented_ — the illustrative solar field and the measured runway are rendered
with the same lighting, the same materials and the same apparent confidence. The
ledger always recorded the difference. Nothing on screen showed it.

---

## The one interaction that matters

Press **PROVE IT**.

Forty-five buildings, three aprons, every street and both graded strips erode and
disappear. What is left is one runway centreline with a ±40 m envelope at each
end, and a panel of arithmetic:

| Figure                                        | Value                    |
| --------------------------------------------- | ------------------------ |
| Subjects keeping any defensible geometry      | **1 of 68**              |
| Modeled built volume retained                 | **0 m³ of 569,812 m³**   |
| Rendered assertions carried by a cited source | **14 of 612**            |
| Footprint retained                            | 300,001 m² of 957,099 m² |

None of those numbers is written down anywhere. They are counted over the
evidence ledger at module load, and they move on their own when the data does.

The built-volume figure is zero, and it is zero for a reason worth stating
plainly: **no source in `PUBLIC_SOURCES` states the height of anything at this
site.** Every roofline in the reconstruction is a modeling decision. The number is
printed as `0 m³`, never as a small percentage, and `evidenceValidation.ts`
rejects any height tolerance that does not come from a stating source, so the
figure cannot quietly stop being true.

---

## Defensibility (`src/lib/forensics.ts`)

The reconstruction renders nine attributes of every subject. A cited source
typically carries one or two.

```
presence · position · extent · height · form · material · function · interior · activity
```

Each subject earns a **defensibility level** from the classification already
recorded in the ledger — never a promotion, never a re-reading:

| Level               | Earned by                                                   | Defends                                                     |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| `measured`          | a published measurement of this geometry, off a cited scene | presence, position, extent, with a stated tolerance         |
| `observed-extent`   | visible in a cited public scene                             | presence, position, extent, to the scene's resolution floor |
| `reported-presence` | a cited publication states it exists                        | presence only — **not** where this model put it             |
| `undefended`        | interpreted or illustrative                                 | nothing                                                     |

`ATTRIBUTE_SUPPORT` is the single documented mapping from level to attributes, in
the same sense that `CONFIDENCE_SCALE` is the single documented ordinal-to-numeric
mapping. Two entries in it are the ones people argue with:

- **`height` is false at every level.** See above.
- **`position` and `extent` are false for `reported-presence`.** Reporting that
  "three fighter-sized hangars" were built on the western edge defends that they
  exist. It does not defend the coordinates this model draws them at. So PROVE IT
  draws _no geometry at all_ for them and lists them instead, under "attested,
  but not placeable" — putting a marker on the ground would be the exact
  substitution the whole module exists to make visible.

A subject's verdict names what survives and what this project supplied, and the
sentence it generates is quotable in a review.

## Evidence X-ray (`src/lib/xray.ts`)

Three modes, and the second two make support visible as appearance:

- **Solid** — the reconstruction as built. Observation, inference and invention
  equally sharp. This is the mode PROVE IT is a contrast _against_.
- **X-ray in place** — every subject stays where it is; how solid it looks becomes
  how well it is supported.
- **Stratified** — the four evidence layers separate vertically into an exploded
  diagram. Observed stays on the ground because it is the only layer that is _of_
  the ground; illustrative floats at 355 m. Dashed drop lines connect each lifted
  subject to where it actually sits, and entering the mode moves the camera to a
  framing that fits all four strata.

`XRAY_LAYERS` is ordinal by construction — lift rises, opacity falls and dissolve
grows monotonically from observed to illustrative — so a stronger claim can never
render as less certain than a weaker one. `xrayTreatmentsAreOrdinal()` asserts it
and the test suite holds it there.

The dissolve is deliberately not a fade. A uniformly transparent building still
reads as a building seen through glass; something with holes eaten through it
reads as incomplete, which is the accurate impression. A crisp wireframe survives
the erosion untouched: the outline is the model's claim, the missing surface is
the commentary on it.

**Focus is emphasis, never a filter.** Isolating one layer pushes the other three
down to faint shells rather than hiding them, for the same reason
`describeEvidenceMode` reports its own hidden count — a view that silently
subtracts is a way to mislead yourself.

## The provenance chain (`src/lib/provenance.ts`)

Clicking anything opens six links, in order:

```
claim → evidence → source → date → uncertainty → model decision
```

Every record produces all six, and a link this project holds nothing for is drawn
as a **gap** — dashed, labelled, still occupying its position. That is the
opposite of the usual instinct to omit empty rows, and it is deliberate: for most
subjects here the interesting part of the provenance is which links are missing.

The three dates stay in three fields and are never merged — when something was
true of the site, when the evidence became public, and when the change entered
this model. The third is unrecorded throughout this repository and the chain
prints that rather than filling it with the current release.

The last link is the one the chain exists for: what the reconstruction draws that
no source carries.

## The time scrubber (`src/lib/timeScrubber.ts`)

A continuous **day** axis, not a ledger index. That distinction matters more than
it looks: the snapshot dates are unevenly spaced, and stepping through them at a
constant rate would draw a picture where four years of nothing and three weeks of
construction take the same time to cross.

The playhead moves over days; the state it reports is always the state at a real
ledger stop — the latest one at or before it. Between stops nothing changes,
because between stops this project learned nothing.

Four presences, and the third is the interesting one:

- **Established** — a cited scene shows it existed by the scrub date.
- **Not yet evidenced** — modeled, but the earliest cited evidence is later.
- **Undated** — in the model with no date of any kind. It stays drawn as
  _uncertain_ rather than appearing or disappearing, because this project does not
  know when it arrived and popping it in on a chosen day would be a claim.
- **Before any evidence** — earlier than the first cited source.

## The forensic diff (`src/lib/forensicDiff.ts`)

Three channels, because these are three different events with three different
consequences, and a flat list hides which one happened:

| Channel            | Question                                      | Consequence                                   |
| ------------------ | --------------------------------------------- | --------------------------------------------- |
| **Geometry**       | What entered or left the modeled world?       | Needs a spatial re-review                     |
| **Evidence**       | What changed about the support behind it?     | Geometry may be identical; the claims are not |
| **Interpretation** | What changed about how this project reads it? | Nothing moved, nothing new was cited          |

Both comparison surfaces route through the same three channels — the temporal
diff between two dates in the 3D view, and the manifest diff between two builds
on `/compare` — so a build comparison and a date comparison are read the same way.
Release metadata (a version bump, a new generation timestamp) maps to _no_
channel and is reported separately: it is not a change to the model, and folding
it in would be noise in a channel a reviewer is meant to trust.

In the scene, changed subjects are marked on the ground with rings and beams
whose radius and height differ per status, so the marks survive a monochrome
screenshot.

## Spatial uncertainty (`src/components/scene/UncertaintyLayer.tsx`)

Three unknowns, three shapes:

- **Halos** — a ring at the documented positional radius, broken into dashes by
  how well the subject is identified.
- **Boundary envelopes** — a band around the modeled footprint at the resolution
  floor of the cited scene. One pixel of a 10 m scene is wider than most of the
  walls this model draws, and the band is what that looks like.
- **Height columns** — dashed, open-ended columns rising from every roof and
  fading out. They never reach a cap, because a cap would be a tolerance and there
  isn't one.

Nothing is drawn where no figure is stated, and most of the model is in that
position. An empty patch of ground is the correct rendering of "not stated".

## Reference imagery (`src/lib/referenceImagery.ts`)

The most direct check on this model is to put the source beside it. Three
constraints rule out the obvious implementation: the build ships no binary assets
and fetches nothing, and redistribution is not this project's to grant.

So what is published instead is the **exact projected window** the model occupies
in `EPSG:32645`, the STAC item for the precise scene the measurements came from,
and the pixel count that matches the scene's own resolution one for one. A
reviewer retrieves the imagery themselves, crops to the printed bounds, and drops
the file in — read in their browser, never uploaded, released when replaced.

The overlay draws on the ground plane at the same metre scale with a swipe
divider evaluated in _world_ metres, so the divider stays put on the ground while
the camera moves. An edge that continues across it is registered; an edge that
jumps is not.

Registration inherits the same ±40 m the reference coordinate carries, which the
panel states: the overlay and the model share one error, so agreement between them
is not agreement with the ground.

---

## Where it composes

`src/lib/sceneVisibility.ts` is the single place that decides how a subject is
drawn. Six filters meet there, in this order, and **every stage may only weaken**:

1. the construction timeline year — _was this here yet?_
2. the evidence mode — _is this well enough supported to show at all?_
3. reference-only — _stand aside, show the source unmodeled_
4. PROVE IT — _could this be defended if challenged?_
5. the time scrubber — _what had been publicly evidenced by this date?_
6. X-ray — _how certain should this look?_

A subject cannot become more solid further down the pipeline, so no combination of
controls can make something look better supported than the ledger says it is.
`sceneVisibility.test.ts` asserts exactly that. Every presentation also carries
the `reason` it looks the way it does, in words, and the accessible surfaces print
it.

The scene, the minimap, the site index and the measurement ruler all read that one
function. A minimap that disagrees with the view above it is worse than no
minimap.

## Rendering notes

- **Shared materials cannot carry per-subject opacity.** `Structures.tsx` shares
  about thirty `MeshStandardMaterial`s across the site, so fading one building
  would mean cloning its materials. Instead the detailed body is not drawn and a
  schematic proxy takes its place — cheaper, and more honest about what it is.
- **One draw call per treatment, not per building.** Subjects are bucketed by the
  treatment they resolve to (at most six exist) and each bucket's boxes are merged
  into a single geometry.
- **No React state on the frame loop.** Lift, dissolve and the strip-down
  animation are uniforms and group transforms mutated inside `useFrame`. React
  sees only discrete control changes. Scrubber playback runs on a 120 ms timer
  rather than the render loop, because the playhead is discrete state that
  rebuilds the scene graph.
- **Custom shaders include the logdepth chunks**, via
  `createHardSurfaceShaderMaterial()`. The canvas runs with
  `logarithmicDepthBuffer: true` and a shader that omits them z-fights against
  everything else.
- The ghost layer unmounts below quality tier 1 and the uncertainty layer below
  tier 2. The information is never withheld — every verdict, envelope and figure
  stays in the dossier, the HUD readout and `/analysis` at every tier.

## Accessible surfaces

Every capability here has a semantic representation on `/analysis`: the
defensibility verdict for all 68 subjects with attribute coverage, the X-ray
treatment table, the scrubber's stops and presences, and the three-channel diff.
`/compare` carries the manifest-side channel routing. `bun run a11y` gates both
routes on serious and critical axe violations, and `bun run routes` asserts each
section is present and that PROVE IT still reports a minority surviving — a
regression that quietly left the reconstruction standing would look completely
normal in a screenshot.

## URL parameters

| Parameter    | Values                                                | Effect                                  |
| ------------ | ----------------------------------------------------- | --------------------------------------- |
| `?prove=1`   | flag                                                  | Apply the strict reading                |
| `?xray=`     | `off`, `ghost`, `stratified`                          | X-ray mode                              |
| `?layer=`    | `observed`, `reported`, `interpreted`, `illustrative` | Isolate one stratum                     |
| `?snapshot=` | ISO date                                              | Scrub position (also sets the playhead) |
| `?compare=`  | ISO date                                              | The diff's second date                  |

All are read through `src/lib/params.ts`, which bounds, clamps and rejects.
`tools/routes.mjs` throws malformed versions of each at the app and asserts it
renders normally with no page errors.

## Keyboard

| Key     | Action                                            |
| ------- | ------------------------------------------------- |
| `P`     | PROVE IT — draw only what cited evidence defends  |
| `X`     | Cycle X-ray: solid, ghosted, stratified           |
| `V`     | Reference imagery panel                           |
| `[` `]` | Step back / forward through the evidence timeline |
| `Esc`   | Undo the strictest active view, then close panels |
