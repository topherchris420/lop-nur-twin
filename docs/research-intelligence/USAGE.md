# Local CPU research intelligence

Run `node scripts/run-ts.mjs scripts/rain-intelligence.ts --help` for all modes.
The optional model panel and the CPU worker have separate authority. Drafting a
recommendation does not register an experiment, change its criteria or approve a
CPU process.

## Ask the existing perspectives to review a frozen template

Use a local Ollama or LM Studio server and explicitly select its model identifier.
For example, in PowerShell:

```powershell
$env:RAIN_AUTONOMY_ENABLED = "true"
$env:RAIN_MODEL_PROVIDER = "lmstudio"
$env:RAIN_MODEL = "MODEL_ID_FROM_YOUR_LOCAL_SERVER"
node scripts/run-ts.mjs scripts/rain-intelligence.ts --deliberate PLAN.json --dir .rain-research/cpu-panel
```

No Python installation or validation-repository mapping is needed. The endpoint
defaults to loopback; `RAIN_LMSTUDIO_URL` or `RAIN_OLLAMA_URL` may select another
loopback or private-network server. Remote endpoints and Ollama `:cloud` models
are rejected. Individual calls use `RAIN_MODEL_TIMEOUT_MS`,
`RAIN_MODEL_MAX_TOKENS` and `RAIN_MODEL_CONTEXT`. The configured model-call ceiling
must allow four calls.

The successful panel makes exactly four completion calls, one for each existing
SOUL perspective: James, Jasmine, Luca and Elena. Later perspectives see earlier
contributions and are asked to challenge their assumptions. Each returns a
hypothesis, competing explanation, falsifier, criticism and an existing template
design ID. The output contains advisory vote ranks; the input plan stays
unchanged. Four calls to one model are not independent scientific replication.

To include a retained campaign from the same journal, add `--context STUDY`:

```powershell
node scripts/run-ts.mjs scripts/rain-intelligence.ts --deliberate PLAN.json --context DS-STUDY_ID --dir .rain-research/cpu-panel
```

The CLI obtains context through `cpuCampaignReport`, which checks the retained
registry evidence and re-derives the assessments. The model receives bounded
report excerpts and earlier contributions; seed panels remain withheld from its
prompt. Context does not grant new evidence or execution standing.

Prompts, responses, generation labels, model identity, reported token counts,
typed contributions and failures are appended to the existing `ResearchStore`
journal. Unknown token counts stay unknown. Cancellation, invalid output or a
model failure ends the panel without a retry or an invented replacement turn.
The adapter handles each call's timeout, and Ctrl+C requests cancellation.

## Prepare, execute and inspect CPU evidence

These modes use the separate source-bound worker authorization:

```powershell
node scripts/run-ts.mjs scripts/rain-intelligence.ts --prepare PLAN.json --python PYTHON_EXECUTABLE --qnp QNP_CLONE --drr DRR_CLONE --dir .rain-research/cpu-evidence
node scripts/run-ts.mjs scripts/rain-intelligence.ts --run STUDY --approved-sha EXACT_DIGEST --reviewed --python PYTHON_EXECUTABLE --qnp QNP_CLONE --drr DRR_CLONE --dir .rain-research/cpu-evidence
```

Supply only the upstream mappings the plan needs. Review the prepared envelope
before providing its exact approval digest. CPU work executes trusted local
numeric source under process limits; this is not a sandbox for hostile code.
An interrupted owner lock requires explicit recovery, and continuation requires
`--continue-reviewed`; reserved panels are never rerun as fresh confirmation.

Inspection and offline export require neither Python nor model configuration:

```powershell
node scripts/run-ts.mjs scripts/rain-intelligence.ts --status STUDY --dir .rain-research/cpu-evidence
node scripts/run-ts.mjs scripts/rain-intelligence.ts --export STUDY --dir .rain-research/cpu-evidence
```

Export appends a fresh evidence/observatory artifact snapshot. The optional
`--publish-dir NEW_DIRECTORY` copies the JSON report and viewer into a new
directory inside this repository. `--archive-dir NEW_DIRECTORY` separately
copies full source receipts and the journal archive. Keep raw archives outside
`public/` and `dist/`; neither option deploys a website.

The supplied code supports a genuine local-model path, but automated tests use
scripted fixtures. No live-model reasoning or research-quality improvement is
established by those tests.

## Inspect the recorded controlled study

Read the [engineering report](REPORT.md) and
[frozen results](../../public/research-intelligence/summary.json). After
`bun run build`, serve the project with `bun run preview` and open
`/research-intelligence/index.html`. The `fifo/`, `information/` and
`full-validation/` subdirectories contain each arm. The `/analysis` page also
links to the observatory. Filtering and expandable details need only the adjacent
`observatory.js`; the data remain readable without JavaScript. This is a static
snapshot, not a live controller.

The browser check serves only the generated observatory on an ephemeral loopback
port, applies the project's production CSP and closes its own browser/server:

```powershell
node tools/research-intelligence-check.mjs
```

Read-only record verification requires Node and installed project dependencies,
but no Python, model service or upstream clone:

```powershell
node scripts/run-ts.mjs scripts/verify-intelligence-evidence.ts --archive docs/research-intelligence/evidence/archive
```

This rederives the study counts and raw-sample assessments, verifies the native
registry, and checks that the archive remains unchanged. The retained
`evidence/replay-receipt.json` records the separately executed numerical replay.
Replaying exposed seeds checks consistency and never supplies fresh confirmation.

To request a new local replay, create a dedicated Python 3.11 environment using
`scripts/research-validation/requirements.txt`, select clean local upstream
clones at the report's revisions, then inspect its envelope:

```powershell
node scripts/run-ts.mjs scripts/verify-intelligence-evidence.ts --archive docs/research-intelligence/evidence/archive --draft-replay
node scripts/run-ts.mjs scripts/verify-intelligence-evidence.ts --archive docs/research-intelligence/evidence/archive --replay-reviewed EXACT_REPLAY_DIGEST --python PYTHON_EXECUTABLE --qnp QNP_CLONE --drr DRR_CLONE
```

The source/interpreter binding must match. Paths may differ, versions or source
bytes may not. Review the printed replay cost separately from the original study.
The verifier writes no research records. Preserve its standard output as a new
receipt outside the immutable archive.

The frozen study runner supports `--draft` and `--execute-reviewed EXACT_DIGEST`
with explicit `--python`, `--qnp` and `--drr` mappings. A new experiment is not a
replay: it needs a new reviewed protocol and unused seed blocks. Do not relabel
the published seeds as an independent experiment.

Engineering checks:

```powershell
bun run test:run
bun run test:evidence
bun run lint
bun run format:check
bun run build
```

For optional genuine Python tests, use a separate environment with
`requirements-dev.txt`, set `RAIN_QNP_REPOSITORY` and `RAIN_DRR_REPOSITORY`, then
run `python -m pytest scripts/research-validation -q` and
`python -m ruff check scripts/research-validation`. Without the explicit mappings,
the genuine upstream checks skip. The CI workflow supplies pinned clean clones.
