# ECHO Connectome: Computational Neural Research on FlyWire v783

This is a research backend, `fly-neural/`, that runs a spiking model of the
whole adult _Drosophila_ central brain on FlyWire's public connectome. It
reproduces published experiments with that model and replays what a
_research_ fly in this repository senses through it, beside ECHO. It is
separate from the deployed fly: it never reads, writes, controls or
continues the original organism.

**Short version.** The FlyWire v783 connectome is imported, checked and
compiled: 139,255 neurons, 15,091,983 connected pairs, 54,492,922 synapses.
Shiu et al.'s leaky integrate-and-fire model runs on all of it, and the
integrator matches Brian 2 running the authors' own code spike for spike on
synthetic networks. On the full brain it also agrees with Brian 2
statistically.

- **Shiu et al. 2024 reproduction:** 10 of 12 pre-registered criteria pass,
  on development and held-out seeds alike.
- **Two failures, reported as failures:**
  - water input drives the proboscis motor neuron MN9 to 30 Hz, short of
    the paper's 40;
  - our sign-permutation control sets off runaway excitation instead of
    silencing MN9.
- **ECHO Neural Shadow:** the replays of three research flies give a null
  (wind), partial agreement limited by the readout's window (food), and a
  negative (looms). In the looms replay the model's escape neuron fires
  194 times when ECHO does not escape.
- **Plasticity:** a dopamine-gated learning rule on the real mushroom-body
  circuit depresses synapses, but for both odours alike, so it does not
  learn the association. This holds on development and held-out seeds alike.

## Status at a glance

| Part                                            | Status                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full-brain **import**                           | **Done.** All of v783: 139,255 neurons, 15,091,983 pairs, 54,492,922 synapses. Checked, compiled, and identical to Shiu et al.'s table on every pair        |
| Full-brain **execution**                        | **Done**, on one CPU thread: 1.30 s per simulated second, 233 MB. It matches Brian 2 running the authors' code (MN9 62.1 vs 62.5 Hz; per-neuron r = 0.9998) |
| Sparse graph validation and scaling             | **Done.** The structure is revalidated and the hashes reverified on load. Synthetic graphs were run up to v783's size                                       |
| Shiu et al. 2024 reproduction                   | **10 of 12 criteria pass**, on dev and on held-out seeds. Water (S6) and our sign-shuffle control (C3) fail on both                                         |
| Ablations                                       | Weight shuffle, degree-preserving rewiring and a random graph each abolish MN9 activation. The sign shuffle instead causes runaway excitation               |
| Sensory mapping (sensable observations only)    | **Done**, with every rate constant ours                                                                                                                     |
| ECHO Neural Shadow: `baseline`, `neural-shadow` | **Run** on three research subjects. Wind: null. Food: partial (28%, limited by the readout window). Looms: negative (194 false alarms)                      |
| ECHO Neural Shadow: `neural-experimental`       | **Implemented and tested with a stand-in readout only.** Not run live with the connectome model                                                             |
| Plasticity comparison                           | **Negative.** The rule depresses synapses but not selectively, and P1–P3 fail on dev (and on held-out seeds)                                                |
| Benchmarks                                      | **Done**, on this laptop only. No GPU or cloud compute                                                                                                      |
| The original fly                                | **Untouched.** Nothing runs on, reads from or writes to it or its VM                                                                                        |

## What this is, and what it is not

- **It is** Shiu et al. 2024's model: every neuron a leaky integrate-and-fire
  unit with identical parameters, every synapse an instantaneous conductance
  kick whose size is the connectome's synapse count times one global weight,
  and its sign is the presynaptic neuron's predicted transmitter. The model
  has been shown to predict some sensorimotor pathways (Shiu et al. 2024).
- **It is not** the fly's nervous system. It has no neuromodulation, gap
  junctions, dendritic morphology, short-term plasticity, glia or ventral
  nerve cord, and two signs where real synapses have many kinds. A
  correlation between its readouts and ECHO's behaviour is a statement about
  two models.
- **Nothing here concerns awareness or experience.** The words used are
  functional: a population fires, a readout crosses a threshold.

## The original fly

The deployed organism (individual `04f8c797…`, served from the Oracle VM)
was not touched. This work:

- adds no code to `src/` or `deploy/`. Tests in Python
  (`fly-neural/tests/test_isolation.py`) and TypeScript
  (`scripts/echo-neural-shadow.test.ts`) check that nothing there mentions
  or imports the backend.
- never opens the production store, a checkpoint, a backup or a
  continuation. The recorder (`scripts/echo-neural-shadow.ts`) builds a new
  research subject from a seed in a research world. It imports none of the
  store, checkpoint, continuation or life modules (an allowlist test). It
  rejects `--store`, `--checkpoint`, `--backup`, `--life` and
  `--individual`, and refuses to run on a host that has the production
  directories.
- labels every recording `research-<scenario>-<seed>`. The Python side
  refuses any recording that names another subject, a production path or
  host, or the deployed individual's id.
- ran nothing on the VM. The only contact with it was reading its public
  witness, `GET https://129-213-139-78.sslip.io/v1/now`, to report its
  status: live at 2026-10-30T22:23:56Z, the same individual
  `04f8c797…` in epoch 11, under the ECHO controller (digital-fly/8,
  echo-self-model/v3). It was at tick 3,737,852, checkpoint 1,252, with
  139 meals and 2 escapes. At 15:47:40Z it had been at tick 3,500,103,
  checkpoint 1,172, with 134 meals: still running, and the same
  individual.

## Data and provenance

Nothing below is committed. `python -m fly_neural acquire` fetches each file
into `$FLY_NEURAL_DATA` (default `~/.cache/fly-neural`), but only once the
user accepts its terms by name. It resumes interrupted downloads and checks
every file against the size and SHA-256 pinned in `fly-neural/fly_neural/sources.py`.

| Input                                                                                                        | Pinned                                                       | Terms                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| FlyWire FAFB public release v783: `proofread_root_ids_783.npy`, `proofread_connections_783.feather` (852 MB) | Zenodo record 10676866; SHA-256 per file                     | Zenodo lists CC BY 4.0; [flywire.ai/guidelines](https://flywire.ai/guidelines) states CC BY-NC 4.0. The stricter is treated as binding. |
| FlyWire annotations v3.2.0 (`Supplemental_file1_neuron_annotations.tsv`)                                     | flyconnectome/flywire_annotations at the v3.2.0 tag; SHA-256 | No licence file; its README asks for citations (below). Read from the cache only.                                                       |
| Shiu et al.'s `Completeness_783.csv`, `Connectivity_783.parquet`, `model.py`, `utils.py`                     | philshiu/Drosophila_brain_model commit 91bdd1e; SHA-256      | Code MIT; the tables are derived from FlyWire data. Used only to cross-check the import and as the Brian 2 reference; never copied.     |

The results in `docs/benchmarks/fly-neural/` are model outputs derived from
FlyWire data. They carry FlyWire's terms, not this repository's Apache
License ([LICENSE.md](benchmarks/fly-neural/LICENSE.md)), and the attribution
is in [NOTICE](../NOTICE).

## Import: the whole release, checked

`python -m fly_neural import` streams the 852 MB connection table in
chunks of 2 million rows into a compressed sparse row (CSR) matrix. The
matrix stores every connected pair once, with synapses summed over
neuropils. Neurons are indexed in ascending root-id order, so indices are
stable for a release. The manifest records every input's hash, every
check's count, and the import's own time and memory. All of the following
were measured on v783:

| Check                                            | v783                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Neurons (proofread root ids)                     | 139,255; 0 duplicates; 0 non-positive                                |
| Rows (pair × neuropil)                           | 16,847,997; 0 duplicate keys; 0 nulls; 0 non-positive counts         |
| Rows naming an id outside the root-id list       | 0 presynaptic, 0 postsynaptic (no synapses dropped)                  |
| Connected pairs / synapses                       | **15,091,983 / 54,492,922**; 0 autapses; largest pair 2,405 synapses |
| Neurons without outputs / inputs / either        | 1,250 / 2,165 / 616                                                  |
| Transmitter probabilities                        | none out of [0, 1]; rows sum to 1 within 2.6 × 10⁻⁷                  |
| Rows with no transmitter prediction              | 1,732 (30,806 synapses)                                              |
| Neurons called ACh / GABA / Glu / DA / 5-HT / OA | 90,836 / 19,029 / 24,840 / 868 / 2,206 / 226; 1,250 without outputs  |
| Neurons whose top transmitter is below 0.5       | 24,013                                                               |
| Import time / peak memory                        | 17 s / 1.4 GB                                                        |

**Signs.** GABA and glutamate inhibit; acetylcholine, dopamine, serotonin
and octopamine excite, as in Shiu et al. ("Neurons predicted to be
dopaminergic, octopaminergic or serotonergic are assigned to the excitatory
category"). The sign belongs to the presynaptic neuron, and three
policies decide it:

- **`shiu`** uses the sign in Shiu et al.'s `Connectivity_783`, which
  reproduces the published network (41,333 inhibitory neurons). Every
  reproduction uses it.
- **`synapse-weighted`**, the default, takes the argmax of each neuron's
  outgoing transmitter probabilities, weighted by synapse count (43,869
  inhibitory). It can be reproduced from the Zenodo files alone.
- **`annotation`** uses the annotation release's `top_nt`. It is
  implemented but was not compiled for these results.

The two agree on 132,125 of 138,005 neurons with outputs, and 14,912,121
of 15,091,983 pairs carry the same sign. The synapse-weighted call agrees
with the annotation table's transmitter on 129,812 of 137,993 neurons, and
on the sign on 136,294.

**Against Shiu et al.'s own table.** `python -m fly_neural crosscheck`
reloads a compiled connectome, revalidates its structure and recomputes the
hash of every array. It then compares the connectome pair by pair with Shiu
et al.'s `Connectivity_783.parquet`:

| Check                              | `shiu` policy                    | `synapse-weighted` policy |
| ---------------------------------- | -------------------------------- | ------------------------- |
| Their pairs found here             | 15,091,983 of 15,091,983         | the same                  |
| With the same synapse count        | 15,091,983                       | the same                  |
| With the same sign / signed weight | 15,091,983 / 15,091,983          | 14,912,121 / 14,912,121   |
| Synapses, theirs and here          | 54,492,922 and 54,492,922        | the same                  |
| Their neurons present here         | 138,639 of 138,639               | the same                  |
| Neurons here and not in theirs     | 616, all with no synapses at all | the same                  |

Records:
[`import-fafb-v783-shiu.json`](benchmarks/fly-neural/import-fafb-v783-shiu.json)
and
[`import-fafb-v783-synapse-weighted.json`](benchmarks/fly-neural/import-fafb-v783-synapse-weighted.json),
from the clean commit a206910. Each record also carries the input hashes
and every import check above.

## The model and how it was checked

`fly_neural/lif.py` is an independent implementation of the equations and
parameters the paper states, and every parameter carries its source in
`fly_neural/params.py`:

| Parameter                   | Value                          |
| --------------------------- | ------------------------------ |
| Resting and reset potential | −52 mV                         |
| Threshold                   | −45 mV                         |
| Membrane time constant      | 20 ms                          |
| Synaptic time constant      | 5 ms                           |
| Refractory period           | 2.2 ms                         |
| Synaptic delay              | 1.8 ms                         |
| Weight per synapse          | 0.275 mV                       |
| Poisson input weight        | 0.275 mV × 250 per input spike |
| Time step                   | 0.1 ms                         |

It integrates in the order Brian 2 does and, like Brian 2, discards a
conditional `(unless refractory)` write to a neuron in its refractory
period. That second rule was found by tracing membrane potentials against
Brian 2's when one test network disagreed; it is documented in `lif.py`.

**Spike for spike on synthetic networks.** `fly-neural/reference/shiu_brian2.py`
runs Shiu et al.'s unmodified `model.py` (verified by SHA-256 from the
cache) under Brian 2.9.0. Its spike trains on four synthetic networks (a
chain, a 60-neuron random net, strong inhibition, and refractory pile-up)
are the fixture `fly-neural/tests/data/brian2_conformance.json`. The test
`test_lif.py` requires the same spikes at the same steps from this engine.

**On the full brain, against Brian 2.** Spike-for-spike agreement cannot
carry over to the full brain, because the two simulators draw different
Poisson streams. The comparison is therefore statistical, with criteria
committed (`fly-neural/experiments/brian2-reference.json`, 88755bf) after
one probe trial and before any comparison was made. Both simulators ran
Shiu et al.'s sugar stimulus: their 21 published sugar GRN ids (20 present
in v783), at 100 Hz for 1 s, 30 trials each. Brian 2 ran their unmodified
`model.py` on their own `Connectivity_783`.

| Criterion                                            | This engine | Brian 2          | Result                                                       |
| ---------------------------------------------------- | ----------- | ---------------- | ------------------------------------------------------------ |
| R1: MN9 rate is the same                             | 62.1 Hz     | 62.5 Hz          | **pass**: difference −0.4 Hz (SE 1.2), Mann-Whitney p = 0.73 |
| R2: every neuron's mean rate agrees (r ≥ 0.95)       | —           | —                | **pass**: r = 0.9998 over 388 neurons                        |
| R3: the same neurons respond (≥ 1 Hz; Jaccard ≥ 0.8) | 323         | 324 (323 shared) | **pass**: Jaccard 0.997                                      |

[`brian2-reference.json`](benchmarks/fly-neural/brian2-reference.json),
from the clean commit 7d87e82. The Brian 2 run was stopped by the
session's memory guard after 26 trials, which it had already written. The
remaining seeds, 20026–20029, were run separately with the same arguments.
The comparison pools the four files only after checking that they share the
stimulus, `model.py` hash and population and that no seed repeats; each
file's hash is in the result. Under the same load, Brian 2 took 128 s per
simulated second, with the numpy code generator under x64 emulation (Brian
2 has no Windows ARM64 wheel), and this engine took 4.4 s.

## Reproducing Shiu et al. 2024 on v783

`fly-neural/experiments/shiu2024-v783.json` was committed (4d59084) before
any full run. It fixes 24 conditions, 30 one-second trials each (100 for
the weight shuffle), the readouts and the criteria. Each criterion quotes
the paper where the paper makes the claim, and is marked "ours" where it
does not. A neuron counts as activated, as in the paper, when it fires
above 0 Hz. The populations are the paper's published ids, resolved
against v783, with the missing ones listed. Dev seeds (1000003) were run
first; held-out seeds (7000001) ran once, from a clean commit.

**Results: 10 of 12 criteria pass, on both seed sets. S6 and C3 fail on
both.**

| Criterion                                                      | Source             | Dev seeds                              | Held-out seeds                        |
| -------------------------------------------------------------- | ------------------ | -------------------------------------- | ------------------------------------- |
| S1: sugar GRNs at 100 Hz activate MN9 in every simulation      | paper              | pass: 30 of 30 trials                  | pass: 30 of 30                        |
| S2: more neurons respond to stronger sugar input (×3 or more)  | paper; factor ours | pass: 18 → 422 responders              | pass: 24 → 425                        |
| S3: shuffled weights abolish MN9 activation (≤ 5 of 100)       | paper; bound ours  | pass: 0 of 100 brains                  | pass: 0 of 100                        |
| S4: bitter GRNs inhibit sugar-evoked MN9 firing                | paper              | pass: 0.03 vs 60.2 Hz, p = 8.3 × 10⁻¹³ | pass: 0.0 vs 62.7 Hz, p = 5.9 × 10⁻¹³ |
| S5: Ir94e GRNs inhibit sugar-evoked MN9 firing                 | paper              | pass: 2.3 vs 60.2 Hz, p = 1.3 × 10⁻¹¹  | pass: 2.3 vs 62.7 Hz, p = 1.3 × 10⁻¹¹ |
| S6: water GRNs drive MN9 to 40 Hz (at 200 Hz)                  | paper              | **fail: 30.3 Hz**                      | **fail: 30.3 Hz**                     |
| G1: JO-CE drive aBN1, JO-F do not (≤ a quarter)                | paper; bound ours  | pass: 68.0 vs 3.0 Hz                   | pass: 68.2 vs 3.2 Hz                  |
| G2: silencing the inhibitory interneurons lets JO-F drive aBN1 | paper              | pass: 29.2 vs 3.0 Hz                   | pass: 29.7 vs 3.2 Hz                  |
| G3: JONs activate aBN1, aDN1 and aDN2                          | paper              | pass: 44.1, 15.7, 16.3 Hz              | pass: 44.9, 16.4, 16.8 Hz             |
| C1: degree-preserving rewiring abolishes MN9 activation        | ours               | pass: 0 of 30 trials                   | pass: 0 of 30                         |
| C2: a random graph gives no MN9 activation                     | ours               | pass: 0 of 30                          | pass: 0 of 30                         |
| C3: permuting neuron signs disrupts MN9 activation             | ours               | **fail: 183.0 vs 60.2 Hz**             | **fail: 161.6 vs 62.7 Hz**            |

Results:
[`shiu2024-v783-dev.json`](benchmarks/fly-neural/shiu2024-v783-dev.json),
from the clean commit 411ac53, and
[`shiu2024-v783-heldout.json`](benchmarks/fly-neural/shiu2024-v783-heldout.json),
from the clean commit a27844a. The held-out run was stopped twice by the
session's memory guard:

1. The first attempt, from cd8b23d, finished 17 of 24 conditions before it
   was stopped. Their values were seen in its log, and no result was
   written.
2. Resume support was added (a27844a; nothing that simulates changed), and
   the run began again from the start. It recomputed all 17 conditions,
   identical to the first attempt apart from timing, and was stopped during
   the 24th.
3. A third process resumed the 23 saved conditions and ran the last.

The result lists the resumed conditions. Its numbers are the ones a single
uninterrupted run computes, because every condition has its own seeds; a
test (`test_experiments_resume.py`) checks this.

**What failed, and what it means.**

- **S6, water.** Water GRNs at 200 Hz, the paper's highest tested rate,
  drive MN9 to 30.3 Hz on both seed sets; the trials differ, and the two
  means agree by coincidence. The paper reports that water reaches 40 Hz.
  This is a shortfall on v783 with the paper's own ids; the cause is not
  known. Two things differ from the paper's setup:
  - the population: annotations v3.2.0 type 7 of the paper's 18 water ids
    as sugar GRNs;
  - the release: v783, where the paper used materialization 630.
    The criterion is not lowered.
- **C3, sign permutation (our control, not the paper's).** Permuting which
  neurons are inhibitory, while keeping how many, was expected to disrupt
  MN9. Instead it sets off runaway excitation: 97,465 of 139,255 neurons
  fire (97,192 on the held-out seeds), and MN9 reaches 183 Hz (161.6 Hz),
  between two and three times its rate on the real wiring.
  - The prediction was wrong. The criterion stands as a failure.
  - The finding: in this model, the connectome's placement of its
    inhibitory neurons, not just their number, holds whole-brain activity
    in check.
  - It also means that "MN9 fires" is not specific evidence under a
    control that excites everything. The other three controls (weight
    shuffle, degree-preserving rewiring, random graph) each leave MN9
    silent in every trial.

**What passed.**

The figures below are the dev values; the held-out values in the table
above agree with them.

- Sugar GRNs at 100 Hz activate MN9 in 30 of 30 trials, and the responders
  grow from 18 to 422 with input rate. The paper (on materialization 630)
  reports 45 and 455.
- Shuffled weights abolish the response in 100 of 100 brains. The paper
  saw 1 in 100 respond.
- Bitter and Ir94e GRNs inhibit sugar-evoked MN9 firing.
- JO-CE neurons drive aBN1 (68 Hz at 200 Hz input) where JO-F neurons
  barely do (3 Hz).
- Silencing the inhibitory interneurons between JO-F and aBN1 lets JO-F
  drive it (29 Hz). Only 2 of the paper's 3 identified interneurons exist
  in v783.
- All JONs together activate aBN1, aDN1 and aDN2.

The full table, per condition, is generated from the sealed results in
[docs/benchmarks/fly-neural/README.md](benchmarks/fly-neural/README.md),
with the figure of MN9 against sugar input.

## From what a fly senses to the model, and back

`fly_neural/sensory.py` turns one observation into Poisson rates on
identified sensory neurons. An observation may hold only what a fly could
sense: the strongest looming object's angular size, expansion rate and
bearing, airflow, food odour, and whether it stands on food.
`observation()` refuses anything else, such as the object's identity, kind
or distance, ECHO's giant-fiber proxy, position or heading. The constants
are ours and are marked `model`:

| Channel           | Neurons (FlyWire annotations)                  | Rate                                  | Approximation                                                                                                              |
| ----------------- | ---------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Looming size      | LPLC2, the object's side                       | 200 Hz × min(1, size / 40°)           | LPLC2 encodes angular size; saturation and ceiling are ours                                                                |
| Looming expansion | LC4, the object's side                         | 200 Hz × min(1, expansion / 400° s⁻¹) | LC4 encodes angular velocity; saturation is ours                                                                           |
| Airflow           | JO-C and JO-E wind/gravity neurons, both sides | 150 Hz × min(1, airflow / 1 m s⁻¹)    | direction is not encoded                                                                                                   |
| Food odour        | ORNs of DM1 and VA2, both sides                | 100 Hz × min(1, odour)                | exploratory: the world's one odour level stands for a vinegar-like odour                                                   |
| Food contact      | labellar sugar GRNs, both sides                | 100 Hz on food                        | the fly tastes with its tarsi, whose neurons project to the ventral nerve cord, outside this brain; labellar GRNs stand in |

Two readouts come back: **feed**, when MN9 (proboscis motor neurons,
CB0701) averages at least 10 Hz over the window, and **escape**, when the
giant fiber (DNp01) fires at all.

## ECHO Neural Shadow

Three modes, each named in every recording and result:

| Mode                  | What runs                                                                                                                                                                                                                                             | What can act                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `baseline`            | ECHO controls a research fly; nothing neural runs                                                                                                                                                                                                     | ECHO                                                                                  |
| `neural-shadow`       | ECHO controls a research fly; every decision's sensable input, ECHO's command and the body's mode are recorded. The recording is replayed afterwards into the model (`python -m fly_neural shadow`), and its readouts are compared with what ECHO did | ECHO only. The recording is finished before the model reads it, so nothing flows back |
| `neural-experimental` | A research subject made for the run: the model runs live beside it (`python -m fly_neural serve`, JSON lines), and its readouts decide feeding and escape                                                                                             | the model's two readouts, through the fly's own command gate; ECHO keeps the rest     |

The recorder taps ECHO's `FlyNeuralAdapter` (`decide`, `interrupt`) and
changes nothing it passes: a test checks that a tapped fly's state is
identical to an untapped one's. The research worlds are seeded arenas
built for the shadow: approaching objects (`looms`), food (`food`) and
steady wind (`wind`).

**Results: one null, one partial, one negative.** Three research subjects
were recorded, 60 s each (seed 101, one sample every 10 ms), and replayed
through the full v783 brain. The comparison is exploratory, and nothing
in it was pre-registered:

- The mapping's constants and the two readouts were committed before any
  replay (51bcf4d).
- The scoring was finished after an exploratory replay of `looms`, made
  from an uncommitted tree. An escape match is a giant-fiber episode
  within 0.5 s of an ECHO escape onset; feeding agreement is counted per
  sample.

The recordings are deterministic in their seed; `looms-101` re-recorded at
022e22f is byte-identical, and each result names its recording's SHA-256.

| Subject                                   | What ECHO did                           | What the model's readout did                              | Agreement                              |
| ----------------------------------------- | --------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| `research-wind-101`, steady wind          | no escape, no feeding                   | no giant-fiber spike, MN9 readout never on                | no false alarms; nothing to match      |
| `research-food-101`, on food              | fed in 5,994 of 6,000 samples (2 meals) | MN9 readout on in 1,703 samples, every one while ECHO fed | 28% of samples; 0 model-only           |
| `research-looms-101`, approaching objects | 5 escape onsets (1 takeoff)             | 197 giant-fiber episodes                                  | 3 hits, 2 misses, **194 false alarms** |

Results:
[wind](benchmarks/fly-neural/shadow-wind-101-neural-shadow.json) (0ed5036),
[food](benchmarks/fly-neural/shadow-food-101-neural-shadow.json) (0ed5036),
[looms](benchmarks/fly-neural/shadow-looms-101-neural-shadow.json) (062fa11).
All three are from clean commits, and the code did not change during any
run.

- **Wind is a null result.** Airflow drives the JO-C/E neurons at about
  50 Hz on average. Neither model readout fires, and ECHO neither escapes
  nor feeds. It shows only that wind alone does not trip either readout.
- **Food is partial agreement, limited by the readout.**
  - The feed readout averages MN9 over one 10 ms decision step. With two
    MN9 neurons, "at least 10 Hz" over 10 ms means one spike in that step.
  - MN9 fires at 18 Hz per neuron throughout the feeding period, so the
    readout is on in only 28% of steps.
  - Post hoc, a trailing 500 ms window would be on in 5,619 of the 5,994
    feeding samples and in 4 of the 6 others. That is not the stated
    readout and is not substituted for it. A rate readout needs a window
    longer than a decision step, and that change belongs in a future
    revision with its own committed criteria.
- **Looms is a negative result: the model's escape readout fires far too
  early.**
  - Of the 837 samples with a giant-fiber spike, 808 come while a looming
    object is present but still small (median 8.3°, smallest 4.6°) and
    the fly rests or walks.
  - ECHO escapes as the object passes about 36° and expands at more than
    300° s⁻¹.
  - Both the mapping's constants (LPLC2 at 200 Hz × size / 40°, LC4 at
    200 Hz × expansion / 400° s⁻¹) and the any-spike readout are ours.
    Under them, the model's giant fiber responds to objects far smaller
    than the size at which ECHO escapes. Nothing was tuned after seeing
    this.

None of this compares the model with a real fly. It compares two models
of one.

## Plasticity: a dopamine-gated rule on the connectome, against controls

The deployed fly learns with the repository's mushroom-body rate model
(Bennett, Philippides & Nowotny 2021; 2,000 KC units). The comparison asks
two questions:

- what a comparable rule does on the real circuit, with FlyWire's 5,177
  Kenyon cells, 96 MBONs, 307 PAM dopamine neurons and 62,261 KC-to-MBON
  connections (256,719 synapses);
- whether that differs from fixed weights, a dopamine lesion and a rewired
  connectome.

Everything is fixed in `fly-neural/experiments/plasticity-v783.json`,
committed (51bcf4d) before any run.

- **Rule (ours, from the literature).** After each training trial, each
  KC-to-MBON synapse is scaled by
  `1 − η · min(1, KC spikes / 3) · min(1, DAN spikes / 20)`, with η = 0.3.
  Here "DAN spikes" counts the spikes of the PAM neurons that make at least
  5 synapses onto that MBON; 630 PAM-to-MBON links reach 34 MBONs. The
  weights only decrease. Dopamine-paired depression follows Hige et al.
  2015 and Cohn et al. 2015; PAM neurons carry reward (Liu et al. 2012;
  Burke et al. 2012). The connectome's own DAN-to-MBON synapses stand in
  for compartments.
- **Protocol.**
  - Two abstract odours, each the ORNs of three glomeruli on both sides at
    80 Hz: A is DL3, VM4 and DM1; B is VL1, VL2a and DL1.
  - Test each odour 3 times; then 10 pairings of A with PAM neurons driven
    at 100 Hz, interleaved with B alone; then test again.
  - Trials are 500 ms. The readout is the spike count of the 34
    PAM-innervated MBONs.
  - Learning index: LI = A_after / A_before − B_after / B_before, where
    negative means the paired odour's response fell more.
- **Arms.** The rule; fixed weights; the rule with PAM output silenced; the
  rule on a degree-preserving rewired connectome (exploratory). The
  repository's own mushroom-body model runs the same schedule as-is and
  with the reward omitted, since its learning rate cannot be set to 0.

**Results: the rule depresses synapses, but not selectively; it fails P1–P3.**

| Criterion                                                            | Dev seeds (2 subjects per arm, partial)               | Held-out seeds (8 per arm)                               |
| -------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| P0: the MBON readout responds to each odour before training          | pass: A 1,856, B 1,833 spikes                         | pass: A 1,852, B 1,835                                   |
| P1: with the rule, the learning index is negative                    | **fail**: 1 of 2 negative (p = 0.75)                  | **fail**: 3 of 8 negative, sign test p = 0.86            |
| P2: the rule's index is below the fixed weights'                     | **fail**: p = 0.65                                    | **fail**: mean +0.0003 vs −0.0013, Mann-Whitney p = 0.89 |
| P3: the rule's index is below the DAN lesion's                       | **fail**: p = 0.88                                    | **fail**: mean +0.0003 vs +0.0001, p = 0.52              |
| P4: the repository's mushroom-body model learns the paired cue       | pass: A − B after 0.977–0.994; about 0 without reward | pass: 0.986–0.994; about 0 without reward                |
| X1 (exploratory): the rule on a degree-preserving rewired connectome | undefined: 6–8 KCs fire                               | undefined in all 8: about 4 KCs fire                     |

Dev:
[`plasticity-v783-dev-partial.json`](benchmarks/fly-neural/plasticity-v783-dev-partial.json),
from the clean commit ffe066a, 2 subjects per arm, so it is marked partial.
Held-out: [`plasticity-v783-heldout.json`](benchmarks/fly-neural/plasticity-v783-heldout.json),
from the clean commit 8051eef, all 8 subjects per arm, run once. The
session's memory guard stopped it after 24 subjects. It was resumed with
`--resume` in a terminal outside the session, which ran the last 8, and
the result lists the resumed subjects.

**What happened (the same on both seed sets):**

- **The rule depresses KC-to-MBON synapses for both odours.** Training
  cuts the MBON response to the paired odour A from about 1,855 to about
  400 spikes per test trial. It cuts the response to the unpaired odour B
  just as much, from about 1,832 to about 395. The learning index stays
  within ±0.001. That is smaller than the trial-to-trial variation fixed
  weights alone produce, up to about 0.006 in size.
- **The odours share their Kenyon cells.** Each drives about 3,490 of
  5,177 KCs, and the Jaccard overlap of the two sets is 0.955. A dense
  code of this kind has almost no odour-specific synapses to depress.
- **The dopamine signal is not reward-specific.** PAM neurons are driven
  only on A trials, yet every one of the 20 updates, the 10 unrewarded B
  updates included, depressed at least 18,577 synapses (18,629 on dev seeds). So the PAM
  neurons fire on B trials, driven by the odour through the network. With
  their output silenced (the DAN-lesion arm), no synapse changes.
- **The rewired arm is undefined.** On degree-preserving rewiring, 4–8 KCs
  fire and odour B evokes no MBON response, so the learning index cannot
  be computed.
- **The repository's mushroom-body model discriminates (P4).** It is the
  2,000-unit rate model the deployed fly learns with. After the same
  schedule it separates A from B by about 0.98–0.99, against about 0 with
  the reward omitted. Its sparse random KC code is a design choice; the
  connectome's dense response here is a property of this two-sign LIF
  model under ORN input, not a measurement of the fly.

What this says is narrow: this rule, with these constants, on this model
of the connectome, does not learn an odour-specific association. It does
not say the fly's mushroom body cannot. The two causes point at what the
model leaves out, though neither was tested here:

- In flies, feedback inhibition from the APL neuron keeps the KC code
  sparse (Lin et al. 2014). APL is in the connectome, but this model gives
  every synapse the same weight per synapse, and that does not reproduce a
  sparse code.
- The model has no neuromodulation to separate a reward signal from odour
  drive onto the PAM neurons.

## Cost on this machine

`python -m fly_neural bench` times the full brain on Shiu et al.'s sugar
stimulus, 5 trials per connectome. It also times synthetic random graphs
(not connectomes) at v783's mean out-degree, with 1% of each graph driven.

| Run                                        | Wall s per simulated s | CPU s | Memory                        |
| ------------------------------------------ | ---------------------- | ----- | ----------------------------- |
| Full v783 brain, `shiu` signs              | 1.30                   | 1.30  | 233 MB resident after loading |
| Full v783 brain, `synapse-weighted` signs  | 1.34                   | 1.32  | 234 MB                        |
| Loading a compiled connectome              | 0.2–0.3 s              |       |                               |
| Synthetic, 1,000 neurons, 2,012 spikes     | 0.25                   |       |                               |
| Synthetic, 10,000 neurons, 9,911 spikes    | 1.00                   |       |                               |
| Synthetic, 100,000 neurons, 99,234 spikes  | 8.03                   |       |                               |
| Synthetic, 139,255 neurons, 138,089 spikes | 11.06                  |       |                               |

[`benchmark.json`](benchmarks/fly-neural/benchmark.json), from the clean
commit 8df2e3b. It ran on a Qualcomm ARMv8 laptop (8 logical CPUs, 16 GB
RAM, Windows 11) with one NumPy thread and no GPU.

**Cost follows spikes, not size.** The engine's cost goes with the
synaptic events it delivers, not with the size of the network:

- On the synthetic graphs, wall time grows with spikes times out-degree, at
  about 0.7 µs per synaptic event above a fixed 0.25 s per simulated
  second.
- The full brain under the sugar stimulus fires about 9,000 spikes a second
  and costs 1.3 s.
- The sign shuffle fires about 3 million spikes a second across about
  97,000 neurons. It cost 27 s a trial in the held-out run and 74 s in the
  paging-slowed dev run, rewiring included.

The table at the end of the
[results README](benchmarks/fly-neural/README.md) gives wall time against
spikes for every condition measured on the full brain. Those times were
taken with other work on the machine, and in the dev run with heavy
paging; the same condition varies up to fourfold between the dev and
held-out runs.

The import (17 s, 1.4 GB peak) and every experiment here ran on this one
laptop. Nothing was provisioned and nothing ran on paid compute.

## Limitations

**Of the model:**

- One leaky integrate-and-fire unit per neuron with shared parameters.
- Two signs, set by a predicted transmitter.
- Synaptic weight proportional to synapse count.
- No neuromodulation, gap junctions, dendrites, adaptation, short-term
  plasticity or ventral nerve cord.
- The central brain only: sensory input arrives as Poisson spikes on chosen
  neurons, and motor output is read from a few neurons.

**Of the populations:**

- Shiu et al. published their populations for FlyWire materialization 630;
  this work runs v783.
- Five of their ids are not in v783 and are listed in every result:
  - sugar GRN 720575940620900446
  - bitter GRN 720575940618600651
  - JO-CE 720575940626307902
  - one of the three JO-F inhibitory neurons, 720575940636066222, so
    silencing removes only two
  - one MN9, 720575940645521262
- Annotations v3.2.0 (Tastekin et al. 2026) retype their GRNs. Of the 20
  surviving "sugar" ids:
  - 9 are typed sugar
  - 2 sugar/low_salt
  - 4 putative_attractive
  - 5 high_salt/heavy_metal
- Of their water ids, 11 are typed water and 7 sugar.
- The reproduction uses their ids as published, so it tests their model on
  their populations, not the current cell typing.
- The annotations' left and right are the reverse of the paper's: the paper's
  "right" sugar GRNs are labelled left.

**Of the stimulus:**

- As in Shiu et al.'s code, a Poisson-driven neuron has no refractory
  period, and one input spike makes it fire. Its rate is the input rate, not
  a physiological response.

**Of the sensory mapping:** every rate constant is ours, and some of the
neurons stand in for others:

- labellar GRNs stand in for the tarsal taste the fly actually uses;
- one odour level stands in for DM1 and VA2 input;
- airflow carries no direction.

**Of the shadow readouts:**

- Both are read over one 10 ms decision step. Feeding needs an MN9 spike
  in that step, and escape any giant-fiber spike. The shadow results show
  what this costs: the feed readout flickers at MN9's firing rate, and the
  escape readout fires on small, distant objects.
- `neural-experimental` uses the same readouts, so a research subject
  under it inherits both behaviours.

**Of the mushroom body:**

- Odours drive far more Kenyon cells than the sparse code of real flies. In
  an exploratory check, three glomeruli's ORNs at 80 Hz fired about 3,400 of
  5,177 KCs.
- The plasticity runs record the active KCs per trial and the overlap
  between odours, so this is measured, not assumed.
- The learning rule and its constants are ours, chosen from the literature,
  not fitted.

**Of the hardware:**

- One CPU thread, NumPy, Windows on ARM. No GPU was available or used, and
  no cloud compute was started.
- Brian 2 ran under x64 emulation, so its timings overstate its native cost.
- Timings were taken with other work running and are reported with the
  machine's load.

## Tests

`python -m pytest` in `fly-neural/` runs on synthetic data, needs no
download and covers:

- **Integration:**
  - Brian 2 conformance on four networks, spike for spike;
  - a checkpointed run resumes bit for bit;
  - seeds reproduce;
  - Poisson rates hit their targets;
  - silencing mutes outgoing synapses only;
  - input during refractoriness is discarded, as in Brian 2;
  - the spike log is bounded;
  - a budget stops a run;
  - every parameter has a source.
- **Import:** a synthetic table in the v783 schema:
  - it round-trips with its counts;
  - chunk size does not change the result;
  - unknown ids and bad counts are refused;
  - the synapse-weighted sign;
  - structural corruption and tampered compiled files are detected.
- **Controls and statistics:**
  - each control keeps what it claims to keep, is seeded, and must fit the
    network;
  - the Mann-Whitney test matches SciPy;
  - Wilson intervals;
  - the sign test.
- **Isolation:**
  - only `acquire.py` imports networking;
  - nothing in `src/` or `deploy/` mentions the backend;
  - no dataset file is in the repository;
  - observations with non-sensable fields are refused;
  - recording headers naming production or the deployed individual are
    refused.
- **Plasticity:** on a synthetic mushroom body, only the rewarded odour's
  KC-to-MBON synapses weaken and its learning index goes negative; fixed
  and DAN-lesioned arms change no weight.
- **Benchmark, reference and report:** scaling rows are measured; pooling
  Brian 2 runs refuses a different setup or a repeated seed; the comparison
  passes two runs of one engine.
- **Records and resumption:**
  - a sealed result detects any edit;
  - a run records the code state at its start, and whether the code
    changed during the run;
  - a resumed experiment run and a resumed plasticity run equal
    uninterrupted ones;
  - progress from a different run is refused.

`scripts/echo-neural-shadow.test.ts` (vitest) checks the TypeScript side:

- recording leaves the fly's state identical;
- only sensable keys are written;
- gating applies only in `neural-experimental`;
- production paths and hosts are refused;
- the recorder imports only an allowlist of modules.

At the final commit, all 48 Python tests pass (`python -m pytest -q`
in `fly-neural/`, about 23 s), and so do the 5 tests in
`scripts/echo-neural-shadow.test.ts` (vitest). `tsc --noEmit`, eslint and
prettier pass on the changed files, and the pull request's CI runs the
repository's whole suite.

## Reproduce

From the repository root (the Node scripts) and `fly-neural/` (the
Python). Every long run takes `--resume`, which continues an interrupted
run of the same commit, config and connectome and refuses any other.

```sh
# fly-neural/
pip install -r requirements.txt -e .
python -m fly_neural acquire --accept flywire-cc-by-nc-4.0 --accept flywire-annotations-cite --accept shiu-mit-code-flywire-data
python -m fly_neural import --sign shiu && python -m fly_neural import --sign synapse-weighted
python -m fly_neural crosscheck --name fafb-v783-shiu
python -m fly_neural experiment shiu2024-v783.json --split dev --resume
python -m fly_neural experiment shiu2024-v783.json --split heldout --resume   # once, from a clean commit
python -m fly_neural reference    # after the Brian 2 trials of reference/shiu_brian2.py (see experiments/brian2-reference.json)

# repository root
node scripts/run-ts.mjs scripts/echo-neural-plasticity.ts --subjects 8 --seed 3700001 --out .fly-neural/echo-mb-heldout.json
node scripts/run-ts.mjs scripts/echo-neural-shadow.ts --scenario looms --seed 101 --mode neural-shadow

# fly-neural/
python -m fly_neural plasticity --split heldout --echo-mb ../.fly-neural/echo-mb-heldout.json --resume
python -m fly_neural shadow ../.fly-neural/shadow/looms-101-neural-shadow.jsonl
python -m fly_neural bench && python -m fly_neural report
python -m pytest -q
```

## References

- Dorkenwald S, et al. Neuronal wiring diagram of an adult brain. _Nature_ 634, 124–138 (2024). doi:10.1038/s41586-024-07558-y
- Schlegel P, et al. Whole-brain annotation and multi-connectome cell typing of _Drosophila_. _Nature_ 634, 139–152 (2024). doi:10.1038/s41586-024-07686-5
- Matsliah A, et al. Neuronal parts list and wiring diagram for a visual system. _Nature_ 634, 166–180 (2024). doi:10.1038/s41586-024-07981-1
- Shiu PK, et al. A _Drosophila_ computational brain model reveals sensorimotor processing. _Nature_ 634, 210–219 (2024). doi:10.1038/s41586-024-07763-9
- Eckstein N, et al. Neurotransmitter classification from electron microscopy images at synaptic sites in _Drosophila melanogaster_. _Cell_ 187, 2574–2594 (2024). doi:10.1016/j.cell.2024.03.016
- Tastekin I, et al. The complete gustatory connectome of adult _Drosophila_ reveals how taste guides feeding, foraging, and social behavior. _Cell_ 189, 5527–5551 (2026). doi:10.1016/j.cell.2026.08.016 (the gustatory types in annotations v3.2.0)
- Berg S, et al. Sexual dimorphism in the complete _Drosophila_ male central nervous system connectome. _Cell_ 189, 5504–5526 (2026). doi:10.1016/j.cell.2026.08.015
- Hige T, et al. Heterosynaptic plasticity underlies aversive olfactory learning in _Drosophila_. _Neuron_ 88, 985–998 (2015). doi:10.1016/j.neuron.2015.11.003
- Cohn R, et al. Coordinated and compartmentalized neuromodulation shapes sensory processing in _Drosophila_. _Cell_ 163, 1742–1755 (2015). doi:10.1016/j.cell.2015.11.019
- Liu C, et al. A subset of dopamine neurons signals reward for odour memory in _Drosophila_. _Nature_ 488, 512–516 (2012). doi:10.1038/nature11304
- Burke CJ, et al. Layered reward signalling through octopamine and dopamine in _Drosophila_. _Nature_ 492, 433–437 (2012). doi:10.1038/nature11614
- Lin AC, et al. Sparse, decorrelated odor coding in the mushroom body enhances learned odor discrimination. _Nature Neuroscience_ 17, 559–568 (2014). doi:10.1038/nn.3660
- Bennett JEM, Philippides A, Nowotny T. Learning with reinforcement prediction errors in a model of the _Drosophila_ mushroom body. _Nature Communications_ 12, 2569 (2021). doi:10.1038/s41467-021-22592-4
- Further citations for each population and parameter are in `fly-neural/fly_neural/populations.py` and `params.py`, each checked against Crossref.
