# Digital fly pilots: not evidence

> **PILOTS.** Exploratory sizing runs on the public pilot seeds. They are not
> evidence: never preregistered, authorized or admitted, and the host never
> draws a pilot seed for an archived run. They describe the digital fly
> simulator only, never Drosophila.

Written by `npm run rain:fly -- --pilot`; nothing here is edited by hand.
Each `<protocol>.json` holds its definition (the apparatus, the control arm,
a series of doses and the seeds), and per seed and summarized: the control and
every dose on the first 32 pilot seeds (SHA-256("rain-fly-pilot/v1|" + counter),
eight 32-bit seeds per digest), a null arm (the control again on the next
32 pilot seeds, paired in order: the same code and arm with every random
stream independent, the apparatus's draws included, so an upper bound on what
trajectory divergence alone can produce), and what the pilot sized. The scripted demonstrations of the four redesigned
protocols (`src/rain/scientific/flyExample.ts`) take their seed counts and
minimum effects from `sized`, and the host's minimum effects for the metrics
the redesign added (FLY_METRICS) come from `floors`;
`src/rain/scientific/fly.test.ts` checks both against these files.

## What each pilot ran on

| pilot | fly version | flySource digest | fly identity | engine | code | runs digest | outputs digest |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| adaptation | digital-fly/7 | `d77a3a3961b0` | `247197565afa` | node 22.22.0 (V8 12.4.254.21-node.33) | `c099a8b816d2` + uncommitted changes | `73752965e854` | `e2882f456e4a` |
| noisy_sensing | digital-fly/7 | `d77a3a3961b0` | `247197565afa` | node 22.22.0 (V8 12.4.254.21-node.33) | `c099a8b816d2` + uncommitted changes | `65ae5b4d32af` | `3bf02c19ae9d` |
| obstacle_avoidance | digital-fly/7 | `d77a3a3961b0` | `247197565afa` | node 22.22.0 (V8 12.4.254.21-node.33) | `c099a8b816d2` + uncommitted changes | `358e3f7e0d50` | `97b352b3a0b4` |
| visual_threat | digital-fly/7 | `d77a3a3961b0` | `247197565afa` | node 22.22.0 (V8 12.4.254.21-node.33) | `c099a8b816d2` + uncommitted changes | `9d5eec4ec291` | `0e4e54818d99` |

`npm run rain:fly -- --pilot --check` re-runs every pilot exactly from its
recorded definition and compares the digests of its runs (final state hashes,
simulated time, gate refusals and measurements) and of its outputs. Identical
digests show that the code still behaves as it did when the thresholds were
sized; any difference fails the check.

## What the pilots sized for the demonstrations

| protocol | demonstration dose | metric | pilot seeds expected / opposite / uninformative | seed count | pass probability | sized minimum effect | host minimum effect | design minimum effect | S1 probability |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| adaptation | repeating a looming stimulus every 10 s on a fixed schedule | repeat_escape_probability (decrease) | 28 / 0 / 4 | 13 | 0.9254 | 0.13 | 0.1 | 0.13 | 0.9534 |
| noisy_sensing | sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) | escape_ttc_s (increase) | 32 / 0 / 0 | 9 | 0.9272 | 0.24 | 0.02 | 0.24 | 0.9679 |
| obstacle_avoidance | turning away from surfaces whose time to contact falls below 0.45 s | cruise_collision_episodes_per_m (decrease) | 31 / 0 / 1 | 10 | 0.9077 | 0.12 | 0.01 | 0.12 | 0.9567 |
| visual_threat | a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) | escape_ttc_s (decrease) | 32 / 0 / 0 | 9 | 0.9272 | 0.28 | 0.02 | 0.28 | 0.9993 |

- **Seed count**: the smallest of 8-16 whose chance of passing G3, G4 (at least 6 untied seeds) and the exact sign test at alpha 0.05 is at least 0.9. The share of seeds in the expected direction is its one-sided 95% lower bound from the pilot, the rest is split between the opposite direction and no information in the pilot's proportions (each counted once more), and the chance that the control sits at a bound in every seed uses the one-sided 95% upper bound.
- **Minimum effect**: the pilot's mean paired difference less 1.645 standard errors (of the pilot and of an experiment at that seed count), rounded down to two significant figures: an effect the size of the pilot's clears it with about 95% probability. A design may not go below the host's minimum effect for the metric, so it uses the larger of the two. The S1 probability is the chance that an experiment at that seed count clears the design's minimum effect if the effect is the pilot's.

## Host minimum effects for the metrics the redesign added

| metric | pilot | resolution | divergence bound | floor | in force |
| :--- | :--- | ---: | ---: | ---: | ---: |
| near_miss_fraction | noisy_sensing | 0 | 0.0264 | 0.03 | 0.09 |
| escape_ttc_s | noisy_sensing | 0.01 | 0.00831 | 0.01 | 0.02 |
| near_miss_fraction | obstacle_avoidance | 0 | 0.0805 | 0.09 | 0.09 |
| escape_ttc_s | visual_threat | 0.01 | 0.0144 | 0.02 | 0.02 |

The floor is the larger of the simulator's resolution (an escape is decided on
a sensory sample, so a timing resolves to one sample period) and twice the
standard error of the mean null paired difference over 8 seeds
(the divergence bound), rounded up to one significant figure. The host uses the
largest floor any pilot found: near_miss_fraction 0.09, escape_ttc_s 0.02.

## Dose series (pilot means over 32 seeds; never tested)

### adaptation: repeat_escape_probability

Control: the same stimuli every 90 s on the same schedule (gate refusals 0).

| arm | control mean | arm mean | mean difference | up / down / tie / undefined | gate refusals |
| :--- | ---: | ---: | ---: | :--- | ---: |
| repeating a looming stimulus every 5 s on a fixed schedule | 0.568 | 0.345 | -0.223 | 1 / 30 / 1 / 0 | 0 |
| repeating a looming stimulus every 10 s on a fixed schedule | 0.568 | 0.362 | -0.206 | 0 / 28 / 4 / 0 | 0 |
| repeating a looming stimulus every 20 s on a fixed schedule | 0.568 | 0.464 | -0.104 | 0 / 22 / 10 / 0 | 0 |
| repeating a looming stimulus every 40 s on a fixed schedule | 0.568 | 0.539 | -0.029 | 0 / 11 / 21 / 0 | 0 |
| null: the control again on the next 32 pilot seeds, paired in order | 0.568 | 0.609 | 0.042 | 16 / 11 / 5 / 0 | 0 |

### noisy_sensing: escape_ttc_s

Control: noiseless sensing (gate refusals 0).

| arm | control mean | arm mean | mean difference | up / down / tie / undefined | gate refusals |
| :--- | ---: | ---: | ---: | :--- | ---: |
| sensory noise of 0.1 (standard deviation 0.06: relative on sizes, distances and light levels, in radians on directions) | 0.089 | 0.128 | 0.039 | 32 / 0 / 0 / 0 | 0 |
| sensory noise of 0.2 (standard deviation 0.12: relative on sizes, distances and light levels, in radians on directions) | 0.089 | 0.199 | 0.109 | 32 / 0 / 0 / 0 | 0 |
| sensory noise of 0.4 (standard deviation 0.23: relative on sizes, distances and light levels, in radians on directions) | 0.089 | 0.386 | 0.297 | 32 / 0 / 0 / 0 | 0 |
| sensory noise of 0.8 (standard deviation 0.46: relative on sizes, distances and light levels, in radians on directions) | 0.089 | 0.680 | 0.590 | 32 / 0 / 0 / 0 | 0 |
| null: the control again on the next 32 pilot seeds, paired in order | 0.089 | 0.090 | 0.001 | 11 / 10 / 11 / 0 | 0 |

### obstacle_avoidance: cruise_collision_episodes_per_m

Control: avoidance off (avoidTtcS = 0) (gate refusals 0).

| arm | control mean | arm mean | mean difference | up / down / tie / undefined | gate refusals |
| :--- | ---: | ---: | ---: | :--- | ---: |
| turning away from surfaces whose time to contact falls below 0.15 s | 0.179 | 0.031 | -0.148 | 1 / 30 / 1 / 0 | 0 |
| turning away from surfaces whose time to contact falls below 0.3 s | 0.179 | 0.007 | -0.171 | 1 / 30 / 1 / 0 | 0 |
| turning away from surfaces whose time to contact falls below 0.45 s | 0.179 | 0.000 | -0.179 | 0 / 31 / 1 / 0 | 0 |
| turning away from surfaces whose time to contact falls below 0.9 s | 0.179 | 0.001 | -0.177 | 0 / 31 / 1 / 0 | 0 |
| null: the control again on the next 32 pilot seeds, paired in order | 0.179 | 0.164 | -0.014 | 16 / 16 / 0 / 0 | 0 |

### visual_threat: escape_ttc_s

Control: the same sphere on the same lines approaching at l/v = 160 ms (0.25 m/s) (gate refusals 0).

| arm | control mean | arm mean | mean difference | up / down / tie / undefined | gate refusals |
| :--- | ---: | ---: | ---: | :--- | ---: |
| a sphere of 4 cm radius approaching the standing fly at l/v = 10 ms (4.00 m/s) | 0.378 | 0.005 | -0.374 | 0 / 32 / 0 / 0 | 0 |
| a sphere of 4 cm radius approaching the standing fly at l/v = 20 ms (2.00 m/s) | 0.378 | 0.040 | -0.338 | 0 / 32 / 0 / 0 | 0 |
| a sphere of 4 cm radius approaching the standing fly at l/v = 40 ms (1.00 m/s) | 0.378 | 0.089 | -0.289 | 0 / 32 / 0 / 0 | 0 |
| a sphere of 4 cm radius approaching the standing fly at l/v = 80 ms (0.50 m/s) | 0.378 | 0.189 | -0.189 | 0 / 32 / 0 / 0 | 0 |
| a sphere of 4 cm radius approaching the standing fly at l/v = 320 ms (0.13 m/s) | 0.378 | 0.738 | 0.360 | 32 / 0 / 0 / 0 | 0 |
| null: the control again on the next 32 pilot seeds, paired in order | 0.378 | 0.379 | 0.001 | 11 / 9 / 12 / 0 | 0 |
