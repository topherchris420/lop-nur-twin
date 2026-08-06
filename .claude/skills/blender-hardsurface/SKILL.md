---
name: blender-hardsurface
description: Hard-surface PBR authoring rules for the Lop Nur twin — procedural panel-line injection, plate seams, metallic weathering, greeble generation, custom WebGL GLSL shaders and the visual-verification loop. Use when adding or retexturing 3D structures, writing/patching shaders or post-processing, chasing z-fighting across large scale ranges, or when a render looks flat, plasticky, or blown out.
---

# Hard-surface look development

This repo renders a fully procedural desert airfield: **no binary assets, no
runtime downloads, everything seeded**. That constraint is the whole reason this
skill exists — the "Blender hard-surface" look has to be reached with shader
math and generated geometry instead of baked texture sets.

Read `AGENTS.md` first; its ground rules (determinism, `bun run build` green, no
React state on the frame loop) override anything convenient below.

## Where things live

| Concern                                                       | File                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Material patching, panel lines, seams, weathering, rim light  | `src/gfx/greeble.ts`                                         |
| Procedural greeble geometry (roof clutter, pipe runs)         | `src/gfx/greeble.ts`                                         |
| Custom GLSL post stack (AgX, streaks, CA, grain, radial blur) | `src/gfx/postfx.ts`                                          |
| Post stack wiring / pass order                                | `src/components/scene/Effects.tsx`                           |
| Shared structure materials                                    | `src/components/scene/Structures.tsx` (`useSharedMaterials`) |
| Canvas / renderer flags                                       | `src/components/scene/Scene.tsx`                             |
| Tone mapping + exposure + fog + sun                           | `src/components/scene/Atmosphere.tsx`                        |
| Seeded RNG and noise                                          | `src/lib/noise.ts`                                           |
| Visual verification                                           | `tools/probe.mjs` → `render_output.png`                      |

## 1. Hard-surface PBR rules

The failure mode for procedural hard surfaces is _uniformity_: one roughness
value over a whole wall reads as plastic. Break it up, but keep the breakup
physically plausible.

- **Metalness is binary in practice.** A surface is a conductor (`metalness`
  0.85–1.0) or it is not (`metalness` 0.0). Values in the middle exist only to
  fake thin paint over metal — use `0.15–0.35` for chalked, oxidised paint on a
  steel panel, never as a generic "shiny" dial.
- **Roughness carries the story, not colour.** Painted mil-spec steel sits at
  `0.45–0.65`; sun-chalked paint `0.7–0.85`; concrete `0.9–1.0`; bare scuffed
  aluminium `0.3–0.45`; glass/canopy `0.05–0.15`. Vary it _per plate_ (see §2)
  by ±0.12 and let seams push it toward rough.
- **Albedo stays in a narrow, desaturated band.** Desert-weathered paint loses
  chroma; keep saturation below ~0.15 and lightness inside 0.18–0.75 sRGB. Deep
  blacks and pure whites destroy the AgX response and read as CG.
- **Dust accumulates by orientation.** Weight dust/albedo lift by
  `max(0, worldNormal.y)` — upward faces get the pale lakebed tint, vertical
  faces stay clean, undersides get darker occlusion. This single term does more
  for realism than any texture.
- **Grime runs downward.** Streaks are vertical in _world_ space and originate
  at horizontal breaks (roof edges, seams, vents). They lower albedo and raise
  roughness together; never one alone.
- **Every hard edge needs a highlight.** See rim lighting in §4 — geometric
  silhouettes must separate from the dark background or the model dissolves.

## 2. Panel line and plate seam injection

Do **not** author panel lines into canvas textures — they alias badly at
grazing angles and cannot follow arbitrary geometry. Inject them in the shader.

Use `applyHardSurface(material, options)` from `src/gfx/greeble.ts`. It patches
a `MeshStandardMaterial` through `onBeforeCompile` (so shadows, fog, envmap,
tone mapping and log depth all keep working) and injects, in this order:

1. **Plate cells.** Quantise world position by `plateScale` to get a cell id,
   hash it, and use the hash to offset that plate's roughness, albedo
   brightness and metalness slightly. This is what makes a wall read as
   _assembled_ rather than extruded.
2. **Seams.** Distance to the nearest cell boundary, run through `smoothstep`,
   gives a thin dark recess. Seams must:
   - darken albedo (`* seamDarken`) **and** raise roughness — a clean recess is
     a contradiction;
   - perturb the shading normal slightly along the seam gradient so the seam
     catches specular at grazing angles (this is what sells depth without
     displacement);
   - stay ≥ 1.5 px wide on screen at the intended viewing distance. Below that,
     fade the whole term out with `fwidth()` rather than letting it shimmer.
3. **Rivet/greeble speckle** (optional, `rivets: true`) — a sparse hashed dot
   pattern near seam lines, applied as a small roughness/AO variation only.
   Never as geometry at this scale.
4. **Weathering** — streaks, dust-by-orientation and rust bias, as in §1.

Rules of thumb: `plateScale` between 1.4 m and 4 m for buildings, 0.6–1.2 m for
aircraft and vehicles, 6–12 m for large concrete pours. Panel lines on a
concrete wall are _expansion joints_ — wider spacing, softer, no rivets.

Axis handling: derive cells from world XZ for roofs and world XY/ZY for walls,
selected by the dominant world-normal axis (a cheap triplanar). Never use UVs —
the geometry here is procedurally built and UVs are inconsistent.

## 3. Custom WebGL GLSL shaders

- **Patch, don't replace.** `onBeforeCompile` + string injection into
  `<dithering_fragment>` / `<normal_fragment_maps>` etc. keeps every three.js
  feature. A raw `ShaderMaterial` throws away shadows, fog and log depth and
  you will re-implement them badly.
- **If you must write a raw `ShaderMaterial`**, use
  `createHardSurfaceShaderMaterial()` from `src/gfx/greeble.ts`, or copy its
  includes. A custom shader **must** contain, in the vertex stage:
  `#include <common>`, `#include <logdepthbuf_pars_vertex>` and
  `#include <logdepthbuf_vertex>` after writing `gl_Position`; and in the
  fragment stage: `#include <common>`, `#include <logdepthbuf_pars_fragment>`
  and `#include <logdepthbuf_fragment>` **first** in `main()`. Omitting these
  makes that one material z-fight against everything else the moment
  `logarithmicDepthBuffer` is on (it is — see §5).
- **Set `material.customProgramCacheKey()`** whenever injection depends on JS
  options, or three will reuse a program compiled with different `#define`s.
- **Uniform plumbing:** stash injected uniforms on the material
  (`material.userData.uniforms`) so a `useFrame` can drive them without
  re-patching. Keep per-frame writes to uniform `.value` assignments only.
- **Post-processing effects** subclass `Effect` from `postprocessing`. Return
  `outputColor` in `mainImage`; declare `EffectAttribute.CONVOLUTION` if the
  effect samples `inputBuffer` at offsets, and `BlendFunction.SRC` when the
  effect fully replaces the colour (tone mapping, lens artifacts).
- **Tone map exactly once.** With the post stack mounted the renderer must be
  `THREE.NoToneMapping`; AgX happens in `postfx.ts`. Without it, the renderer
  does `THREE.AgXToneMapping`. Two tone maps is the classic washed-out bug.

## 4. Rim / grazing light

Add a fresnel term `pow(1.0 - saturate(dot(N, V)), rimPower)` scaled by
`rimIntensity`, tinted toward the sky/haze colour, added _after_ lighting but
_before_ tone mapping. Guidance:

- `rimPower` 2.5–4.0, `rimIntensity` 0.05–0.18. Above that it becomes an
  X-ray glow and flattens the form.
- Multiply the term by `smoothstep` on the surface's own luminance so lit faces
  do not double up; the rim exists for the _dark_ side of the silhouette.
- On metals bias the rim toward the specular colour; on concrete keep it
  neutral and weaker (`* 0.5`).

## 5. Scale and depth

The site spans ~26 km of camera range with 5 cm pavement lifts, so:

- `logarithmicDepthBuffer: true` on the `<Canvas>` `gl` options.
- Any custom `ShaderMaterial` must include the logdepth chunks (§3).
- Keep `camera.near` as large as the closest legitimate geometry allows;
  log depth is not a licence for `near: 0.01`.
- Coplanar decals (markings, pads) use `polygonOffset` or an explicit lift from
  `LIFT` in `Pavements.tsx` — log depth improves precision, it does not make
  coincident surfaces resolve.

## 6. Greeble generation

`makeGreebleGeometry(options)` in `src/gfx/greeble.ts` returns one merged
`BufferGeometry` of seeded boxes/cylinders for roof clutter, pipe runs and
equipment decks. Rules:

- **Deterministic:** every random draw goes through `mulberry32(seed)`. The same
  seed must always produce the same roof.
- **Merged, not instanced-per-mesh:** one geometry, one draw call, one material.
  A roof with 40 separate `<mesh>` nodes is a performance bug.
- **Scale discipline:** greebles read as _equipment_, so 0.3–2.5 m boxes with
  plausible aspect ratios (ducts long and low, vents cubic, stacks tall and
  thin). Uniformly random boxes look like static.
- **Cluster, then align.** Place along rails/rows with a shared rotation per
  cluster and small jitter. Randomly scattered greebles read as noise; aligned
  rows read as engineering.
- **Keep them off silhouettes you care about,** inset from roof edges by ~1 m,
  and never let a greeble intersect a parapet or the shadow-casting outline of
  the host structure.
- Budget: ≤ ~60 primitives per roof, and only on structures the camera gets
  close to (`layout.ts` positions tell you which).

## 7. Verification loop (do not skip)

Shader values cannot be tuned blind. After any change to `postfx.ts`,
`greeble.ts`, tone mapping or lighting:

```sh
npm run dev &                 # or bun run dev
node tools/probe.mjs          # → render_output.png, plus exposure numbers

# a close-up worth judging seams against, with the HUD out of the way
node tools/probe.mjs --focus "Main assembly hangar" --no-hud
node tools/probe.mjs --keys n --focus "Fuel tank" --no-hud   # night

# a scale-accurate plan view, for comparing the layout against imagery
node tools/probe.mjs --plan 700 --center "-20,-40" \
  --width 1000 --height 1000 --no-hud
```

`--plan` puts the camera straight overhead at the altitude that makes the
frame cover exactly the requested ground width, and prints the resulting
metres-per-pixel. That is the only honest way to check the layout against a
satellite crop: scale both to the same m/px and overlay them. It drives the
camera through `window.__twinStore`, which `src/lib/store.ts` exposes in dev
builds only.

**Positions are evidence, not art.** `layout.ts` is the single source of
truth and every structure carries an `Evidence` record with an explicit
`uncertainty` string. Do not nudge a building because a render looks better —
if imagery says a position is wrong, change the position _and_ the evidence
text together, and say what the new position is based on.

Then **open `render_output.png` and look at it.** Check, in order:

1. **Exposure** — is the sky clipped to flat white? Are shadows crushed to
   pure black? AgX should keep detail in both. The probe prints both numbers:
   aim for `clipped` ≈ 0% and `crushed` under ~3% even at night.
2. **Bloom** — highlights should bleed, mid-tones should not. If concrete
   glows, the luminance threshold is too low.
3. **Seams and plates** — visible at intended distance, not shimmering, and
   _square to the structure_. Diagonal panel lines mean something reverted to
   a world-space projection.
4. **Silhouettes** — does each structure separate from the terrain and sky?
5. **Cohesion** — one colour story (warm dust, cool sky), no stray saturated
   pixels.

The printed report is the fast half of the loop — `mean luma`, `clipped`,
`crushed`, `saturation` and the histogram tell you which way to move
`exposure`/`offset`/`slope` in `Effects.tsx` before you even open the image.
Other useful flags: `--url` (repeatable, numbers the outputs so you can
capture a set in one run), `--out`, `--wait`, `--width`/`--height`,
`--scale`, `--keys`, `--selector`. Compare a before/after pair rather than
trusting a single frame.

Finish with `bun run build` (or `npm run build`) so data validation and
`tsc --noEmit` stay green.
