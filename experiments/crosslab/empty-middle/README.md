# R.A.I.N. empty-middle limit of atom transfer

Study `rain-c1-empty-middle-v1`. It asks how far one atom can be moved by spatial adiabatic passage while the space between the traps stays almost empty, the route condition C1 of _What Teleportation Would Require_ names as roadmap step 2.

**Status: draft protocol, development seeds only.** Nothing here is frozen, no held-out seed has been generated, and no result in this folder is confirmatory. `study.py` refuses to produce held-out seeds until `protocol.json` says `"status": "frozen"` and a `freeze.json` beside it records the protocol's SHA-256.

## Registered design

A distance passes when, over held-out seeds, the lower 95% bootstrap bound of arrival is at least 0.90 and the upper bound of peak middle occupation is below 0.01. Both thresholds are the paper's. Arrival includes atom loss, `exp(-Gamma T)`. Middle occupation counts every mediator mode at 4,001 times across the transfer.

Four mediators are compared at 25 distances from 1 um to 1 mm and three hardware budgets:

| Design | Mediator                                                | How distance enters        |
| ------ | ------------------------------------------------------- | -------------------------- |
| G0     | One mode, fixed coupling (control)                      | It does not                |
| G1     | Free hard-wall guide of length d + 1 um, lowest mode    | Gap falls as 1/d^2         |
| G2     | The same guide, mode nearest the kinetic energy E_kin   | Gap falls as 1/d           |
| G3     | Lattice chain, 0.532 um spacing, band-centre zero mode | Gap falls as 1/d           |

Each cell searches 511 settings of coupling and pulse area on eight dev seeds, selects the one with the largest margin, and would score it once on 40 held-out seeds. A seed is one draw of quasi-static trap offsets and, for G3, lattice disorder; the same draw is used in every design, budget and setting. The verdict on the primary hypothesis is read at the generous budget with 1 mm as the line for macroscopic. All values are in [`protocol.json`](protocol.json).

## Changes from the written draft

The draft preregistration fixed a mode window of +-100 Omega with at least eight modes per side, and a solver tolerance. Building the model changed four things, all listed under `amendments_before_freeze` in the protocol:

1. Modes outside +-100 Omega enter by adiabatic elimination, a second-order shift and exchange on the traps plus their population in the middle. On G1 at 1 um the result agrees with a +-1500 Omega explicit window to 1e-5. Keeping eight explicit modes per side forced modes thousands of Omega away into the integrator, and leaving them out entirely shifted the lattice's middle occupation by about 3%.
2. The integrator is a Strang split with exact exponentials on a fixed grid, steps a multiple of 4,000 with max |E| dt <= 0.5. New check V8 doubles the steps at each selected setting.
3. Settings with more than 400 explicit modes are mode-cap fails. They put several modes inside the coupling of resonance, so the middle cannot stay near-empty.
4. G2's couplings sit L(1 - 1/n) apart, within 1 um of the grid distance.

## Development smoke run

See [`record/dev-smoke/`](record/dev-smoke/). These are development seeds only and say nothing confirmatory.

## Reproduce

With Python 3.12 and NumPy 2.3.5:

```bash
study=experiments/crosslab/empty-middle
python -m unittest discover -s "$study" -p 'test_*.py'
python "$study/study.py" cell /tmp/g1-1um.json --design G1 --distance 0 --budget reference
python "$study/study.py" noiseless /tmp/g1-10um.json --design G1 --distance 8
python "$study/study.py" smoke /tmp/smoke
```

A full development search is 225 cells; one cell takes about two CPU minutes on a laptop core.

## Before the held-out run

1. Confirm the remaining choices in the preregistration and the four changes above.
2. Run the full development search and the noiseless series, and publish them.
3. Freeze: set `status` to `frozen`, write `freeze.json` with the protocol's SHA-256, commit, and record the date.
4. Generate the held-out seeds and run once from that commit. The held-out runner is written at the freeze.

Results will be limits of this one-dimensional, single-atom model, not of physics.
