# ECHO Adaptive Intelligence: selective learning and adaptive behaviour on research subjects

> **Research on research subjects only.** Every experiment here runs on a
> subject created for it from a seed: a model of the connectome, or a
> `DigitalFly` with ECHO in a research world. None of them is the deployed
> fly, a copy of it or a continuation of it. Nothing here reads, writes,
> restarts or commands the original individual, its store, checkpoints,
> backups or public ledger, and nothing here runs on its VM. Nothing here
> is evidence of awareness, subjective experience or general intelligence.

The question this work asks:

> Can a persistent, biologically inspired artificial organism become
> measurably more adaptive through experience, and can that improvement be
> traced to specific neural mechanisms rather than additional rules or
> computational scale?

**The short answer: not yet established.** On research subjects built
from the FlyWire connectome, every result held out and pre-registered:

- **A forager became measurably more adaptive through experience, and the
  gain is traced to dopamine-gated plasticity.** Its choices come from the
  connectome's Kenyon-cell→MBON synapses under a three-factor dopamine
  rule. After food moved it found the new site in 4.5 visits (with fixed
  weights, never), it reversed three times out of three, and it kept a
  trained site after interference (0.71 of probe visits against 0.19).
  Silencing its dopamine removed the gain; the same forager without
  plasticity did not adapt ([Adaptive life](#adaptive-life-experiments-a-c-d-e), 11 of 14 criteria).
- **In the full spiking model the same rule does not learn which odour was
  rewarded.** On one held-out odour pair it learns nothing; on the other,
  the asymmetry it produces survives shuffling which odour was rewarded.
  It does extinguish and reverse. Limitation A, odour-specific learning,
  remains ([plasticity-v2](#odour-specific-learning-plasticity-v2), 10 of
  22 criteria).
- **The mechanisms built to make learning specific made no measurable
  difference** where they were tested: the sparse Kenyon-cell code, the
  antennal-lobe correction, the dopamine threshold and the eligibility
  trace.
- **The giant fiber did not learn to tell threats apart.** A
  looming-selective readout did not generalise to held-out stimuli (2 of
  6 criteria). In closed loop the giant fiber and MN9 controlled a
  research subject safely, but it escaped only 6 of 10 threats and fed
  less than under ECHO (5 of 6 criteria).
- **ECHO already does better at adapting.** Its own mushroom-body module
  relocates and reverses about twice as fast as the connectome forager,
  and a bookkeeping heuristic faster still.

So adaptation through a biological plasticity mechanism is shown in a
reduced forager. The connectome-level specificity that would make it the
fly's mechanism, rather than one more rule, is not. Nothing here ran on,
or changed, the deployed fly.

## Where it started

[ECHO Connectome](ECHO_CONNECTOME.md) left three limitations. Each was
re-run from a clean commit before anything was changed, and each reproduced
exactly
([`baseline-reproduction.json`](benchmarks/fly-neural/adaptive/baseline-reproduction.json),
commit 0252eaa, 62 min):

|     | Limitation                                                                                                                                                                        | Reproduced                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A   | The connectome's mushroom body does not learn which odour was rewarded: two odours share their Kenyon cells (KCs), and the merged dopamine-gated rule depresses synapses for both | KC Jaccard(A, B) 0.955; learning index within ±0.001; 4 subjects, every field identical |
| B   | The giant fiber (GF) fires at almost everything that moves                                                                                                                        | 197 GF episodes against ECHO's 5 escape onsets: 3 hits, 2 misses, **194 false alarms**  |
| C   | MN9 agrees with feeding in only part of the time, and `neural-experimental` mode had never run on the real connectome                                                             | 28.5% of samples (1,703 of 5,994 feeding samples, 0 model-only)                         |

## The original individual

The deployed fly was not touched. The work is on the branch
`feat/echo-adaptive-intelligence`; it changes nothing in `src/` or `deploy/`
(tests check that neither mentions any of the new scripts or configs), adds
no production option, and every new capability is a research command that
creates its own subject:

- `python -m fly_neural mbcode | selective | threat | adaptive | closedloop`
  run on the connectome model or on research subjects' state, never on a
  store;
- `scripts/echo-threat-battery.ts` and `scripts/echo-closed-loop.ts` build a
  `DigitalFly` from a seed in a research world, refuse a production host and
  production paths (the shadow's guard), refuse `--store`, `--checkpoint`,
  `--backup`, `--life` and `--individual`, and import nothing that reads an
  organism (tests list their imports);
- the closed-loop server refuses a header that does not name a
  `neural-experimental` research subject (`subject` starting `research-`,
  no `lifeId`, no production marker), as the shadow's does;
- a research subject's checkpoint (`fly-neural-research-subject/v1`) says
  `research_subject: true`, is sealed, and is refused if tampered with or
  if it names another subject, arm, seed or config.

No memory was imported into ECHO, and no experimental controller, readout or
rule is wired into the deployed fly. Moving any of it into the original
individual needs separate explicit authorization.

## What was built

### 1. A sparse Kenyon-cell code (limitation A, the representation)

Shiu et al.'s model gives every synapse the same weight per synapse and
every neuron the same threshold. On it one odour (three glomeruli) fires
about 65% of the 5,177 KCs, and two unrelated odours share 98.7% of them.

**The KC threshold and APL sweep** ([`mb-representation-v783.json`](../fly-neural/experiments/mb-representation-v783.json),
result [sealed](benchmarks/fly-neural/adaptive/mb-representation-v783.json), commit ed92c3b).
Two changes with a biological basis were swept: APL→KC inhibition × 1–32
(APL keeps the code sparse in flies; Lin et al. 2014) and the KC threshold
× 1–4 above rest (KCs need several co-active claws to fire; Gruntman &
Turner 2013). In this model scaling every input to a KC by 1/k is exactly a
threshold k times further from rest, because reset equals rest and the
membrane is linear in its input.

- Sparseness is easy: KC threshold × 3 brings the coding level to 9.4–9.5%,
  inside the pre-registered 2–17% band (sparse KC responses in flies are
  about 5–10% of KCs per odour; Honegger et al. 2011).
- Distinctness is not: at every in-band point the two odours' KC sets
  still overlap with Jaccard 0.75–0.90. The selected point
  (`apl1-thr3-kckc1`) has 0.854. More APL inhibition silences KCs before it
  separates them.
- **The KC–KC hypothesis is refuted.** Muting KC→KC synapses changes the
  overlap from 0.987 to 0.977 at Shiu's weights and from 0.854 to 0.850 at
  the selected point. The overlap is not recurrent.

**An exploratory probe of the antennal lobe** (development odours only; not
a result file, recorded here). At the selected point, 98.3% of the
excitatory drive onto the KCs both odours fire comes from projection
neurons (PNs). Odour A stimulates 3 of 53 glomeruli yet fires 553 of 685
PNs, odour B 542, and they share 98% of them. Of the excitatory drive onto
PNs of glomeruli A does not stimulate, 77.3% comes from antennal-lobe local
neurons (ALLNs), and 96.2% of that onto ORNs it does not stimulate. In the
model every cholinergic synapse is a chemical excitatory one; in the fly,
lateral excitation between glomeruli exists (Olsen, Bhandawat & Wilson 2007) and is carried mainly by electrical coupling through excitatory local
neurons (Yaksi & Wilson 2010; Huang et al. 2010), which a two-sign
chemical model cannot represent. The dense code starts upstream of the
mushroom body.

**The antennal-lobe sweep** ([`mb-representation-al-v783.json`](../fly-neural/experiments/mb-representation-al-v783.json),
result [sealed](benchmarks/fly-neural/adaptive/mb-representation-al-v783.json), commit eb59b1d).
The excitatory ALLN chemical synapses × 1, 0.5, 0.25, 0.1, 0, crossed with
the KC threshold. Selected by the pre-registered rule (in band, every
trial ≥ 1% of KCs, readout MBONs ≥ 20 spikes per trial to each odour,
least overlap): **`apl1-thr2-kckc1-alln0.5`**, coding 4.3–4.7%, KC Jaccard
0.637, readout ~40 spikes per trial. This is the code the learning
experiments use ("sparse").

- The PN overlap stays at 0.94, and the similar odour Asim (two of A's
  three glomeruli) overlaps A at 0.662, barely more than the unrelated B.
  At this point odour identity is still mostly lost in the antennal lobe.
- Sparser, more distinct codes exist further along the ALLN axis: at
  × 0.25 and threshold × 1, coding 3.6–4.6%, KC Jaccard 0.189, PN Jaccard
  0.69, Asim 0.217. But odour B drives the readout MBONs only 13–16 spikes
  per trial there, under the minimum of 20, so the rule passes it over.
  At × 0.1 and below nearly every KC is silent.

### 2. A three-factor, synapse-specific learning rule (limitation A, the rule)

`selective.py`, rule v2. Each KC→readout-MBON synapse _ij_ holds a
depression state _V_ in [0, 1] and its weight is
_w_ = *w*₀ (1 − (1 − floor) _V_):

- **Eligibility.** A KC's spikes leave a trace _E_ that decays with τₑ = 1 s
  and saturates at 3 spikes; only synapses of KCs that fired are eligible
  (synapse-specific).
- **Dopamine, thresholded.** The reward signal of a compartment is the
  causal 50 ms PAM rate onto that MBON; it counts as reward only above θ,
  calibrated once on development odours before any learning run
  (θ = 50.1 Hz: unrewarded dopamine reaches 1.3 Hz at its 0.999 quantile,
  rewarded runs at a median of 99 Hz;
  [calibration](benchmarks/fly-neural/adaptive/plasticity-v2-v783-calibration.json)).
  Odour-driven PAM activity below θ changes nothing, so there is no
  nonspecific depression.
- **Prediction error (Rescorla–Wagner).** With reward,
  _V_ += η_dep·_E_·(1 − _V_); without it,
  _V_ −= η_ext·_E_·_V_. Learning slows as the prediction approaches the
  outcome, and an eligible synapse whose expected reward is omitted
  recovers: extinction and reversal. In flies omission forms a new
  opposing memory rather than erasing the old one (Felsenberg et al. 2017,
  2018); here it is one bounded state, a simplification.
- **Stability.** _V_ is bounded, so the weight stays in
  [floor·*w*₀, *w*₀]; nothing grows without limit and nothing goes negative.

Its basis: pairing an odour with dopaminergic-neuron activation depresses
KC→MBON synapses for the paired odour only (Hige et al. 2015), dopamine acts
compartment by compartment (Cohn, Morantte & Ruta 2015), the order and
timing of odour and dopamine decide whether a synapse is depressed or
potentiated (Handler et al. 2019), and dopaminergic neuron types can write
or reduce a memory depending on timing (Aso & Rubin 2016). The constants
are ours.

### 3. Threat discrimination (limitation B)

`threat.py` and [`threat-v783.json`](../fly-neural/experiments/threat-v783.json).
A held research subject (a tethered preparation: its escapes are recorded,
its body kept perched) watches a battery of approaching, receding,
stationary and lateral objects of different sizes, speeds, trajectories,
contrasts and distances. Ground truth comes from the battery's kinematics,
never from what a readout sees: a threat is an object whose surface comes
within 1 cm; a harmless one stays at least 5 cm away; the battery has
nothing in between. Scoring is by event: a decision is the first positive
sample after 0.5 s without one; a threat is hit by a decision between its
first visible sample and collision; every other decision is a false alarm.

- **The mapping.** v1 is the merged one (LPLC2 by size, LC4 by expansion,
  whether or not the object approaches). v2 is looming-selective: LPLC2 by
  a logistic in angular size, LC4 by expansion speed, both only while the
  object expands, scaled by contrast. In flies LPLC2 is an ultra-selective
  looming detector (Klapoetke et al. 2017); LC4 carries angular velocity
  and LPLC2 angular size to the GF (von Reyn et al. 2017; Ache et al.
  2019).
- **The readout.** `any` is the merged one (any GF spike). `integrated`
  is a leaky count of GF spikes with a threshold _k_, a time constant τ
  and 1 s of refractoriness after a decision. A single GF spike triggers a
  short-mode takeoff in the fly (von Reyn et al. 2014); the integration
  stands in for what the model leaves out between GF and motor output.
- **Comparators.** ECHO's own GF proxy (recorded from the held subject,
  untuned), and two threshold heuristics (angular size; time to collision)
  tuned on the development battery by the same objective.

The candidate is chosen on the development battery (recall ≥ 0.8, then F1,
then lead time), sealed, and then run once on a held-out battery with new
kinds of motion (accelerating, approach-then-stop, zigzag) and lower
contrast.

**Results.** On the development battery (30 stimuli, 12 threats, 95 s,
2 seeds; [sealed](benchmarks/fly-neural/adaptive/threat-v783-dev.json),
commit 5bf6d99) the rule chose `v2@35/int-k3-tau10` from 57 candidates:
the v2 mapping with a 35° size₅₀, integrating three GF spikes over 10 ms.
It then ran once on the held-out battery (34 stimuli, 16 threats, 120 s,
3 seeds; [sealed](benchmarks/fly-neural/adaptive/threat-v783-heldout.json),
commit 287f989):

| Readout                            | Dev recall | Dev false alarms/min | Dev F1 | Held-out recall | Held-out false alarms/min | Held-out F1 |
| ---------------------------------- | ---------- | -------------------- | ------ | --------------- | ------------------------- | ----------- |
| merged (v1 mapping, any GF spike)  | 1.00       | 11.4                 | 0.57   | 1.00            | 8.97                      | 0.64        |
| **selected** (v2@35, k 3, τ 10 ms) | 0.92       | 4.1                  | 0.75   | **0.625**       | **7.97**                  | **0.48**    |
| angular-size heuristic (10°)       | 1.00       | 6.3                  | 0.71   | 0.94            | 6.98                      | 0.67        |
| time-to-collision heuristic        | 0.92       | 2.5                  | 0.81   | 0.875           | 3.99                      | 0.74        |
| ECHO's GF proxy                    | 0.92       | 2.5                  | 0.81   | 0.75            | 5.98                      | 0.60        |

Held-out criteria: T0 passed (the merged readout still over-fires, 8.97
false alarms/min); **T1 failed** (false alarms fell 11%, not 80%); **T2
failed** (recall 0.625, under 0.75); T3 passed (median lead 72 ms); **T4
and T5 failed** (F1 under both heuristics' and ECHO's).

What carried over and what did not (escapes per presentation, 3 seeds):

- **Looming selectivity generalised.** The selected readout escaped from
  no receding (0/9) and no stationary object (0/9); the merged one from
  all of them (9/9 each).
- **Expanding but harmless objects were not told apart.** Zigzag 12/12,
  near miss 9/12, approach-then-stop 9/12: the v2 mapping encodes
  expansion, and anything that expands drives LPLC2 and LC4 whether or
  not it will arrive.
- **Misses came from conditions the development battery lacked.** 12 of
  the 18 missed presentations were at contrast 0.25 or 0.5 (8 of 9 plain
  approaches at 0.25, a contrast the development battery did not include;
  v2 scales its rates by contrast) and the other 6 were the fastest
  approaches (6 m/s, faster than any in development). Why k = 3 misses
  these was not tested; the readout was frozen before the held-out run.

So the selected readout cut false alarms on the development battery by
64% at a cost of one miss in twelve, but on new kinds of motion it is
worse than a time-to-collision threshold and than ECHO's own proxy.
**Limitation B is not solved.**

### 4. An experience-driven decision architecture (Phase 4)

`adaptive.py` turns the mushroom body into a forager's decision maker,
without privileged information and without a language model:

| Stage            | Here                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Sensation        | each site's odour, as its KC and PAM spike counts in a trial of the full model under the chosen code     |
| Prediction       | the readout MBONs' drive _m_ = Σ _w_·_E_ over the connectome's KC→readout synapses                       |
| Memory           | the synaptic state _V_ (rule v2) or weights _w_ (rule v1)                                                |
| Valuation        | value = 1 − _m_/*m*₀ (the fraction of the odour's naive drive learning removed)                          |
| Action selection | go to the best-valued site if its value exceeds ECHO's `approachThreshold` (0.3), else explore at random |
| Prediction error | reward minus what the synapses predict, through the rule's (1 − _V_) and _V_ terms                       |
| Learning         | rule v2 on a meal (dopamine) or a fruitless visit (none)                                                 |

The subject senses only the odours on offer and whether it tastes food. It
gets no site identity and no food position. ECHO's self-model is reused as
it is: Experiment C below is ECHO's own committed evaluation.

### 5. Persistence (Phase 7)

A research subject's whole state (synapses, random stream, visit count) is
written as a sealed checkpoint that names its subject, arm, seed and config
and the hash of the checkpoint before it. Restoring rebuilds the subject
from the checkpoint's text. The long-life experiment checkpoints and
restores every subject after each of 12 blocks and requires that it make
exactly the choices it makes uninterrupted, that the checkpoints chain by
hash, and that the state hold as many numbers after every block (bounded
memory).

### 6. Closed-loop neural control with a safety layer (Phase 8, limitation C)

`scripts/echo-closed-loop.ts` and `closedloop.py`. A research subject lives
30 s in a research world; before each 10 ms step the full model is run
over the next 10 ms on its sensable observation from the step before; its
GF decides escape and MN9 feeding while the subject is perched. The merged
`neural-experimental` mode had no protection: a missing readout meant the
fly never escaped. The safety layer:

- accepts a readout only if it answers the request sent (by id), for the
  sample asked about, with finite, non-negative, well-formed values;
- when a readout is missing, late (20 s wall time), malformed, stale or
  failed, or the neural layer proposes a command the body's gate would
  refuse, lets ECHO decide that sample and logs the fallback with its
  reason;
- stops the run and reports it aborted past 5% fallbacks (after 200
  samples) or on the server's fatal answer; it never quietly continues as
  ECHO;
- lets escape outrank feeding and commands only a perched body;
- runs the server under a wall-time, memory and stop-file budget; the
  server answers bad requests with errors and carries on.

A baseline subject behind the tap is byte-identical to an untapped one.
If a behaviour is commanded but not reliably produced by the body, it is
reported as _predicted_, not _controlled_.

**Results.** Three scenarios: looms (objects on collision courses),
passes (objects passing 0.6–0.9 m away or receding: every escape is a
false alarm) and food (a hungry subject in the yard with fruit). Three
arms: ECHO alone (baseline), the merged readouts (`neural-merged`) and the
threat readout selected on development stimuli (`neural-selected`).
Development used one seed
([sealed](benchmarks/fly-neural/adaptive/closed-loop-v783-dev.json),
commit 287f989). The held-out split used three seeds, run once
([sealed](benchmarks/fly-neural/adaptive/closed-loop-v783-heldout.json),
commit 169c3da):

| Held-out, 3 seeds                       | ECHO alone  | neural-merged   | neural-selected |
| --------------------------------------- | ----------- | --------------- | --------------- |
| Looms: escapable episodes escaped       | 3 of 18     | 7 of 7          | 6 of 10         |
| Passes: escapes (all false alarms)      | 0           | 9               | **0**           |
| Food: time feeding (of 30 s, per seed)  | 29.9–30.0 s | 7.7–8.9 s       | 7.7–8.9 s       |
| Food: feeding bouts (meals)             | 1–3         | 116–131         | 116–131         |
| Fallbacks to ECHO                       | —           | 1 of 3,000 each | 1 of 3,000 each |
| Wall time per 30 s run (one cloud vCPU) | 1 s         | 13–21 min       | 4–22 min        |

Criteria: **CL1 passed** (every neural run completed its 30 s); **CL2
passed** (one fallback in 3,000 samples per run, at t = 0 before the
first observation); **CL3 passed** (7 of 7 escape commands became
escapes); **CL4 passed** (368 of 368 feeding commands became feeding
bouts); **CL5 passed** (the selected readout escaped no harmless object;
the merged one escaped all nine); **CL6 failed** (the selected readout
escaped 6 of 10 escapable looms, under 75%).

- **Control, not only prediction.** Escape and feeding commands from the
  connectome model became behaviour, behind the safety layer, with no
  run stopped. This is the first time `neural-experimental` mode has run
  on the real connectome; before, a missing readout meant the fly never
  escaped.
- **Discrimination carried into closed loop, at a cost.** The selected
  readout ignored every harmless pass (merged: 9 escapes) but missed 4 of
  10 escapable looms. ECHO alone escaped fewer still: one loom per run,
  3 of the 18 that began while it was perched.
- **Neural feeding is fragmented.** MN9 crosses its threshold in short
  bursts, so a hungry subject on fruit fed in 116–131 bouts totalling
  about 8 s where ECHO alone fed for the whole 30 s; about 430 times per
  run ECHO wanted to feed and MN9 was below threshold, so the subject
  rested. Feeding is _controlled_, but worse.
- **Cost.** A neural run is 25–45 times slower than real time on one
  cloud vCPU (the selected readout's passes, with no escape, about 8
  times). This model cannot drive a live fly in real time.
- **Deviation.** The config's `limits_note` says one run at a time and no
  cloud. It was written before the owner authorized cloud CPU, and the
  runs went to Hugging Face Jobs as parallel units. Each run is a
  separate subject with its own seed; a test
  (`test_parallel_units_then_a_resumed_run_equal_one_process`) shows
  parallel units then a resumed judge equal one process. The config was
  not edited.

## Pre-registered experiments

Every experiment was written down before it ran: grid or arms, seeds,
odours or stimuli, selection rules and criteria. Development runs could
repeat while code changed; held-out runs ran once from a clean commit and
are reported whatever they show. No criterion was changed after a result
was seen, and no result file was edited.

| Config                                                                                       | Question                                                                                                         | Held-out                                  |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`mb-representation-v783.json`](../fly-neural/experiments/mb-representation-v783.json)       | Which threshold/APL change makes the KC code sparse                                                              | development odours only (a selection)     |
| [`mb-representation-al-v783.json`](../fly-neural/experiments/mb-representation-al-v783.json) | Does weakening excitatory ALLN synapses make it distinct                                                         | development odours only (a selection)     |
| [`plasticity-v2-v783.json`](../fly-neural/experiments/plasticity-v2-v783.json)               | Does rule v2 on the sparse code learn odour-specifically, keep, extinguish, reverse, and which mechanism does it | two held-out odour pairs, 8 subjects each |
| [`threat-v783.json`](../fly-neural/experiments/threat-v783.json)                             | Can the GF tell threats from harmless motion                                                                     | held-out battery, 3 seeds                 |
| [`adaptive-life-v783.json`](../fly-neural/experiments/adaptive-life-v783.json)               | Does a forager driven by it adapt when food moves, rewards reverse and memories must last                        | held-out odour sets, 30 subjects          |
| [`closed-loop-v783.json`](../fly-neural/experiments/closed-loop-v783.json)                   | Can the GF and MN9 control a research subject safely in closed loop                                              | 3 held-out seeds                          |

## Results

### Odour-specific learning (plasticity-v2)

[`plasticity-v2-v783.json`](../fly-neural/experiments/plasticity-v2-v783.json),
held-out result [sealed](benchmarks/fly-neural/adaptive/plasticity-v2-v783-heldout.json)
(commit b6ac7e1, 152 subjects; how it ran is under [Cloud runs](#cloud-runs)).
Each subject is the full model with one arm's code and rule, on this
schedule: a pretest of odours A, B and Asim (two of A's three glomeruli);
acquisition, 8 × (A rewarded, B not); a test; a distractor odour C,
unrewarded, 4 times; a test; extinction, A unrewarded 6 times; a test;
reversal, 8 × (B rewarded, A not); a final test. Reward is PAM drive at
100 Hz; a response is the readout MBONs' spikes. The two held-out pairs
(H1, H2) use glomeruli no development odour used; 8 subjects per arm and
pair. The acquisition index `li_acq` is A's relative change minus B's:
negative when the paired odour's response fell more, which is learning.

| Arm                 | What differs from v2                               | H1 `li_acq` (subjects negative) | H2 `li_acq` (subjects negative) |
| ------------------- | -------------------------------------------------- | ------------------------------- | ------------------------------- |
| v2                  | —                                                  | +0.042 (3 of 8)                 | **−0.173 (8 of 8)**             |
| v2-reward-shuffled  | rewards given to random trials                     | +0.129 (0 of 8)                 | −0.143 (8 of 8)                 |
| v1-sparse           | the merged rule v1                                 | +0.068 (0 of 8)                 | −0.121 (8 of 8)                 |
| v2-dan-silenced     | no dopamine                                        | −0.033 (5 of 8)                 | −0.005 (5 of 8)                 |
| fixed               | no plasticity                                      | −0.014 (5 of 8)                 | −0.028 (5 of 8)                 |
| v1-dense            | rule v1 on the dense code (the existing mechanism) | +0.002 (2 of 8)                 | −0.001 (5 of 8)                 |
| v2-dense            | the dense code                                     | +0.001 (2 of 8)                 | +0.002 (4 of 8)                 |
| v2-thr-only         | sparse by the KC threshold alone                   | −0.017 (4 of 8)                 | not run                         |
| v2-no-threshold     | every PAM spike counts as reward                   | +0.070 (1 of 8)                 | not run                         |
| v2-pnkc-shuffled    | PN→KC targets permuted                             | +0.037 (4 of 8)                 | not run                         |
| v2-trace / no trace | 200 ms between odour and reward                    | +0.101 / +0.025 (2, 3 of 8)     | not run                         |

Under v2, A's response fell by 0.44 (H1) and 0.58 (H2) and B's by 0.48 and
0.41; under v1 on the dense code both fell by 0.78 on both pairs. On H1,
after the distractor the index was −0.142 (7 of 8 negative); 6 unrewarded
A trials restored A by +0.43 (8 of 8; v1 on the sparse code −0.02); after
reversal B's response was below A's in every subject (+0.16).

Criteria (held-out; 22 judged, **10 pass**): **L0 passed** on both pairs
(every odour reaches the readout before training). **L1 failed** on H1
(3 of 8 subjects negative) and **passed** on H2 (8 of 8, mean −0.173).
**L2 failed** on both (against fixed weights: H1 p = 0.87; H2 p = 0.016,
over the registered 0.01). **L3 failed** on H1 and **passed** on H2
(silencing the DANs removes it, p = 0.009). **L4 failed** on both
(shuffled rewards: H1 +0.129 against +0.042; H2 −0.143 against −0.173,
p = 0.52). **L5 failed** on H1 and **passed** on H2 (more specific than v1
on the dense code, p < 0.001). **L6 passed** on both (B falls less than
under v1 on the dense code). **L7 failed** (7 of 8 negative after the
distractor). **L8 passed** and **L9 passed** (extinction restores A in
every subject, and more than under v1, which can only depress). **L10
passed** (reversal in every subject). **L11–L14 failed** (the eligibility
trace, the dopamine threshold, the sparse code and the antennal-lobe
change: none makes v2 measurably more specific; p = 0.36–0.92).

What this shows:

- **Rule v2 does not learn which odour was rewarded.** On H1 there is
  nothing beyond noise. On H2 the paired odour's response falls more in
  every subject and needs dopamine, but giving the rewards to random
  trials of the same phase leaves nearly all of it (L4), and the merged
  rule v1 on the same code gives most of it too. Whichever odour is
  rewarded, one odour of each pair is depressed more: B on the
  development pair and on H1, A on H2. Why was not investigated.
  Limitation A remains.
- **What v2 adds is extinction and less depression.** Unrewarded
  re-exposure restores a depressed response (L8, L9), which v1 cannot
  do. L6 passes because v2 depresses both odours less than v1 does, not
  because it spares B selectively. L10 had no shuffled control; on H1 the
  shuffled-reward arm and v1 on the sparse code also end reversal with B
  below A (+0.08, +0.09), so part of it is the same odour asymmetry.
- **No mechanism is shown to matter for specificity.** With no
  specificity to change, the trace, the threshold, the sparse code and the
  antennal-lobe change all fail (L11–L14).
- **Development pointed the same way.** On the development pair (3
  subjects per arm) every plastic arm on the sparse code depressed B more
  than A (v2 +0.097, 3 of 3 positive). The held-out split was run as
  registered, and no criterion was changed.

### Adaptive life (Experiments A, C, D, E)

The forager of section 4 in four tasks. **A**: four sites, food at one for
40 visits, then at another for 60; the measure is the visits it takes to
reach criterion at the new site. **D**: two sites, the food alternating
between them every 30 visits, three reversals. **E**: food at one of four
sites for 40 visits, then 100 visits in another context, then back to the
first four sites with no food; the measure is the share of the first 5
probe visits that go to the trained site. The long-life run is 12 blocks
of 50 visits, the food moving each block, with a checkpoint and restore
after every block. Odour codes come from the full model once per odour (`adaptive
codes`); choice and learning then use the connectome's KC→readout synapses
directly, so a subject's life takes seconds. Development: 10 subjects per
arm ([sealed](benchmarks/fly-neural/adaptive/adaptive-life-v783-dev.json),
commit 53f4ff1). Held-out: 30 subjects per arm on new odour sets, run once
([sealed](benchmarks/fly-neural/adaptive/adaptive-life-v783-heldout.json),
commit 169c3da). The odour codes rebuilt for it hash the same as
development's.

| Held-out, 30 subjects per arm      | A: visits to relocate | A: meals per visit | D: visits per reversal (reversals reached of 3) | E: probe visits to the trained site |
| ---------------------------------- | --------------------- | ------------------ | ----------------------------------------------- | ----------------------------------- |
| **full** (rule v2, sparse code)    | **4.5**               | **0.91**           | **2.5 (3)**                                     | **0.71**                            |
| fixed weights (no learning)        | never                 | 0.25               | 22.3 (1.0)                                      | 0.22                                |
| v2, dopamine silenced              | never                 | 0.25               | 22.3 (1.0)                                      | 0.22                                |
| v2, dopamine uncoupled from meals  | 45.7                  | 0.39               | 16.3 (1.6)                                      | 0.67                                |
| v1 on the dense code (merged)      | 40 ¹                  | 0.28               | 13.7 (1.6)                                      | 0.22                                |
| v1 on the sparse code              | never                 | 0.38               | 20.0 (1.0)                                      | 1.00 ²                              |
| v2 on the dense code               | 5.2                   | 0.90               | 2.5 (3)                                         | 0.61                                |
| v2 on the threshold-only code      | 4.1                   | 0.92               | 2.0 (3)                                         | 0.61                                |
| v2 on a random code                | 4.7                   | 0.91               | 3.0 (3)                                         | 0.85                                |
| v2 without the dopamine threshold  | 8.4                   | 0.88               | 4.7 (3)                                         | 0.77                                |
| ECHO's mushroom body (rate model)  | 2.2                   | 0.93               | 1.2 (3)                                         | 0.60                                |
| bookkeeping heuristic (no neurons) | 1.2                   | 0.94               | 0 (3)                                           | 0.25                                |
| random forager                     | 58.6                  | 0.27               | 22.9 (1.0)                                      | 0.19                                |

¹ 10 of 30 subjects met the criterion at once and 20 never did. ² v1 can
only depress, so it never leaves the first site it learned (20
perseverative visits of 20); its "retention" is perseveration. A subject
that never learned makes 0.19 of its probe visits to the trained site.

Criteria (held-out): **A1 passed** (full relocates sooner than fixed
weights, p < 10⁻¹²); **A2 failed** (sooner than v1 on the dense code:
p = 0.012, over the registered 0.01, because of v1's ten instant
relocations); **A3 passed** (more meals per visit than v1); **D1 passed**
(reverses faster than v1 on the same code); **D2 passed** (every full
subject reached criterion after all three reversals); **E1 passed** and
**E2 passed** (0.71 of probe visits after 100 visits elsewhere, against
0.19 for a subject that never learned); **M1 passed** (silencing dopamine
removes the gain); **M2 passed** (dopamine uncoupled from meals removes
most of it); **M3 failed** (v2 on the dense code relearns no measurably
more slowly: 5.2 against 4.5, p = 0.075); **M4 failed** (v2 on the
threshold-only code: 4.1 against 4.5); **P1 passed** and **P2 passed**
(every full and every ECHO-mushroom-body subject restored from its
checkpoint after each of 12 blocks made exactly its uninterrupted
choices, the checkpoints chained by hash, and the state held 63,624 and
4,001 numbers throughout); **P3 passed** (no degradation: 3.5 visits per
relocation in the first four blocks, 3.9 in the last four).

What this shows:

- **Learning from experience makes the forager adaptive, and the gain is
  traced to the rule's dopamine.** Silencing the PAM dopamine abolishes
  it; uncoupling dopamine from meals removes most of it. Extinction is
  what makes reversal possible: rule v1, which can only depress, reaches
  one reversal of three.
- **The representation is not what matters here.** The sparse code and
  the antennal-lobe change, the work of section 1, make no measurable
  difference: v2 does as well on the dense, threshold-only or random code.
  How v2 tells sites apart on the dense code (where the two development
  odours share 98.7% of their KCs) was not investigated.
- **It is not better than what ECHO already has.** ECHO's own mushroom
  body, a rate model (Bennett, Philippides & Nowotny 2021), relocates and
  reverses about twice as fast; a bookkeeping heuristic with no neurons
  is faster still. The connectome forager keeps a trained site better
  after interference than either (0.71 against 0.60 and 0.25).
- **Experiment B (habituation) was not run.** The model has no
  habituation mechanism in the GF pathway (see below).
- **Experiment C** is ECHO's own committed self-model evaluation
  (`scripts/echo-evaluate.ts --check`), rerun unchanged on this branch:
  its [report](benchmarks/fly-echo/README.md) and `report.json`
  reproduce byte for byte (24 seeds per condition, 287 s). Nothing in it
  uses the connectome; it is the comparison point for what ECHO's
  self-model already does.

## Biology and what is assumed

| Element                                           | Basis                                                                                                                             | Status                                                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Synapse weights, neuron model                     | Shiu et al. 2024: one weight per synapse (0.275 mV × count × sign), shared threshold, reset = rest                                | the model, unchanged except as below                                                                                 |
| KC threshold × 2                                  | KCs need co-active claws (Gruntman & Turner 2013)                                                                                 | factor chosen by a pre-registered sweep                                                                              |
| Excitatory ALLN chemical synapses × 0.5           | lateral excitation between glomeruli exists (Olsen et al. 2007) but is mainly electrical (Yaksi & Wilson 2010; Huang et al. 2010) | a correction for a missing mechanism; factor chosen by sweep; exploratory diagnosis on development odours            |
| Rule v2 (three-factor, synapse-specific, bounded) | Hige et al. 2015; Cohn et al. 2015; Handler et al. 2019; Aso & Rubin 2016                                                         | form ours; constants ours (η_dep 0.5, η_ext 0.3, floor 0.2, τₑ 1 s, E saturating at 3 spikes, 50 ms dopamine window) |
| Extinction as one bounded state                   | omission forms a parallel opposing memory (Felsenberg et al. 2017, 2018)                                                          | simplification                                                                                                       |
| Dopamine threshold θ                              | —                                                                                                                                 | calibrated on development data before any learning run                                                               |
| v2 looming mapping                                | Klapoetke et al. 2017; von Reyn et al. 2017; Ache et al. 2019                                                                     | functional form and constants ours (rates 200 Hz, size₅₀ from {20°, 35°}, width 5°)                                  |
| Integrated GF readout                             | a single GF spike suffices in the fly (von Reyn et al. 2014)                                                                      | a stand-in for the missing descending and motor circuitry; _k_ and τ chosen on development stimuli                   |
| Habituation                                       | the GF pathway habituates in flies (Engel & Wu 1996)                                                                              | not implemented in the model (Experiment B not run)                                                                  |
| Approach threshold 0.3                            | ECHO's `approachThreshold`                                                                                                        | reused, not tuned                                                                                                    |

The model still has no neuromodulation beyond the rule, no gap junctions,
no morphology and no ventral nerve cord. The sparse code is a property of
this model with two corrections, not a measurement of the fly.

## Negative and inconclusive findings

Every one of these is kept in its sealed result file.

- **Sparse is not distinct.** The KC code became sparse (4.3–4.7%), but
  two unrelated odours still share most of their KCs (Jaccard 0.637), and
  their PN populations overlap at 0.94. In this model odour identity is
  mostly lost in the antennal lobe, upstream of the mushroom body.
- **The KC–KC hypothesis is refuted.** Muting KC→KC synapses barely
  changes the overlap (0.987 to 0.977).
- **Odour-specific learning is not established.** Rule v2 on the sparse
  code fails 12 of 22 held-out criteria: it does not learn on pair H1,
  and on pair H2 its effect survives shuffling which odour was rewarded
  (L4 fails on both pairs). Limitation A remains.
- **None of the mechanisms built for specificity is shown to matter.**
  The eligibility trace, the dopamine threshold, the sparse code and the
  antennal-lobe change all fail their held-out tests (L11–L14), and
  neither the code nor the antennal-lobe change makes a difference to the
  forager (M3, M4).
- **Threat discrimination does not generalise.** The selected readout
  fails four of six held-out criteria (T1, T2, T4, T5): it misses
  low-contrast and very fast approaches and still escapes from objects
  that expand without arriving. A time-to-collision threshold and ECHO's
  own proxy both do better.
- **The representation does not matter for foraging.** M3 and M4 fail:
  rule v2 adapts as well on the dense, threshold-only or random code as on
  the sparse one. A2 fails narrowly (p = 0.012) against v1 on the dense
  code.
- **ECHO already adapts faster.** ECHO's own mushroom body relocates and
  reverses about twice as fast as the connectome forager, and a
  bookkeeping heuristic faster still. The connectome forager is better
  only at keeping a trained site after interference.
- **Closed-loop escape misses threats and feeding is worse.** CL6 fails
  (6 of 10 escapable looms). Under MN9 control a hungry subject feeds for
  about 8 s of 30 instead of 30.
- **Experiment B (habituation) was not run**: the model has no habituation
  mechanism.
- **Two held-out runs were launched twice.** The first launches of the
  adaptive-life and closed-loop held-out splits were cancelled by the
  cloud provider when the prepaid credit ran out, before either produced
  any result: one was still building odour codes, the other had not
  started. Nothing from them was seen. Each was then run once, from a
  clean commit, and that run is the one reported. The plasticity-v2
  development split was cancelled at the same moment and resumed from its
  saved progress, which the resume check accepts only into the identical
  run.
- **The plasticity-v2 held-out split did not run as planned.** Its job
  could not finish inside its 5-hour limit, so it was cancelled after
  saving the first 64 subjects and the other 88 ran as separate jobs from
  the same commit (see Cloud runs). Each subject's indices were visible
  in the progress logs while it ran; nothing in the config, the criteria
  or the code was changed.
- **A config note did not hold.** `closed-loop-v783.json` says one run at
  a time and no cloud; its runs went to the cloud in parallel (see the
  closed-loop results).

## Resources and safety

- One CPU thread per process; NumPy/SciPy only; no GPU path is provided
  or claimed. On the 8-core ARM64 laptop a 500 ms trial of the full model
  takes about 10–13 s and a process peaks at about 650 MB. Running four
  long processes there at once exhausted its memory and all four were
  killed, so the long splits were moved to cloud CPU machines (below),
  with the owner's explicit authorization; nothing in the repository
  launches a cloud job or spends anything. One plasticity subject on the
  standard schedule took 21–92 min on cloud vCPUs, depending mostly on
  how many shared a machine (median 35 min with four on 8 vCPUs, 76 min
  with five or six on 8 vCPUs, 78 min with 32 on 32). Long splits
  run as parallel workers (`selective --only`, `threat --replay`,
  `closedloop --unit`) and are merged or judged by a final process only
  when every worker's identity (config, calibration, commit, cleanliness,
  source digest, connectome arrays) matches.
- Every run records its commit, whether the tree was clean, the package's
  source digest, the connectome's manifest hash, wall and CPU time and
  peak memory, and is sealed (canonical-JSON SHA-256). Long runs write
  progress after every unit and resume only into the identical run.
- Budgets: wall time, resident memory and a stop file
  (`fly_neural.resources.Budget`); the closed-loop server and runs have
  per-request and per-run timeouts.
- Seeds are fixed in each config; configs are versioned by schema and
  hashed into every result.
- FlyWire-derived data (the connectome, cached odour codes, traces) stay
  under `.fly-neural/` and the data directory, never committed; committed
  results hold aggregates only and are CC BY-NC like the rest of
  `docs/benchmarks/fly-neural/`. The Apache-licensed code and the
  externally licensed data stay separate.

## Cloud runs

The long splits ran on Hugging Face Jobs CPU machines (`cpu-upgrade`,
8 vCPU; `cpu-xl`, 16 vCPU; `cpu-performance`, 32 vCPU), x86_64 Linux,
Python 3.11, the same NumPy integrator, for about 30 machine-hours and
about $10 in all at the listed hourly prices. Before any result was taken from one, a pilot checked it: the
cloud import of v783 produced the same eleven arrays as the laptop's
(arrays digest `012d8a5c…` on both), and the plasticity-v2 calibration
run there matched the committed laptop calibration in every value
(θ = 50.11198208286674 Hz on both), in 109 s against 183 s. Eight
calibrations at once took 195 s, so a machine should have a core per
worker.

A job runs `fly-neural/cloud/hf_job.py` with a plan from
`fly-neural/cloud/plans/`. It refuses any checkout but the named, clean
commit; fetches the pinned sources under the terms its launcher names;
fetches recorded inputs (the threat recordings) and refuses them unless
their SHA-256 matches; and uploads only progress, replay traces, logs and
sealed results, to a private dataset repository. Every plan's commands
are parsed with the real CLI by `tests/test_cloud_plans.py`.

```sh
# from the repository root, with the hf CLI logged in; costs money
c=$(git rev-parse HEAD)   # pushed, clean
hf jobs run --detach --flavor cpu-xl --timeout 4h --secrets HF_TOKEN \
  -e RESULTS_REPO=<you>/<private-dataset> \
  -e FLY_NEURAL_ACCEPT=flywire-cc-by-nc-4.0,flywire-annotations-cite,shiu-mit-code-flywire-data \
  python:3.11 bash -c "git clone -q --depth 30 --branch <branch> https://github.com/topherchris420/lop-nur-twin /work/repo \
    && cd /work/repo && git checkout -q --detach $c \
    && python fly-neural/cloud/hf_job.py --commit $c --plan fly-neural/cloud/plans/plasticity-v2-dev.json"
```

**How the plasticity-v2 held-out split ran.** All of it ran from commit
b6ac7e1. The planned job (`plasticity-v2-heldout.json`, 32 shards on one
32-vCPU machine) took about 78 min a subject and could not finish 152
subjects inside its 5-hour limit, so it was cancelled once the first two
rounds, the first 64 subjects in run order, were saved. Eighteen 8-vCPU
jobs ran the other 88, one subject per shard (`--shard k/152`). Their
plans, as launched, are in
[`plans/plasticity-v2-heldout-parts/`](../fly-neural/cloud/plans/plasticity-v2-heldout-parts/),
and `test_cloud_plans.py` checks that they and the first job cover every
subject. A subject's seeds depend only on its pair, arm and number, so
where it ran does not change it. As a check, subject H1/v2/7 ran on both
machine types: every value in its result matched except the wall-clock
statistics. The merge compares whole results, timing included, so it
would have refused the second copy, and that file was left out of the
judge's inputs by hand. A judge job (`plasticity-v2-heldout-judge.json`;
its description, written before the second batch of parts, says 57 part
files where there were 88) merged the 152 subjects in 15 s, computing
none of them again, and judged them.

## Reproducing

```sh
cd fly-neural
python -m fly_neural reproduce                                   # Phase 1
python -m fly_neural mbcode mb-representation-v783.json          # KC threshold/APL sweep
python -m fly_neural mbcode mb-representation-al-v783.json       # antennal-lobe sweep
python -m fly_neural selective calibrate                         # theta, before any learning run
python -m fly_neural selective run --split dev --echo-mb ../docs/benchmarks/fly-neural/adaptive/echo-mb-v2-dev.json
python -m fly_neural threat run --split dev                      # then: threat battery/record for heldout, threat run --split heldout
python -m fly_neural adaptive codes && python -m fly_neural adaptive run --split dev
python -m fly_neural closedloop run --split dev
cd .. && node scripts/run-ts.mjs scripts/echo-neural-plasticity.ts --schedule v2 --subjects 8 --seed 4200001 --out docs/benchmarks/fly-neural/adaptive/echo-mb-v2-dev.json
node scripts/run-ts.mjs scripts/echo-evaluate.ts --check         # Experiment C: ECHO's self-model evaluation
```

Held-out runs: the same with `--split heldout`, once, from a clean commit.

## Limits

- **A model, not the fly.** Shiu et al.'s two-sign leaky
  integrate-and-fire model with two corrections and a rule whose form and
  constants are ours. No neuromodulation beyond the rule, no gap
  junctions, no morphology, no ventral nerve cord, no descending or motor
  circuitry past the GF and MN9.
- **Small samples.** 8 subjects per arm per held-out odour pair; a
  34-stimulus held-out battery; 3 closed-loop seeds of 30 s each.
- **A reduced forager.** In the adaptive-life tasks the odour codes come
  from the full model, but choice and learning use a linear readout of the
  connectome's KC→readout synapses, in abstract sites with no flight.
- **Not real time.** The full model runs 25–45 times slower than real
  time on one cloud vCPU. It cannot drive a live organism as it is; only a
  reduced module extracted from mechanisms that pass held-out tests
  could.
- **Little to learn from in the live world.** The deployed fly's backup
  archive of 2026-10-30 (checkpoints 421–1018, about 50 hours, read only)
  holds 2 associative-update events, both meals at one street tree. A
  better rule would change little there without more learning events.
- **Comparators.** ECHO's own modules, simple heuristics and lesioned
  versions of the same model. No comparison with recorded fly behaviour.
- **Research subjects only.** Nothing here ran on, or was tested on, the
  deployed fly. Moving any of it there needs separate explicit
  authorization.

## References

- Ache JM, Polsky J, Alghailani S, et al. (2019) Neural basis for looming size and velocity encoding in the _Drosophila_ giant fiber escape pathway. _Curr Biol_ 29:1073–1081. doi:10.1016/j.cub.2019.01.079
- Aso Y, Rubin GM (2016) Dopaminergic neurons write and update memories with cell-type-specific rules. _eLife_ 5:e16135. doi:10.7554/eLife.16135
- Bennett JEM, Philippides A, Nowotny T (2021) Learning with reinforcement prediction errors in a model of the _Drosophila_ mushroom body. _Nat Commun_ 12:2569. doi:10.1038/s41467-021-22592-4
- Cohn R, Morantte I, Ruta V (2015) Coordinated and compartmentalized neuromodulation shapes sensory processing in _Drosophila_. _Cell_ 163:1742–1755. doi:10.1016/j.cell.2015.11.019
- Engel JE, Wu CF (1996) Altered habituation of an identified escape circuit in _Drosophila_ memory mutants. _J Neurosci_ 16:3486–3499. doi:10.1523/JNEUROSCI.16-10-03486.1996
- Felsenberg J, Barnstedt O, Cognigni P, et al. (2017) Re-evaluation of learned information in _Drosophila_. _Nature_ 544:240–244. doi:10.1038/nature21716
- Felsenberg J, Jacob PF, Walker T, et al. (2018) Integration of parallel opposing memories underlies memory extinction. _Cell_ 175:709–722. doi:10.1016/j.cell.2018.08.021
- Gruntman E, Turner GC (2013) Integration of the olfactory code across dendritic claws of single mushroom body neurons. _Nat Neurosci_ 16:1821–1829. doi:10.1038/nn.3547
- Handler A, Graham TGW, Cohn R, et al. (2019) Distinct dopamine receptor pathways underlie the temporal sensitivity of associative learning. _Cell_ 178:60–75. doi:10.1016/j.cell.2019.05.040
- Hige T, Aso Y, Modi MN, et al. (2015) Heterosynaptic plasticity underlies aversive olfactory learning in _Drosophila_. _Neuron_ 88:985–998. doi:10.1016/j.neuron.2015.11.003
- Honegger KS, Campbell RAA, Turner GC (2011) Cellular-resolution population imaging reveals robust sparse coding in the _Drosophila_ mushroom body. _J Neurosci_ 31:11772–11785. doi:10.1523/JNEUROSCI.1099-11.2011
- Huang J, Zhang W, Qiao W, Hu A, Wang Z (2010) Functional connectivity and selective odor responses of excitatory local interneurons in _Drosophila_ antennal lobe. _Neuron_ 67:1021–1033. doi:10.1016/j.neuron.2010.08.025
- Klapoetke NC, Nern A, Peek MY, et al. (2017) Ultra-selective looming detection from radial motion opponency. _Nature_ 551:237–241. doi:10.1038/nature24626
- Lin AC, Bygrave AM, de Calignon A, et al. (2014) Sparse, decorrelated odor coding in the mushroom body enhances learned odor discrimination. _Nat Neurosci_ 17:559–568. doi:10.1038/nn.3660
- Olsen SR, Bhandawat V, Wilson RI (2007) Excitatory interactions between olfactory processing channels in the _Drosophila_ antennal lobe. _Neuron_ 54:89–103. doi:10.1016/j.neuron.2007.03.010
- Shiu PK, Sterne GR, Spiller N, et al. (2024) A _Drosophila_ computational brain model reveals sensorimotor processing. _Nature_ 634:210–219. doi:10.1038/s41586-024-07763-9
- von Reyn CR, Breads P, Peek MY, et al. (2014) A spike-timing mechanism for action selection. _Nat Neurosci_ 17:962–970. doi:10.1038/nn.3741
- von Reyn CR, Nern A, Williamson WR, et al. (2017) Feature integration drives probabilistic behavior in the _Drosophila_ escape response. _Neuron_ 94:1190–1204. doi:10.1016/j.neuron.2017.05.036
- Yaksi E, Wilson RI (2010) Electrical coupling between olfactory glomeruli. _Neuron_ 67:1034–1047. doi:10.1016/j.neuron.2010.08.041
