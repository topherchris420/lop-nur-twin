# The uncertainty model

Every claim in the evidence ledger carries a classification and a confidence
rank. Neither answers the question a reviewer actually has about a
reconstruction: **how wrong could this geometry be?**

Until this release the answer lived in prose — a free-text sentence per subject
saying things like "names, functions, heights and fine geometry are illustrative
unless separately sourced". That sentence is honest and unusable. You cannot
draw it, sort by it, or diff two builds on it.

`src/lib/uncertainty.ts` turns what the project already documents into a
machine-readable envelope. It is built around one rule:

> **Unknown stays unknown.**

An absent number means the project does not know, and it is printed as "not
stated" everywhere it appears. It is never printed as zero, as a dash, or as an
omitted row. A missing height tolerance and a height tolerance of ±0 m are
opposite claims.

## The envelope

```ts
interface UncertaintyEnvelope {
  horizontalMeters?: number; // positional uncertainty
  footprintMeters?: number; // uncertainty in modeled extent
  heightMeters?: number; // never populated — see below
  orientationDegrees?: number; // never populated — see below
  earliestDate?: string; // almost never populated — see below
  latestDate?: string; // established-by date
  identification: UncertaintyLevel; // known | probable | possible | unknown
  function: UncertaintyLevel;
  sourceDisagreement?: boolean;
  method?: string; // required whenever a number is present
  basis?: UncertaintyBasis; // required whenever a number is present
  narrative?: string; // the project's own caveat, verbatim
  sourceIds: readonly string[];
}
```

## Where a number is allowed to come from

Exactly three places, and the `basis` field on every envelope names which one.

| Basis                            | What it means                                                                     | Used today                                                       |
| :------------------------------- | :-------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| `stated-in-source`               | The cited publication states the figure.                                          | **No.** See below.                                               |
| `project-documented`             | This project documents the figure, in `SITE_PROFILE` and in the limitations list. | Yes — ±40 m, the runway endpoint uncertainty.                    |
| `derived-from-source-resolution` | A floor computed from the ground sample distance of the cited scene.              | Yes — 10 m, for anything traced off the pinned Sentinel-2 scene. |

**Nothing uses `stated-in-source`.** The aircraft reporting says its dimensions
"carry at least a few feet of error", which is a caveat, not a number. Recording
it as one would be inventing precision the source declined to give.

**The resolution floor is not a measured error.** A footprint traced from 10 m
imagery cannot be resolved finer than one pixel, so 10 m is a lower bound on how
well the extent is known. The true error is unknown and is at least this large.
The method string on every such envelope says exactly that.

**Height and orientation are absent throughout.** No cited source states a
tolerance for either, so every envelope this model emits omits both and the
interface prints "not stated". That absence is the point. Inventing a plausible
±2 m would make the model look better and be worth less.

## The two ordinal fields

`identification` and `function` are ranks derived from the subject's declared
evidence status, in the same sense `CONFIDENCE_SCALE` is a rank published as a
number. They are not probabilities and must never be presented as one.

| Evidence status | `identification` | `function`    |
| :-------------- | :--------------- | :------------ |
| `observed`      | `known`          | **`unknown`** |
| `reported`      | `probable`       | `possible`    |
| `interpreted`   | `possible`       | `possible`    |
| `illustrative`  | `unknown`        | `unknown`     |

The load-bearing cell is `observed` → `function: unknown`. Overhead imagery
establishes that a building exists and roughly how big it is. It establishes
nothing whatsoever about what happens inside it. Collapsing these two columns is
the single most common way an imagery-derived model overstates itself, and the
validator enforces the separation.

## Temporal bounds

`latestDate` is the date the subject is established to have existed **by**.
`earliestDate` is almost always absent, because every temporal bound in this
model comes from a first appearance in a cited scene, and seeing something on a
given day proves nothing about when it started existing.

The interface is required to render this as "existed by 2025-09-13; earliest
date unknown" rather than printing the date on its own, because a bare date
reads as a construction date. See [`docs/TEMPORAL_MODEL.md`](TEMPORAL_MODEL.md).

## What the build refuses

`src/lib/evidenceValidation.ts` fails `bun run validate:data` — and therefore
`bun run build` — on each of these. `scripts/test-evidence-validation.ts` feeds
a deliberately broken record through the validator for every one and asserts the
specific error fires, so a rule that stops working is a failing test rather than
a silent gap.

- A claim about the site with no envelope at all. Illustrative content may omit
  one, because it models nothing real. Everything else has to say how well it is
  known, even when the answer is "unknown".
- A negative or non-finite uncertainty.
- An orientation tolerance larger than a full turn, which means the unit is wrong.
- A numeric uncertainty with no documented method.
- A numeric uncertainty with no declared basis, or an unrecognised one.
- A `stated-in-source` uncertainty that cites no source.
- A date range that runs backwards.
- A malformed uncertainty date.
- An unrecognised identification or function level.
- An interpreted or illustrative feature claiming a **known** identification or
  function. The identity was assigned by this project; saying it is established
  inverts the classification.
- An `observed` claim that states no positional uncertainty **and** no source
  resolution. That combination asserts the modeled coordinate is the real one,
  and the cited 10 m imagery supports site-scale extent, never an exact position.
- An `observed` claim recording an unknown identification. One of the two is
  wrong.

## How it is shown

Three representations, and the text one is the anchor:

- **Textually**, in the dossier and in the `/analysis` table, through the shared
  `UncertaintyPanel`. This is the authoritative rendering.
- **Semantically**, on `/analysis`, in a real table with a caption, reachable
  without WebGL.
- **Spatially**, as ground rings in the 3D scene sized by the documented
  distance and broken by identification level. Nothing is drawn where no figure
  is stated — most of the model is in that position, and an empty patch of
  ground is the correct rendering of "not stated". The rings never animate,
  because a pulsing ring would imply a changing quantity, and they unmount below
  quality tier 2, where the numbers remain available in text.

On the minimap, where 240 px covers 6.8 km and a ±40 m envelope would be a pixel
and a half, uncertainty is encoded as line texture — solid where identification
is established, progressively broken where it is not — rather than as a circle
that would be invisible and misleadingly precise.

Nothing is carried by colour alone. Every level pairs a word with a glyph.

## What is not modeled

- **A spread on the climatological means.** NASA POWER publishes one; this
  repository does not carry it, so no numeric band is recorded rather than one
  being derived.
- **A vertical tolerance on the terrain.** The datum is an approximate sample
  from a 30 m global surface model and the relief is a seeded proxy around it.
  Neither carries a figure this project can state, which is why the limitations
  list says the surface must not be used for slope or sightline analysis.
- **Angular uncertainty on the runway bearing.** It follows from the same ±40 m
  endpoints over a 5 km baseline, but the derived figure is not one this project
  has documented, so it is described in words instead of published as a number.
- **Source disagreement.** The field exists and no record sets it, because no
  two cited sources are recorded as disagreeing about anything. The interface
  reports "none recorded", not "no".
