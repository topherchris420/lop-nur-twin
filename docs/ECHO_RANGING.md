# ECHO ranging: a fixed wide search beats learning one, and flies were getting trapped

**Status: research flies only, development runs only, NOT DEPLOYED.** Nothing here
has run on the original individual, a copy of its archive, or the VM. **No sealed
test has been run,** so nothing below is a held-out result. The seeds set aside for
one, yards 2001–2024 and city 2101–2124, are unused.

This work set out to teach a fly something that changes how it covers ground. It
found two things instead:

1. **Research flies on the real map were getting trapped inside solid buildings,**
   and that hid much of what they could do. A guard for research flies stops it.
2. **With the trap gone, always searching widely beats learning when to.** The
   learner is the organism's own search plus a choice between two settings written
   here, and it does clearly worse than simply using the wider one.

| Question                                  | Answer, in development                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Do flies get inside solid buildings?      | **Yes.** 6 of 12 plain flies within 96 h. None came out. 33% of all fly time and 52% of meal-less hours were inside.                                                                                                      |
| Does the guard stop it?                   | **In 47 of 48 lives.** The exception was a bug in the guard, since fixed ([seed 205](#seed-205)). Of 12 lives replayed, all six that were trapped stayed out, and the other six matched in every 3 h period for all 96 h. |
| Does that help them?                      | **Yes.** Same seeds, 78.0 to 113.6 meals in 96 h, +35.6 [14.0, 58.3].                                                                                                                                                     |
| Does a wider search pay on the real map?  | **Yes.** 166.1 meals against 112.3, +53.8 [31.1, 76.8], and +4.97 J net [1.99, 8.71].                                                                                                                                     |
| Does the learner pay on the real map?     | **Not shown.** 135.1 against 112.3, +22.8 [−0.8, 49.5], and +2.32 J net [−0.60, 6.12]. See [seed 205](#seed-205).                                                                                                         |
| Does learning beat the fixed setting?     | **No, it loses.** −31.0 meals [−47.4, −16.0], −2.64 J net [−4.20, −1.05]. It settled on the wider search in 3 of 12 flies.                                                                                                |
| Does what it learned follow its training? | Yes, in yards. Settled wide: 7 of 12 trained on far food, 1 of 12 on near. Flight shift +3912 m [446, 6719].                                                                                                              |
| Is that useful in a new yard?             | Only in the world it matched and only in meals: far food +6.5 [1.4, 13.3]; net −0.02 J [−0.58, 0.63]. Specific gain +1.5 [−2.0, 5.5], not shown.                                                                          |
| Is this an unscripted behavior?           | **No.** It chooses between two settings written by hand, one picked from the test below.                                                                                                                                  |

Intervals are 95%, from resampling seeds. Each comparison has 12 seeds. Every number
here came after seeing earlier ones on the same questions, so all of it can only
suggest. The data are in [`docs/benchmarks/echo-ranging/2026-11-03/`](benchmarks/echo-ranging/2026-11-03/).

These are functional claims about a computational model, which is not a complete
fruit-fly nervous system, and nothing here is evidence of awareness.

## Could searching differently pay at all?

Asked first, before building a learner (`src/bethesda/life/acquired/ceiling.ts`).
Flies live with a fixed search: how far a long flight goes (`exploreDistanceM`, 60 m
by default) and how often a takeoff starts one (`exploreShare`, 0.3). Learning can
only pay if the best setting depends on the world.

| Setting compared with the default (12 seeds) | Yard, near food, meals | Yard, far food, meals | Yard, far food, net J |
| -------------------------------------------- | ---------------------- | --------------------- | --------------------- |
| short, 15 m                                  | +0.0 [−5.1, 5.1]       | −8.4 [−11.5, −5.3]    | −0.39 [−0.75, −0.06]  |
| long, 240 m                                  | +7.8 [4.8, 10.8]       | +9.9 [5.1, 15.4]      | +0.24 [−0.32, 0.82]   |
| roam, 240 m and 0.8 of takeoffs              | +8.3 [4.8, 12.3]       | +18.0 [13.2, 22.4]    | +0.63 [0.18, 1.03]    |

Roam was better for meals in both kinds of yard. Only its energy differed by world:
near food it cost −0.20 J [−0.46, 0.06], which is the one opening a learner had. On
the real map over 48 h, still with the trap, it gained +24.6 meals [7.3, 40.3] and
+2.05 J net [0.13, 3.72]. That test warned that "one that wins everywhere needs no
learner, only a different number", and the later results agree with it.

## The learner

`src/bethesda/life/acquired/ranging.ts`, `RangingAdapter`. A two-armed choice between
the default and roam. It runs each way for an hour at a time, adds up the energy that
came in and went out, and compares return per joule. Until each way has four blocks
it has no opinion, and it still tries the other way on one block in five. It settles
on the wider way only when the gap clears one standard error.

What it comes to prefer is not written anywhere, and depends only on what the fly
experienced. Everything else is written: the two settings, the signal and the rule.

**Version 1** scored net energy per 30-minute block over 24 h of training. It did not
work: 3 of 12 flies settled wide on near food, 2 of 12 on far, and −7.3 meals
[−30.6, 14.1] in the city. **Version 2,** above, changed the signal, the block length
and the training length together after seeing that, so which change mattered is not
known.

Its yards are a crossover: each seed trains on near or far food for 48 h, then lives
in unseen yards of both kinds with what it learned kept and with it erased. Test food
lay in distance bands that only partly overlap the ones it trained on. Results are in
`report-dev-v2-yards.json`. These yards have not been checked for the trap below,
and they have no building prisms.

## Flies inside buildings

While testing the learner, some flies stopped eating for good. They were inside
buildings. `DigitalFly` refuses to _start_ inside a solid, so this state was never
meant to exist.

### How a fly gets in

Measured on research flies (`src/bethesda/fly/fly.ts`, `src/bethesda/fly/world.ts`,
neither changed here):

1. Walking checks only whether the next spot is solid, and the fly's steps shrink at
   an edge, so it can come to rest exactly on a wall's line, to within about 2e-14 m.
2. On that line, `solid` says outside, but `rayPrism` computes a slightly negative
   distance and discards the wall.
3. So a jump's collision ray returns nothing, and the first step of about a millimetre
   goes through. A second way in: a ray going _outward_ from the line can still hit the
   wall at about zero, and the slide along it can end just inside by rounding.
4. From inside, rays hit normally, so the walls hold and the fly never leaves.

A control: a fly placed inside stayed in a 2 by 8 m space for 2 simulated hours;
placed on that roof, it left and fed within about 20 minutes.

### How often

Twelve plain lives replayed with a position check each simulated second
(`scripts/echo-foodless-probe.ts`, `entries-plain.jsonl`). Meals matched the earlier
runs of the same seeds exactly.

| Seed | Went in at | Building   | Meals in 96 h, plain | With the guard |
| ---- | ---------- | ---------- | -------------------- | -------------- |
| 181  | 11.0 h     | 751999459  | 18                   | 120            |
| 182  | 21.1 h     | 1011267786 | 28                   | 122            |
| 183  | 36.3 h     | 1011267786 | 68                   | 142            |
| 185  | 23.1 h     | 1011265875 | 39                   | 105            |
| 189  | 37.6 h     | 751999419  | 37                   | 97             |
| 190  | 71.5 h     | 1011267780 | 74                   | 105            |

The other six (184, 186, 187, 188, 191, 192) never went in, and the guard changed
nothing for them. **Every earlier real-map number in this area comes from flies that
could be trapped,** including the city comparison in
[`ECHO_ACQUIRED_BEHAVIOR.md`](ECHO_ACQUIRED_BEHAVIOR.md). Whether it bears on the
deployed fly's slow learning in the city has not been tested.

### The deployed fly

A read of the public witness on 2026-11-03 at 04:36Z, changing nothing, put the live
fly at (465.66, 14.22, 638.19), with `world.solid` true for that point, inside building 1011267786. Forty seconds of samples later it was resting at (466.2, 12.2, 636.9), still
inside, with energy falling slowly. How long it has been there is not known, because
the witness shows only the present and the ledger holds no positions. `src/bethesda/fly`
is the same in the deployed release as here.

**This work does not change the deployed fly.** Moving it would be a permanent part of
its record, and fixing `fly/` changes its version, so both are the owner's decisions.

### The guard

`src/bethesda/life/acquired/wallGuard.ts`, on research flies only. It wraps one fly's
own `move`: a step that would end inside a solid does not happen, and the fly is left a
standing height off that surface. Until its first refusal a guarded life is exactly the
plain one. It is a test of a fix, not the fix itself, which would belong in `fly/`.

Across 48 lives it refused 120 steps, in 22 of them, and named the surface every time.

<a id="seed-205"></a>

**Seed 205.** One of those 48 lives still ended up inside, because of a bug in the first
version of the guard. That fly had flown into the thin gap beneath a building on a
slope, where the floor is lower than a fly stands. It touched down, and the guard stood
it on the ground, which put its body inside the floor. It ate 12 meals. A replay with
logging showed this (`leak-seed-205.jsonl`, `insideAfter: true`), and a fly with no room
to stand now stays in the air. That branch ran in no other life, so the others should be
unaffected. A re-run of that life with the fix, and of three others to confirm they do
not change, is under way. The comparisons here include that fly as it was, which flatters the two
arms set against it: without it, wider search gains +46.3 meals [26.1, 64.6] and the
learner +12.8 [−4.6, 31.7]. Learner against wider search does not involve it.

## With the trap gone

Twelve fresh seeds, 201–212, for 96 h on the real map, all guarded.

| Arm                      | Meals | Fed less spent | Meals by day           | Days under 5 meals, of 48 |
| ------------------------ | ----- | -------------- | ---------------------- | ------------------------- |
| Organism                 | 112.3 | −10.0 J        | 35.2, 27.2, 21.2, 28.8 | 6                         |
| Learner                  | 135.1 | −7.7 J         | 39.1, 30.2, 34.8, 31.0 | 0                         |
| Fixed wider search, roam | 166.1 | −5.1 J         | 42.5, 42.9, 38.3, 42.3 | 0                         |

Roam's meals hold steady across all four days. Before the guard they fell from 39.7 to
19.8 (on other seeds). No arm earns its keep: fed less spent is negative in all three,
and the model's maintenance is what keeps them alive.

The learner spent 28% of its blocks on the wider way, including its one-in-five tries,
and settled on it in 3 of 12 flies.

## Flies still drift east

The last food patch is at x = 359 m and the city's edge at x = 473.9 m. Flies still end
up past that patch, and eat less there. Share of 3-hour samples east of it, on the fresh
seeds, taken from where each fly was at the end of the period:

| Arm                      | By day             | Meal-less 3 h periods, of 384 | Of those, east | Meals per period, east vs west |
| ------------------------ | ------------------ | ----------------------------- | -------------- | ------------------------------ |
| Organism                 | 10%, 22%, 51%, 42% | 194                           | 88             | 1.7 vs 4.3                     |
| Learner                  | 25%, 42%, 35%, 39% | 160                           | 85             | 2.4 vs 5.2                     |
| Fixed wider search, roam | 24%, 17%, 35%, 28% | 110                           | 63             | 2.3 vs 6.2                     |

So stopping the trap does not stop hunger: about half of the plain fly's periods still
have no meal. **Why they drift has not been tested.** Steering toward light with no goal is one
possibility.

## What this does not show

- It is not a behavior the fly invented, and not the transfer of a useful behavior to an
  unfamiliar situation under sealed evaluation.
- The guard has only been shown on these lives, and one spot directly: at a real wall,
  plain flies went in on 5 of 12 tries, guarded ones on 0 of 12. A test at 60 random
  walls told us nothing, since plain flies did not go in there either.
- Nothing has been checked for the trap in yards, or on any other surface in the city
  than the ones met in these lives.
- The fixed setting's gain is development only, on one map, and meals are not fitness.

## Repeating it

Research lives with no store: nothing here reaches an individual or an archive.

```sh
# The learner in yards, and on the real map with the guard.
node scripts/run-ts.mjs scripts/echo-ranging-evaluate.ts run --seeds 161 --trained near,far,mixed --out y.jsonl
node scripts/run-ts.mjs scripts/echo-ranging-evaluate.ts city --seeds 201 --arms organism,learner,roam --guarded --out c.jsonl
node scripts/run-ts.mjs scripts/echo-ranging-evaluate.ts analyse-city c.jsonl

# Which fixed settings pay, and a per-second check for time inside a solid.
node scripts/run-ts.mjs scripts/echo-search-ceiling.ts yard --seeds 101 --out y.jsonl
node scripts/run-ts.mjs scripts/echo-foodless-probe.ts --seeds 181 --hours 96 --out p.jsonl [--guarded]
```

The runs used Hugging Face Jobs (`cpu-upgrade`, `scripts/echo-acquired-hf-job.py`) with
uncommitted code laid over commit `67b2818` from a checksummed bundle; `manifest.json`
has the details. Laptop arithmetic can differ from those machines, so a seed's exact life
reproduces only there.
