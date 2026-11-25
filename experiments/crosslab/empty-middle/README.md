# R.A.I.N. empty-middle limit of atom transfer

Study `rain-c1-empty-middle-v1`. It asks how far one atom can be moved by spatial adiabatic passage while the space between the traps stays almost empty, the route condition C1 of _What Teleportation Would Require_ names as roadmap step 2.

**Status: draft protocol, development seeds only.** Nothing here is frozen, no held-out seed has been generated, and no result in this folder is confirmatory. `study.py` refuses to produce held-out seeds until `protocol.json` says `"status": "frozen"` and a `freeze.json` beside it records the protocol's SHA-256.

## Registered design

A distance passes when, over held-out seeds, the lower 95% bootstrap bound of arrival is at least 0.90 and the upper bound of peak middle occupation is below 0.01. Both thresholds are the paper's. Arrival includes atom loss, `exp(-Gamma T)`. Middle occupation counts every mediator mode at 4,001 times across the transfer.

Four mediators are compared at 25 distances from 1 um to 1 mm and three hardware budgets:

| Design | Mediator                                               | How distance enters |
| ------ | ------------------------------------------------------ | ------------------- |
| G0     | One mode, fixed coupling (control)                     | It does not         |
| G1     | Free hard-wall guide of length d + 1 um, lowest mode   | Gap falls as 1/d^2  |
| G2     | The same guide, mode nearest the kinetic energy E_kin  | Gap falls as 1/d    |
| G3     | Lattice chain, 0.532 um spacing, band-centre zero mode | Gap falls as 1/d    |

Each cell searches 511 settings of coupling and pulse area on eight dev seeds, selects the one with the largest margin, and would score it once on 40 held-out seeds. A seed is one draw of quasi-static trap offsets and, for G3, lattice disorder; the same draw is used in every design, budget and setting. The verdict on the primary hypothesis is read at the generous budget with 1 mm as the line for macroscopic. All values are in [`protocol.json`](protocol.json).

## Changes from the written draft

The draft preregistration fixed a mode window of +-100 Omega with at least eight modes per side, and a solver tolerance. Building the model changed six things, all listed under `amendments_before_freeze` in the protocol and all waiting for confirmation before the freeze:

1. A mode is explicit when it lies within +-100 Omega max(1, r / 10) of resonance, r being its coupling relative to the resonant mode's. Every other mode enters by adiabatic elimination, a second-order shift and exchange on the traps plus its population in the middle, so every eliminated mode's coupling is under a tenth of its detuning. Eight explicit modes per side forced modes thousands of Omega away into the integrator. A plain +-100 Omega window broke down for G1 beyond a few tens of micrometres: its traps sit where the lowest mode is small, they couple to higher modes up to 640 times harder, and the eliminated middle occupation came out above 1. Below about 16 um the scaling changes nothing.
2. The integrator is a Strang split with exact exponentials on a fixed grid, steps a multiple of 4,000 with max |E| dt <= 0.5. New check V8 doubles the steps at each selected setting.
3. Settings with more than 400 explicit modes are mode-cap fails. They put several modes inside the coupling of resonance, so the middle cannot stay near-empty.
4. G2's couplings sit L(1 - 1/n) apart, within 1 um of the grid distance.
5. V2 and V8 also pass a change smaller than a tenth of the distance from the cell's nearer dev-interval bound to its threshold, where it cannot move a verdict. A fast, failed G1 transfer at 10 um (F = 0.003, M = 0.25) changed M by 1.3e-4 when its steps or window were doubled, and under the draft rule that alone would have made H1 INVALID. V2 doubles the mode cap with the window.
6. Records carry the SHA-256 of the protocol without `status` and `registered` (check V5), so a development search run on the draft stays bound to the frozen protocol. The freeze record still hashes the whole file.

## Running it

| Command                               | What it does                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `study.py search DIR --workers 4`     | Every development job: 225 cells, the G0 control and 51 noiseless runs. Resumes; skips records already made under this protocol.                             |
| `study.py analyze DIR`                | Checks V1 to V8, the limits d\*, u and D\*, and H1 to H3 from a search, as a development preview.                                                            |
| `study.py heldout DEV OUT`            | The one held-out run. Refuses until the protocol is frozen and matches `freeze.json`, every dev record carries the frozen protocol's hash, and OUT is empty. |
| `study.py cell`, `noiseless`, `smoke` | One cell, one noiseless run, or the control and a few cells.                                                                                                 |

The noiseless series has no seeds, so H2 and H3 come out the same before and after the freeze.

## Development search

See [`record/dev/`](record/dev/) and its [`analysis.json`](record/dev/analysis.json). These are development seeds only and say nothing confirmatory.

## Reproduce

With Python 3.12 and NumPy 2.3.5:

```bash
study=experiments/crosslab/empty-middle
python -m unittest discover -s "$study" -p 'test_*.py'
OPENBLAS_NUM_THREADS=1 python "$study/study.py" search /tmp/em-dev --workers 4
python "$study/study.py" analyze /tmp/em-dev
```

## Before the held-out run

1. Confirm the remaining choices in the preregistration and the six changes above.
2. Run the full development search and the noiseless series, and publish them.
3. Freeze: set `status` to `frozen`, write `freeze.json` with the protocol's SHA-256, commit, and record the date.
4. Run `study.py heldout record/dev record/heldout` once from that commit. It generates the held-out seeds and scores each dev-selected setting on them.

Results will be limits of this one-dimensional, single-atom model, not of physics.
