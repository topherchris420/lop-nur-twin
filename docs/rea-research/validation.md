# Upgrade validation

The upgrade preserves the existing runtime, research roles, registry, journal,
Bethesda execution and LM Studio adapter. The tests below exercise implemented
paths. Browser model tests use the explicitly labelled stand-in; they do not
substitute for live model evidence. A separately approved Gemma simulation is
retained below with an inconclusive scientific outcome.

| Check                                                           | Observed result                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run --maxWorkers=2`                                     | 137 files and 1,710 tests passed, including scientific, learning, graph, model identity, authority, registry, replay and research-program tests.                    |
| `prettier --check .`, `eslint .`                                | Passed. The final plate-body pointer change also passed formatting and lint.                                                                                        |
| `npm run build`                                                 | Data, corpus and model-history validation, production bundle, TypeScript and the built-artifact privacy scan passed; 184 files scanned clean.                       |
| `node tools/rain-lab.mjs`                                       | The unchanged complete browser regression passed, including plate inspection, mobile layout, replay, runtime status, stopping, accessibility and browser isolation. |
| `node tools/bethesda.mjs`                                       | Bethesda scenario, replay, browser, accessibility and security checks passed.                                                                                       |
| `node tools/rain-conformance.mjs`                               | Supported, negative, inconclusive and error outcomes retained native registry parity.                                                                               |
| `node scripts/run-ts.mjs scripts/test-evidence-validation.ts`   | All 37 evidence-validation rules passed.                                                                                                                            |
| `node scripts/run-ts.mjs scripts/verify-scientific-evidence.ts` | Four journal bundles verified, with two independently replayed numerical records and one independently rescored completed learning evaluation.                      |
| `node tools/jev-secret-scan.mjs docs/rea-research`              | Public investigation findings and original research evidence scanned clean.                                                                                         |
| `node tools/a11y.mjs http://127.0.0.1:4196`                     | Ten routes had no serious or critical accessibility violations, page errors or CSP violations.                                                                      |

The full-history Gitleaks scan passed. Its initial
75 findings were public REA script identifiers (`scr_` followed by a SHA-256
digest), verified against REA's browser-observation schema. The existing
`.gitleaksignore` mechanism records only their exact commit/file/rule/line
fingerprints. No rule or path is exempted for other values or future commits.
A synthetic credential negative control still triggered the unchanged
`generic-api-key` rule. Redacted scanner reports remain outside the repository.

The original browser assertions were retained. Layout corrections keep controls
inside short touch screens while preserving the minimum open viewing band.
Plate interactions now pick the existing solid bronze body rather than the
animated, tessellated surface. Temporary camera diagnostics and candidate camera
changes were removed. Captures and diagnostic logs remain ignored review output.

The scientific workbench check (`node tools/rain-scientific-ui.mjs`) inspects the
retained scripted fixture: graph relationships and selection, readable provenance,
learning comparison, compiler inspection, two backend capabilities and the
registry-admitted numerical result. It does not request inference or grant approval.

The [evaluation record](evaluations/README.md) separates a narrow eight-pair
scripted procedural improvement from actual oscillator measurements and failed
live attempts. Four numerical design requests and the first call of a frozen
four-pair learning pilot timed out on local Qwen. The operator subsequently
replaced Qwen with Gemma. Two actual Gemma drafting calls produced one rejected
sample budget and one compiled proposal. The operator approved the latter's
exact digest; execution, independent replay, registry admission and graph
reconstruction completed. The scientific verdict is inconclusive because the
frozen analytic accuracy guards failed; no supported hypothesis is claimed.
See [Gemma evidence](evaluations/gemma-live/README.md). This is one adaptive
demonstration, not an independent model-quality comparison. No general
intelligence improvement is claimed. All guidance remains
inactive pending operator review; physical equipment control remains disabled.

REA's coverage was the public sites and their available client scripts. The
[capability matrix](capability-matrix.md) and application evidence indexes record
what was observed, inferred, documented and unavailable. Private extracted script
bytes are outside the repository.
