# BANC v888: public-release research bridge for Genesis

**Research only.** This bridge does not run on, read from or modify either original individual, its VM, database, store, checkpoints or ledger. It cannot silently deploy a neural controller. It does not combine FAFB and BANC specimens.

## Why this exists

The existing `fly_neural.banc` importer accepts only the **specific reviewed Codex export** whose bytes, terms and citation are pinned in `banc.REVIEWED`. Those data were already used for the BANC v888 experiments in this repository, but the interactive Codex download requires account access.

There is a separate public distribution of **BANC v888**, available without authentication:

- Public release: https://banc.community and https://doi.org/10.7910/DVN/7WTH1N
- Public metadata (Feather): `compiled_data/banc_888/banc_888_meta.feather`
- Public connections (Parquet): `neuron_connectivity/v888/synapses_v1_human_readable_sizethresh3_connectioncountsperneuropil_countthresh3.parquet`
- Both files live beneath `https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome/`.

These are **not necessarily byte-identical** to the reviewed Codex files. The GCS bucket may evolve independently of the paper's immutable Harvard Dataverse snapshot. The public metadata includes more root IDs than the reviewed, filtered Codex network, so count differences are expected and must be explained rather than forced to match.

Publication and attribution: Bates, Phelps, Kim, Yang et al. (2026), _Distributed control circuits across a brain-and-cord connectome_, Nature, DOI:10.1038/s41586-026-10735-w; the v888 data repository, DOI:10.7910/DVN/7WTH1N. Verify the specific release's CC BY 4.0 terms before using it.

## How to run

From the `fly-neural/` folder with Python 3.11+ and the project dependencies installed:

```sh
python -m pip install -e '.[test]'

# Explicit consent is required for fetching copyrighted third-party data.
python -m fly_neural.banc_public fetch --accept-cc-by-4.0

# Offline conversion. Pins the raw and converted bytes in a local manifest.
python -m fly_neural.banc_public prepare

# Offline import into the existing full-neural LIF format, not a live fly.
python -m fly_neural.banc_public import

# Inspect the compiled neural model in an existing research-only runner.
python -m fly_neural serve --connectome banc-v888-public-predicted-nt
```

A `serve` session must still provide a valid `neural-experimental` research-subject header and `brain-and-cord/v3` mapping. Production identity and file paths remain prohibited by the existing server.

All inputs and compiled models live outside the Git tree under `$FLY_NEURAL_DATA` (default: `~/.cache/fly-neural`):

```text
public-banc/v888/
  banc_888_meta.feather
  banc_v888_connections.parquet
  source-manifest.json
  codex-compatible/neurons.csv.gz
  codex-compatible/connections_princeton.csv.gz
compiled/banc-v888-public-predicted-nt/
```

`source-manifest.json` records exact raw and converted SHA-256 digests, sizes and source URLs. Future offline preparations refuse silently changed local inputs or conversions. These are **local provenance hashes**, not independent publication signatures. A new public bucket snapshot must be reviewed and deliberately re-pinned.

The existing reviewed Codex pin and `import --dataset banc-v888` command are untouched and continue to reject unreviewed bytes. The separate public import is marked **unverified inputs** in its neural manifest: do not cite it as a reproduction of the older reviewed-Codex network until release differences and output counts have been independently checked.


## Verified public GCS acquisition on November 7, 2026

The reproducible [GitHub Actions research acquisition](https://github.com/topherchris420/lop-nur-twin/actions/runs/42392321350) downloaded both published v888 products, ran 25 synthetic/structural isolation tests (all passing), converted the full public tables, and compiled the isolated model successfully.

| Source | Bytes | Local SHA-256 |
| --- | ---: | --- |
| `banc_888_meta.feather` | 57,503,026 | `86ccf5df0c67419f8c5f43e93a7ed38d23a080e9f7fde26737290252f3780098` |
| `banc_v888_connections.parquet` | 76,125,807 | `b1d8267976f54c8c04e5a6ba85f46d2b60dc4b5ed4a285e3cb4c77abcef4070a` |

The published connections contain **10,196,509** per-neuropil rows. The converter excluded and explicitly recorded **29 rows (90 counted synapses)** whose source or target was the background/unassigned root ID 0; the unmodified Parquet source is retained. Negative IDs, zero synapse counts, and missing fields still fail closed. See `conversion-audit.json` and `source-manifest.json` in the package.

The resulting `banc-v888-public-predicted-nt` research model has **188,508** metadata IDs, **3,638,916** directed neuron pairs, **29,198,720** counted synapses, and **114** neuropil labels. These are *not* the same population and filter as the previously reviewed Codex BANC v888 export (158,262 neurons and 23,556,214 counted synapses). Do not present these as contradictory measurements of an identical source graph.

[Download the actual research dataset and compiled model](https://github.com/topherchris420/lop-nur-twin/actions/runs/42392321350/artifacts/13581743465) (GitHub Actions artifact, 14-day retention). This artifact is external to Git, includes the original public files, reproducible converted files, local source hashes, attribution, and the compiled neural model.

**Limits:** This validates real acquisition, schema conversion, graph compilation and local consistency. It does not independently authenticate the hashes against an authoritative upstream publication record, reproduce the earlier Codex graph, or demonstrate behavioral benefit in research flies. No changes to the running Eva or ECHO have been made.

## What this implements and what it does not

**Implemented:** A fixed-URL, explicit opt-in public download; bounded streaming and local caching; Feather/Parquet schema validation; deterministic projection to the existing BANC import format; source and derived SHA-256 pinning; separate full BANC compiler output; synthetic isolation and bad-input tests.

**Not established by this code alone:** Successful execution on the actual GCS products; agreement between the public release and the reviewed Codex dataset; any improvement in feeding, motor control, learning, survival or individuality; BANC closed-loop results in the Genesis ecology; live activation in Eva or ECHO.

The next scientific step is to run a bounded BANC-only research protocol with independent subjects, freeze its dataset hashes and motor/sensory readout map, compare it with the current FlyWire hybrid and simple controller baselines, and publish both positive and negative outcomes.

No binary connectome tables belong in Git. The research data's terms and the two original flies' stewardship rules remain binding.
