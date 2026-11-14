# An assumption challenge that failed its scientific milestone

**R.A.I.N.'s frozen forecast was refuted, but its revised explanation did not survive replication.** This is a negative result, not an autonomous discovery. The evaluation preserved that distinction even though its numerical prediction score improved.

Two genuine local Qwen2.5-1.5B-Instruct calls used R.A.I.N.'s existing local-model adapter. The first received the previous freshness study's actual results and method, proposed a working explanation and a rival, and forecast errors for three bounded interventions. No new measurements were supplied. The host computed expected binary information gain under those forecasts at equal priors. All three scores tied at 0.118709 bits: the registered ordering chose delivery timing. **The model did not distinguish the designs.** No oracle probabilities or answer labels were provided.

The execution used CIRCLE's actual causal availability filtering, beat detector and interval-rate estimator at the pinned revision. It paired identical optical values and acquisition times under timely and three-second-delayed delivery. Constant, rising and falling rates were tested with sixteen discovery seeds and Gaussian pulses. After inspecting discovery measurements, the model froze a revision before sixteen different seeds and asymmetric pulses were generated. This is a within-team computational replication with a different waveform, not an independent laboratory replication.

| Profile | Original error-event forecast | Discovery | Revised forecast | Replication |
| --- | ---: | ---: | ---: | ---: |
| Constant | 70% | 0/16 seeds | 50% | 0/16 seeds |
| Rising | 70% | 0/16 seeds | 50% | 0/16 seeds |
| Falling | 70% | 0/16 seeds | 50% | 0/16 seeds |

The event was at least one **accepted** estimate exceeding the original 3 bpm error limit across a seed's paired arms. The retrospective twenty-second reference remained unchanged; no instantaneous-rate target was substituted. Each profile's exact interval was [0, 25.86%], using Bonferroni-adjusted two-sided binomial intervals for three profiles at familywise 95% coverage. Both 70% and 50% lie outside those intervals. These bounds assume independent seed draws within this fixed simulator; they do not cover simulator misspecification.

The revised forecast's replication Brier loss improved from 0.49 to 0.25. It nevertheless failed the preregistered compatibility requirement. Timely delivery accepted all 48 scheduled estimates in each phase; delayed delivery accepted **none**. Error risk among delayed accepted estimates is therefore **undefined**, not zero. The design cannot identify the error effect of delay among reported estimates. The fixed delivery baseline and selected design coincide, so this run establishes no advantage over the baseline.

## What the model actually got wrong

Its prose asserted “observed differences” between interventions before those results existed, and conflated sample acquisition, delivery and beat exclusion. The archive preserves those words as model-generated text. They never become observations or validated claims. Its revision largely repeated the explanation rather than accounting for complete withholding in the delayed arm. The numerical forecast was testable and refuted; the prose was not independently established as a causal explanation.

The supported finding is narrow: this local model, prompt and task failed to use contradictory evidence to produce a replication-compatible forecast. The lab now detects that failure without rewarding lower Brier loss alone. It has not demonstrated the extraordinary milestone of independently correcting a scientific explanation.

## Registration, controls and limits

- Local protocol commit: `a927e26`; local runner and evaluator commit: `e1be385`. Both precede inference and experimental execution. These are local provenance identifiers; publication through the GitHub API recreates commits with different commit metadata but identical source trees. The raw request, response, model digest, measured token usage, chosen design, intervals, references and source hashes are retained in `record/`. Original source bytes are preserved by digest in `source_archive/` so later verification hardening can check the original run without rewriting it. Those archived files are never executed; full replay compares current execution against every original measurement.
- No valid proposal was retried, and no thresholds, prompts or seeds were tuned after seeing its results. The three-second delay and other candidate interventions were human-authored bounds; this is bounded model planning, not unrestricted experimental invention or weight training.
- The unselected mask-position and optical-noise experiments were not run. Their implementation is not evidence of their outcomes. Both pulse generators share acquisition timing and CIRCLE reconstruction; asymmetry is a limited model variation.
- `verify.py` independently recomputes interval arithmetic, gate decisions, errors and forecast scores. This is a separate implementation, not an independent research group. A full replay also regenerates both sets of measurements. Admission requires the server-reported model name to match the requested attribution (a file digest remains operator-supplied, not a server attestation). ATLAS imports only the manifest-admitted files and independently checked result, never arbitrary neighboring JSON.
- `review.py` is an explicitly **post-run** audit. It adds stricter reporting safeguards for tied designs and empty acceptance sets; it never changes the preregistration or rescues the failed screen. Its per-cell 95% error intervals are descriptive, not simultaneous reliability certificates.
- ATLAS exports these records as synthetic evidence with human scientific review pending. A merge approves code; it does not validate a scientific interpretation.
- No Eva/ECHO state, deployed controller, archive history, or production runtime is changed. No paid model service is used.

## Reproduce without a model

Use Python 3.12, NumPy 2.3.5 and jsonschema 4.26.0. CIRCLE must be clean at `0f231ec41f3a1bd0cf47d347dc2b6068dc5fb7da`; ATLAS must be clean at `a876d458778b0917541a26153d2425b922762480`.

```bash
study=experiments/crosslab/assumptions
python -m unittest discover -s "$study" -p 'test_*.py'
python "$study/verify.py" "$study/record"
OPENBLAS_NUM_THREADS=1 python "$study/challenge.py" ../circle "$study/record" --replay
python "$study/review.py" "$study/record"
python "$study/atlas_export.py" ../rain-atlas "$study/record" /tmp/assumption-atlas
```

The ATLAS export produces a fresh ledger and read-only observatory, without publishing or altering an existing evidence store. CI runs these commands and preserves the export as a workflow artifact. Open its `observatory/index.html` via a local static server.

For new inference, configure an uncredentialed loopback LM Studio-compatible server using `RAIN_LMSTUDIO_URL`, `RAIN_MODEL` and the actual model-file digest in `RAIN_CROSSLAB_MODEL_SHA256`. Run `challenge.py CIRCLE NEW_OUTPUT_DIRECTORY`, then `verify.py NEW_OUTPUT_DIRECTORY --write`. Existing evidence directories are refused. Fresh inference is a new run, not a byte-identical model replay; the committed receipts are the reproducible record of this run.

The next prospective study should test whether evidence-grounded planning can outperform this frozen failure on unseen tasks. It needs explicit distinctions among acquisition, availability and reporting, a meaningful abstention constraint, and a comparator that updates probabilities from counts. Those changes must be registered before new evaluation, rather than used to repair this result after the fact.
