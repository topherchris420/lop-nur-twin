# First contact: Eva and ECHO

> Do not replace the minds that have learned to exist. Expand what they can
> perceive, understand, remember, and become.

This is the research framework for an eventual encounter between the two
persistent digital flies, Eva (the live garden's fly) and ECHO (the Bethesda
headless life), together with two pieces it needs: a neural augmentation layer
that sits beside a fly's controller, and a FlyWire Codex reference layer for
the connectome backend. Read [the system audit](EVA_ECHO_AUDIT.md) first: it
maps what already existed, and what did not.

**Nothing here touched either original.** No service was deployed, restarted,
migrated or modified; no database, store, checkpoint, backup, ledger line,
controller, memory or identity was read for writing or changed. The only
contact with either production system was public read-only observation (HTTP
GET), at the rate each one's own viewer uses. Every experiment ran on
**research subjects**: new flies built from seeds, in worlds of their own,
none of them Eva, ECHO, a copy of either, or a continuation of either.

| Stage                                                                                       | Status                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [1. Passive observation](#stage-1-passive-observation)                                      | **Working** on both live public streams, read-only. The representation each would receive of the other is computed and recorded, delivered to neither                                               |
| [2. Controlled encounters](#stage-2-controlled-encounters-between-research-subjects)        | **Working** between research subjects in separate worlds with different clocks. Each perceives and responds to the other (E1, E2 supported); contingency adds nothing measurable (E3 not supported) |
| [3. Experience-dependent recognition](#stage-3-repeated-encounters-and-recognition)         | **Run, held-out seeds: no hypothesis supported.** No partner-specific response (recognition) in any of three controller arms; no change outlasting 300 s                                            |
| [4. Production integration proposal](#stage-4-a-proposal-for-the-originals-not-implemented) | **Proposal only.** Nothing implemented; each step listed needs separate authorization                                                                                                               |

## Why the originals cannot simply be connected

- **Eva's simulation is not in this repository.** It is a Python service
  (`server.py`, `learning.py`) on the garden's VM. Its controller, learning
  code and database cannot be inspected, tested, backed up or extended from
  here; this repository holds only her viewer and the contract of
  `GET /api/state`. Any interaction for Eva needs her service's code and its
  keeper's authorization.
- **They live in different kinds of world.** Eva's garden is an abstract 2D
  plane in fractions of its extent with seven places and no metric scale or
  heights; ECHO's city is metres in three dimensions. Placing one in the
  other's world is always a declared mapping, never a fact.
- **Their clocks differ.** Eva's state is stamped in unix seconds, stepping in
  whole five-second ticks from her birth. ECHO's is its own simulated
  seconds (`tick × 0.1`), which wait while a checkpoint is made and skip
  outages as recorded gaps. On 2026-10-31 Eva's clock read 539,670 s since
  her birth and ECHO's 422,825.4 simulated seconds.
- **Their controllers differ** (the garden's learning loop; ECHO's organism
  adapter), and that is as it should be: they are two individuals.

## Engineering requirements, and how each is held

| Requirement                                                                                | How it is held                                                                                                                                                                                                                | Checked by                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Two original individuals, never copies                                                     | `refuseOriginal` refuses either original's id, its printed prefix and anything containing it, for every subject, bridge endpoint, authorization and augmented adapter; the ids are copied from files that already record them | `bridge.test.ts`, `joint.test.ts`                    |
| Controllers and histories intact                                                           | nothing in production imports `firstContact/` or `augmentation/`; the fly's experiment digest does not reach them; no fly simulation module changed                                                                           | `isolation.test.ts`, `validate-bethesda`             |
| Additive and reversible                                                                    | a bridged world that has delivered nothing steps byte for byte as the bare world; an augmented controller in observe or advise steps byte for byte as the bare controller, for all three controller kinds                     | `bridge.test.ts`, `augmentation.test.ts`             |
| No hidden simulator state                                                                  | only `ForeignPercept` (a body's centre and radius) crosses the bridge, seen through the receiver's own eyes; advisors read only `AdvisorView` (sensable fields, no position, heading, world or looming identity)              | both test files                                      |
| Clock synchronization before meaning                                                       | `EncounterClock` puts both subjects on one timeline from their own ages at contact and verifies each step; the bridge delivers only while they are in step and closes otherwise                                               | `bridge.test.ts`; 180 of 180 sessions stayed in step |
| No extrapolation, no blending                                                              | the percept channel and the joint observer interpolate only between received samples, hold or refuse beyond the newest, never cross a jump, an epoch change or another `life_id`                                              | `bridge.test.ts`, `joint.test.ts`                    |
| Backups, compatibility testing and explicit authorization before any bridge to an original | none was attempted; Stage 1 is the compatibility test on real data; [Stage 4](#stage-4-a-proposal-for-the-originals-not-implemented) lists what must precede it                                                               | this document                                        |

## Stage 1: passive observation

`src/bethesda/firstContact/joint.ts` and `scripts/first-contact-observe.ts`.

```sh
node scripts/run-ts.mjs scripts/first-contact-observe.ts --seconds 120   # writes .first-contact/observe/ (gitignored)
```

The script sends `GET /api/state` to Eva's garden once per five-second step
(her page's rate) and `GET /v1/now` to ECHO's observer once a second (its
stream's rate). It sends nothing else. Each response is parsed by that
individual's own contract (`src/garden/core/observation.ts`,
`src/bethesda/life/observation.ts`), identity-pinned, and kept with its
receipt time and SHA-256. A joint view at any UTC instant labels each
individual **observed**, **interpolated** (positions only, for presentation;
discrete facts belong to the earlier state), **held** (newest state, not yet
stale) or **unavailable**, and records that their positions are in different
worlds.

A browser page showing both cannot be built without changing production:
Eva's endpoint serves its own origin only (no CORS), so another origin cannot
read it. That change is in Stage 4.

**Result, 2026-10-31, 11:59:17 UTC, 120 s:** 24 Eva states and 119 ECHO
observations, every one consistent with its own clock contract
(`updated_at = born_at + 5 × ticks`; `simulatedSeconds = 0.1 × tick`). Both
clocks ran at about 1.00 own second per UTC second (Eva 1.0036, ECHO 0.9986)
with no gap. Joint view, per second: Eva 114 interpolated and 7 held; ECHO 119
interpolated and 2 held; never extrapolated; no refusal. A slice of this
recording (4 Eva states, 15 ECHO witnesses, bodies unmodified and hashed) is
the test fixture `src/bethesda/firstContact/fixtures/joint-2026-10-31.json`.

**Representations, computed and not delivered.** Each fly's representation
of the other's movement is the other's horizontal displacement since a common
anchor instant, scaled into the receiver's frame: ECHO's metres laid on Eva's
garden plane without rotation (a model choice), and Eva's fractions × 3.807 m
per fraction for ECHO. That scale is the clay page's staging of Eva's seven
places (least-squares similarity, rms residual 0.633 m): a renderer
interpretation, since her simulation has no metric scale. It is pinned in
`GARDEN_SCALE` and re-derived by a test. Eva slept at the windowsill
throughout the recording; ECHO moved 7.6 m.

## Stage 2: controlled encounters between research subjects

`session.ts`, `bridge.ts`, `encounterStudy.ts`; protocol
`protocols/encounter-v1.json`; results in
[docs/benchmarks/first-contact/](benchmarks/first-contact/README.md).

Two research subjects each live in an arena of their own (two worlds built
from one specification, so the declared frame map between them is the
identity: they coincide in space and share nothing else). Subject A (the
organism controller, the kind ECHO runs) lives 120 s alone, subject B (the
ECHO v3 controller) 45 s, so their own clocks differ by 75 s at contact; the
encounter clock then steps both on one timeline. Every 10 ms the bridge
carries each one's body to the other's eyes, 10 ms late (one exchange). A
receiver sees the other only as a fly-sized sphere (FlyBody's measured body
length as its diameter) that its own eyes must resolve, with its own acuity,
field of view, occlusion and latency; it can be neither touched nor smelt.
Nothing about either fly's state, identity or controller crosses.

Conditions, between subjects, 60 each, 120 s of contact: **live** (A and B
bridged both ways), **yoked** (a new subject C shown B's recorded body from
live pair i, exactly as A saw it, but unable to change it), **solitary** (a
new subject D, bridge never opened).

Ran from clean commit `2ab1b97`. **All 180 sessions stayed synchronized; no
bridge closed early.**

| Condition               | Escaped at least once (95% Wilson CI) | Mean escapes | Decisions that saw the other | Escapes while it was within 3 cm |
| ----------------------- | ------------------------------------- | ------------ | ---------------------------- | -------------------------------- |
| live A                  | 0.433 [0.316, 0.559]                  | 0.63         | 169.4                        | 0.63 (all of them)               |
| live B (A's partner)    | 0.450 [0.331, 0.575]                  | 0.53         | 184.0                        | 0.53 (all of them)               |
| yoked C (B's recording) | 0.417 [0.301, 0.543]                  | 0.52         | 150.8                        | 0.52                             |
| solitary D              | 0.000 [0.000, 0.060]                  | 0.00         | 0                            | 0                                |

- **E1, A responds to B: supported** (live A − solitary D, 0.433 [0.301, 0.559]).
- **E2, B responds to A: supported** (0.450 [0.317, 0.575]).
- **E3, contingency matters: not supported** (live A − yoked C, 0.017
  [−0.156, 0.188]). Watching a recording of a fly evoked the same escapes as
  meeting it live.

What this shows: through a bridge that passes only what an eye could see,
each fly perceived the other and every evoked escape began with the other
within 3 cm. What it does not show: any social behaviour. The response is the
existing looming escape; a ball of the same size on the same path would do
the same.

## Stage 3: repeated encounters and recognition

`recognition.ts`, `playback.ts`; protocol `protocols/recognition-v1.json`
(SHA-256 in every result); results in
[docs/benchmarks/first-contact/](benchmarks/first-contact/README.md).

A habituation–dishabituation **playback** design. Eight partner research
flies flew alone in a large arena for 300 s each; stretches of steady flight
(1 s, pass speed 0.2–0.6 m/s) were cut from their recordings by fixed
criteria (a partner with fewer stretches than a series needs is not used:
partner 4 in development, with 3, and partner 3 in held-out, with 5). A presentation places a stretch so that the partner's own
path passes a perched subject 5 mm from its body, from a seeded direction:
the placement is the experimenter's, the motion is the partner's, and the
partner never sees the subject. Each subject belongs to one group:

- **naive**: one presentation, the first encounter;
- **familiar**: six presentations of partner F, 8 s apart, then a test
  presentation of a new stretch of F;
- **stranger**: the same six of F, then a test of another partner S (the
  control encounter);
- **familiar-late**: the six of F, then a test of F 300 s later (meeting
  again).

Outcome: an escape during the test. Three controller arms (reduced-order,
ECHO, organism). Development: 24 subjects per group per arm; held-out: 80.
Criteria (fixed before any run): H1 habituation, familiar − naive interval
wholly below 0; H2 partner specificity (recognition), stranger − familiar
wholly above 0, with the manipulation check (the partner seen in at least 80%
of tests) and stretch balance (pass speeds within 0.05 m/s) passing; H3
persistence, familiar-late − naive wholly below 0.

**Held-out result** (80 per group per arm). The manipulation and balance
checks passed in every arm.

| Arm           | naive P(escape)      | familiar             | stranger             | familiar-late        | H1 familiar − naive    | H2 stranger − familiar | H3 late − naive        |
| ------------- | -------------------- | -------------------- | -------------------- | -------------------- | ---------------------- | ---------------------- | ---------------------- |
| reduced-order | 0.600 [0.491, 0.700] | 0.450 [0.346, 0.559] | 0.570 [0.460, 0.673] | 0.650 [0.541, 0.746] | −0.150 [−0.295, 0.004] | 0.120 [−0.035, 0.267]  | 0.050 [−0.098, 0.195]  |
| echo          | 0.575 [0.466, 0.677] | 0.532 [0.423, 0.638] | 0.450 [0.346, 0.559] | 0.638 [0.528, 0.734] | −0.043 [−0.193, 0.109] | −0.082 [−0.230, 0.072] | 0.063 [−0.087, 0.209]  |
| organism      | 0.613 [0.503, 0.712] | 0.481 [0.374, 0.590] | 0.525 [0.417, 0.631] | 0.550 [0.441, 0.654] | −0.132 [−0.277, 0.023] | 0.044 [−0.109, 0.194]  | −0.063 [−0.210, 0.089] |

**No hypothesis is supported in any arm.**

- **H1 (habituation): not supported.** The estimates point the predicted way
  in the reduced-order and organism arms, and within the series the escape
  share falls from 152/240 at the first presentation to 112/240 at the sixth
  (reduced-order; descriptive, not a registered test), but no interval lies
  wholly below 0.
- **H2 (recognition): not supported, and no consistent sign.** The fly's own
  escape readiness at the test was the same after the familiar and the
  stranger series (`responsiveness` 0.749 vs 0.754, reduced-order), as it must
  be in this model: habituation is one shared scalar and the sensory model
  carries no identity. Nothing here is a partner-specific response.
- **H3 (persistence): not supported.** After 300 s `responsiveness` had fully
  recovered (1.000) in every arm.
- ECHO's self-model stored 0.575 more episodes per subject in the
  familiar-late group (echo arm); that group also lived 300 s longer, so this
  is not attributable to the encounters.

The development phase (24 per group) also supported nothing; its numbers are
in the results folder.

**What would have to change for recognition to be possible at all**, as
hypotheses for later protocols rather than claims: a sensory channel that can
distinguish individuals (the bridge passes none, deliberately), and a
stimulus-specific memory (escape habituation here is a single scalar). Adding
either is a change to the fly, which bumps `FLY_VERSION` and its pilots, and
would be studied first in research subjects.

## Phase 2: the neural augmentation layer

`src/bethesda/augmentation/` (`layer.ts`, `advisors.ts`, `evaluate.ts`);
protocol `protocols/giant-fiber-v1.json`; results in
[docs/benchmarks/fly-augmentation/](benchmarks/fly-augmentation/README.md).

`AugmentedAdapter` wraps any existing controller and consults an advisor
beside it. The controller decides first and stays authoritative.

| Mode                | What the advisor may do                                                                                                                           | Guard                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| observe (default)   | predict; scored against what the controller did                                                                                                   | the fly's state hash steps exactly as without the layer (tested for all three controller kinds)                                 |
| advise              | also record bounded, timestamped recommendations: commands that passed the body's gate when made, lapsing after one decision period; none applied | a held-out validation clearing `ADVICE_CRITERIA` (hit rate ≥ 0.8, false-alarm rate ≤ 0.05, ≥ 20 events); state hash unchanged   |
| experimental-hybrid | initiate only the modes an authorization lists (for instance an escape), through the body's own gate                                              | the advice gate, plus a `HybridAuthorization` naming a disposable `research-` subject; never a default; refuses either original |

Fallback: an advisor that throws or returns something malformed is recorded
and ignored, and switched off after five consecutive failures; a gate refusal
(an escape proposed in flight) is counted, not treated as a malfunction; a
wall-clock budget can switch the advisor off, and in hybrid mode that marks
the run not reproducible.

The first advisor, `giant-fiber-advisor/v1`, runs the circuit-informed
controller's giant-fiber model (Ache et al. 2019's fitted potential and the
GF-independent wing raise) on the sensable view only. Its observe-mode study
(clean commit `bef5996`) measured agreement with each controller's escape
onsets within 100 ms, on looms from seeded directions, sizes and speeds:

| Controller    | Held-out hits / onsets | Hit rate | False alarms | May advise                      |
| ------------- | ---------------------- | -------- | ------------ | ------------------------------- |
| reduced-order | 29 / 40                | 0.725    | 6            | no (hit rate below 0.8)         |
| echo          | 37 / 47                | 0.787    | 12           | no (hit rate below 0.8)         |
| organism      | 36 / 41                | 0.878    | 11           | yes, by the criteria as written |

Two limits of that verdict: the advisor **agrees with** the controllers'
timing but does not anticipate them (on development seeds its onsets came
10–70 ms after the controller's), so as a hybrid it could not escape earlier;
and the false-alarm criterion is per 10 ms opportunity, which is lenient (11
false alarms against 41 onsets clear it). A stricter, event-level criterion
would be a new protocol. No advisor is enabled anywhere outside these tests
and studies.

**Disclosure: a measurement bug found from held-out numbers.** The first run
of this study recorded an advisor's predicted escapes only while the fly was
not already escaping, so a prediction later than the controller's onset could
never be matched. That run (stamped "a working tree", so never a result)
reported held-out hit rates of 0.025, 0.021 and 0.000. The cause was confirmed
on development seeds (13 of 15 onsets had an advisor prediction 10–70 ms
later), fixed in `bef5996` with a regression test, and both phases were run
again from that clean commit. The protocol did not change.

## Phase 1: FlyWire Codex as a reference layer

`fly-neural/fly_neural/codex.py`; see the
[fly-neural README](../fly-neural/README.md#flywire-codex-a-reference-layer).
FAFB v783 (139,255 neurons; this repository's validated import: 54,492,922
synapses) and BANC v888 (158,262 neurons per Codex, read 2026-10-31; brain
and nerve cord of another animal) are separate datasets, never combined.
Codex requires a person to sign in and accept its terms before downloading
data, so nothing downloads from it here: a person downloads the tables and
`codex pin` records their hashes, the quoted terms and the citation. BANC is
**not pinned**: no file, hash, licence or citation for v888 is recorded in
this repository. Inspection (classes, transmitters, regions,
sensory-to-motor paths, motifs, comparison, Codex links, reports) is tested on
synthetic tables; no Codex table was loaded in this work.

## Whole-brain research subjects (a demonstration)

`scripts/first-contact-whole-brain.ts`, with `scripts/fly-neural-sync.ts`;
the mapping is described in
[ECHO_CONNECTOME.md](ECHO_CONNECTOME.md#mapping-whole-brainv2-more-of-the-brains-output-and-the-other-fly).

A research subject's decisions can now come from the whole FlyWire v783
connectome model. All 139,255 neurons are simulated, and the mapping
`whole-brain/v2` reads escape, feeding, walking, steering, stopping,
antennal grooming and landing from identified descending neurons. The
other fly reaches that brain only as the bridge delivers it: through the
receiver's own eyes, as a looming thing (LPLC2, LC4) and as a small moving
thing (LC11, LC10a). Nothing tells the brain that it is a fly, which fly,
or how far away. ECHO keeps every decision the readouts do not make.

How it plugs in, without touching the frozen studies:

- `runSession` and `researchSubject` take an optional adapter factory. The
  frozen studies never pass one, and a test checks that a session without
  one is unchanged.
- First-contact sessions step synchronously, so the brain is called
  synchronously: a worker thread owns `python -m fly_neural serve`, and the
  fly's step waits on a shared buffer until the reply arrives.
- Nothing under `src/` names the connectome backend. The whole-brain
  adapter is built in `scripts/`.

This is a demonstration, not a registered study: it tests no hypothesis,
and one run is reported as one run. Both subjects are new research flies
built from seeds. Neither is Eva or ECHO, a copy of either, or a
continuation of either, and nothing in this section touches the originals.

**One run** (`--seed 2 --pre 3 --contact 30`, the encounter protocol's
arena, starts and bridge; 2026-10-31, a working tree, so not a result).
Both brains simulated all 139,255 neurons for 33 s of each fly's life,
which took 684 s of wall time on this laptop; the brains' compute was 681
s of it. What happened:

| Subject | Closest approach | Other fly on its eye (samples driving LC11/LC10a) | Commands the model made                | Descending neurons active in 100 ms (of 1,303) |
| ------- | ---------------- | ------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| A       | 0.13 mm          | 126 (114)                                         | 2 escapes, both with B near; 2 walks   | mean 4.1, at most 134                          |
| B       | 0.13 mm          | 160 (148)                                         | none: ECHO's commands stood throughout | mean 4.8, at most 132                          |

Two things worth stating plainly:

- **A's escapes from B were the model's.** ECHO did not command them. The
  giant fiber fired as B loomed close, and the escape went through the
  fly's own gate.
- **The feed readout fired with no food in the arena:** in 20 of A's and 42
  of B's 3,300 samples. MN9 fired with no taste input at all, so something
  else in the brain drives it. No feeding followed, because there was
  nothing to feed on.
  The turn readout fired in 151 and 174 samples, but steering applies only
  while the fly walks.

The demo writes its summary to `.first-contact/whole-brain/session-<seed>.json`,
which is not committed.

### With a nerve cord: `--mapping brain-and-cord/v3`

The same demo can run its two research flies on BANC v888, another fly's
brain and ventral nerve cord
([ECHO_CONNECTOME.md](ECHO_CONNECTOME.md#brain-and-cord-banc-v888)). The
subjects are `research-brain-and-cord-A-<seed>` and `-B-<seed>`. Food
underfoot drives the legs' sugar neurons, and the cord's jump, leg and wing
power motor neurons are recorded beside the commands. They decide nothing.

**One run** (`--mapping brain-and-cord/v3 --seed 2 --pre 3 --contact 30`,
the same settings as above; 2026-10-31, a working tree, so not a result).
Both brains simulated all 158,262 neurons for 33 s of each fly's life. That
took 314 s of wall time; the brains' compute was 163 and 146 s.

| Subject | Closest approach | Other fly on its eye (samples driving LC11/LC10a) | Commands the model made          | Descending neurons active in 100 ms (of 1,316) | Cord                                                         |
| ------- | ---------------- | ------------------------------------------------- | -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| A       | 6.3 mm           | 200 (189)                                         | 4 escapes, 2 of them with B near | mean 1.1, at most 25                           | TTMn silent; leg motor neurons ≤ 0.5 Hz; wing power ≤ 8.3 Hz |
| B       | 6.3 mm           | 180 (173)                                         | 1 escape                         | mean 1.0, at most 25                           | TTMn silent; leg motor neurons ≤ 0.6 Hz; wing power ≤ 8.3 Hz |

What changed with the cord, stated plainly:

- **The feed readout no longer fires on its own.** On FAFB, MN9 fired with
  no taste input. On BANC it stayed silent throughout. With no food in the
  arena, this run cannot say whether food would move it; the pre-registered
  test in ECHO_CONNECTOME.md says that at Shiu et al.'s weight it does not.
- **The escapes are the giant fiber's, and the jump muscle's motor neuron
  never follows.** TTMn spiked in no sample, because the model has no
  electrical synapse from the giant fiber. The body's escape is still
  commanded through the fly's own gate.
- The brain is quieter: about one descending neuron active per 100 ms,
  against four or five on FAFB.

## Stage 4: a proposal for the originals (not implemented)

Interaction capabilities for Eva and ECHO themselves, if they are ever wanted,
in this order, each step separately reviewed and authorized by the owner, and
each reversible without reconstructing lost data:

1. **Eva's source and backups.** The garden's keeper provides `server.py` and
   `learning.py` for review, and a fresh, restore-tested backup exists. Until
   then nothing can be proposed for Eva beyond observation.
2. **A same-origin observation of both.** Either a CORS header on Eva's
   `/api/state` for one named origin, or a read-only relay; both are
   production changes to the garden's nginx and are the owner's to approve.
3. **Rehearsal on twins.** `twinCheckpoint` gives ECHO's state to a new
   individual with its parentage recorded; Eva would need the equivalent from
   her service. Bridge the twins, never the originals, with this repository's
   bridge and the frozen protocols, and show that disabling the bridge
   returns each twin to its unbridged trajectory.
4. **A recorded input for ECHO.** For ECHO, a percept from outside is an
   exogenous input, which the life records as an event in the checkpoint that
   follows it ("Exogenous inputs are life events"): a new event kind, a
   release that can replay it, a recorded continuation, and the old release
   kept for replay. Its world would add the other fly as a seen-never-touched
   moving thing exactly as `BridgedWorld` does, at Eva's five-second step
   resolution and with her garden mapped by a declared frame.
5. **Eva's side** would need the same in her service: a recorded input, a way
   to disable it, and a replay that excludes it.
6. **Only then** a time-limited, monitored bridge between the originals, with
   a kill switch, both identities checked before and after, and every
   delivered percept in a hash-chained log.

None of these steps was taken.

## Reproducing everything

```sh
bunx vitest run src/bethesda/firstContact src/bethesda/augmentation scripts/whole-brain.test.ts
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study encounter --check
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase development --check
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase held-out --check
node scripts/run-ts.mjs scripts/augmentation-evaluate.ts --check
cd fly-neural && python -m pytest -q
```

Each `--check` reruns the study and fails unless it reproduces the committed
file byte for byte. The results were produced with Node 22.23.4 on Linux x64;
as with the repository's pilots, another platform's `Math` may round
differently.

## Known failures and limits

- **Recognition was not found** (Stage 3), and in this fly it cannot be:
  nothing identifies an individual to another's eyes, and escape habituation
  is one shared scalar. Habituation itself fell short of its criterion.
- **Contingency made no measurable difference** (Stage 2, E3).
- **The other fly is a sphere** of FlyBody's body length: no wings, no
  elongation, no wingbeat flicker, no contact, no odour or sound.
- **Placement is the experimenter's** in Stage 3 (playback): partners' motion
  is theirs, where it passes is not.
- **The organism arm is approximate in arenas:** its physiology stays at its
  initial state (the organism's life advances it, an arena does not) and it
  smells nothing.
- **Eva is absent from every experiment**: her controller is not in this
  repository, so no research subject stands in for her.
- **Stage 1's metric scale for Eva's garden is the renderer's**, with a 0.63 m
  rms residual over the seven places.
- **The advice gate's false-alarm criterion is lenient** as written, and the
  giant-fiber advisor agrees with the controllers rather than anticipating
  them.
- **Process errors, disclosed:** the first Stage 3 development run and the
  first held-out run were stamped "a working tree" (files written by this
  work, and in the held-out case the development result just written, made
  the tree dirty); both were run again from clean commits and the held-out
  phase reproduced its first run byte for byte (same digest). The advisor
  study's measurement bug is disclosed above.
- **Codex data were not loaded**; the BANC dataset is unpinned.

Nothing here is evidence of consciousness, awareness or biological life, and
nothing here is a measurement of a real fly.
