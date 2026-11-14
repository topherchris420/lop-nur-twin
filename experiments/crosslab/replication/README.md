# R.A.I.N. CIRCLE × TRIAD compound-motion replication

Lop Nur Twin is the active R.A.I.N. Lab. The [historical record](../history/) preserves the earlier inconclusive verdict and the first threshold follow-up. This experiment asks what survives when contact loss overlaps heavy motion.

## Registered design

The protocol was committed locally before either held-out run. Four new seeds fit each generator's original threshold on clean windows. Eight disjoint seeds supply paired motion-only and motion-plus-contact-loss sessions. All 160 scheduled windows per generator and fault count toward coverage. CIRCLE runs in sham mode. The alternative generator replaces the beat schedule and optical waveform while retaining CIRCLE timing, IMU and reconstruction. This is a computational replication across seeds and signal generators, with shared instrument code.

Each candidate must retain at least 25% of windows, keep accepted errors over 3 bpm at or below 5%, and increase error by no more than two percentage points over the original gate **in every stratum**. Missing estimates cannot enter the numerator. The accept-available control checks whether simply loosening the gate wins. The beat-exclusion diagnostic compares error on windows with estimates in both arms. The compound-fault diagnostic compares availability on paired schedules.

## Result

| Policy | CIRCLE motion / compound | Alternative pulse motion / compound |
| --- | --- | --- |
| Original | 30 / 30 | 32 / 32 |
| 75% beat coverage | 48 / 48 | 48 / 48 |
| Fresh PPG and 65% beat coverage | 66 / 66 | 65 / 65 |

Each cell is accepted windows out of 160 per condition. All accepted counts above had zero errors over 3 bpm. Both alternatives met the descriptive screen in all four strata. Accept-available failed the excess-error screen on CIRCLE. On the alternative pulse generator, removing beat exclusion increased errors among common estimates by 31.94 points under heavy motion and 12.50 points under compound motion. Contact loss reduced available estimates by 38 and 40 windows respectively. Multiple mechanisms survived their registered screens. Their relative contributions to the original result remain unresolved.

The candidate with the freshness rule combines two design changes. Optical attenuation preserves timestamps, so these conditions do not isolate freshness or test a stalled feed. Overlapping windows and eight paired seeds limit generalization. Zero sample errors provide no guarantee of a population error rate. Physical validation and human review remain pending.

## Local model comparison

The existing Lop Nur Twin local-model adapter made two real Qwen2.5 0.5B inference calls. Both outputs named all three mechanisms and earned zero executable contrasts on the qualitative rubric. The fixed historical baseline supplied one executable contrast. The fixed factorial baseline supplied three. The first model attempt repeated predictions as falsifiers. A follow-up validation check rejects that specific pattern. The second attempt still restated historical counts. These are two attempts on one task with an external qualitative assessment, no blinded reviewer panel and no basis for a general efficiency claim. The host's preregistered plan produced the replication results.

The [record](record/) keeps the actual completions, request hashes, token counts and review. To collect another proposal, start a local LM Studio-compatible server and use:

```bash
RAIN_MODEL=your-local-model RAIN_LMSTUDIO_URL=http://127.0.0.1:1234 \
node scripts/run-ts.mjs scripts/rain-crosslab-plan.ts \
  experiments/crosslab/history/prior-studies.json \
  experiments/crosslab/replication/protocol.json /tmp/rain-plan.json
```

This produces an advisory proposal and cannot select code, change criteria, execute a study or authorize a ledger publication.

## Reproduce and export to ATLAS

With Python 3.12, NumPy 2.3.5, jsonschema 4.26.0, Rust 1.100.0 and clean sibling checkouts at the revisions in `protocol.json`:

```bash
export OPENBLAS_NUM_THREADS=1 RUSTUP_TOOLCHAIN=1.100.0
study=experiments/crosslab/replication
work="$(mktemp -d)"
python "$study/run.py" "$work/run" --circle ../circle --triad ../triad --target "$work/build"
python "$study/run.py" "$work/run" --verify
python "$study/atlas_export.py" ../rain-atlas "$work/run" "$work/atlas"
```

Open `$work/atlas/observatory/index.html` to inspect the native ATLAS snapshot. The importer uses a fresh ledger, verifies every artifact and marks scientific verdicts unresolved pending review. Its output is a local observatory snapshot ready for review. Publishing it is a separate action.
