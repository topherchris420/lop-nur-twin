# Exact replay of the archived fly pilots across platforms

October 27, 2026. This answers the open question in
[the olfactory verification record](../echo-foraging/verification.md#existing-archive-replay-gap):
why `npm run rain:fly -- --pilot --check` reproduced the four non-ECHO pilots
on Linux x64 but not the five ECHO pilots (`echo_impairment`,
`echo_attribution`, `echo_retention`, `echo_attention`,
`echo_metacognition`). No archived pilot, digest, threshold, parameter or
source file was changed to obtain or to hide any result below.

## Answer

The archive is intact. It reproduces exactly on the platform it was recorded
on, and the differences elsewhere come from the platform's floating-point
mathematics, not from the code or the records.

- **Recording platform.** `docs/benchmarks/fly-pilots/` was recorded
  (`fd5687c`) on Windows on ARM64 with Node 24.19.0. The records name the
  engine (`node 24.19.0 (V8 13.6.233.17-node.51)`) but not the operating
  system or CPU, which is why the earlier check could not tell. On that
  platform all nine pilots reproduce byte for byte
  ([log](windows/win32-arm64-node24.19.0.pilots.txt)); so does
  `echo_impairment` under x64 Node 24.19.0 emulated on the same machine
  ([log](windows/win32-x64-node24.19.0.echo_impairment.txt)).
- **Linux x64: one cause, demonstrated.** The only difference that reaches
  these pilots is `Math.pow` with a fractional exponent: the self-model's
  noise rescaling, `ratio ** 0.025`
  (`src/bethesda/fly/echo/selfModel.ts:636`, in `doubt`). Over a million
  inputs, `Math.pow(x, 0.025)` gives the same results on Linux x64 and Linux
  arm64 and different ones on Windows ([run 2 census](#numerics-census)).
  Computing that one power as `exp(0.025 · log ratio)` on both platforms (a
  diagnostic load-time rewrite, [pow-free.mjs](run2/pow-free.mjs)) makes Linux
  x64 and Windows produce identical run and output digests for
  `echo_impairment`, `echo_attention` and `echo_metacognition`:
  `01f6755b0ff9`, `ef8d79c6a2aa`, `2b2c3adcba0c` on both
  ([Linux x64](run2/ubuntu-24.04-node24.22.1.pilots-pow-free.txt),
  [Windows](windows/win32-arm64-node24.19.0.pilots-pow-free.txt)). These
  rewritten digests are diagnostics, not new records. `echo_attribution` and
  `echo_retention` were not rerun this way; they run the same self-model,
  but that is not shown here.
- **Linux arm64: wider, and not removed by that change.** On Linux arm64
  (GitHub's `ubuntu-24.04-arm`, Neoverse-N2), the platform the production VM
  runs, **none of the nine archived pilots reproduce, including the four
  non-ECHO pilots**, with Node 24.19.0 or 24.22.1 (identical digests for
  both: [24.19.0](run1/ubuntu-24.04-arm-node24.19.0.pilots.txt),
  [24.22.1](run1/ubuntu-24.04-arm-node24.22.1.pilots.txt)). Fifteen of the
  twenty `Math` functions censused round differently there than on Linux x64
  and Windows, and with the fractional power rewritten the three ECHO pilots
  still give a third set of digests (`1056a0fdbac3`, `c80a1713d2d8`,
  `d61ca5c5ebf4`).

## Hypotheses ruled out

| Hypothesis                                  | Test                                                                                              | Outcome                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Node or V8 version                          | The archive's Node 24.19.0 on Linux x64 (earlier record) and on Linux arm64; Node 24.22.1 on both | Ruled out: each platform gives the same digests on both versions, and two Linux x64 machines agree |
| Corrupt or altered records                  | Seals and definitions check; all nine reproduce on the recording platform                         | Ruled out                                                                                          |
| Squares (`x ** 2`) computed through `pow`   | `pow(x, 2) === x * x` for 5,000,000 random x; every square in the fly code rewritten as `x * x`   | Ruled out on both Linux platforms: equal on every sample, every digest unchanged ([run 1](run1/))  |
| Fractional `pow` alone explains Linux x64   | That one power rewritten as `exp(y log x)` on Linux x64 and Windows                               | Confirmed for three ECHO pilots: bit-identical on both                                             |
| Fractional `pow` alone explains Linux arm64 | The same rewrite on Linux arm64                                                                   | Ruled out: arm64 still differs, and its non-ECHO pilots also differ                                |

## Numerics census

[run2/census2.mjs](run2/census2.mjs) hashes one million results of each
function on inputs built from random bits, so no platform's `pow` shapes the
inputs. Equal digests mean bit-identical results.

| Function                                                               | Windows arm64 / x64 | Linux x64      | Linux arm64    |
| ---------------------------------------------------------------------- | ------------------- | -------------- | -------------- |
| `pow(x, 0.025)`                                                        | `54a8665063d9`      | `5a5bddfb11a6` | `5a5bddfb11a6` |
| `log1p`                                                                | `5489228afdef`      | `5c5c612854d6` | `12a1eb72e05e` |
| `sin cos tan exp expm1 log2 log10 asin acos atan sinh cosh tanh atan2` | same as Linux x64   | reference      | all 14 differ  |
| `log cbrt sqrt hypot`                                                  | same                | same           | same           |

Windows arm64 and emulated Windows x64 agree on every census digest, but
not everywhere: on a separate million inputs, `pow(x, 0.025)` and
`exp(0.025 · log x)` disagree 54,632 times on one and 54,631 on the other
(54,673 on Linux x64, 54,686 on Linux arm64), so rare inputs round
differently even between the two Windows builds. `log1p` is not called by
the fly, ECHO or pilot code. The census cannot say why each
platform rounds as it does; the pattern fits `Math.pow` going to the
operating system's C library (glibc on both Linux builds, the Universal CRT
on Windows) and the other functions to V8's own fdlibm port, built
differently for Linux arm64 (for example, with fused multiply-add). That
build-level explanation was not confirmed.

## What follows

- `--pilot --check` is a same-platform gate. Replaying the archive needs
  Windows with Node 24.19.0. A check on Linux x64 or arm64 fails, and that
  failure says nothing about the archive's integrity.
- Exact replay across platforms would need the simulation to avoid platform
  mathematics entirely, for example a deterministic `Math` replacement in
  JavaScript. That changes every engine's numerics, so it needs new model
  versions, new records, and its own recorded continuation for the deployed
  individual. It is not done here.
- Future records should name the operating system and CPU architecture, not
  only the engine.
- **The deployed individual** lives, checkpoints and restores on one
  platform, the VM's Linux arm64 with Node 24.22.1, and every continuation
  check that gates a commit to its store runs there. A rehearsal elsewhere
  verifies logic, identity, integrity and preservation. Its forward
  trajectories are computed with different numerics, so they are a different
  continuation, never the fly's own. This is why the organism continuation's
  `--check` must also pass on the VM before any `--commit`
  ([cutover plan](../../ECHO_ORGANISM_CONTINUATION.md#cutover-plan)).

## How the evidence was produced

A temporary branch, `diag/echo-pilot-replay`, ran two diagnostic workflows on
GitHub-hosted runners: `ubuntu-24.04` (x64, AMD EPYC) with Node 24.22.1, and
`ubuntu-24.04-arm` (Neoverse-N2) with Node 24.22.1 and 24.19.0. The workflows
and scripts are kept byte for byte as they ran
([run 1](run1/workflow.yml): all nine pilots unchanged, then with exact
squares; [run 2](run2/workflow.yml): the census on pow-free inputs, then
three ECHO pilots without the fractional power). The Windows results were run
on the recording laptop. The branch was deleted afterwards; nothing from it
was merged. Every file in `run1/`, `run2/` and `windows/` is output kept as
it was written.
