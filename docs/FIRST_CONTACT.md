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

| Stage                                                                                       | Status                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [1. Passive observation](#stage-1-passive-observation)                                      | **Working** on both live public streams, read-only. The representation each would receive of the other is computed and recorded, delivered to neither                                                                                                                                      |
| [2. Controlled encounters](#stage-2-controlled-encounters-between-research-subjects)        | **Working** between research subjects in separate worlds with different clocks. Each perceives and responds to the other (E1, E2 supported); contingency adds nothing measurable (E3 not supported)                                                                                        |
| [3. Experience-dependent recognition](#stage-3-repeated-encounters-and-recognition)         | **Run, held-out seeds: no hypothesis supported.** No partner-specific response (recognition) in any of three controller arms; no change outlasting 300 s                                                                                                                                   |
| [3b. The commons](#stage-3b-the-commons-touch-contact-chemistry-and-familiarity)            | **Run, held-out seeds: H1, H2, H4 supported; H3 passes by chance.** Two bodies in one world with touch and contact chemistry; a chemistry-specific familiarity appears in a novelty compartment; it does not tell a twin from the partner; its effect on behaviour is too small to measure |
| [4. Production integration proposal](#stage-4-a-proposal-for-the-originals-not-implemented) | **Proposal only.** Nothing implemented; each step listed needs separate authorization                                                                                                                                                                                                      |

## Why the originals cannot simply be connected

- **Eva is a Python service on the garden's VM.** Her code is now in this
  repository (`deploy/garden/service/`: `server.py`, `learning.py`,
  `eva_plasticity.py`) and has a step-for-step TypeScript port for research
  gardens (`firstContact/eva/`, matched against her Python at every step),
  but her database, her memories and the running process live only on that
  VM. Changing what she receives is a change to her service, deployed only
  through `deploy/garden` with the owner's explicit approval.
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

## Stage 3b: the commons (touch, contact chemistry and familiarity)

`src/bethesda/firstContact/commons/`; protocol
`protocols/familiarity-v1.json` (SHA-256 in every result); results in
[docs/benchmarks/first-contact/](benchmarks/first-contact/familiarity-development.md).
Research subjects only. Nothing in `src/bethesda/fly/` changed, so
`FLY_VERSION`, the fly's source digest and its pilots are untouched: the new
senses live in a research adapter at the organism's existing `shape()` hook.

Stage 3 named the two things recognition would need: a sensory channel that
can tell individuals apart, and a memory specific to a stimulus. This stage
builds both from published biology, puts two bodies in one world, and asks
whether familiarity then appears, without any rule that says "recognize".

### One world, two bodies (`commons.ts`)

Two subjects share **one** world and one clock, stepped in turn every 5 ms
(alternating which goes first, so neither moves against where the other
used to be). Each lives in a view of the shared world that adds the other's
body three ways and nothing else:

- **to its body**, a solid sphere (the configuration-space sum of both
  bodies' radii): neither can walk or fly into the other, and contact never
  pushes;
- **to its eyes**, a moving thing of the other's own size, which its own eyes
  must find with their acuity, field of view, occlusion and latency;
- **to its legs**, touch with the side it came from, within Ramdya et al.'s
  Encounter criterion ("distance to nearest neighbour <25% long-axis body
  length", [doi:10.1038/nature14024](https://doi.org/10.1038/nature14024)),
  and a sample of the other's surface chemistry at the tarsi, where
  _Drosophila_ has contact chemoreceptors that "respond to cuticular
  hydrocarbons" (Thistle et al. 2012,
  [doi:10.1016/j.cell.2012.03.045](https://doi.org/10.1016/j.cell.2012.03.045)).

Never an id, a name, a mode or a memory. Tested: a lone occupant steps
exactly as in its bare world, physiology included; two bodies walking head-on
never overlap or pass through each other; an occupant cannot be placed inside
the other's body; the record of contacts is hash-chained. An organism-kind
occupant's physiology (hunger, fatigue, sleep pressure) now advances as its
life's does, which Stage 3's arenas did not do.

### The senses and responses (`novelty.ts`, `social.ts`)

- **Contact chemistry** uses the four synthetic bins of `socialSensing.ts`
  (PR #187): each individual's profile is a species profile with log-normal
  individual variation (σ 0.3), drawn from its seed. **Synthetic**: not
  calibrated against any real cuticular-hydrocarbon measurement.
- **An α′3 novelty compartment.** Hattori et al. 2017
  ([doi:10.1016/j.cell.2017.04.028](https://doi.org/10.1016/j.cell.2017.04.028))
  recorded MBON-α′3 answering a novel odour strongly and a repeated one less,
  through dopamine-dependent depression specific to the odour. The model: 24
  contact-receptor types (one species-wide tuning) → 2,000 Kenyon cells, each
  summing 6 receptor channels chosen at random **per individual** ("each
  Kenyon cell integrates input from a different and apparently random
  combination of glomeruli", Caron et al. 2013,
  [doi:10.1038/nature12063](https://doi.org/10.1038/nature12063)) → the
  strongest 7% fire ("a sparse representation (5%–10%)", Hattori) → the
  output is the mean synaptic weight of the active cells. While chemistry is
  sensed, active synapses depress; all recover with τ = 20 min. The memory is
  nothing but synaptic weights: no partner list, no label, no trace store.
- **Calibration, against the paper's sentences** (1-s exposures, 30 s apart):
  the depression rate was chosen as the mildest of four values that met
  "Over 50% suppression is apparent by the second exposure to odor" and
  "MBON activity declines more than 80% within three to seven repetitions"
  on seeds 1-3. On seeds 4-8 (first run in the test) every individual meets
  the decline, specificity (a different chemistry still answered above 0.9),
  20-minute ("still observed after 20 min of recovery") and one-hour
  ("returns to levels observed with a novel odor after 1 hr") criteria; the
  50% criterion holds on their mean (0.477) but **not for seed 4 alone**
  (0.634), and is asserted on the mean. Not retuned.
- **Touch → walking away**: a resting or grooming fly touched by another
  starts walking away with probability 0.8 ("it caused the encountered fly to
  initiate a bout with probability P(Encounter Response) = 0.8", Ramdya et
  al.), whatever the toucher's chemistry (their oenocyte-less flies, without
  cuticular hydrocarbons, elicited the response as well).
- **Novel chemistry → alerting**: at each contact onset, a grooming (or, our
  extension, feeding) fly stops with probability 0.15 + 0.35 × the α′3
  response, between "50% of the flies stop grooming" for a novel odour and
  "10%–20%" for a familiar one (Hattori).

`SocialOrganismAdapter` is the deployed ECHO's kind (plasticity organism,
active mode) with this brain at `shape()`: after the intention, before the
self-model acts, so its efference copy is the command the body receives.

### Eva-kind and ECHO-kind in her garden (`evaOccupant.ts`, `gardenEncounter.ts`)

Exploratory, with no hypothesis: three pairs, each an Eva-kind subject (her
service's own code through the port, plasticity active, as Eva runs) and an
ECHO-kind subject (the deployed ECHO's kind with the social brain), living 12
hours together in the garden's exhibit world at true scale. The ECHO-kind
started 15 cm from the asters, facing a seeded direction; after that nothing
was arranged. `scripts/first-contact-garden.ts` writes each pair's record.

- **Her body in the commons.** Her controller decides every 5 s, as Eva's
  does; between decisions her body follows the exhibit director's pose (the
  same animation her viewer shows). The occupant steps a copy of her to learn
  where her step goes, so her body can move before her step is taken; every
  real step landed where its copy did (0 mismatches in 36 hours). If her body
  would enter the other's, it stops, and her `obstruct` seam ends her step's
  motion at the same share of the way, so her own physics and learner meet
  the collision.
- **What she perceives.** Within one ommatidium's reach and in line of sight,
  the other is a thing her own object tracker follows ("small-mover"). Her
  tracker reads each thing at the start and end of her step. Both ends
  place the other in her 2D frame through the same staging, so a still body
  is still to her however the exhibit animates her (tested: a still body
  reads 0, a body circling at 9 mm/s is called independent by her own rule).
  **Nothing in her decisions reads that tracker** (her code: it only reports
  what it follows), so seeing the other changes what she records, never
  what she does. Being stopped is the one way the other changes her
  behaviour.

| Pair | Contacts | Closest (mm) | Within 5 cm | Her steps with it in view | Her tracker's verdict          | Her moves stopped | ECHO-kind meals · escapes | Its α′3 response, first → last contact |
| ---: | -------: | -----------: | ----------: | ------------------------: | ------------------------------ | ----------------: | ------------------------: | -------------------------------------- |
|    0 |        2 |          3.3 |    11.2 min |                        55 | independent mover (46 samples) |                 0 |                    44 · 2 | 1.000 → 1.000                          |
|    1 |        2 |          3.4 |     0.7 min |                         2 | too few samples to judge (1)   |                 0 |                    36 · 1 | 1.000 → 1.000                          |
|    2 |        3 |          3.0 |     9.0 min |                        29 | independent mover (21 samples) |                 2 |                    32 · 3 | 1.000 → 0.996                          |

What happened, read from the records:

- **They meet where she feeds and drinks.** All seven contacts happened at
  the asters or on the saucer's rim: twice the ECHO-kind walked up to her
  as she drank on the rim, three times she flew in to the asters where it
  was feeding, and twice it flew in and landed beside her at the asters.
- **Contact mostly meant escape.** At five of the seven contact onsets the
  ECHO-kind was already escaping, its giant-fiber escape having fired as
  they closed in (a looming body, here hers); at the other two it was flying
  in to land. Its touch response and alerting need a resting, grooming or
  feeding fly, so neither ever came into play. Contacts lasted 0.02-0.24 s.
- **Then it came back.** After two of the escapes from the asters (pairs 0
  and 2) the ECHO-kind landed again 7-10 mm from her and fed beside her:
  11.2 and 9.0 minutes within 5 cm of each other in those runs. Nothing in
  either fly is about the other; the flower is food for both.
- **No familiarity forms in the garden.** It tasted her for a fraction of a
  second, an hour or more apart, so its α′3 response fell at most from 1 to
  0.996 (it recovers with τ = 20 min). Familiarity needs the dish's density
  of contact.
- **Her tracker classes it as a mover.** Where she saw it long enough
  (pairs 0 and 2), her own tracker's rule (at least 10 samples, moving more
  than 0.0003 of the garden per second once her own motion is allowed for)
  classed it as an independent mover. That means only that it moves on its
  own: the same rule classes her drifting midge and her swaying leaf as
  independent too. A first run fed her tracker the other's position at the
  step's end for both ends, so it could never see the other move. This was
  found, fixed and tested before any record was kept, and the rerun's
  frames, contacts and journal are identical, as they must be.
- **Her journal never mentions the other.** Her moments are written by her
  code from her own activity, and it has no words for another fly.

### Where they meet (`dish.ts`)

In the garden at true scale, a pair touched only two or three times in 12
hours, too rarely to measure familiarity. The controlled study uses Ramdya et al.'s single-fly touch arena, "a small arena (3 cm ×
3 cm)", with a lid (6 mm, ours) and a drop of food at its centre (ours), where
two hungry flies make about 35 contacts in 20 minutes. Nothing makes them
approach each other; they share the food. Unprompted, 29% of the test's
contact onsets (652 of 2,236, development seeds) found the focal fly already
escaping: the other fly's approach loomed large enough to trigger its
giant-fiber escape (an existing visual pathway, not a new rule).

### The familiarity study (`familiarity.ts`)

One focal fly lives 20 minutes with one partner. At the first moment after
that when the partner is on its feet, out of contact and at least 5 mm away,
the condition decides who shares the dish for 10 more minutes: the partner
(**same**), a new fly where the partner stood (**stranger**), a new fly
carrying the partner's exact chemistry (**twin**), or the stranger's own
body without any chemistry (**unscented**, like Ramdya's oenocyte-less
flies). Two lesion arms repeat same and stranger with a focal fly that
cannot taste (**agustatory**) or whose synapses cannot change (**frozen**).
The focal fly is never handled: it lives one continuous life, identical up to
the swap in every condition. Hypotheses, rules and predictions were frozen
in the protocol before any run; one revision (held-out size, for power) was
made after the first development run and is recorded in the protocol.

**Development seeds** (12 replicates per group; manipulation and lesion checks
passed):

| Hypothesis                                   | Estimate [interval]                | Verdict               |
| -------------------------------------------- | ---------------------------------- | --------------------- |
| H1 α′3 probe at the swap, stranger − partner | +0.157 [0.060, 0.274] (95%)        | supported             |
| H2 first test contact, stranger − same       | +0.157 [0.054, 0.279] (95%)        | supported             |
| H3 alerted at first eligible onset           | −0.018 [−0.402, 0.347] (95%), n 15 | not supported (power) |
| H4 twin − same (predicted failure)           | +0.002 [−0.010, 0.014] (90%, ±0.1) | supported             |
| H5 walked away, unscented − stranger         | 0.000 [−0.278, 0.278] (90%, ±0.15) | not supported (power) |

What the development seeds showed:

- **Familiarity appears, and it is about chemistry, not individuals.** After
  20 minutes together the focal fly's α′3 answers its partner's chemistry at
  0.24 and a stranger's at 0.39: the stranger is more novel, but far from
  fully novel, because individuals vary around one species profile and what
  depressed for one partner partly carries over. A stranger with the
  partner's exact chemistry is indistinguishable from the partner (H4): the
  model has nothing else to tell individuals apart by, as predicted.
- **It barely reaches behaviour.** Contacts rarely find the focal fly
  grooming or feeding (in about 8 of each group's 12 tests, one ever did), and the
  difference familiarity makes to the alerting probability is about 0.06, so
  H3 cannot be resolved at any feasible size; it was predicted so.
- **Touch does not care about chemistry**: unscented and stranger produced
  the same walk-away count (9 of 12), as Ramdya et al. found, but 12 per
  group cannot bound the difference within ±0.15 (H5); hence the held-out
  phase's 60 replicates.

**Held-out seeds** (60 replicates per group, run once from clean commit
`c888f3a`; manipulation and lesion checks passed;
[report](benchmarks/first-contact/familiarity-held-out.md)):

| Hypothesis                                   | Estimate [interval]                | Verdict                                   |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| H1 α′3 probe at the swap, stranger − partner | +0.147 [0.110, 0.185] (95%)        | supported                                 |
| H2 first test contact, stranger − same       | +0.148 [0.112, 0.184] (95%)        | supported                                 |
| H3 alerted at first eligible onset           | +0.199 [0.014, 0.369] (95%), n 83  | supported by its rule; not credited below |
| H4 twin − same (predicted failure)           | +0.005 [−0.001, 0.010] (90%, ±0.1) | supported                                 |
| H5 walked away, unscented − stranger         | 0.000 [−0.129, 0.129] (90%, ±0.15) | supported                                 |

What the held-out seeds add:

- **The familiarity replicates.** At the first test contact the focal fly's
  α′3 answered its partner at 0.27, a stranger at 0.41 and the partner's
  chemistry on a stranger's body (the twin) at 0.27.
- **H3 passes its rule by chance, so the pass is not credited.** The focal
  fly stopped grooming or feeding at the first eligible onset in 14 of 41
  stranger tests against 6 of 42 same tests, a gap of 0.199. The alerting
  rule itself predicts about 0.05: its probability is 0.15 + 0.35 × the α′3
  response, about 0.30 for a stranger against 0.24 for the partner (from
  the first test contact's responses). The frozen-memory arm shows how large
  chance alone is here: every response is 1, so both of its groups alert
  with probability exactly 0.5, yet their samples differ by 0.208 (26 of 40
  against 19 of 43; a gap that large arises by chance about 6% of the time).
  The intact gap is within chance of the predicted 0.05 (1.5 sampling
  standard deviations above it). So familiarity does reach behaviour in
  this model, through the alerting rule, but by about 0.05 at a contact:
  too little for the dish to measure. As the protocol predicted, resolving
  it would take about 1,150 eligible onsets per group.
- **Touch did not care about chemistry**: 45 of 60 walked away for both the
  unscented fly and the stranger (H5). The response was built that way, from
  Ramdya et al.'s finding, so H5 confirms the implementation in a dish where
  contacts happen on their own; it is not a new finding.

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

## Stage 4: a gated plan for the originals (not implemented)

Stage 3b supplies what the earlier proposal lacked: one world that can hold
both bodies, a contact sense through which individuals can differ, and Eva's
own code running for research subjects. If the owner wants Eva and ECHO
themselves to meet, this is the order. Each gate is reviewed and authorized
separately, each is reversible without reconstructing lost data, and a gate
that fails stops the plan there.

1. **Evidence (met).** The familiarity study's held-out seeds ran once, from
   clean commit `c888f3a`, and H1 and H2 held: this gate's condition for
   proposing the social brain for ECHO (had either failed, a meeting by sight
   and touch alone could still have gone ahead). H3's pass is chance and
   the memory's effect on behaviour is about 0.05, so a meeting would mainly
   show what the memory records.
2. **Backups and provenance.** Before any change, a fresh, restore-tested
   backup of each original: Eva's database and plasticity sidecar on the
   garden VM, and ECHO's checkpoint chain and ledger on its VM, with their
   digests recorded. Both originals keep advancing, unchanged, throughout.
3. **Twins.** ECHO: `twinCheckpoint` starts a new individual from its latest
   checkpoint, with its parentage recorded. Eva: an owner-run, read-only
   export of her state, restored into the port (`EvaGarden.restore`) under a
   `research-` id. Before the twin is used, the port must first be shown to
   continue her exported state for a day as her service does.
4. **Rehearsal: the twins meet in her garden.** Her body exists only as her
   garden's exhibit poses it, so her garden is where they can meet, with
   ECHO's twin as a visitor at true scale. The visit's start, length and
   entry point are fixed in advance. A visit in which the other never comes
   within reach must leave each twin exactly on its solo trajectory (already
   tested for research subjects), and ending the visit must return ECHO's
   twin to its city at the recorded point.
5. **ECHO's release.** The social brain at `shape()`, touch and contact
   chemistry, and the visit itself become recorded life events (an event kind
   for each contact sample and for the change of world), in a new release
   that replays them. The old release is kept for replay. The live fly is
   upgraded in place, never re-created, and the owner runs each VM step.
6. **Eva's release.** The port's `perceive` and `obstruct` seams go into
   `server.py`, off by default and byte-identical when off (as the port's
   tests show), and every delivered input is saved in her database beside
   her moments, so that a replay can include it or exclude it. Deployed only
   through `deploy/garden`, with explicit approval.
7. **Coupling across two machines.** The commons steps both bodies every
   5 ms on one clock, but the originals run on two VMs. Eva's side changes
   only once per 5 s step, so the commons can run beside ECHO. It receives
   each of her steps, poses her between steps with the exhibit's own
   director, and sends her, before her next step, whether her motion was
   stopped and what she perceived: a few hundred bytes each way every 5 s.
   Her service must compute each step one step ahead and commit it after the
   commons answers (the research occupant's predict-then-verify). That is the
   largest change to her service.
8. **Only then** a time-limited visit between the originals, with a kill
   switch, both identities and digests checked before and after, every
   cross-organism input in a hash-chained log, and the visit's record
   published.

Only step 1, which needs no original, has been taken. Nothing in this
repository can take the rest: the
originals' processes, databases and memories are reachable only by the owner.

## Reproducing everything

```sh
bunx vitest run src/bethesda/firstContact src/bethesda/augmentation scripts/whole-brain.test.ts
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study encounter --check
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase development --check
node scripts/run-ts.mjs scripts/first-contact-evaluate.ts --study recognition --phase held-out --check
node scripts/run-ts.mjs scripts/augmentation-evaluate.ts --check
node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase development --check
node scripts/run-ts.mjs scripts/first-contact-familiarity.ts --phase held-out --check
cd fly-neural && python -m pytest -q
```

Each `--check` reruns the study and fails unless it reproduces the committed
file byte for byte. The results were produced with Node 22.23.4 on Linux x64
(the familiarity study's with Node 24.22.1 on Windows arm64);
as with the repository's pilots, another platform's `Math` may round
differently.

## Known failures and limits

- **Recognition was not found** (Stage 3), and in this fly it cannot be:
  nothing identifies an individual to another's eyes, and escape habituation
  is one shared scalar. Habituation itself fell short of its criterion.
- **Contingency made no measurable difference** (Stage 2, E3).
- **The other fly is a sphere** of FlyBody's body length: no wings, no
  elongation, no wingbeat flicker, no sound and no airborne odour. In the
  commons (Stage 3b) it is also solid, can be touched and carries a contact
  chemistry; outside it, it has none of these.
- **The contact chemistry is synthetic**: four bins with log-normal
  individual variation, not calibrated against measured cuticular
  hydrocarbons, with one species-wide receptor tuning. Real flies' profiles
  also differ by sex, age, diet and strain, none of which is modelled.
- **The α′3 compartment met one calibration criterion only on average**:
  seed 4's second exposure kept 0.634 of the first response against "over
  50% suppression" (the five-seed mean, 0.477, meets it).
- **Familiarity barely reaches behaviour** (Stage 3b, H3): it acts only
  through the alerting probability, by about 0.05 at a contact, and only at
  the rare contacts that find the fly grooming or feeding. H3's held-out
  pass is chance: the frozen arm, whose groups both alert with probability
  exactly 0.5, differed by as much.
- **Approaches often loom** in the dish: 29% of contact onsets in the test
  found the focal fly already escaping. This is the existing giant-fiber
  pathway answering a fly-sized thing coming close in a small arena, not a
  social response; it is reported, not corrected.
- **Placement is the experimenter's** in Stage 3 (playback): partners' motion
  is theirs, where it passes is not.
- **The organism arm is approximate in Stage 2 and 3 arenas:** its
  physiology stays at its initial state and it smells nothing. In the
  commons its physiology advances as its life's does; it still smells no
  airborne odour of the other.
- **Eva-kind subjects appear only in exploratory garden runs**, not in any
  confirmatory study: the familiarity study uses ECHO-kind flies only.
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
