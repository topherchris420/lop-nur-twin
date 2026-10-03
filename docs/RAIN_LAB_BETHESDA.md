# The R.A.I.N. Lab in Bethesda

Behind an unmarked door in the Bethesda anomaly is a research lab where the
four perspectives of [R.A.I.N.](https://github.com/topherchris420/james_library)
(`topherchris420/james_library`) investigate questions about the city, and where
their hypotheses become experiments that the Bethesda simulator runs. It is a
spatial interface to R.A.I.N.'s real workflow, not a chatbot and not a scripted
scene:

```text
human question → R.A.I.N. meeting → evidence and constraints → experiment proposal
→ deterministic validation → human authorization → Bethesda simulator (matched runs)
→ recorded observations → deterministic evaluation → R.A.I.N.'s own record
→ provenance-preserving, replayable record
```

**Models propose; host code validates; the simulator determines world state;
recorded observations become evidence.** Every arrow in that line is code in
this repository or in james_library, and each side keeps its own authority.

## Read this first

- **The interior is fictional.** The lab, its rooms, its door and the figures
  in it are invented. Nothing about a real building at that location is
  claimed.
- **The visual world is not evidence.** What the lab and the city _draw_ —
  rooms, figures, avatars, the wall map, the city itself — is presentation.
  Evidence is what the simulator computes from its own state, recorded with the
  tick and state hash it came from.
- **Agents have no unrestricted city control.** R.A.I.N. can choose among
  options the host offers, and nothing else. The four perspectives can look at
  the city through seven read-only tools and on bounded walks, two at a time.
  Nothing in the lab can move, inject, close, dispatch, pause or step the live
  city.
- **Simulated results do not establish real Bethesda behaviour.** The
  simulator is rule-based. A result says what _these rules_ do on _these
  seeds_ — not what real people near the real Metro would do.
- **Experiments remain simulations.** Every run reported to R.A.I.N. is
  labelled `evidence_class: "simulated"`, and R.A.I.N.'s own run record says so
  in its words: "Simulated data: this characterizes the simulator and analysis
  pipeline, not a physical system."

## Discovery (spoiler)

The lab is inside Bethesda, so first find Bethesda (see
[the anomaly guide](BETHESDA_ANOMALY.md#discovery-spoiler)). Then either:

1. **On foot.** On the rear wall of an unnamed building (OSM way
   `117424685`), about 150 m from where Bethesda begins, is a dark service door
   like any other. Walk within 40 m and a faint spectral-teal line and a small
   waveform appear on it; within 3 m the city offers **Open it (E)**. No text,
   no map marker, no landmark entry.
2. **By telemetry.** In the city's console (backtick or `~ telemetry`), type
   `resolve r.a.i.n.` (or `resolve rain lab`), or the door's own coordinates,
   `38.98025, -77.09627`. In the desert those coordinates resolve Bethesda
   itself; the lab opens only from inside the city. The phrase is not a
   scenario: the city's compiler produces no event from it.

The lab's code (`LabApp`, about 53 kB gzipped) loads the first time the door
opens. Nothing contacts a R.A.I.N. backend before then. Leave by the door
behind the threshold (E) or **Return to Bethesda**.

## The boundary between the repositories

Nothing is copied from james_library and none of its logic is reimplemented.
The lab speaks a small versioned protocol, `rain-bethesda/v1`, to a backend; the
reference backend is a standard-library Python bridge that _imports_
james_library and calls its own code:

```text
browser: src/bethesda/rain/*      same-origin JSON, closed fields, bounded
   │                                         ▼
   │                         /api/rain/*  (server/rain/handler.ts)
   │                           RAIN_BACKEND_URL, optional RAIN_BACKEND_TOKEN
   │                                         ▼
   │                 tools/rain-bridge/rain_bethesda_bridge.py   (loopback)
   │                                         ▼  imports
   │                  james_library: offline meeting engine, citation corpus,
   │                  decision router, experiment registry and runner
   ▼
Bethesda simulator (src/bethesda/simulation.ts), in the browser
```

| From R.A.I.N. (used, not copied)                                          | Where it is used                                                    |
| :------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| `launcher.offline_meeting.build_offline_meeting` — the four perspectives  | the Research Panel's meetings (LIVE), and the DEMO recording        |
| `citation_corpus.verify_quote`                                            | every quote is re-verified by the bridge before it is returned      |
| `judgment.config.create_decision_router().decide`                         | R.A.I.N.'s bounded choice among the host's experiment options       |
| `experiments.registry.Registry.create`                                    | pre-registration: R.A.I.N. assigns `V3D-EXP-NNNN`                   |
| `experiments.runner.record_submission`                                    | R.A.I.N. evaluates a reported run against its own criteria          |
| `rain-experiment/v1`, `rain-experiment-submission/v1`, `rain-criteria/v1` | the drafts and submissions the lab exports, and its local evaluator |
| the Godot client's neutral events and embodiment palette                  | how a meeting is staged; how the four look (colours only)           |

`rain-criteria/v1` is evaluated in the browser as well, so an OFFLINE run has a
verdict; `bun run rain:conformance` runs james_library's own validators,
evaluator and registry over the lab's output and fails if they disagree.

What stays on this side: the scenario vocabulary and its compilation through the
city's own scenario compiler, validation, authorization, the simulator, every
measurement, replay, and the records. What stays on R.A.I.N.'s side: the
perspectives, their reasoning and evidence, its decision router, its registry
and its evaluation of submitted runs.

## Three modes, labelled

| Mode        | When                                                                                | What runs                                                                                     | What it says                                                                           |
| :---------- | :---------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **OFFLINE** | no backend configured, or the configured one does not answer                        | nothing is generated; every room is explorable; local experiments still run on the simulator  | `RUNTIME OFFLINE` and why (not configured, misconfigured, unreachable)                 |
| **DEMO**    | you choose **Replay the recorded meeting (DEMO)**                                   | one recorded meeting is replayed; no process runs and your question is sent nowhere           | `PRERECORDED · DEMO` and `SCRIPTED · NO MODEL RAN`                                     |
| **LIVE**    | `/api/rain/status` reports a configured, reachable backend whose identity validates | meetings, proposals, pre-registration and submissions go to R.A.I.N. through the site's route | `RUNTIME LIVE`, R.A.I.N.'s engine and commit, and whether a model or a script answered |

LIVE never falls back to DEMO. A failed LIVE request shows its failure —
`NOT CONFIGURED`, `UNAVAILABLE`, `TIMEOUT`, `RATE LIMITED`, `SESSION LIMIT`,
`REFUSED`, `INVALID ANSWER` or `ERROR` — and nothing in its place; the browser's
R.A.I.N. client cannot import the recording (a test asserts it). The DEMO
recording (`src/bethesda/rain/fixtures/demo-meeting.json`) was made by
`scripts/export-rain-demo.py` from the bridge at james_library
`9c8811e343d21b8c143055f9cf549abdefa862f1`. Its manifest (`demo-source.json`)
records the recording's real time, its SHA-256, the commit and the corpus
fingerprint; `validate:bethesda` checks the file byte-for-byte against that
SHA-256 and that the two agree on the commit and the meeting and that no model
ran, and the LIVE browser check asserts that the bridge at that commit returns
the same meeting. The experiment proposal shipped
beside it (`demo-proposal.json`) was written by hand, is labelled `origin:
fixture`, and claims no R.A.I.N. decision.

R.A.I.N.'s offline meeting engine is the one the bridge serves: its reasoning
text is scripted, its evidence is retrieved, and every quote is verified. A
LIVE meeting from it is labelled `SCRIPTED · NO MODEL RAN`. A backend that
reports a model is labelled with that model's name, and only then.

## Running LIVE

1. Check out james_library beside this repository.
2. Start the bridge from this repository:

   ```sh
   python3 tools/rain-bridge/rain_bethesda_bridge.py --library ../james_library
   ```

   It listens on `127.0.0.1:8790` and refuses a non-loopback address without
   `--allow-remote`. It writes to a fresh scratch registry unless `--registry`
   names one. To require a bearer token, set `RAIN_BRIDGE_TOKEN` in the bridge's
   environment (never a flag; never logged). R.A.I.N.'s decision router reads
   `RAIN_DECISION_MODE` from the bridge's environment itself; unset or `off`
   (its default), it proposes no experiments and the lab says so.

3. Give the site's server the address (and the token, if any). For `bun run
dev` or `bun run preview`, put them in `.env.local` or the shell:

   | Variable             | Meaning                                                                              |
   | :------------------- | :----------------------------------------------------------------------------------- |
   | `RAIN_BACKEND_URL`   | `https://…`, or `http://` only on a loopback host; no credentials, query or fragment |
   | `RAIN_BACKEND_TOKEN` | optional; the bridge's `RAIN_BRIDGE_TOKEN`; sent upstream as a bearer token only     |
   | `RAIN_TIMEOUT_MS`    | optional; per request, clamped to 1000–55000 (default 20000)                         |

   On Vercel, set them in the project's environment variables (`RAIN_BACKEND_TOKEN`
   as **Sensitive**) and redeploy; the five `api/rain/*` functions are declared
   in `vercel.json`. Never prefix any of them with `VITE_`.

4. Open the lab. The **Systems Room** shows what is connected: R.A.I.N.'s
   repository, commit and dirty state, the corpus fingerprint, the meeting
   engine, whether a model runs, the decision mode and the registry.

A remote backend needs `https`; the bridge is a reference implementation for a
trusted machine and has no authentication beyond the optional token.

## The rooms

| Room               | Hint shown on entering                                                     | What is there                                                                                                                                              |
| :----------------- | :------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threshold          | The lab's rules are written here. The door behind you returns to Bethesda. | the principle, the rules, the way back                                                                                                                     |
| Research Panel     | Ask the four perspectives to investigate a question.                       | the question; the meeting turn by turn with its speaker; verified sources; disagreement as separate branches; ungrounded turns marked; next investigations |
| Evidence Library   | Inspect the sources used in the current meeting.                           | every item, filterable by kind of claim (below)                                                                                                            |
| Experiment Bay     | Turn a supported hypothesis into a Bethesda experiment.                    | proposals, their deterministic checks, the protocol, and authorization                                                                                     |
| Observation Room   | Watch the simulator run: arms, ticks, cohorts and what was refused.        | the run in progress, the live city, the perspectives' outings, the observation tools, and every refusal                                                    |
| Registry / Archive | Replay, reproduce, or inspect prior results — failures included.           | every record — supported, not supported, inconclusive, failed, rejected — with replay, export and reproduction                                             |
| Systems Room       | See what the lab is connected to, and what it is not.                      | the runtime, the provenance bridge, the boundaries and the limits                                                                                          |

Walk with WASD or the arrows (Shift hurries), drag or use mouse lock to look,
or use the room buttons, which every capability also lives behind. Without
WebGL the rooms are panels, and every capability stays available.

## The four perspectives

James, Jasmine, Luca and Elena are embodied in R.A.I.N.'s own colours (its
Godot client's avatar looks and lab theme); the figures themselves are this
lab's. **None of their words are written here.** A
meeting is a validated R.A.I.N. meeting record — LIVE from the backend, or the
DEMO recording — and the lab stages it through R.A.I.N.'s neutral event
vocabulary (`conversation_started`, `agent_utterance`, `conversation_ended`),
word for word. The speaker is highlighted while their turn is shown. Turns
without a verified span say `UNGROUNDED · NO VERIFIED SPAN`; quotes show their
source file, line and character span and whether they were verified verbatim.
Where the record shows the perspectives disagreeing, the panel keeps the
positions as separate branches. Confidence is never animated, and agreement
among the four is described as agreement, never as validation.

## What counts as evidence

The Evidence Library sorts every item into one of six kinds, each labelled the
same way everywhere in the lab:

| Kind                  | What it is                                                                                                             |
| :-------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| **SOURCE**            | a verbatim span of R.A.I.N.'s corpus, re-verified by `verify_quote`, with file, line and characters                    |
| **INTERPRETATION**    | a perspective's reasoning about the sources (scripted, in R.A.I.N.'s offline engine)                                   |
| **HYPOTHESIS**        | a claim a proposal commits to testing                                                                                  |
| **OBSERVATION**       | a `bethesda-world-observation/v1` packet the simulator computed from its own state, with tick, state hash and map hash |
| **SIMULATION RESULT** | the measurements of a completed matched run                                                                            |
| **VALIDATED CHECK**   | a deterministic host check that passed                                                                                 |

Never evidence: where an avatar stands, anything rendered, the interior, a
perspective's confidence, and the four agreeing. An observation packet can be
recomputed from the simulator at the tick it names, and `verifyObservation`
fails if a count, the tick or the state hash does not match.

## Experiments

### A proposal names; the host defines

A proposal (`rain-bethesda-experiment/v1`) is a closed object: a scenario, a
mapped place and a metric from the vocabulary below, a direction and minimum
effect, up to five seeds, a warm-up and an observation window, the question and
hypothesis, its origin (`rain`, `human` or `fixture`) and, for a R.A.I.N.
proposal, the decision that produced it. It cannot carry a coordinate, a
command, code, a URL or a path; an unknown field rejects it. R.A.I.N. never
writes one directly: it chooses among the host's options (`X1`–`X11`, one per
supported scenario and place, or `ESCALATE_TO_HUMAN`), and the host writes the
proposal from the option it chose. A proposal from R.A.I.N. expires after 15
minutes unapproved.

| Scenario          | Places                                            |
| :---------------- | :------------------------------------------------ |
| Metro closure     | Bethesda Metro entrance                           |
| Fire              | Bethesda Row, Veteran's Park, Farm Women's Market |
| Gas leak          | Bethesda Row, Farm Women's Market                 |
| Street festival   | Bethesda Row                                      |
| Rally             | Veteran's Park                                    |
| Vehicle collision | Woodmont Ave & Bethesda Ave                       |
| Power outage      | Downtown Bethesda                                 |
| Thunderstorm      | Downtown Bethesda                                 |

Metrics: `cohort_mean_distance_m`, `cohort_indoors`, `pedestrians_near`,
`leaving`, `sheltering`, `watching`, `vehicles_held`. Each is defined in
`contracts.ts` by what the simulator counts, and every definition travels with
the record.

### Deterministic validation

`validateExperiment` checks the shape, the scenario, the place, the budget, the
metric and replay compatibility, and names exactly what failed. The scenario is
compiled from a fixed sentence by the city's own scenario compiler and must
resolve to the expected mapped place; the definition takes the compiled event,
never a proposer's coordinates. Bounds: 1–5 distinct 32-bit seeds; warm-up
100–1200 ticks; window 300–3000 ticks on the 100-tick sample grid; at most
36,000 simulated ticks in all. The criteria are derived, not proposed:

- **Guards** — G1 every seed completed both arms; G2 control and treatment were
  identical until the intervention, in every seed; G3 (cohort metrics) every
  seed's catchment cohort has at least five pedestrians.
- **Success** — S1 the mean treatment − control difference is at least the
  minimum effect in the expected direction; S2 every seed moved that way.
- **Failure** — F1 the mean difference is zero or the wrong way.

The definition is hashed (SHA-256 over canonical JSON); its first twelve hex
digits name it (`BX-…`).

### Human authorization

Nothing runs until a person authorizes that exact digest: they review the
protocol, tick that they did, and type the digest's first eight characters. The
result is a **local operator authorization record**
(`bethesda-experiment-authorization/v1`): a hashed attestation by this browser
under a role label (`R.A.I.N.Operator` by default; at most 64 letters, digits,
dots, underscores and hyphens, so no spaces and no e-mail address), with
`identity_verified: false`. It is not authenticated identity and
not a signature. Any change to the definition voids it, and the runner refuses
to start without a record that matches.

### Matched runs

Each seed runs twice on simulators the runner builds for itself — never the
live city — from the same configuration: a control and a treatment, identical
until the intervention tick, where the treatment receives the compiled
scenario. The runner checks the two are in the same state at that tick. Runs
happen in a Web Worker (with a time-sliced fallback), so the live city keeps
its own time while you watch. Each arm records its seed, its simulator
configuration and exactly the commands it received, the intervention tick and
the state hash there, its cohort, baseline and every observation packet, its
metric values, checkpoints every 100 ticks, the final state hash, and the count
and hash of the decisions its agents made. The definition carries the start
tick, window, sample interval, metric definitions, simulator and contract
versions and the map, streetscape and terrain hashes; the record adds the
measurements, the provider and model (or `null`), and any refused input, kept
as text. Replay accepts exactly the commands the definition implies, so a
command added anywhere fails verification.

### Lifecycle

`PROPOSED → VALIDATED → AWAITING HUMAN APPROVAL → AUTHORIZED → RUNNING →
COMPLETED | INCONCLUSIVE | FAILED`, or `REJECTED` (failed validation, declined,
or expired). Transitions are checked; approval cannot be skipped. Endings map
onto R.A.I.N.'s statuses:

| Lab ending                           | R.A.I.N. status | Meaning                                                    |
| :----------------------------------- | :-------------- | :--------------------------------------------------------- |
| COMPLETED · hypothesis SUPPORTED     | `passed`        | the criteria held                                          |
| COMPLETED · hypothesis NOT SUPPORTED | `failed`        | a failure criterion triggered                              |
| INCONCLUSIVE                         | `inconclusive`  | the criteria did not decide                                |
| FAILED                               | `error`         | the run did not complete; the hypothesis was not evaluated |
| REJECTED                             | —               | it never ran                                               |

The shipped DEMO proposal predicts that closing the Metro disperses the people
near its entrance by at least 10 m. The simulator says the opposite: the
cohort ends 28.66 m _closer_ on average (−30.68 to −25.09 across the three
seeds), because commuters wait at the closed entrance and onlookers gather. It
is recorded as **COMPLETED · NOT SUPPORTED**, and R.A.I.N.'s registry records
the same.

### Reporting back to R.A.I.N.

In LIVE, **Pre-register with R.A.I.N., run, and report the measurements**
registers the lab's `rain-experiment/v1` draft with R.A.I.N.'s registry before
the run, then submits a `rain-experiment-submission/v1` with the measurements
and the run artifact's SHA-256 — and **no status or verdict**; R.A.I.N.
evaluates its own pre-registered criteria and returns its own run record, which
the lab keeps beside its own. The submission names the commit that produced the
run and refuses to invent one: a build without a known commit cannot report.
Offline, **Export R.A.I.N. admission bundle** writes the same draft and
submission for `tools/rain-bridge/admit.py` to admit later.

## Observation tools and the perspectives in the city

The lab looks at the live city only through seven typed, read-only tools
(`tools.ts`, results `bethesda-tool-result/v1`): `observe_nearby_actors`,
`inspect_current_event`, `measure_distance`, `inspect_local_traffic_state`,
`inspect_local_pedestrian_state`, `request_metric_snapshot` and
`request_replay_segment`. Each takes ids from the vocabulary and small bounded
numbers (a 10–60 m radius, ticks within a run), rejects any other field,
reports counts and kinds — never another agent's id or position — and names its
source, tick, state hash, map hash and simulator version. There is no tool that
acts.

A perspective can also **walk**. From the Observation Room, send one to a place:
an avatar leaves by the lab's door and walks the mapped sidewalks (shortest by
length, at most 1.5 km) at 3 m/s on the city's clock, pauses, and walks back.
At most two are out at once, one per perspective. The avatar is not a
simulation agent — nobody in the city sees, avoids or reacts to it — and it is
drawn in the city, on the minimap and on the lab's wall map, while its seat in
the lab stands empty. Only inside the place's 40 m observation region does the
simulator observe, once: the four location tools and a world-observation
packet, computed from simulator state at that tick, recorded as a
`bethesda-avatar-observation/v1` naming who asked. The avatar's position is
recorded as where it asked from and is never measured from; the observation's
note says so. Observation and action stay separate: the only way the lab changes
a world is a validated, authorized experiment, on its own simulators.

## Registry, replay and reproduction

Every ending lands in the registry, failures and refusals included, and the most
recent 24 records are kept in this browser's storage. A record
(`bethesda-rain-experiment-record/v1`) holds the proposal, the validation, the
definition and its digest, the authorization, the lifecycle, the run, the
outcome, R.A.I.N.'s pre-registration and record if any, and the provenance,
sealed by a SHA-256 over the rest.

- **Verify by replay (no model)** re-executes every arm's recorded commands
  through the simulator and compares the intervention-tick state, the cohort,
  the baseline, every observation, the measurements, every checkpoint, the
  final state and the decision history, then re-checks the digest, the
  definition, the authorization, the lifecycle, the evaluation and the outcome.
  Everything it needs is in the record — the proposal, the definition, the
  approval, the commands the simulators accepted, any input that was refused,
  every observation and the outcome — so it never contacts R.A.I.N. or a
  model.
- **Export record** and **Import a record** move a record between browsers. An
  import whose digest does not match is refused; a re-sealed edit is caught by
  replay.
- **Export arm as a city replay** writes a standard `bethesda-replay/v3` trace
  that the city's own replay verifier accepts.
- **Reproduce** re-validates the same proposal and, once authorized again, runs
  it fresh and compares the outcome, every measurement and every arm's final
  state with the original, listing any difference.

## Provenance

Every record carries both repositories and their commits — james_library's from
R.A.I.N.'s identity (or from the DEMO recording, labelled as such), this
repository's from the build — with their dirty state and where each came from;
the protocol, observation, definition and replay schema versions; the simulator
version; the map, streetscape and terrain SHA-256; the provider and model; the
seeds; and the time it was recorded. **Unknown stays unknown**: a value nobody
reported is `null` or "unknown", never estimated. A build without git records
its own commit as unknown. There is no source hash for anything that was not
fetched.

## Failing closed

| When                                                                                                                                    | The lab                                                               |
| :-------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| no backend, a misconfigured address, or an unreachable backend                                                                          | says OFFLINE and why; nothing is generated                            |
| a timeout, a rate limit, a session limit or a server error                                                                              | shows that failure and nothing in its place                           |
| an answer that is malformed, oversized, for another request, from an unknown speaker, or whose citation audit disagrees with its quotes | refuses it as INVALID ANSWER (on the server and again in the browser) |
| a quote that does not verify                                                                                                            | shows it as NOT verified and the turn as UNGROUNDED                   |
| R.A.I.N. chooses an option it was not offered                                                                                           | refuses the choice                                                    |
| an unsupported scenario, place or metric; coordinates, code, URLs or extra fields                                                       | rejects the proposal, naming the check                                |
| a stale R.A.I.N. proposal                                                                                                               | rejects it at approval                                                |
| no authorization, or one for another digest                                                                                             | refuses to run                                                        |
| a run that throws or is cancelled                                                                                                       | records FAILED, not evaluated                                         |
| a record from another simulator version, or one that does not replay                                                                    | verification fails and says which check                               |
| an avatar outside the observation region                                                                                                | records the refusal; nothing is observed                              |

Whatever R.A.I.N. does, Bethesda keeps working: the city never waits on the lab,
and the lab never writes to the city.

## Performance

The lab is lazily loaded. Inside it, the city's rendering is unmounted while its
simulation keeps its fixed 10 Hz timer, so experiments and outings are never
paused because you are indoors. Matched runs execute in a Web Worker. The wall
map redraws once a second and the avatars' positions are computed once per city
tick.

## Privacy and security

- **The browser talks only to its own site.** `/api/rain/*` is the only route to
  a backend; the Content-Security-Policy allows no other origin. The backend
  address and token are read only by `api/rain/_config.ts` and the Vite dev
  middleware, never `VITE_`-prefixed; `secretBoundary.test.ts` fails if any
  other file reads them or browser code names them, and the build's secret scan
  fails if `dist/` contains the token's name or value.
- **The route is not a proxy.** The browser sends small same-origin JSON bodies
  with closed fields and a session id; the server composes every upstream
  request itself. Request bodies are capped (4 KiB for a question, 256 KiB for
  a submission), answers are capped (256 KiB for a meeting) and re-validated.
  Per session: one meeting every 15 s, at most 12 meetings in a 120-minute
  session; proposals every 5 s, pre-registrations and submissions every 2 s,
  24 each. Per client, a bucket of 12 requests refilling one every two
  seconds; per server instance, at most two upstream requests in flight.
- **Nothing a model writes is followed or executed.** No R.A.I.N.-supplied URL
  is linked or fetched, no path is opened, no code is run, no shell is invoked
  (the bridge's only subprocess is `git` with fixed arguments). Text is
  rendered as text — never as HTML — after control, bidirectional and
  zero-width characters are refused.
- **What leaves the browser.** In LIVE, your question and the experiment
  drafts and measurements go to the backend you configured. In OFFLINE and
  DEMO, nothing does. Records stay in this browser until you export them. The
  operator role label is the only thing you type into an authorization; it
  takes no spaces or e-mail addresses — use a role, not a name.

## Limitations

- R.A.I.N.'s offline engine is the only meeting engine exercised here; its
  reasoning text is scripted. No model-generated meeting is claimed.
- With `RAIN_DECISION_MODE` off — the bridge's default — R.A.I.N. proposes
  nothing, and experiments start from the DEMO fixture or a person.
- The vocabulary is small on purpose: eight scenarios, six places, seven
  metrics. Adding one is a contract change, not a configuration.
- Rate limits are per server instance and reset on a cold start.
- The authorization record attests to an action in a browser, not to a person.

## Verifying

```sh
bun run test:bethesda       # includes the lab: contracts, experiments, authority,
                            # runs and replay, the door, OFFLINE/DEMO/LIVE, tools,
                            # outings, and the /api/rain route
bun run build               # validate:bethesda checks the DEMO recording
bun run verify:rain-lab     # tools/rain-lab.mjs on its own preview of dist/: discovery,
                            # OFFLINE, DEMO, authorization, run, replay, tampered import,
                            # a fresh browser, outings, tools, axe in every room, CSP,
                            # no WebGL
RAIN_LIBRARY_PATH=../james_library bun run verify:rain-lab   # adds LIVE through the bridge
RAIN_LIBRARY_PATH=../james_library bun run rain:conformance  # james_library judges the output
```

`tools/rain-lab.mjs` serves the build that ships, with its security headers; it
needs `bun run build` first and no `RAIN_BACKEND_URL` in `.env.local`.

## Changing it

- `src/bethesda/rain/contracts.ts` is shared with the server; changing a wire
  type, a field or a limit means bumping `RAIN_BETHESDA_SCHEMA` and updating the
  bridge, `server/rain/handler.ts` and their tests together.
- Never hand-edit the DEMO recording. Re-record it with
  `python3 scripts/export-rain-demo.py --library ../james_library` (also
  `bun run rain:demo -- --library …`), which writes the manifest with the real
  time and hashes.
- A new scenario, place or metric goes into the vocabulary, its compiled
  sentence and its expected place in `experiments.ts`, and the options in
  `session.ts`; the tests enumerate every pair.
- A behaviour change in the simulator bumps `SIM_VERSION`; records from the old
  version then fail verification with an explanation, as they should.
- The lab must stay removable from Bethesda: the city reaches it only through
  the door, the console phrase and the outing figures it draws.
