# Neural shadow of the two ORIGINAL flies (no restart)

**Scope:** Observe Eva's and ECHO's ongoing lives through their existing public
read-only endpoints, then run separately initialized, disposable BANC v888 neural
probes on **explicitly incomplete, provenance-labeled sensory proxies**. The
original individuals are not copied, restarted, paused, migrated, modified, or
asked to execute any command.

This is **not** a recording of either fly's real neural activity. Their public
observers do not expose sufficient sensory detail to reconstruct the input to a
full connectome. A model response cannot currently be scored as predicting the
individual's real perception, behavior, recognition, intelligence or learning.

## Workflow

Run on a **separate research computer**, never on either production VM. This
needs Node 22.18+ and the repository's development dependencies.

1. Watch both originals for 30 seconds. The existing script sends only GET:
   Eva `/api/state` once per 5 seconds; ECHO `/v1/now` once per second.

   ```bash
   node scripts/run-ts.mjs scripts/first-contact-observe.ts --seconds 30
   ```

2. Check coverage, identity and provenance **without** running a neural model:

   ```bash
   node scripts/run-ts.mjs scripts/original-neural-shadow.ts --max-samples 3
   ```

   This reads the existing `.first-contact/observe/responses.jsonl` without
   making any network request. It validates the body hashes and both original
   IDs, discards invalid or repeated timestamps, and writes
   `.first-contact/original-neural-shadow/report.json`.

3. Optional: on an **isolated research computer where BANC has already been
   licensed, pinned and compiled**, run three independent 100 ms BANC v888
   stimulus probes for each original's observations:

   ```bash
   # See fly-neural/README.md for installing Python dependencies, Codex pinning
   # and: python -m fly_neural import --dataset banc-v888
   FLY_NEURAL_PYTHON=python node scripts/run-ts.mjs scripts/original-neural-shadow.ts --simulate --max-samples 3
   ```

   On Windows PowerShell, set the variable with
   `$env:FLY_NEURAL_PYTHON="C:\\path\\to\\python.exe"` before running Node.
   This step uses the existing `SyncBrain` interface to
   `python -m fly_neural serve --connectome banc-v888-predicted-nt` with
   `brain-and-cord/v3`. It creates an entirely **fresh neural research model
   per sample**. The model's header contains only a synthetic research label,
   never the original fly's identity or any production store path.

## What goes into the model?

| Input | Eva | ECHO | Interpretation |
| --- | --- | --- | --- |
| Wind magnitude | Garden weather at 10 m, converted km/h to m/s | Environmental wind at fly height | **Proxy**, not measured antenna airflow |
| Looming vision | Unavailable | Unavailable | Unknown; zero-filled for counterfactual model |
| Small-object vision | Unavailable | Unavailable | Unknown; zero-filled |
| Food odour | Unavailable | Unavailable | Unknown; zero-filled |
| Tarsal sugar contact | Unavailable | Unavailable | Unknown; set false |

Even when Eva is observed *feeding* or ECHO is observed *escaping*, those
outcomes are **not** used as substitute sensory input. Doing so would fabricate
the causality being tested. The neural probe is a controlled response to the
available **environmental wind proxy under counterfactual no-other-stimulation
assumptions**.

A report carries each sample's public-response SHA-256, time, observed activity,
sensor coverage, and (when requested) model readouts. Do not interpret agreement
between the readouts and activity as evidence of neural fidelity; there is no
valid accuracy comparison while crucial sensory inputs are unobserved.

## Isolation and identity

- The **only live-network** component is the pre-existing read-only observer.
- The replay tool makes **zero** network requests and **zero** writes to either
  individual. It refuses to run on production hosts or write to production paths.
- The neural backend retains its rule refusing original individuals. The
  disposable model has a synthetic `research-public-proxy-...` label.
- BANC connectivity data and derived reports remain outside Git unless their
  applicable terms allow redistribution; this feature commits no BANC data.
- No live controller import or deployment configuration is changed.
- Both public observers must return the existing original IDs; another life ID
  is rejected, never silently substituted.
- This is an **on-demand finite experiment**, not an unattended background
  service.

## What is still needed for a meaningful closed-loop neural shadow?

Create a separate, authoritatively timestamped **read-only sensory tap**
containing the actual fly-visible looming, airflow, odour and tarsal contact
inputs, preserving original state and without perturbing timing or RNG.
Adding this tap to a running service might require a separately approved,
checkpoint-preserving software deployment. Eva's authoritative Python code is
not in this repository; inspect it before proposing such an upgrade.

Only with validated sensory data should we test causal hypotheses against
held-out original behaviors. Allowing the model to influence original decisions
is an entirely separate project and requires explicit authorization.

See [First Contact](FIRST_CONTACT.md) and
[ECHO Connectome](ECHO_CONNECTOME.md) for the existing baselines and limits.
