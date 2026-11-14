# Local scientific validation worker

This optional CPU bridge runs unchanged numeric modules from operator-selected
local clones of Quantum Noise Profiler and Dynamic Resonance Rooting. It never
submits a quantum job, contacts a provider, writes upstream results, or executes
model-generated code. The repository mapping is an operator trust decision;
Python imports are not a sandbox for malicious repositories. The Git origin,
project metadata, revision, source hashes and dirty state are recorded. Upstream
package initializers are bypassed to avoid unrelated optional dependencies;
the fixed numeric modules and their relative imports execute from the selected
clone. Source changes during a run fail an integrity check.

Requires Python 3.11+ and the pinned NumPy/SciPy dependencies in
`requirements.txt`. Use a dedicated virtual environment. Development tests use
`requirements-dev.txt`; `python -m pytest scripts/research-validation -q` needs
no external clones for boundary tests. Genuine upstream tests run only when the
operator explicitly sets `RAIN_QNP_REPOSITORY` and `RAIN_DRR_REPOSITORY` to local
clones. Those tests do not overwrite upstream records.

## Process protocol

The host launches a fixed Python interpreter with the fixed `worker.py` path,
no command-line arguments, JSON on standard input, a process timeout no greater
than 300 seconds and an output cap. The host owns persistence and authorization.
The input is at most 65,536 bytes and has exactly these fields:

```json
{
  "adapter": "qnp-stable",
  "parameters": { "method": "sequential" },
  "seeds": [84000, 84001],
  "repositories": { "quantum-noise-profiler": "/operator/selected/clone" }
}
```

Only the host supplies repository paths. A design supplies bounded numeric or
enum parameters; commands, import paths, code, URLs and unknown fields fail.
Seeds are host-issued, unique integer values: one complete simulation per seed.
Paired comparisons use the same seed list. Development seeds must remain
separate from preregistered holdout and replication blocks.

Exit 0 emits a single JSON object with `samples`, `checks`, `details` and
`provenance`. Samples are binary correctness values, one per seed. A failed
check invalidates the evidence even if samples look favorable. Details include
resolved parameters, per-seed input hashes, decisions and interpretation limits.
Provenance contains only relative source paths, hashes, versions and public
repository identity. Diagnostic output is counted and hashed, never presented
as evidence or mixed into the JSON protocol. Outputs are at most 200,000 bytes.
Errors emit an `error.code` object without a traceback or local paths and exit
2 (invalid input/repository), 3 (missing dependencies), or 4 (execution failure).
Failed workers yield no admissible scientific evidence.

## Allowlisted probes

`qnp-stable` and `qnp-drift` use
`qnp.sequential.BinomialThresholdDetector` from
`topherchris420/quantum-noise-profiler`. `method` is `sequential` or `fixed`;
the latter is an explicitly naive baseline that repeats an unadjusted one-sided
binomial test per batch. Defaults are 48 independent batches, 1,000 shots,
threshold and null rate 0.05, alpha 0.05, and (for drift) an alternative rate
0.08 after 12 baseline batches. Stable correctness means no false alarm anywhere;
drift correctness means an alarm after change with no earlier false alarm.
Integrity checks include a separately computed one-batch likelihood-ratio
mixture, zero-error negative control, and overwhelming positive control.
The exact repeated-fixed-rule false alarm probability is computed separately
from the simulation. The sequential alpha bound applies only under its declared
binomial null, not arbitrary physical qubit noise. This probes the threshold
detector, not the full profiler or its drift channel.

`drr-null` uses `drr_framework.modules.RootingAnalyzer` and
`drr_framework.calibration.simulate_ar1` from
`topherchris420/dynamic-resonance-rooting`. Defaults are three independent
stationary Gaussian AR(1) channels, coefficient 0.9, 256 samples, maximum lag 4,
49 surrogates, alpha 0.05 and max-statistic correction. `surrogate_method` is
`circular_shift`, `permutation` or `phase_randomization`. Correctness means no
false edge anywhere in that simulation. A constant-channel negative control
and finite p-value checks must pass. Permutation discards temporal memory and
is deliberately misspecified for correlated channels. Circular shifts also
need empirical calibration at each simulation regime: a small surrogate budget
does not establish nominal false-alarm control. The upstream validated regime
uses 512 samples and 99 surrogates; operators may preregister those parameters.

All outcomes concern known simulated truth. Specificity is not discovery power;
a successful threshold test is not physical validation; a diagnostic gain is
not evidence that R.A.I.N.'s previous version would have made the naive decision.
