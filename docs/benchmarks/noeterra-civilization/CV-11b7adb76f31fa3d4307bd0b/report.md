# CV-11b7adb76f31fa3d4307bd0b: PASSED (supported)

> Simulated observations of an illustrative model (Noeterra, noeterra 0.1.0 sim/1). Not evidence about the historical world.

**Question (host-written).** In the Noeterra simulation of mediterranean-264bc, how does withholding every agent's memory of how others have treated it change wars declared over the horizon over 40 seasons, against matched-seed controls?

**Hypothesis (host-written).** Withholding every agent's memory of how others have treated it will decrease wars_declared by at least 1 count on average over matched seeds, in the expected direction in at least 4 of 6 seeds.

**Design words (scripted).** [scripted] Withholding agents' memory of how others treated them reduces the number of wars declared. — competing: [scripted] Memory does not change how often the simulated powers go to war.

**Treatment.** withholding every agent's memory of how others have treated it, on mediterranean-264bc, 40 seasons, seeds 1, 2, 3, 4, 5, 6.

## Primary metric: wars_declared (count)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 8.00 | 3.00 | -5.00 | `a78a368b5ceb` |
| 2 | 4.00 | 2.00 | -2.00 | `218211adb370` |
| 3 | 8.00 | 3.00 | -5.00 | `eb074dddfd95` |
| 4 | 6.00 | 4.00 | -2.00 | `ad8306c9a594` |
| 5 | 3.00 | 2.00 | -1.00 | `766a33ebd53c` |
| 6 | 10.00 | 3.00 | -7.00 | `33dd213a453e` |

Mean control 6.50, mean treatment 2.83, mean paired difference **-3.667**; 6 of 6 seeds in the expected direction, 0 opposite, 0 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** arms_completed >= 12: observed 12.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -1: observed -3.667 — holds
- **S2** seeds_expected_direction >= 4: observed 6.000 — holds
- **F1** mean_paired_delta >= 0: observed -3.667 — does not hold

Registry run `V3D-EXP-0003-RUN-0001`: status **passed**, verdict **supported**.

## Secondary observations (mean paired change; not preregistered as tests)

| metric | change | unit |
| :--- | ---: | :--- |
| pacts_broken | -2.500 | count |
| peace_treaties | -4.000 | count |
| battles | -7.667 | count |
| battle_losses | -43.273 | thousand soldiers |
| occupations | -5.667 | count |
| conquests | 0.000 | count |
| revolts | 0.000 | count |
| treaties_signed | -3.667 | count |
| alliances_broken | -4.167 | count |
| civs_fallen | 0.000 | count |
| surviving_civs | 0.000 | count |
| province_hhi | -0.001 | index 0..1 |
| largest_share | -0.009 | fraction |
| peace_fraction | 0.325 | fraction |
| mean_stability | 3.393 | points 0..100 |
| total_population | 67.762 | thousand people |
| unowned_provinces | 0.000 | count |

## Provenance

- Plan digest `11b7adb76f31fa3d4307bd0b32e1ce18d634d4e9158184c46054e1ee563a86e4`, engine plan `ac07a379eaa23fb6ec8ace3b03ff90eea1b0f525a5ec6e643da294c237ceb84d`, scenario `0e27def60040f7c45bab9e8c1b2aae07850882b02fcec5ffeef306c08914a52c`
- Record `ef323f010a714f5f789f503512700b2f96efc7bb490221dec03a20a3fd28acc1`, run `CR-aa638a988e1fd87eb8e6a982`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- Producing commit `eab7d5f7b2d0c4052832b49197abab3e00e5b2e9` with uncommitted changes
- Design written by a script (no model involved)

## Limitations

- Noeterra is an illustrative model: its economy, warfare and diplomacy are invented rules, not estimates of how past societies worked.
- Scenario figures are game values; the polities and rulers follow the standard record only as a setting.
- A result characterizes the simulator and its agents' policy, not history, and is never empirical evidence.
- Agents are the deterministic rule-based policy; model-driven agents are not admitted as experiments.
- Native and WebAssembly builds of this engine version reproduce identical state hashes; other versions are refused.
