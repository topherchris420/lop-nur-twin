# The Bethesda anomaly

Bethesda is an ordinary counterpoint to the desert: sidewalks, shops, buses,
routines and public life inside a geographically anchored experiment. It is an
explorable reconstruction built from real open geographic data and procedural
detail, **not hyper-realism and not a surveyed city twin**. Its purpose is to
show that the project's machinery — evidence classes, a decision gate between
proposals and authoritative state, seeded determinism, replayable traces — is
not about Lop Nur.

## Discovery (spoiler)

There is no button. Two hidden entrances, both in the analytical twin at `/`:

1. Press **backtick** (the key below Escape), enter `38.9847,-77.0947` (any
   coordinate inside the bundled bounding box works, as does `resolve bethesda`)
   and submit.
2. Open the **Site Index** (`I`) and type Bethesda's coordinates into its search.
   The index, which normally lists Lop Nur structures, shows an
   `UNRESOLVED FEATURE · 39° N 77° W · outside this site` row. Selecting it
   resolves the anomaly.

The transition reads **ANOMALOUS LOCATION RESOLUTION**: the telemetry drifts from
Lop Nur's 40.77252° N · 89.28122° E into 38.98470° N · 77.09470° W, glitching as
it goes, then settles on **39° N · 77° W · BETHESDA** and lazily loads the city.
Reduced-motion users see the settled card. Ordinary visits never request the
city or its data. The card says plainly what is being crossed: from the evidence
reconstruction into a simulation whose streets and terrain are mapped, whose
buildings are modeled, and whose people and events are invented.
**Return to the desert** remounts Lop Nur, and so does the
browser's Back: the city takes a history entry on the same URL while it is open
(`src/lib/historyLayers.ts`), and the lab one above it, so Back steps out of the
lab, then out of the city, and never off the site. Nothing opens from history —
a reload or a Forward lands on the twin — because the city has no URL of its
own and a fresh one would not be the run that was left. A page opened before a
deploy cannot load the city's renamed chunk; it says so and offers a reload
instead of failing silently (`src/lib/staleBuild.ts`).

Arrival is on mapped public pavement near the Bethesda Lane entrance. WASD /
Shift walks; on a touch screen a thumb-stick takes the map's corner (push it to
the edge to hurry) and a drag on the street looks, one finger at a time, so the
stick and a look work together. Keys and stick go through one function
(`walkIntent` in `walkInput.ts`), and every step either takes is the same
recorded `move` command, so a walk taken by thumb replays like one taken on
WASD. A phone folds the city controls to leave the street visible (**More
controls** opens them). **Survey** orbits; **Pedestrian seat** puts you in agent 0's shoes
with only its legal actions, and says what the gate did with each choice:
applied, replaced by a wait because it was no longer permitted, or refused
because the pedestrian is indoors (no actions are offered until they come out).
Click any building for a dossier. **Evidence view**
replaces detailing with massing tinted by evidence class. Field notes, the map,
scenarios, simulation and replay keep working when WebGL fails.

## Scenario telemetry

Backtick inside the city (or `~ telemetry`) opens the console. Requests are
compiled — by a deterministic rule compiler, **not a language model** — into
typed, bounded events, and the compiled JSON is shown before the world reacts.

- **Families (12):** fire, thunderstorm, Metro closure, parade/procession,
  unidentified object, vehicle crash, power outage, gas leak, rally/march,
  street festival, road closure, flash flood. Up to three per sentence
  ("A thunderstorm and a power outage hit Bethesda").
- **Places** come from a gazetteer built only from the data: every named
  street (and unambiguous short forms), intersections ("Woodmont and Bethesda
  Ave" resolves to the node both streets share), named buildings, parks,
  monuments, the Metro, the Purple Line works, trails and storefront names
  ("fire at Tastee Diner"). A single-word name needs a preposition ("a giant
  fire" is intensity, "fire at Giant" is a place). A place that is not in the
  extract is **refused**, not relocated ("Fire in Paris" fails).
- **Modifiers:** intensity (small / default / huge…) and duration ("for 5
  minutes", capped at 10 simulated minutes). Unstated places use documented
  defaults, labelled "default location" in the compiled output.
- Limits: 240 characters, eight simultaneous events, closed schema validated on
  injection and again on replay.

An event never scripts a response. It declares generic **effects** in
`EVENT_EFFECTS` — an area to avoid, something to look at, closed road and
sidewalk edges (and how much of its radius the road closure covers), a crowd to
join rather than watch from afar, a reason to shelter, a speed factor, dark
signals, a Metro service closure, units to dispatch — and agents' ordinary rules
respond to effects, not to event names. A test reads the agent rules and fails
on any event name in them. What emerges, for example from a fire:

- engines/ambulance from the mapped Bethesda–Chevy Chase Rescue Squad and a
  police unit drive real road edges (civil traffic pulls over), then **stage**;
  police stage at **perimeter posts** — the road nodes where open roads enter
  the closure — and barricades appear there;
- cars meet closed edges, queue, then **detour** (U-turn where the road is
  two-way, routing around closures) so side streets load up;
- pedestrians inside the perimeter leave; cautious ones leave from farther
  out; curious ones watch or record; a crowd draws more watchers; others carry
  on; nobody stops in a crosswalk;
- statistical district cohorts shift between outdoors, sheltering, watching and
  evacuated.

Other families reuse the same machinery: a **parade** is a moving closure along
~650 m of the mapped street with marching blocks and floats, police at its closure
posts and spectators; a **power outage** turns signals in its radius dark and every
approach into an all-way stop; a **flash flood** fills the real bare-earth DTM
to a level 0.5–1.4 m above the lowest road node near the place and closes the
road and sidewalk edges under it (a bathtub model, no hydrology); a **Metro
closure** closes the service, not the place — commuters at the entrance wait or
re-route to bus stops; a **storm** sends people to shelter, slows traffic, wets
the asphalt and flashes lightning; the **object** draws onlookers from 260 m and
gets a police response. None of these are physical models of fire, weather,
crowds or flooding.

## Real geography and licensing

### Roads, buildings, paths and terrain

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

### Streetscape and transit layer

A second OSM derivative, `src/bethesda/data/streetscape.json`, was downloaded on
2026-10-02 from the same bounding box (URL, retrieval time, raw and snapshot
hashes and counts in `streetscape-source.json`) and imported by
`scripts/import-bethesda-streetscape.py`. It is kept separate so refreshing it
never changes the road/building snapshot. It contains:

| Data                                                                | Count            | Used for                                                             |
| ------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| Named storefront / amenity nodes (`name` + shop/amenity/office)     | 370              | façade name panels, gazetteer, dossier tenants, shopper destinations |
| Monuments, memorials, public artworks, fountains                    | 21               | Madonna of the Trail, 10 artworks, 11 fountains, gazetteer           |
| Bus stops (with `shelter` tags)                                     | 60               | stop poles and shelters, commuter destinations, bus dwell points     |
| Bus route relations (Bethesda Circulator, Ride On, WMATA)           | 17               | ordered node chains the simulated buses drive                        |
| Purple Line construction ways and construction sites                | 10               | fencing on surface portions (tunnel portions are skipped)            |
| Mapped trees, street lamps, benches/picnic tables, bike-share docks | 22 / 11 / 53 / 8 | placed at their mapped points, in addition to procedural planting    |
| Building colour/material/roof tags joined by OSM ID **and version** | 25               | building dossier                                                     |

Contact details, opening hours, websites and mapper identities are not copied;
the build fails if such a field appears. Storefront names are OSM `name` tags
drawn as plain text in generic typefaces; no logos, trade dress or liveries are
reproduced. Bus routes are cut at the box: when a route's chain has a gap, the
bus paths across it on the road graph and that link is counted as inferred
(Circulator: 24 of 242 waypoint links). Non-loop routes leave the extract and a
new trip enters at the route start. This layer is ODbL 1.0 like `osm.json`;
Field notes can download it.

Road widths now come from mapped `lanes` tags (lanes × an assumed 3.3 m plus
gutters) on 122 fragments; the other 354 keep class defaults. Divided avenues are
mapped as two one-way carriageways, so a one-way primary default is now one
carriageway (11 m) rather than a whole avenue (18 m); previously each of
Wisconsin Avenue's two carriageways was drawn 18 m wide.

## Reference comparison

One public reference was compared at the same corner: G. Edward Johnson's
[Woodmont Avenue / Bethesda Avenue intersection, 30 March
2025](https://commons.wikimedia.org/wiki/File:Bethesda_downtown_intersection_2025-03-30_11-38-17.jpg)
([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). It changed three
things in this revision: street blades now use the county's "Av" abbreviation
("Bethesda Av"); signals hang from mast arms reaching most of the way across the
carriageway from a curbside pole, with three heads and a blade naming the cross
street (OSM places the signal node on the road; pole side, arm length and head
count are inferred from mapped width and the photo; the cross-street name is the
other mapped street at that intersection); and the mapped Woodmont Avenue
cycletrack carries green conflict-zone paint near crossings (paint extents
inferred). The photo also shows what is still missing: block-number plates and
arrows on the blades, more heads per arm, "NO TURN ON RED" and other regulatory
signs, bollards and planters at the curb, leaf-off/spring trees, the Anthropologie
corner's distinctive grey bay and parapet, and construction hoardings. This was
qualitative comparison at a matched viewpoint, not image alignment, photogrammetry
or a pixel-error measurement. The reference is not shipped, not used as a texture,
and must never be presented as an achieved render. Earlier passes also used the
[EPA Bethesda Row case
study](https://www.epa.gov/smartgrowth/create-walkable-neighborhoods-bethesda-row-bethesda-maryland)
and architect/lighting-designer project pages as qualitative references only.

## What is real, inferred, procedural — and what still looks fake

**Genuinely derived from real Bethesda data**

- Every building footprint (1,166, including two courtyard multipolygons), road,
  path, crossing, signal location, park, Metro entrance and elevator, and the
  rescue station: OSM.
- Street names on the blade signs and the intersections they stand at; road
  widths where lane counts are mapped (122 fragments); one-way topology.
- 40 building heights (community height tags) and 33 level counts.
- 370 storefront names and where they are; 21 monuments, artworks and fountains
  including the Madonna of the Trail (OSM, with its Wikidata ID); 60 bus stops;
  17 bus route relations including the Bethesda Circulator; the Purple Line
  construction alignment; 22 trees, 11 lamps, 53 benches/tables, 8 bike docks.
- Ground elevation everywhere (Montgomery Planning bare-earth LiDAR DTM, coarse
  crop), and therefore which streets flood first.

**Inferred** (from real data plus a stated assumption)

- 33 heights from levels × 3.3 m; widths from lanes × 3.3 m; which façade edge a
  storefront's name goes on; blade-sign corners; signal mast-arm side and
  length; the Metro canopy's orientation; bus links across route gaps; police
  staging at the extract edge (no police station is mapped inside it).

**Procedural / illustrative**

- 1,093 building heights (typology guesses), every façade, window, cornice,
  roof and colour; sign typography and colours; sculpture forms (each artwork is
  a generic steel form at its mapped point; the Madonna is simplified massing,
  not a likeness); most trees, furniture and lamps; cars, buses, emergency
  apparatus and people; all behaviour, demand, schedules, signal timing, the
  population numbers and the district cohorts.

**What looks convincing**

- The street plan and its relationships, especially from Survey and on the
  minimap; Bethesda Row / Bethesda Lane's brick-and-storefront rhythm; walking
  Bethesda Avenue past real shop names (Georgetown Cupcake, Sweetgreen, CAVA,
  Anthropologie…); street blades naming real corners; Circulator and Ride On
  buses on their real streets; the Madonna of the Trail standing where she
  stands; the Metro entrance where it is; the Purple Line still under
  construction.

**What still looks fake**

- Generic façades that repeat (most named buildings look nothing like
  themselves: the Hyatt, Marriott HQ, Bethesda Metro Center, the Farm Women's
  Market); flat roofs everywhere; too-uniform foliage; capsule-and-sphere
  people and parade marchers; box-bodied buses and apparatus; flame cones and
  sphere smoke; a flat water sheet; signage that is text on panels rather than
  real signs; empty interiors; no night, no seasons; software-rendered captures
  run at 0–2 fps here, so motion has not been judged on a real GPU.

**What would still require manual artistic work**

- Landmark façades and roofs (Hyatt, Marriott HQ, Metro Center plaza and bus
  bays, Farm Women's Market, Bethesda Theatre marquee, Post Office, Row corner
  buildings); measured heights for the ~1,100 untagged buildings; a curated
  street-tree survey; real signal, sign and furniture families; the Metro
  escalator well; better civilian anatomy and animation; a local's walk-through
  to list what is wrong.

## Simulation and performance

The simulation (`simulation.ts`) has no renderer imports and runs fixed 0.1 s
ticks on its own timer, including without WebGL. All randomness is the shared
`mulberry32`. A uniform spatial index made ticks roughly 9× cheaper (≈1 ms for
360 pedestrians, 70 cars and 14 buses in Node on this container).

- **Population** is chosen once from reported hardware and recorded in the
  trace: 140 / 32 / 6 buses on ≤ 4 cores, 360 / 70 / 14 otherwise, 640 / 110 /
  20 on ≥ 12 cores with ≥ 8 GB. Eight responders (three engines, two
  ambulances at the rescue station, three police at the extract's edge) are
  additional.
- **Simulation levels of detail:** agents within the _focus radius_
  (280 / 420 / 650 m by profile) of the viewer, or near any event, plus all
  responders and buses, update every tick; others update every fourth tick with
  a 4× step; districts are stock-flow cohorts (900–2,800 illustrative occupants)
  updated at 1 Hz. The focus is a **recorded command**, so a camera- or
  hardware-driven budget never makes replay nondeterministic. Individuals never
  convert into cohort members or back.
- **Routines:** pedestrians carry a seeded persona (commuter, shopper, resident,
  worker, visitor) that picks destinations from real places — the Metro, bus
  stops, storefronts, offices, homes, monuments, parks. They enter buildings,
  take the Metro (out of view, then re-emerge), wait at stops and board buses
  (re-appearing at another stop), linger, and cross on signals. These schedules
  are illustrative, not measured demand.
- **Traffic:** one-way topology, illustrative 50 s signal cycles, crosswalk
  yielding, headway, intersection reservation, emergency yielding, closures,
  detours, all-way stops under outages, curb dwells, bus stop dwells. There is
  no calibrated demand, lane changing, continuous vehicle physics or citywide
  congestion forecast.
- **Rendering** culls static tiles by distance, instances people and vehicles,
  drops pixel ratio and shadows under sustained low frame rate, and offers
  auto / detail / economy. Static streetscape text is two canvas atlases (1024² for
  street blades, 2048² for names), merged into tiled draws. No frame-rate target is claimed.

Tone mapping uses the shared owner in `src/components/scene/Atmosphere.tsx`.

## Jev's actual authority

Jev is **off by default**. With the toggle on, the existing server-only TypeSafe
configuration answers `/api/jev/decision` using a separate, closed city schema
(`bethesda-observation/v2`).

`observation → legal actions → Jev proposal → deterministic validation → simulation`

- **What Jev sees:** the agent's role and persona, the nearest hazard and
  attraction (kind and distance only), whether it is inside a perimeter, storm
  shelter advice, traffic nearby, an approaching emergency vehicle, crossing
  state and safety, dark signals, blocked or closed route ahead, whether it is
  at a building portal, gathering place, bus stop (with a bus boarding) or Metro
  entrance and whether the Metro is open, assignment, and a crowd bucket.
  No coordinates, IDs of other agents or world state.
- **What Jev chooses:** one action from the offered set (e.g. continue, wait,
  watch, record, leave, shelter, enter, gather, cross, board; or drive, detour,
  stop, pull over, park, respond). Actions are offered by mechanics only.
- **What Jev never controls:** routes, destinations, speeds, signals, closures,
  dispatch, other agents, events, the camera or any world state. The broker
  samples agents involved in events (or, with nothing happening, a pedestrian
  at a choice point), one request in flight, every 2.5 s, 1.2 s deadline,
  120 requests per session.
- **Fallback:** unavailable, timed out, malformed, illegal or stale (> 15 ticks)
  answers are recorded as `fallback` with the reason and the rule that took
  over, and the deterministic rule selector decides. Labels follow Blacksite's:
  `LIVE JEV` only after a validated answer, otherwise `FALLBACK · TIMEOUT /
UNAVAILABLE / ERROR / STALE OR INVALID / AGENT INDOORS`. Provider usage is
  `null`, never invented.
- **One gate for every chooser.** An agent indoors is not choosing: the rules
  do not decide for it until it comes out, so neither can Jev or the person in
  the pedestrian seat. An answer or a click that arrives while the agent is
  inside is recorded as a command — a replay meets the same gate — and applied
  to nothing.
- **Without Jev** everything runs on the rules. No live Jev Bethesda run is
  claimed in this repository; tests use offline doubles and never spend credit.

## The R.A.I.N. Lab

Somewhere in the city is an unmarked door to a research lab where R.A.I.N.'s
four perspectives investigate questions and their hypotheses become matched
experiments on this simulator — never on the city you are walking through, and
never without a person's authorization of the exact definition. The lab's
research runtime lives in this repository (`src/rain/`) and runs inside the
site's own server. The lab is fictional, its pictures are not evidence, and
its results describe the simulator, not Bethesda. Its DEMO is labelled as a
recording, it is OFFLINE whenever the runtime is switched off, could not start,
did not answer or has not been checked yet, and the city never waits on it. Discovery, the
protocol, LIVE configuration and every boundary are in
[the R.A.I.N. Lab guide](RAIN_LAB_BETHESDA.md).

## Replay and verification

Traces (`bethesda-replay/v4`, simulator `bethesda-city/4`) carry the simulator
version and the hashes of the OSM snapshot, the DTM crop and the
streetscape/transit layer, the config, and
every tick-stamped command: scenarios, Jev proposals and failures, human seat
choices, explorer movement and LOD focus changes. They also carry every
decision with its observation, proposal, source, reason, before/after state and
outcome tick; checkpoints every 100 ticks; and the final hash. Re-import
regenerates the run and verifies checkpoints, decisions and final state.

One trace holds at most 18,000 ticks (30 minutes of city time), 30,000
commands and 60,000 decisions (`REPLAY_LIMITS`). Past any of them the recording
is incomplete and would not verify, so export is refused. The panel beside
**Export replay** counts down the city time left, adds a count once one comes
within a tenth of its limit, and once the recording is full disables export and
says to reset the city.

Routine rules decisions that merely re-affirm the open decision extend its
outcome window instead of adding a record (the HUD shows how many were folded),
so the decision log holds transitions: a 3,200-tick run with four events went
from 43,092 records to 4,018 and a 3.7 MB trace. Traces recorded by another
revision of the simulator (`bethesda-replay/v1`–`v3`, or another
`bethesda-city/N`) are refused with an explanation rather than replayed against
different rules; v4 began when indoor agents stopped taking choices. Replay
reproduces authoritative state, not pixels. A verified replay replaces the city,
paused at its last recorded tick, and stays badged `REPLAY` with the file and
that tick; once resumed, the badge says the ticks after it are new, not the
recording.

```sh
npm run test:bethesda     # city, effects, presentation, lab and server tests
npm run test:run
npm run build             # includes validate:bethesda (both OSM layers, DTM)
npm run verify:bethesda   # browser: discovery (both entrances), scenarios,
                          # outage fallback, walking, replay, a11y, CSP, return
npm run verify:rain-lab   # browser: the hidden lab (see RAIN_LAB_BETHESDA.md)
node tools/bethesda-look.mjs  # street and survey frames; the README shows its
                              # street-detail.png and survey-detail.png
```

## What still requires the owner

- Merge and deploy the branch to put the anomaly on production.
- For live Jev, keep the existing TypeSafe server configuration and switch the
  city toggle on; nothing else needs a credential.
- A local's recognisability review, and the manual landmark and height work
  listed above, to move from "recognisable plan" toward "recognisable place".
