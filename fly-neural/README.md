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
python -m fly_neural bench
python -m pytest -q                                     # no download needed
```

Results are sealed `fly-neural-result/v1` JSON files (each carries its own
SHA-256 over canonical JSON, the commit, whether the tree was clean, a digest
of this package's source, the machine and the resources used) written to
`docs/benchmarks/fly-neural/`. A result from a dirty tree says so.

Long runs take a budget: `--max-wall-s`, `--max-rss-mb`, and a stop file
(`.fly-neural/STOP`) checked every 1,000 steps. Nothing here starts cloud
compute.

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
