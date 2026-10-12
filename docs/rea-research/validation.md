# Upgrade validation

The upgrade preserves the existing runtime, research roles, registry, journal,
Bethesda execution and LM Studio adapter. The tests below exercise implemented
paths. Browser model tests use the explicitly labelled stand-in; they do not
substitute for a completed live-Qwen scientific experiment.

| Check                                                           | Observed result                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run --maxWorkers=2`                                     | 137 files and 1,701 tests passed, including scientific, learning, graph, authority, registry, replay and research-program tests.                                    |
| `prettier --check .`, `eslint .`                                | Passed. The final plate-body pointer change also passed formatting and lint.                                                                                        |
| `bun run build`                                                 | Data, corpus and model-history validation, production bundle, TypeScript and the built-artifact privacy scan passed; 184 files scanned clean.                       |
| `node tools/rain-lab.mjs`                                       | The unchanged complete browser regression passed, including plate inspection, mobile layout, replay, runtime status, stopping, accessibility and browser isolation. |
| `node tools/bethesda.mjs`                                       | Bethesda scenario, replay, browser, accessibility and security checks passed.                                                                                       |
| `node tools/rain-conformance.mjs`                               | Supported, negative, inconclusive and error outcomes retained native registry parity.                                                                               |
| `node scripts/run-ts.mjs scripts/test-evidence-validation.ts`   | All 37 evidence-validation rules passed.                                                                                                                            |
| `node scripts/run-ts.mjs scripts/verify-scientific-evidence.ts` | Three journal bundles verified, with one independently replayed numerical record and one independently rescored completed learning evaluation.                      |
| `node tools/jev-secret-scan.mjs docs/rea-research`              | Public investigation findings and original research evidence scanned clean.                                                                                         |
| `node tools/a11y.mjs http://127.0.0.1:4196`                     | Ten routes had no serious or critical accessibility violations, page errors or CSP violations.                                                                      |

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
four-pair learning pilot timed out on local Qwen. No completed live scientific
cycle or general intelligence improvement is claimed. All guidance remains
inactive pending operator review; physical equipment control remains disabled.

REA's coverage was the public sites and their available client scripts. The
[capability matrix](capability-matrix.md) and application evidence indexes record
what was observed, inferred, documented and unavailable. Private extracted script
bytes are outside the repository.
