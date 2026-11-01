# Terms of the files in this directory

The JSON results here are outputs of `python -m fly_neural experiment`
(fly-neural/) run on BANC v888, the brain and ventral nerve cord connectome:
counts, firing rates, spike counts and neuron identifiers computed by a model.
They contain no connectivity table, but they are derived from BANC data, so
they are offered on BANC's terms, not under this repository's Apache License
2.0:

- **BANC v888 data: CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/),
  as the BANC project and its Harvard Dataverse deposit
  (https://doi.org/10.7910/DVN/7WTH1N) state. The tables were downloaded from
  FlyWire Codex (https://codex.flywire.ai/?dataset=banc) and pinned by their
  SHA-256 (`fly_neural/banc.py`, `REVIEWED`); they stay outside this repository.
- **Cite** Bates AS, Phelps JS, Kim M, Yang HHJ, Matsliah A, Ajabi Z,
  Perlman E, et al. Distributed control circuits across a brain-and-cord
  connectome. Nature (2026), https://doi.org/10.1038/s41586-026-10735-w, and
  the deposit: BANC v888 — Brain-and-nerve-cord connectome (data and analysis
  code), Harvard Dataverse, https://doi.org/10.7910/DVN/7WTH1N.
- **The model** is Shiu P, et al. A Drosophila computational brain model
  reveals sensorimotor processing. Nature 634, 210-219 (2024),
  https://doi.org/10.1038/s41586-024-07763-9, whose code (MIT) is not copied
  here.

The README in this directory, when present, is written from these results.
