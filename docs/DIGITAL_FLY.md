# The digital fly

One adult _Drosophila melanogaster_ lives in Bethesda: FlyBody's anatomy at its
true size, driven by a reduced-order behavioural controller, sensing the city it
is in and inspectable from a panel. It is also an experiment substrate for the
R.A.I.N. Lab, in enclosed arenas (see [the lab guide](RAIN_LAB_BETHESDA.md)).

It is **not a simulation of the fly's nervous system**. Its reduced-order and
circuit-informed controllers simulate no neuron, synapse, connectome or muscle;
the opt-in mushroom-body controller, used only in the yard studies, simulates
the rate units of one learning circuit (2,000 Kenyon cells, two output and two
dopaminergic neurons), not spiking neurons or a connectome
([below](#the-mushroom-body-controller)). The brain regions the panel names are
a reference layer: where, in a real fly, the functions the controller imitates
are known to be processed. Everything the simulator reports describes the
simulator, not a fly, and nothing in it is evidence of experience or awareness.

Code: `src/bethesda/fly/` (`FLY_VERSION` is `digital-fly/7`). Importers:
`scripts/import-flybody.ts` (with `scripts/mjcf.ts` and `scripts/decimate.ts`)
and `scripts/import-vfb-reference.ts`. Experiments:
`src/rain/scientific/fly.ts` and `scripts/rain-fly.ts`.

Next development: [fly priorities and acceptance criteria](FLY_PRIORITIES.md).

[Project ECHO](PROJECT_ECHO.md) adds an opt-in computational self-model
(`src/bethesda/fly/echo/`): the reduced-order controller with a forward model
of its own self-motion, Bayesian estimates of its own movement gains, change
detection, causal attribution, caution and episodic memory between its
intentions and the body. It reads a self-motion sense and experimenters'
perturbations act on the body (`selfMotion.ts`, `perturbation.ts`); a fly
whose controller does not ask for them runs exactly as before. The city's fly
keeps the reduced-order controller unless the panel's experimental choice
places one with ECHO's.
Reliable movement in physical simulation comes first; independent recordings
guide the locomotion, aerodynamic and sensory milestones.

## Sources and licences

| Material                                                                            | Source                                                                                                                           | Licence                             | In the repository                                                                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Body model: MJCF skeleton, visual meshes, materials, eye cameras                    | [TuragaLab/flybody](https://github.com/TuragaLab/flybody) at `d015e9bf…` (Vaxenburg et al. 2025, doi:10.1038/s41586-025-09029-4) | Apache-2.0                          | Derived JSON in `src/bethesda/fly/data/`, with `LICENSE.md` and the modification list in `flybody.source.json` |
| FlyBody trained policies, reference trajectories, grooming poses (figshare)         | doi:10.25378/janelia.25309105                                                                                                    | GPL-3.0                             | **Not imported**                                                                                               |
| JRC2018Unisex template (VFB_00101567) and painted neuropil domains                  | [Virtual Fly Brain](https://virtualflybrain.org/reports/VFB_00101567)                                                            | CC-BY-NC-SA 4.0 (as VFB reports it) | **No geometry.** Ids, labels and licence metadata only; the panel links to VFB                                 |
| FBbt anatomy classes: labels and definitions                                        | FlyBase anatomy ontology via VFB (Court et al. 2023, doi:10.3389/fphys.2023.1076533)                                             | CC BY 4.0                           | `data/vfb-reference.json`                                                                                      |
| LPLC2→GF and LC4→GF class connectivity                                              | VFB `query_connectivity`, as returned (datasets VFB excluded are recorded)                                                       | VFB terms                           | `data/vfb-reference.json`                                                                                      |
| Grooming ethograms of dusted and undusted flies, and the grooming model's constants | Zhang, Guo & Simpson 2020, Mendeley Data doi:10.17632/fxz8dgywcd.1                                                               | CC BY 4.0                           | Summary statistics and constants only, in `data/grooming-reference.json` (no per-frame data)                   |

FlyBody's modifications, as `flybody.source.json` records them: visual mesh
geoms only, transformed into their body frames; merged per body and material,
welded and reduced by quadric edge collapse to two levels of detail (39 965 and
5 161 triangles from 272 550); positions quantised to 0.25 µm; texture
coordinates and normals dropped (FlyBody's materials are untextured); skeleton
transcribed from the MJCF with default classes resolved. The collision,
inertial and fluid geoms, actuators, sensors and `drosophila.blend` are not
imported. The importer measured the body at 0.2969 cm (the paper: 0.297 cm),
the wing at 0.2645 cm and the standing height at 0.1319 cm (from the thorax
down to the lowest claw tip in FlyBody's zero pose; the fly stands lower, see
[Contacts and landings](#contacts-and-landings)).

Three of the fly's parameters come from FlyBody's code at the same commit and
link to the file: the eye cameras' 150° field, which FlyBody's walker sets
(`flybody/fruitfly/fruitfly.py`), and the 47.5° hover body pitch and the
wingbeat's ±5 % range (`flybody/tasks/constants.py`). The other FlyBody values
cite the paper.

Re-import (never hand-edit the data; the build validator checks every hash):

```sh
git clone https://github.com/TuragaLab/flybody <checkout>   # then check out the pinned commit
npm run import:flybody -- --from <checkout>
npm run import:vfb
```

## Why a reduced-order controller

The full FlyBody stack is MuJoCo physics at sub-millisecond steps over 102
hinge joints, driven by reinforcement-learned policy networks. Those networks
are in the GPL-3.0 figshare release, which this Apache-2.0 repository cannot
carry, and stepping that model in every browser frame for one fly in a city
would cost far more than the city itself. So the fly keeps FlyBody's
**anatomy** exactly (skeleton, joints, ranges, meshes, colours, eye cameras),
the values FlyBody gives its model (the 150° eye field, the 47.5° hover pitch,
the 218 Hz wingbeat and its ±5 % range) and the figures it reports for its
trained policies (the walking speed range, the stance counts, the 30 cm/s
cruise), and replaces the **dynamics** with a stable reduced-order model. That
reduction is the main limitation, and the panel says so. FlyBody's values
describe its model of a fly, not measurements of one.

## What is simulated, and what is only drawn

The fly advances on a fixed clock independent of rendering: the body every
5 ms, the eyes every 10 ms, the controller every 50 ms on the sample from
30 ms before. Stepping 0.1 s at a time and 0.005 s at a time give the same
trajectory; one seed gives one fly (three derived `mulberry32` streams: body,
senses, controller).

**Simulated** (state, hashed, replayed):

- the centre of mass and its velocity: an exponential approach to the
  commanded velocity (time constant 80 ms; any value from 0, which follows at
  once, is stable) limited to 1.5 g, with contacts, touchdowns and perch
  continuity (see [Contacts and landings](#contacts-and-landings));
- heading, with saccades as 80 ms bell-shaped turns (mean amplitude 90°,
  Tammero & Dickinson 2002) and a refractory period;
- mode: rest, groom, walk, feed, takeoff, escape, flight (cruise, saccade,
  hover) and land (approach, legs extended at a 60° target size, van Breugel &
  Dickinson 2012);
- grooming: a bout starts at a body site drawn by weight (eyes 0.3, antennae
  0.25, abdomen 0.2, wings 0.15, notum 0.1) and cleans it; then the legs that
  cleaned it rub each other (the front legs after the eyes or antennae, the
  hind legs after the others); then the bout ends (`groomStopP`) or moves one
  site back, in the anterior-to-posterior order of Seeds et al. 2014, ending at
  the notum at the latest;
- takeoff and escape: a preparation, 200 ms for a voluntary takeoff or a
  long-mode escape and 40 ms for a short-mode one (any preparation under
  100 ms is short-mode), in which the body keeps its heading and leans toward
  the jump: the postural adjustment that aims the jump away from a threat
  (Card & Dickinson 2008). A long-mode takeoff raises its wings before the
  jump, a short-mode one jumps with them folded (von Reyn et al. 2014); the
  raise takes the last `longModeSequenceMs` (13.2 ms, the paper's mean
  long-mode sequence) of the preparation. A command may say which mode it
  wants (`wings`), and a later, shorter `prepare` brings the jump forward
  (never later): with the wings already rising it stays long-mode, otherwise
  it becomes short-mode, as a giant-fiber spike cuts a long-mode takeoff short
  in the paper. The jump leaves along
  the aimed heading at `jumpElevationDeg` above the horizontal, and in the air
  the heading turns to it in one saccade-length turn while the jump's
  direction holds;
- the escape proxy as a fast pathway: besides deciding every 50 ms, the
  controller sees every 10 ms sample in between (`interrupt`), and what it
  commands there passes the same gate. An escape starts with the first sample
  over threshold, a constant 30 ms (the sensory latency) after it, where it
  waited 30–70 ms for the next decision before. In flight the proxy sets off
  an evasive saccade away from the threat, and a landing fly breaks off its
  approach to make it;
- landing deadlines: an approach is abandoned once it has run `landTimeoutS`
  longer than the approach law needs from the distance it began at, so every
  site within `landingSearchM` can be reached;
- the gait clock: step period, duty factor and inter-leg phase lag from the
  speed of the feet over the ground (the walking speed plus the turn rate
  times the feet's 1.7 mm from the body's vertical axis, so a fly turning on
  the spot steps round), between FlyBody's 3.9 and 3.1 legs in stance at 1 and
  4 cm/s, shifting from tetrapod to tripod coordination as speed rises;
- habituation of the escape proxy (Engel & Wu 1996): each escape removes 22 %
  of the responsiveness left, which recovers toward full with a 30 s time
  constant;
- the energy reserve, drawn on at each mode's metabolic power and refilled by
  feeding, and what the controller believes and remembers: its path-integrated
  position, the places it fed, the squares it has been in (see
  [Energy, food, shelter and navigation](#energy-food-shelter-and-navigation));
- in the city, the people near the fly: what each makes of it, whether they
  have noticed it, and their swats (see
  [People who notice the fly](#people-who-notice-the-fly)).

**Derived for drawing** (computed from the simulated state, never fed back):
body pitch and roll that turn the hover thrust axis (FlyBody's 47.5° body
pitch) onto the thrust the motion needs, so the drawn fly banks into turns
and pitches with its acceleration, with the thrust never drawn below 0.1 g
upward; wingbeat frequency
within FlyBody's ±5 % from that load; left/right stroke amplitude from yaw
acceleration.

**Drawn only** (`pose.ts`, `FlyView.tsx`): leg placement by damped
least-squares inverse kinematics on FlyBody's own leg chains (coxa, femur,
tibia within the MJCF's ranges) on the simulator's per-leg phases, so the
drawn tripod or tetrapod is the simulated one: a stance foot stays where it
touched down while the body walks or turns over it, and a swing foot is lifted
and carried to its next touchdown; grooming leg movements, and the leg rubbing,
which brings the two front or the two hind claws together; the
wing stroke, FlyBody's own prototype pattern (`pattern_generators.py`, which
FlyBody calls an approximation; the trained flight pattern is GPL and not
used); halteres in antiphase.

**Not simulated at all**: aerodynamics and wing forces, leg contact forces,
muscles, neurons, haltere sensing, olfaction beyond one food-odour level,
temperature, humidity, wind, taste beyond food or none, and sound.

## Contacts and landings

The body moves by ray casts against the static world, stopping its thorax its
standing height short of any surface on its path. Moving things are not in
those casts (see [Senses and the world](#senses-and-the-world)).

- **Standing height.** The thorax stands 1.06 mm above the surface: 0.8
  (`standingCrouch`) of the 1.32 mm from the thorax down to the lowest claw
  tip in FlyBody's zero pose. That pose (every joint at 0, the MJCF's
  reference configuration) is not a measured stance; at 0.8 the drawn legs
  bend to reach the surface. It is a drawing choice, not fitted to FlyBody's
  walking policy or to a fly, and it is also the clearance for contacts and
  touchdowns.
- **Contacts.** Meeting a surface is a collision, counted and logged once, when
  the contact begins. While the contact lasts (the surface stays within the
  standing height plus 1 mm), the part of the velocity into the surface is
  removed and the fly slides along it; at the first touch it keeps
  `contactKeep` (30 %) of its speed along the surface. `contactS` counts the
  airborne seconds in contact, and the panel shows them beside the collisions.
- **Landing targets.** A landing names a site the body offered and a point on
  its top, which the gate checks (see [The decision gate](#the-decision-gate)).
  The body moves the point onto the surface under it, and the approach brings
  the feet, not the thorax, to it. A decision maker may change the target
  during the approach.
- **Touchdown.** It is tried when the feet come within 1.5 mm of the target at
  no more than the touchdown speed (0.15 m/s), or when a landing fly meets a
  top (a surface whose normal is at least 0.7 vertical) that slowly. The body
  then needs a walkable surface within 2 mm under the feet and stands the fly
  on it, so a touchdown never moves the fly more than 2 mm to meet a surface.
  If there is none, or it is farther, the landing is aborted with the reason
  logged, and the fly climbs away at 0.1 m/s and flies on; any other contact
  while landing aborts it the same way. The controller waits `landRetryS`
  before it chooses a site again.
- **A touch while cruising.** A slow touch on a top while not landing counts as
  a collision, and the fly then settles on that top by the same 2 mm rule.

## Senses and the world

The eyes are FlyBody's two eye cameras (`eye_left`, `eye_right`, whose axes the
importer reads from the MJCF), sampled by ray casts with occlusion and a 4.6°
acuity limit. The MJCF declares them 140° wide; FlyBody's walker
(`fruitfly.py`) sets both to 150° (vertically, on square 32 × 32 images) when
it builds the fly, and the simulator uses that 150° (`eyeFovDeg`). Aimed 67°
either side of straight ahead and 5° up, and treated as circular cones, they
see to about 142° either side at eye level, leaving a blind sector of about 76°
behind, and straight ahead from about 37° below the horizon to 63° above it.
Nothing more than about 80° above or 70° below the horizon is seen, where a
real fly's eyes still see. Glass is invisible but solid.

From each sample the controller gets: the strongest looming object (angular
size, expansion rate and a giant-fiber **proxy** — a weighted sum of expansion
rate and a size tuning, after Ache et al. 2019 and von Reyn et al. 2014), the
number of moving things in view, times to contact ahead-left, ahead-right and
ahead, clearance, a relative light level and its bearing, the surface below
and the altitude, the food odour (a still-air proxy), whether it is under an
open sky (its compass), the landmarks in view and, in flight under a sun, the
bearing of the nearest shade on the ground. Nothing is special-cased by what
it is: a pedestrian, a car,
the visitor and an arena stimulus are all moving things that loom or do not.
Moving things are seen, never touched: they can set off an escape, but the
body's ray casts and the solidity and landing tests leave them out, so they
pass through the fly, and one that contains the fly is not seen at all.

| World input            | In Bethesda                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In a lab arena                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Surfaces and obstacles | OSM building footprints and heights, with their courtyards open and the rooftop units and shop awnings drawn on them; bare-earth terrain; the mapped benches, picnic tables, lamps and trees; and the procedural footpath trees and sidewalk lamps, benches and planters; each placed where the renderer draws it (`furniture.ts`): benches (slat by slat), tables, planters, rooftop units and awnings as their drawn boxes, poles and trunks as tapered cylinders, and lamp globes, crowns and shrubs as ellipsoids (below) | walls, ceiling, pillars, platforms                 |
| Moving things          | city pedestrians and vehicles and the visitor, interpolated between city ticks, and the hands of people swatting at the fly; seen, never touched                                                                                                                                                                                                                                                                                                                                                                              | looming spheres on a schedule; seen, never touched |
| Light                  | **proxy**: open sun or building shade along the renderer's sun direction, dimmed in a storm by the renderer's storm/clear ratio                                                                                                                                                                                                                                                                                                                                                                                               | point lights and ambient                           |
| Windows                | **unsupported**: not in the map data; facades are opaque                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | glass panes: invisible, solid                      |
| Facade relief          | **unsupported**: drawn, not solid; a facade is a flat wall                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | none                                               |
| Food and its odour     | **proxy**: a patch on the ground at the door of every mapped place that sells or serves food or drink; its odour falls off as e^(−d/5 m) in still air and does not pass through solids                                                                                                                                                                                                                                                                                                                                        | **unsupported**                                    |
| Temperature, wind      | **unsupported**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **unsupported**                                    |

The street furniture and trees, and the rooftop units and awnings on the
buildings, are placed and sized in one module, `src/bethesda/furniture.ts`,
which the city builder draws from and the fly's world is built from, so each
stands where it is drawn, at its drawn size. The street bench's four slats are
separate, with the 1.5 cm gaps between them open; an awning is the half of the
drawn one that reaches out of its wall, 0.6 m (the other half is inside the
building); a building's courtyards are open from the ground up. The round
shapes are smooth where the drawn ones are faceted, and
`BETHESDA_INPUTS.proxies` names the difference:

- lamp poles and tree trunks taper as drawn (in radius, trunks from 25–28 cm
  to 15–16 cm and poles from 9 cm to 5.5 cm), as round cylinders through the
  corners of the drawn five-, six- and eight-sided ones, whose faces lie inside
  them by up to 19 % of the radius (street-tree trunks), 13 % (mapped trunks)
  and 8 % (poles);
- tree crowns, lamp globes and planter shrubs are ellipsoids, squashed or
  stretched as the renderer draws them (street-tree crowns to 0.85–1.15 of
  their height, globes to 1.45, shrubs to 0.8), through the corners of the
  drawn icosahedra and low-polygon spheres. Their tops are drawn corners and
  match; elsewhere the drawn faces lie inside them by up to 6.6 % of the
  radius (crowns, so up to 16 cm on the largest, of 2.4 m radius), 10 %
  (globes) and 7 % (shrubs). Leaf cards are not solid.

Drawn but not in the fly's world at all, so the fly can pass through them
(`BETHESDA_INPUTS.unsupported`): facade relief on the detailed blocks (ledges,
pilasters, window frames, sills, rails), so facades are flat walls; and the
other street objects: traffic-signal poles and mast arms, bus stops and
shelters, bike-share docks, street-name blades and signs, monuments and art,
the metro entrance, construction fencing, the Bethesda Lane ring lights, tree
pits and limbs. The whole mapped city is in the fly's world: 2 739 boxes,
1 168 cylinders, 3 866 ellipsoids and 1 166 building prisms, built in 0.1–0.2 s
in a cloud container, and kept in a grid of 4 m cells by their footprints, so a
query looks only at the cells it crosses and finds what a scan of every
primitive finds (a test checks every kind of query).

Every world query is bounded: a ray or perch query with an input that is not
a finite number finds nothing, a point that is not finite counts as solid, and
a ray over the terrain samples it at most 4 096 times, however far it reaches.

The city fly reads the city and never writes to it. It is not a recorded
command, not in the city's state hash and not in a city replay; a replayed
city gets a fly placed fresh. `cityFly.test.ts` checks that a city run with
the fly and one without end with the same state hash. The fly is placed on the
mapped bench or picnic table nearest the arrival point and may go anywhere in
the mapped city. It is kept 20 m inside the map's edge (`CITY_EDGE_M`), past
which the model has no city, and below a ceiling 10 m above the tallest
building on the highest ground: a simulator constraint, named as such, where
the fixed 18 m home range of `digital-fly/5` and earlier was. There is exactly
one fly in the city; the lab's experiments use their own arena flies, which
never appear in the city.

## Energy, food, shelter and navigation

`digital-fly/6` gives the fly a body that runs down and must eat, a sense of
where it is and has been, and a preference for shade, so that it can live in
the whole city instead of an 18 m tether. Every value below is a parameter
with its class and source (`params.ts`) or a fixed choice listed under
[Parameters](#parameters); none is fitted.

**Energy.** A carbohydrate reserve, full at `reserveJ` (1.41 J): two hours of
flight at `flightPowerMw`, as a well-fed fly can fly for about 2 h (Warren,
Giraldo & Dickinson 2019). Flight and landing cost `flightPowerMw` (0.196 mW:
the hovering cost of 664 W per kg of flight muscle in Lehmann & Dickinson
1997, times its flight-muscle share of 0.30 and FlyBody's 0.983 mg), rest and
feeding `restPowerMw` (0.025 mW, the same paper's 85 W/kg), and walking,
grooming and preparing a takeoff `walkPowerMw` (0.05 mW, a model choice). The
fly feels its reserve as a share of full; hunger is one minus that share.
Hunger multiplies the rates of spontaneous walking and takeoff by
1 + 0.6 × hunger (starved flies are about 60 % more active, Yu et al. 2016; the
linear scaling is a model choice); above `hungerSeek` (0.2) the fly is
hungry; below `flightReserveFloor` (5 %) it no longer takes off on its own,
though it still escapes. A fly is placed full (`startReserve`), except in the
city, where it starts at 0.6 (`CITY_START_RESERVE`) so that it forages. The
fat a fly also stores is not modelled, so the reserve is all the energy there
is, and a fly whose reserve runs out still walks and rests: nothing here
dies.

**Food.** A world may hold food patches; in Bethesda there is one, 50 cm
across, on the ground 0.4 m out from the wall of every mapped place that sells
or serves food or drink (restaurants, cafes, bakeries, bars, grocers and the
like: 140 of them), standing for its bins, spills and tables. The feet taste
the patch they stand on (within 1 cm of its height); `feed` is a mode, which
the gate allows from rest or walking only with food under the feet. Feeding
takes in `feedIntakeMw` (2.25 mW: the 0.21 µL meal of 100 mM sucrose, 0.12 J,
that Qi et al. 2015's starved flies drank over the 52.8 s they spent feeding)
until the reserve is full; a meal lasts an exponential draw of mean `mealS`
(52.8 s, the same paper's mean bout) and ends sooner at 98 % of full. A
hungry fly on food eats; a fed one does not. Patches are landing sites too,
landed on at their centre, and a hungry fly that sees one lands on it.

**Odour.** Each patch adds e^(−d/5 m) at a distance d, out to 30 m: a
still-air proxy with no wind or plume, so it carries no direction but its
gradient. It does not pass through solids: a patch adds nothing where the
line to the air 0.3 m above it is blocked (no odour flows round a building
here either). A hungry fly responds from `odourDetect` (0.01: about 23 m from
one patch). It follows the odour by klinokinesis: walking, it turns at 0.3
times its usual rate while the odour rises and 3 times while it falls; flying,
it makes spontaneous saccades at 0.25 and 3 times their rate. In odour a
hungry fly gives up a long flight, and its flight bout runs on to 20 s, the
longest bout the body draws. Leaving food still hungry, it searches locally
for `localSearchS` (120 s; flies search locally for minutes after food,
Corfas, Sharma & Dickinson 2019): its walking turns back toward the food, by
its own estimate, once more than `localSearchM` (4.5 cm, about 15 body
lengths, the mean excursion just after food in Behbahani et al. 2021) from it.

**Shelter.** A fly that is not hungry lands to rest, and rests in shade:
flies' daytime sleep is nearly all in the shade, with a preference index of
0.98 in Meyerhof et al. 2024 (`shadePreference`). When a flight bout ends and
the sun is on a site on offer or on the ground below, the fly draws once, with
P(shade) = (1 + 0.98) / 2, whether to look for shade. If it does, it lands
only in shade; with none on offer it flies on, steering toward shade on the
ground that its eyes see (on two rings round it at half and all of
`landingSearchM`, in eight directions, nearest ahead first), until its flight
has lasted 40 s. A hungry fly forages instead. Without a sun (an arena, the
lab) there is no shade to prefer.

**Path integration.** The fly adds up its own travel every decision
(`navigation.ts`). Its distance has a relative error drawn afresh for each
walking bout or flight (a standard deviation of 0.29 × `odometryNoise`) and
held through it, so the error grows with the distance. Its heading holds to a
compass, the sky (a world with a sun: the sun or its polarization, in sun or
shade) or the dominant light (a lamp in an arena), within a spread of
0.29 × `compassNoiseDeg` (3°; flies hold a heading to the sun for up to 2 h,
Giraldo et al. 2018), and wanders as a random walk ten times faster without
either. So the estimate wanders from the truth, as path integration does
(Behbahani et al. 2021 for walking flies near food).

**Places and landmarks.** Where the fly fed is remembered at its estimated
position with up to three landmarks then in view: upright posts, poles and
trunks at least 1 m tall, within `landmarkRangeM` (8 m), in an eye's field
and in clear view, looked for ten times a second. Seeing one of them again
tells the fly where it is: its estimate is reset to the truth, as recognizing
a place would (flies keep visual place memories for at least 2 h, Ofstad,
Zuker & Reiser 2011). A place is forgotten after `placeMemoryS` (2 h), or
after the fly has come back to it twice and found neither food in view nor its
odour; at most 12 are kept.

**Where it has been, and long flights.** The fly keeps the last 400 of the
10 m squares of its own estimate it has been in. A share `exploreShare` (0.3)
of its spontaneous takeoffs start a long flight. Hungry, and remembering food
at least 5 m away, it flies back to it; otherwise to a point an exponential
draw of mean `exploreDistanceM` (60 m) away, toward whichever of eight
directions (at a random offset) crosses the fewest squares it has been in,
kept inside its extent and off headings that stalled near there. Steering by
its own heading estimate (menotaxis), it holds its course without spontaneous
saccades, at `dispersalCmS` (1 m/s, the groundspeed of flies dispersing in
still air in Leitch et al. 2021) while more than 5 m from the goal (clutter
still slows it). After turning from a surface it holds the new course for 3 s
before turning back toward the goal. It arrives within 3 m of the goal by its
estimate. A long flight that has not come a metre closer in 20 s has stalled:
that heading is then avoided within 10 m of there for 60 s, and the fly tries
another, landing when none is left. A landing site whose approach was
abandoned or aborted is not chosen again for 60 s. No cited study shows flies
avoiding where they have been or giving up headings: these are model choices,
there so that a fly does not keep retrying what it cannot do.

**The extent.** Instead of a home range, a world gives the fly an extent: an
arena's floor, or the mapped city 20 m inside its edge. Outside it, the fly
turns back at 1.2 rad/s per metre outside, counting at most 2 m; long flights
are aimed inside it. Everything above is part of the fly's state and hash, and
its random draws come from a stream of its own, so a world with no food, no
landmarks and no room for long flights draws nothing from the controller's
main stream on its account.

## People who notice the fly

`digital-fly/7` makes perception run both ways. The fly sees the city's
people as moving things (above); the people now see the fly through a
bounded model of human sight (`people.ts`), the counterpart of the fly's own
senses, and may do something about it. Neither knows what the other will do:
a person sees where the fly is and whether it flies, never what it will do
next, and the fly sees a hand coming at it, a moving thing like any other,
which its own escape pathway answers or not. What happens between them comes
from the two models running together.

**What a person sees.** The pedestrians near the fly look at it twenty times
a second as it advances. A person sees it only when it is inside their field
of view (214° across, Strasburger, Rentschler & Jüttner 2011; 50° up and 70°
down, model choices), when it spans at least their acuity at its
eccentricity, and when nothing stands between them (glass is seen through).
Their acuity is 1′ at the fovea, the 20/20 standard (as Ashraf, Chapiro &
Mantiuk 2025 describe it; their observers resolved finer), and grows
linearly with eccentricity, by the foveal value every 2.72° (E2, Kurzawski
et al. 2023). The fly spans its body length perched and twice its wing
length in flight, so a flying fly is resolved straight ahead out to about
18 m, a perched one to about 10 m, and 30° to the side only within about
1.5 m. It is a resolution bound, like the fly's own interommatidial angle:
a fly's contrast and motion, which make small things easier to detect, are
not modelled.

**What a person does.** Seeing the fly is not noticing it: a person notices
a flying fly in sight at 2 per second, a still one at a quarter of that
(`noticeHz`, `stillNoticeShare`, model choices). Having noticed it they look
at it after their reaction time (213 ms, the simple visual reaction time of
Woods et al. 2015 corrected for its test's hardware delays) and follow it
with their eyes while it stays in sight and within 130° of the way they walk
(a model choice); out of sight for 2 s (`forgetS`) it is forgotten. When the
fly they are looking at comes within reach in front of them (within 0.6 m of
the shoulder on its side, `reachM`), they swat at it with probability 0.3
(`swatP`, a model choice: swatting is a typical response to biting insects,
Wynne et al. 2022, but no rate for a fly passing someone is published), once
each time it comes within reach and at most once every 3 s after a swat.
After the reaction time the hand on its side leaves their hip for where they
last saw the fly, without predicting where it is going, in 335 ms (the
duration of the slaps at a fictive mosquito in Wynne et al. 2022; longer if
that would need a peak above their measured 8.01 m/s) along a minimum-jerk
path, and comes back the same way.

**What the fly sees.** A swatting hand is a moving thing of 5 cm radius
(`handRadiusM`) in the fly's world. A fast one looms, the giant-fiber proxy
may cross its threshold, and the fly makes an evasive saccade in flight or
an escape jump when perched, as it would from anything else; a hand that
does not loom enough leaves it be. Like every moving thing the hand is never
touched: a swat that reaches the fly is counted ("reached"), not felt. In a
test room where a person stands beside the hovering fly, a swat sometimes
sets off the fly's evasive saccade and sometimes misses because the fly has
already moved on during the half second it takes; with `swatP` 0 nothing
looms at all.

**Where it lives.** The people are a layer stepped with the fly, never part
of the city simulator: the city never reads them, its pedestrians walk on
as it moves them, and their draws come from a stream of their own, with
their state in the city fly's hash. The renderer reads them only to turn a
watcher's head toward the fly (by at most 80°) and to draw the swatting arm
(at most 0.57 of the figure's height long). The panel's _People_ row says
what the nearest person can make of the fly at that moment (in sight, too
small at their eccentricity, outside their field, or hidden), how often it
has been noticed and swatted at, and the last few things people did.

**How often.** Rarely, because a fruit fly is small. In four two-hour runs of
the 360-pedestrian city (city seeds 393977, 1, 2 and 3) people noticed the
fly twice and never swatted at it: people seldom pass within a metre or two
of the doors where it feeds, and a fly on the ground beside them is far
below their acuity where they are looking. The visitor is not modelled: the
visitor is the person at the screen, and the fly sees them as it sees anyone.

## In the city

- The fly advances by the city's ticks: 0.1 s after each `sim.step()`, or,
  when a frame comes late and the city has taken several, all of them at once,
  with the city's moving things interpolated across the whole span. So it
  pauses with the city and keeps going while the visitor is in the lab. If it
  ever throws, it stops and says so; the city carries on.
- The fly's code (the city fly, its view and its panel) is loaded after the
  city, in chunks of its own; the panel says it is loading until it arrives,
  and the fly is placed at the tick the city has reached by then.
- **Drawn at true size.** FlyBody's full mesh within 25 cm of the camera, the
  reduced one within 4 m, nothing beyond (a 3 mm fly is under a pixel there).
  Each level is its own chunk, fetched the first time it is needed.
- The drawing runs one city tick behind and interpolates between the last two
  states. A 218 Hz wingbeat cannot be shown at display frame rates, so a
  beating wing is drawn as a translucent sweep unless **Wings at 1/100 speed**
  is on.
- **Fly** in the city controls opens the panel and a screen-space locator ring
  (a marker, not the fly). **Inspect up close** takes the camera to 1.2 cm from
  the fly with a near plane small enough for it, orbits slowly (not under
  reduced motion, which is read live, so changing the setting applies at once;
  drag to turn) and gives the camera back on leaving. While it
  is open the close-up owns the pointer: the walker neither moves nor turns, a
  click selects nothing in the city, pointer lock is released and not
  requested, and the walker's heading and pitch come back unchanged when it
  closes.
- The panel separates **this run's simulation observations** (behaviour,
  movement, sensory input, energy, navigation and memory, what the nearest
  person can see of the fly and what people did, recent decisions, counts, with each collision counted once and the seconds spent touching) from **the model's biological
  evidence** (FlyBody, VFB regions and connectivity, every parameter with its
  class, source and, where it can vary, range). Confidence is "not reported":
  the controller has no calibrated estimate. Evidence classes: _FlyBody model_
  (FlyBody's body, joints and meshes, and the constants its code sets or its
  trained policies report: a model of a fly, not measurements of one),
  _measured_ (VFB's connectome counts), _published_ (values reported for real
  flies), _model_ (this simulator's choices), _simulated_ (this run),
  _unsupported_ (not sensed at all).

## Experiments and the lab

The R.A.I.N. Lab runs the fly as a fourth experiment backend
(`digital-fly-behavior/v3`). It has nine protocols: obstacle avoidance, light
preference, visual threat (a looming dose series in approach speed, l/v),
noisy sensing, adaptation to looms repeated on a fixed schedule, controller
comparison, and Project ECHO's three (a hidden impairment, self versus
external causation, learning retained through time; see
[Project ECHO](PROJECT_ECHO.md)). Each is a preregistered design with a baseline arm on
the same seeds, run in enclosed arenas.

- A design says how many seeds to run, never which. The host draws them after
  preregistration, and never draws a pilot seed.
- A person at a terminal authorizes the exact plan, once. The demonstration's
  own designs are authorized by its script, and their records say so.
- Each run is simulated twice as a determinism check, and the result is judged
  by a sign test. `npm run rain:fly:verify` re-simulates each record the
  current code made.

The backend section of
[the lab guide](RAIN_LAB_BETHESDA.md#the-digital-fly-backend) has the
protocols, criteria, measures and commands; the archive is
`docs/benchmarks/fly-behavior/`.

Four protocols (obstacle avoidance, visual threat, noisy sensing and
adaptation) were redesigned for digital-fly/4 so that their primary measure
can discriminate. Pilots sized their demonstrations' seed counts and minimum
effects, and the host's minimum effects for the two metrics the redesign
added. The pilots run on a fixed, public set of pilot seeds and are kept in
`docs/benchmarks/fly-pilots/`, labelled not evidence: they are never
preregistered, authorized or admitted. That a receding or held sphere never
sets off an escape (the escape proxy's expansion gate) is checked by a test in
`src/rain/scientific/fly.test.ts`, not by an experiment.

A design may set model parameters only, each within its range (see
[Parameters](#parameters)). A change to the fly's behaviour or parameters bumps
`FLY_VERSION`. Any change to the code the experiments run changes the source
digest each plan binds. A change to what the fly does in the arenas also
changes what the pilots measured: `npm run rain:fly -- --pilot --check`
re-runs each kept pilot exactly and fails on any difference, and the pilots
are then run again and the demonstrations re-sized from them. Records made by
other code are checked without re-simulation (their seal, their files, their
registry run, the facts their reports state, and their report and summary byte
for byte against the digests pinned in the archive's `renderings.json` when
they were written), never re-run against different rules.

The lab has no 3D fly of its own. Its presence there is the backend and the
DIGITAL FLY section of the lab's panels, which lists the protocols. A second
drawn fly would break "one fly in Bethesda", and each arena run has its own
fly, which is never drawn.

## The circuit-informed controller

`src/bethesda/fly/circuits/` replaces two of the reduced-order controller's
proxies, one at a time, with published circuit models, so each replacement can
be compared with the proxy it replaced. It is a `FlyNeuralAdapter`
(`CIRCUIT_DESCRIPTOR`, `circuit-informed/v1`): everything else is the
reduced-order controller's, every command passes the same gate, and it
simulates no neuron (`simulatesNeurons` is false; the build checks).

- **Looming escape** (`giantFiber.ts`). The giant fiber's membrane potential is
  Ache et al. 2019's fitted function of the looming object's angular size and
  expansion: an LPLC2 term (a Gaussian in log size), an LC4 term (expansion
  rate), a size-dependent tonic inhibition and an LC4-linked inhibition, each
  at its published delay and with every constant the paper's. Three choices
  are this model's and are named where they are made: LC4 is not driven by a
  shrinking object, LPLC2 only while the object expands, and nothing
  contributes when nothing is seen. The fiber spikes when the potential first
  reaches the trial's threshold, a log-normal draw whose median and spread are
  fitted (below). A GF-independent pathway starts the long-mode wing raise
  28.6 ms (von Reyn et al. 2014's delay for GF-silenced flies) after the
  object reaches a trial's wing-raise angle, 49° ± 4° (Fotowat et al. 2009).
  Whichever acts first sets the mode: a spike commits a short-mode jump 10 ms
  later (the fly's sample period; the measured spike-to-jump time is 2 ms),
  the wing raise a long-mode one after the 13.2 ms sequence, and a spike during
  a long-mode takeoff brings its jump forward. The fiber can be silenced
  (`silenceGiantFiber`), as with Kir2.1 in the paper.
- **Grooming** (`grooming.ts`). Zhang, Guo & Simpson 2020's dust model, with
  the constants of the authors' deposited code (imported, not typed): dust on
  the head, abdomen, wings and two leg pairs, each part's sensory activity
  drawn as |N(d, (d/5)²)| at every bout, the strongest winning; a winning body
  part moves a share of its dust to the legs that clean it, winning legs rub
  ten times that share off, and each bout lasts a gamma-distributed time the
  authors fitted per action. The front-to-back order is not scripted: it comes
  from the head carrying the most dust (its bristle count). What the authors'
  model leaves open, when a dusted fly stops to walk or stand, is one fitted
  threshold on the winning activity. A clean fly's spontaneous grooming stays
  the reduced-order controller's. The text gives 0.2% for the dust moved per
  bout, the code 0.4%; the model uses the text's and its range spans both.

The circuits apply their own published delays, so a fly running this
controller has no sensing latency of its own and the reduced-order controller
inside it is handed each sample 30 ms late, as before. Its three fitted values
come from the calibration's fit; everything else in `circuits/params.ts` is
published, imported or a stated model choice.

## The mushroom-body controller

`src/bethesda/fly/mushroomBody/` replaces one more of the reduced-order
controller's proxies with a published model, so it too can be compared with
the proxy it replaced. The proxy is the navigation bookkeeping's rule for
giving up a remembered food place: two returns that find neither the food nor
its odour forget it, however often the fly fed there. The replacement is
Bennett, Philippides & Nowotny 2021's mixed-valence model of the mushroom
body's associative learning, which learns a reinforcement prediction for each
cue by minimising the prediction error its dopaminergic neurons compute. It is
a `FlyNeuralAdapter` (`MUSHROOM_BODY_DESCRIPTOR`, `mushroom-body/v1`): the
reduced-order controller with a `PlaceValuation` (`navigation.ts`) handed to
its navigator, so everything else (escape, grooming, walking, flight,
landing, foraging by odour, path integration) is unchanged and every command
passes the same gate.

- **The units** (`circuit.ts`), all rate units. 2,000 Kenyon cells; a cue
  drives each with probability 0.05, drawn from the fly's own seed, all at one
  rate summing to 10 Hz. Two output neurons, m± = max(0, w±·k), whose
  difference m̂ is the prediction. Two dopaminergic neurons,
  d± = max(0, ±r̂ ∓ m̂ + Σk) (the paper's eq. 14 with wM = γ = 1), whose
  difference is twice the prediction error r̂ − m̂. Plasticity at the Kenyon
  cell to output synapses, Δw± = (η/2) k (d± − d∓) (eq. 8), weights kept at
  or above zero. Every value but three is the paper's, quoted in
  `mushroomBody/params.ts`; the learning rate (0.25), the meal's reinforcement
  (1) and the approach threshold (0.3) are this model's, with their reasons.
- **The cue** is the landmark a remembered place is recognized by: the
  nearest of the up to three it was remembered with (in the yard, the site's
  own pole). One landmark per cue keeps the paper's coding level; a union of
  three would code 14% of the cells and learn at a third of the speed.
- **Trials.** A meal is a rewarded trial; coming back to a remembered place
  and finding neither its food nor its odour is an unrewarded one, whose
  negative prediction error devalues the place, as extinction does in flies
  (Felsenberg et al. 2017, 2018). A hungry fly goes back only to places whose
  prediction exceeds the threshold: a place fed at once is given up after one
  fruitless return, a place fed at more than once after two. A devalued place
  stays remembered, so a later meal there revalues it from where it was.
- **Lesion.** `blockOmission` blocks the dopaminergic neurons' output in
  fruitless returns only, so nothing is learned from them.

What it is not. Its cue is a landmark's identity, a visual feature; the
mushroom body is needed for appetitive visual memories (Vogt et al. 2014), but
visual place learning in flies needs the ellipsoid body and not the mushroom
bodies (Ofstad et al. 2011), so it is not a model of place learning: where a
place is stays the bookkeeping's. It skips everything upstream of the Kenyon
cells, as the paper does. Its units stand for populations, not identified
neurons. It runs only in the yard studies (`src/bethesda/life/`), never in the
city or in R.A.I.N. experiments, and it changes no other controller: a
navigator without a valuation runs exactly as before, and a reduced-order
fly's checkpoint keeps its bytes. What it changes, and where it changes
nothing, is measured in [Study C](INDIVIDUAL_CONTINUITY.md#study-c-learning-from-omission-the-mushroom-body).

## Calibration against real flies

`src/bethesda/fly/calibration/` sets the fly beside published recordings of
real flies. `observations.ts` holds every published value used: each with its
paper's words, quoted verbatim (checked against the full texts when written),
or, for the grooming ethograms, the imported data it was computed from; and
each with a role: `held-out` (nothing was set from it), `design` (a parameter
came from it, so agreement is by construction) or `fit` (the circuit-informed
controller's fitted values were set to it). `paradigms.ts` rebuilds each
experiment from the fly's own world primitives and runs it through the fly's
body, senses and gate, and each paradigm lists how it differs from the
experiment; every comparison inherits those differences.

The paradigms: von Reyn et al. 2014's looming disk over standing flies at five
r/v (escape probability, short-mode share, takeoff before contact, neural
delays), Fotowat et al. 2009's lateral loom (takeoff timing), Card & Dickinson
2008's threats from three directions (escape direction), Zacarias et al.
2018's repeated looms over walking flies (jumping, freezing, habituation),
Zhang, Guo & Simpson 2020's dusted and undusted flies in a chamber (grooming
fractions, time course, episodes and motifs, the order of cleaning), free
flight in Censi et al. 2013's and Tammero & Dickinson 2002's arenas (saccade
rate, flight speed), van Breugel & Dickinson 2012's tunnel with a post
(landing, fly-bys, saccades), Liu, Davis & Roman 2007's and Soibam et al.
2012's open fields (wall following, activity, speed, turning) and the gait
against Mendes et al. 2013 and DeAngelis et al. 2019.

`fit.ts` sets the three fitted values. The giant fiber's threshold median and
spread are fitted to von Reyn et al.'s short-mode counts at r/v 8, 14 and
40 ms by maximum likelihood over a grid. Because nothing before a trial's first
escape command depends on the threshold, each trial is run once with the fiber
silenced, recording its peak potential before the wing raise, and the
short-mode share any threshold would give is computed exactly from those
peaks; the fitted pair is then run in full and every trial's mode must be the
one predicted. The grooming threshold is bisected to the dusted flies' mean
fraction of time grooming. The fitted values are in `circuits/params.ts`, and
a test holds them to `fit.json`.

`node scripts/run-ts.mjs scripts/fly-calibration.ts` runs every paradigm on
both controllers and writes `docs/benchmarks/fly-calibration/` (the report,
its README with every row, quote and approximation, and the fit); `--check`
reproduces it byte for byte, and `--fit` refits. It is seeded, and both
controllers meet the same trials and flies.

## Physics backend

`fly-physics/` (Python) runs FlyBody's own MuJoCo model on the browser fly's
walking plan. The browser keeps its reduced-order body for drawing and for the
lab's experiments, and nothing flows back. `scripts/fly-physics-trace.ts` runs
a `DigitalFly` in an empty arena under a scripted walking plan (every command
through the gate). It samples, on FlyBody's 2 ms control clock, the thorax
path, each leg's stance and the joint and tendon targets `pose.ts` solves for
FlyBody's 48 leg actuators (`fly-physics-trace/v1`, deterministic).
`python -m fly_physics` fetches FlyBody by git at the commit
`data/flybody.source.json` pins, and verifies the checkout and every file the
importer read. It then replays the plan open loop in FlyBody's
`template_task()`, sending the targets to the leg actuators with adhesion on in
stance. Through FlyBody's MJCF the plan's angles reach the claw positions
`pose.ts` draws to within 10⁻⁷ cm.

Physics does not follow the plan closely. On a flat floor the body covers
30–47 % of the planned speed and drifts in heading (up to 148° in 2 s).
Turning on the spot is almost lost, swing claws drag, and the fly falls off a
wall or a ceiling within 0.1 s of its first step. FlyBody's leg servos lag the
plan by about 24 ms (a 10 ms actuator filter plus the joints' damping over
gain). Even unloaded, the claws miss their planned positions by 0.18–0.31 mm,
while the plan lifts a swing foot at most 0.25 mm. The results are in
`docs/benchmarks/fly-physics/`; they describe two simulators, never a fly.
FlyBody's trained policies (GPL-3.0) are not fetched or used: this is FlyBody's
physics with the browser's plan as controller, not FlyBody's controller.

## Parameters

`params.ts` holds the rates, thresholds, gains, time constants, speeds and
sizes the behaviour is built on: 88 values, each with a kind, a unit, an
inclusive range and, where there is one, a source. 10 are FlyBody's (its
model's values: 7 cite the paper and 3 the code file at the pinned commit),
11 are published values for real flies (each with its DOI), and 67 are model
choices (some informed or derived from a cited paper, which the note says). FlyBody and
published values are fixed. Experiments may override **model** values only,
each within its range; `resolveParams` refuses a FlyBody or published value,
an unknown name, a number that is not finite, a value outside the range, and a
cruise band whose floor is above its ceiling, and it returns a frozen table.
One model value is fixed as well: `standingCrouch` (the drawn legs are
solved for it). The city's people have a table of their own in `people.ts`:
14 values, 6 published for real people (each with its DOI) and 8 model
choices, resolved the same way. The ranges keep every run well defined: the
velocity time constant may be 0 (the body then follows at once), but the
approach time constant, the acceleration limit, the landing timeout and the
touchdown speed may not, and a short-mode preparation stays under the 100 ms
from which the body counts a takeoff as long-mode. A test runs the fly at both
ends of every model value's range.

The table is not every number in the fly. The ones below are fixed where they
are used; all are model choices and none is fitted. Numerical tolerances (such
as the millimetre a ray starts above the point it is cast from) and the log's
default length of 200 records are not listed.

The body (`fly.ts`):

- gravity, 9.81 m/s²;
- the drawn attitude's drag, 3 /s, and the wingbeat frequency reaching the ends
  of its ±5 % range at ±0.5 g of load away from 1 g (drawing only);
- the left/right stroke amplitudes, ±15 % at 300 rad/s² of yaw acceleration
  (drawing only);
- easing at rest and while grooming of the drawn pitch and roll (50 ms), the
  wings (40 ms) and the legs (30 ms), and the legs' extension for landing
  (40 ms);
- walking: a step goes ahead only onto a top within 4 mm of the current one;
- the takeoff: a drawn lean of 0.15 rad toward the jump's heading, reached at
  the end of the preparation; short-mode below 100 ms of preparation unless
  the command says otherwise;
- the drawn thrust, never less than 0.1 g upward, so the drawn fly never turns
  over (drawing only);
- flight bouts: exponential with mean `flightBoutMeanS`, clamped to 1.5–20 s;
- contacts and touchdowns: a walkable top's normal at least 0.7 vertical; a
  contact lasting while its surface is within the standing height plus 1 mm;
  the feet within 1.5 mm of the target and a surface within 2 mm under them
  for a touchdown;
  a 0.1 m/s climb after an abort;
- the sites on offer: seen when the line from the eyes to a site's centre is
  clear to within 1 cm of it; a target's size, for extending the legs, taken
  from its smaller half-width and at least 1 cm;
- the gait reads as standing below 0.05 cm/s.

The controller (`controller.ts`):

- the extent's tether turns at 1.2 rad/s per metre outside the extent, counting
  at most 2 m;
- spontaneous takeoff headings within ±0.3 rad of the current heading; a
  walking bout's speed from the lower 80 % of the walking range;
- walking turns: ±3 rad/s for 0.4–0.8 s at an edge, up to ±2 rad/s for
  0.15–0.45 s spontaneously, and at most ±6 rad/s in all;
- cruise: kept 0.3 m below the extent's ceiling (gain 2 /s, at most
  `climbMaxMS` down); yaw rate at most ±3 rad/s;
- saccades: amplitudes clamped to 30–170°;
- grooming: the start-site weights (eyes 0.3, antennae 0.25, abdomen 0.2,
  wings 0.15, notum 0.1);
- a hover pause lasting 0.5–1.5 times `hoverMeanS`;
- landing: sites nearer than 5 cm are skipped; a site scores the cosine of its
  bearing, plus up to 0.5 at random, minus its distance over `landingSearchM`;
  the point is drawn within 60 % of the site's half-widths from its centre (a
  food patch's is its centre, which lies on the surface even where it slopes); the
  approach turns at 4 /s times the bearing error (at most ±6 rad/s), and not at
  all within 3 cm horizontally; the time an approach needs is counted to
  within 1 mm of its target; an abandoned landing leaves at 0.15 m/s forward
  and 0.1 m/s up;
- starting values the first decision replaces: a 1 m cruise altitude and a
  2 cm/s walking speed;
- feeding: a meal ends at 98 % of a full reserve;
- odour: walking turns at 0.3 and 3 times `walkTurnHz` while the odour rises
  and falls, spontaneous saccades at 0.25 and 3 times their rate; a hungry
  fly's flight bout in odour lasts 20 s; local search turns at 2.5 rad/s;
- shade: a fly looking for shade flies on until its flight has lasted 40 s,
  steering at 2 /s times the shade's bearing;
- long flights: steering at 2 /s times the goal's bearing; the dispersal speed
  beyond 5 m of the goal; a goal reached within 3 m; a 3 s detour after an
  avoidance saccade; given up after 20 s without coming a metre closer.

The people (`people.ts`), and how they are drawn (`Actors.tsx`):

- a field of view 50° up and 70° down from straight ahead; head and eyes
  following the fly to 130° either side of the way a person walks; a swat
  only at a fly within 90° of the way they face;
- a person's hand resting 0.25 m to the side, 0.9 m up and 0.1 m ahead of
  their feet, their shoulders 0.2 m to each side and 1.4 m up;
- the fly's size to a person: its body length perched, twice its wing length
  in flight;
- the people look at the fly twenty times a second; the log keeps 40 events;
- drawn: a watcher's head turned toward the fly by at most 80°, and a
  swatting arm at most 0.57 of the figure's height long, bent at its middle.

Navigation (`navigation.ts`):

- 10 m squares, the last 400 kept; at most 12 places, each with at most 3
  landmarks; a place forgotten after 2 returns that found nothing; remembered
  food nearer than 5 m searched for, not flown to;
- eight directions for a long flight, each scored by the squares it has been
  in at a quarter, half, three quarters and all of the way, plus a tenth at
  random to break ties; no long flight shorter than 2 m;
- a heading that stalled avoided within 10 m and ±22.5° of it for 60 s, and a
  failed landing site for 60 s;
- the odometry and compass errors' spreads of 0.29 times their parameters (half
  the sum of four uniform draws), and the heading drifting ten times faster
  without a compass.

The senses (`senses.ts`):

- the ray fan: seven rays at 0°, ±12°, ±30° and ±60°, level and, in flight,
  also pitched 0.35 rad down, reaching 3 m in flight and 5 cm perched; a
  downward ray that meets a top is not an obstacle ahead;
- expansion measured only between samples less than 0.1 s apart;
- sensing noise: relative, with a standard deviation of 0.58 times the noise
  level (the sum of four uniform draws), except for the light's, landmarks' and
  shade's bearings, which are turned by an angle with that standard deviation
  in radians;
- landmarks and shade looked for every tenth sample; a landmark in clear view
  when the line to half its height (or eye level, if lower) ends on it or within
  0.3 m of it; shade at 0.5 and 1 times `landingSearchM`, in eight directions
  (0°, ±45°, ±90°, ±135°, 180°), the inner ring and the direction nearest ahead
  first, a point in view when the line to 1 cm above it is clear to within
  5 cm.

The world queries (`world.ts`):

- landing sites: a box's whole top; on a cylinder, a square of half-width 0.7
  of its top radius; on a sphere or ellipsoid, the square inscribed in the cap
  that is flat to 2 mm, and the fly stands on one only where its normal is at
  least 0.7 vertical;
- light: the sun traced up to 400 m; a point light's inverse-square falloff
  floored at 0.05 m²; a direction reported only when one source gives more
  than half the light;
- terrain rays: a sample every 0.25 m, at most 4 096 per ray, and 24
  bisections on a hit;
- the primitives near a ray's origin listed for reaches of 0.5, 3 and 13 m,
  with 25 cm to spare, and kept until the origin has moved 25 cm (a speed-up
  only; a test checks it finds what a check of every primitive finds, from
  origins far apart and from origins a few centimetres apart);
- the grid: 4 m cells, footprints widened by a micrometre (a speed-up only; a
  test checks every query against a scan of every primitive);
- food: a fly stands on a patch within 1 cm of its height; odour falls off over
  5 m, counts out to 30 m, and reaches a point with a clear line to 0.3 m above
  the patch; landmarks are upright cylinders at least 1 m tall;
- the city (`bethesdaWorld.ts`): food patches 25 cm in radius, 0.4 m out from
  their building's wall at the door; the edge 20 m inside the map's bounds; the
  ceiling 10 m above the tallest building on the highest ground; the fly placed
  at 0.6 of a full reserve.

The gate (`neural.ts`, `LIMITS`): 1.5 m/s, 4π rad/s, a 180° saccade, 10–500 ms
of preparation, 3 mm for a landing point, and 500 characters for a reason and
200 for a site id.

## The decision gate

Every command from a decision maker passes `validateCommand` before the body
sees it, and the gate never throws: it reads the command once into a plain
copy, and anything malformed (not an object, an unknown field, a wrong type, a
getter that throws) is refused. An accepted command:

- makes a transition the body's current mode allows (`COMMANDABLE`);
- carries only the fields that mode uses, each finite and in range: a velocity
  up to 1.5 m/s and a hover flag when airborne, a yaw rate up to 4π rad/s when
  walking, flying or landing, a saccade up to 180° in flight, a walking speed
  from 0 to the body's 4 cm/s when walking, and a heading and a preparation of
  10–500 ms when taking off or escaping;
- names one of the five grooming routines when grooming;
- gives a reason of at most 500 characters;
- for a landing, names a site the body offered with this decision and a point
  on its top: inside the site's rectangle and within 3 mm of the surface there.

In flight and while landing, the body offers the flat tops within
`landingSearchM` that its eyes resolve from where they were when the sample
the decision gets was taken: inside the eye field, at least one ommatidium
(4.6°) across, and with a clear line to the site's centre. It also offers the
surface straight below the fly and the site it is approaching; in a world with
a sun, each site says whether the sun is on it, as its brightness would. A
food patch is a site on the surface it lies on, so a landing on it is checked
against that surface. A `feed` command needs food under the feet. An interrupt
between decisions is offered no new sites, only the one being approached, and
what it commands passes the same gate. A refused command, or a decision maker
that throws, is counted and logged, and the body holds in a way that suits its
mode: it hovers in flight or while landing, stops when walking, keeps grooming,
and stays put at rest; a takeoff or escape under way completes. Apart from
that, it never keeps running the last accepted command. Decision makers get
frozen copies of the body, the frame, the sites and the parameters, so none
can widen the gate by writing to them.

`FlyNeuralAdapter` is the seam for other controllers (a connectome-constrained
model, say). Tests drive the fly with adapters that send malformed or
out-of-range commands, throw, write to their inputs, or take off and then
misbehave, and check that the fly holds. Neither the controller nor an LLM can
reach the body around the gate, and the R.A.I.N. backend's own authorization
and verification apply on top (see the lab guide).

## Performance

Measured on this ARM laptop (Node 24, the 360-pedestrian profile): the fly
costs about a third of the city's own step, 0.16 ms against 0.51 ms per 0.1 s
tick at `digital-fly/3` on an idle machine (400 s of city time after a
warm-up). In alternating 10-minute runs on a loaded machine it took 0.30–0.31
of the city's step at `digital-fly/3` and 0.33–0.35 at `digital-fly/4`, whose
interrupt freezes a copy of the body for each sample between decisions. In a
cloud container (x86-64, Node 22, the same profile, 10 minutes of city time
after a minute's warm-up, twice each), `digital-fly/5` took 0.37 ms per tick
against the city's 0.79–0.82 ms, and `digital-fly/6` 0.67–0.69 ms against
0.87–0.90 ms. The difference is the whole city in its world (rays toward the
sun cross more of it, and every city tick lists the city's moving things,
keeping those whose path comes within sight of the fly) and its smell (a ray
from the fly to each food patch within 30 m, every sample). Measured the same
way against `digital-fly/6` (0.65–0.69 ms), `digital-fly/7` took
0.76–0.78 ms: its people look at the fly twenty times a second.
Sensing dominates it: each sample casts its short rays against lists of the
primitives near the fly, kept until it has moved 25 cm, instead of against the
whole neighbourhood; a test checks that the lists never miss a surface a check
of every primitive finds. The leg solver takes about 0.4–1 ms per frame and
runs only while the fly is at least 4 pixels long on screen (within about
0.5–1 m depending on the screen, or in the close-up) and inside the camera's
view; otherwise the fly keeps its last pose. The fly's code is loaded after
the city, so the application's main chunk is 91 KB instead of 232 KB
(uncompressed). The reduced mesh is 90 KB (31 KB gzipped) and the full one
547 KB (194 KB gzipped), each loaded on first need. When the view unmounts, the
fly and its locator ring are taken out of the scene and their geometry and
materials disposed, and a mesh that finishes loading afterwards is dropped. A
new city, with a new fly, restarts the drawing's interpolation, so the drawn
fly does not slide over from where the old one was. Without WebGL the city's
existing fallback applies and the fly still runs. No React state changes per
frame: the panel reads the fly four times a second.

## Tests

`src/bethesda/fly/fly.test.ts` and `cityFly.test.ts`:

- scale and frames;
- FlyBody's 67 bodies and 102 hinges;
- the codec, and the meshes against their manifest;
- gait duty, stance counts and coordination;
- the 150° eye field and its blind sector;
- world queries: a ray or perch query with input that is not finite finds
  nothing and every terrain march ends; a crown is offered as a site only where
  it is flat to 2 mm; a squashed sphere's top, side, normal, solidity, perch
  (only on its gentle top) and landing cap; a tapered trunk's radii, leaning
  side and narrow top; a courtyard open from the ground up and walled;
- parameter provenance, override refusals, ranges (refused outside, frozen
  once resolved), and runs at both ends of every model parameter's range;
- the command gate: impossible transitions, out-of-range values and missing
  reasons; malformed commands of every kind refused without throwing; only the
  known grooming routines; landings only on an offered site at a point on its
  top; frozen inputs no decision maker can widen; a decision maker that takes
  off, or walks, and then misbehaves, after which the fly hovers, or stops; a
  landing target changed during the approach; and a rogue adapter that never
  moves the fly;
- determinism across seeds and step sizes;
- a fly placed in flight with a velocity, and impossible starts refused;
- the velocity tracker within the acceleration limit at time constants from 0
  to 2 s;
- bounded dynamics that never enter a solid;
- state alternation, and landings at the simulator's crouch of FlyBody's
  height;
- a contact counted once, when it begins, while the fly slides along the
  surface;
- touchdowns on tree crowns that move the fly no more than its own step plus
  the 2 mm gap, and a touchdown aborted, not snapped, when its surface is not
  there;
- an escape away from a looming stimulus; repeated looms that stop setting off
  escapes, each escape taking 22 % of the responsiveness left, and a fresh
  escape after a rest;
- an escape's posture, short- and long-mode: the yaw held while preparing, the
  lean toward the jump, the wings folded or raised only over the last 13.2 ms,
  the jump along the aimed heading, and the heading turned to it in the air;
  a jump brought forward but never put back, and a takeoff's mode taken from
  the command when it says, a wing raise only with a takeoff;
- an interrupt between decisions refused by the gate, and the next taken at
  once, before the next decision;
- landing sites through the eyes: a table ahead offered, one behind, one
  behind a screen and one narrower than an ommatidium not;
- grooming bouts: each site followed by the legs that cleaned it rubbing, each
  next site one further back, bouts starting at different sites and some
  ending early;
- glass seen through but hit;
- no landing stuck among obstacles, and no approach running past its
  deadline;
- the drawn pose: feet on the surface and lifted in swing, stance feet that do
  not slide on the ground (under 0.05 cm/s) walking, turning on the spot and
  both, joints within FlyBody's ranges;
- the city hash with and without the fly, the city's edge, same city same fly,
  and pausing;
- every query through the city's grid answered as a scan of every primitive
  answers it;
- the city fly foraging: in its first half hour it smells food, finds it and
  feeds on a patch at a food shop's door.
- the drawn street trees, lamps and benches near the fly are solid to it, with
  the gaps between a bench's slats open; the rooftop units and awnings are
  solid and stood on, and a courtyard is open; the ray lists find the nearest
  surface a full check finds, from scattered origins and from drifting ones;
- a frame several city ticks late: the fly catches up over all of them, with
  the visitor interpolated across the span;
- a visitor walking straight at the fly makes it escape through the looming
  pathway, and one standing 3 m away for 20 s does not.

`src/bethesda/fly/foraging.test.ts`:

- food tasted only on a patch; its odour e^(−d/5 m) in the open, nothing behind
  a screen and something round its end;
- feeding allowed only with food under the feet, from rest or walking;
- the reserve spent at each mode's power (rest, flight) and refilled by
  feeding, never past full;
- hungry flies finding food by its odour in a yard within 5 minutes, and fed
  ones leaving it alone for 10;
- shade on the ground seen in flight under a sun, and not on the ground or
  without a sun; a fly that is not hungry resting in shade more than 60 % of
  the time where 30 % of the ground is shaded;
- path integration: the heading error held within its bound under the sky and
  far larger without it;
- a place remembered with its landmarks, known again by one of them and not
  by another, and forgotten after misses and after `placeMemoryS`;
- remembered food flown back to only when hungry and at least 5 m away;
- long flights never aimed where the fly has been all over, always inside its
  extent, never back along a heading that stalled, and none in an arena too
  small for one.

`src/bethesda/fly/people.test.ts`:

- a person sees the fly in front of them and not behind (the 214° field), as
  far as their acuity reaches for a flying and for a perched fly, larger the
  farther it is from where they look, and not behind something, casting no
  line of sight they do not need; once they look at it, as far round as head
  and eyes turn and no farther;
- they notice only a fly in sight, look at it after their reaction time and
  forget it out of sight; a still fly is noticed less readily;
- they swat only at a fly within reach in front of them, after their reaction
  time, in at least a slap's 335 ms and at a peak speed no higher than a
  slap's; the hand ends where they saw the fly and comes back, and a swat that
  reached a fly holding still is counted;
- the same seed and fly give the same people; published values are fixed and
  sourced, model values in range;
- a person beside a hovering fly: with swatting, the fly turns away from the
  looming hand through its giant-fiber proxy; without, nothing looms;
- in the city, the same people for the same city, whoever reads them.

`src/bethesda/fly/mushroomBody/mushroomBody.test.ts`:

- published values fixed and model values in range;
- a cue's code: about 5% of the Kenyon cells, summing to 10 Hz, the same for
  one fly and different for another, and little shared between two cues;
- the dopaminergic neurons' difference is twice the prediction error, and a
  trial moves the prediction toward the reinforcement by no more than
  2η|k|² of the way;
- one meal makes a place worth a return and one fruitless return undoes it;
  two meals outlast one fruitless return but not two; with omission blocked,
  nothing is learned from a fruitless return; a place with no landmark keeps
  the bookkeeping's rule;
- the navigator skips devalued places and keeps them remembered, and a
  reduced-order fly's graph holds no valuation;
- a fly foraging with it learns from every meal, and a checkpointed fly lives
  on exactly as the uninterrupted one.

`src/bethesda/fly/calibration/calibration.test.ts`:

- every observation named once, in a rebuilt paradigm, with its words or its
  data, and a fit target exactly when a fitted value names it;
- the fitted values the ones `fit.json` records, made by this fly version;
- each trial's mode predicted from its peak potential and threshold draw, the
  fit's shortcut, checked against full runs;
- the report made by this fly version, with every observation set beside both
  controllers;
- paradigms replayed exactly from their seeds; a clean fly's grooming left to
  the reduced-order controller; a silenced giant fiber leaving every takeoff
  long-mode;
- the ethogram reduction, censored runs left out, simulated and recorded flies
  summarized the same way; the comparison classes;
- the giant fiber spiking on a fast loom unless silenced; the dust model
  grooming the head first and moving its dust to the front legs, and a fly
  dusted only on its wings grooming its wings.

`scripts/validate-bethesda.ts` checks:

- every FlyBody output hash and the licence hash;
- that every mesh decodes and its counts match;
- that the VFB reference holds every term any controller cites;
- that the reduced-order and circuit-informed controllers claim no neurons,
  that the mushroom-body controller declares its units and that they are rate
  units, and that no controller's description speaks of the fly's experience;
- the grooming reference, parsed strictly, retrieved in the past;
- that the fly's source digest, which every fly plan and record binds
  (`src/rain/scientific/flySource.ts`), matches the code; after a change to the
  fly, `node scripts/run-ts.mjs scripts/fly-source.ts` rewrites it.

## Limitations

- Reduced-order dynamics, not FlyBody's physics or trained policies (above);
  FlyBody's physics runs only in the separate backend, on the plan.
- The reduced-order controller's giant-fiber, phototaxis and avoidance
  responses are proxies with published timings, not models of the circuits
  that produce them. The circuit-informed controller replaces the escape and
  dust-grooming proxies with published circuit models; the city's fly still
  runs the reduced-order controller.
- The escape proxy's size term reaches the escape threshold by itself at its
  peak, an object 60 degrees across at the default parameters. A standing fly
  therefore escapes from almost every looming object that grows to that size,
  whatever its speed: from every one at l/v 40 ms and slower in the pilots.
  Escape probability cannot show a dose-response in approach speed; the time
  to collision at the escape decision does
  ([the lab guide](RAIN_LAB_BETHESDA.md#the-digital-fly-backend)).
- Light is a proxy without day, night or spectrum; storms only dim it.
- Food is a patch at each food place's door, the same everywhere, and its
  odour a still-air proxy: no wind, no plume, nothing round a building. Real
  flies find food downwind over far greater distances.
- The energy reserve is carbohydrate only: no fat, no water, no starvation.
  Metabolic rates are derived from published figures for flight muscle, not
  measured on this fly; walking's is a model choice.
- Path integration, place memory and the squares visited are bookkeeping with
  stated errors, not a model of the central complex or the mushroom body; a
  place is recognized by a landmark's identity, not by its appearance.
- Shade is preferred for rest by a published index, chosen through the landing
  rule; the fly does not seek shade on foot, nor avoid heat (there is none).
- People see the fly by its size against their acuity, not its contrast or
  motion; noticing is a rate, not a model of attention; they neither stop,
  step aside nor turn their bodies (the city walks them on); a swat is aimed
  where the fly was seen, and its hand, like every moving thing, is never
  felt. The swatting rate and the other model values are not measured.
- Moving things are seen, never touched: people and vehicles pass through the
  fly. People are two spheres (legs and torso), smaller to the fly than a real
  body, so a visitor walking at it gets within about a metre before it
  escapes.
- Facade windows are not mapped, so a city fly cannot hit or see a window.
- The legs are placed, not pressed: no ground reaction forces. A stance foot
  is held still on the ground in the drawing, not by any force.
- The wing stroke is FlyBody's prototype pattern, not a measured or trained
  one.
- The fly stands 0.8 of FlyBody's zero-pose height above a surface, a drawing
  choice (see [Contacts and landings](#contacts-and-landings)).
- The fly lands on furniture, lamp and tree tops and the ground, not on walls
  or ceilings.
- The city's round solids are smooth where the drawn ones are faceted: crowns,
  globes and shrubs are ellipsoids and trunks and poles round tapered
  cylinders through the drawn corners, whose faces lie up to 19 % of the
  radius inside them (see [Senses and the world](#senses-and-the-world)).
- Facade relief, bus shelters, signal masts, signs, bike docks, artworks,
  construction fencing and the other objects listed above are drawn but not in
  the fly's world, so it can pass through them.
