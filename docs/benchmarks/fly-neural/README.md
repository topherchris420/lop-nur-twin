# Computational Neural Research: fly-neural results

Written by `python -m fly_neural report` from the sealed results in this
directory; do not edit by hand. Every number is a model output on the
FlyWire v783 connectome (terms: [LICENSE.md](LICENSE.md)). What the
results mean, and what they do not, is in
[docs/ECHO_CONNECTOME.md](../../ECHO_CONNECTOME.md).

## Import: `fafb-v783-shiu` ([import-fafb-v783-shiu.json](import-fafb-v783-shiu.json), `a206910`)

139,255 neurons, 15,091,983 connected pairs, 54,492,922 synapses; 0 autapses, 41,333 inhibitory neurons under sign policy `shiu`. Against Shiu et al.'s Connectivity_783: 15,091,983 of 15,091,983 pairs found, 15,091,983 with the same synapse count, 15,091,983 with the same signed weight.

## Import: `fafb-v783-synapse-weighted` ([import-fafb-v783-synapse-weighted.json](import-fafb-v783-synapse-weighted.json), `a206910`)

139,255 neurons, 15,091,983 connected pairs, 54,492,922 synapses; 0 autapses, 43,869 inhibitory neurons under sign policy `synapse-weighted`. Against Shiu et al.'s Connectivity_783: 15,091,983 of 15,091,983 pairs found, 15,091,983 with the same synapse count, 14,912,121 with the same signed weight.

## Against Brian 2 ([brian2-reference.json](brian2-reference.json), `7d87e82`)

| | Claim | Result | |
| --- | --- | --- | --- |
| R1 | MN9's rate is the same in both simulators | 62.1 vs 62.5 Hz (difference -0.43, SE 1.24); two-sided p = 0.73 | **pass** |
| R2 | Every neuron's mean rate agrees | r = 0.9998 over 388 neurons | **pass** |
| R3 | The same neurons respond | Jaccard 0.997 (323 shared; 323 here, 324 in Brian 2) | **pass** |

30 Brian 2 trials (seeds 20000 to 20029) from 4 run(s): `brian2-sugar100-30.json` 26 of 30 requested; `brian2-sugar100-30-rest-20026.json` 2 of 2 requested; `brian2-sugar100-30-rest-20028.json` 1 of 1 requested; `brian2-sugar100-30-rest-20029.json` 1 of 1 requested.
Brian 2: 128.2 s per simulated second; this engine: 4.35 s.

## Shiu et al. 2024 on v783, dev seeds ([shiu2024-v783-dev.json](shiu2024-v783-dev.json), `411ac53`)

10 of 12 criteria passed; failed: S6, C3.

| | Claim | Result | |
| --- | --- | --- | --- |
| S1 | Sugar GRNs at 100 Hz activate MN9 in every simulation | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| S2 | More neurons respond to stronger sugar GRN activation | 18 → 422 responders (sugar-10 → sugar-200) | **pass** |
| S3 | Shuffling the connectome's weights abolishes sugar-evoked MN9 activation | 0/100 trials (Wilson 95% 0.000–0.037) | **pass** |
| S4 | Bitter GRN activity inhibits sugar-evoked MN9 firing | 0.0 vs 60.2 Hz, one-sided Mann-Whitney p = 8.3e-13 | **pass** |
| S5 | Ir94e GRN activity inhibits sugar-evoked MN9 firing | 2.3 vs 60.2 Hz, one-sided Mann-Whitney p = 1.3e-11 | **pass** |
| S6 | Water GRN activation activates MN9 | 30.3 Hz | **fail** |
| G1 | JO-CE neurons drive aBN1 robustly and JO-F neurons do not, despite synapsing onto it | 68.0 vs 3.0 Hz, one-sided Mann-Whitney p = 1.1e-11, ratio 0.04 | **pass** |
| G2 | Silencing the inhibitory neurons between JO-F and aBN1 lets JO-F drive aBN1 | 29.2 vs 3.0 Hz, one-sided Mann-Whitney p = 1.1e-11 | **pass** |
| G3 | JON activation activates the antennal grooming neurons aBN1, aDN1 and aDN2 | abn1_shiu 44.1 Hz, adn1_shiu 15.7 Hz, adn2_shiu 16.3 Hz | **pass** |
| C1 | Degree-preserving rewiring abolishes sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| C2 | A random graph of the same size and weights does not produce sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| C3 | Permuting neuron signs disrupts sugar-evoked MN9 activation | 183.0 vs 60.2 Hz, one-sided Mann-Whitney p = 1 | **fail** |

| Condition | Wiring | Trials | MN9 (Hz) | aBN1 | aDN1 | aDN2 | Responders > 0 Hz | ≥ 1 Hz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sugar-10 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 18 | 4 |
| sugar-20 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 43 | 22 |
| sugar-50 | connectome | 30 | 13.8 | 0.0 | 0.0 | 0.0 | 342 | 203 |
| sugar-100 | connectome | 30 | 60.2 | 0.0 | 0.0 | 0.0 | 384 | 325 |
| sugar-150 | connectome | 30 | 79.2 | 0.0 | 0.0 | 0.0 | 415 | 339 |
| sugar-200 | connectome | 30 | 90.5 | 0.0 | 0.0 | 0.0 | 422 | 374 |
| sugar-100-weight-shuffle | weight-shuffle | 100 | 0.0 | 0.0 | 0.0 | 0.0 | 355 | 68 |
| sugar-100-degree-preserving | degree-preserving | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 1344 | 37 |
| sugar-100-sign-shuffle | sign-shuffle | 30 | 183.0 | 95.9 | 103.2 | 96.7 | 97465 | 90140 |
| sugar-100-random-graph | random-graph | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 719 | 41 |
| sugar-100-bitter-50 | connectome | 30 | 31.1 | 0.0 | 0.0 | 0.0 | 374 | 288 |
| sugar-100-bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 247 | 143 |
| sugar-100-ir94e-50 | connectome | 30 | 38.5 | 0.0 | 0.0 | 0.0 | 375 | 303 |
| sugar-100-ir94e-200 | connectome | 30 | 2.3 | 0.0 | 0.0 | 0.0 | 8805 | 5358 |
| bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 69 | 63 |
| water-50 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 34 | 24 |
| water-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 76 | 59 |
| water-200 | connectome | 30 | 30.3 | 0.0 | 0.0 | 0.0 | 339 | 202 |
| jo-ce-100 | connectome | 30 | 0.0 | 24.8 | 0.4 | 2.1 | 245 | 157 |
| jo-ce-200 | connectome | 30 | 0.0 | 68.0 | 28.2 | 32.5 | 427 | 285 |
| jo-f-100 | connectome | 30 | 0.0 | 0.9 | 0.0 | 0.0 | 37 | 22 |
| jo-f-200 | connectome | 30 | 0.0 | 3.0 | 0.0 | 0.0 | 77 | 49 |
| jo-f-200-silence-inhibitory | connectome | 30 | 0.0 | 29.2 | 7.5 | 7.9 | 131 | 81 |
| jons-140 | connectome | 30 | 0.0 | 44.1 | 15.7 | 16.3 | 478 | 316 |

## Shiu et al. 2024 on v783, heldout seeds ([shiu2024-v783-heldout.json](shiu2024-v783-heldout.json), `a27844a`)

10 of 12 criteria passed; failed: S6, C3.

| | Claim | Result | |
| --- | --- | --- | --- |
| S1 | Sugar GRNs at 100 Hz activate MN9 in every simulation | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| S2 | More neurons respond to stronger sugar GRN activation | 24 → 425 responders (sugar-10 → sugar-200) | **pass** |
| S3 | Shuffling the connectome's weights abolishes sugar-evoked MN9 activation | 0/100 trials (Wilson 95% 0.000–0.037) | **pass** |
| S4 | Bitter GRN activity inhibits sugar-evoked MN9 firing | 0.0 vs 62.7 Hz, one-sided Mann-Whitney p = 5.9e-13 | **pass** |
| S5 | Ir94e GRN activity inhibits sugar-evoked MN9 firing | 2.3 vs 62.7 Hz, one-sided Mann-Whitney p = 1.3e-11 | **pass** |
| S6 | Water GRN activation activates MN9 | 30.3 Hz | **fail** |
| G1 | JO-CE neurons drive aBN1 robustly and JO-F neurons do not, despite synapsing onto it | 68.2 vs 3.2 Hz, one-sided Mann-Whitney p = 1.2e-11, ratio 0.05 | **pass** |
| G2 | Silencing the inhibitory neurons between JO-F and aBN1 lets JO-F drive aBN1 | 29.7 vs 3.2 Hz, one-sided Mann-Whitney p = 1.3e-11 | **pass** |
| G3 | JON activation activates the antennal grooming neurons aBN1, aDN1 and aDN2 | abn1_shiu 44.9 Hz, adn1_shiu 16.4 Hz, adn2_shiu 16.8 Hz | **pass** |
| C1 | Degree-preserving rewiring abolishes sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| C2 | A random graph of the same size and weights does not produce sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| C3 | Permuting neuron signs disrupts sugar-evoked MN9 activation | 161.6 vs 62.7 Hz, one-sided Mann-Whitney p = 1 | **fail** |

| Condition | Wiring | Trials | MN9 (Hz) | aBN1 | aDN1 | aDN2 | Responders > 0 Hz | ≥ 1 Hz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| sugar-10 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 24 | 5 |
| sugar-20 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 49 | 22 |
| sugar-50 | connectome | 30 | 12.2 | 0.0 | 0.0 | 0.0 | 344 | 196 |
| sugar-100 | connectome | 30 | 62.7 | 0.0 | 0.0 | 0.0 | 375 | 324 |
| sugar-150 | connectome | 30 | 78.4 | 0.0 | 0.0 | 0.0 | 414 | 343 |
| sugar-200 | connectome | 30 | 89.5 | 0.0 | 0.0 | 0.0 | 425 | 360 |
| sugar-100-weight-shuffle | weight-shuffle | 100 | 0.0 | 0.0 | 0.0 | 0.0 | 360 | 63 |
| sugar-100-degree-preserving | degree-preserving | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 1307 | 55 |
| sugar-100-sign-shuffle | sign-shuffle | 30 | 161.6 | 70.7 | 87.2 | 74.7 | 97192 | 89369 |
| sugar-100-random-graph | random-graph | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 774 | 61 |
| sugar-100-bitter-50 | connectome | 30 | 32.2 | 0.0 | 0.0 | 0.0 | 371 | 289 |
| sugar-100-bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 256 | 154 |
| sugar-100-ir94e-50 | connectome | 30 | 36.6 | 0.0 | 0.0 | 0.0 | 393 | 302 |
| sugar-100-ir94e-200 | connectome | 30 | 2.3 | 0.0 | 0.0 | 0.0 | 8724 | 3120 |
| bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 70 | 63 |
| water-50 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 36 | 23 |
| water-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 77 | 59 |
| water-200 | connectome | 30 | 30.3 | 0.0 | 0.0 | 0.0 | 359 | 202 |
| jo-ce-100 | connectome | 30 | 0.0 | 25.8 | 0.5 | 2.6 | 245 | 157 |
| jo-ce-200 | connectome | 30 | 0.0 | 68.2 | 28.6 | 32.6 | 427 | 284 |
| jo-f-100 | connectome | 30 | 0.0 | 0.6 | 0.0 | 0.0 | 37 | 22 |
| jo-f-200 | connectome | 30 | 0.0 | 3.2 | 0.2 | 0.2 | 77 | 49 |
| jo-f-200-silence-inhibitory | connectome | 30 | 0.0 | 29.7 | 7.8 | 8.2 | 130 | 83 |
| jons-140 | connectome | 30 | 0.0 | 44.9 | 16.4 | 16.8 | 492 | 314 |

![MN9 rate against sugar GRN rate in the model, by split, with the controls at 100 Hz](figure-sugar-mn9.svg)

## Cost on this machine ([benchmark.json](benchmark.json), `8df2e3b`)

| Connectome | Load (s) | Wall s per simulated s | CPU s | RSS (MB) |
| --- | --- | --- | --- | --- |
| `fafb-v783-shiu` | 0.2 | 1.30 | 1.30 | 233 |
| `fafb-v783-synapse-weighted` | 0.3 | 1.34 | 1.32 | 234 |

| Synthetic neurons | Pairs | Driven | Spikes | Synaptic events | Wall s per simulated s | Fired |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 102,459 | 20 | 2,012 | 202,610 | 0.25 | 24 |
| 10,000 | 1,074,149 | 100 | 9,911 | 1,060,598 | 1.00 | 108 |
| 100,000 | 10,794,223 | 1000 | 99,234 | 10,720,991 | 8.03 | 1,077 |
| 139,255 | 15,033,691 | 1392 | 138,089 | 14,886,938 | 11.06 | 1,489 |

Machine: ARMv8 (64-bit) Family 8 Model 1 Revision 201, Qualcomm Technologies Inc, 8 logical CPUs, 15979 MB RAM, Windows-10-10.0.26200-SP0; one (NumPy, no parallelism); GPU: none.

## Cost follows activity (full v783 brain, measured in the runs above)

Wall time per simulated second against spikes per trial, for every condition on the connectome and the sign shuffle; the rewired controls are left out because their time includes rewiring. Other work shared the machine, and the dev run was slowed by paging.

| Condition | Split | Spikes per trial | Wall s per trial |
| --- | --- | --- | --- |
| sugar-10 | dev | 228 | 0.62 |
| sugar-10 | heldout | 229 | 0.21 |
| sugar-20 | dev | 549 | 1.08 |
| sugar-20 | heldout | 555 | 0.28 |
| water-50 | heldout | 1,498 | 0.54 |
| water-50 | dev | 1,524 | 0.54 |
| sugar-50 | heldout | 2,694 | 0.73 |
| sugar-50 | dev | 2,731 | 2.43 |
| water-100 | dev | 3,342 | 0.91 |
| water-100 | heldout | 3,376 | 0.87 |
| bitter-200 | dev | 6,010 | 1.00 |
| bitter-200 | heldout | 6,026 | 0.93 |
| jo-f-100 | heldout | 6,384 | 0.73 |
| jo-f-100 | dev | 6,387 | 0.74 |
| water-200 | heldout | 7,489 | 1.40 |
| water-200 | dev | 7,526 | 1.41 |
| sugar-100-ir94e-50 | heldout | 8,282 | 1.46 |
| sugar-100-ir94e-50 | dev | 8,303 | 1.39 |
| sugar-100-bitter-50 | dev | 8,579 | 1.14 |
| sugar-100-bitter-50 | heldout | 8,714 | 1.21 |
| sugar-100 | dev | 9,022 | 6.21 |
| sugar-100 | heldout | 9,042 | 1.56 |
| jo-ce-100 | dev | 9,365 | 2.06 |
| jo-ce-100 | heldout | 9,398 | 1.94 |
| sugar-100-bitter-200 | dev | 9,839 | 1.49 |
| sugar-100-bitter-200 | heldout | 9,935 | 1.16 |
| sugar-150 | dev | 12,801 | 4.60 |
| sugar-150 | heldout | 12,863 | 1.55 |
| jo-f-200 | dev | 13,111 | 1.36 |
| jo-f-200 | heldout | 13,144 | 1.29 |
| jo-f-200-silence-inhibitory | dev | 13,789 | 1.59 |
| jo-f-200-silence-inhibitory | heldout | 13,863 | 1.47 |
| sugar-200 | heldout | 16,131 | 2.02 |
| sugar-200 | dev | 16,211 | 7.15 |
| sugar-100-ir94e-200 | heldout | 18,827 | 2.69 |
| jo-ce-200 | heldout | 20,411 | 3.21 |
| jo-ce-200 | dev | 20,494 | 3.10 |
| sugar-100-ir94e-200 | dev | 23,213 | 2.69 |
| jons-140 | dev | 26,241 | 3.78 |
| jons-140 | heldout | 26,268 | 3.56 |
| sugar-100-sign-shuffle | heldout | 2,885,467 | 26.59 |
| sugar-100-sign-shuffle | dev | 3,236,566 | 74.25 |
