# The Bethesda anomaly

Bethesda is an ordinary counterpoint to the desert: sidewalks, shops, routines
and public life inside a geographically anchored experiment. It is an explorable
procedural reconstruction, **not hyper-realism or a surveyed city twin**.

The city is a separate simulator using the existing seeded random utilities,
canonical trace hashing and bounded decision architecture. It does not reuse
Blacksite's combat physics or claim identical mechanics across the two places.
The human pedestrian seat and Jev use the same city action gate; a free walking
camera is an explorer, not a human-versus-model comparison subject.

## Discovery (spoiler)

From the analytical twin at `/`, press **backtick** (the `~` key below Escape),
enter `38.9847,-77.0947`, then submit. Coordinates inside the bundled bounding box
also work, as does the secret command `resolve bethesda`.

A 1.4 second **ANOMALOUS LOCATION RESOLUTION · 39° N · 77° W · BETHESDA** transition
unmounts the desert and lazily loads the city. The rounded transition coordinates
are atmospheric; the parser uses the actual bounding box. Ordinary visits do
not request the city or its geographic data. No main-interface mode button or
public Bethesda route is added. **Return to the desert** remounts Lop Nur.

Arrival now begins on mapped public pavement near the Bethesda Lane entrance,
outside building footprints and the enclosed courtyard. Use WASD / Shift to walk or choose **Survey** for orbit controls. Drag to look;
double-click requests pointer lock and Escape releases it. **Pedestrian seat**
follows actor 0 and offers its currently permitted actions. Named viewpoints
return to survey mode. Touch supports surveying; walking currently needs a
keyboard. Field notes, map, scenarios, simulation and replay remain available
when WebGL fails.

## Scenario telemetry

Backtick inside the city, or its small `~ telemetry` control, opens the command
interface. The supported natural-language families are:

- `Fire near Bethesda Row.`
- `A thunderstorm suddenly rolls through downtown Bethesda.`
- `The Metro station closes unexpectedly.`
- `A parade starts on Wisconsin Avenue.`
- `A strange unidentified object appears above Bethesda.`

This is a bounded rule parser, not a general language model. It recognizes these
families and locations and creates a typed event. Unsupported requests fail
visibly. Input is limited to 240 characters, eight simultaneous events, and
bounded locations/radii/lifetimes. Fires last four simulated minutes, storms
three, and the other events two.

Fire dispatches three illustrative responders from the road near the mapped
Bethesda–Chevy Chase Rescue Squad. Responders follow directed road edges;
ordinary traffic pulls toward the curb, cars stop at closures, and walkers may
leave, watch, record or continue according to seeded individual traits. The
perimeter ring shows the radius used by the closure rules. Fire is a localized
hazard, not a fire-spread, casualty, staffing or evacuation-safety model.

Storms darken the view, add local rain, slow traffic and encourage shelter. Metro
closure makes nearby pedestrians leave. A parade produces a local road closure
and spectator gathering; **there is no complete moving parade procession**.
An overhead object attracts some onlookers. Recording is an abstract pedestrian
state; there are no articulated phone props. No cinematic response is played.

## Real geography and licensing

The source register is `src/bethesda/data/source.json`. Its actual acquisition
URL, retrieval timestamp, raw XML hash and distributed snapshot hash come from
the importer. The bundled derivative is `src/bethesda/data/osm.json`.

| Data            | Included                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Bounds          | Longitude −77.104 to −77.089; latitude 38.978 to 38.991; approximately 1.3 × 1.4 km                                |
| Buildings       | 1,166 OSM footprints: 1,164 simple ways and two multipolygon buildings with courtyard holes                        |
| Roads           | 476 in-bounds ways/fragments with node topology and one-way tags                                                   |
| Walking/cycling | 871 mapped ways/fragments; underground/private paths excluded                                                      |
| Green spaces    | Seven park/garden polygons, including Caroline Freeland and Veteran's Park                                         |
| Infrastructure  | 425 crossing points, 59 signal points, two Metro entrances and a rescue-station point                              |
| Heights         | Community height tags where available; level tags converted using an assumed 3.3 m/floor; the remainder inferred   |
| Terrain         | Montgomery Planning bare-earth LiDAR DTM, exported as 65 × 65 samples over the OSM crop; roughly 20 × 22 m spacing |

WGS84 coordinates are projected to a local metre frame around
38.9847, −77.0947 using latitude-dependent ellipsoid scale factors. East is +x,
south is +z, and y is up. Bethesda does not borrow Lop Nur's UTM zone.

Actual OSM IDs, versions, edit timestamps, geometry and relevant tags are
retained. Mapper identities, contact details and unrelated POIs are omitted.
The acquisition date is not a date when every feature looked like the model.
OSM can contain stale construction, old names, missing structures and errors.
Complete multipolygon rings are assembled only at exact shared OSM node IDs.
Missing/ambiguous relation fragments are rejected. The two complete relations
include the Bethesda Lane courtyard complex (13979605) and the retail block to
its north (13979604). Building collision, roofs and the minimap preserve the holes. Boundary
lines retain contiguous in-bounds vertices, so some stop short of the box.

**© OpenStreetMap contributors.** The extracted and modified geographic database
is distributed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
separately from the Apache-2.0 source code. The scene/minimap and Field notes
provide [attribution](https://www.openstreetmap.org/copyright), and Field notes
can download the complete derivative database. No map or imagery service is
called at runtime. No proprietary imagery, purchased asset or paid geospatial
service is used.

**© Montgomery County Planning Department, MNCPPC.** `terrain.json` is a small
crop of the [countywide bare-earth DTM](https://montgomeryplanning.org/tools/gis-and-mapping/elevation-data/).
The [publisher's explicit terms](https://www.arcgis.com/sharing/rest/content/items/0379353eb80b4207b979656bd9eadff9?f=json)
permit copying, modification, distribution and analysis, including commercially,
with attribution, and disclaim warranties/liability. The full permission text,
exact export parameters, retrieval timestamp and raster/JSON hashes are in
`terrain-source.json`. Field notes attribute the publisher and offer the elevation
crop for download. This dataset is separate from the OSM derivative database.

The source service identifies NAVD88 / Geoid12B vertical heights in US survey feet;
the importer converts by 1200/3937 to metres. Rendering uses y = NAVD88 metres − 100.
The arbitrary 100 m offset is a documented display datum, not a surveyed origin
height. Samples span 87.58–113.55 m NAVD88. The publisher describes its current
LiDAR program as late 2023 / early 2024; individual pixel dates/uncertainties are
not exposed. The original service is one-foot resolution, but **this model is not**:
the 65 × 65 bilinear crop captures broad slopes, not curbs, stairs or small earthworks.
Pixel-centre samples are interpolated; values clamp at the crop border.

One shared height function seats ground, subdivided road/path strips, buildings,
street furniture, actors, effects and the walking/survey camera. Building floors
and roofs remain level at the footprint-centre elevation, with simplified foundation
skirts; these do not reconstruct actual grading or stepped foundations. The
simulation still uses a planar street graph: slopes do not change agent speed,
route cost or traffic mechanics. No building height is inferred from this DTM.
The county's Buildings_3D endpoint was inspected, but exposed neither usable roof
heights nor Z geometry in the queried layer; that data was not incorporated.

To refresh, download the manifest's exact OSM XML URL, then run:

```sh
python scripts/import-bethesda.py export.osm
npm run test:bethesda
npm run build
```

The importer runs the installed formatter before computing the snapshot hash.
The build verifies byte integrity, coordinate bounds, counts, source IDs and
license. Do not change the checksum just to suppress a validation failure.

To reproduce the terrain crop, request `/exportImage` on the service in
`terrain-source.json` using its `export` parameters and `f=json`. Save the returned
TIFF plus export response, service metadata (`?f=json`) and item metadata. Then:

```sh
python scripts/import-bethesda-terrain.py crop.tiff export.json service.json item.json
npm run build
```

The offline importer requires Pillow, refuses missing/unexpected samples or
changed vertical units/permission, and writes JSON only. The small source TIFF
is an acquisition intermediate, not a shipped binary asset. No countywide raster
or paid service is required. Build validation checks both geographic checksums.

## What looks convincing and what looks fake

The non-grid street relationships, Wisconsin / Woodmont / Bethesda avenues,
Old Georgetown Road, Bethesda Lane, Metro area, parks, large commercial
footprints and surrounding houses are anchored to real geometry. Their spatial
relationships are the strongest part of the model, especially from above.

A public reference was inspected: G. Edward Johnson's
[Woodmont Avenue / Bethesda Avenue intersection, 30 March 2025](https://commons.wikimedia.org/wiki/File:Bethesda_downtown_intersection_2025-03-30_11-38-17.jpg),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It shows detailed brick
storefronts, mature trees, poles, signals and material variation. The procedural
view now has dimensional window reveals, sills, storefront glazing, cornices,
awnings, brick paving and street furniture around Row. The design vocabulary is
informed by the reference; individual façades and furnishing positions remain
illustrative. The [EPA Bethesda Row case study](https://www.epa.gov/smartgrowth/create-walkable-neighborhoods-bethesda-row-bethesda-maryland)
also describes the brick sidewalks, street trees and continuous shopfronts; its
case study dates to 2006/2011 and is not a current tenant or condition survey. This was qualitative comparison, not photogrammetry,
image alignment, a survey or a pixel-error measurement. The reference image is
not shipped and must never be presented as an achieved render.

The [project architect's Bethesda Lane photograph](https://www.tortigallas.com/portfolio/upstairs-at-bethesda-row)
was also inspected: reddish brick, pale contrasting frontage, large ground-floor
glazing, shallow dark rails, planters and overhead fixtures. The architect describes
several facade themes. The model now varies local facade modules, windows, blinds
and Juliet rails; it still does not copy any individual shopfront. The
[lighting designer documents catenary ring lights along Bethesda Lane](https://www.thelightingpractice.com/project/bethesda-row/).
Their signature concept is represented procedurally; dimensions, spans and placement
are inferred, not measured. These copyrighted project photographs are reference only,
not redistributed assets or textures. The photograph's historical fixtures/tenants
are not assumed to be current.

Façades repeat generated window bays. Most heights, roof profiles, awnings,
trees, furniture and sign placements/styles are inferred. Cars now have rounded
bodies with wheel openings, sloping glazing, roof panels, mirrors, trim, lamps and cylindrical tires/rims,
with sedan/SUV proportions. Emergency vehicles are a generic enlarged variant,
not a faithful Bethesda apparatus. Nearby civilians have articulated arms/legs,
shoes, hair, basic faces, clothing variation, bags and a phone-recording pose;
they are still visibly procedural, without realistic skin, fabric or facial animation.
There are no faithful
interiors, Metro escalators, surveyed curb ramps, tree surveys, faithfully measured
landmark frontages or full traffic-signal assemblies. Curbs, lamp globes and
slatted benches are illustrative. Untagged retail heights now use a conservative
8–11 m typology estimate instead of arbitrary office-like heights; these are
not measurements. Bethesda Lane uses an inferred 8 m paved width. Some paths are disconnected or
intersect footprint geometry, so walkers may wait or reverse. The Bethesda Lane
complex has a mapped overhead layer, but this model does not yet reconstruct
the ground-floor passages through its ends; those boundaries remain solid. These are visible
limitations, not hidden fidelity claims.

A further realism pass needs measured building heights, finer terrain/grading,
local photographic review, manual landmark/storefront and passage modeling,
faithful materials/roof profiles and higher-quality civilian anatomy. The added
detail and real broad terrain slopes improve depth cues; they do not establish
photorealism.

## Simulation and performance

Simulation has no renderer imports. It advances fixed 0.1 s ticks on its own
timer, including when WebGL is unavailable. Randomness comes from the shared
`mulberry32` generator. Rendering changes cannot write agent state.

The conservative initial profiles are 120 pedestrians / 28 cars on up to four
reported CPU cores, or 320 / 65 otherwise. Three responders are additional. The
simulator supports a bounded 640 / 110 profile for explicit experiments.
Half of initial pedestrians are sampled near Bethesda Row / Metro to make the
public corridors active; that distribution is illustrative, not measured.
Statistical district cohorts add 900 / 1,800 / 2,800 synthetic occupants and
update sheltering/watching counts at 1 Hz. **These are illustrative aggregate
occupants, not individually modeled distant citizens or census estimates.**
Active individual agents retain full fixed-step updates even when not drawn;
there is no automatic promotion/demotion between cohorts and individual actors.

Static geometry is merged in spatial tiles with distance/frustum culling and
matching fog ranges (shorter in economy); people and vehicles are instanced. Rendering culls
distant actors, lowers pixel ratio and disables shadows under sustained low
frame rate. Weak hardware starts without shadows. **Visuals: auto → detail → economy**
cycles the render preference. Auto retains adaptive degradation; detail keeps
block-scale 2048 px shadows and at most 1.5 pixel ratio, while economy disables
shadows. Local procedural sky reflections require no downloaded HDRI. These
are artistic daylight conditions, not a measured timestamp/sun position. Population is selected at
startup from hardware, not continually resized; this preserves experiment
identity. Browser background throttling or overload can slow simulated time
relative to wall time. There is no hardware-independent frame-rate guarantee.

Renderer tone mapping uses the shared owner in
`src/components/scene/Atmosphere.tsx`. Lop Nur keeps its existing postprocessing
switch and 1.05 exposure; Bethesda requests renderer AgX at exposure 1 and restores
the prior transform on unmount. Its local sky and lighting remain separate.

Civilian gait uses measured displacement, a distance-driven planted/swing foot
trajectory and the existing Blacksite clamped two-bone IK solver. Feet sample the
same terrain as the actor. Stops stop the gait even when an action still names
walking. Close-range anatomy/IK/faces and rims simplify with distance; instancing
keeps the civilian population from creating hundreds of draw calls. Rendering
interpolates positions over at most one tick; this is presentation, never authoritative
world state. Missed render frames can change cosmetic gait phase, not experiment
results. Vehicles tilt with the sampled road grade and sit on the same illustrative
pavement lifts as the static street surfaces. Fire, smoke and rain remain simplified
visual effects, not physical fluid or weather simulation. Browser captures do not
prove photorealistic motion or a hardware FPS target.

Road movement respects one-way topology, illustrative signal cycles, pedestrian
crossings, headway, basic intersection reservations and emergency yielding.
Parking is an abstract curb dwell; building entry hides the actor at an inferred
portal for a dwell period, without an interior. Public gatherings are short
social stops. Short sidewalk connectors of at most six metres are inferred.
There is no calibrated traffic demand, complete lane-changing model, continuous
vehicle physics, citywide congestion forecast or real population schedule.

## Jev's actual authority

Jev is off by default. The toggle uses the existing server-only TypeSafe
configuration and `/api/jev/decision`, with a separate closed city schema.
It samples nearby event participants every 2.5 seconds, permits one request
in flight, has a 1.2 second browser deadline, and stops at 120 requests/session.
Ordinary deterministic routines continue while a proposal is pending.

`observation → permitted actions → Jev proposal → deterministic validation → simulation`

Jev chooses one offered action: for example, wait, watch, record, leave, shelter,
enter, drive, stop or pull over. It does not choose coordinates, speeds, traffic
signals, actors, events, camera state or direct world mutations. The server
constructs the question from bounded fields and enums and validates the returned
model ID, option coverage, probability sum, confidence and selected action.
The simulator checks current legal actions and rejects proposals over 15 ticks
old. Emergency agents can receive a dispatch fact about an active fire; this
is explicitly not a claim of seeing the fire from across the city.

Unavailable, timed-out, malformed, illegal or stale replies produce a recorded
fallback. Routing, traffic safety, speed, collisions, dispatch mechanics and
district updates always run in deterministic code. The existing Blacksite
vocabulary and credential entry points are preserved. Provider accounting is
unknown (`null`); it is not fabricated. **No live Jev Bethesda run is claimed.**
Tests use offline responses and never spend model credit.

## Replay and verification

Exports include data hash, schema, seed/profile, tick-stamped scenario inputs,
human choices, explorer movement, remote proposals/failures, observations,
selected actions, source labels, before/after state and the outcome tick for each
decision. Checkpoints are recorded every 100 ticks. Re-import regenerates the
simulation and verifies checkpoint hashes, the decision history and final state.
It yields periodically to keep the UI responsive and never calls a model.

New recordings use `bethesda-replay/v2` for the corrected public-path spawn and
include the elevation snapshot hash. A stated, mismatching terrain hash is rejected.
Older traces without that optional field still verify their planar simulation
state and retain the omission on re-export; they do not claim their original
flat-ground presentation has been reproduced.
The loader understands v1 starting-position semantics when the data hash matches.
The courtyard import changes the snapshot hash: recordings made against the
previous snapshot require that revision of the project and are intentionally
rejected here, rather than replayed against different collision geometry.

Replay reproduces authoritative simulation state, not render timing or identical
pixels. Hashes are integrity checks, not signatures proving trace authorship.
The recorder caps 30,000 input commands and 60,000 decisions. Export refuses an
incomplete trace when a cap is reached; reset begins a new experiment. Replay
also caps 18,000 ticks and 32 MB input. The decision cap can be reached well before
the tick cap at dense profiles. Export traces before leaving or reloading.

```sh
npm run test:bethesda
npm run test:run
npm run test:evidence
npm run format:check
npm run lint
npm run build
npm run verify:bethesda
node tools/bethesda-look.mjs
```

The browser check uses the production artifact and security headers. It checks
lazy discovery, all five scenarios, a mocked provider outage through native
fetch, walking, trace export/re-import, provenance, accessibility and return to
Lop Nur. Its 960 × 640 viewport and public Economy preference bound software-GPU
raster cost; WebGL and the full simulation remain active. DOM/timer conditions
use bounded interval polling rather than waiting for animation frames. It writes
local captures/checks under the Git-ignored `shots/bethesda/`; CI uploads these
and the error/HUD/provider-request diagnostics if a browser check fails.
Set `PUPPETEER_EXECUTABLE_PATH` when using an existing Chromium installation.
The same check is included in CI. The look-development capture script records
arrival, street, turned street and survey views in auto/detail modes, plus
console/network evidence, under `shots/bethesda/look/`. It operates real controls
and never requests Jev. Software-rendered Chromium captures establish visual
output and errors, not a laptop/GPU performance benchmark. Existing analytical/evidence/Blacksite tests
remain required; the city does not replace them.

## What still requires the owner

Merge/deploy the feature branch to put the secret on production. For live Jev,
retain the existing TypeSafe server configuration and intentionally enable its
city toggle. No other credential is required. A local recognizability review and
manual artistic work remain necessary to approach the requested hyper-realism.
Exploration, the five supported scenario families and rules-only replay require
no model or paid service.
