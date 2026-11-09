# ECHO Intelligence Metrology Bench

**Status: implemented, tested, and run once on its first question (dev and frozen
held-out splits). Research subjects only.** The bench measures whether a change
to a simulated fly's controller produces better adaptive behaviour, and where it
does not. It gives no universal intelligence score: each finding belongs to one
protocol, one set of conditions, one software revision. More complicated is not
necessarily more intelligent, and the bench is built so that "it is active" or
"it is bigger" can never pass for "it helped".

It never touches the two originals. Eva and ECHO's stores, checkpoints, random
streams, memories, histories and live learning policies are not read, written or
replaced; no benchmark result promotes anything to either living simulation; a
merge of this code changes neither fly.

## The first question, answered

**Does ECHO's embodied plasticity improve adaptive behaviour under locomotor
impairment?** On the frozen held-out split: **INCONCLUSIVE.** The plasticity
learned the impairment every time it met one, slowed the fly's walk as designed,
and did not measurably help it eat. The protocol (`plasticity-locomotor-v1`,
digest `da8270ae…`) was frozen before the dev split and not changed after it.

|                                             | Dev                                                           | Held-out (frozen)                                                         |
| ------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Research subjects × conditions              | 6 × 9, 186 runs                                               | 40 × 9, 1240 runs, seeds derived from the protocol digest                 |
| Overall                                     | INCONCLUSIVE                                                  | **INCONCLUSIVE**                                                          |
| C1 energy taken in, weak legs (δ = 0.128 J) | +0.001 J (97.5% −0.048 to 0.070): no demonstrated improvement | −0.011 J (97.5% −0.043 to 0.020): no demonstrated improvement             |
| C2 meals, weak legs (δ = 1)                 | −1.33 (97.5% −4.00 to 0.67): inconclusive                     | −0.68 (97.5% −1.68 to 0.28): inconclusive                                 |
| Validity checks                             | all passed                                                    | all passed; 160 of 160 shadow and disabled runs identical to the baseline |
| Verification                                | 12 of 12 replayed runs byte-identical                         | 12 of 12 replayed runs byte-identical                                     |

What the held-out split adds, by question:

1. **Better than the deployed controller?** No improvement was demonstrated.
   Energy intake under weak legs: any effect is smaller than the minimum that
   would matter. Meals: the interval leans negative and is too wide to decide.
2. **A mechanism, not complexity?** There is no improvement to attribute. Acting
   on what was learned did no better than a fixed slow gait (−0.002 J, 98.8%
   −0.036 to 0.033) or than learning without acting (−0.011 J); both are inside δ.
3. **Unseen conditions?** In 7 conditions the candidate's development never
   met, no improvement anywhere. Under **severe weak legs** the plasticity
   **regressed**: −0.043 J (99.7% −0.077 to −0.008; 30 of 40 subjects worse).
   That is a corrected, statistically clear harm, though smaller than δ. The
   largest positive reading, after the impairment wears off (+0.040 J, 99.7%
   −0.003 to 0.083), is not one.
4. **Does experience change later behaviour?** Yes, internally and in gait: in
   every impaired condition it acted in, it detected the impairment in 100% of
   subjects (mean 163–337 s), raised no false alarms, slowed about 8,000 to
   44,000 walking decisions per 2-hour run (each one 50 ms control step), and released
   the caution in every subject once the legs recovered. That change did not
   become better feeding.
5. **Cost?** On this laptop, on battery, one process: 6.9% more CPU than the
   organism (95% −3.1% to 22.8%, not resolved), 6,594 bytes of plasticity
   state, 9 added parameters, decision latency 0.018 ms at the median for both.
   Performance per unit of computation is left undefined: there is no
   improvement to divide.
6. **Where does it vanish or reverse?** It reverses under severe weak legs. It
   never acted in the unimpaired, mild and asymmetric conditions, so no effect
   was possible there. And the impairment did not cost the baseline anything
   measurable in five of eight impaired conditions, so a null there says
   nothing about compensation. Weak legs themselves cost the baseline
   −0.038 J (95% −0.069 to −0.006): a real but small handicap, below δ. The
   assay leaves little room to show compensation, and that limit is reported,
   not tuned away.

**Reproduction of the 2026-11-07 finding.** All 96 held-out weak-legs runs of
the original study re-ran byte for byte with today's code (96 of 96 identical),
and its own primary result came out identical: active minus original, meals,
+0.17 (95% −1.00 to 1.33), no difference established. Its archive is untouched.
Read through this bench's rules, the same records give meals INCONCLUSIVE and
energy NO_DEMONSTRATED_IMPROVEMENT.

**Connectome backends.** 31 sealed fly-neural results were read, not re-run.
29 seals verified; 2 (`echo-mb-v2`) carry no seal, and none is broken. They
count as neural-model validation only, with no behavioural verdict, and FAFB v783
and BANC v888 are kept apart. A behavioural comparison of a connectome-driven
research fly under this protocol was **not run**: the whole-brain model costs
3.27 wall seconds per simulated second, about 6.5 hours per 2-hour run, and a
protocol needs hundreds of runs.

### What this does and does not establish

- **Implementation complete:** protocol, controllers, runner, telemetry,
  statistics, verifier, archive, adapters, CLI, research view and tests.
- **Experimentally verified:** both splits, the reproduction, the compute
  benchmark and the connectome read-out are archived with manifests. Both
  splits re-derive byte for byte and replay on the platform that made them.
- **Scientifically inconclusive:** the plasticity's benefit under locomotor
  impairment is neither shown nor ruled out on meals, is ruled out at the
  δ = 0.128 J scale on energy, and reverses slightly under severe weak legs.
  The held-out subjects are now spent. A new question needs a new protocol
  with new seeds, not a rerun of this one.

Archives: [`plasticity-locomotor-v1/heldout`](benchmarks/echo-metrology/plasticity-locomotor-v1/heldout/README.md),
[`dev`](benchmarks/echo-metrology/plasticity-locomotor-v1/dev/README.md),
[`compute`](benchmarks/echo-metrology/plasticity-locomotor-v1/compute/README.md),
[`reproduction-288b3a8`](benchmarks/echo-metrology/reproduction-288b3a8/README.md),
[`neural`](benchmarks/echo-metrology/neural/README.md). The research view is at
`/metrology`.

## What it answers

Every protocol answers the same six questions from its own numbers, in its
generated report:

1. Does the candidate outperform the existing controller under controlled conditions?
2. Can an improvement be attributed to a mechanism, not to complexity, seeds or compute?
3. Does it generalize to conditions the candidate never met?
4. Does experience measurably change later behaviour?
5. What does it cost computationally?
6. Where does the apparent improvement vanish or reverse?

The overall outcome is one of **IMPROVEMENT**, **NO_DEMONSTRATED_IMPROVEMENT**,
**REGRESSION**, **INCONCLUSIVE** or **INVALID**.

## How it is built

| Part                     | Where                                                    | What it does                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Experiment specification | `src/bethesda/metrology/protocol.ts`, `protocols/*.json` | Versioned (`eimb-protocol/v1`), strict: unknown or missing fields at any depth are refused. Hypotheses, prior knowledge, controllers, conditions, endpoints with their minimum meaningful effects and the rule that set each, analysis, decision rules, stopping rule. Its SHA-256 is its identity.                              |
| Controller interface     | `controllers.ts`                                         | The real controllers, never stand-ins: the deployed `OrganismAdapter`, `echo-embodied-plasticity/v2` in active, shadow and disabled modes (`PlasticityOrganismAdapter`), and the plasticity study's fixed-slow gait. Each declares whether it learns, when it acts and the parameters it adds.                                   |
| Runner                   | `life.ts`, `runner.ts`                                   | One research subject per unit: the plasticity study's step loop exactly (`life.test.ts` steps both side by side and compares body, controller and food byte for byte), plus an instrument that only reads. Bounded by a wall-time limit; a run that exceeds it or throws is recorded as `timeout` or `error`, never as a result. |
| Telemetry                | `runner.ts` (`eimb-record/v1`)                           | Sixteen behavioural metrics, per-block trajectories, the plasticity's detection, false alarms and release, ECHO's self-model belief and calibration, the environment digest that proves pairing, the final body hash, and compute kept apart from behaviour.                                                                     |
| Statistics               | `statistics.ts`, `analysis.ts`                           | Paired differences per research subject; percentile bootstrap (seeded, 10,000 resamples); effect size dz; exact sign test; Bonferroni per family; decisions against each endpoint's minimum meaningful effect δ; guardrail regressions; exploratory metrics read, never decided.                                                 |
| Verifier                 | `verify.ts` and `verify` in the CLI                      | Trusts nothing an archive says: re-hashes every file, checks the protocol is the frozen one, re-derives the held-out seeds, recomputes the summary and re-renders the report byte for byte, and re-simulates a sample of runs on the platform that made them.                                                                    |
| Archive                  | `archive.ts`, `docs/benchmarks/echo-metrology/`          | `protocol.json`, `records.jsonl`, `machine.json`, `summary.json`, `README.md`, a manifest of their SHA-256s, and `verification.json`. Existing archives are read through versioned adapters and never rewritten.                                                                                                                 |
| Adapters                 | `legacy.ts`; `scripts/echo-metrology-connectome.ts`      | The 2026-11-07 plasticity study's archive (reproduced, schema untouched), and the connectome research backends' sealed results (neural-model validation, kept apart from behaviour).                                                                                                                                             |
| Research view            | `/metrology` (unlisted), `src/bethesda/metrology/view/`  | Renders only archives whose summary and protocol hash, in the browser, to their manifest's digests and whose committed verification names that manifest and says VERIFIED; a table for every chart; no green unless a criterion passed.                                                                                          |

### Decision rules

For one comparison, with its interval at the family's corrected level:

- **REGRESSION**: the interval lies wholly on the worse side of zero, even when its mean is smaller than δ (the report says so). Harm is not excused for being small.
- **IMPROVEMENT**: the interval lies wholly on the better side and the mean reaches δ.
- **NO_DEMONSTRATED_IMPROVEMENT**: the interval lies wholly inside (−δ, +δ): any effect is too small to matter.
- **INCONCLUSIVE**: anything else.

Overall: **INVALID** if any validity check fails (an incomplete design, a record
bound to another protocol, any failed run, an unpaired environment, a validity
controller that differs from the baseline, a subject that is not a research
subject). Otherwise a confirmatory regression is a **REGRESSION**; an
improvement with no regression and no guardrail harm is an **IMPROVEMENT**; an
improvement with a guardrail regression is **INCONCLUSIVE** (a trade-off, not an
improvement); a guardrail regression alone is a **REGRESSION**; all confirmatory
endpoints inside δ is **NO_DEMONSTRATED_IMPROVEMENT**; anything else is
**INCONCLUSIVE**. Internal measures (detection, self-model accuracy) never
decide a behavioural verdict.

### Controls

- **Baseline**: the deployed organism, no plasticity.
- **Candidate**: the plasticity in active mode.
- **Simpler control**: a fixed slow gait. It slows every walk, always, with one added parameter, and it tests whether learning matters or slowing alone would do.
- **Ablations**: the plasticity in shadow mode (it learns and never acts) and disabled mode (it neither learns nor acts). Both must behave exactly as the baseline, every metric plus the final body and controller hash, or the experiment is INVALID.
- **Paired seeds**: every controller of a unit is born from the same genesis (seed, heading, food and perturbation schedule, random streams), and the environment digest proves it.
- **Separate splits**: dev seeds are listed and looked at. Held-out seeds are derived from the protocol's digest, skip every seed an earlier study used, and run once from a clean commit after the dev records are committed. Each shard records its commit beside its records, and `collect` refuses records made by any other code.

### Experiment families

| Family                           | What it measures                                             | In the first protocol                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Motor adaptation              | Recovery after impairment, compensation, speed of adaptation | Weak legs (three severities), asymmetric gait, recovery after the impairment ends. Sensorimotor delay is not supported by the perturbation model, so it is not tested. |
| B. Learning from experience      | Whether past experience changes later behaviour              | Detection time, walking decisions slowed per run (each decision is one 50 ms control step), release after recovery, late intake (`lateFedJ`).                          |
| C. Prediction and self-model     | Forecast accuracy, calibration, detection of change          | ECHO's self-model belief against the truth, 50% and 90% interval coverage, inquiries before and after onset.                                                           |
| D. Generalization and robustness | Unseen conditions and combinations                           | Seven conditions the candidate's development never met, including a combined impairment, a low-energy start and a different food geometry.                             |
| E. Compute efficiency            | Cost of the improvement                                      | CPU and wall time, decision latency, state size, added parameters (`compute`).                                                                                         |

## Running it

```sh
# The frozen protocol, its digest and both splits' seeds
node scripts/run-ts.mjs scripts/echo-metrology.ts protocol --protocol plasticity-locomotor-v1

# Run a split in shards (resumable; never reruns a recorded unit)
node scripts/run-ts.mjs scripts/echo-metrology.ts run --protocol plasticity-locomotor-v1 --split dev --shard 0/7 --out shard-0.jsonl

# Collect the shards, derive the summary and report, verify with a re-simulated sample
node scripts/run-ts.mjs scripts/echo-metrology.ts collect --protocol plasticity-locomotor-v1 --split dev shard-*.jsonl
node scripts/run-ts.mjs scripts/echo-metrology.ts report --protocol plasticity-locomotor-v1 --split dev
node scripts/run-ts.mjs scripts/echo-metrology.ts verify --protocol plasticity-locomotor-v1 --split dev --replay 12 --write

# Compute benchmark, reproduction of the 2026-11-07 archive, connectome adapter report
node scripts/run-ts.mjs scripts/echo-metrology.ts compute --protocol plasticity-locomotor-v1 --reps 2
node scripts/run-ts.mjs scripts/echo-metrology.ts reproduce --shard 0/1 --out repro.jsonl
node scripts/run-ts.mjs scripts/echo-metrology.ts reproduce-report repro.jsonl
node scripts/run-ts.mjs scripts/echo-metrology.ts neural
```

`bun run echo:metrology -- …` is the same command. A held-out split refuses to
run or collect from a working tree with uncommitted changes under `src/` or
`scripts/`. A 2-hour run takes about 10 s on the machine named in each archive.
Byte-exact replay holds only on the platform that made the records
([why](research/echo-replay/README.md)), so CI checks every archive statically
and accepts its `verification.json` only if it names the current manifest and
records a matched replay.

## Isolation

- Subjects are named `research-eimb-…`. `refuseOriginal` runs on every subject the life is given and on every record the analysis reads.
- The library modules import only the research yard: no store, file, network, server or release, and no clock or randomness of their own (`scope.test.ts`). Nothing deployed imports the bench, and nothing under `deploy/` names it.
- The plasticity study's boundary (`src/bethesda/plasticity/scope.test.ts`) names the bench's two modules explicitly, rather than loosening its rule.
- The connectome adapter lives in `scripts/`, because nothing under `src/` may name that backend. It reads sealed results and never runs a model or puts one in a fly's place. Running 139,255 modelled neurons is not biological equivalence.
- No result promotes anything. Activating a controller on either original is the owner's decision under [EVA_ECHO_ACTIVATION.md](EVA_ECHO_ACTIVATION.md), not this bench's.

## Tests

`src/bethesda/metrology/*.test.ts` and `scripts/echo-metrology-connectome.test.ts`:

- **Determinism**: the same unit gives the same record.
- **Baseline equivalence**: the bench's life against the study's life, byte for byte; shadow and disabled against the baseline.
- **Paired fairness**: environment digests across controllers.
- **Statistics**: bootstrap reproducibility, the sign test, the decision zones.
- **Protocol schema**.
- **Negative and null outcomes**: every verdict produced from synthetic records built to deserve it, including INVALID for each way a design can break.
- **Corrupted and tampered archives**, including a re-sealed manifest.
- **Isolation and original refusal**.
- **The legacy reproduction**, and the connectome seals.
- **Every committed archive**, re-verified on each CI run (`archives.test.ts`).
- **The research view's gate**: it opens on the committed archive and stays shut on a changed summary or protocol, a verification of another manifest, or a missing file (`view/archiveGate.test.ts`).
