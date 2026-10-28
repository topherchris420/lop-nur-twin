# Olfactory research verification

Validation on October 27, 2026, using Node 24.22.1 / V8 13.6.233.17-node.58 on Linux x64. These are development results for the research extension, not observations of a new controller deployed to the original individual.

Implementation/evaluation source: `7174595600c91eca3aa335384f88655d258cb6ec`; source fingerprint `4acf7bba15a42d44b84d832525fa9b377180dd656d3d73a1d91a738cb49a8bde`. The published report carries both. A result-row TypeScript annotation followed the first evaluation at `a773e41395a93d4e23535fe68c758081aa0b2516`; regeneration changed only source metadata. No model parameter or criterion changed after evaluation.

| Check                                                                                               | Outcome                                                                                                    |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npx vitest run src/bethesda/life src/bethesda/fly scripts/fly-physics-plan.test.ts --maxWorkers=2` | 247 tests, 19 files passed                                                                                 |
| `npx --yes bun run build`                                                                           | Passed, including strict TypeScript and distribution secret scan; 219 files clean                          |
| Scoped ESLint                                                                                       | Passed for new foraging modules, runner and modified research interfaces                                   |
| Scoped Prettier check                                                                               | Passed                                                                                                     |
| `node scripts/run-ts.mjs scripts/fly-source.ts --check`                                             | Existing 34-file fingerprint unchanged: `a96a496c4c00acead32e208158faf7889c31027b8dccde781059a4eb4481f70b` |
| `npm run echo:foraging:evaluate -- --check`                                                         | Generated JSON and summary reproduced byte-for-byte                                                        |
| `npm run echo:immortal:evaluate -- --check`                                                         | Generated JSON and summary reproduced byte-for-byte                                                        |
| `node scripts/run-ts.mjs scripts/fly-calibration.ts --fit --check`                                  | Passed; existing fit.json reproduces exactly ([log](calibration-check.txt))                                |
| Previous immortal-study outcome comparison                                                          | Every result identical to archive-v1 after excluding commit/fingerprint metadata                           |

The 10 new tests cover temporal adaptation and recovery, independent ODE integration, wind/hunger gating, search without a wind bearing, feeding/escape/landing/edge priorities, invalid-state refusal, exclusion of privileged input, actual body movement, matching ECHO prediction to commanded movement, disabled-path regression, read-only inspection, archived identity/history/weight/RNG restoration and the original v1 graph digest. The existing 237 tests remain green.

The generated report contains all 32 short assay trajectories (eight paired seeds, two conditions), including unfavorable time points. Prespecified orientation and source-approach criteria were met in this synthetic walking rig. The mean closest-distance reduction was 95.5%; all eight paired seeds improved. This is neither real-fly validation nor a general food-seeking success rate. There was no food reward in those assays. Zero commands were rejected and 38,348 walking prediction checks found no mismatch with the actual commanded speed/turn.

A separate persistent research individual retained identity and exact future behavior across restores at 60, 600 and 3,600 computed seconds. Its real simulated feeding uses the existing mushroom-body learning path. This does not turn the earlier four-arm learning result into a success: that study remains inconclusive.

The existing reduced-order body and production model versions are unchanged. Physics-readiness remains blocked as documented in the earlier assessment; this work does not validate MuJoCo locomotion. No production checkpoint, live service, garden rendering, or original individual was modified. Original-specific backup/migration rehearsal and separate deployment approval remain required.

## Existing archive replay gap

The additional `npm run rain:fly -- --pilot --check` check **failed**: the four non-ECHO pilots reproduced, while `echo_impairment`, `echo_attribution`, `echo_retention`, `echo_attention` and `echo_metacognition` did not match their archived run/output digests. The archive seals and definitions were not reported corrupt. No archived pilot, threshold or claimed result was rewritten to hide this failure.

A representative `echo_impairment` check on the unchanged pre-extension worktree produced exactly the same mismatching digests. Repeating it with the archive's Node 24.19.0 / V8 13.6.233.17-node.51 also gave that mismatch. The Node-version difference alone therefore does not explain it. The underlying cause remains unresolved. The existing fly/ECHO simulation and pilot code did not change in this extension.

Logs: [full pilot check](legacy-pilot-check.txt), [unchanged baseline check](baseline-impairment-check.txt), [recorded Node-version check](pinned-impairment-check.txt). The two new research reports reproduce on the tested environment; this does not establish cross-machine or historical exact replay. Resolve the legacy discrepancy before relying on those archived pilots as a deployment gate.

### Resolution, later on October 27, 2026

The cause was found afterwards and is recorded in [cross-platform replay of the fly pilots](../echo-replay/README.md). The archive was recorded on Windows on ARM64 and reproduces there, all nine pilots byte for byte. On Linux x64, the one difference that reaches the ECHO pilots is `Math.pow` with a fractional exponent, in the self-model's noise rescaling. On Linux arm64, which the production VM runs, all nine pilots differ, the four non-ECHO pilots included. The finding above stands as it was recorded: no pilot record, threshold or result was changed.
