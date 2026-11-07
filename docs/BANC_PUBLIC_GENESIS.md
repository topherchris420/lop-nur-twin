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

## What this implements and what it does not

**Implemented:** A fixed-URL, explicit opt-in public download; bounded streaming and local caching; Feather/Parquet schema validation; deterministic projection to the existing BANC import format; source and derived SHA-256 pinning; separate full BANC compiler output; synthetic isolation and bad-input tests.

**Not established by this code alone:** Successful execution on the actual GCS products; agreement between the public release and the reviewed Codex dataset; any improvement in feeding, motor control, learning, survival or individuality; BANC closed-loop results in the Genesis ecology; live activation in Eva or ECHO.

The next scientific step is to run a bounded BANC-only research protocol with independent subjects, freeze its dataset hashes and motor/sensory readout map, compare it with the current FlyWire hybrid and simple controller baselines, and publish both positive and negative outcomes.

No binary connectome tables belong in Git. The research data's terms and the two original flies' stewardship rules remain binding.
