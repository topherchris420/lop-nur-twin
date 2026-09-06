# Validation and verification

Every check this repository can run, what it actually proves, and what it does
not. It is the companion to [`CONTRIBUTING.md`](../CONTRIBUTING.md), which says
when to run them.

## The gate

`bun run build` is the authoritative integration gate. It runs the offline data
validator, regenerates the release manifest, produces the production bundle, and
finishes with a strict `tsc --noEmit` over every file in `src/` and `scripts/` —
no `any`, unused locals are errors, no exclusions.

`bun run check` composes the full quality gate:

```sh
bun run format:check   # Prettier
bun run lint           # ESLint
bun run test:run       # Vitest
bun run test:evidence  # the validator's own negative tests
bun run build          # validate → manifest → bundle → strict typecheck
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
`validateEvidenceLedger` for each of **35 rules** and asserts the specific error
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
bun run a11y     # axe-core on all four routes + CSP violations
bun run routes   # deep links, refreshes, hostile parameters, spatial queries,
                 # keyboard order, filtering, mobile reflow, reduced motion
```

`bun run a11y` gates `/analysis` and `/compare` on serious and critical axe
violations. `/` and `/play` are reported but not gated: their primary content is
a WebGL canvas, and an axe rule cannot inspect one.

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
history, Trivy filesystem and configuration scans, GitHub dependency review on
pull requests, and generates CycloneDX and SPDX software bills of materials as
run artifacts. The SBOM describes a _resolved_ dependency tree, so it is
published per run rather than committed, where it would be stale the moment a
transitive dependency moved.

## What CI does, and how it targets the default branch

`on.push.branches` takes a literal list and the `github` context is not
available in an `on:` block, so "the default branch" is not expressible as an
event filter — and a hard-coded branch name silently stops matching after a
rename. Both workflows therefore subscribe broadly and gate every job on
`github.event.repository.default_branch`, resolved at run time.

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
