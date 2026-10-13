# CV-42f24afb3263a942d293016d: INCONCLUSIVE (insufficient evidence)

> Simulated observations of an illustrative model (Noeterra, noeterra 0.1.0 sim/2). Not evidence about the historical world.

**Question (host-written).** In the Noeterra simulation of mediterranean-264bc, how does withholding every agent's memory of how others have treated it change wars declared over the horizon over 40 seasons, against matched-seed controls?

**Hypothesis (host-written).** Withholding every agent's memory of how others have treated it will decrease wars_declared by at least 50 count on average over matched seeds, in the expected direction in at least 4 of 6 seeds.

**Design words (scripted).** [scripted] Withholding agents' memory of how others treated them reduces the number of wars declared. — competing: [scripted] Memory does not change how often the simulated powers go to war.

**Treatment.** withholding every agent's memory of how others have treated it, on mediterranean-264bc, 40 seasons, seeds 7, 8, 9, 10, 11, 12.

## Primary metric: wars_declared (count)

| seed | control | treatment | difference | treatment final state |
| ---: | ---: | ---: | ---: | :--- |
| 7 | 6.00 | 3.00 | -3.00 | `2dbcb7e9dbca` |
| 8 | 10.00 | 3.00 | -7.00 | `df0fbf5f21c3` |
| 9 | 6.00 | 3.00 | -3.00 | `e108bd06c332` |
| 10 | 7.00 | 3.00 | -4.00 | `a94973320d2b` |
| 11 | 5.00 | 3.00 | -2.00 | `eb1aa557fbb4` |
| 12 | 8.00 | 3.00 | -5.00 | `81244064a7a1` |

Mean control 7.00, mean treatment 3.00, mean paired difference **-4.000**; 6 of 6 seeds in the expected direction, 0 opposite, 0 unchanged.

## Frozen criteria (rain-criteria/v1, evaluated by the registry)

- **G1** arms_completed >= 12: observed 12.000 — holds
- **G2** determinism_check >= 1: observed 1.000 — holds
- **S1** mean_paired_delta <= -50: observed -4.000 — does not hold
- **S2** seeds_expected_direction >= 4: observed 6.000 — holds
- **F1** mean_paired_delta >= 0: observed -4.000 — does not hold

Registry run `V3D-EXP-0006-RUN-0001`: status **inconclusive**, verdict **insufficient_evidence**.

## Secondary observations (mean paired change; not preregistered as tests)

| metric | change | unit |
| :--- | ---: | :--- |
| pacts_broken | -3.333 | count |
| peace_treaties | -4.500 | count |
| battles | -5.667 | count |
| battle_losses | -16.688 | thousand soldiers |
| occupations | -4.333 | count |
| conquests | -2.333 | count |
| revolts | 0.000 | count |
| treaties_signed | -2.500 | count |
| alliances_broken | -2.167 | count |
| civs_fallen | 0.000 | count |
| surviving_civs | 0.000 | count |
| province_hhi | -0.006 | index 0..1 |
| largest_share | -0.027 | fraction |
| peace_fraction | 0.338 | fraction |
| mean_stability | 2.792 | points 0..100 |
| total_population | 55.743 | thousand people |
| unowned_provinces | 2.333 | count |

## Provenance

- Plan digest `42f24afb3263a942d293016d922cacea3bafdbfd4828635249409c5997c3ca19`, engine plan `60f36076523ff70a47a260f13688d118b1d5fa42b200a7ce281acc0790a7ace8`, scenario `0e27def60040f7c45bab9e8c1b2aae07850882b02fcec5ffeef306c08914a52c`
- Record `c8d499d029ceb787907feeb9906f96f53b8215d9951bc13c5867c6e592ac7911`, run `CR-1d83e75dd05af0eb6325921e`; authorized by Scripted.DemoOperator (local operator attestation; identity not verified)
- Producing commit `5728f5c47b5df887710f884e97f409fefe11e32d`
- Design written by a script (no model involved)

## Limitations

- Noeterra is an illustrative model: its economy, warfare and diplomacy are invented rules, not estimates of how past societies worked.
- Scenario figures are game values; the polities and rulers follow the standard record only as a setting.
- A result characterizes the simulator and its agents' policy, not history, and is never empirical evidence.
- Agents are the deterministic rule-based policy; model-driven agents are not admitted as experiments.
- Native and WebAssembly builds of this engine version reproduce identical state hashes; other versions are refused.
