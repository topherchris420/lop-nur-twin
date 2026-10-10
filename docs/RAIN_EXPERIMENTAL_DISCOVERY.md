# Native experimental discovery in R.A.I.N.

For a continuing question-to-paper workflow, see [native research programs](RAIN_RESEARCH_PROGRAM.md).
It adds four-perspective collaboration, optional literature retrieval and manuscript
review to this same controller. The experiment-only controls below remain available.

The model may imagine the experiment. The laboratory determines whether it is
valid. The simulation produces the evidence. Evidence limits the conclusion.

## What changed

The existing autonomous researcher accepts only `ResearchAction.design`, an
ID enumerated by `researchActionSchema`. `autonomousProposal` turns that ID
into one of 44 combinations in `charterDesigns`: a host template, direction
and fixed seed panel. The original charter admits their exact design digests.
That CLI, its v2 proposals, existing records and manual experiment workflow
remain available unchanged.

The optional native discovery path adds a data-only `rain-discovery-design/v1`
language. Qwen supplies questions, competing hypotheses, parameter combinations,
expected direction, effect threshold, motivating evidence, uncertainties and a
replication plan. Host code constructs the operational question and hypothesis;
the original model narrative stays in the discovery journal, explicitly marked
as model interpretation. No generated code, shell, Python, URLs or file operations
can become experimental actions.

| Layer                                      | Responsibility                                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/bethesda/rain/discoveryProtocol.ts`   | Closed schemas and hard simulator bounds                                                                               |
| `src/bethesda/rain/discoveryCompiler.ts`   | Native compilation, meaningful protocol fingerprint, evidence/parent checks, scope and resource checks, priority score |
| `src/bethesda/rain/standing.ts`            | v2 parameter-family charter and policy; legacy v1 charter still supported                                              |
| `src/rain/autonomy/discovery.ts`           | Bounded observe/design/critic/preregister/run/replay/analyze/redesign cycle                                            |
| `src/rain/autonomy/store.ts`               | Shared exclusive session lock, immutable records and hash-chained discovery journal                                    |
| `src/rain/autonomy/models.ts`              | Existing local LM Studio/Ollama structured-output adapters                                                             |
| `src/rain/runtime.ts`                      | Existing native preregistration certificates, registry and independent criteria evaluation                             |
| `server/rain/discovery.ts`                 | Local, same-origin operator controls; no stateless cloud execution                                                     |
| `src/bethesda/rain/DiscoveryWorkbench.tsx` | Bethesda Research Panel controls, findings, critique and audit history                                                 |

Execution uses `openCase → admitStanding → begin → runExperiment → complete`.
Every generated v3 definition recompiles before execution; replay re-derives
its proposal, protocol, authorization, commands, world states, observations,
measurements and criteria. Generated population/intensity/duration parameters
are versioned in v3. The simulator rules themselves have not changed.

## Supported experiments

Each study has paired identical initial conditions: one no-event control and
one treatment receiving one supported event at the end of warm-up. All locations
resolve through the existing mapped vocabulary; Qwen never supplies coordinates.

- Disruptions: Metro closure, fire, gas leak, festival, rally, crash, outage, storm.
- Locations: only the existing `SCENARIO_LOCATIONS` pairs. For example, a Metro
  closure can only be tested at the mapped Bethesda Metro entrance.
- Explicit pedestrian population: 40–360, in steps of 20; vehicles: 0–70;
  buses: 0–14. The existing illustrative statistical population is held fixed.
- Event intensity: 1–3, using the native radius/dispatch mapping; duration: 100–6,000 ticks in steps of 100.
- Warm-up: 100–1,200 ticks; window: 300–3,000 ticks, both in steps of 100.
- Seven existing metrics: cohort distance, cohort indoors, nearby pedestrians,
  leaving, sheltering, watching, and held vehicles. Sampling stays every 100 ticks.
- Host-selected seed panels: 3–5 seeds. At most 36,000 execution ticks and
  8 million actor-ticks including mandatory replay, further narrowed by the charter.

A duration extending beyond the measurement window does not create novelty.
Storm intensity alone changes unmeasured statistical stocks, and Metro intensity
1 versus 2 has identical measured-population effects; neither creates novelty.
Renaming a design, reversing its predicted direction, changing its threshold or
switching the primary metric also does not create novelty: the native runner
already measures all seven outcomes. Confirmatory replication must preserve
its parent's protocol and preregistered criteria, cite its replay-verified result,
and use withheld seeds. Only one confirmatory repetition per protocol is admitted.
Other revisions remain exploratory. Seed order does not evade duplicate checks.

Unsupported: generated programs, new simulator behaviors, new measurements,
multi-event interventions, arbitrary roads/coordinates, real people, physical
sensors, external-world actions, or claims of global scientific novelty.
No automated factorial interaction estimator or significance test is supplied.
Comparisons across population/context studies are descriptive and use different
seed panels; they do not establish a population interaction effect statistically.

## Activate with Qwen in LM Studio

1. Load your Qwen model in LM Studio and start its local server. The default
   endpoint is `http://127.0.0.1:1234`. The model must support structured JSON output.
2. In the repository, install dependencies and enable the local discovery path:

   ```powershell
   $env:RAIN_AUTONOMY_ENABLED = "true"
   $env:RAIN_MODEL_PROVIDER = "lmstudio"
   npm run dev
   ```

3. Enter Bethesda, open R.A.I.N. Lab, then the Research Panel. Choose **Connect
   local Qwen / review experiment-only scope**. `/v1/models` supplies the actual identifier.
   If exactly one loaded identifier contains `qwen`, it is selected. If there
   are multiple or none, set `RAIN_MODEL` to an identifier shown by your server
   and restart the local development server. No Qwen version is assumed.
4. Review the parameter envelope, model, session ceilings and expiry. Confirm
   review and type the charter digest's first eight characters. This is the
   existing local-operator attestation, not authenticated identity.
5. Choose **Start bounded session**. One authorization permits generated designs
   within the approved envelope until it expires. The policy rechecks each design.
   Changed model, endpoint, envelope, simulator versions or ceilings require a new
   charter review. Nothing starts merely because the page or server restarted.

The same workflow is available in a terminal:

```sh
npm run rain:discovery -- --charter
npm run rain:discovery -- --authorize <digest-prefix> --reviewed
npm run rain:discovery -- --start
npm run rain:discovery -- --status
```

`--start "your question"` accepts another bounded research question. Existing
`RAIN_MAX_*`, timeout, context and charter-hours settings apply. Discovery defaults
to LM Studio and a 4,096-token output budget. Its bounded history summary is not
the full journal; a context-capacity error stops the session rather than switching
models. A 16K or larger loaded context is useful for longer model critiques if
supported by your machine. Set `RAIN_LMSTUDIO_URL` for another local endpoint.
Local/private inference only; there is no credential or remote fallback.

`RAIN_DISCOVERY_ENVELOPE` may contain the full closed envelope JSON shown in the
workbench, with narrower ranges/allowed IDs. No value can exceed host hard bounds.
Restart and review the new digest after changing it. The model cannot change it.

The workbench endpoint is provided by local `vite` and `vite preview` only, and
accepts loopback connections, loopback hosts and same-origin mutations. A deployed
Vercel website cannot access LM Studio on a visitor's machine. Run this checkout
locally for discovery. The existing deployed manual workflow is unchanged.

## Stopping, persistence and provenance

**Pause** finishes the current experiment, replay, registry admission and critique,
then stops before the next iteration. **Emergency stop** aborts an in-flight local
inference and interrupts execution/replay at the next cooperative checkpoint.
An interrupted execution seals a failed record. Completed measurements are written
before replay and subsequent inference, so a later failure cannot erase them.
Neither pause nor stop schedules a later restart.

`.rain-research/` (or `RAIN_AUTONOMY_DIR`) keeps the persistent native `registry/`,
sealed `records/`, reviewed `charters/`, `discovery/` journal and `reports/`.
The journal preserves model prompts/answers, validation and policy results,
approved envelope, hypotheses and parents, preregistration/seeds, measurements,
replay receipts, failed runs and independent critiques. It is hash-chained and
write-once; it detects tampering, not a hostile local operator who rewrites every
hash. Keep this directory backed up. The existing human-reviewed research-lineage
registry is not impersonated or rewritten by the model.

A single exclusive `session.lock` is shared with the legacy autonomous CLI.
An unclean process exit leaves it in place. Status shows its owner/PID/digest.
After reviewing it, use the workbench recovery control or:

```sh
npm run rain:discovery -- --recover <full-lock-digest> --reviewed
```

Recovery refuses if the owner PID is still running. It removes only the stale
lock; it starts nothing. A new explicit start revalidates the charter and prior
records. Historical preregistrations reserve their generated protocol even if a
run was interrupted. Failed replay quarantines the result and ends the session.

Findings are native simulator measurements. Critic/model statements are
`generation: model` in the journal; no model verdict overrides the registry's
preregistered criteria. Original findings and disagreements remain recorded.
The independent critic is a separate inference call to the same model, not an
independent model ensemble. Duplicate detection is relative to local recorded
protocols, native generated preregistrations and the 44-design catalogue.

Priority is deterministic: `4 × information + 3 × novelty + feasibility − cost`.
Information is 1 for an evidence-linked follow-up and 0.5 otherwise; novelty is
0 for replication and 1 for a new physical protocol; cost is the fraction of the
approved actor-tick budget and feasibility is `1 − cost`. This is a transparent
scheduling heuristic, **not measured entropy or expected information gain**.
The model's own information-value estimate is stored but cannot control ranking.

## Verification and honest demonstration

```sh
npm run test:bethesda
npm run lint
npm run typecheck
npm run build
npm run rain:discovery-demo -- --out <new-directory>
npm run rain:discovery-demo -- --verify <same-directory>
```

The demo uses the real Bethesda runner, registry and replay, with an explicitly
scripted local-model fixture. Its second design branches on the actual measured
first-run delta and cites that result. It is an integration/reproducibility
demonstration, **not a Qwen discovery claim**. The live Qwen experiment must be run
on the machine hosting LM Studio; no model was available in the implementation
workspace. See the [archived validation report](benchmarks/rain-discovery-validation/README.md) for the actual executed protocols,
per-seed measurements and lineage. No real-world observations were made.
