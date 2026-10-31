# fly-neural

A research backend for **Computational Neural Research** on the FlyWire
connectome: a leaky integrate-and-fire model of the whole adult central brain
(Shiu et al. 2024's model) run on FlyWire's public release v783, the
reproduction of published experiments with it, and an offline shadow of what
a _research_ fly in this repository senses. What it found, and what it did
not, is in [docs/ECHO_CONNECTOME.md](../docs/ECHO_CONNECTOME.md).

It is separate from everything the deployed fly runs. Nothing in `src/` or
`deploy/` imports it (a test checks), it never runs on the production host,
and it never reads or writes the live organism, its store or its backups.

## Install

Python 3.11 (tested on Windows ARM64; every wheel is native):

```sh
cd fly-neural
python -m venv .venv
.venv/bin/pip install -r requirements.txt -e .    # Windows: .venv\Scripts\pip
```

The Brian 2 reference (`reference/`) needs its own environment, pinned in
`reference/requirements.txt` (Brian 2 has no Windows ARM64 wheel; it ran
under x64 emulation).

## Data: fetched, verified, never committed

Every input is pinned in `fly_neural/sources.py` by size and SHA-256 and
fetched into `$FLY_NEURAL_DATA` (default `~/.cache/fly-neural`), outside the
repository, only when you accept its terms by name:

```sh
python -m fly_neural status                       # what is present, and each file's terms
python -m fly_neural acquire --accept flywire-cc-by-nc-4.0 \
    --accept flywire-annotations-cite --accept shiu-mit-code-flywire-data
```

| Source                                                                                                                                | Terms                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FlyWire public release v783 (Zenodo 10676866): root ids, connections                                                                  | Zenodo lists CC BY 4.0; [flywire.ai/guidelines](https://flywire.ai/guidelines) says CC BY-NC 4.0. The stricter one is treated as binding. Cite Dorkenwald et al. 2024 and Schlegel et al. 2024. |
| FlyWire annotations v3.2.0 (flyconnectome/flywire_annotations)                                                                        | No licence file; the README asks for citations (Schlegel 2024, Matsliah 2024, Berg 2026, Tastekin 2026, Dorkenwald 2024). Read locally, never copied.                                           |
| Shiu et al.'s `Completeness_783.csv`, `Connectivity_783.parquet`, `model.py`, `utils.py` (philshiu/Drosophila_brain_model at 91bdd1e) | Code MIT; the tables are derived from FlyWire data. Used to cross-check the import and as the Brian 2 reference; `model.py` runs unmodified from the cache.                                     |

`acquire.py` is the only module that touches the network (a test checks).

## Commands

```sh
python -m fly_neural import --sign shiu                 # compile v783 to <data>/compiled/fafb-v783-shiu
python -m fly_neural import --sign synapse-weighted     # ... with per-neuron synapse-weighted transmitter signs
python -m fly_neural crosscheck --name fafb-v783-shiu   # pair-for-pair against Shiu et al.'s Connectivity_783
python -m fly_neural experiment shiu2024-v783.json --split dev       # the reproduction, dev seeds
python -m fly_neural experiment shiu2024-v783.json --split heldout   # once, from a clean commit
python -m fly_neural plasticity --split dev --echo-mb ../.fly-neural/echo-mb-dev.json
python -m fly_neural shadow ../.fly-neural/shadow/looms-101-neural-shadow.jsonl
python -m fly_neural serve       # JSON lines on stdin/stdout, for a neural-experimental research subject
python -m fly_neural bench
python -m fly_neural report                             # docs/benchmarks/fly-neural/README.md and its figure
python -m pytest -q                                     # no download needed
```

Results are sealed `fly-neural-result/v1` JSON files (each carries its own
SHA-256 over canonical JSON, the commit, whether the tree was clean, a digest
of this package's source, the machine and the resources used) written to
`docs/benchmarks/fly-neural/`. A result from a dirty tree says so.

Long runs take a budget: `--max-wall-s`, `--max-rss-mb`, and a stop file
(`.fly-neural/STOP`) checked every 1,000 steps. Nothing here starts cloud
compute. `experiment` and `plasticity` also take `--resume`. Each finished
condition or subject is saved in `.fly-neural/progress/` under the run's
commit, source digest, config and connectome, so a stopped run continues
where it was. A progress file from any other run is refused.

`serve` reads a header first (`schema`, `mode: "neural-experimental"`, a
`research-` subject, `seed`, and optionally `mapping`). The default
mapping `v1` drives the five v1 channels and returns feed and escape.
`"mapping": "whole-brain/v2"` adds LC11/LC10a for a small moving object and
returns walk, backward, turn, groom and land from descending neurons over a
trailing window (`rate_window_ms`, default 100), with a count of active
descending neurons. An unknown mapping is refused before the connectome
loads. `scripts/fly-neural-sync.ts` calls `serve` synchronously, so a
whole-brain research subject can step inside a first-contact session
(`scripts/first-contact-whole-brain.ts`).

What has been run, and what came of it, is in
[docs/ECHO_CONNECTOME.md](../docs/ECHO_CONNECTOME.md).

## FlyWire Codex: a reference layer

[Codex](https://codex.flywire.ai/) is a research explorer, and
`fly_neural/codex.py` reads the static tables it publishes. It runs no
dynamics. It keeps two datasets apart and never combines them:

| Dataset     | What                                                           | Codex states (read 2026-10-31)         | In this repository                                                                                                    |
| ----------- | -------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fafb-v783` | Female adult fly brain                                         | 139,255 neurons, 3,732,460 connections | the validated baseline: the pinned Zenodo tables and annotations above (139,255 neurons, 54,492,922 synapses)         |
| `banc-v888` | Female adult fly brain and ventral nerve cord (another animal) | 158,262 neurons, 3,037,361 connections | **not pinned**: no file, hash, licence or citation recorded; Codex's "connections" definition is not on its home page |

Codex asks a person to sign in and accept its terms before data can be
downloaded, so nothing here downloads from it. Download the tables yourself
into `$FLY_NEURAL_DATA/codex/<dataset>/`, then pin them:

```sh
python -m fly_neural codex datasets
python -m fly_neural codex pin banc-v888 --neurons <file> --connections <file> \
  --terms "<the terms you accepted, quoted>" --cite "<the citation Codex asks for>" --retrieved "<UTC date>"
python -m fly_neural codex report banc-v888                 # .fly-neural/codex/report-banc-v888.json
python -m fly_neural codex report fafb-v783-annotations     # from the pinned v783 annotation release
```

BANC v888's downloadable Codex tables can be used **without renaming columns**
or modifying the original compressed bytes. The neuron export commonly uses
human-readable headings (`Root ID`, `Super Class`, `Primary Cell Type`,
`Predicted NT type`) and `connections_princeton.csv.gz` uses the usual
snake_case headings. The importer now reads both, including quoted CSV fields.

Keep the originals **outside Git** in
`$FLY_NEURAL_DATA/codex/banc-v888/`, pin *both* files and the actual accepted
terms, then run the report:

```sh
python -m fly_neural codex pin banc-v888 \
  --neurons "$FLY_NEURAL_DATA/codex/banc-v888/neurons.csv.gz" \
  --connections "$FLY_NEURAL_DATA/codex/banc-v888/connections_princeton.csv.gz" \
  --terms "<terms you accepted at the source>" \
  --cite "<citation required by the source>" --retrieved "<actual UTC date>"
python -m fly_neural codex report banc-v888
```

One BANC v888 file set checked on 2026-10-31 contained **158,262 unique neurons,
3,990,039 region-specific connection rows and 3,037,361 distinct directed
neuron pairs**. The source's connection total counts unique pairs, not rows
segmented by neuropil. These are observations for that file set, not a claim
that every Codex export has identical bytes. Check actual SHA-256 hashes before
using data in any experiment. All data loading and reports remain research-only:
no Eva or ECHO controller, memory, or live service is changed.

`pin` records each file's size and SHA-256 beside the files (`pins.json`,
outside Git); every load re-hashes and refuses any difference. A report gives
neuron counts against Codex's stated ones (`check_counts` reports a mismatch,
never adjusts it), super-classes, classes, predicted transmitters, synapses
per region, shortest sensory-to-motor or descending paths (hop counts and the
class sequence along one path per source), reciprocity and triangle motifs on
a seeded sample, and its provenance and terms. `compare` sets two datasets'
summaries side by side. Column names are read by alias (`root_id`, `class`,
`nt_type`, `pre_root_id`, `syn_count` and their FlyWire variants), and a
table missing a required column is refused with the columns it has.

## Layout

| Path                        | What                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `fly_neural/sources.py`     | Pinned inputs: URL, size, SHA-256, terms, citations.                                                                            |
| `fly_neural/acquire.py`     | Fetch (resumable) and verify. The only network access.                                                                          |
| `fly_neural/importer.py`    | Chunked v783 import to CSR; null, range, duplicate, unknown-id and autapse checks; transmitter calls; three sign policies.      |
| `fly_neural/connectome.py`  | The compiled connectome (`.npy` arrays, memory-mapped) and its sealed manifest; structural validation.                          |
| `fly_neural/lif.py`         | The integrator: Shiu et al.'s equations, Brian 2's schedule and refractoriness, exact linear updates; checkpoints; budgets.     |
| `fly_neural/params.py`      | Every model parameter with its status (cited, free, simulator, assumption) and source.                                          |
| `fly_neural/populations.py` | Shiu et al.'s published ids (resolved against v783, missing ones listed) and cited annotation selections.                       |
| `fly_neural/controls.py`    | Weight shuffle, degree-preserving rewiring, sign shuffle, random graph.                                                         |
| `fly_neural/experiments.py` | Runs a pre-registered experiment file and judges its criteria.                                                                  |
| `fly_neural/plasticity.py`  | The dopamine-gated KC-to-MBON rule against its controls.                                                                        |
| `fly_neural/sensory.py`     | Sensable observations to Poisson rates; MN9 and giant-fiber readouts.                                                           |
| `fly_neural/shadow.py`      | Offline replay of a research fly's recording; the `serve` loop for a neural-experimental research subject.                      |
| `fly_neural/bench.py`       | Measured cost: full-brain trials, synthetic scaling.                                                                            |
| `fly_neural/codex.py`       | The Codex reference layer: FAFB v783 and BANC v888 kept apart, pinned by hash, inspected; no dynamics.                          |
| `experiments/`              | Pre-registered experiment files. Their bytes are hashed into every result; do not reformat them.                                |
| `reference/shiu_brian2.py`  | Shiu et al.'s own `model.py` under Brian 2: the conformance fixture and full-brain reference trials.                            |
| `tests/`                    | Unit and small integration tests on synthetic data; `tests/data/brian2_conformance.json` is Brian 2's output on synthetic nets. |

## Rules

- **Never the original fly.** No code here reads the production store, a
  checkpoint or a backup of the deployed individual, and nothing gives the
  model a channel to it. `neural-experimental` runs only on a research
  subject created for the run (`scripts/echo-neural-shadow.ts`).
- **No dataset in the repository.** Connectome files stay in the cache. The
  results in `docs/benchmarks/fly-neural/` are model outputs derived from
  FlyWire data and carry its terms (see `docs/benchmarks/fly-neural/LICENSE.md`).
- **Pre-registration.** Criteria, seeds and trial counts are fixed in
  `experiments/*.json` before a run. Held-out seeds run once, from a clean
  commit, and are reported whatever they show. Never edit a criterion after
  seeing a result, never edit a result file.
- **Nothing random presented as a connectome.** Control wirings are labelled
  in every result and never reported as the connectome.
- **No claim beyond the model.** A leaky integrate-and-fire network with two
  signs and one weight per synapse; no neuromodulation, gap junctions,
  morphology or ventral nerve cord. It is not the fly's nervous system, and
  nothing here is a claim about awareness or experience.
