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

## What remains of R.A.I.N. Genesis

Stages B–G, in order: physiology driven by this world (temperature, water,
food) on research bodies; the strongest connectome hybrid benchmarked against
ECHO's controller in it; learning whose usefulness is tested under held-out
environments; long developmental histories and their individuality; a
read-only causal trace of stimulus, neural activity, action and feedback; and
continuity-preserving proposals for each original. See
[Project Genesis](PROJECT_GENESIS.md) for where Eva and ECHO stand.
