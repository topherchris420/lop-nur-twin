# Bounded CPU scientific campaigns

This implementation extends the active `lop-nur-twin` R.A.I.N. Lab. The archived
`james_library` is historical context. Existing identities, SOUL data, research
records, native charters, city simulation, manuscript workflow and learning
activation rules are preserved.

## Investigation and design choice

The current Lab already has local model adapters, four-persona deliberation,
deterministic experiment compilation, matched simulation arms, preregistration,
source-bound records, replay, a registry, a shared session lock, scientific
knowledge graphs and operator-reviewed procedural learning. Replacing those
systems would erase useful boundaries without demonstrating a scientific gain.

The added capability addresses two concrete gaps: the native heuristic priority
does not calculate discrimination between explicit probabilistic rivals, and its
native backends do not execute the QNP/DRR validation projects. CPU campaigns
provide a small, auditable bridge rather than a general code-executing agent.
See [Autolab evidence](AUTOLAB_REFERENCE.md) for documented, observed and inferred
reference capabilities. No Autolab proprietary implementation was copied.

## Domain and authority

A frozen plan declares rival probabilities, each design's binary predictions,
bounded adapter parameters, correctness criterion, sample counts, seed panels,
family error allocation, work budget, timeout and parent campaigns. It contains
no executable/import path, shell command, provider credential or cloud resource.
An operator separately selects trusted local clones and a Python interpreter.

`server/rain/cpuWorker.ts` snapshots source and license bytes, captures repository
revisions, fingerprints the interpreter and records Python/NumPy/SciPy versions.
Every definition is registered before observations. The full registration digest
binds those sources, frozen rules and native registry definitions. Execution
requires that exact digest and review acknowledgement. This local attestation is
not verified human identity. Native Bethesda standing authority is unchanged;
it cannot authorize these CPU workers, and CPU approval cannot mutate the city.

The optional worker runs trusted, explicitly mapped source. A process timeout,
one-worker scheduling, finite adapter loops and bounded I/O limit accidental work.
This is not hostile-code isolation, descendant-process containment, a total RSS
limit or a cloud scheduler. Distribution versions are checked before and after
work; complete Python/DLL/wheel environments are not cryptographically sealed.

## Scientific decisions

Priority is exact mutual information between a declared rival and **one binary
seed-level observation**, divided by declared work per seed. This is conditional
on the supplied Bernoulli models, not measured whole-batch information or proof
that a rival is scientifically true. Screening updates log likelihoods. Outcomes
assigned zero probability by all rivals reject the model set; they never become
false certainty. Posterior weights may still be misleading under misspecification.

Actual seeds derive deterministically from design ID, panel and frozen base seed
using `cpu-seeds/v1`. Validation rejects collisions across the entire campaign.
Each design therefore has separate screening and confirmation simulations;
conditioned independent RNG sessions are the statistical units. Duplicate physical
protocols are rejected. All panels are reserved at registration against future
campaign reuse, including unexecuted panels. A replay is never new confirmation.

Each fixed-n endpoint uses a two-sided Hoeffding interval. Alpha is allocated as
`family_alpha / (2 * number_of_declared_designs)` before observations; unused
allocations are not recycled. The union bound does not require independence
between claims, but each interval requires independent bounded observations.
There is no optional stopping or criterion mutation. See
[Hoeffding's original paper](https://doi.org/10.1080/01621459.1963.10500830).

Failed independent numeric checks veto support. Both screening and confirmation
must support a campaign claim. Negative findings are also replicated. Missing
data, execution failure, inconclusive inference and falsification remain distinct.
The existing registry independently evaluates submitted bounds against its frozen
criteria. The report re-derives bounds from raw samples and compares the admitted
measurements. Numerical replay through the original adapters is a separate check;
hash consistency alone does not verify physical truth.

## Researchers and interactions

| Caller               | Callee                      | Action                                  | Authority                            |
| -------------------- | --------------------------- | --------------------------------------- | ------------------------------------ |
| Operator CLI         | Campaign controller         | Prepare frozen definitions              | No execution                         |
| Operator CLI         | Campaign controller         | Run exact reviewed envelope             | Bounded CPU scope only               |
| Controller           | Injected worker             | Measure fixed panel                     | Returns observations, never verdicts |
| Controller           | Existing registry           | Admit measurements/artifact             | Registry assigns run status          |
| Controller           | Existing ResearchStore      | Append sealed entries/artifacts         | Shared lock and storage ceiling      |
| Optional model panel | James, Jasmine, Luca, Elena | Four separate, attributed contributions | Advisory IDs, no changed rules       |
| Report               | Existing registry/journal   | Re-derive and inspect                   | Read only                            |

The four original SOUL identities remain unchanged. Optional model deliberation
uses their existing roles, challenges earlier contributions, retains prompts and
answers, and reports actual token counts or unknown. Host structural checks are
labelled scripted; they are not fabricated scientific conversations. Separate
calls to one model are not independent scientific replication.

## Persistence, failure and continuity

All campaign writes use the existing ResearchStore/Registry. Raw observations,
source snapshots, errors, model contributions, negative findings, selected
priorities and reservations extend the shared hash chain. Nothing writes agent
memory back or overwrites previous research. Parent references identify completed
campaigns; the optional panel consumes verified reports as research context.

Resources are reserved before work. Failed reservations remain spent. An unclean
exit retains the native session lock; recovery requires the exact lock digest and
an owner-liveness check. Continuation additionally requires explicit review.
Completed panels are never rerun; only unreserved confirmation can continue.
An interrupted reserved panel remains unresolved. A normal cancelled/error ending
is terminal; a changed hypothesis requires a new plan and new panels. Unknown
interrupted runtime is null. All records remain inspectable.

Strategy comparison is bounded to fixed `fifo` and `information` policies with
frozen criteria and budgets. It never activates new prompts/code automatically.
The existing evaluated-guidance approval and rollback workflow remains the route
for consequential methodology changes.

## Files and verification

| Path                                            | Purpose                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `src/rain/research/intelligence.ts`             | Pure contracts, seeds, priority, inference           |
| `src/rain/research/intelligenceCampaign.ts`     | Native store/registry orchestration                  |
| `src/rain/research/intelligenceDeliberation.ts` | Optional four-seat advisory panel                    |
| `server/rain/cpuWorker.ts`                      | Explicit trusted CPU capability                      |
| `scripts/research-validation/`                  | Pinned NumPy/SciPy probes of unchanged upstream code |
| `scripts/rain-intelligence.ts`                  | Operator entrypoint and immutable exports            |
| `scripts/rain-intelligence-study.ts`            | Frozen validation and policy ablation                |
| `src/rain/research/intelligenceView.ts`         | Offline interactive evidence observatory             |

Acceptance checks cover hand-derived entropy/Bayes/bounds, empty diagnostics,
falsification, independent-check vetoes, disjoint/exposed seeds, exact source-bound
approval, interpreter changes, storage/compute ceilings, errors, explicit
continuation, registry agreement, XSS, semantic access and the bounded real-code
study. Live-model research quality and general scheduler superiority require
further independent experiments.

Rollback: revert the feature commits. Native records remain readable; retain CPU
journals and the producing revision to reproduce these additional experiments.
