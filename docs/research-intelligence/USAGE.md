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
`--publish-dir NEW_DIRECTORY` copies that export and the journal archive into a
new directory inside this repository; it does not deploy a website.

The supplied code supports a genuine local-model path, but automated tests use
scripted fixtures. No live-model reasoning or research-quality improvement is
established by those tests.
