# Native R.A.I.N. research programs

R.A.I.N. can carry a question through collaborative reasoning, source retrieval,
new simulator experiments, evidence-driven follow-ups and an independently critiqued
manuscript draft. This extends the existing discovery controller, registry,
workbench and four research perspectives. The manual workflow and all 44 legacy
designs remain available.

The digital Bell Labs ambition is a continuing research institution. This release
implements a bounded program inside Bethesda: researchers consult Christopher
Woodyard's pinned papers, the pinned `openai/math` catalogue and, with explicit
operator approval, public literature metadata. Their proposals still pass the
native deterministic compiler. No generated program is executed.

## Start with local Qwen

Load a Qwen model in LM Studio and start its server at `http://127.0.0.1:1234`.
The Lab discovers identifiers through `/v1/models`; it assumes no Qwen version.
A unique loaded Qwen identifier is selected automatically. Otherwise set
`RAIN_MODEL` to an identifier returned by your server.

```sh
export RAIN_AUTONOMY_ENABLED=true
export RAIN_MODEL_PROVIDER=lmstudio
npm run dev
```

In PowerShell use `$env:RAIN_AUTONOMY_ENABLED = "true"` and
`$env:RAIN_MODEL_PROVIDER = "lmstudio"` before `npm run dev`.

Enter Bethesda, open the Lab's Research Panel, enter a scientific question, and
choose **Connect Qwen / review research program**. Read the charter, check
the review acknowledgement and enter its eight-character digest prefix. Start the
bounded session. The workbench displays source reading scope, each perspective's
hypothesis and disagreement, execution state, research lineage, delivery gaps,
manuscript critique and downloadable artifacts.

External literature is **off by default**. The checkbox explicitly permits public
query terms to leave the computer. It changes the charter digest and therefore
requires review. Model inference remains local by default in either mode. Project
Inception additionally permits a separately charter-bound server-side collaborator
provider with explicit remote consent; see [configuration and limits](RAIN_INCEPTION.md#collaborator-providers). The optional
adapter queries only the fixed Crossref works API: up to three queries and five
results per query with the default scope. It captures publisher-deposited metadata
and available abstracts, not full papers or arbitrary websites. Redirects,
oversized responses and credential-like queries are refused. Failure is recorded
and stops the current session; no remote inference fallback is used.

For the terminal, use the same question and scope flags for all three commands:

```sh
npm run rain:discovery -- --charter --research --question "How do simulated urban disruptions alter collective movement?"
npm run rain:discovery -- --authorize DIGEST_PREFIX --reviewed --research --question "How do simulated urban disruptions alter collective movement?"
npm run rain:discovery -- --start --research --question "How do simulated urban disruptions alter collective movement?"
npm run rain:discovery -- --status
```

Add `--online` to each of the first three commands to review and run an online
literature scope. Without `--research`, the existing experiment-only workflow is
unchanged. `RAIN_MAX_*`, charter expiry, model timeout and local endpoint settings
retain their existing meanings. Each iteration normally needs seven model calls:
four perspectives, designer, pre-run critic and post-run analyst. Writing and
reviewing a draft add calls. Budget for at least two experiments and sixteen calls
for the default program; revisions can consume more. Insufficient budgets stop
with a recorded delivery gap. Larger source contexts may require increasing the
model's loaded context; a capacity error fails closed. LM Studio controls the loaded
context in its own settings (`RAIN_MODEL_CONTEXT` applies to the Ollama adapter).

## What runs

1. **Observe and read.** Load verified measurements for this question; retrieve
   bounded excerpts from the immutable paper corpus and pinned mathematical
   catalogue. Online scope can add Crossref records with exact response hashes.
2. **Collaborate.** James, Jasmine, Luca and Elena each make a separate inference
   using their existing role and SOUL context. Later perspectives see earlier
   contributions. Each states a hypothesis, falsification condition, evidence
   references, disagreements, mathematical assumptions and a next investigation.
3. **Design and validate.** The existing designer receives that deliberation and
   proposes typed protocols. The host ranks valid candidates with its existing
   priority heuristic and rejects unsupported capabilities, duplicates, invalid
   comparisons and charter violations. The independent pre-run critic can request
   revision. The model cannot modify evaluation rules, scope or resource ceilings.
4. **Preregister, execute and replay.** Native R.A.I.N. definitions, matched seed
   pairs, registry admission and replay produce the evidence. The registry's
   verdict remains separate from the post-run analyst's interpretation.
5. **Reconsider.** The next deliberation receives the new results and criticism.
   A follow-up must cite existing verified evidence and preserve its parent.
6. **Write, check and review.** After the delivery criteria are met, a writer
   proposes structured manuscript sections. The host validates references and
   substitutes numeric measurement tokens from the evidence bundle. It generates
   methods, seed tables, figures and references itself. A separate critic reviews
   scientific claims. Rejected drafts and disagreements remain in the record;
   bounded repairs or further investigations can follow.

The default delivery requires two completed admitted studies, successful replay,
an evidence-linked follow-up and source context. An online scope additionally
requires retrieved external literature. The typed host scope also supports a
required withheld-seed confirmatory study, minimum study count and bounded
manuscript revisions. These values are covered by the charter digest, never
model-editable. Default delivery is exploratory and does not imply confirmation.

A ready draft is **ready for human scientific review**. Citation existence,
replay success and an AI critic do not prove that a paper's interpretation is
correct. Source entailment and substantive scientific quality still need review.

## Evidence and artifacts

The existing append-only discovery journal records source receipts, inference
requests and answers, design validation, admissions, results and criticism.
`programs/DS-.../` adds immutable, hash-bound artifacts:

| Artifact                                       | Meaning                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `N-manuscript.md` / `.json`                    | Human-readable draft and structured writer response for revision N               |
| `N-evidence.json`                              | Source context and actual replay-verified measurements used by that draft        |
| `N-figure.svg`                                 | Host-generated paired differences, separate scales for each metric and unit      |
| `N-references.bib`                             | Bibliography with source identity, pinned location and reading scope             |
| `N-review.json`                                | Independent inference call's criticism, alternatives and proposed investigations |
| `evidence.json`, `graph.json`, `delivery.json` | Final checkpoint, complete program lineage and unresolved delivery gaps          |

The graph connects sources, perspective hypotheses, proposed experiments,
measurements, failures, follow-ups and manuscript revisions. It is a view of the
journal, not a second evaluator or authority registry. The same research question
can reuse its verified prior results after a new explicit start; other questions'
results are not silently substituted. The model receives bounded summaries while
full historical records remain on disk.

Artifacts are downloadable only when their names are host-approved and their
bytes match the journal digest. Restart restores a read-only checkpoint, never
starts work. **Pause** completes the current cycle; **Emergency stop** cancels
inference and interrupts the runner at cooperative checkpoints. An interrupted
session retains completed evidence and records incomplete delivery. Shared session
locks and explicit recovery are unchanged; see the [discovery guide](RAIN_EXPERIMENTAL_DISCOVERY.md).

## Demonstration and tests

[The archived research-program demonstration](benchmarks/rain-research-program-validation/README.md)
contains two actual native simulator studies and an evidence-linked follow-up,
eight perspective contributions, a structured manuscript, quantitative tables,
a figure, bibliography and critique. Its researcher and critic are explicitly
scripted integration fixtures. It does not demonstrate Qwen reasoning or an online
literature search; its measurements do come from the simulator.

```sh
npm run rain:discovery-demo -- --research --out .rain-research/new-program-demo
npm run rain:discovery-demo -- --verify .rain-research/new-program-demo
```

Verification replays the sealed records, checks the journal and artifact hashes,
checks paper measurements against native records, and recompiles each manuscript
from its retained structured draft and evidence. Fresh runs use fresh host-selected
seeds and may give different averages. Replay uses the exact archived seeds.

Tests cover source parsing, network bounds, review-bound scope, role collaboration,
invalid citations and quantities, manuscript repair, separate criticism, native
execution and replay, interrupted sessions, locks, artifact integrity, HTTP model
discovery, persistence and backward compatibility. CI uses scripted fixtures;
it requires neither LM Studio nor an Internet connection.

## Present limits

This release's executable experiments use Bethesda's supported single-event urban
simulator vocabulary. It cannot invent simulator mechanisms, execute generated
Python or JavaScript, train models, run arbitrary repository code, execute Lean,
or generate descendant worlds with their own researchers. The mathematical index
provides context and assumption checks, not formal verification. Literature search
provides metadata and available abstracts, not comprehensive evidence synthesis.
The four perspectives and separate critics can share one Qwen model; separate
calls are not independent models or scientific replication.

No benchmark establishes superiority over another research system. The nested
laboratory vision and broader validated experiment backends remain development
work. A live local-Qwen cycle and a human assessment of its resulting paper are
still needed to evaluate actual research quality.

Implementation: `src/rain/research/`, `src/bethesda/rain/researchProtocol.ts`, the
native discovery controller and store, and Bethesda's `DiscoveryWorkbench.tsx`.
Public metadata API: [Crossref REST documentation](https://www.crossref.org/documentation/retrieve-metadata/rest-api/).
