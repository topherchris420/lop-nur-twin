# Verification record

Update: the olfactory-extension interface refactor regenerated the current report with new source metadata and identical outcome objects. The initial report and this initial verification narrative are preserved in `archive-v1/`. See [the current extension verification](../echo-foraging/verification.md) for the 247-test regression and reproducibility checks.

Implementation source: `f7283da505cc36379c4c028c7a8e30fe22fbb9c6`.
The generated [results](results.md) and [full report](report.json) identify
the source fingerprint and prespecified protocol. No parameters or success
criteria were tuned after viewing the held-out results.

| Check                                                                                               | Outcome                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run src/bethesda/life src/bethesda/fly scripts/fly-physics-plan.test.ts --maxWorkers=2` | 18 files, 237 tests passed                                                                                                                       |
| `npx tsc --noEmit`                                                                                  | Passed                                                                                                                                           |
| ESLint on the new modules, runner and two injection interfaces                                      | Passed                                                                                                                                           |
| Prettier on all changed source, documentation and generated results                                 | Passed                                                                                                                                           |
| `npx --yes bun run build` (Bun 1.4.4)                                                               | Passed data validators, manifest/history verification, Vite bundle, strict type check and distribution secret scan; 219 distribution files clean |
| `npm run echo:immortal:evaluate` (Node 24.22.1)                                                     | Completed; all 16 research identities preserved and final restores exact                                                                         |
| `npm run echo:immortal:evaluate -- --check`                                                         | Generated report and summary reproduced byte for byte                                                                                            |
| Full reduced-order organism endurance                                                               | 60, 600 and 3600 simulated seconds, with exact future behavior after checkpoint/restore and zero rejected commands                               |
| Tissue-only endurance                                                                               | 1 hour, 1 day, 1 week and 31,536,000 simulated seconds; finite state throughout sampled endpoints, recoverable reserves, metered maintenance     |
| Century-offset precision test                                                                       | Short advancement succeeds; this is not a century-long simulated life                                                                            |
| Existing physics readiness gate                                                                     | Blocked, exit 1; [captured assessment](physics-readiness.json), JSON whitespace formatted with Prettier                                          |
| Adaptation success criterion                                                                        | Inconclusive: insufficient valid paired transfer meals; all unsuccessful trials retained in the report                                           |
| Original-specific migration                                                                         | Not performed; the actual backup was not obtained or modified                                                                                    |
| Deployment, merge, service restart                                                                  | None performed                                                                                                                                   |

The optional research injection leaves the existing default body and ECHO
algorithms unchanged; their versions remain `digital-fly/8` and
`echo-self-model/v3`. New behavior is versioned under the research adapter,
research life and physiology versions. Existing checkpoint/upgrade tests,
ECHO tests, mushroom-body tests and city isolation tests passed.

The public witness was read again at `2026-10-27T14:22:46.277Z` and reported
`live`, the same individual
`04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921`,
tick 869161 and the same engine versions. These two dated readings do not
constitute continuous monitoring, but confirm that the observed identity
remained the same while this implementation was tested.

This record is engineering verification, not independent biological
validation. Complete neural and cellular models, locomotion readiness,
open-ended learning, decade-scale whole-organism stability and live migration
remain unestablished. See the [model specification](../../ECHO_IMMORTAL_ORGANISM.md)
and [migration plan](../../ECHO_IMMORTAL_MIGRATION.md).
