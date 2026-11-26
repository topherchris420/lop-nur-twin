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

The draft preregistration fixed a mode window of +-100 Omega with at least eight modes per side, and a solver tolerance. Building the model, reviewing it and the first full development search changed nine things, all listed under `amendments_before_freeze` in the protocol and all waiting for confirmation before the freeze:

1. A mode is explicit when it lies within +-100 Omega max(1, r / 10) of resonance, r being its coupling relative to the resonant mode's. Every other mode enters by adiabatic elimination, a second-order shift and exchange on the traps plus its population in the middle, so every eliminated mode's coupling is under a tenth of its detuning. Eight explicit modes per side forced modes thousands of Omega away into the integrator. A plain +-100 Omega window broke down for G1 beyond a few tens of micrometres: its traps sit where the lowest mode is small, they couple to higher modes up to 640 times harder, and the eliminated middle occupation came out above 1. Below about 16 um the scaling changes nothing.
2. The integrator is a Strang split with exact exponentials on a fixed grid, steps a multiple of 4,000 with max |E| dt <= 0.5. New check V8 doubles the steps at each selected setting.
3. Settings with more than 400 explicit modes are mode-cap fails. They put several modes inside the coupling of resonance, so the middle cannot stay near-empty.
4. G2's couplings sit L(1 - 1/n) apart, within 1 um of the grid distance.
5. V2 and V8 also pass a change smaller than a tenth of the distance from the cell's nearer dev-interval bound to its threshold, where it cannot move a verdict. A fast, failed G1 transfer at 10 um (F = 0.003, M = 0.25) changed M by 1.3e-4 when its steps or window were doubled, and under the draft rule that alone would have made H1 INVALID. V2 doubles the mode cap with the window.
6. Records carry the SHA-256 of the protocol without `status` and `registered` (check V5), so a development search run on the draft stays bound to the frozen protocol. The freeze record still hashes the whole file.
7. A run whose eliminated modes hold more than a tenth of the trap population, at any sample on any seed, is an elimination-cap fail. The rule in 1 bounds each eliminated mode but not their sum: G1 at 100 um (generous, 42.17 Hz, area 10) reported a middle occupation of 1.29, which fell to 0.59 with the window doubled. Past the cap the middle holds over a tenth of the population on that seed, so the run could not have passed, and every kept run reports a middle occupation of at most 1.
8. H2 and H3 read only noiseless records made under this protocol, and come out INCOMPLETE when any is missing. The held-out run checks that all 225 cells, the control and the 51 noiseless records are present and current before it makes a held-out seed or writes a file, so a partial or stale search cannot use up the held-out split.
9. V2 and V8 ask whether a change could move the cell's verdict. A PASS or INCONCLUSIVE cell still needs F and M both held; a FAIL cell needs only one criterion it fails held, since that criterion alone keeps it FAIL. The first full development search failed both checks on G1 cells, generous budget, that fail by a wide margin: at 75 um doubling the window moved M by 0.013 against an allowance of 0.0076 while F stayed at most 0.0003, and at 7.5 um doubling the steps moved F by 1.82e-4 against 1.78e-4 while M stayed at least 0.054. This change came after seeing that search, before any held-out seed exists.

## Running it

| Command                               | What it does                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `study.py search DIR --workers 4`     | Every development job: 225 cells, the G0 control and 51 noiseless runs. Resumes; skips records already made under this protocol.                              |
| `study.py analyze DIR`                | Checks V1 to V8, the limits d\*, u and D\*, and H1 to H3 from a search, as a development preview.                                                             |
| `study.py heldout DEV OUT`            | The one held-out run. Refuses until the protocol is frozen and matches `freeze.json`, the dev search is complete under the frozen protocol, and OUT is empty. |
| `study.py cell`, `noiseless`, `smoke` | One cell, one noiseless run, or the control and a few cells.                                                                                                  |

The noiseless series has no seeds, so H2 and H3 come out the same before and after the freeze, and INCOMPLETE until every noiseless record exists under this protocol.

## Development search

See [`record/dev/`](record/dev/) and its [`analysis.json`](record/dev/analysis.json). These are development seeds only and say nothing confirmatory. The search ran on 25 November 2026 under design hash `e883d9b7…b8c4`, after the ninth change, took 6.9 CPU hours, and is complete: all 225 cells, the control and the 51 noiseless records. Apart from the hash and timings, all 277 records are identical to those of the first search under hash `e084145d…5beb`; only the verdicts of checks V2 and V8 changed.

Limits on the eight dev seeds:

| Budget    | G1 d\* | G2 d\* | G3 d\* | D\*    |
| --------- | ------ | ------ | ------ | ------ |
| harsh     | none   | none   | none   | none   |
| reference | none   | 5.6 um | none   | 5.6 um |
| generous  | 2.4 um | 100 um | 32 um  | 100 um |

- **H1 preview, MICROSCALE ONLY**, the expectation registered before any run. At the generous budget every design has a FAIL before 1 mm: G1 from 4.2 um, G3 from 56 um and G2 from 237 um. The anchors hold: the control G0 passes at the reference budget, and at 1 um G1, G2 and G3 all pass.
- **Checks V1 to V8 all pass.** The two that failed the first search now pass under the ninth change. At 75 um (G1, generous) doubling the window still moves M by 0.013, but the cell fails on arrival with F at most 0.0003 and F moved by 0.0004, inside its allowance. At 7.5 um doubling the steps still moves F by 1.82e-4, but the cell fails on middle occupation with M at least 0.054 and M moved by 5.1e-4, inside its allowance.
- **H2.** G2's slope is 1.00 and G3's 0.95, both CONFIRMED against a prediction of 1. G1 is INCONCLUSIVE: from 237 um on no setting reaches the thresholds within the 10^6 s duration limit.
- **H3, CONTRADICTED.** Without noise the lattice chain G3 reaches arrival of at least 0.90 with middle occupation below 0.01 at all 17 distances from 10 um to 1 mm, with T_req from 8 s to 604 s. The noiseless series has no seeds, so H2 and H3 will read the same after the freeze.
- **Settings.** Of the 114,975, 23,109 ran; 77,400 hit the loss cap, 12,173 the mode cap and 2,293 the elimination cap, the last all G1.

## Reproduce

With Python 3.12 and NumPy 2.3.5:

```bash
study=experiments/crosslab/empty-middle
python -m unittest discover -s "$study" -p 'test_*.py'
OPENBLAS_NUM_THREADS=1 python "$study/study.py" search /tmp/em-dev --workers 4
python "$study/study.py" analyze /tmp/em-dev
```

## Before the held-out run

1. Confirm the remaining choices in the preregistration and the nine changes above.
2. Run the full development search and the noiseless series, and publish them.
3. Freeze: set `status` to `frozen`, write `freeze.json` with the protocol's SHA-256, commit, and record the date.
4. Run `study.py heldout record/dev record/heldout` once from that commit. It generates the held-out seeds and scores each dev-selected setting on them.

Results will be limits of this one-dimensional, single-atom model, not of physics.
