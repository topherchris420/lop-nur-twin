# Can R.A.I.N. improve experiment selection?

A bounded benchmark compares direct model selection with model-generated counterfactual probabilities and a deterministic expected-information selector. The planner gets one experiment per case. The host computes binary mutual information in bits for equal-prior rivals, regret relative to the best candidate and expected Brier loss when forecasts exist. The model cannot provide scores or execute a design. The separate Python verifier reconstructs outcomes and scores from the fixed generator and raw model receipts.

The protocol was committed locally before inference and simulation. Two structured prompt styles competed on nine development cases. The lower-regret style was frozen per model and compared against direct choice, first-in-list and the fixed pilot rule on 18 disjoint cases. Three domain labels share one synthetic probability template. Candidate order varies. The pilots encode exact simulator probabilities, which makes this a test of using controlled evidence and planning a one-step comparison. It leaves open multi-step design, noisy or misspecified pilots, domain transfer and genuine scientific novelty. This adapts a prompt policy without changing model weights. The 0.5B result compares matched tasks and model size within this benchmark. The historical planner's earlier prose attempts are not scored as a paired control.

| Method | Qwen2.5 0.5B bits/case | Qwen2.5 1.5B bits/case |
| --- | ---: | ---: |
| Direct selection | 0.236 | 0.325 |
| Development-selected structured prompt + information gain | 0.443 | 0.236 |
| First in list | 0.177 | 0.177 |
| Fixed pilot rule | 0.531 | 0.531 |

The smaller model gained 0.207 bits/case. The larger model lost 0.089 bits/case, despite using the prompt that led on its development cases. The fixed rule remained best. All held-out outputs were structurally valid. These are descriptive results from one quantized checkpoint per size and one shared template, with no blinded human rating or independent domain replication.

## Freshness ablation

The two policies share the same causal heart-rate estimates and a 65% beat-coverage floor. One also requires a PPG sample from the preceding half-second to have arrived by decision time. Eight new paired seeds per model use identical optical values and acquisition timestamps in timely and delayed arms. The delayed arm adds three seconds to availability over a fixed interval. Three pulse models include a new asymmetric train with impulse noise. They share timing, motion traces and beat detection.

| Delayed feed | Coverage-only accepted | With freshness accepted |
| --- | ---: | ---: |
| CIRCLE | 65/160 | 49/160 |
| Alternative pulse | 67/160 | 51/160 |
| Asymmetric impulse | 70/160 | 54/160 |

The freshness filter cost ten percentage points under delay in each model. Timely acceptance was unchanged. Both policies had zero accepted errors above 3 bpm in every tested arm. The paired whole-seed bootstrap reproduced the same ten-point coverage loss across draws. That degenerate interval reflects the repeated simulated schedule and provides no estimate of uncertainty across other delay schedules. Under independent, identically distributed seed draws, zero seed clusters with a freshness-policy error out of eight gives a one-sided exact 95% upper bound of 31.2% for the chance that a seed has any such error. This is a seed-level bound. It does not estimate per-window reliability or physical performance.

## Reproduce

The model receipts contain the requests and actual local responses. Re-score them without model weights:

```bash
study=experiments/crosslab/planning
for model in qwen-0.5b qwen-1.5b; do
  python "$study/verify_benchmark.py" "$study/protocol.json" \
    "$study/record/$model-dev.json" "$study/record/$model-heldout.json"
done
```

To run fresh inference, configure the existing uncredentialed loopback LM Studio-compatible endpoint with `RAIN_LMSTUDIO_URL`, `RAIN_MODEL` and the model file digest in `RAIN_CROSSLAB_MODEL_SHA256`. Use `node scripts/run-ts.mjs scripts/rain-planning-benchmark.ts PROTOCOL OUTPUT develop`, then use `heldout DEVELOPMENT_RECEIPT` in place of `develop`.

To replay the freshness ablation, use Python 3.12 with NumPy 2.3.5 and jsonschema 4.26.0, and a clean CIRCLE checkout pinned by the [replication protocol](../replication/protocol.json):

```bash
OPENBLAS_NUM_THREADS=1 python "$study/freshness.py" ../circle /tmp/freshness-replay
python "$study/freshness.py" ../circle /tmp/freshness-replay --verify
```
