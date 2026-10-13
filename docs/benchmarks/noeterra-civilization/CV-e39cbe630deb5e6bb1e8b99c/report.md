# CV-e39cbe630deb5e6bb1e8b99c: PASSED (supported)

> Simulated observations of an illustrative model (Noeterra, noeterra 0.1.0 sim/2). Not evidence about the historical world.

**Question (host-written).** In the Noeterra simulation of mediterranean-264bc, how does withholding every agent's memory of how others have treated it change wars declared over the horizon over 40 seasons, against matched-seed controls?

**Hypothesis (host-written).** Withholding every agent's memory of how others have treated it will decrease wars_declared by at least 1 count on average over matched seeds, in the expected direction in at least 4 of 6 seeds.

**Design words (scripted).** [scripted] Withholding agents' memory of how others treated them reduces the number of wars declared. — competing: [scripted] Memory does not change how often the simulated powers go to war.

**Treatment.** withholding every agent's memory of how others have treated it, on mediterranean-264bc, 40 seasons, seeds 1, 2, 3, 4, 5, 6.

## Primary metric: wars_declared (count)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 8.00 | 3.00 | -5.00 | `c363607bf1eb` |
| 2 | 4.00 | 2.00 | -2.00 | `d8965a1422ea` |
| 3 | 8.00 | 3.00 | -5.00 | `287d51107b91` |
| 4 | 7.00 | 4.00 | -3.00 | `31b88740d602` |
| 5 | 3.00 | 2.00 | -1.00 | `93578ca0750e` |
| 6 | 9.00 | 3.00 | -6.00 | `379c4ba3c5e1` |

Mean control 6.50, mean treatment 2.83, mean paired difference **-3.667**; 6 of 6 seeds in the expected direction, 0 opposite, 0 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** arms_completed >= 12: observed 12.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -1: observed -3.667 — holds
- **S2** seeds_expected_direction >= 4: observed 6.000 — holds
- **F1** mean_paired_delta >= 0: observed -3.667 — does not hold

Registry run `V3D-EXP-0005-RUN-0001`: status **passed**, verdict **supported**.

## Secondary observations (mean paired change; not preregistered as tests)

| metric | change | unit |
| :--- | ---: | :--- |
| pacts_broken | -2.500 | count |
| peace_treaties | -4.167 | count |
| battles | -7.500 | count |
| battle_losses | -42.067 | thousand soldiers |
| occupations | -5.667 | count |
| conquests | 1.000 | count |
| revolts | 0.000 | count |
| treaties_signed | -4.833 | count |
| alliances_broken | -4.333 | count |
| civs_fallen | 0.000 | count |
| surviving_civs | 0.000 | count |
| province_hhi | 0.002 | index 0..1 |
| largest_share | 0.004 | fraction |
| peace_fraction | 0.329 | fraction |
| mean_stability | 3.408 | points 0..100 |
| total_population | 55.242 | thousand people |
| unowned_provinces | -1.000 | count |

## Provenance

- Plan digest `e39cbe630deb5e6bb1e8b99cd79ff14937083bab04d9b9c46cbe0ceb5e250bbb`, engine plan `ac07a379eaa23fb6ec8ace3b03ff90eea1b0f525a5ec6e643da294c237ceb84d`, scenario `0e27def60040f7c45bab9e8c1b2aae07850882b02fcec5ffeef306c08914a52c`
- Record `a5152f2789576120ccc32b21f88d39ae909a3f6d444ef4bdbbcd9a1831316dbc`, run `CR-06c56e0c87e74a6ed1787cc3`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- Producing commit `5728f5c47b5df887710f884e97f409fefe11e32d`
- Design written by a script (no model involved)

## Limitations

- Noeterra is an illustrative model: its economy, warfare and diplomacy are invented rules, not estimates of how past societies worked.
- Scenario figures are game values; the polities and rulers follow the standard record only as a setting.
- A result characterizes the simulator and its agents' policy, not history, and is never empirical evidence.
- Agents are the deterministic rule-based policy; model-driven agents are not admitted as experiments.
- Native and WebAssembly builds of this engine version reproduce identical state hashes; other versions are refused.
