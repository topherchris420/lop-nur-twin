# Research compound eye: seeing looming from an image

> **Research flies only.** Every subject here is a new fly built from a seed,
> in a research arena or a development city. None is Eva or ECHO, a copy of
> either or a continuation of either; nothing here reads, writes, restarts or
> commands either original, its store, checkpoints, backups or ledger. Nothing
> in production imports `src/bethesda/vision/` (a test checks), and nothing
> here concerns awareness or experience: an eye forms an image, detectors
> respond, a readout crosses a threshold.

The deployed fly does not see. `fly/senses.ts` asks the world for the
strongest moving object within range, by its identity, and computes its
angular size and expansion from its radius and distance. Its giant-fiber
proxy, and so its escapes, read that. This work gives research flies an eye
that forms an image and asks whether escapes decided from the image are
better than escapes decided from the world's geometry.

**Short version.**

- The eye is built and tested: 1,694 ommatidia on FlyBody's eye axes at the
  fly's inter-ommatidial angle, exact optics over moving spheres, adapting
  photoreceptors, contrast-normalized Hassenstein–Reichardt motion detectors
  and 138 LPLC2-like looming units with radial motion opponency, summed into a
  giant-fiber drive that the deployed controller's own reflex decides on.
- **It tells a collision course from a near miss.** On held-out data it
  escaped from none of 48 near misses where the deployed proxy escaped from
  20, with three times fewer false alarms (8 against 24) and three times the
  warning (110 ms against 38 ms median lead).
- **It is not a better escape system overall.** The pre-registered primary
  criterion (live F1 at least 0.10 above the deployed proxy's) failed in both
  protocols: −0.062 [−0.217, 0.084] for eye v1, +0.025 [−0.105, 0.162] for
  eye v2. It misses more threats (recall 0.76 against 0.83).
- **The mechanism is what works.** Removing radial opponency (expansion-only)
  cost 0.21 and 0.34 F1 on the two held-out samples, and shuffling retinotopy
  0.30 and 0.35, every interval well above zero.
- **A simpler rule is as good.** A threshold on visual time to contact (τ =
  angular size over its rate of growth), read from the senses the deployed fly
  already has, scored 0.917 and 0.824 on the two held-out samples: the best
  readout in the first, within 0.01 of the best in the second.
- **It is too expensive for the deployed VM as built.** In a development city
  it costs 0.37 s of one core per simulated second on this machine, about 50
  times what the whole fly and city cost there.

So: a genuine perceptual mechanism that generalizes, not a reason to change
ECHO. Records: [`benchmarks/fly-vision/`](benchmarks/fly-vision/README.md).

## What the eye is

Five stages, each with what it stands for in the fly, what it computes, what
can be measured from it and where it falls short. Every number is in
`src/bethesda/vision/params.ts`, marked `published` (from FlyBody or a cited
paper) or `model` (a choice of ours, named as one).

| Stage                                     | Biological basis                                                                                                                                                                | Implementation                                                                                                                                                                                                                                                                                                                                                                                | Measurable output                                                                 | Limitations                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optics (`lattice.ts`, `scene.ts`)         | A compound eye of about 700–800 ommatidia per side, each with a narrow acceptance angle                                                                                         | Two hexagonal lattices in Lambert equal-area projections about FlyBody's eye-camera axes (±67° azimuth, 5° elevation, 150° wide), spacing 4.6°: 847 per eye. Gaussian acceptance (FWHM 4.6°) integrated exactly over moving spheres (the Rice distribution's CDF, tabulated). One ray per ommatidium for static surfaces, textured by seeded simplex noise and shaded by the surface's normal | Luminance per ommatidium; the share of acceptance a sphere covers                 | Static surfaces point-sampled (distant texture aliases). One illumination level per image, not radiometry. Reflectances and texture invented. Gaze stabilized (no head joints). The lattice is regular; the projection distorts spacing up to 21% at each eye's rim |
| Photoreceptors (`motion.ts`)              | Adaptation keeps the fly's photoreceptors and lamina responding to contrast over a wide range of light                                                                          | v2: log luminance minus its running mean (τ 0.25 s). v1: Weber contrast against a running mean of luminance. 1% multiplicative noise from a stream of the eye's own                                                                                                                                                                                                                           | Contrast per ommatidium; invariance to illumination (a test)                      | One time constant; no ON/OFF split, no photoreceptor dynamics faster than the 10 ms sample                                                                                                                                                                          |
| Elementary motion detectors (`motion.ts`) | T4 (ON) and T5 (OFF) cells, four preferred directions, low-hertz temporal tuning (Maisak et al. 2013); contrast compression in their inputs (Drews et al. 2020)                 | A Hassenstein–Reichardt correlator on every neighbouring pair along the lattice's three axes, first-order low-pass delay τ 80 ms, divided by local contrast energy; three axis responses give a local motion vector                                                                                                                                                                           | Local motion vectors; direction selectivity and temporal-frequency tuning (tests) | One signed correlator stands in for T4 and T5; its velocity optimum (spacing/τ, about 57°/s) is slow for the last tens of milliseconds of a fast approach                                                                                                           |
| Looming units (`lattice.ts`, `motion.ts`) | LPLC2: four dendritic branches, each excited by outward motion along one cardinal direction and inhibited by inward motion, ultra-selective for looming (Klapoetke et al. 2017) | 138 units on a 15° grid, Gaussian fields (σ 12°, truncated at 2.5σ). Each branch: outward minus inward motion over its quadrant, rectified; the unit's output is the geometric mean of its four branches. Units whose emptiest branch would hold under a tenth of the fullest one's weight are not built                                                                                      | Per-unit outputs; their sum; the most active unit's direction                     | Field size, spacing, opponency weight and the AND are model choices; no LPi neurons, no LC4, no temporal integration                                                                                                                                                |
| Giant fiber and the reflex (`adapter.ts`) | The giant fiber pools LPLC2 and LC4 across the eye and drives the escape jump (von Reyn et al. 2014; Ache et al. 2019)                                                          | The sum of every unit's output, times a gain chosen on development data, replaces the frame's `looming.drive`; the bearing is the most active unit's. The deployed controller's own reflex decides (threshold 1.0, short or long mode, escape away from the bearing) and its command passes the body's gate                                                                                   | Escape decisions and their lead before collision                                  | The eye does not know what or how far the object is: `distance` is NaN, `kind` "stimulus" (only the decision log prints them). One readout, one gain                                                                                                                |

A sixth output, a wide-field rotation signal after the horizontal-system cells
(Schnell et al. 2010), is computed and tested (it follows a drifting grating's
direction and reverses with it) but nothing decides on it here.

### How it meets the deployed controller

`EyeAdapter` wraps a decision maker. With every sensory sample it renders an
image from the body's pose at that moment (the eye is a sensor on the body:
it must be told where it is to know what it sees), runs the motion pipeline,
and keeps the output for the fly's 30 ms visual latency, so the controller
decides on the eye's output for the same sample time as its own frame.

- **Drive mode** replaces the frame's `looming`. Everything else the
  controller receives is unchanged, and so is the controller: the eye is a
  new sense in front of the deployed reflex, not a new controller.
- **Observe mode** passes every input on unchanged and only records the eye.
  A test steps an observed fly beside a bare one and compares their state
  hashes every 50 ms through an approach and escape: identical.
- **Research only.** The adapter refuses any subject id that names or
  contains either original's id or its printed prefix (`refuseOriginal`), and
  any that does not start `research-`.

### Cost, made bounded

A perched fly sees the same static scene from one image to the next, so the
renderer reuses the static surfaces it cast for an unchanged pose and redraws
only moving things. This is exact (a test compares cached and uncast images
number for number). A world whose static geometry changes declares
`staticGeometryChanges` and is cast every time.

## How it was tested

### On controlled images

`src/bethesda/vision/vision.test.ts` (29 tests) drives the eye with synthetic
image sequences and with the arena's renderer:

- the lattice covers each eye at the fly's spacing; neighbours lie one
  spacing apart; every unit's four branches hold a fair share;
- the optics give the Rayleigh CDF for a centred disc and a straight edge for
  a large one;
- the detectors are direction selective (the wide-field signal follows and
  reverses with a drifting grating) and prefer a low temporal frequency, near
  1/(2πτ);
- wide-field rotation drives the looming units under 5% of a loom;
- a translating, receding or still object barely drives them;
- **a 5 cm object whose centre passes 3 cm from the eye (it strikes) drives
  them over half as much as a head-on loom, and one passing at 8 or 15 cm
  under 2%**, while the expansion readout still responds over half as much;
- bright looms drive them as dark ones do, and a tenfold dimmer scene the same;
- shuffled retinotopy loses the near-miss discrimination;
- v2's log adaptation leaves a still image silent after a dark object appears
  (under 1e-9); v1's Weber adaptation does not;
- rendering is deterministic, occlusion holds, the cache is exact;
- the adapter refuses the originals, changes nothing in observe mode and
  drives escapes in drive mode;
- **a research fly with the eye restores from a whole-graph checkpoint to the
  same bytes and steps on with identical state hashes through an escape.**

### The looming battery

A frozen protocol (`src/bethesda/vision/protocols/looming-*.json`) generates
stimuli from seeds: spheres approaching, accelerating, striking a glancing
blow, receding, standing still, approaching and stopping short, passing
laterally, zigzagging, or passing close by (near misses), each against an
arena's walls at a contrast and under an illumination. Ground truth comes from
the kinematics alone: a threat's surface comes within 1 cm of the fly; a
harmless stimulus keeps at least 5 cm away; nothing in between is generated.

Each trial (stimulus × fly seed) runs three new research flies in the
deployed configuration (`OrganismAdapter`), perched at the arena's centre:

- **held**: the eye observes and every command is recorded, then the body is
  kept perched, so every readout is scored on one image stream;
- **deployed, live**: the deployed configuration, free to escape;
- **eye, live**: the same, seeing looming through the eye.

Seven readouts are compared: the deployed proxy as deployed (untuned), the
same geometric proxy with a tuned threshold, the eye, the eye without
opponency or AND (expansion-only), the eye with shuffled retinotopy, and two
non-neural rules on the world's geometry (angular size; τ). Every threshold
but the deployed one is chosen on the development split by a frozen rule
(highest F1 with recall ≥ 0.8). The held-out split runs once, from a clean
commit, at those thresholds; the script refuses to run it unless the
development record was made by the same code and protocol. Seven criteria
were fixed before any held-out run; the primary one is V1 (live F1 of the eye
at least 0.10 above the deployed proxy's, interval above zero). Intervals are
a paired percentile bootstrap over stimuli.

The held-out split adds what development never had: bright stimuli, dim (0.15)
and bright (2.0) illumination, elevations up to 70°, speeds from 0.3 to 5 m/s,
radii from 1.5 to 12 cm.

## Results

Numbers from [`benchmarks/fly-vision/`](benchmarks/fly-vision/README.md); every
record there reproduces byte for byte (`--check`) on the platform it ran on
(Linux x64, Node 22.23.4).

### looming-v1: eye v1, 4 of 7 criteria

| Readout (held-out, 248 trials) | F1    | Recall | False alarms | Median lead |
| ------------------------------ | ----- | ------ | ------------ | ----------- |
| deployed proxy, live           | 0.739 | 0.708  | 20           | 38 ms       |
| **eye v1, live**               | 0.677 | 0.677  | 31           | 63 ms       |
| geometric proxy, tuned         | 0.741 | 0.833  | 40           | 50 ms       |
| eye, expansion-only            | 0.467 | 0.583  | 88           | 49 ms       |
| eye, shuffled retinotopy       | 0.372 | 0.479  | 105          | 42 ms       |
| angular size (geometry)        | 0.490 | 0.500  | 52           | 42 ms       |
| τ (geometry)                   | 0.917 | 0.917  | 8            | 64 ms       |

V1 failed (−0.062 [−0.217, 0.084]), V2 failed, V3 failed on recall (0.677,
though no translating harmless stimulus was escaped from). V4 (ablation),
V5 (shuffle), V6 (lead) and V7 (live escapes exactly as the held runs
predicted, 248 of 248 for both arms) passed.

### What the spent held-out split showed, after the fact

A look at looming-v1's held-out trials after it had run, declared here as
post hoc: eye v1 escaped from 8 of 12 _stationary_ objects, 1.2–1.5 s after
they appeared, while the body did not move at all (its position and heading
were constant to the last digit). The cause is in v1's photoreceptors: Weber
contrast against a running mean recovers at a pace that depends on how dark
each ommatidium went, so after a very dark object appears its rim recovers
before its centre, and the detectors read that as motion. Eye v2 adapts in
log luminance instead, where every ommatidium recovers with one time course
and a still image drives no detector at all. That was the only change. It was
tested on a new held-out sample, because v1's was spent.

### looming-v2: eye v2, 5 of 7 criteria

| Readout (held-out, a new 248 trials) | F1    | Recall | False alarms | Median lead |
| ------------------------------------ | ----- | ------ | ------------ | ----------- |
| deployed proxy, live                 | 0.800 | 0.833  | 24           | 38 ms       |
| **eye v2, live**                     | 0.825 | 0.760  | 8            | 110 ms      |
| geometric proxy, tuned               | 0.830 | 0.917  | 28           | 54 ms       |
| eye, expansion-only                  | 0.481 | 0.542  | 68           | 89 ms       |
| eye, shuffled retinotopy             | 0.470 | 0.573  | 83           | 91 ms       |
| angular size (geometry)              | 0.667 | 0.792  | 56           | 31 ms       |
| τ (geometry)                         | 0.824 | 0.875  | 24           | 60 ms       |

V1 failed again (+0.025 [−0.105, 0.162]) and V2 failed (−0.005
[−0.137, 0.129]). V3 passed (4% of translating harmless stimuli escaped,
recall 0.760), and V4–V7 passed: expansion-only cost 0.343 [0.215, 0.494],
shuffled retinotopy 0.355 [0.234, 0.498], live escapes matched 248 of 248.

By kind of stimulus, eye v2 against the deployed proxy (escapes / trials):
near misses 0/48 against 20/48, lateral passes 0/24 against 4/24, stationary
0/12 against 0/12 (eye v1: 8/12), approach-then-stop 4/24 against 0/24;
plain approaches 40/56 against 48/56, glancing blows 17/20 against 20/20.

### What generalized, and what did not

- **Generalized:** collision-course selectivity. Across both held-out samples
  and every new condition (bright objects, dim and bright light, high
  elevations), the opponent units ignored objects that translate across the
  eye, recede or stand still. This follows from the mechanism, not from
  tuning: an object whose centre passes the eye by more than its own radius
  has an edge moving inward, which the opposite branch's inhibition and the
  AND reject.
- **Did not:** sensitivity. The eye misses more threats than the geometric
  proxy, chiefly fast, small or low-contrast ones in dim light, and glancing
  blows whose centre passes the eye by nearly their own radius (their near
  edge barely moves). Its earlier warning also means it commits before an
  approaching object stops short. The detectors' slow velocity optimum and
  the 10 ms sample limit it in the last tens of milliseconds of a fast
  approach.
- **The simplest rule is strong.** A threshold on τ read from geometric size
  and expansion, both of which the deployed fly's senses already compute, was
  the best readout in the first held-out sample and within 0.01 of the best in
  the second. The difference between the two samples (0.917 and 0.824 for τ)
  shows how wide the sampling spread is at this size: intervals of about
  ±0.13 F1.

## Cost

[`benchmarks/fly-vision/cost.json`](benchmarks/fly-vision/cost.json), one
thread of an Intel Xeon at 2.1 GHz, Node 22.23.4; not the deployed VM:

| Run                                                   | Wall s per simulated s  |
| ----------------------------------------------------- | ----------------------- |
| Arena: deployed configuration, perched                | 0.0032                  |
| Arena: with the eye (static scene cached)             | 0.075                   |
| Development city 1201, 300 s: city alone              | 0.0003                  |
| City and a research fly in the deployed configuration | 0.0073                  |
| City, the fly and the eye                             | 0.369                   |
| One image in the city (1,694 rays), 100 images per s  | 7.4 ms (0.74 of a core) |

In those 300 s the fly flew, walked or landed in about 46% of samples, and
the static scene had to be cast again for 13,802 of 30,000 images. The
deployed life costs about 0.7 ms per 0.1 s tick on the project's laptop and
already blocks for 17–19 s every five minutes to checkpoint, on one OCPU
([operations](BETHESDA_CONTINUOUS_LIFE.md#running-it-on-one-vm)). An eye at
this resolution and rate would take most of that core whenever the fly moves.
Halving the lattice's resolution would cut rays about fourfold, and 50 Hz
images would halve them again, but neither has been validated: a coarser eye
is a different eye and needs its own battery.

## Continuity

The eye's state is plain typed arrays (adapted luminance, contrast, delayed
contrast, motion, unit outputs) and a short history of outputs, so the
whole-graph snapshot (`life/snapshot.ts`) records it with no serializer. The
test above restores a research fly mid-approach from such a snapshot and
steps it beside the uninterrupted one: same bytes, same state hash at every
step, same escape.

The eye's state is new when it starts: its first image initializes the
adaptation, with no contrast and no motion. It holds nothing learned: it
forgets everything it saw within about a second. Were it ever given to an
original, its initial state would be a new sensor's, not anything the fly had
experienced, and removing it would leave the controller's graph untouched,
because the eye adds state beside the controller and changes none of it
(observe mode is step-for-step identical). The case against doing so is in the
results above, not in continuity: see [Project Genesis](PROJECT_GENESIS.md#echo-migration-proposal).

## What this does not show

- It does not show the fly's visual system: the eye is a reduced rate model of
  a few published mechanisms, with every constant a model choice. It has no
  T4/T5 split, no LPi or LC4 neurons, no photoreceptor dynamics, no connectome.
- It does not compare with real flies' escapes. The battery's stimuli are
  simulated spheres and its ground truth is geometric.
- Development and held-out splits share their stimulus vocabulary and arena.
- Only perched flies were tested. A flying fly's own motion fills the eye with
  optic flow; how the looming units behave in flight is untested.
- The arena's spheres pass through its floor near the end of low approaches
  (the fly stands on the floor); the eye sees only the part above it, the
  geometric proxy the whole sphere.

## Reproduce

```sh
npx vitest run src/bethesda/vision
node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts dev --protocol looming-v2 --check
node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts heldout --protocol looming-v2 --check
node scripts/run-ts.mjs scripts/vision-looming-evaluate.ts report --check
node scripts/run-ts.mjs scripts/vision-cost.ts --out .fly-vision/cost.json
```

A `--check` reproduces a record byte for byte on its platform, with code whose
battery digest is the record's (check a record out at the commit it names).
`--scratch` runs from a working tree into `.fly-vision/`, never a result.

## References

- Ache, J. M. et al. 2019, Curr Biol 29:1073, doi:10.1016/j.cub.2019.01.079
- Drews, M. S. et al. 2020, Curr Biol 30:209, doi:10.1016/j.cub.2019.10.035
- Hassenstein, B. & Reichardt, W. 1956, Z Naturforsch B 11:513, doi:10.1515/znb-1956-9-1004
- Klapoetke, N. C. et al. 2017, Nature 551:237, doi:10.1038/nature24626
- Maisak, M. S. et al. 2013, Nature 500:212, doi:10.1038/nature12320
- Schnell, B. et al. 2010, J Neurophysiol 103:1646, doi:10.1152/jn.00950.2009
- von Reyn, C. R. et al. 2014, Nat Neurosci 17:962, doi:10.1038/nn.3741
