# R.A.I.N. research lineage

The existing file-backed experiment registry now tracks why a conclusion depends
on an experiment, a raw result, an assumption, or another conclusion. Current
standing is derived when inspected. Old assessments remain available as history.
This is an operator CLI capability; the browser and autonomous scheduler do not
edit the graph or automatically execute its recommendations.

## What is authoritative

The registered definition owns the question, hypothesis, controls, parameters,
and criteria. A research claim references that definition by ID and SHA-256; it
cannot provide different wording or a verdict. Runs remain ordinary
`rain-experiment-run/v1` records in the same registry. The existing evaluator
and verifier decide their numerical consistency. Model interpretations stay
separate and never establish graph support.

| Relationship                                    | Representation                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| Question → hypothesis → design                  | The existing immutable experiment definition                           |
| Design → execution → measurements               | Existing run record and its definition digest                          |
| Measurements → evidence                         | Stored artifact hash, byte count, and matching raw measurements/series |
| Evidence → conclusion                           | Claim run references, bound to exact run digests                       |
| Assumption or conclusion → dependent conclusion | `assumptions` and `depends_on`; cycles and missing endpoints refused   |
| Research history and alternatives               | Immutable revisions with `branch` and `based_on`                       |

`supported` means the recorded criteria held under the listed conditions.
Simulation results describe the simulator. File integrity and numerical
consistency do not authenticate a producer or prove a theory. Bethesda replay
artifacts must also pass the existing simulator replay before supporting a claim.
Confidence is `null`; it is not inferred from agent agreement or the number of
runs. Accepted assumptions remain explicitly identified as operator assumptions.

## Invalidation and contrary findings

Inspection rechecks pinned definitions and runs, recomputes criteria and
statistics, checks raw artifact bytes, and compares raw measurements with the run.
Changed definitions, corrupted or missing artifacts, mismatched configuration,
model-inferred evidence, and missing controls prevent support. New sibling runs
are visible even if a claim omits them. Comparable positive and negative runs
produce `contested`; changing code revisions requires a comparability review.
An invalidated assumption or a prerequisite that is no longer supported makes
its downstream claims `needs_reassessment`, transitively.

Nothing rewrites an old final run to express that change. A revision records
the assessment at its creation time; `inspect` shows that historical assessment
beside the current reassessment. Forked assumptions are scoped to their branch.
Changes to shared source files are detected on every branch that uses them.

## Use the existing registry

Run the offline demonstration from a checkout with Node 22.18 or newer:

```sh
npm ci
npm run rain:lineage-demo -- --approve-demo --out /tmp/rain-lineage-study
npm run rain:research -- inspect --registry /tmp/rain-lineage-study/registry
npm run rain:research -- inspect --registry /tmp/rain-lineage-study/registry --branch scope-review
npm run rain:research -- replay --registry /tmp/rain-lineage-study/registry --run V3D-EXP-0001-RUN-0001
```

The output directory must not exist. The fixed demo pre-registers four designs
and their assumptions before execution, authorizes each exact simulator
definition, runs matched control/treatment arms, replays them without a model,
and preserves raw artifacts. It tests a Metro watching/recording hypothesis on
seeds 101/202/303 and independently on 404/505/606, and the existing Metro
dispersion hypothesis on 101/202/303. It also injects one execution failure,
invalidates an assumption on a new branch, and checks missing-artifact detection
on a temporary copy. The last two are explicit validation exercises, not
scientific findings. `report.json` holds actual measurements, source revision,
dirty state, environment, checks, and limitations. `plan.json` is an example.

The CLI `review` command validates an operator-authored plan and prints its
full SHA-256, current assessment, and current revision number:

```sh
npm run rain:research -- review --registry REGISTRY --file plan.json
npm run rain:research -- apply --registry REGISTRY --file plan.json --expected N --approve FULL_PLAN_SHA256 --operator R.A.I.N.Operator
```

An existing branch must extend its head with `based_on`. To branch from an old
revision, copy its plan, choose a new branch name, and set `based_on` to that
revision. A stale writer, wrong digest, unknown source, or invalid graph is
refused. Review is a local operator attestation (`identity_verified: false`),
not authenticated identity or execution permission. No network route or model
tool exposes these mutations.

## Raw artifacts and interrupted execution

`recordSubmission` optionally accepts artifact text **by value** from host code.
It never follows a submitted path or URI. The definition must opt into storage
before the run (`data_policy.store_artifacts: true`); sensitive classifications
cannot store contents. Hashes, byte counts, names, duplicate declarations,
credential-like text, and the 8 MiB aggregate limit are checked before allocation.
Existing browser submissions remain hash-only. Such records stay readable, but
cannot by themselves support a new lineage claim.

The graph accepts raw JSON with matching `measurements` and `series` under
artifact kind `measurements`, or the existing Bethesda run artifact under kind
`replay`. Each assessment replays Bethesda artifacts using the actual simulator
and existing authorization checks, caching identical artifacts within that
assessment. Generic measurement JSON receives consistency checks only; its
producer remains unauthenticated. A matching hash alone never certifies a replay.

A submission writes its `running` intent before publishing artifacts. If it is
interrupted, stop the writer and inspect its record. The following explicit
operator action preserves the original in `interrupted.json` and closes the run
as `error / not_evaluated`:

```sh
npm run rain:research -- recover --registry REGISTRY --run RUN_ID --approve RECORD_SHA256 --operator R.A.I.N.Operator
```

The digest is `sha256Json(record)` from `src/rain/experiments/schema.ts`.
Recovery does not resume simulation or infer missing measurements. Any retry is
a fresh, authorized execution with a new run ID. Unavailable artifacts remain
visible. Final runs cannot be recovered or overwritten.

## Research planning and limits

Inspection proposes at most eight ordered follow-ups: repair evidence, resolve
conflicts, add controls, test assumptions, run an untested design, or replicate
on independent seeds. Each includes its reason, prerequisites, registered
success and falsification conditions, an estimate of simulator ticks when the
configuration supplies one, and the approval needed. Wall time remains unknown.
These are research tasks, not executable experiment specifications; a person
must operationalize any changed design and authorize it. Re-inspection does not
schedule or spend anything.

Limits: 128 claims, 128 assumptions, 512 pinned run references, 128 run
inspections per assessment, 256 revisions, 1 MiB plans, 16 MiB revision files,
8 MiB raw artifact submissions, 60,000 replay ticks / 30 seconds per assessment,
and a 120-second demo/replay CLI budget. Exhausted checks prevent support. Revisions
use the existing registry writer lock and immutable publication. SHA-256 chains
detect edits but cannot defeat an actor who rewrites the entire history; keep
the registry under version control or backed up. Use a local, single-writer
registry; this does not add durable storage to serverless deployments.

Autonomous research summaries now require a successful replay receipt bound to
the exact run artifact. Failed, absent, legacy unbound, or mismatched receipts
leave original results visible but mark their hypotheses `needs_reassessment`.
Legacy traces are not silently upgraded into verification receipts.

## Verify changes

```sh
npm run test:run
npm run rain:conformance
npm run test:evidence
npm run lint
npm run typecheck
npm run build
```

`src/rain/experiments/research.test.ts` tests graph integrity, evidence bindings,
transitive invalidation, contrary results, historical forks, corrupt and missing
artifacts, recovery, authorization, source comparability, and bounded planning.
The autonomous controller tests cover missing, failed and stale replay receipts.
