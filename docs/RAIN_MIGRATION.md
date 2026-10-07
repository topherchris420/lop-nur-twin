# The R.A.I.N. runtime migration

The R.A.I.N. Lab is an integrated research environment embedded inside the
Bethesda city simulation. Its research runtime, experiment registry, evidence layer
and simulation interface live in this repository. This note records how that
came to be: until 2026-10-06 the lab consumed `topherchris420/james_library`
at run time, through a Python bridge; since then the runtime it needs is code
in this repository, and no second checkout, Python package or environment
variable pointing at one is required.

## What the lab consumed before

The lab spoke `rain-bethesda/v2` to a backend named by `RAIN_BACKEND_URL`. The
reference backend, `tools/rain-bridge/rain_bethesda_bridge.py`, imported the
`james_library` Python package from a checkout named by `--library` or
`RAIN_LIBRARY_PATH` and called its offline meeting engine, citation corpus,
decision router, experiment registry and runner; for model meetings it ran
R.A.I.N.'s meeting script as a subprocess from a `git archive` copy of that
checkout. `scripts/export-rain-demo.py` recorded the DEMO through the bridge,
`tools/rain-conformance.mjs` handed the lab's output to a Python script that
imported `james_library`, and `tools/rain-lab.mjs` ran its LIVE checks only
with `RAIN_LIBRARY_PATH` (and `RAIN_PYTHON`) set.

## Baseline

| Field              | Value                                                                                   |
| :----------------- | :-------------------------------------------------------------------------------------- |
| Source repository  | `topherchris420/james_library` (MIT, Copyright (c) 2026 Vers3Dynamics)                  |
| Source commit      | `9c8811e343d21b8c143055f9cf549abdefa862f1` (committed 2026-09-29T00:01:54-04:00)        |
| Imported on        | 2026-10-06 (`src/rain/data/source.json` carries the exact time)                         |
| DEMO recording     | `rain-offline-93ae4b5195a5761ea843`, first recorded from that commit on 2026-10-03      |
| Corpus fingerprint | `9b2ea4210d127b9aa19de5d33a27caec79449ee7d157ae8c0989399dc0b71177` (17 papers)          |
| Architecture after | browser → same-origin `/api/rain/*` → `src/rain/` runtime → Bethesda experiment records |

## What was incorporated

Everything below is TypeScript under `src/rain/`, written against the Python
at the baseline commit and kept to its semantics. Where the two can be
compared, they were: the offline engine was run on both sides over the same
corpus for 28 questions and produced byte-identical meetings, and the DEMO
recording R.A.I.N.'s engine made is reproduced by this engine by id and by
every word (`src/rain/meeting/offline.test.ts`).

| From `james_library`                                                                                                                                                                                   | Here                                                                                         | Preserved                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utilities/citation_corpus.py`                                                                                                                                                                         | `corpus.ts`                                                                                  | which files count as evidence (product surface excluded, `docs/` and `assets/` never), the 400-file cap, whole-quote verification with collapsed whitespace and case folding, the three-word minimum, byte spans, the `path\0sha\n` corpus fingerprint                                                                                                                                                                                           |
| `launcher/offline_meeting.py`                                                                                                                                                                          | `meeting/offline.ts`                                                                         | BM25 ranking, lens-based evidence per perspective, verbatim quotes with line and span, grounding grades, matched and missing terms, the default question and its fallback, suggestions, the citation audit, determinism, every word of the script                                                                                                                                                                                                |
| `papers/` (17 files) and the four `*_SOUL.md` files                                                                                                                                                    | `data/corpus.json`, `data/perspectives.json`, `data/source.json`, `data/LICENSE.md`          | the texts verbatim with per-file SHA-256 and byte counts, the fingerprint, the license, the commit and the real import time; `scripts/import-rain-source.ts` re-imports from a clean checkout                                                                                                                                                                                                                                                    |
| `rain_lab_meeting_chat_version.py` (the orchestrator, its agent factory, `MEETING RULES`, director instructions, repairs, citation analysis, `stagnation_monitor.py`, `utilities/meeting_recovery.py`) | `meeting/model.ts`, `meeting/perspectives.ts`, `meeting/stagnation.ts`, `meeting/difflib.ts` | OpenAI-compatible chat completions; souls plus the meeting rules as the system prompt; the library context budget; the four-member team and roles; seeded director instructions; the critique-and-revise pass; truncation, corruption and too-short repairs; the placeholder and closing lines; dead-end and stagnation detection with CPython's `SequenceMatcher.ratio`; bounded recovery; a model that stops ends the meeting, still completed |
| `utilities/session_artifact.py`                                                                                                                                                                        | `meeting/artifact.ts`                                                                        | `rain-session-artifact/v1` with grounded responses, provenance, red badges, corpus hashes and `%Y-%m-%dT%H:%M:%SZ` stamps                                                                                                                                                                                                                                                                                                                        |
| the bridge's `model_meeting_record` and `meeting_record`                                                                                                                                               | `meeting/record.ts`                                                                          | the `rain-bethesda/v2` meeting record, re-verified quotes, `generation` per turn, the source artifact named by SHA-256, cleaning and bounding, `MeetingFailed` reasons                                                                                                                                                                                                                                                                           |
| the bridge's meeting jobs                                                                                                                                                                              | `meeting/jobs.ts`                                                                            | one meeting at a time, 128-bit job ids bound to the request, progress as turns started, cancellation, the time limit, a 15-minute retention of finished jobs, the optional archive directory                                                                                                                                                                                                                                                     |
| `[rig]` meeting privacy                                                                                                                                                                                | `meeting/privacy.ts`                                                                         | `local` refuses a non-loopback, non-private endpoint and Ollama `:cloud` models; `hybrid` passes                                                                                                                                                                                                                                                                                                                                                 |
| `judgment/contracts.py`, `judgment/sensitive.py`, `judgment/calibration.py` (load and support), `judgment/routing.py`, `judgment/typesafe.py`, `judgment/config.py`                                    | `judgment/`                                                                                  | bounded choice questions, the policy order, every escalation reason, calibration profiles and the Wilson bound, one in-flight call per engine, result validation, the sealed `rain-bounded-decision/v1` envelope, the TypeSafe SystemOne provider, `off` by default and `jev` only with remote consent                                                                                                                                           |
| `experiments/schema.py` with its three JSON schemas, `registry.py`, `evaluate.py`, `stats.py`, `provenance.py`, the submission half of `runner.py`, `verify.py`                                        | `experiments/`                                                                               | never-reused `V3D-EXP-NNNN` ids with a locked ledger, write-once definitions, `rain-criteria/v1`, nine-decimal statistics, redaction of credential-shaped values, external submissions evaluated by the host, tamper detection by recomputation                                                                                                                                                                                                  |

The lab side changed where the runtime's shape changed: provenance names
`rain_repository`, `rain_commit`, `rain_dirty` and `rain_source` (the records
moved to `bethesda-rain-experiment-record/v2`), the identity names the runtime,
and the engine strings are the runtime's (`rain.meeting.offline.buildOfflineMeeting`,
`rain.meeting.model.holdMeeting`). The Lab's boundaries did not move: R.A.I.N.
chooses only from host-defined options, `RAIN_DECISION_MODE=off` is the
default, a remote answer never becomes authority, the browser never calls a
remote engine, the simulator alone determines world state, and the observation
tools stay read-only and bounded.

## What was deliberately not migrated

These parts of `james_library` are not the lab's and were left where they are:

- the web search (DuckDuckGo), speech and audio export, the Godot visual-event
  server and the Rust daemon client, the Telegram and Diplomat inbox, and the
  founder keyboard intervention — none of them ran in a Bethesda meeting;
- the knowledge hypergraph (`networkx`, `scikit-learn`) and the hypothesis tree,
  the metrics tracker and the metacognitive process controller
  (`RAIN_METACOGNITIVE_CONTROL`), which Bethesda never enabled;
- the `laya` and `cascade` decision modes and calibration _fitting_: they need
  R.A.I.N.'s local Laya checkpoint and its Python worker. The runtime reads a
  calibration file and refuses those modes by name rather than mapping them to
  something else;
- the builtin experiment runners, `run_experiment`, reproduce runs and the
  `RESULTS.md` renderer: here the Bethesda simulator is the external runner and
  every run reaches the registry as a submission;
- the circuit breaker and the formal-logic prover, the judgment service's
  claim-evaluation workflow, the CLI, the desktop launcher and the installers.

A model meeting still needs a model server; the runtime talks to the one the
operator configures over HTTP and starts no process of its own.

## What was removed

- `tools/rain-bridge/` (`rain_bethesda_bridge.py`, `stand_in_model.py`,
  `admit.py`, `conformance.py`, `test_bridge.py`) and the `rain:bridge` script;
- `scripts/export-rain-demo.py` (replaced by `scripts/export-rain-demo.ts`);
- `RAIN_BACKEND_URL`, `RAIN_BACKEND_TOKEN` and `RAIN_TIMEOUT_MS` from the
  server, `RAIN_LIBRARY_PATH` and `RAIN_PYTHON` from the tools, and `--library`
  from every command;
- the bridge's upstream HTTP client in `server/rain/handler.ts`; the route now
  calls the runtime in-process with a 25 s cap and the same request limits;
- `src/bethesda/rain/evaluate.ts`, a second `rain-criteria/v1` evaluator, in
  favour of `src/rain/experiments/evaluate.ts`;
- every instruction to clone `james_library`.

`tools/stand-in-model.mjs` replaces the Python stand-in for tests,
`tools/rain-admit.mjs` the Python admission helper, and
`tools/rain-conformance.mjs` runs in-process and never skips.

## Verifying the migration

```sh
bun run test:run              # includes src/rain: corpus, offline engine (DEMO reproduction),
                              # record, artifact, model meeting on a stand-in, jobs,
                              # routing, calibration, TypeSafe, config, experiments,
                              # stagnation, privacy, runtime; and the route
bun run build                 # validate:bethesda checks the bundled corpus, SOUL files and
                              # the DEMO recording against their manifests
bun run rain:conformance      # the lab's output through the runtime's registry
bun run verify:rain-lab       # OFFLINE, DEMO, LIVE and a model meeting, in a browser
```

A clean checkout with no `james_library` on the machine builds, tests and runs
the lab in every mode; nothing in the repository imports the `james_library`
Python package or reads `RAIN_LIBRARY_PATH`. The historical references that
remain — the import manifest, the DEMO manifest's lineage, the module headers
that say what each file was ported from, and this note — are provenance.
