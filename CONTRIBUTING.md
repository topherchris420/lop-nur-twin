# Contributing

This project publishes claims about a real place from public sources. That makes
most of the rules below rules about honesty rather than about style, and it is
why the build enforces so many of them.

## Setup

**Requirements:** [Bun](https://bun.sh) 1.3+, or **Node ≥ 22.18**. Both are
supported and both must produce byte-identical manifests. `bun.lock` is the
committed lockfile CI installs from; `package-lock.json` is kept for the npm
path and should be refreshed alongside it when dependencies change.

```sh
bun install
bun run dev      # :5173, regenerates the manifest first
bun run build    # the authoritative gate
bun run preview  # :4173, with the deployed security headers
```

## Before you open a pull request

```sh
bun run check
```

That composes formatting, linting, unit tests, the evidence validator's negative
tests and the build. If your change touches a route, the scene or the
simulation, also run what covers it:

```sh
bun run build && bun run preview &
bun run a11y && bun run routes

bun run dev &
bun run smoke && bun run gait && bun run audio
```

[`docs/VALIDATION.md`](docs/VALIDATION.md) says what each of these proves.

**Keep the build green.** `bun run build` runs the data validator, regenerates
the manifest, bundles, and finishes with a strict `tsc --noEmit` over `src/` and
`scripts/` — no `any`, unused locals are errors, no exclusions. A change that
needs the build red is a change that needs a different design.

## Formatting and linting

Prettier owns formatting; ESLint owns correctness and has no stylistic rules.
`bun run format` and `bun run lint:fix` apply both.

Two things are deliberately outside Prettier's reach, and both are argued in
place:

- **Tabular data declarations** in `layout.ts` and `siteData.ts` carry
  `// prettier-ignore`. They are data, written one record per line. Exploding a
  45-structure array to ten lines an entry makes a geometry change unreadable in
  review, and reviewing geometry changes is what the single-source-of-truth rule
  depends on. If you add a record to one of those tables, match the existing
  line shape.
- **Generated files** — the route tree, the release manifest, the lockfiles.
  Each is rewritten by its own generator.

ESLint's `no-explicit-any` is an error. If a third-party type forces your hand,
narrow it locally with a documented type guard rather than widening.

## Evidence rules

These are the ones that will fail your build, and each exists because the
failure it catches is one a reviewer would reasonably call a false claim.

**Choose the classification honestly.** `observed` only if the feature is visible
in a cited scene; `reported` only if a cited publication says it is there;
`interpreted` if you assigned the identity; `illustrative` if you invented it to
complete the site. The evidence record, the dossier entry, the `/analysis` row,
the evidence mode it appears in and the uncertainty envelope are all generated
from that choice.

**Never hand-write an evidence record.** `src/lib/evidence.ts` derives the ledger
from the layout and the source register, so a claim cannot outlive the thing it
describes. UI reads it through `getEvidenceForSubject()`. Do not re-resolve
source metadata in a component, and do not add a second place that decides what
"observed" means.

**Never fabricate a source, a date, a hash, a measurement, a confidence value or
an uncertainty figure.** Unknown means omitted or printed as "unknown", not
estimated. If you find yourself picking a plausible-looking number, that is the
signal to leave the field absent.

**A number needs a method and a basis.** Every numeric uncertainty declares where
it came from: stated by the cited source, documented by this project, or derived
from the cited scene's ground sample distance. See
[`docs/UNCERTAINTY_MODEL.md`](docs/UNCERTAINTY_MODEL.md) for the full rule list,
including the one that catches an `observed` claim asserting an exact position.

**Keep the three dates apart.** When something happened at the site, when the
evidence became public, and when a change entered this model are different facts
and must never be merged in data or in wording. A first appearance in imagery
bounds when something existed _by_; it is not a construction date. See
[`docs/TEMPORAL_MODEL.md`](docs/TEMPORAL_MODEL.md).

**If you relax a validator rule, say so out loud** in
`scripts/test-evidence-validation.ts`. That file asserts each of the 35 rules
still fires, because a validator that never fires is indistinguishable from one
that has been quietly disabled.

## Determinism

Spatial analysis follows the same rule. Add geometry only in `layout.ts`;
`spatialCatalog.ts` derives footprints and evidence joins. Query code must use
modeled footprint distance, keep unknown uncertainty distinct from zero, and
exclude live ADS-B or other moving simulation entities. Run the spatial unit
tests and route checks for any query, CRS, URL or export change. See
[`docs/SPATIAL_ANALYSIS.md`](docs/SPATIAL_ANALYSIS.md).

**Everything is procedural and seeded.** All randomness flows through
`mulberry32`/`seededNoise2D` in `src/lib/noise.ts`, so a given seed always
reproduces the same site. No binary assets and no runtime downloads — drei
helpers that fetch CDN assets are off-limits.

**Hashes must be reproducible.** `SOURCE_DATE_EPOCH` pins `generatedAt`; every
other manifest field is a pure function of committed data, and CI diffs two
generated manifests to prove it. Canonicalisation lives in
`src/lib/canonicalJson.ts` and has its own tests.

The one exception is bookmark ids, which use `crypto.randomUUID` deliberately:
two bookmarks saved a second apart must not collide, and that has nothing to do
with reproducing a site.

## Architecture

**`src/lib/layout.ts` is the single source of truth** for geometry placement;
`src/lib/siteData.ts` owns public sources, evidence types, the CRS and
climatology. Never hard-code coordinates in a component.

**Coordinates:** metres, `+x` east, `+z` south (north is `-z`), `y` up. The HUD
translates into the public EPSG:32645 runway-centre reference. Getting the sign
of `z` wrong produces bearings that are individually plausible and collectively
mirrored — `src/lib/measure.test.ts` pins the convention.

**No React state on the frame loop.** Per-frame data flows through mutable
singletons (`src/lib/telemetry.ts`) or refs mutated in `useFrame`. Zustand is for
discrete events only: mode switches, selection, month changes, toggles.

**Read every URL parameter through `src/lib/params.ts`.** It bounds, clamps and
rejects. A raw `new URLSearchParams(...).get()` in a component is a regression.
External links go through `safeExternalHref()` and carry `EXTERNAL_LINK_PROPS`.

**One filter predicate.** Timeline year and evidence mode compose in
`src/lib/sceneVisibility.ts`. A component asking "should I draw this?" calls
`useSubjectFilter()`; it does not compare classifications itself.

**Game mechanics touch nothing analytical.** Evidence classification, confidence,
temporal events, uncertainty, model manifests, bookmarks and spatial conclusions
are downstream of the ledger, and the ledger does not know `/play` exists.

`AGENTS.md` carries the recipes: adding a structure, a camera mode, a dynamic
element, or changing the terrain or the look.

## Accessibility

**`/analysis` and `/compare` are not optional.** They are the routes that work
when WebGL does not, and they are held to a higher bar than the canvas routes:
`bun run a11y` fails the run on any serious or critical axe violation there.

**Every analytical capability needs a semantic representation.** If you add
something to the 3D HUD that a viewer can learn from, it belongs on `/analysis`
in a form a screen reader can read. A capability that exists only inside a canvas
is a capability part of the audience does not have.

**Nothing is carried by colour alone** (WCAG 1.4.1). Every status, level and
mode pairs a word with a glyph. Confidence is a number and a rank in text, never
a bar.

**Reduced motion is respected**, and the adaptive quality ladder must keep
working. Expensive new rendering should degrade on low tiers — but degrade the
_rendering_, never the information: the numbers stay in the dossier and the
table at every tier.

## Pull requests

- **One concern per pull request.** A formatting sweep and a behaviour change in
  the same diff is a diff nobody can review.
- **Say what changed and why in the body**, especially for anything that moves a
  hash. `geometryHash` moving means something in the world moved;
  `evidenceLedgerHash` moving means a claim changed. Those need different
  scrutiny, and `/compare` will tell a reviewer which happened.
- **Regenerate nothing you did not intend to.** `bun run shots` rewrites the
  committed screenshots; only include its output when a screenshot genuinely
  needed to change. Captures under `shots/` and `render_output*.png` are review
  evidence and are gitignored.
- **CI runs on every pull request**, from forks included, with
  `permissions: contents: read` and no repository secrets.

## Unfinished work

Park it in [`experiments/`](experiments/README.md), outside `src/` and outside
the TypeScript project — not behind a `tsconfig` exclusion. Production source has
no parked corners.
