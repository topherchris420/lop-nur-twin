# Live Gemma scientific experiment

On 2026-10-12, the operator selected `gemma-4-e4b-it` through the existing
local LM Studio adapter after replacing Qwen. Both retained model answers report
that exact identity. These are original laboratory records, not REA captures.

The first design was rejected before preregistration: 500 integration steps
sampled every step retain 501 samples including the initial state, exceeding its
declared 500-sample budget. The second request supplied that error before any
execution. It returned a complete new design that passed deterministic validation.
Two calls used 774 and 822 prompt tokens, 1,745 and 1,910 completion tokens, and
161,730 and 187,226 milliseconds respectively. One of two drafts compiled; the
adaptive, tiny sample does not establish a general proposal-quality rate or an
independent research improvement. An overlength feedback question was separately
refused by the host before a model call; it did not change the 400-character limit.

The operator reviewed and approved plan
`e1df782557d13ff1defc68e5c7da836b7fcd23bc5a433cd0ad6d0298ec1de133`
before execution. Approval is a local operator attestation with
`identity_verified: false`, not authenticated identity. Treatment and zero-force
control share mass 1 kg, damping 2 kg/s, stiffness 100 N/m, zero initial
displacement/velocity, duration 5 s and timestep 0.01 s. Treatment applies a
5 N cosine force at 10 rad/s. The complete window includes transients; it does
not test the draft's broader steady-state wording.

The frozen success threshold is RMS increase at least 0.000001 m, with
falsification at zero or negative difference. Independent reference guards require
maximum position error at most 0.000001 m and maximum velocity error at most
0.000001 m/s. These criteria were not edited after observing results.

| Actual simulator measurement                | Value                                    |
| ------------------------------------------- | ---------------------------------------- |
| Completed arms                              | 2                                        |
| Execution integration steps                 | 1,000                                    |
| Retained samples across arms                | 1,002                                    |
| Treatment RMS / treatment-minus-control RMS | 0.14856073564305697 m                    |
| Control RMS                                 | 0 m                                      |
| Maximum analytic position error             | 0.000001986569619416567 m                |
| Maximum analytic velocity error             | 0.0000201099170241692 m/s                |
| Deterministic replay                        | Passed                                   |
| Scientific status / registry verdict        | `inconclusive` / `insufficient_evidence` |

Both accuracy guards fail, so the measured increase does not admit a supported
hypothesis. Replay verifies reproducibility, including those guard failures; it
does not imply sufficient numerical accuracy. One matched deterministic initial
condition supplies no population confidence interval or p-value. No physical
measurements or equipment control are involved. A finer-step investigation would
require a new preregistration and separate approval, preserving this result.

Run `NR-a8a07d1d378167287f1a9401`, record
`7f49b3139ef1665331efa7707df9aabf5464fa68f9227f376f13cb0f4f9f1377`,
is admitted as `V3D-EXP-0001-RUN-0001`. The registry retains producing revision
`4a2dfd3fe6569e3f89548dca4605b7b650bf7144` and `dirty: true`, accurately reflecting
the implementation under test. Graph measurements retain verified simulator
standing; neither this run nor thematic corpus links verify manuscript claims.

Inspect the [journal](journal.json), [derived graph](graph.json) and
[demonstration view](demonstration.json). Reproduce chain verification, graph
reconstruction, numerical replay and independent learning rescoring with:

```sh
node scripts/run-ts.mjs scripts/verify-scientific-evidence.ts
```

The original scripted baseline comparison remains separate. No guidance was
activated from this live run, and no live held-out improvement is claimed.
