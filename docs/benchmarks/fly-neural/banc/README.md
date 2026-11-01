# Brain and cord: fly-neural results on BANC v888

Written by `python -m fly_neural report` from the sealed results in this
directory; do not edit by hand. Every number is a model output on the BANC
v888 connectome, the brain and ventral nerve cord of one female fly (terms:
[LICENSE.md](LICENSE.md), CC BY 4.0). What the results mean, and what they
do not, is in [docs/ECHO_CONNECTOME.md](../../../ECHO_CONNECTOME.md#brain-and-cord-banc-v888).

## `banc-cord-v888`, dev seeds ([banc-cord-v888-dev.json](banc-cord-v888-dev.json), `f0cd344` (uncommitted changes), code changed during the run: fly_neural)

w_syn 0.275 mV; 158,262 neurons, 3,037,361 pairs, 23,556,214 synapses. 4 of 10 criteria passed; failed: B1, B3, B4, B5, B6, B8.

| | Claim | Result | |
| --- | --- | --- | --- |
| B1 | Sugar on the legs drives the proboscis motor neuron MN9, through the ventral nerve cord | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B2 | Shuffling the connectome's weights abolishes leg-sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| B3 | Labellar sugar GRNs at 100 Hz activate MN9 in every simulation, in a second animal's connectome | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B4 | Bitter GRN activity inhibits sugar-evoked MN9 firing, in a second animal's connectome | 0.0 vs 0.0 Hz, one-sided Mann-Whitney p = 1 | **fail** |
| B5 | A giant-fiber spike train drives the jump motor neuron TTMn | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B6 | A giant-fiber spike train drives the DLM wing power motor neurons | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B7 | Looming input to LPLC2 and LC4 drives the giant fiber | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B8 | Looming input reaches the jump motor neuron, eye to leg in one connectome | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B9 | The antennal-grooming descending neurons drive front-leg motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B10 | The antennal-grooming descending neurons drive the front legs more than the hind legs | 4.1 vs 0.1 Hz per neuron; higher in 30 of 30 trials that differ, one-sided sign test p = 9.3e-10 | **pass** |

Each readout population's rate summed over its neurons (Hz: all its spikes per trial second). A criterion marked per neuron divides by the population's size:

| Condition | Wiring | Trials | mn9 | giant_fiber | ttmn | psi | dlm | leg_mn_front | leg_mn_middle | leg_mn_hind | Responders > 0 Hz | Wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tarsal-sugar-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 4.8 | 53.7 | 26.4 | 157 | 35 |
| tarsal-sugar-100-weight-shuffle | weight-shuffle | 30 | 0.0 | 0.0 | 0.0 | 0.4 | 0.0 | 0.9 | 0.2 | 0.3 | 980 | 43 |
| labellar-sugar-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | 0.0 | 0.0 | 96 | 18 |
| labellar-sugar-100-bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.1 | 0.0 | 0.0 | 129 | 23 |
| giant-fiber-200 | connectome | 30 | 0.0 | 398.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 3 | 4 |
| looming-200 | connectome | 30 | 0.0 | 218.4 | 0.0 | 0.0 | 18.7 | 45.2 | 98.5 | 0.0 | 477 | 73 |
| adn-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 570.3 | 15.8 | 8.3 | 337 | 34 |

## `banc-cord-v888`, heldout seeds ([banc-cord-v888-heldout.json](banc-cord-v888-heldout.json), `4e44d26`)

w_syn 0.275 mV; 158,262 neurons, 3,037,361 pairs, 23,556,214 synapses. 4 of 10 criteria passed; failed: B1, B3, B4, B5, B6, B8.

| | Claim | Result | |
| --- | --- | --- | --- |
| B1 | Sugar on the legs drives the proboscis motor neuron MN9, through the ventral nerve cord | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B2 | Shuffling the connectome's weights abolishes leg-sugar-evoked MN9 activation | 0/30 trials (Wilson 95% 0.000–0.114) | **pass** |
| B3 | Labellar sugar GRNs at 100 Hz activate MN9 in every simulation, in a second animal's connectome | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B4 | Bitter GRN activity inhibits sugar-evoked MN9 firing, in a second animal's connectome | 0.0 vs 0.0 Hz, one-sided Mann-Whitney p = 1 | **fail** |
| B5 | A giant-fiber spike train drives the jump motor neuron TTMn | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B6 | A giant-fiber spike train drives the DLM wing power motor neurons | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B7 | Looming input to LPLC2 and LC4 drives the giant fiber | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B8 | Looming input reaches the jump motor neuron, eye to leg in one connectome | 0/30 trials (Wilson 95% 0.000–0.114) | **fail** |
| B9 | The antennal-grooming descending neurons drive front-leg motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B10 | The antennal-grooming descending neurons drive the front legs more than the hind legs | 4.2 vs 0.1 Hz per neuron; higher in 30 of 30 trials that differ, one-sided sign test p = 9.3e-10 | **pass** |

Each readout population's rate summed over its neurons (Hz: all its spikes per trial second). A criterion marked per neuron divides by the population's size:

| Condition | Wiring | Trials | mn9 | giant_fiber | ttmn | psi | dlm | leg_mn_front | leg_mn_middle | leg_mn_hind | Responders > 0 Hz | Wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tarsal-sugar-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 4.6 | 53.8 | 27.2 | 159 | 117 |
| tarsal-sugar-100-weight-shuffle | weight-shuffle | 30 | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 0.6 | 0.9 | 0.1 | 951 | 77 |
| labellar-sugar-100 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.6 | 0.0 | 0.0 | 95 | 35 |
| labellar-sugar-100-bitter-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.1 | 0.0 | 0.0 | 130 | 60 |
| giant-fiber-200 | connectome | 30 | 0.0 | 386.9 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0 | 8 |
| looming-200 | connectome | 30 | 0.0 | 218.1 | 0.0 | 0.0 | 19.2 | 44.0 | 98.2 | 0.0 | 478 | 239 |
| adn-200 | connectome | 30 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 577.6 | 15.6 | 9.1 | 356 | 115 |

## `banc-cord-v888-calibrated`, dev seeds ([banc-cord-v888-calibrated-dev.json](banc-cord-v888-calibrated-dev.json), `f0cd344` (uncommitted changes), code changed during the run: fly_neural)

w_syn 0.723 mV; 158,262 neurons, 3,037,361 pairs, 23,556,214 synapses. 9 of 10 criteria passed; failed: B2.

| | Claim | Result | |
| --- | --- | --- | --- |
| B1 | Sugar on the legs drives the proboscis motor neuron MN9, through the ventral nerve cord | 27/30 trials (Wilson 95% 0.744–0.965) | **pass** |
| B2 | Shuffling the connectome's weights abolishes leg-sugar-evoked MN9 activation | 25/30 trials (Wilson 95% 0.664–0.927) | **fail** |
| B3 | Labellar sugar GRNs at 100 Hz activate MN9 in every simulation, in a second animal's connectome | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B4 | Bitter GRN activity inhibits sugar-evoked MN9 firing, in a second animal's connectome | 1.7 vs 41.4 Hz, one-sided Mann-Whitney p = 1.2e-11 | **pass** |
| B5 | A giant-fiber spike train drives the jump motor neuron TTMn | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B6 | A giant-fiber spike train drives the DLM wing power motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B7 | Looming input to LPLC2 and LC4 drives the giant fiber | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B8 | Looming input reaches the jump motor neuron, eye to leg in one connectome | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B9 | The antennal-grooming descending neurons drive front-leg motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B10 | The antennal-grooming descending neurons drive the front legs more than the hind legs | 17.9 vs 2.8 Hz per neuron; higher in 30 of 30 trials that differ, one-sided sign test p = 9.3e-10 | **pass** |

Each readout population's rate summed over its neurons (Hz: all its spikes per trial second). A criterion marked per neuron divides by the population's size:

| Condition | Wiring | Trials | mn9 | giant_fiber | ttmn | psi | dlm | leg_mn_front | leg_mn_middle | leg_mn_hind | Responders > 0 Hz | Wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tarsal-sugar-100 | connectome | 30 | 6.4 | 6.1 | 1.0 | 0.0 | 0.0 | 418.2 | 786.5 | 350.3 | 9601 | 277 |
| tarsal-sugar-100-weight-shuffle | weight-shuffle | 30 | 28.0 | 65.2 | 50.9 | 75.5 | 264.0 | 4451.4 | 4585.5 | 4130.8 | 66715 | 311 |
| labellar-sugar-100 | connectome | 30 | 41.4 | 6.4 | 7.6 | 0.0 | 3.3 | 574.5 | 727.2 | 383.7 | 9377 | 423 |
| labellar-sugar-100-bitter-200 | connectome | 30 | 1.7 | 6.6 | 11.3 | 0.0 | 3.1 | 578.5 | 769.5 | 382.5 | 9547 | 933 |
| giant-fiber-200 | connectome | 30 | 0.0 | 398.1 | 23.9 | 11.6 | 79.1 | 57.4 | 29.4 | 2.8 | 201 | 56 |
| looming-200 | connectome | 30 | 0.0 | 186.0 | 98.3 | 0.0 | 397.3 | 409.5 | 976.5 | 404.0 | 9161 | 796 |
| adn-200 | connectome | 30 | 17.6 | 4.3 | 1.0 | 0.0 | 8.4 | 2494.1 | 603.0 | 347.5 | 8291 | 791 |

## `banc-cord-v888-calibrated`, heldout seeds ([banc-cord-v888-calibrated-heldout.json](banc-cord-v888-calibrated-heldout.json), `4e44d26`)

w_syn 0.723 mV; 158,262 neurons, 3,037,361 pairs, 23,556,214 synapses. 9 of 10 criteria passed; failed: B2.

| | Claim | Result | |
| --- | --- | --- | --- |
| B1 | Sugar on the legs drives the proboscis motor neuron MN9, through the ventral nerve cord | 28/30 trials (Wilson 95% 0.787–0.982) | **pass** |
| B2 | Shuffling the connectome's weights abolishes leg-sugar-evoked MN9 activation | 25/30 trials (Wilson 95% 0.664–0.927) | **fail** |
| B3 | Labellar sugar GRNs at 100 Hz activate MN9 in every simulation, in a second animal's connectome | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B4 | Bitter GRN activity inhibits sugar-evoked MN9 firing, in a second animal's connectome | 1.5 vs 39.2 Hz, one-sided Mann-Whitney p = 1.2e-11 | **pass** |
| B5 | A giant-fiber spike train drives the jump motor neuron TTMn | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B6 | A giant-fiber spike train drives the DLM wing power motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B7 | Looming input to LPLC2 and LC4 drives the giant fiber | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B8 | Looming input reaches the jump motor neuron, eye to leg in one connectome | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B9 | The antennal-grooming descending neurons drive front-leg motor neurons | 30/30 trials (Wilson 95% 0.886–1.000) | **pass** |
| B10 | The antennal-grooming descending neurons drive the front legs more than the hind legs | 18.0 vs 2.7 Hz per neuron; higher in 30 of 30 trials that differ, one-sided sign test p = 9.3e-10 | **pass** |

Each readout population's rate summed over its neurons (Hz: all its spikes per trial second). A criterion marked per neuron divides by the population's size:

| Condition | Wiring | Trials | mn9 | giant_fiber | ttmn | psi | dlm | leg_mn_front | leg_mn_middle | leg_mn_hind | Responders > 0 Hz | Wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tarsal-sugar-100 | connectome | 30 | 6.4 | 5.1 | 0.8 | 0.0 | 0.3 | 404.0 | 779.6 | 340.7 | 9481 | 710 |
| tarsal-sugar-100-weight-shuffle | weight-shuffle | 30 | 28.7 | 80.4 | 55.2 | 82.4 | 283.2 | 4655.7 | 4716.6 | 4469.3 | 68217 | 3380 |
| labellar-sugar-100 | connectome | 30 | 39.2 | 5.8 | 8.2 | 0.0 | 1.9 | 567.0 | 726.9 | 385.8 | 9480 | 272 |
| labellar-sugar-100-bitter-200 | connectome | 30 | 1.5 | 5.2 | 10.6 | 0.0 | 3.5 | 607.7 | 758.7 | 388.3 | 9598 | 263 |
| giant-fiber-200 | connectome | 30 | 0.0 | 386.9 | 21.1 | 10.1 | 73.0 | 52.5 | 26.3 | 1.7 | 187 | 16 |
| looming-200 | connectome | 30 | 0.0 | 184.3 | 97.0 | 0.0 | 406.0 | 413.5 | 971.7 | 400.3 | 9116 | 245 |
| adn-200 | connectome | 30 | 18.0 | 4.4 | 0.9 | 0.0 | 11.9 | 2497.2 | 604.4 | 336.8 | 8313 | 239 |
