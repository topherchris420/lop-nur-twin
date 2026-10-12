# Procedural research learning

The Research Learning Engine derives recurring procedural errors from the existing
hash-chained discovery journal. It extends the native controller and store rather
than introducing another research runner or scientific registry. Public Mirrors
materials inspired the trace-to-guidance workflow; the implementation and scoring
rules are original. See [the bounded REA investigation](rea-research/mirrors/architecture-findings.md).

Only deterministic `validation` refusals with `ok: false` qualify. Two receipts
with a matching error category establish recurrence. Categories include parameter
grids, unavailable evidence, unsupported capabilities, indistinguishable competing
hypotheses, duplicate protocols and resource envelopes. Failed or inconclusive
scientific hypotheses, valid negative measurements and model criticism do not count
as procedural failures.

Every guidance proposal retains its exact journal receipts, scope, proposer,
generation, immutable version and parent digest. Model-proposed guidance is
tentative. Scopes bind backend, scientific domain, design or deliberation stage,
scenario when specified, and procedural error category. The designer and research
participants receive only matching active guidance. Suggestions cannot alter
scientific criteria, charter ceilings, evidence standing, model identity, the
simulator, admission or replay.

The authority lifecycle consists of separate append-only records:

1. `learning-proposal`: recurrence-linked procedural suggestion.
2. `learning-plan`: held-out tasks, labels, evaluator, scoring version and equal
   call/token/runtime budgets frozen before either arm responds. Task identities
   and origin receipts must be disjoint from proposal evidence. A proposal gets
   one frozen plan and one attempted evaluation. New rules require a new version.
3. `learning-evaluation-start` and `learning-evaluation-answer`: retained paired
   baseline and candidate answers, counterbalanced call order, no access to the
   other arm's answer or held-out scoring labels. Failures remain as
   `learning-evaluation-incomplete` and cannot be retried silently.
4. `learning-evaluation`: independent host recomputation against the unchanged
   native compiler and frozen labels. A two-sided exact paired sign-test p <= 0.05
   improvement in valid proposals and no aggregate metric regression are required.
5. `learning-activation`: a human operator attests review and supplies the full
   beneficial evaluation digest. This approves procedural context only; execution
   still requires the existing independently reviewed experiment charter.
6. `learning-rollback`: review of the exact activation digest, operator identity
   and reason. Prior proposals and evaluations remain inspectable.

State is reconstructed from journal receipts. Evaluation scores are recomputed
from retained answers, not trusted because a record says `beneficial: true`.
Changing scores, evidence, scope or a journal byte fails closed. Superseding an
active version removes the previous version from delivered context. Rollback
removes its guidance and does not silently reactivate another version.

## Installed evaluation and its limits

`evaluateProposal` implements an explicitly **scripted** parameter-grid suite with
eight new held-out Bethesda fire designs. Both arms receive identical questions,
available evidence, populations, seeds and budgets. The baseline submits its
scripted invalid parameters. The candidate fixture can apply the proposed
100-tick instruction before submitting to the same unmodified compiler. Guidance
without that instruction produces no improvement and cannot activate. Other error
families can be recorded and proposed, but their workbench evaluator remains
unavailable until a separately frozen independent evaluation is supplied.

This suite records real compiler refusals and accepted definitions. It reports
sample size, baseline/candidate rates, Wilson 95% intervals, paired wins/losses and
the exact paired sign-test result. Eight corrected designs yield 0/8 versus 8/8
successful compilations and p = 0.0078125. This is a test of a bounded procedural
fixture, **not evidence of improved Qwen intelligence**. Synthetic contradiction
and unsupported-claim labels assess identifier correctness. They do not certify
source entailment, scientific truth or prose quality. Experiment selection checks
a frozen discriminating observable; question coverage refers only to sampled
tasks. Definition repeatability means identical compiler outputs, not simulator
replay. No experiment executes during this benchmark, and unreported tokens stay
unknown.

The Wilson intervals and paired p-value are algorithmic summaries under binomial
and exchangeability assumptions. Deterministic related fixtures do not establish
those assumptions and cannot support population-level statistical inference.

`freezeLearningEvaluation` and `evaluateFrozenLearning` also accept a bounded
participant adapter for separate model calls. The adapter receives identical
context in each arm, with guidance only in the candidate arm. Such evaluations
must retain genuine provider provenance in the surrounding controller and declare
their generation accurately. An enforced token budget refuses missing accounting.

The procedural evaluation records remain separate from authoritative scientific
results. Any broader intelligence claim requires larger independent question sets,
actual model proposals, validated simulation execution and human scientific review.

Implementation: `src/rain/research/learning.ts`, `learningEvaluation.ts`, and the
browser-safe `src/bethesda/rain/learningProtocol.ts`.
