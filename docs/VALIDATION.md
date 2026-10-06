# Validation and verification

Every check this repository can run, what it actually proves, and what it does
not. It is the companion to [`CONTRIBUTING.md`](../CONTRIBUTING.md), which says
when to run them.

## The gate

`bun run build` is the authoritative integration gate. It runs the offline data
validator, then Bethesda's (`scripts/validate-bethesda.ts`: the city's data,
the R.A.I.N. corpus and the DEMO recording, each against its hashes),
regenerates the release manifest, produces the production bundle, runs a strict
`tsc --noEmit` over every file in `src/`, `scripts/`, `server/` and `api/` — no
`any`, unused locals are errors, no exclusions — and finishes with
`tools/jev-secret-scan.mjs`, which fails the build if `dist/` contains the name
of any provider credential (`TYPESAFE_API_KEY`, `FASTINO_API_KEY`,
`LLM_API_KEY`, `RAIN_LLM_API_KEY`), anything shaped like one of their keys, or a
configured key's value when it is present in the build environment.

`bun run check` composes the full quality gate:

```sh
bun run format:check   # Prettier
bun run lint           # ESLint
bun run test:run       # Vitest
bun run test:evidence  # the validator's own negative tests
bun run build          # validate (twin, Bethesda) → manifest → bundle → strict typecheck → secret scan
```

Nothing in that list re-runs a build operation the build already performs.

## Offline data validation

```sh
bun run validate:data
```

Checks sources, geometry, bounds, geodesy, the flight path and the evidence
ledger. It fetches nothing: every input is committed, so the validator is a pure
function of the repository and produces the same result offline, in CI, and on a
machine with no network at all.

The rules that make a claim fail the build are documented in
[`docs/DATA_PROVENANCE.md`](DATA_PROVENANCE.md) (classification, sourcing,
confidence, CRS) and [`docs/UNCERTAINTY_MODEL.md`](UNCERTAINTY_MODEL.md)
(envelopes, methods, bases, temporal bounds).

## The validator's own tests

```sh
bun run test:evidence
```

`validate:data` proves the ledger currently passes. That is half the claim: **a
validator that never fires is indistinguishable from one that has been quietly
disabled.** This feeds a deliberately malformed record through
`validateEvidenceLedger` for each of its **37 rules** and asserts the specific error
fires.

If you relax a rule, this file is where you have to say so out loud.

## Unit tests

```sh
bun run test          # watch
bun run test:run      # once
bun run test:coverage # with a coverage report over src/lib/
```

Unit tests cover the deterministic, non-rendering half: parameter validation and
hostile input, coordinate and bearing conventions, measurement summaries, the
evidence ledger and its classifications, evidence-mode nesting, uncertainty
derivation, the temporal ledger and snapshot comparison, manifest
canonicalisation and diffing, bookmark serialisation and migration, quality
tiers, timeline visibility and climatology normalisation.

Deliberately no browser environment and no Three.js. What a scene _looks_ like
and what the simulation _does_ need a real renderer and a real frame loop; the
tools below cover those, and re-testing them here through a mock would assert
the mock.

Coverage is reported over `src/lib/` only, so the number means something rather
than being diluted by scene code verified in a browser. It is a map of what is
tested, not a target to hit.

Spatial suites additionally cover WGS84/UTM/local round trips, oriented
footprint derivation, intersection and distance boundaries, query composition,
unknown uncertainty, temporal presence, canonical export determinism, malformed
responses and RFC 7946 coordinate/ring validity. `validate:data` gates catalog
completeness, evidence linkage, finite closed rings, live-entity exclusion and
representative repeated-query equality.

## Manifest reproducibility

```sh
SOURCE_DATE_EPOCH=1700000000 bun run manifest
```

`generatedAt` is the only field that moves between runs; everything else is a
pure function of the committed model data. CI generates the manifest twice with
the epoch pinned and diffs the two files, so a non-deterministic input reaching
a hash input is a failing build. Both the Bun and Node ≥ 22.18 paths must produce
byte-identical manifests.

See [`docs/MODEL_COMPARISON.md`](MODEL_COMPARISON.md) for diffing two of them.

## Accessibility and routes

Both need the **preview** server rather than the dev server, because they test
the artifact that actually ships — including its security headers.

```sh
bun run build && bun run preview &
bun run a11y     # axe-core on every route + CSP violations
bun run routes   # deep links, refreshes, hostile parameters, spatial queries,
                 # keyboard order, filtering, mobile reflow, reduced motion
```

`bun run a11y` gates `/analysis`, `/compare` and `/evaluation` on serious and
critical axe violations — `/evaluation` twice, empty and with the newest archived
run open, so its tables and charts are what is inspected. `/` and `/play` are
reported but not gated: their primary content is a WebGL canvas, and an axe rule
cannot inspect one.

`tools/routes.mjs` is where a URL-parameter regression shows up. It throws
`?quality=1e309`, `?at=1e308,-1e308`, `?snapshot=2025-02-30`,
`?evidence=not-a-mode`, `?structure=<script>…` and a 500-character id at the app
and asserts it renders normally with no page errors. It once proved a real bug
into existence: a manifest fetch whose effect aborted its own request and left
the panel reading "Reading the manifest…" forever.

The route gate also loads canonical spatial-query links and checks keyboard
order, proximity ordering, result announcements, export availability, empty and
hostile filters, refresh stability, and mobile containment.

**Automated checks cover only part of WCAG 2.1 AA.** Screen-reader narration,
keyboard-only task completion, 200% zoom and colour-contrast review of the
canvas itself remain manual. This repository makes no Section 508 conformance
claim — see [`docs/ACCESSIBILITY.md`](ACCESSIBILITY.md).

## Simulation and audio

For Blacksite the look is only half of it, and the half a screenshot cannot
answer. These drive the real subsystems and assert numbers:

```sh
bun run smoke        # 22 checks: colliders baked, spawns clear, hits resolve
bun run engagement   # 13 checks: the opposing force actually fights you
bun run gait         # 15 checks on the walk cycle
bun run audio        # renders each sound offline and measures peak + crest
```

### The player brains

```sh
bun run test:jev                    # unit: contract, schema, executor, motor
                                    # controller, fire gate, engagement axes,
                                    # authority, loop, providers, recorder,
                                    # metrics, endpoint, credential boundary
bun run jev                         # browser checks against the dev server,
                                    # Jev path against a fake endpoint — no API calls
JEV_LIVE_TEST=1 bun run jev:live    # the real TypeSafe API, through the dev server
bun run benchmark:random            # repeatable episodes, seeded random brain, direct
bun run benchmark:random:precision  # …the same brain through the precision controller
JEV_LIVE_TEST=1 bun run benchmark:jev            # Jev, direct control (the original)
JEV_LIVE_TEST=1 bun run benchmark:jev:precision  # Jev, precision control
bun run replay:jev -- trace.jsonl   # replay a recorded control stream
node tools/jev-benchmark.mjs --brain script --policy marksman --control precision
node tools/experiment.mjs tools/experiments/exposure.json   # a declared experiment + its evaluation
node tools/kill-anatomy.mjs --policy marksman               # what each victim was doing
bun run llm                         # the LLM seat end to end, against the offline test double
bun run glide                       # the Glide seat against an in-browser fake (25 checks)
FASTINO_LIVE_TEST=1 bun run glide:live        # Glide against the real Fastino API
FASTINO_LIVE_TEST=1 bun run benchmark:glide   # Glide, precision control
bun run test:eval                   # unit: evaluation core, seat, server handlers (Jev, Glide, LLM, R.A.I.N.)
```

### The evaluation harness

`bun run test:eval` covers what a result is made of, with synthetic inputs and
fake providers only: the statistics (intervals, percentile gating, paired
differences), calibration bins, Brier and ECE, pricing (a price needs a source
and a date; unknown cost stays null; no price anywhere else in the source),
the ledger, experiment contracts (malformed, misspelled or unregistered
definitions are refused; live arms need their flag; a remote model's latency
cannot be swept), outcome contracts, warnings (each fires on its signature and
not on its absence), contribution contrasts and interactions, the evaluation
schema and its determinism, revalidation of stale answers, outcome windows,
decision accounting for every brain, LLM output validation, and the LLM
endpoint: parity with Jev's question, both adapters (the Anthropic one through
the official SDK against a fake transport), refusals, malformed output, retries,
timeouts and key non-leakage. `bun run llm` then runs the real LLM endpoint and
adapter in a browser against the offline double and checks the records it
leaves (13 checks).

### Experiments

`tools/experiment.mjs` runs several seat configurations — brain, policy,
control, navigation, cadence, injected latency, staleness policy, motor
profile, option order — on the same seeds through `jev-benchmark.mjs`, then
builds a `blacksite-evaluation/v1` from the saved artifacts alone;
`--compare` diffs two evaluations, `--evaluate <dir>` re-scores saved
artifacts, `--archive <run> <dir>` copies a run with its decision records for
citation, and `--shadow <dir>` shows a run's recorded observations to the
scripted policies (`shadow.json`, `shadow.md`) without playing a match or
calling a model. An experiment file in `tools/experiments/`
declares its question, hypothesis, primary metric and outcome contract before
it runs, and a malformed one is refused (see
[`EVALUATION_PHILOSOPHY.md`](EVALUATION_PHILOSOPHY.md)). `--origin` points every
arm at another build (a worktree of an older commit on another port), which is
how "this change against the last one" is measured. Arms run one at a time:
each episode records how far simulated time fell behind real time, and a
lagged episode is flagged in the report rather than silently compared.

Same-seed episodes are not replicas — frame pacing is not deterministic, so
the bots diverge within seconds — which is why every table prints each seed.

`bun run jev` proves the pilot seat without spending anything: the random brain
moves, turns and fires through the real rig; seed 42 reproduces its frames;
errors, timeouts and an unconfigured service show ERROR, TIMEOUT and UNAVAILABLE
while the simulation keeps running and nothing stays held; invalid answers are
rejected; H hands control back; death and respawn leave the controller working;
under precision control the tracking controller binds only living enemies Jev
named, never measures one without a sight line, holds the chosen region, lets go
during an outage and on takeover, and labels its episode and trace; Elite
Operator switches on and off visibly and labels a human episode;
fallback and replay can never be labelled LIVE JEV; hostile `?brain=`, `?seed=`,
`?fallback=` and `?trace=` values fall back to defaults. Anything that calls the
real API requires `JEV_LIVE_TEST=1`. The headless tools stub the GPU draw and
explain why in `tools/jev-harness.mjs`. See
[`docs/JEV_BLACKSITE.md`](JEV_BLACKSITE.md).

Each exists because a still frame reported something false. `tools/gait.mjs`
steps one actor's animator across several stride cycles, because a headless
capture advances a handful of frames and a stride takes sixty — a knee that
bends backwards looks like a bent knee in a photograph, which is how it survived
several visual reviews. `tools/engagement.mjs` was written after a build in which
every check in `smoke.mjs` passed and the game was still unplayable: the player
was the one actor with no hitboxes, so bots acquired, aimed and fired perfectly
correctly and every round resolved against the concrete behind you.

## Visual verification

Shader and layout work is checked against captured frames rather than by eye.

```sh
bun run dev &
node tools/probe.mjs                    # → render_output.png
node tools/probe.mjs --focus "Main assembly hangar" --no-hud
node tools/probe.mjs --plan 700 --center "-20,-40" \
  --width 1000 --height 1000 --no-hud
node tools/frames.mjs --out shots/before # the canonical six-frame set
node tools/inspect.mjs                   # live camera, lights, colliders, actors
```

The probe prints mean luma, clipped and crushed percentages, saturation and a
luminance histogram, so exposure and bloom can be tuned against numbers.
`--plan` puts the camera straight overhead at the altitude that makes the frame
cover exactly the requested ground width and reports the resulting
metres-per-pixel, so a render and a satellite crop can be scaled to the same
m/px and overlaid — comparing an oblique render against a nadir image proves
nothing about whether a building is in the right place.

`tools/frames.mjs` captures the _same_ six views every run and prints the same
statistics for each. Pass `--compare shots/before` to diff against a previous
run. Visual work went in circles for a while because every review looked at a
different frame, and a shot into the sun disagrees with a shot away from it
about almost everything.

Captures are review evidence, not project assets: `shots/` and
`render_output*.png` are gitignored, and the no-binary-assets rule means they
must never be committed. `bun run shots` regenerates the four screenshots the
documentation embeds; only commit its output when a screenshot genuinely needs
to change.

Authoring rules for this loop live in
[`.claude/skills/blender-hardsurface`](../.claude/skills/blender-hardsurface/SKILL.md).

## Supply chain

```sh
bun audit --prod --audit-level=high
```

Shipped code only: a development-only advisory should not block a documentation
change. Advisories in the toolchain still surface through Trivy and Dependabot.

CI additionally runs CodeQL (`security-extended`), Gitleaks over the full
history (default rules, plus the false-positive allowlist in `.gitleaks.toml`),
Trivy filesystem and configuration scans, GitHub dependency review on
pull requests, and generates CycloneDX and SPDX software bills of materials as
run artifacts. The SBOM describes a _resolved_ dependency tree, so it is
published per run rather than committed, where it would be stale the moment a
transitive dependency moved.

## What CI does, and how it targets the default branch

`on.push.branches` takes a literal list and the `github` context is not
available in an `on:` block, so "the default branch" is not expressible as an
event filter — and a hard-coded branch name silently stops matching after a
rename. The CI and CodeQL workflows therefore subscribe broadly and gate every
job on `github.event.repository.default_branch`, resolved at run time. The third,
`deploy-production.yml`, is the exception: it names `main`, runs only on a push
there or by hand, never on a pull request, and is the only workflow that reads
repository secrets (the Vercel token and ids it deploys with).

The gate fails open for anything that is not a branch push. Pull requests,
`workflow_dispatch` and CodeQL's weekly `schedule` always run; only a push to a
non-default branch is filtered out, and that is exactly the duplicate this
avoids, because its pull request runs the same checks. A scheduled event carries
no repository branch, so a ref comparison would have silently dropped the one
run whose purpose is to re-analyse unchanged code with newer queries.

## Repository settings this cannot configure

A workflow file cannot enable a repository setting. These have to be turned on by
an administrator, and workflow-based scanning is **not** a substitute for the
GitHub-native features with similar names:

| Setting                                     | Why it matters                                                                                                                                                        |
| :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch protection** on the default branch | Without it, the checks below can be bypassed by pushing directly.                                                                                                     |
| **Required status checks**                  | CI running is not CI blocking. The `verify`, `browser`, `secrets`, `vulnerabilities` and `sbom` jobs should be required.                                              |
| **Required CodeQL check**                   | Same distinction, for the security workflow.                                                                                                                          |
| **Native secret scanning**                  | Scans across the whole repository continuously and covers partner patterns. The Gitleaks job scans history in CI, which is a different guarantee.                     |
| **Push protection**                         | Blocks a secret _before_ it is committed. Nothing in a workflow can do this — a workflow runs after the push.                                                         |
| **Dependency graph**                        | The `dependency-review` job depends on it. If that job reports "not supported on this repository", this setting is off; fix the setting rather than muting the check. |
| **Dependabot security updates**             | `.github/dependabot.yml` configures version updates; security updates are a separate repository toggle.                                                               |
| **Default branch name**                     | Renaming it is a repository operation. The workflows resolve it at run time, so a rename needs no code change.                                                        |
| **Vercel production branch**                | Configured in the Vercel project, not in `vercel.json`.                                                                                                               |

## Shared place regressions

`node tools/places.mjs` runs eleven staged offline browser checks against the
dev server: field notes for a human, no movement or inference from reading
them, parity with the agent observation, navigation-only replay under direct
and precision control, release on takeover, hide on death, and page errors.
These fixtures are plumbing evidence, not model performance results.

`navigator.test.ts` additionally checks body-width corridors, obstructed
objectives, low ceilings, terrain slope, route budget, standing-eye concealment
and zero movement when every live feeler is blocked. The place-clearance
experiment measures the actual match separately, with matched seeds and an
unchanged steps arm.
