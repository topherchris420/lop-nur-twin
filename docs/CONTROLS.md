# Controls and URL parameters

Every parameter listed here is read through `src/lib/params.ts`, which bounds,
clamps and rejects. A malformed value falls back to a default rather than being
coerced — see the "hostile parameters" section of
[`docs/VALIDATION.md`](VALIDATION.md).

| Key            | Action                                                 |
| -------------- | ------------------------------------------------------ |
| `1`            | Free-fly orbit camera (damped, terrain-clamped)        |
| `2`            | First-person walk — WASD + mouse, Shift sprints        |
| `3`            | Cinematic spline flythrough                            |
| `N`            | Toggle day / night                                     |
| `I`            | Site index (grouped outliner of structures)            |
| `R`            | Research, sources, and climate panel                   |
| `M`            | Measurement ruler on the minimap (snap, bearing, copy) |
| `H`            | Help overlay                                           |
| `Esc`          | Close panels / clear measurement / release the mouse   |
| Click building | Open its dossier, with a "Fly to structure"            |
| Click minimap  | Fly the orbit camera to that point                     |

**On phones and tablets**, orbit mode responds to the usual one-finger drag,
pinch-zoom and two-finger pan. First-person mode shows on-screen controls: a
left thumb-stick to walk (push it to the edge to sprint) and the right half of
the screen to look around.

The top-left HUD shows live grid easting/northing, altitude and heading. It is
updated imperatively with a `requestAnimationFrame` loop writing into DOM refs,
so telemetry does not drive React renders every frame.

## Adaptive quality

`src/components/scene/AdaptiveQuality.tsx` tracks a rolling FPS estimate.
Below 50 FPS for more than a second it steps down, and after two seconds above
55 FPS it steps back up. The four profiles scale terrain density, dust count,
device pixel ratio, shadow resolution, postprocessing, and the illustrative
flight circuit. Terrain LODs are cached and warmed during idle time so a tier
change does not normally rebuild the heightfield in the transition frame. Pin a
tier with `?quality=0..3`. Reduced-motion preference freezes automatic 3D scene
motion, makes camera jumps immediate, and disables adaptive promotion.

## URL parameters

Every one of these is validated: a malformed value falls back to a default
rather than being coerced, an out-of-range number clamps, and a date that does
not exist on the calendar (`2025-02-30`) is rejected rather than rolled forward.
`tools/routes.mjs` throws hostile values at every one of them on every run,
checks what the state ones actually set, and proves that no value but `1` or
`true` makes `?liveTraffic=` contact the third party.

| Parameter              | Effect                                                                                |
| :--------------------- | :------------------------------------------------------------------------------------ |
| `?quality=0..3`        | Pins a quality tier and disables the adaptive ladder.                                 |
| `?month=1..12`         | Selects the initial climatology month. June by default.                               |
| `?evidence=<mode>`     | `observed`, `reported`, `interpretation` or `full-simulation`.                        |
| `?snapshot=YYYY-MM-DD` | Sets the evidence timeline to a date the temporal ledger holds.                       |
| `?year=<year>`         | Legacy: maps an old year-slider link to the matching timeline date.                   |
| `?compare=YYYY-MM-DD`  | Second date for a change comparison.                                                  |
| `?uncertainty=1`       | Draws spatial uncertainty envelopes (quality tier 2 and above).                       |
| `?night=1`             | Starts at night.                                                                      |
| `?structure=<id>`      | Opens that dossier on `/`, or highlights that row on `/analysis`.                     |
| `?at=<x>,<z>`          | Frames the camera on that point, in local metres, clamped to the site.                |
| `?liveTraffic=1`       | Opt-in only (`1` or `true`). The single third-party request the application can make. |

A **shareable bookmark link** is built from this set and nothing else. The
analyst note, the tags and the measurement path are never placed in a URL — see
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md).

Blacksite has its own parameters (`?autoplay=1`, `?mode=`, `?at=` and `?look=`
for the opening spawn and heading, `?near=`, for the
player brains `?brain=` (`human`, `jev`, `glide`, `llm`, `random`, `script`, `replay`), `?policy=`, `?jevControl=`, `?jevNav=`, `?placeOrder=`,
`?targetOrder=`, `?seat=`, `?seed=`, `?fallback=`, `?trace=`, `?record=`; for
evaluations `?stale=strict|observe`, `?motor=standard|degraded` and
`?outcomeWindow=`; for experiments with local brains `?cadence=` and
`?latency=`; for a human `?playerProfile=` and `?eliteRecoil=`);
they are described in [`docs/BLACKSITE.md`](BLACKSITE.md) and, for the seat
and evaluation parameters, [`docs/JEV_BLACKSITE.md`](JEV_BLACKSITE.md); `?near=`
overrides the world camera's near plane for capture experiments. In Blacksite, `H` takes
control back from a brain; the `H` above is the twin's help overlay.
