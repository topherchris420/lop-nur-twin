# Original experiment compiler requirements

These specifications precede implementation. The public Infera observation supports a staged intent, parse, validation/compilation, operator signoff, execution/audit and analysis workflow, including visible parameter ambiguity warnings. Public client bundles establish a Next/React presentation and a static demo API candidate. They establish neither a scientific compiler implementation nor instrument control semantics. See this directory's evidence index for the retained public observation references. No proprietary source is used here.

## Platform-neutral behavior

1. Treat natural-language intent as proposal context. Convert a closed, versioned data vocabulary into an inspectable scientific intermediate representation; never execute generated code or silently fill scientific parameters.
2. Include hypothesis, domain, observables and physical units, independent/dependent variables, matched controls, bounds, backend, resource ceiling, analysis plan, falsification threshold and evidence provenance. Freeze all evaluation rules before execution.
3. Deterministically reject missing parameters, unsupported units/backends, nonfinite numbers, extra fields, ambiguous comparisons, excessive resources and numerically unsafe plans. Report actionable reasons.
4. Preserve the native Bethesda compiler, envelope admission, preflight, runner, registry and replay through an adapter. An extension must not weaken their checks or alter old definitions.
5. Supply one bounded numerical backend: a linear driven damped oscillator in SI units, underdamped parameter scope explicitly declared, RK4 integration, matched zero-force control and independent closed-form trajectory verification. Declare sample size and numerical error; deterministic time samples are not independent statistical replicates.
6. Require a separately scoped local operator attestation tied to the exact numerical plan digest. Bethesda authority cannot authorize physics execution. Any change of design, tolerance, budget or evaluation threshold requires a new review.
7. Seal successful, negative, interrupted and failed outputs. Recompile and re-execute independently at import/admission; a digest alone is insufficient. Scientifically valid negative results remain valid evidence.
8. Use the existing research journal and experiment registry through typed caller adapters. Numerical evidence must never masquerade as a native Bethesda record. Physical equipment remains unavailable.

## Original acceptance tests

- A complete oscillator proposal compiles into a reproducible digest; omitted units, an unknown field, invalid bounds or unstable timestep is rejected before any run.
- A model proposal alone, a Bethesda approval, a wrong digest prefix, or a tampered plan/authority cannot execute.
- RK4 matched trajectories agree with an independent analytic forced and free response within preregistered displacement and velocity tolerances; tests include resonance, nonzero initial conditions and convergence when the timestep halves.
- Changing measurements, analysis thresholds, version, units, provenance or stopping position breaks independent replay, even if the outer digest is recomputed.
- An approved run and replay produce identical measurements and immutable criteria; a valid negative outcome does not become a process failure.
- Operator interruption retains partial samples and a not-evaluated outcome with a reproducible stopping checkpoint.
- A numerical definition can be preregistered and its replay-verified measurements admitted to the existing registry; mismatched registry snapshots are refused.
- A generated Bethesda design still compiles through the native compiler and executes only through its existing authorization/preflight path.

## Scope and limits

This is an original compiler for two declared simulation backends. It provides neither Infera backend parity nor wet-lab automation. DRR, TRIAD sensing and physical instruments are unsupported. Analytic agreement verifies the specified differential equation and numerical implementation, not a physical model's empirical validity.
