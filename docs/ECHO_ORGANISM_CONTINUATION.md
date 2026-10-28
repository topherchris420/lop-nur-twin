# The deployed fly continued as the ECHO organism

**Deployed on October 28, 2026.** The live individual
`04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`
continues as the organism, on release `62bd125` on the Oracle VM, after a
pause of 19 minutes 31 seconds (over the 15 budgeted) recorded as one gap.
Every check of the cutover passed: [the cutover, as it ran](#the-cutover-as-it-ran).
What comes before that record was written for review before the cutover:
the code, tests, a rehearsal on the deployed individual's verified backup,
and the plan.

The continuation keeps that individual, and only that individual: its birth,
genesis, checkpoint chain, age, city, body, controller, navigation memory,
ECHO v3 self-model and every random stream. Beside its own controller and
self-model it adds four components taken from the research extensions
([immortal organism](ECHO_IMMORTAL_ORGANISM.md),
[olfactory navigation](ECHO_OLFACTORY_NAVIGATION.md)): mushroom-body
associative learning, odor-history-guided walking, recoverable physiology,
and an archive of what its bounded memories let go. It appends one
checkpoint at the same tick, linked to the exact v3 head, with one
`organism-continuation` event. It is not a birth, not a copy and not a
replacement, and it starts no second life.

It is not a complete nervous system: a reduced-order behavioral controller,
a rate model of one learning circuit, two behavioral odor filters and five
tissue proxies. Nothing here is evidence of awareness.

Code: `src/bethesda/life/organism.ts` (the organism, its life kind and its
history rules), `src/bethesda/life/organismContinuation.ts` (the one-time
continuation), `scripts/bethesda-life-continue-organism.ts` (its `--check`
and `--commit`), the runner (`scripts/bethesda-life-headless.ts`), the store
selector (`bethesdaStore.ts`), `deploy/bethesda-life/install.sh` and
`src/bethesda/life/organism.test.ts`.

## Source and target

|                            | Release                                                                                        | Versions                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source (until the cutover) | `d25e1f3b9e40c5ded3f8ce1f435365d5c6c80592`                                                     | `bethesda-headless-life/v2`, `bethesda-city/4`, `digital-fly/8`, `echo-self-model/v3`, `bethesda-echo-upgrade/v1`, `life-graph/v1`                                   |
| Target (deployed)          | `62bd12502c17379b92e89c74d17b3e1240ddd243`, merged into `main` as `3e8cbe0` with the same tree | the same, plus `organism: bethesda-echo-organism/v1`, `mushroomBody: mushroom-body/v1`, `olfaction: echo-olfactory-navigation/v1`, `physiology: echo-maintenance/v1` |
| Kept for replay            | `c8b5fb1` (digital-fly/7), `3db627b` (ECHO v2), `d25e1f3` (ECHO v3)                            | `install.sh` keeps every release a continuation names as its source; `c8b5fb1` was pruned on the VM before this rule and is rebuilt from git when needed             |

The ECHO v3 self-model, the reduced-order controller, the body, the city and
their parameters are unchanged; `scripts/fly-source.ts --check` reproduces
the fly-source fingerprint. Before continuing, `--check` requires this
release to continue the v3 fly exactly as `d25e1f3` does for 600 ticks.

## What is kept, and what is added

**Kept, byte for byte.** The continuation edits a copy of the v3 graph: the
root becomes `OrganismLife` with an `archive`, and the adapter becomes an
`OrganismAdapter` whose every v3 key (`variant`, `inner`, `model`,
`replaced`, `onDecision`, `seedOf`, `now`) is the old graph's own node. Its
projection, `organismProjection`, removes exactly the declared additions,
restores the two class names and the old descriptor, and must give the v3
checkpoint's graph digest, or nothing is committed. The store's history
rules recompute that projection for any organism checkpoint that claims to
continue a v3 one, so a newborn fly with the same seed, carrying every other
claim copied from a real continuation, is refused.

**Added, and what each one is.**

| Component                                  | Starts as                                                                | Kind                                                                     | What it does                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mushroom body (`mushroom-body/v1`)         | innate: 2,000 Kenyon cells, weights drawn from the fly's seed, no trials | rate model of a published circuit (Bennett, Philippides & Nowotny 2021)  | Learns from each meal and each fruitless return at a place with landmark cues, and decides whether a hungry fly goes back to a place it remembers from now on                                                         |
| Inherited valuation                        | the places the navigator already holds                                   | bridging rule (model choice)                                             | A place remembered before keeps the rule it was learned under (worth a hungry return) until the fly forgets it or returns there in vain; a fruitless return at a cued place is still a learning trial                 |
| Olfaction (`echo-olfactory-navigation/v1`) | filters at rest, a seeded stream of its own                              | behavioral filters fitted to walking flies (Álvarez-Salvado et al. 2018) | ON/OFF filters of the odor the antennae sense: a hungry walking fly turns upwind and speeds up while odor is on, slows and turns in local search when it goes off                                                     |
| Physiology (`echo-maintenance/v1`)         | resting tissue                                                           | proxies, plus a **deliberately artificial** maintenance supply           | ATP availability, hydration, muscle fatigue, sleep pressure and stress; a perched fly in protective mode or asleep rests; fatigue slows walking. In protective mode an external 4 mW supply restores energy and water |
| Archive                                    | empty                                                                    | record                                                                   | Recovery and rest bouts, mushroom-body updates, and every ECHO episode the self-model's bounded memory lets go, committed with the checkpoints                                                                        |

**Biology and artificial immortality stay apart.** Energy is spent and taken
in by the existing body. Protective mode starts at 8% of a full reserve, or
when hydration falls below 0.15, ATP availability below 0.1, or fatigue or
stress above 0.95, and ends at 35% with the tissue recovered. While it lasts,
the maintenance supply adds up to 4 mW and restores hydration; it is metered
as `maintenanceJ` and `artificialWater`, never as food. A real fly has no
such source. The city has no water, so hydration is restored only this
way: a protective bout ends only with hydration back above 0.8, and from
full, at the model's loss rate, hydration alone would start one after one to
two simulated days, depending on activity. Nothing in physiology touches
synapses, places, the self-model or the fly's identity, and invalid input
stops it with an error instead of a reset.

### How the parts connect

Each decision runs in this order (`OrganismAdapter.decide`):

1. ECHO observes the fly's own sensory view.
2. The antennae's odor reading, a value the fly senses (no coordinates and
   no map), updates the ON/OFF filters.
3. The reduced-order controller decides. Its navigator asks the valuation
   whether a remembered place is worth a hungry return.
4. If the fly is in protective mode or asleep, perched, and neither escaping
   nor feeding, it rests; ECHO is told its intended action was interrupted.
5. Otherwise olfaction may adjust a walk, only when the command and the body
   are both walking, the fly is hungry, not at an edge, with clearance and no
   imminent contact. It never changes a mode or starts a bout.
6. Fatigue slows walking.
7. ECHO records the final command as the action whose consequences it
   predicts, so its movement predictions include the odor's adjustments.
8. The body's gate validates every command, as before.

So odor reaches hunger (the gate), walking (speed), orientation (the upwind
turn), local search (OFF turns) and ECHO's predictions directly, and
mushroom-body learning through behavior: the Kenyon cells take a place's
landmark cues, not odor, and learn when walking or flying brings the fly to
food or back to a place in vain.

## Verification

### Tests

`src/bethesda/life/organism.test.ts` builds the deployed individual's
lineage on a small city (a legacy birth, ECHO v2, the recorded v3
continuation, then a v3 era lived until the fly remembers a food place by
its landmark and keeps episodes), and checks:

- **No identity change, no memory reset, no unexpected genesis.** Birth,
  genesis, parent, sequence and tick; the city, body, log, controller,
  self-model and every stream equal before and after; the additions innate;
  the inherited places the navigator's own objects; the event's attestation;
  exact restore and continuation.
- **The valuation rule** for inherited and new places.
- **Failed-migration refusal.** Legacy or v2 sources, a corrupt or compacted
  graph, a pause that runs backwards, a failed fly, a repeat, and each
  engine restoring the other's checkpoint.
- **History rules.** Only from the exact v3 parent, once, never as a birth;
  a tampered or missing event; and a newborn with the same seed carrying a
  copied attestation.
- **No duplicated authoritative individual.** Through `LifeStore`: forged
  events and projections, another genesis, a fork, a repeat, a second
  writer refused while the lease is held, and a fenced writer after a later
  one took over; `individual.json` unchanged.
- **Recovery.** A copy at 2% of its reserve recovers by the metered supply
  with nothing reset.
- **The archive** records an evicted episode, and a full one stops the clock
  without dropping or advancing anything.
- **Longer runs**, each checkpoint verified, restored and continued from the
  restored copy; tissue, weights and memories bounded; simulated time equal
  to the ticks computed.
- **The witness** sees the same ECHO fly, and watching changes nothing.
- **The runner:** restarts with each pause recorded; a hard kill, then a
  second writer refused until the dead process's lease expires, then a
  resume of only what was committed; failing closed on an empty or corrupt
  store, with no file written.
- **The continuation script:** `--check` changes no file, `--commit`
  continues once, a second continuation and a source other than `d25e1f3`
  are refused.
- **An interrupted `--commit`.** Killed while writing (a partial file and
  its lease left behind), the store still holds the v3 head; nothing writes
  until the lease is gone, and then the continuation is made once. Killed
  after committing, the continuation stands, is never made again, and the
  runner resumes it once the lease is gone.

### Checks

The repository's checks, run one at a time on this branch (its code at
`cf3ced2`) on Windows 11 on ARM64 with Node 24.19.0 and Bun 1.4.2:

| Check                                                        | Outcome                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run --maxWorkers=2`                              | 173 files and 2,118 tests passed. The 11 skipped are all in `src/rain/scientific/civilization.test.ts`, which needs the Noeterra engine built with Rust                                                       |
| `bun run test:evidence`                                      | Passed: 37 validator rules fire as documented                                                                                                                                                                 |
| `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` | Passed                                                                                                                                                                                                        |
| `bun run build`                                              | Passed: the data and Bethesda validators, manifest and model history, the bundle and the distribution secret scan (219 files clean). The Noeterra engine was not built, so `/noeterra` reports it unavailable |
| `node scripts/run-ts.mjs scripts/fly-source.ts --check`      | The 34-file fingerprint is unchanged: `a96a496c4c00…`                                                                                                                                                         |
| `npm run rain:fly -- --pilot --check`                        | All nine pilots reproduced exactly                                                                                                                                                                            |
| `npm run echo:immortal:evaluate -- --check`                  | **Failed**, as on `main`: recorded on Linux x64; the same source fingerprint, and the last digits of 24 numbers differ ([details](research/echo-replay/README.md#the-two-echo-research-evaluations))          |
| `npm run echo:foraging:evaluate -- --check`                  | **Failed** the same way, as on `main`: 477 numbers                                                                                                                                                            |
| `cargo clippy`, `cargo test` (Noeterra)                      | Not run: no Rust toolchain on this laptop. This branch changes nothing under `noeterra/`; CI runs both                                                                                                        |

### Rehearsal on the deployed individual's backup

The backup is `bethesda-life-20261027T121504Z-3db627bc1254.tar.gz`, the
final one before the v3 continuation, kept off the VM with its verified
SHA-256: 270 checkpoints, head 269 at tick 794,842 (epoch 7, committed
2026-10-27T12:14:59.835Z). Its 278 files were read-only throughout, and they
matched their SHA-256 manifest before and after. Everything below ran in
memory or in throwaway files on Windows on ARM64 (Node 24.19.0): never a
store, a lease or a second writer, and nothing that ran forward is the
fly's life. Its rehearsal script and per-phase reports are in
[`research/echo-organism-continuation/`](research/echo-organism-continuation/).

Because that backup predates v3, the rehearsal first rebuilt the v3 head
the way the deployed release did: head 269 restored on `3db627b`, then
continued by `d25e1f3`'s own `continueEchoSelfModel`. The v3 graph it gives,
`29ef122c0f1fec81f8f313bb53124d87b36024e9249e74db2c3ab17d562c5527`, matches
the digest in the live store's checkpoint 270 header, as a
[read-only copy of the live store](#the-read-only-copy-of-the-live-store)
showed and step 3 of the cutover confirmed on the VM. That v3 fly was then
lived 36,000 ticks in memory to stand in for the v3 era, and the organism
`--check` steps ran on the result.

| #   | Confirmation                                 | Evidence                                                                                                                                                                                                                                                                         | Result                     |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | The original identity is preserved           | Same individual, birth nonce and genesis digest `e42d5e2c…`; parent the exact v3 head; tick unchanged; one `organism-continuation` event                                                                                                                                         | Pass                       |
| 2   | Every checkpoint integrity check passes      | The whole backed-up chain verifies on `3db627b`, and on this release as v3 and as the organism; the transitions 269→270→271→272 and the new checkpoint have no errors                                                                                                            | Pass                       |
| 3   | Learning state survives                      | Eighteen fingerprints equal before and after: places, controller, self-model (24 episodes, 78 inquiries, 12 beliefs), body, log, city, reserve                                                                                                                                   | Pass                       |
| 4   | The controller gives valid commands          | 0 rejected commands in 61,200 ticks; 0 in each test below                                                                                                                                                                                                                        | Pass                       |
| 5   | Physiological maintenance works              | A copy set to 2% of its reserve entered protective mode, received 0.468 J (metered, no food) and left it 117 simulated seconds later; self-model the same object, no replacement, nothing reset                                                                                  | Pass                       |
| 6   | Odor-guided behavior operates                | On hungry copies set down within smelling range of six food patches the filters rose and adjusted hundreds to thousands of walking decisions, inside the body's gates; both they and a v3 control fed at three of the six: no benefit over v3 shown (below)                      | Operates; no benefit shown |
| 7   | No previous state disappears                 | The projection gives the v3 graph's digest `f05a195a…` exactly; every old header and event verifies                                                                                                                                                                              | Pass                       |
| 8   | It survives restart                          | The continuation checkpoint restored and ran identically to the original for 611 ticks (1, 10, 100, 500); a new process restored the last one (277) and, 600 ticks on, reached the same hash as the process that wrote it; the tests restart the runner, kill it hard and resume | Pass                       |
| 9   | Memory and CPU fit the hardware              | See [resources](#resources)                                                                                                                                                                                                                                                      | Pass, with the VM gate     |
| 10  | Future checkpoints keep the upgraded history | Four further checkpoints (after 3,600, 7,200, 14,400 and 36,000 ticks) each verified, chained and restored exactly, the archive's 15 released episodes committed in them                                                                                                         | Pass                       |

**What the real individual held.** At head 269 it remembered one food place
(without landmarks), kept 24 episodes (the bound), had concluded 73
inquiries with none open, and had 87% of a full reserve. In the rehearsal's
v3 era it forgot that place, so the rehearsal's continuation inherited none;
the inherited-place rule is exercised by the tests instead.

**Odor, honestly (confirmation 6).** At the continuation the fly was 108 m
from the nearest of the city's 140 food patches, beyond odor's 30 m reach,
and over the 61,200 rehearsal ticks its odor filters never left rest. That
is correct (nothing privileged brings it closer) but tests nothing. So, as
labeled test interventions on disposable copies, the body's own `settle`
set the fly down on the ground 12 m from a food patch whose odor reached it,
with its reserve set to 30%, at the six nearest patches where that was
possible; each placement was also run on ECHO v3 without the organism, as a
control, for 30 simulated minutes each
([summary](research/echo-organism-continuation/pairs.txt)):

| Set down 12 m from     | Odor there | Walking decisions olfaction adjusted | Organism: first meal, meals, energy fed | v3 control: first meal, meals, energy fed |
| ---------------------- | ---------- | ------------------------------------ | --------------------------------------- | ----------------------------------------- |
| supermarket 3291531680 | 0.091      | 2,888                                | none (food no closer than 11.8 m)       | none (11.5 m)                             |
| restaurant 12345219898 | 0.120      | 535                                  | 110 s, 6, 0.98 J                        | 150 s, 8, 0.75 J                          |
| cafe 5079924587        | 0.091      | 2,867                                | 507 s, 10, 1.01 J                       | 191 s, 6, 0.93 J                          |
| restaurant 12345231205 | 0.091      | 7,706                                | none (11.6 m)                           | none (4.6 m)                              |
| restaurant 12345317745 | 0.103      | 7,653                                | none (11.4 m)                           | none (12.0 m)                             |
| fast food 12345317743  | 0.289      | 2,745                                | 201 s, 10, 1.04 J                       | 175 s, 8, 1.06 J                          |
| All six                |            |                                      | 3 of 6 fed: 26 meals, 3.03 J            | 3 of 6 fed: 22 meals, 2.74 J              |

The organism's ON filter rose to between 0.56 and 0.77 and its OFF filter
to between 0.09 and 0.32, with 0 to 2 search turns a run. Neither copy had a
command rejected, and both made 7 flight contacts in all (only the
controller's own flights make contact, and olfaction never adjusts a
flight). So the odor path operates inside the body's gates, but these runs
show no foraging benefit over v3: both copies fed at the same three
placements. Walking modulation acts at centimeters per second (the body's
fastest walk is 4 cm/s), the meals came with the controller's own flights
and landings, which v3 already draws toward food odor, and six placements
are too few to measure a small difference. The research study's approach
result (95.5% closer, 8 of 8 pairs) came from 60-second walking assays with
flight disabled, in a synthetic odor field, and does not carry over. At the
first patch with the reserve as found (77%), 15 minutes gave the same: the
filters rose, 4,452 walking decisions were adjusted, and neither copy came
closer or ate. On the small test city, where food is near, the organism ate
58 meals and its mushroom body made 15 updates in the long run below.

### Pre-migration rollback

On a synthetic store with the deployed lineage (a digital-fly/7 birth,
ECHO v2, the v3 continuation and a v3 era, on the small test city), with
the real `d25e1f3` runner
([`rollback.sh`](research/echo-organism-continuation/rollback.sh), its
[output](research/echo-organism-continuation/rollback.txt)):

1. This release's runner resumed the v3 store and committed to it: the
   release upgrade alone, with no continuation.
2. The `d25e1f3` runner then resumed what this release had committed (a
   rollback of the release), and this release resumed after it again.
3. `--check` changed no file in the store (the SHA-256 of every file the
   same before and after).
4. After `--check`, `d25e1f3` still resumed the store.
5. `--commit` continued the fly as the organism.
6. After the commit, `d25e1f3` refused the store and changed no file. Its
   message is "checkpoint 8 is corrupt: made with organism, which this
   engine does not have; …": the old engine calls any checkpoint made with
   components it lacks corrupt.
7. This release lived on as the organism, and `--verify` passed all 10
   checkpoints.
8. A second continuation was refused: "this individual already continued
   as the organism; nothing was changed".

`install.sh --rollback` itself needs systemd and runs only on the VM; what
was rehearsed here is the store-level half: which release resumes which
checkpoints.

### Replay of the five ECHO pilots

Resolved in [cross-platform replay of the fly pilots](research/echo-replay/README.md).
The archive reproduces exactly on the platform that recorded it (Windows on
ARM64, Node 24.19.0). On Linux x64 the only difference reaching the ECHO
pilots is `Math.pow` with a fractional exponent in the self-model; on Linux
arm64, the VM's platform, all nine pilots differ. No record, threshold or
parameter changed. For this continuation it means: every check that gates a
commit to the deployed store must run on the VM itself, and this laptop's
forward runs are a different continuation, never the fly's.

The research evaluations of the immortal organism and of olfactory
navigation were recorded on Linux x64, and their `--check` fails on this
laptop the same way, on `main` as on this branch: the same source, rounded
differently in the last digits, with every count, status and conclusion
unchanged ([details](research/echo-replay/README.md#the-two-echo-research-evaluations)).
Their records were not regenerated.

### Long-term continuity

| Requirement                     | Finding                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No programmed lifespan          | None in the fly, city, life, physiology or organism code: no age limit, death state or retirement. The city's decision record stops recording at 60,000 decisions (at about 40.7 simulated hours, [measured](BETHESDA_CONTINUOUS_LIFE.md#what-the-machine-needs)) and the life goes on. An empty reserve on v3 stops voluntary takeoff, not life |
| Simulated time stays exact      | The fly's clock is rounded to the microsecond each step (exact for about 285 years); the tick is an integer; physiology uses only step lengths. In the long run the clock equalled the ticks computed                                                                                                                                            |
| Energy depletion is recoverable | Protective mode and the metered supply: on the real state from 2% of the reserve, and on the small city five times in 36.4 simulated hours, each bout ending on its own (1.95 J supplied, the reserve never below 8%)                                                                                                                            |
| Neural adaptation persists      | Mushroom-body weights, trials and the last trial are graph state, restored exactly at every checkpoint                                                                                                                                                                                                                                           |
| Olfactory state persists        | The filters, adaptation and the stream's position are graph state, restored exactly                                                                                                                                                                                                                                                              |
| Memory is durable               | Episodes the bounded memory releases are archived and committed; a full archive stops the clock rather than drop a record                                                                                                                                                                                                                        |
| Restoration is safe             | Every restore is re-snapshotted and compared byte for byte; any mismatch stops                                                                                                                                                                                                                                                                   |
| Active memory is bounded        | 24 episodes, 12 places, 2,000 Kenyon cells, at most 4,096 archive records pending. A checkpoint grows with the city's decision record, about 1.2 KB a decision, until it is full at 83.8 MB; the backup's head held 43,097 decisions in 62.9 MB. The organism adds 88 KB                                                                         |
| Historical records stay valid   | The whole real chain, from the digital-fly/7 birth through ECHO v2, verifies under the organism's history rules                                                                                                                                                                                                                                  |

**Increasingly long lives, at their real length.** The longest computed
runs here are 97,200 ticks (2.7 simulated hours) of the real individual's
state in the rehearsal, and 1,311,000 ticks (36.4 simulated hours) of an
organism on the small test city, checkpointed after 1,000, 10,000, 100,000
and 1,200,000 ticks, each checkpoint verified, chained and restored exactly
and the next run continued from the restored copy
([report](research/echo-organism-continuation/report-long.json)). In those
36.4 hours the fly ate 58 meals (6.58 J) and spent 8.28 J; its mushroom
body made 15 associative updates; protective mode came five times and
ended five times; 217 episodes its memory let go were archived; no command
was rejected and the fly never failed. Tissue stayed in bounds (ATP
availability at least 0.31, hydration at least 0.41, fatigue at most 0.50,
stress at most 0.59), and its clock read 131,100 s, exactly the ticks
computed. Nothing longer was computed, and no short run at a large clock
offset is presented as a long life.

**What still limits a long life.** A store is verified whole on every open:
at 288 checkpoints a simulated day (one every 3,000 ticks), the headers grow
by about 105,000 a year, so restart time grows with age; a verified index of
old headers is future work. Disk, the VM, its region and funding are finite.
A software exception in the fly's own step stops the fly where it is
(`cityFly.failed`, recorded in its checkpoints) while the city runs on; it
is a defect to repair by an explicit, reviewed continuation, not an end of
life, and it is never replaced by a new fly.

### Resources

Peak resident memory on this laptop (Windows on ARM64, Node 24.19.0; the VM
runs Linux arm64 with Node 24.22.1, so these are estimates for it):

| Step                                                                        | Peak resident | Time                  |
| --------------------------------------------------------------------------- | ------------- | --------------------- |
| Verifying the whole 270-checkpoint chain (three times, three engines)       | 2.46 GB       | 38 s                  |
| The `--check` steps: same-engine check, continuation, exact restore         | 2.91 GB       | 62 s                  |
| Living on with a checkpoint and restore after each run (as the runner does) | 3.21 GB       | 61,200 ticks in 159 s |
| A new process restoring and continuing                                      | 2.15 GB       | 14 s                  |

`--commit` ran only on synthetic stores (the tests and the rollback
rehearsal), never on a copy of the deployed individual, which would make a
second continuation of it. It costs the `--check`, one checkpoint written
through the store, and the chain verified again.

These peaks were measured with 64 to 66 MB checkpoints. The deployed
checkpoints keep growing until the city's record is full, at 83.8 MB and
about 40.7 simulated hours of age (the backup's head was 22.1 hours old),
and memory grows with them; that growth is the city's and predates this
change, and the service's heap was sized for the full-grown checkpoint
([measured](BETHESDA_CONTINUOUS_LIFE.md#what-the-machine-needs)). On the
VM, the `--check` in step 3 of the cutover peaked at 3.36 GB
(3,439,536 kB) in 147 s, with checkpoint 417 as the head
([as it ran](#the-cutover-as-it-ran)).

Against the live store's 76 MB head (checkpoint 409,
[below](#the-read-only-copy-of-the-live-store)), the `--check` peaked at 3.06 GB
in 77 s here, and `d25e1f3`'s own `--check` at 1.80 GB in 21 s. On the VM
at 23:51 UTC on October 27, 6,316 MB was available beside the service,
which held 1.0 GB between checkpoints.

A tick of the real city costs 1.58 ms for the v3 fly and 1.53–1.63 ms for
the organism: no measurable overhead, and about 1.6% of one core at the
runner's real-time pace of 10 ticks a second. The continuation itself takes
33 s, the whole `--check` about a minute. The checkpoint grows by 88 KB. The
service's 2,560 MB heap and the documented 4,096 MB heap for `--check` are
unchanged. On the VM, `--check` beside the running service needs about
3 GB more than the service's own 3.2 GB; the cutover plan runs the final
check with the service stopped.

## Cutover plan

It ran on October 28, 2026, as [recorded below](#the-cutover-as-it-ran).
This is the procedure the two earlier continuations used, with this
script. **Each step that changes the VM needs the owner's explicit approval,
given for this cutover; this document is not that approval.**

**Maintenance window:** one pause, from the service's stop to its start on
the new release, budgeted at 15 minutes (estimated from the timings above;
not yet measured on the VM, whose single core may be slower). Nothing is
computed during it; the runner records it as one gap, from the v3 fly's
last commit, and no experience is attributed to it.

**Before the window (the fly keeps living):**

1. Merge this branch after review. On the VM, update the checkout and run
   `sudo deploy/bethesda-life/install.sh --prepare`: it builds the release
   beside the running one and stops nothing. Record its commit.
2. Take a backup with `sudo deploy/bethesda-life/backup.sh`, copy it off the
   VM and check its SHA-256 there.
3. Unpack it in a scratch directory on the VM and, as `bethesda-life` in the
   prepared release, run the continuation's `--check` against that copy with
   `--from-release /opt/bethesda-life/releases/d25e1f3…` and a 4,096 MB heap.
   It peaked at 2.9 GB resident here with a 64 MB checkpoint and needs more
   as the checkpoint grows: run it beside the service only if `free -m`
   shows well over that available, and otherwise in the window, after step 5. Expect: the same individual, the head's tick, `preservedGraphDigest`
   equal to `sourceGraphDigest`, and the same-engine and restore checks
   passing. Also confirm that checkpoint 270's header has graph digest
   `29ef122c0f1fec81f8f313bb53124d87b36024e9249e74db2c3ab17d562c5527` and
   parent `54f369efaed0183a69344700677afa179fce5f217efee33348afd28a77720ac1`,
   as the rehearsal rebuilt it; any difference stops the cutover. Delete the
   scratch copy afterwards. It is never started and never committed to.

**Approval.** The owner reads step 3's output and approves the window, or
not. Nothing below happens without that.

**In the window:**

4. `sudo systemctl stop bethesda-life`. Wait for the final checkpoint and
   the lease release; confirm the process is gone. Record the stop time.
5. `sudo deploy/bethesda-life/backup.sh` again: the final pre-continuation
   backup. Copy it off the VM, check its SHA-256, and keep it with the
   `d25e1f3` release.
6. The same command as step 3 against the live store, with `--commit`: it
   repeats every `--check` step, takes the lease only after all of them
   pass, refuses if the head changed, and publishes one checkpoint through
   `LifeStore`. Keep its output.
7. Right after it, `sudo deploy/bethesda-life/install.sh` (an ordinary
   upgrade): it checks that the prepared release resumes the store, switches
   to it, keeps `d25e1f3` and `3db627b` for replay, and starts the service.
   If that check fails it switches nothing and leaves the service stopped
   (see the limits below).

**After the window:**

8. Verify: the service is active with no restarts; `--verify` passes; the
   witness shows the same individual, a tick that keeps rising from the
   continuation's, `echo-self-model/v3`, and a live status; the runner's
   status shows the organism's physiology, mushroom body and olfaction; the
   next checkpoints commit with their archive; no command rejections.
9. Take a fresh backup on the new release and check that it passes
   `--check`. Only then may anyone say the live fly continues as the
   organism.

**Abort at any point before step 6 commits:** start the service again
(`sudo systemctl start bethesda-life`); it is still `d25e1f3`, and nothing
has changed (`--prepare` switches nothing). The store-level half of this,
`d25e1f3` resuming what this release may have touched, is rehearsed
above.

## Rollback limits after the commit

Once the organism checkpoint is committed, `d25e1f3` refuses the store and
fails closed (rehearsed above), and no engine converts it back. Until step 7
switches releases, a start of the old service (by hand, or by systemd after
a reboot) fails the same way and writes nothing; so steps 6 and 7 run back
to back. If the new
release fails before any organism tick is committed, the store's head is
the continuation itself, at the v3 head's tick, with no lived experience
after it: restoring the step-5 backup then loses no experience, but it does
discard a committed checkpoint, so it needs its own approval, the failed
store kept aside unrun, and the discarded continuation recorded. After the
organism has lived and committed, restoring an older backup would discard
that life and make a fork: it is never reported as uninterrupted
continuity. Prefer a new, explicit repair continuation that keeps the
history; if a backup restore is unavoidable, stop every other writer, keep
the failed store, record the lost interval and its parentage, and get
approval for that specific recovery.

## The read-only copy of the live store

Before the cutover, a read-only copy of the live store was examined on this
laptop ([output](research/echo-organism-continuation/live-copy.txt)). It was
streamed from the VM at 23:55 UTC on October 27 as a `tar` to standard
output, so nothing was written there, and is kept off the VM as
`bethesda-life-20261027T235529Z-d25e1f3b9e40-streamed.tar.gz`, with the
same SHA-256 on both ends: 410 checkpoints, head 409 at tick 1,211,849.

- Checkpoint 270, the v3 continuation the VM committed, has graph digest
  `29ef122c…` and parent `54f369ef…`, exactly as the rehearsal rebuilt it.
- Checkpoints 0–265 are byte for byte the rehearsal backup's. Checkpoints
  266–269 differ only in the graphs that the store's compaction has since
  replaced with `null`; every other field is identical.
- `d25e1f3`'s own `--check` verified the whole chain and restored the head.
- The continuation's `--check` passed on head 409: the same individual and
  tick, `preservedGraphDigest` equal to `sourceGraphDigest` (`edc45dc1…`),
  and the 600-tick same-engine and 611-tick restore checks.
- The copy was unchanged afterwards, and was then deleted.

That ran on Windows on ARM64, not on the VM's platform, and the live fly
lived on after it, so steps 2 and 3 of the cutover then ran on the VM
against a fresh backup ([as they ran](#the-cutover-as-it-ran)).

## The cutover, as it ran

It ran on October 28, 2026 (times UTC), each step that changed the VM with
the owner's approval. Step 9 passed, so the live fly continues as the
organism. The outputs are in
[`cutover.txt`](research/echo-organism-continuation/cutover.txt), with the
scripts that produced them
([what each is](research/echo-organism-continuation/README.md#the-cutover)).

| Step                         | When              | Result                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Prepare                   | built 00:38:51    | Release `62bd12502c17379b92e89c74d17b3e1240ddd243`, beside `d25e1f3`, which kept running                                                                                                                                                                                                                                             |
| 2. Backup                    | 00:39:11–00:40:15 | Checkpoint 417 at tick 1,235,849, resumed by `d25e1f3`; SHA-256 `5dc04b6b…` checked off the VM                                                                                                                                                                                                                                       |
| 3. Check                     | about 00:41–00:43 | On a copy of that backup, read-only to the service's user, beside the service: checkpoint 270's header as the rehearsal rebuilt it, and `--check` passed in 147 s (the same individual and tick, `preservedGraphDigest` equal to `sourceGraphDigest`, the 600- and 611-tick checks). The copy was unchanged, the service undisturbed |
| 4. Stop                      | 00:47:52–00:48:26 | A clean stop: the v3 runner committed checkpoint 420 at tick 1,244,222 at 00:48:21.398 and released its lease (epoch 9)                                                                                                                                                                                                              |
| 5. Final backup              | 00:48:49–00:49:30 | Checkpoint 420; SHA-256 `f912cbaa…` checked off the VM                                                                                                                                                                                                                                                                               |
| 6. Commit                    | 01:02:32–01:05:49 | Checkpoint 421 at tick 1,244,222, parent 420, with `preservedGraphDigest` equal to `sourceGraphDigest` (`796f5ec2…`): 142 inquiries, 24 episodes and no remembered place kept, and one `organism-continuation` event. Its lease (epoch 10) was held for 23 s                                                                         |
| 7. Switch and start          | 01:05:49–01:07:52 | `install.sh` restored 421 on `62bd125`, switched to it (`d25e1f3` previous, `3db627b` kept for replay) and started the service at 01:07:01; the runner took the lease (epoch 11) at 01:07:35 and resumed at 01:07:52                                                                                                                 |
| 8. Verify                    | 01:09–01:16       | Active with no restarts; `--verify` passed on all 422 checkpoints; the witness live, with the same individual, `echo-self-model/v3` and a rising tick; the status shows physiology, mushroom body and olfaction; checkpoint 422 committed at 01:13:23, linked to 421, with its archive; no command rejected                          |
| 9. Backup on the new release | 01:15:02–01:16:06 | Checkpoint 422 at tick 1,247,222, resumed by `62bd125`; SHA-256 `61b214e7…` checked off the VM                                                                                                                                                                                                                                       |

**The pause** ran from the v3 runner's final commit, at 00:48:21.398, to
the organism's resumption, at 01:07:52.078: 19 minutes 31 seconds, over the
15 budgeted. The steps took about 6½ minutes of it. For almost 13, between
steps 5 and 6, the stopped service waited while the commit command was
approved a second time, in the tooling that ran it. Checkpoint 422 records
the pause as one `gap` (`"policy":"paused"`) at the continuation's tick,
1,244,222: the clock did not advance, nothing was computed, and no
experience is attributed to it.

**Where it departed from the plan.**

- Step 1 built the branch's head, `62bd125`, before the merge, with the
  owner's approval. `main` took the branch at 01:18 as the merge commit
  `3e8cbe0`, whose tree is identical: the release is named by the branch's
  commit, and its code is `main`'s.
- The VM's checkout is shallow and was detached, so `git pull --ff-only`
  could not update it; the commit was fetched instead.
  [The upgrade instructions](BETHESDA_CONTINUOUS_LIFE.md#upgrade) now fetch
  that way.
- Step 3 ran beside the service, as the plan allows when memory is well
  over the check's need: 4,785 MB was available, against the 4,270 MB its
  gate asked for (the check's estimated peak, the service's growth back to
  its high-water mark, and 512 MB). Under a 4,608 MB cap, at the lowest
  priority and as the kernel's first out-of-memory victim, it peaked at
  3.36 GB (3,439,536 kB), about 60 MB over its estimate and inside that
  margin. The service ran on as the same process, with no restarts.

**What the organism did first.** The v3 fly had used up its reserve: its
last v3 status, at the stop, reads `"energyFraction":0`, resting. On the
organism's first tick protective mode began, at 0.03% of a full reserve.
The deliberately artificial supply brought the reserve to 35% by tick
1,245,465, 124.2 simulated seconds later, metered as 0.497 J of
`maintenanceJ`; the fly's food intake is unchanged (64 meals, `fedJ`
6.81 J). Then the fly flew again: 25 takeoffs and landings by checkpoint
424, with no collision and no command rejected. By 01:26 olfaction had
adjusted 5,114 walking decisions and made one search turn, and its filters
were back at rest; the mushroom body had made no trial (the fly had not
eaten, and remembered no place to return to). The self-model's bounded
memory let episode 142 go, and checkpoint 422 holds it in the archive. Its
143rd inquiry concluded `sensor`, and its trust in its senses fell from 1
to 0.96; 4 of its 142 earlier inquiries had concluded `sensor` too. The fly
carries no perturbation schedule, so none of these is a fault the simulator
applied.

**Kept.** The three backups are kept off the VM, each checked against its
SHA-256 there: `bethesda-life-20261028T003911Z-d25e1f3b9e40.tar.gz`
(step 2), `bethesda-life-20261028T004849Z-d25e1f3b9e40.tar.gz` (step 5, the
last before the continuation) and
`bethesda-life-20261028T011502Z-62bd12502c17.tar.gz` (step 9). The VM keeps
the `d25e1f3` and `3db627b` releases for replay beside `62bd125`.

**What it shows.** One fly and one history: the same birth, genesis and
chain (`--verify` passed all 422 checkpoints, and each later checkpoint
names the one before it as its parent), one writer at a time (the leases of
epochs 9, 10 and 11 never overlapped), and the whole v3 graph kept byte for
byte, with the four parts beside it. It shows no foraging benefit (see
[the rehearsal](#rehearsal-on-the-deployed-individuals-backup)), and none of
it is evidence of awareness or of a complete nervous system.
