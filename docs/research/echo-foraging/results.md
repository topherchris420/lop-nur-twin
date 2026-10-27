# ECHO olfactory research results

Generated from `7174595600c91eca3aa335384f88655d258cb6ec`; fingerprint `4acf7bba15a42d44b84d832525fa9b377180dd656d3d73a1d91a738cb49a8bde`.

| Check                                      | Result                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| Published-equation numerical comparison    | Passed; maximum error 5.966e-7                                           |
| Odor-window upwind alignment               | criterion met; mean gain 1.031, 8/8 improved pairs                       |
| Synthetic source approach                  | criterion met; mean closest-distance reduction 95.5%, 8/8 improved pairs |
| Motor command refusals                     | 0                                                                        |
| ECHO prediction/command mismatches         | 0 in 38348 walking checks                                                |
| Identity and future behavior after restore | Passed at 60, 600 and 3,600 simulated seconds                            |

Eight paired evaluation seeds, two 60-second walking assays, enabled and disabled sensory extension. Every trajectory and failure is included in report.json. Criteria were fixed in the source before these evaluation seeds were run. This is not independent validation or a registered R.A.I.N. experiment.

The temporal model adapts to recent odor history; it does not add associative learning or demonstrate open-ended learning. The existing mushroom-body and ECHO models remain in the loop. There is no new spiking-neuron or connectome claim. These are reduced-order body results; MuJoCo locomotion remains unvalidated.

Reproduce: `npm run echo:foraging:evaluate -- --check`. Model and scope: [ECHO_OLFACTORY_NAVIGATION.md](../../ECHO_OLFACTORY_NAVIGATION.md).
