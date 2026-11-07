# R.A.I.N. Genesis: a world that exists on its own

> **Research only.** The ecology runs in its own folder,
> `src/bethesda/ecology/`, which nothing in production imports (a test checks).
> Every fly in it is a new research subject built from a seed (`research-…`).
> It was not given to Eva or ECHO and cannot be without the owner's separate
> approval and a recorded continuation.

R.A.I.N. Genesis asks for persistent, adaptive, embodied research organisms
whose behaviour comes from the interaction of body, nervous system, physiology,
environment and accumulated experience. Stage A is the environment: a world
that changes whether or not anything lives in it, that a fly can change only
through explicit mechanisms, and whose changes can be checked. This document
covers Stage A; the later stages are listed at the end as what remains.

## Short version

- **Built:** a 20 m yard where weather, soil water, fruit, nectar and odour
  evolve on their own: fruit falls from trees, ripens with thermal time, grows
  yeast, ferments (releasing odour) and rots; flowers secrete nectar by day;
  odour is carried by the wind, diffused and lost; rain wets the soil and
  evaporation dries it.
- **Deterministic without a fly:** the same seed gives the same world, hash
  for hash; the weather is a pure function of the seed and time.
- **A fly changes it only through recorded interactions:** the sugar its body
  takes while feeding, and the yeast it leaves on fruit it feeds on. A bare
  ecosystem handed those records reproduces the fly's world exactly; until the
  fly first feeds, its world is the fly-less world, second for second.
- **Books close:** sugar, soil water and odour are each conserved to rounding
  (relative residuals under 10⁻⁹), with every source and sink named.
- **Not validated against any real ecosystem.** Every rate is a model choice,
  listed in `src/bethesda/ecology/params.ts`.

## The model

Two clocks: the ecosystem steps once per simulated second; a fly in it is
decided on every 50 ms, sensed every 10 ms and integrated every 5 ms. The
ecosystem never reads the fly, and the fly reads the ecosystem only through
the `FlyWorld` interface every other world implements.

| Process                      | What it does                                                                                                                                                                                                                                                                                                   | Conserved                                                  | Model choices                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Weather (`atmosphere.ts`)    | Light (a day and night, dimmed by cloud), cloud, temperature (daily and three-day swings), humidity, wind (gusts over 15 min, veering over 2 h) and rain, from seeded simplex noise read at the time                                                                                                           | (stateless)                                                | every amplitude and timescale; one wind for the whole yard                                        |
| Soil water (`ecosystem.ts`)  | Rain adds water to every open cell; evaporation (faster when warm, windy and dry) removes it; a cell holds at most 20 mm and drains the rest                                                                                                                                                                   | rained = held + evaporated + drained                       | rates, capacity, no runoff between cells                                                          |
| Fruit                        | Falls from three trees (about 6 per tree per day at 22 °C, none below 10 °C), ripens with Q10 = 2, grows yeast logistically once half-ripe, ferments sugar in proportion to yeast, rots past ripeness 2.5 (faster when the soil is wet), and is gone at 2% of its sugar                                        | produced = held + eaten + fermented + rotted               | sugar per fruit, rates, the shape of ripening                                                     |
| Nectar                       | Six flowers secrete nectar (25% sugar) in daylight up to 2 µL; its water evaporates in dry air while its sugar stays; a flower scents the air while it holds any                                                                                                                                               | (sugar, in the books above)                                | secretion, cap, evaporation                                                                       |
| Odour (`field.ts`)           | Fermentation releases volatiles in proportion to the sugar fermented; flowers emit a little. A conservative finite-volume solver carries odour with the wind (first-order upwind), diffuses it (eddy diffusivity 0.05 m²/s) and loses it (5 min), on 0.5 m cells; rocks block it; clean air enters at the edge | emitted = held + lost + out (+ rounding, which is counted) | one near-ground layer; uniform wind; numerical diffusion of about \|u\|·h/2 along the wind        |
| The fly's world (`world.ts`) | Ground, tree trunks (landmarks), rocks (obstacles with tops), fruit and flowers as food patches and landing sites, the sun moving with the hour and casting shade, odour read from the field falling off with height                                                                                           | (reads only)                                               | the fly senses odour, light, wind and food as it does in every world; not temperature or humidity |

### What a fly does to it

The life (`life.ts`) gathers, each second, what the fly's body did: the energy
its body took while feeding (`counts.fedJ`, turned into sugar at 16.7 J/mg)
on the item under its feet, and the seconds it fed. At the end of that second
it applies them to the ecosystem as recorded interactions:

- **`consume`**: the item gives up to what it holds. Anything the body took
  beyond that is booked as `unbacked`: the body's feeding model (unchanged,
  part of the fly's simulation) can run on past an emptied item for the rest
  of a second.
- **`inoculate`** (fruit only): the fly leaves yeast in proportion to its
  feeding time. Flies carry and spread yeasts; the amount here is ours. More
  yeast means faster fermentation and more odour from that fruit, so a fly's
  visit changes what that part of the yard smells like hours later.

Nothing places food near a fly or because a fly needs it. The trees' draws
are made on a fixed schedule (three per tree per second, whatever happens), so
nothing a fly does shifts them.

## Tests

`src/bethesda/ecology/ecology.test.ts` (13 tests):

- the weather is a pure function of the time, within its ranges, with days
  and nights;
- a puff's centroid moves at the wind's speed (exactly), and its spread grows
  as the exact solution's (2·D·t across the wind, with the scheme's own
  numerical diffusion added along it);
- odour never enters an obstacle, never goes negative, keeps its books, and
  is shadowed in an obstacle's lee;
- the ecosystem is deterministic from its seed, without any fly;
- its sugar, water and odour books close, and nothing goes negative, in
  randomly generated yards (a property test over seeds);
- fruit ripens, ferments and rots; yeast grows only on ripe fruit;
- it restores from a whole-graph snapshot and lives on identically;
- a research fly in it is refused if its id names an original;
- **until a fly first feeds, its world equals the fly-less world, second for
  second; after, a bare ecosystem replayed from the fly's recorded
  interactions equals the fly's world, and the fly-less world does not;** the
  sugar the world gave plus what was unbacked equals what the body took;
- a fly's yeast hastens a fruit's fermentation and its odour;
- feeding empties a flower, with any excess booked as unbacked.

## Reference scenarios

`node scripts/run-ts.mjs scripts/ecology-reference.ts` writes
[`benchmarks/ecology/`](benchmarks/ecology/README.md) from a clean commit;
`--check` reproduces each record on its platform. Two independent runs (a
scratch run and the recorded one, from commit `8c391af`) gave identical
records.

- **30 days with no fly** (seed 42): 610 fruits fell, 503 were gone by the
  end and 107 lay in the yard; the yard held between 83 and 117 fruit from the
  fifth day on. 1.22 kg of sugar was produced, 861 g fermented and 234 g
  rotted. The worst daily residual of the books was 1.5 × 10⁻⁷ mg of sugar,
  1.9 × 10⁻⁵ mm of water (summed over 1,600 cells) and 0.013 µg of odour, of
  about 3.4 × 10⁷ µg emitted. It took 315 s of one core here (10.5 s per
  simulated day).
- **A day with one research fly** (the deployed configuration, placed with
  0.3 of a full reserve): it fed for 502 s, almost all of it on one fruit,
  taking 1.13 J; the yeast it left took that fruit to the yeast cap (1.0
  against 0.05 in the fly-less world), so it ferments and smells far sooner.
  It also sipped nectar. The ecology replayed bare from its 999 recorded
  interactions equals its world; the fly-less world does not; nothing it took
  was unbacked. Its artificial maintenance supplied 2.31 J that day, more than
  food did: in the deployed configuration hunger is cushioned, which Stage B
  must remove for research bodies.

## What this does not do

- It is not validated against any real yard, orchard or climate.
- Odour is a single layer with uniform wind; there are no turbulent puffs or
  intermittency, no vertical structure, no flow round obstacles beyond
  blocking.
- Temperature and humidity exist in the world but the fly cannot sense them,
  and its body's energy use does not depend on them.
- The fly cannot drink; the soil's water is not yet the fly's.
- The yard has no other animals, no plant growth and no seasons.
- **A flaw found in the 30-day record:** a flower's nectar is capped in volume
  but not in sugar, so as its water evaporates new secretion keeps adding
  sugar; unvisited flowers held 112 mg between them after 30 days. Real
  nectaries stop secreting or resorb; the next version of the ecology caps the
  sugar.

## Stage B: bodies the world can harm

Stage B puts a body in the world whose physiology the world drives, for
disposable research subjects only. It changes nothing for Eva or ECHO, which
cannot die.

### The ecology, version 2

`research-ecology/2` adds what water needs to matter:

- **Nectar capped in sugar** as well as volume (the flaw above).
- **Canopies** that shade the ground (the sun's ray meets them) and cut
  evaporation under them to 30%.
- **Springs** seeping water into a cell, and surface water spreading slowly
  between neighbouring cells, so a spring wets a patch.
- **Water vapour** from evaporating ground, carried by the wind and lost like
  odour: a humid plume downwind of wet ground, which a fly's antennae meet.
- **A walled courtyard**: walls as high as the air the fly may use.
- **Drinking** from the ground, a recorded interaction booked in the water
  ledger (rained + sprung = held + evaporated + drained + drunk).

The v1 reference records stay reproducible at commit `8c391af`, where v1
lives.

### Homeostasis (`homeostasis.ts`)

| Variable         | What drives it                                                                                                                            | Limit                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Body temperature | Relaxes (20 s) toward the air's temperature plus 6 °C in full sun                                                                         | Death above 39 °C        |
| Energy           | The body's own spending, plus the difference a Q10 of 2.5 makes against its 25 °C power, taken from (or given back to) its reserve        | Death after 30 min empty |
| Water            | Lost in proportion to the vapour-pressure deficit at body temperature (Murray 1967), doubled in flight; gained by drinking and from juice | Death below 35%          |

Each is a model choice of a plausible order, named in the file; none is
fitted to Drosophila. Water loss was set so that, in the study's dry yard,
water binds before food: a resting fly goes from full to lethal water in
about 6 hours and empties its reserve in about 12. That calibration was made
on development settings so that the study asks about water and heat at all,
and is stated here because it shapes every result.

### Feedback (`policy.ts`)

Layered over the deployed controller, reading only what a fly could sense:
its own water and body temperature, the humidity at its antennae
(hygrosensation; Enjin et al. 2016, Knecht et al. 2016), water under its feet
(water taste; Cameron et al. 2010) and the direction of the light.

- **Thirst** (water below 0.7): on water, stay still and drink; elsewhere,
  walk and turn more while the humidity falls and less while it rises; after
  30 s without a clear step up, turn about and search elsewhere. On foot only.
- **Heat** (body above 31 °C): in the light, walk away from it for up to a
  minute, then rest as long; in shade, stay still.
- An escape always stands; outside its extent the controller turns the fly
  back.

### What building it found

Development runs (not results) found three things worth keeping:

- With the heat-driven metabolism, mortal flies starved before thirst
  mattered: the deployed controller forages slowly in the yard (hungry flies
  went five hours without feeding). Water loss was raised so water binds first.
- A thirst search that took off handed the flight to the controller, whose
  phototaxis carried the fly out of the yard and, once the yard was walled, to
  the sunward wall. The search now stays on foot.
- Air humidity is not water: near a spring the humid plume reaches beyond the
  wet ground, so a policy that drank on humid air rested where the body could
  not drink. Drinking is now decided by contact.

### The study and its held-out result

`homeostasis-v1` (frozen at `724e36e` before its held-out split ran) puts
mortal research flies in generated courtyards. The climate is dry and warm:
25 °C mean, a 5 °C daily swing, the humidity shifted down by 0.4. Each yard
has five trees, four with canopies, six flowers, two rocks and three springs
under the canopies. A fly starts at least 4 m from a spring at 08:00, after
the yard's two-day spin-up, and lives up to 8 hours. Six arms per fly:

| Arm               | Body                                                                                   | Feedback                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| deployed          | the deployed configuration: maintenance on, cannot die (a reference, not a comparator) | none                                                                             |
| no-feedback       | mortal                                                                                 | none: the deployed controller alone                                              |
| full              | mortal                                                                                 | thirst and heat                                                                  |
| no-thirst         | mortal                                                                                 | heat only                                                                        |
| no-heat           | mortal                                                                                 | thirst only                                                                      |
| shuffled-humidity | mortal                                                                                 | both, with humidity read at a displaced point (a control for the humidity sense) |

The held-out split (8 yards × 2 flies × 6 arms = 96 runs) ran once, in four
shards, and was scored unedited:
[record](benchmarks/homeostasis/homeostasis-v1-heldout.json),
[README](benchmarks/homeostasis/README.md). Intervals are paired percentile
bootstraps over yards, 95%.

| Criterion                                              | Result   | Measured             |
| ------------------------------------------------------ | -------- | -------------------- |
| H1 (primary): hydrated share, full − none, above 0     | **fail** | +0.07 [−0.05, +0.16] |
| H2: hydrated share, full − heat only, above 0          | pass     | +0.11 [+0.05, +0.18] |
| H3: hydrated share, full − displaced humidity, above 0 | pass     | +0.09 [+0.02, +0.17] |
| H4: survival, full − none ≥ 0.25, above 0              | **fail** | +0.19 [−0.25, +0.56] |
| H5: hours hot, full − thirst only, below 0             | **fail** | +0.18 [−0.02, +0.47] |
| H6: median hydrated share of full ≥ 0.8                | pass     | 0.80                 |

| Arm                | Alive at 8 h | Mean hydrated share | Mean hours hot | Deaths                      |
| ------------------ | ------------ | ------------------- | -------------- | --------------------------- |
| no feedback        | 10 of 16     | 0.76                | 0.19           | desiccation 5, starvation 1 |
| thirst and heat    | 13 of 16     | 0.83                | 0.39           | desiccation 2, starvation 1 |
| heat only          | 8 of 16      | 0.72                | 0.36           | desiccation 8               |
| thirst only        | 15 of 16     | 0.82                | 0.21           | starvation 1                |
| displaced humidity | 8 of 16      | 0.74                | 0.37           | desiccation 8               |

**What it shows.** The primary criterion fails: with both feedbacks, mortal
flies were not reliably better hydrated than with none. H2 and H3 pass, but
they say less than they appear to. The arms they compare against (heat only,
displaced humidity) are worse than no feedback at all, so they show that the
humidity sense matters inside the full policy, not that the policy beats
none.

**What the held-out split found, exploratory.** These comparisons were not
pre-registered. They are the same bootstrap over the same record:

- **The heat policy makes flies hotter.** Hours with the body above 32 °C (the
  study's endpoint; the policy itself acts above 31 °C), heat only − none:
  +0.17 [+0.03, +0.40]; full − none: +0.20 [+0.05, +0.43]. In this body, heat
  comes only from the sun (no activity heating). The policy walks a hot fly
  away from the light's bearing. In a yard whose shade lies under four
  canopies, that direction rarely leads to shade, and the policy takes over
  from the controller, whose foraging flights end at trees. That mechanism is
  a hypothesis; nothing here tested it.
- **Thirst alone did best.** Survival, thirst only − none: +0.31 [+0.06,
  +0.56]; thirst only − full: +0.13 [0.00, +0.38]. Hydrated share, thirst only
  − none: +0.06 [−0.05, +0.17].

Both point to a next protocol (shade-seeking by the canopies' shadow, or no
heat policy). That protocol would need its own held-out split: the policy was
not changed after this one.

## Stage C: a circuit from the FlyWire brain in the loop

The repository already runs both connectomes whole
([ECHO Connectome](ECHO_CONNECTOME.md)). What those runs said about putting
one in a fly:

- **The whole brain is too slow for a life.** FAFB v783 runs at about 1.3 s
  per simulated second on one thread, and a closed loop with it ran 25–45
  times slower than real time
  ([ECHO Adaptive Intelligence](ECHO_ADAPTIVE_INTELLIGENCE.md)). An 8-hour
  life would take days.
- **The validated way in is a reduced module** that has passed a test of its
  own ([Project Genesis](PROJECT_GENESIS.md)).
- **Feeding is where the ecology decides life.** The full brain's
  sugar → MN9 pathway reproduces Shiu et al.'s criteria. Its closed-loop
  feeding came in fragments only because its readout read one 10 ms step.

### The cut (`python -m fly_neural reduce`)

In Shiu et al.'s model a neuron acts on others only through its spikes. A
neuron that never spikes changes nothing downstream. So the neurons a stimulus
makes spike, with the inputs and the readout, reproduce the whole brain on any
input whose spiking set they contain. That is a claim about this model,
checked here, not about the fly.

- **How it is cut.** `reduce cut` drives Shiu et al.'s sugar GRNs, as Poisson
  inputs, through the whole brain:
  - at 10–300 Hz, and in 300 ms pulses;
  - 20 trials each, the development regime only;
  - keeping every neuron that spiked in any trial, the synapses among them,
    and the original order.
- **Why the order matters.** Spikes are gathered in the order neurons first
  left rest, and each target sums its inputs in that order, so restricting
  both to the kept neurons changes no floating-point sum.
- **What it is.** 496 of 139,255 neurons, and 24,858 of 15.1 million
  connected pairs.
- **Where it lives.** The cut is a connectivity table derived from FlyWire. It
  is written under the data directory, never into the repository, and the
  records name its SHA-256. `reduce cut` from the pinned release reproduces
  it.
- **How it is checked.** `reduce check` runs the whole brain and the cut side
  by side, with the same random draws. It counts exact trials and the neurons
  outside the cut that spiked (closure violations).
- **The development check (110 trials) passed all three criteria:**
  - MN9 within tolerance in every condition, with 0.76 Hz to spare;
  - 106 trials exact;
  - every trial without a closure violation exact.

  Closure violations appear only at 150 Hz and above.

- **The held-out check passed all three criteria.** The regime was new rates,
  two ramps, a step down and a flicker, with new seeds: 110 trials, run once
  from the clean commit `404815b`
  ([record](benchmarks/fly-neural/adaptive/feeding-reduced-v783-heldout.json);
  [cut](benchmarks/fly-neural/adaptive/feeding-reduced-v783-cut.json)).

  | Criterion                                                                 | Result | Measured                             |
  | ------------------------------------------------------------------------- | ------ | ------------------------------------ |
  | R1 (primary): MN9 within 2% or 1 Hz of the whole brain in every condition | pass   | at least 1.0 Hz inside the tolerance |
  | R2: at least 95% of trials exact on every kept neuron                     | pass   | 109 of 110                           |
  | R3: every trial without a closure violation exact                         | pass   | 107 of 107 (3 violations in all)     |

  In the same Python engine, the whole brain cost 3.27 s per simulated
  second on this machine and the cut 0.30 s.

### The engine (`connectome/lif.ts`)

The fly runs the cut in TypeScript, inside its own loop, by the same
integrator in the same order of operations.

- **Conformance.** On a synthetic network (not a connectome) driven by
  recorded kicks, it gives the Python engine's 701 spikes exactly, step for
  step and in firing order (`lif.test.ts`).
- **Rest.** In floating point a decaying neuron never quite reaches rest: it
  sticks about 10⁻¹² mV above it, with its conductance at a subnormal number.
  An idle circuit within a nanovolt of rest is therefore set to exact rest
  and costs nothing.
- **Cost.** 35–46 ms per simulated second of sugar input on one core of this
  machine, 20–28 times faster than real time.

### The hybrid (`connectome/feeding.ts`)

- **Taste.** While the fly stands on food, the sugar GRNs fire at
  200 Hz × hunger, where hunger = 1 − reserve. That starvation raises
  sugar-GRN sensitivity is Inagaki et al. 2012's finding; the linear form and
  the ceiling are this model's.
- **Decision.** The fly feeds while MN9's mean rate over the trailing 500 ms
  is at least 10 Hz, the connectome backend's own feed readout.
- **No satiety signal is added.** A meal ends when hunger has turned the
  sugar neurons down to where MN9 falls below threshold.
- **What counts as food.** The readout decides this for the rest of the fly.
  While it is off, the controller is told nothing edible is underfoot, and
  does whatever it does anywhere else.
- **What stands.** An escape always does. Off food, the controller decides.
- **Calibration.** On the pinned circuit, the readout first reaches 10 Hz at
  46 Hz of sugar input (40 trials per rate). That puts the threshold arm's
  hunger point at 46 / 200 = 0.23.

**What a development run showed.** MN9 crosses threshold about 150 ms after
the fly lands on fruit, then holds at 60–80 Hz through the meal.

- **Where a meal ends.** The readout falls below threshold when the sugar
  input is near 40 Hz, at a reserve of about 0.8. The deployed controller eats
  toward 0.98.
- **Bouts.** Near that point MN9 hovers around its threshold, and the readout
  flickers: feeding comes in many short bouts at the end of each meal.
- **What was not done.** Neither was tuned away. The ceiling was not raised to
  imitate the controller, and no hysteresis was added.
- **A design flaw found and fixed.** The first design kept the controller
  informed of the food and replaced its feed command with rest whenever the
  readout was off. That pinned hungry flies to the food:
  - The controller asked to feed every 50 ms and never reached the rest
    state's takeoff.
  - In the shuffled and threshold arms, flies stayed on one fruit for all 8
    hours, with more than 560,000 vetoes each.
  - The intact hybrid was vetoed 11,580 times in one life.

  The current design, above, replaced it before the protocol was frozen, and
  the development split was re-run.

The study, `connectome-feeding-v1`, compares the hybrid with:

- the controller;
- the same circuit with its weights shuffled across its pairs;
- a plain hunger threshold set where the intact readout crosses.

Its primary criterion is that the hybrid leaves the fly no worse fed than the
controller, within 20% (time-weighted mean reserve). It is frozen, with the
circuit's digest pinned, before its held-out split runs.

**What could not be done here.** BANC v888's tables come from Codex, which
requires the owner to sign in and accept its terms. No BANC module was built
in this stage. The repository's BANC results stand as they were.

## Stage F: a read-only causal trace

`trace.ts`'s `Tracer` samples a research fly's life without changing it:

| Group       | What it holds                                                                                                                 | Provenance                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| world       | weather at the sample                                                                                                         | measured in the simulation                    |
| senses      | odour, light, airflow and looming drive in the fly's sensory frame, and humidity at its antennae                              | measured in the simulation                    |
| body        | mode, position, reserve, energy fed                                                                                           | measured in the simulation                    |
| physiology  | water, body temperature, alive                                                                                                | a model's variables                           |
| learning    | the mushroom body's trials, mean plastic weights, the last trial's prediction and dopamine, the navigator's remembered places | a model's variables                           |
| decision    | the last command the gate accepted, with the controller's logged reason                                                       | measured: text its code writes, not a thought |
| policies    | how often each homeostatic policy overrode the controller                                                                     | measured in the simulation                    |
| effects     | the interactions the fly had with the world                                                                                   | measured in the simulation                    |
| unavailable | neural activity outside the mushroom body's rate units, motivation as such, anything about experience                         | not modelled                                  |

**It only reads.** A test steps a traced life beside an untraced one and
compares both state hashes at every sample. That test found that a mortal
fly's state could not be hashed: the heat policy's walk timer started at −∞.
It now starts at null. Re-running held-out yard 3 of `homeostasis-v1` with
the fix gives all 12 trials identical to the record.

`scripts/ecology-trace.ts` writes one fly's 8-hour trace and a self-contained
page that draws it:

- small-multiple charts of its water, the humidity, odour, reserve, its
  temperature against the air's, and its learning trials;
- a band of its modes, with its interactions marked;
- for any moment, the loop it was in: stimulus → internal state → decision →
  action → effect.

## What remains of R.A.I.N. Genesis

Stage C's held-out split; Stage D, learning whose usefulness is tested under
held-out environments; Stage E, long developmental histories and their
individuality; and Stage G, continuity-preserving proposals for each
original. See [Project Genesis](PROJECT_GENESIS.md) for where Eva and ECHO
stand.
