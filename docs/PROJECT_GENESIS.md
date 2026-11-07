# Project Genesis: research toward a deeper continuation of Eva and ECHO

> **Research only.** Nothing in this work stopped, restarted, upgraded,
> migrated, read the store of, or sent anything to Eva or ECHO or either VM.
> Every experiment ran on research flies built from seeds. A merged pull
> request is not an authorization to change a deployed individual; live
> changes need the owner's separate, explicit approval.

The aim is for Eva's and ECHO's histories to matter more to what they do
next, through validated mechanisms, without ever giving either a new
beginning. This round audited where they stand, settled how the connectome
models should enter, built and tested one new biologically grounded capability
on research flies (an image-forming compound eye), and wrote down, for each
original separately, what that evidence does and does not justify.

## Short version

- **Baseline.** The repository at `754beb6`: `tsc --noEmit` clean; the full
  test suite 2,414 passed and 11 skipped in 203 files. ECHO's deployed
  configuration, continuity machinery and earlier studies are as the
  [audit](EVA_ECHO_AUDIT.md) and [claims register](RESEARCH_CLAIMS.md) record
  them. Eva's controller is not in this repository and was not audited.
- **Built.** A research compound eye (`src/bethesda/vision/`): 1,694
  ommatidia, Hassenstein–Reichardt motion detectors and LPLC2-like looming
  units, put in front of the deployed controller's own escape reflex. It
  replaces a sense computed from the world's geometry with one computed from
  an image the fly's body receives. [Details](FLY_VISION.md).
- **Found.** On two held-out samples it ignored every near miss (0 of 48
  against the deployed proxy's 20) and warned three times earlier, but it did
  not beat the deployed proxy overall: its primary pre-registered criterion
  failed twice (+0.025 [−0.105, 0.162] F1 for the better version). The
  mechanism is real (its ablation and shuffled control lose 0.2–0.35 F1); its
  sensitivity is not yet good enough, and at full resolution it costs about 50
  times what the deployed fly does. A one-line rule on the senses ECHO already
  has, visual time to contact, did as well or better.
- **Recommended for ECHO:** no migration of the eye. A τ-based escape rule is
  the stronger candidate, and needs its own frozen protocol first.
- **For Eva:** nothing can be proposed until her service's source, schema and
  backups are available to audit.

## The baseline

### The repository

Audited at `754beb6` (the default branch when this work started), on
2026-11-07, Linux x64, Node 22.23.4:

| Check                                     | Result                                        |
| ----------------------------------------- | --------------------------------------------- |
| `tsc --noEmit`                            | clean                                         |
| `vitest run` (all 203 files)              | 2,414 passed, 11 skipped, 0 failed (12.6 min) |
| Fly, augmentation and first-contact tests | 267 passed                                    |

### ECHO

ECHO is the Bethesda headless life on one Oracle `VM.Standard.A1.Flex` (1
OCPU, 8 GB, arm64). It was born reduced-order on `digital-fly/7` and has been
carried forward only by recorded continuations: ECHO v2, v3, the organism
(mushroom body, olfactory navigation, maintenance physiology) and the physics
repair onto `digital-fly/9` ([stewardship](ECHO_STEWARDSHIP.md)). Its
continuity rests on whole-graph checkpoints that are verified on restore, an
epoch-fenced single writer, recorded gaps, backups that are proven to resume,
an append-only ledger and independent replays
([operations](BETHESDA_CONTINUOUS_LIFE.md)). This work read the code of each
of those and changed none of it.

### Eva

Eva is the garden's Python service on its own VM. Her controller, learning
loop, database schema, backup system and deployment are **not in this
repository** and were not available to this work. What is known is
documented only ([live garden](LIVE_GARDEN.md),
[audit](EVA_ECHO_AUDIT.md#the-two-individuals)): an abstract 2-D garden in
fractions with seven places and no metric scale, daily backups, and recovery
that is documented as not guaranteed. Her clay viewer was not used to infer
any of it.

### What each can do

Demonstrated means tested on research subjects (or observed in the original)
with results archived; implemented means built and unit-tested but with no
demonstrated benefit; proposed means not built.

| Capability                                                 | ECHO                                  | Research flies, after this round                                                        | Eva                          |
| ---------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| Looming from the world's geometry (object size, expansion) | demonstrated (its escapes)            | demonstrated                                                                            | not inspectable              |
| **Looming from an image (compound eye)**                   | absent                                | **demonstrated: collision-course selectivity; no overall gain**                         | not applicable (no geometry) |
| Optic-flow rotation signal                                 | absent (self-motion from the body)    | implemented (wide-field signal, tested on gratings)                                     | not inspectable              |
| Odour: one still-air level, no plume                       | demonstrated                          | unchanged                                                                               | not inspectable              |
| Place memory and valuation                                 | demonstrated (Study A)                | unchanged                                                                               | documented only              |
| Mushroom-body reward prediction, extinction                | demonstrated for extinction (Study C) | unchanged                                                                               | not inspectable              |
| Memory that pays where food moves                          | negative (Study B)                    | unchanged                                                                               | not inspectable              |
| Connectome-level learning (FAFB v783)                      | not run on ECHO                       | negative for odour specificity ([adaptive intelligence](ECHO_ADAPTIVE_INTELLIGENCE.md)) | not run on Eva               |
| Brain and cord (BANC v888)                                 | not run on ECHO                       | 4/10 and 9/10 criteria, offline ([connectome](ECHO_CONNECTOME.md))                      | not run on Eva               |
| Physical walking                                           | absent (kinematic)                    | failed its flat-floor gate ([priorities](FLY_PRIORITIES.md))                            | not inspectable              |
| Verified restore, replay, continuation                     | demonstrated on the original          | demonstrated, including the eye's state                                                 | documented as not guaranteed |

## FlyWire and BANC: how they should enter

The repository already runs both connectomes ([connectome backend](ECHO_CONNECTOME.md)):
Shiu et al.'s leaky integrate-and-fire model on all of FAFB v783 (139,255
neurons, 54.5 million synapses), conformant with Brian 2, reproducing 10 of 12
published criteria; and BANC v888 with its ventral nerve cord (158,262 neurons)
under its own mapping. What their results say about integration:

- **Never one pooled graph.** FAFB and BANC are different animals: different
  specimens, segmentations, transmitter predictions and annotation
  vocabularies, and their brains overlap. Concatenating them would count the
  same cell types twice under two identities, and no synapse joins two
  specimens. `Tables` refuses `+`, and every population names its dataset.
- **A reconciled graph is not yet justified.** Reconciliation needs cell-type
  matching across specimens (Schlegel et al. 2024 did this for FAFB and the
  hemibrain), then a choice of which specimen's weights to trust. Nothing in
  the results needs it yet: no experiment here is limited by having only one
  specimen.
- **The strongest validated approach is modular.** FAFB for brain questions,
  BANC where the cord matters, and in the organism only reduced modules that
  have each passed a held-out test of their own. The full connectome cannot
  sit in ECHO's loop: on one thread it runs at 1.3 s per simulated second,
  about 190 times the 7 ms the deployed life spends per simulated second, and
  its sensorimotor results are mixed (the giant fiber fires at almost
  everything that moves; KC→MBON learning is not odour-specific).
- **What this round adds to that path** is the input side. The connectome
  mappings feed looming as size, expansion and bearing taken from the world's
  geometry. An image-forming eye can instead supply what LPLC2 and the
  detectors upstream of it would see. Connecting the eye's unit outputs to the
  FAFB and BANC LPLC2 populations (a new, versioned mapping) is the natural
  next experiment on that side; it was not done here.

## What this round built

The compound eye, its battery and its results are in
[Research compound eye](FLY_VISION.md) and
[`benchmarks/fly-vision/`](benchmarks/fly-vision/README.md). In brief:

| Protocol   | Eye                       | Held-out criteria | Live F1, eye vs deployed | Near misses escaped, eye vs deployed | Median lead, eye vs deployed |
| ---------- | ------------------------- | ----------------- | ------------------------ | ------------------------------------ | ---------------------------- |
| looming-v1 | v1 (Weber photoreceptors) | 4 of 7            | 0.677 vs 0.739           | 0/48 vs 16/48                        | 63 vs 38 ms                  |
| looming-v2 | v2 (log photoreceptors)   | 5 of 7            | 0.825 vs 0.800           | 0/48 vs 20/48                        | 110 vs 38 ms                 |

The only change from v1 to v2 was found in looming-v1's held-out split after
it had run, so it was tested on a new held-out sample. Both protocols'
primary criterion failed; both mechanism criteria (ablation, shuffled
retinotopy) passed; live escapes matched the held runs' predictions in every
one of 496 trials.

## Sustainability

| Workload (one thread, this machine)      | Wall s per simulated s |
| ---------------------------------------- | ---------------------- |
| City and a research fly, deployed config | 0.0073                 |
| The same with the compound eye           | 0.369                  |
| Full FAFB brain (project laptop, ARM)    | 1.30                   |

ECHO's VM has one OCPU and already blocks for 17–19 s every five minutes to
checkpoint. The eye, as built, would need most of that core whenever the fly
moves. The exact static-scene cache reuses the static scene whenever the
fly has not moved (for 54% of the city run's 30,000 images); a coarser
lattice and a lower image rate could make the moving case affordable, but a
coarser eye is a different eye and has not been tested. Eva's VM could not be
measured.

## Continuity

Any addition to an original keeps the rules the organism's continuation
established: declared additions beside the existing adapter; a recorded
continuation appended to the original birth and history; a projection that
removes exactly the additions and gives back the previous graph's digest; the
old release kept for replay; nothing presented as an experience the
individual already had.

For the eye specifically:

- **Its state is additive and new.** Typed arrays beside the controller,
  initialized from its first image with no contrast and no motion. It holds
  nothing learned and forgets within about a second.
- **It survives a checkpoint.** A research fly with the eye restores from a
  whole-graph snapshot to the same bytes and steps on with the same state hash
  through an escape (`vision.test.ts`).
- **Removing it is clean, but not a time machine.** In observe mode the
  wrapped controller runs step for step as without the eye, so the projection
  that drops the eye returns the controller's graph exactly. In drive mode the
  controller has lived through escapes the eye caused; dropping the eye
  returns that controller as it now is, the same individual's continued state,
  not the state it would have had.
- **No memory is converted.** The eye reads none of ECHO's memories and
  writes none. There is nothing of ECHO's past to reinterpret.

## ECHO migration proposal

**Recommendation: do not migrate the compound eye to ECHO.** The evidence:
its primary criterion failed on two held-out samples, it misses more threats
than ECHO's own proxy, and it would take most of the VM's one core whenever
ECHO moves.

What would have to change before it is reconsidered, each a new experiment
with a held-out split of its own: sensitivity to fast, small and low-contrast
threats (an LC4-like channel, faster detectors), validated behaviour in flight
(where the fly's own motion fills the eye with optic flow), a coarse eye that
keeps the discrimination at a fraction of the cost, and a city battery, not
only an arena.

A **stronger candidate surfaced**: an escape rule on visual time to contact,
τ = size / (d size / dt), from the senses ECHO already has. It was a
pre-registered baseline here, its threshold chosen on development data, and
it scored 0.917 and 0.824 on the two held-out samples against the deployed
proxy's 0.739 and 0.800. That is not yet grounds to change ECHO: it was a
comparator, not the hypothesis, its two samples disagree by 0.09, and its
interaction with ECHO's self-model and habituation, and its behaviour in
flight and in the city, are untested. It needs its own protocol: frozen
criteria, new held-out seeds, the city, flight.

If either candidate ever passes, the continuation would follow the
organism's precedent, step by step, with the owner's separate approval:

1. Verify the deployed release and its head checkpoint against the ledger and
   an independent replay.
2. Take a backup and prove it restores, independently, off the VM.
3. Map every existing state field to the new release: all of it unchanged
   (the change is a new sense or rule beside the controller).
4. Initialize the new state from nothing the fly experienced (the eye's first
   image; a rule has no state), and record that in the continuation.
5. Version it: a new kind beside `ORGANISM_LIFE`, its engine versions, an
   `engine-upgrade` event.
6. Rehearse on a twin of a backup (`twinCheckpoint`), never the original, and
   compare the rehearsal's behaviour with the frozen protocol's predictions.
7. Prove the projection: removing only the addition returns the previous
   graph's digest.
8. Abort if any restore, projection or replay comparison differs by a byte,
   if the rehearsal's checkpoint cost exceeds the lease, or if the VM's core
   cannot keep the life within its tolerated lag.
9. Irreversible: none before the cutover; after it, the life lives under the
   new release (its history before stays replayable under the old one, which
   `install.sh` keeps).
10. After the cutover, replay the first sealed checkpoints independently and
    record them on the ledger.

## Eva migration proposal

**Nothing can be proposed for Eva yet.** Her simulation is not in this
repository, so her controller, its state, her database schema and her backups
cannot be inspected, and any mapping of her state into a new controller would
be guessed. Nothing this round built applies to her world as documented: a
compound eye needs metric geometry to render, and her garden has none.

The prerequisites, in order: the owner makes her service's source, schema,
backup procedure and deployment available for a read-only audit; that audit
is written up as ECHO's was; a restorable backup is verified off her VM;
only then a candidate tested on research copies, and a separate plan.

## What remains unverified

- Any benefit of image-based vision for a flying fly, in the city, or over
  long periods.
- The eye's cost on the A1 VM itself (measured only on an x64 Xeon).
- That a τ-based rule improves ECHO's escapes in its own life (two held-out
  samples in an arena favour it; nothing more).
- Every claim about Eva's internals.
- That FAFB or BANC models improve any behaviour of a research fly over ECHO's
  controller (the earlier work's results are mixed or negative).

## Next milestones

1. **R.A.I.N. Genesis Stage A**: an ecological world that evolves on its own,
   deterministically, without a fly in it, which a research fly's actions can
   change through explicit mechanisms (food ripening and depletion, odour
   transport, wind, light, temperature, moisture).
2. A frozen protocol for the τ escape rule, on new held-out seeds, in the
   arena and the city, perched and in flight.
3. The eye in flight, and a coarse eye's cost and discrimination.
4. A versioned connectome mapping that takes the eye's looming units as LPLC2
   input, on FAFB and on BANC separately.
