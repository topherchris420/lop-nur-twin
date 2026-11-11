# Towards a biological encounter: Eva and ECHO

**Status (11 November 2026): first research-only implementation, not an
originals deployment or a demonstrated recognition result.**

This work starts at the failure identified in [First Contact](FIRST_CONTACT.md):
two research flies can visually receive each other's positions and sometimes
escape, but held-out tests did not establish habituation, partner-specific
recognition, or recognition after a delay. Their bridge currently passes only
a sphere of a fly's size. The separate FlyWire/BANC neural experiments do not
drive the original individuals.

## Hypotheses, not desired outcomes

- **H1, detection:** each of two research subjects detects a physically
  plausible partner signal in its own sensory pathway, with false-positive
  rates measured against empty-scene and matched non-fly controls.
- **H2, reciprocal contingency:** each subject's behavior responds to
  changes caused by the other. The live/live condition exceeds a yoked
  playback condition (matched sensory intensity and motion distribution).
- **H3, partner-specific familiarity:** after two separated encounters, a
  subject discriminates a familiar partner's measured cue mixture from an
  unfamiliar one, even when path, density, presentation order, light, diet
  and apparent body size are controlled.
- **H4, retention:** H3 persists after an independently specified delay,
  with checkpoint/restore identity and replay checks.
- **H5, ecological validity:** a model calibrated from real _Drosophila_
  movements and social observations predicts held-out real-fly kinematics
  and interactions better than fixed, simpler baselines.

These are separate gates. H1 alone does not imply H2; H2 does not imply
recognition; H3 does not imply consciousness, subjective awareness or life.

## What this first increment actually implements

`src/bethesda/firstContact/socialSensing.ts` is a **research-only**,
identity-blind synthetic sensory and memory module:

1. It derives a visual angular size and bearing from another fly's size,
   location and receiver-facing direction, restricted by field of view,
   detection range and an externally supplied occlusion flag.
2. It permits a four-bin synthetic surface-chemistry vector **only at
   physical contact range**, where cuticular hydrocarbons might be sampled.
   It cannot read those cues from across the arena. The four bins are
   _not_ measured hydrocarbons, calibrated receptors, sex cues or an
   empirical behavioral model.
3. The receiver gets only sensory observations, with no `life_id`,
   `partner_id`, name, source controller or privileged simulator state.
4. A bounded `SocialFamiliarityMemory` retains matching sensory vectors,
   counts time-separated encounters rather than repeated video frames,
   forgets after a configured interval, and can snapshot and restore itself
   without rewriting history.
5. A chemical-profile match deliberately **cannot distinguish two flies
   with indistinguishable profiles**. The code and tests preserve this
   failure mode rather than calling it recognition.

This module does **not** yet drive a neural controller, modify the existing
visual bridge, alter the deployed originals, implement odor transport, or
produce a new experimental result. These limits are essential to interpreting
its tests.

Run the new checks:

```sh
bunx vitest run src/bethesda/firstContact/socialSensing.test.ts
```

## Biological calibration milestones

**Movement and flight.** Replace controller-only kinodynamics with a
validated 6-leg contact model (foot release, substrate grip, body pitch,
yaw, turning, takeoff and landing), plus aerodynamic lift, drag, wingbeat
kinematics, wind, and metabolic cost. Benchmark not just animations but
velocities, body poses, stance patterns and reaction latencies against
independent real-fly trajectories. The 2026 3D fly kinematics study used
seven synchronized cameras, 800 fps and 50 tracked keypoints: a concrete
reference for validation, **not a dataset already imported here**.
Start with the repository's known deficient independent
[fly-physics gate](FLY_PRIORITIES.md), using a new clean-code benchmark
before claiming improvement.

**Senses.** Expand from a spherical visual proxy to silhouettes and
time-varying retinal motion. Preserve occlusion, range, sensory noise and
latency. Add a calibrated food-odor plume with advection/diffusion and
concentration-dependent receptor responses, but keep this **separate**
from near-contact cuticular cues. Include antennal airflow and grounded
tarsal contact. All per-sense calibration must be declared and validated
outside the dataset used to choose parameters.

**Neural causality.** Connect identified sensory pathways to appropriate
connectome-derived circuits in **research subjects**; quantify how each
pathway changes action selection. The imported connectome alone is neither
a complete functional fly brain nor a ready replacement for Eva/ECHO's
controllers. Compare connectome, reduced-order, and ablated controllers
on frozen, held-out tasks at comparable compute budgets.

**Ecology.** Food scarcity, reserve dynamics, sleep/rest, grooming, injury,
social density and age should affect behavior through measurable body
constraints. Test under environmental variation and unknown perturbations,
not only the conditions that inspired each mechanism.

## What a meeting of the originals would require

Eva's garden service and ECHO's headless organism presently have different
control loops, clocks, world coordinates and persistence backends. The
first-contact bridge is restricted to _research subjects_ and must stay
that way until the following independent gates pass.

1. **Read-only observation and provenance:** fresh source audit and
   restore-tested backups for each original, including the complete history
   and last checkpoint digest. Verify both originals still advance without
   any new bridge.
2. **Encounter rehearsal with new research subjects:** physically co-locate
   two subjects in one authoritative environment with shared collisions,
   food, air, social cues and compatible temporal resolution. The
   existing exchange bridge at 10 ms cannot manufacture 10 ms observations
   from Eva's presently reported 5 s service step. Fix time resolution,
   do not interpolate invented behavior across a 5 s gap.
3. **Behavioral gates:** complete live/live, yoked/live, solitary,
   matched non-fly, rotated-profile, blinded-familiarity and sensory-ablation
   trials. Freeze hypotheses, meaningful effect sizes, sample sizes,
   exclusions, seeds and decision thresholds before held-out testing. Do
   not let an encounter's label leak into sensory signals.
4. **Continuity rehearsal:** on non-original copies only, perform
   deterministic migration to the shared world with two unchanged
   ancestral histories and no merged memory. Reconcile spatial reference
   frames, clocks, collision ownership, persistence, and process failure.
   Aborting the trial must restore each research subject's original
   independent trajectory. Verify every event, checksum and absence gap.
5. **Explicit owner approval for a separately reviewed original
   continuation:** only after a successful rehearsal. Add versioned,
   reversible input and persistence migrations to each production
   controller, retain full backups and prior replay software, introduce a
   bounded time window and kill switch, and hash-chain all cross-organism
   inputs. A repository merge or Vercel deploy alone is **not** approval
   to change either original's memory or life process.

An **authentic shared encounter** needs a physical common world, not a
browser animation showing the two models next to each other. Each animal
must receive sensory consequences of the other's action, react with its
own controller, and keep that interaction in its own history.

### Where these gates stand (11 November 2026)

The commons ([First Contact, Stage 3b](FIRST_CONTACT.md#stage-3b-the-commons-touch-contact-chemistry-and-familiarity))
is the first increment toward gate 2, for research subjects only.

- **Gate 1: not started.** No backup or audit of either original was made,
  and none was needed: nothing here reads or writes them.
- **Gate 2: partly met.** One authoritative world steps both bodies every
  5 ms on one clock, with shared collisions (neither can pass through the
  other), a shared food source, sight of each other through each one's own
  eyes, touch, and this module's contact chemistry, now sensed by a mushroom
  body novelty compartment rather than a profile match. Not met: shared air
  (no airborne odour of the other) and Eva's time resolution. Her controller
  still decides every 5 s; between decisions her body follows the exhibit's
  own animation of her state. That animation is her renderer's, not invented
  behaviour, but it is not a decision of hers either. A move that the other
  body stops is cut short and fed back to her physics and learner.
- **Gate 3: begun.** The familiarity protocol is frozen, with controls
  that each change one thing: a profile transplant (the twin carries the
  partner's exact chemistry on another body, so profile and individual are
  dissociated), an unscented stranger, a sensory ablation (a fly that cannot
  taste) and a frozen memory. The rotated and scrambled profiles of the table
  below are not among them. Its held-out seeds, run once from a clean
  commit, support all five hypotheses by their rules, but H3's alerting gap
  is as large with the memory frozen, so only H1, H2 and H4 (a familiarity
  of chemistry, not of individuals) are credited. Live/live against yoked playback was Stage 2's
  test (E3, not supported) and has not been repeated in the commons.
- **Gates 4 and 5: not started.** The ordered plan is in
  [First Contact, Stage 4](FIRST_CONTACT.md#stage-4-a-gated-plan-for-the-originals-not-implemented).

The chemistry match's predicted failure holds in the new memory too: a fly
carrying the partner's exact chemistry is treated as the partner (H4,
supported). The memory is about cues, not individuals, as this section's
module said it would be.

## Proposed held-out outcome measures

| Question                                  | Evidence required                                                         | Essential negative control                                          |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Did they detect a second animal?          | time-locked endogenous sensory and behavior traces                        | matched non-fly stimulus                                            |
| Did they influence each other?            | bidirectional causal dependence of action and subsequent sensing          | yoked/non-contingent replay                                         |
| Did they recognize a familiar individual? | familiar/stranger discrimination after controlled repeated encounters     | rotated/scrambled chemical profiles and matched visual trajectories |
| Did memory survive?                       | post-restart behavior and ancestry-preserving checkpoints                 | identical fresh subject without experience                          |
| Are they biologically realistic?          | held-out comparisons to measured body dynamics and real social encounters | simpler biomechanical and sensory models                            |

## External scientific anchors

- Billeter, Bailly, Kohlmeier, _The social life of Drosophila
  melanogaster_ (2024 online / 2025 issue):
  https://link.springer.com/article/10.1007/s00040-024-00990-3
- _Who is he and what is he to you? Recognition in Drosophila melanogaster_
  (review):
  https://www.sciencedirect.com/science/article/abs/pii/S0959438812001420
- _Whole-body 3D kinematics of freely behaving Drosophila_ (2026):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC13174342/

No result in this document establishes consciousness, genuine biological
life, friendship or subjective awareness. These are measurements and
research milestones, not scripted outcomes.
